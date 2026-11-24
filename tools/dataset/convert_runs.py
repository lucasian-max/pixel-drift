#!/usr/bin/env python3
"""Convert sprite-drift JSONL runs into a training-ready dataset.

The raw export is one JSON object per line (see src/recorder.ts):
  - a header with the schema, fps and field names
  - one "track" line per circuit (centreline points, width)
  - per lap: an "episode" metadata line followed by one line per 60 Hz step

This script turns that into:
  data.parquet        one row per step, LeRobot-style index columns
  episodes.parquet    one row per lap (boundaries, sizes, lap time)
  episodes/*.npz      compact per-lap arrays for quick PyTorch loading
  tracks.json         centrelines so training does not need the game
  info.json           schema, feature names, counts, maps
  stats.json          mean/std/min/max for normalisation
  splits.json         deterministic episode-level train/val split

Why Parquet: it is columnar, compressed, memory-mappable and what the
imitation-learning ecosystem (LeRobot v3, `datasets`, pandas) expects for
low-dimensional state/action streams. Video is not needed here because the
observations are numeric, so there is no MP4 sidecar.

Usage:
  python3 convert_runs.py runs.jsonl -o dataset/
  python3 convert_runs.py runs.jsonl -o dataset/ --val-fraction 0.2 --no-npz
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

RAW_OBS = [
    "x", "z", "heading", "vx", "vz", "speed", "slip", "steerAngle",
    "groundY", "pitch", "drifting", "onRoad", "onKerb", "trackIndex",
    "progress", "trackDist", "powerTime", "powerCd", "powerCharge",
]
RAW_ACT = ["throttle", "steer", "handbrake", "power"]

# Track-relative observation vector produced here. Positive signs are
# documented in tools/dataset/README.md and are consistent with the game:
#   steer +1 = left, heading +1 = left, lat_offset +1 = right of centreline.
STATE_NAMES = [
    "speed",           # forward speed, m/s
    "lat_offset",      # signed distance from centreline, + = right, m
    "heading_error",   # car heading minus track heading, + = nose left, rad
    "yaw_rate",        # heading change per second, + = turning left, rad/s
    "steer_angle",     # front wheel angle, rad
    "slip",            # lateral speed magnitude, m/s
    "drifting",        # 0/1
    "on_road",         # 0/1
    "on_kerb",         # 0/1
    "ground_y",        # deck height, m (overpass)
    "progress",        # 0..1 around the lap
    "power_time",      # s of power left
    "power_cd",        # s of cooldown left
    "power_charge",    # drift charge
    "look_left_5m",    # road offset 5 m ahead in the car frame, + = left, m
    "look_left_10m",
    "look_left_20m",
    "look_left_40m",
    "curve_ahead_15m", # track heading change over the next 15 m, + = left, rad
]


def die(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr)
    raise SystemExit(2)


def wrap(a: float) -> float:
    return (a + math.pi) % (2.0 * math.pi) - math.pi


def load_runs(path: Path):
    header = None
    tracks: dict[str, dict] = {}
    episodes: dict[int, dict] = {}
    order: list[int] = []
    with path.open("r", encoding="utf-8") as f:
        for lineno, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError as e:
                die(f"{path}:{lineno}: invalid JSON ({e})")
            kind = rec.get("kind")
            if kind == "header":
                header = rec
            elif kind == "track":
                tracks[rec["id"]] = rec
            elif kind == "episode":
                idx = int(rec["index"])
                if idx in episodes:
                    die(f"{path}:{lineno}: duplicate episode index {idx}")
                ep = {
                    "id": rec.get("id"),
                    "index": idx,
                    "map": rec.get("map"),
                    "car": rec.get("car"),
                    "variant": rec.get("variant"),
                    "power": rec.get("power"),
                    "driver": rec.get("driver"),
                    "createdAt": rec.get("createdAt"),
                    "lapMs": rec.get("lapMs"),
                    "samples": rec.get("samples"),
                    "complete": bool(rec.get("complete")),
                    "rows": [],
                }
                episodes[idx] = ep
                order.append(idx)
            elif "e" in rec:
                idx = int(rec["e"])
                ep = episodes.get(idx)
                if ep is None:
                    die(f"{path}:{lineno}: step for unknown episode {idx}")
                o, a = rec.get("o"), rec.get("a")
                if not isinstance(o, list) or len(o) != len(RAW_OBS):
                    die(f"{path}:{lineno}: observation must have {len(RAW_OBS)} values")
                if not isinstance(a, list) or len(a) != len(RAW_ACT):
                    die(f"{path}:{lineno}: action must have {len(RAW_ACT)} values")
                ep["rows"].append((rec.get("s", len(ep["rows"])), o, a))
            # unknown kinds are ignored on purpose for forward compatibility

    if header is None:
        die("no header line; is this a sprite-drift export?")
    if int(header.get("fps", 0)) <= 0:
        die("header has no valid fps")
    if not order:
        die("no episodes in this file")
    return header, tracks, [episodes[i] for i in order]


class Track:
    def __init__(self, meta: dict):
        import numpy as np
        pts = np.asarray(meta["points"], dtype=np.float64)
        if pts.ndim != 2 or pts.shape[1] != 2 or len(pts) < 4:
            die(f"track {meta.get('id')}: need at least 4 [x,z] points")
        self.id = meta["id"]
        self.name = meta.get("name", meta["id"])
        self.road_half = float(meta.get("roadHalf", 4))
        self.start = meta.get("start", {})
        self.pts = pts
        self.n = len(pts)
        seg = np.roll(pts, -1, axis=0) - pts
        self.len = np.linalg.norm(seg, axis=1)
        self.len[self.len == 0] = 1e-9
        self.dir = seg / self.len[:, None]
        self.cum = np.concatenate([[0.0], np.cumsum(self.len)])
        self.total = float(self.cum[-1])

    def project(self, p, guess: int):
        import numpy as np
        best = (1e9, 0, 0.0)
        for k in range(-4, 5):
            i = (guess + k) % self.n
            a = self.pts[i]
            ab = self.dir[i] * self.len[i]
            t = float(np.clip(np.dot(p - a, ab) / (self.len[i] ** 2), 0.0, 1.0))
            c = a + ab * t
            d = float(np.linalg.norm(p - c))
            if d < best[0]:
                best = (d, i, t)
        d, i, t = best
        tangent = self.dir[i]
        right = np.array([tangent[1], -tangent[0]])
        lat = float(np.dot(p - (self.pts[i] + self.dir[i] * self.len[i] * t), right))
        s = float(self.cum[i] + t * self.len[i])
        return d, i, t, tangent, right, lat, s

    def point_at(self, s: float):
        import numpy as np
        s %= self.total
        i = int(np.searchsorted(self.cum, s, side="right") - 1)
        i = max(0, min(self.n - 1, i))
        t = (s - self.cum[i]) / self.len[i]
        t = min(1.0, max(0.0, t))
        return self.pts[i] + self.dir[i] * self.len[i] * t

    def heading_at(self, s: float) -> float:
        tx, tz = self.point_tangent(s)
        return math.atan2(-tx, -tz)

    def point_tangent(self, s: float):
        import numpy as np
        s %= self.total
        i = int(np.searchsorted(self.cum, s, side="right") - 1)
        i = max(0, min(self.n - 1, i))
        return float(self.dir[i][0]), float(self.dir[i][1])


def episode_arrays(ep: dict, track: Track, fps: int):
    import numpy as np
    rows = ep["rows"]
    raw = np.asarray([r[1] for r in rows], dtype=np.float64)
    act = np.asarray([r[2] for r in rows], dtype=np.float64)
    n = len(rows)
    state = np.zeros((n, len(STATE_NAMES)), dtype=np.float32)

    dt = 1.0 / fps
    prev_heading = None
    for k in range(n):
        x, z, heading, vx, vz = raw[k, 0], raw[k, 1], raw[k, 2], raw[k, 3], raw[k, 4]
        speed, slip, steer = raw[k, 5], raw[k, 6], raw[k, 7]
        ground, progress = raw[k, 8], raw[k, 14]
        ptime, pcd, pcharge = raw[k, 16], raw[k, 17], raw[k, 18]
        guess = int(round(raw[k, 13]))
        guess = max(0, min(track.n - 1, guess))
        dist, idx, t, tangent, right, lat, s = track.project((x, z), guess)
        heading_track = math.atan2(-tangent[0], -tangent[1])
        head_err = wrap(heading - heading_track)
        yaw = 0.0 if prev_heading is None else wrap(heading - prev_heading) / dt
        prev_heading = heading
        # left vector in the car frame; forward is (-sin h, -cos h)
        lx, lz = -math.cos(heading), math.sin(heading)
        looks = []
        for ahead in (5.0, 10.0, 20.0, 40.0):
            q = track.point_at(s + ahead)
            looks.append(float((q[0] - x) * lx + (q[1] - z) * lz))
        curve = wrap(track.heading_at(s + 15.0) - heading_track)
        state[k] = [
            speed, lat, head_err, yaw, steer, slip,
            raw[k, 10], raw[k, 11], raw[k, 12], ground, progress,
            ptime, pcd, pcharge, looks[0], looks[1], looks[2], looks[3], curve,
        ]
    return raw.astype(np.float32), act.astype(np.float32), state


def feature_stats(values):
    import numpy as np
    return {
        "mean": np.mean(values, axis=0).tolist(),
        "std": np.std(values, axis=0).tolist(),
        "min": np.min(values, axis=0).tolist(),
        "max": np.max(values, axis=0).tolist(),
        "count": int(values.shape[0]),
    }


def split_episodes(episodes, val_fraction: float):
    """Hash-ranked split, so it is stable as more runs are added and tiny
    datasets still leave at least one training lap."""
    ranked = sorted(episodes, key=lambda e: hashlib.sha1(str(e["id"]).encode()).hexdigest())
    n_val = int(round(len(ranked) * max(0.0, min(1.0, val_fraction))))
    if n_val >= len(ranked):
        n_val = max(0, len(ranked) - 1)
    val = [int(e["episode_index"]) for e in ranked[:n_val]]
    train = [int(e["episode_index"]) for e in ranked[n_val:]]
    return {"train": train, "val": val}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("runs", type=Path, help="JSONL file exported from the game")
    ap.add_argument("-o", "--out", type=Path, default=Path("dataset"), help="output directory")
    ap.add_argument("--val-fraction", type=float, default=0.15, help="episode-level validation share")
    ap.add_argument("--no-npz", action="store_true", help="skip per-episode npz files")
    ap.add_argument("--no-parquet", action="store_true", help="skip Parquet output (needs numpy only)")
    args = ap.parse_args()

    try:
        import numpy as np
    except ImportError:
        die("numpy is required: pip install numpy")
    try:
        import pyarrow as pa
        import pyarrow.parquet as pq
    except ImportError:
        pa = None
        if not args.no_parquet:
            die("pyarrow is required for Parquet: pip install pyarrow (or pass --no-parquet)")

    header, tracks_meta, episodes = load_runs(args.runs)
    fps = int(header["fps"])
    missing = sorted({ep["map"] for ep in episodes if ep["map"] not in tracks_meta})
    if missing:
        die(f"no track line for map(s): {', '.join(missing)}")

    tracks = {mid: Track(meta) for mid, meta in tracks_meta.items()}
    args.out.mkdir(parents=True, exist_ok=True)

    all_state, all_raw, all_act = [], [], []
    ep_rows = []
    npz_dir = args.out / "episodes"
    if not args.no_npz:
        npz_dir.mkdir(parents=True, exist_ok=True)

    global_index = 0
    for ep in episodes:
        track = tracks[ep["map"]]
        raw, act, state = episode_arrays(ep, track, fps)
        n = len(raw)
        if n == 0:
            print(f"skip episode {ep['index']}: no samples")
            continue
        all_state.append(state)
        all_raw.append(raw)
        all_act.append(act)
        ep_rows.append({
            "episode_index": len(ep_rows),
            "source_index": int(ep["index"]),
            "id": ep["id"],
            "map_id": ep["map"],
            "car": ep["car"],
            "power": ep["power"],
            "driver": ep["driver"],
            "complete": ep["complete"],
            "lap_ms": int(ep["lapMs"]) if ep["lapMs"] else None,
            "length": n,
            "dataset_from_index": global_index,
            "dataset_to_index": global_index + n,
            "created_at": ep["createdAt"],
        })
        if not args.no_npz:
            dst = npz_dir / f"ep{len(ep_rows) - 1:04d}.npz"
            np.savez_compressed(
                dst,
                state=state,
                raw=raw,
                action=act,
                timestamp=(np.arange(n) / fps).astype(np.float32),
                map_id=ep["map"],
                car=str(ep["car"]),
                power=str(ep["power"]),
                driver=str(ep["driver"]),
                lap_ms=int(ep["lapMs"]) if ep["lapMs"] else -1,
                complete=ep["complete"],
            )
        global_index += n

    if not ep_rows:
        die("no usable episodes")

    state = np.concatenate(all_state)
    raw = np.concatenate(all_raw)
    act = np.concatenate(all_act)
    total = len(state)
    maps = sorted({e["map_id"] for e in ep_rows})
    map_tasks = {m: i for i, m in enumerate(maps)}
    task_text = {0: ""}
    task_lines = []
    for m, i in map_tasks.items():
        t = f"Drive a clean lap of {tracks[m].name}"
        task_text[i] = t
        task_lines.append({"task_index": i, "task": t})
    task_index = np.asarray([map_tasks[e["map_id"]] for e in ep_rows for _ in range(e["length"])], dtype=np.int32)
    episode_index = np.asarray([i for i, e in enumerate(ep_rows) for _ in range(e["length"])], dtype=np.int32)
    frame_index = np.concatenate([np.arange(e["length"], dtype=np.int32) for e in ep_rows])
    timestamp = np.concatenate([np.arange(e["length"], dtype=np.float32) / fps for e in ep_rows])
    done = np.concatenate([
        np.arange(e["length"]) == e["length"] - 1 for e in ep_rows
    ])

    stats = {
        "observation.state": feature_stats(state),
        "observation.raw": feature_stats(raw),
        "action": feature_stats(act),
    }

    info = {
        "format": "sprite-drift/dataset@1",
        "source_schema": header.get("schema"),
        "fps": fps,
        "physics_hz": header.get("physicsHz", 120),
        "total_episodes": len(ep_rows),
        "total_frames": int(total),
        "observation.state.names": STATE_NAMES,
        "observation.raw.names": RAW_OBS,
        "action.names": {
            "steer": "float32 (-1..1, +1 = left)",
            "throttle": "float32 (-1..1)",
            "handbrake": "float32 (0/1)",
            "power": "float32 (0/1 activation pulse)",
        },
        "maps": [{"id": m, "name": tracks[m].name, "roadHalf": tracks[m].road_half} for m in maps],
        "tracks_file": "tracks.json",
        "notes": (
            "Numeric top-down observations at a fixed 60 Hz. One episode = one timed lap. "
            "lean on episode_index for splits; do not shuffle frames across laps."
        ),
    }

    if not args.no_parquet:
        ncol = state.shape[1]
        table = pa.table({
            "index": pa.array(np.arange(total, dtype=np.int64)),
            "episode_index": pa.array(episode_index),
            "frame_index": pa.array(frame_index),
            "timestamp": pa.array(timestamp),
            "task_index": pa.array(task_index),
            "map_id": pa.array([e["map_id"] for e in ep_rows for _ in range(e["length"])]),
            "done": pa.array(done),
            "observation.state": pa.FixedSizeListArray.from_arrays(
                pa.array(state.reshape(-1), type=pa.float32()), ncol),
            "observation.raw": pa.FixedSizeListArray.from_arrays(
                pa.array(raw.reshape(-1), type=pa.float32()), raw.shape[1]),
            "action.steer": pa.array(act[:, 1], type=pa.float32()),
            "action.throttle": pa.array(act[:, 0], type=pa.float32()),
            "action.handbrake": pa.array(act[:, 2], type=pa.float32()),
            "action.power": pa.array(act[:, 3], type=pa.float32()),
        })
        pq.write_table(table, args.out / "data.parquet", row_group_size=50_000)

        ep_table = pa.table({
            "episode_index": pa.array([e["episode_index"] for e in ep_rows], type=pa.int32()),
            "source_index": pa.array([e["source_index"] for e in ep_rows], type=pa.int32()),
            "id": pa.array([str(e["id"]) for e in ep_rows]),
            "map_id": pa.array([e["map_id"] for e in ep_rows]),
            "car": pa.array([str(e["car"]) for e in ep_rows]),
            "power": pa.array([str(e["power"]) for e in ep_rows]),
            "driver": pa.array([str(e["driver"]) for e in ep_rows]),
            "complete": pa.array([e["complete"] for e in ep_rows]),
            "lap_ms": pa.array([e["lap_ms"] for e in ep_rows], type=pa.int32()),
            "length": pa.array([e["length"] for e in ep_rows], type=pa.int32()),
            "dataset_from_index": pa.array([e["dataset_from_index"] for e in ep_rows], type=pa.int64()),
            "dataset_to_index": pa.array([e["dataset_to_index"] for e in ep_rows], type=pa.int64()),
        })
        pq.write_table(ep_table, args.out / "episodes.parquet")

    (args.out / "info.json").write_text(json.dumps(info, indent=2) + "\n")
    (args.out / "stats.json").write_text(json.dumps(stats, indent=2) + "\n")
    (args.out / "tasks.json").write_text(json.dumps(task_lines, indent=2) + "\n")
    (args.out / "episodes.json").write_text(json.dumps(ep_rows, indent=2) + "\n")
    (args.out / "splits.json").write_text(json.dumps(split_episodes(ep_rows, args.val_fraction), indent=2) + "\n")
    (args.out / "tracks.json").write_text(json.dumps({
        "maps": {
            m: {
                "name": tracks[m].name,
                "roadHalf": tracks[m].road_half,
                "start": tracks[m].start,
                "points": [[round(float(x), 3), round(float(z), 3)] for x, z in tracks[m].pts],
            } for m in maps
        }
    }, separators=(",", ":")) + "\n")

    print(f"wrote {args.out}")
    print(f"  episodes {len(ep_rows)}   frames {total}   fps {fps}")
    print(f"  maps {', '.join(maps)}")
    print(f"  state {state.shape[1]} features   raw {raw.shape[1]}   actions {act.shape[1]}")


if __name__ == "__main__":
    main()
