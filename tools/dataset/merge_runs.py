#!/usr/bin/env python3
"""Merge one or more Pixel Drift recorder exports into one JSONL file.

The game writes one JSONL per upload/session. The converter expects a single
file with one header and one line per step, so merge first:

  python3 merge_runs.py server/data/runs/**/*.jsonl -o runs-all.jsonl
  python3 convert_runs.py runs-all.jsonl -o dataset/

Episode indices are rewritten, tracks are de-duplicated by map id, and the
step lines are grouped under their new episode. Nothing is resampled.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


def load_header_fields(header: dict):
    return (
        header.get("schema"),
        header.get("fps"),
        tuple(header.get("obs") or ()),
        tuple(header.get("act") or ()),
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("runs", nargs="+", type=Path, help="recorder JSONL files")
    ap.add_argument("-o", "--out", type=Path, required=True, help="merged JSONL path")
    args = ap.parse_args()

    header = None
    header_fields = None
    tracks: dict[str, dict] = {}
    episodes: list[dict] = []
    steps: list[list[dict]] = []

    for path in args.runs:
        file_header = None
        file_eps: list[dict] = []
        by_old: dict[int, list[dict]] = {}
        with path.open("r", encoding="utf-8") as f:
            for lineno, line in enumerate(f, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError as e:
                    raise SystemExit(f"{path}:{lineno}: invalid JSON ({e})")
                kind = rec.get("kind")
                if kind == "header":
                    file_header = rec
                elif kind == "track":
                    tid = rec.get("id")
                    if not tid:
                        raise SystemExit(f"{path}:{lineno}: track without id")
                    if tid in tracks:
                        if tracks[tid].get("points") != rec.get("points"):
                            print(f"warning: {tid} geometry differs; keeping the first copy", file=sys.stderr)
                    else:
                        tracks[tid] = rec
                elif kind == "episode":
                    file_eps.append(rec)
                elif "e" in rec:
                    by_old.setdefault(int(rec["e"]), []).append(rec)

        if file_header is None:
            raise SystemExit(f"{path}: no header line")
        fields = load_header_fields(file_header)
        if header is None:
            header = file_header
            header_fields = fields
        elif fields != header_fields:
            raise SystemExit(f"{path}: header schema/fps/fields differ from the first file")

        for rec in file_eps:
            old = int(rec["index"])
            new = len(episodes)
            ep = dict(rec)
            ep["index"] = new
            episodes.append(ep)
            steps.append(by_old.pop(old, []))
        if by_old:
            extra = ", ".join(str(k) for k in sorted(by_old))
            print(f"warning: {path} has steps for missing episodes: {extra}", file=sys.stderr)

    if not episodes:
        raise SystemExit("no episodes to merge")

    header = dict(header)
    header["mergedAt"] = datetime.now(timezone.utc).isoformat()
    header["mergedFrom"] = [str(p) for p in args.runs]
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8") as f:
        f.write(json.dumps(header) + "\n")
        for t in tracks.values():
            f.write(json.dumps(t) + "\n")
        for ep in episodes:
            f.write(json.dumps(ep) + "\n")
        for i, rows in enumerate(steps):
            for rec in rows:
                rec = dict(rec)
                rec["e"] = i
                f.write(json.dumps(rec) + "\n")

    total_steps = sum(len(r) for r in steps)
    print(f"wrote {args.out}")
    print(f"  episodes {len(episodes)}   steps {total_steps}   tracks {len(tracks)}")


if __name__ == "__main__":
    main()
