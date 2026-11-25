# Run data for imitation learning

The game records every timed lap and can export it as a dataset. This folder
turns raw runs into a columnar dataset and a baseline policy.

```
record in game  →  pixel-drift-runs-*.jsonl  →  convert_runs.py  →  dataset/
                                                                    data.parquet
                                                                    episodes.parquet
                                                                    episodes/*.npz
                                                                    info.json / stats.json
                                                                    splits.json / tracks.json
```

## Quick start

1. Play. **Recording is on by default and is invisible in the HUD** — no
   badge, no hint, no count. `V` toggles it and `X` downloads every run stored
   on this device; both only print to the developer console. Nothing about
   recording appears on screen.
2. Convert:

   ```bash
   pip install numpy pyarrow          # only for the converter
   python3 tools/dataset/convert_runs.py ~/Downloads/pixel-drift-runs-*.jsonl -o dataset/
   ```

   Uploads from the admin panel land in `server/data/runs/*/*.jsonl`; merge
   them into one file first:

   ```bash
   python3 tools/dataset/merge_runs.py server/data/runs/*/*.jsonl -o runs-all.jsonl
   ```

3. Sanity-check with the numpy-only ridge baseline:

   ```bash
   python3 tools/dataset/train_bc.py dataset/
   ```

4. Train a real policy (small MLP baseline; swap in a GRU/transformer later):

   ```bash
   pip install torch
   python3 tools/dataset/train_bc.py dataset/ --model mlp --epochs 20
   ```

Runs live in IndexedDB (`pixel-drift-runs`), survive reloads and are never
sent anywhere. `X` exports **all** stored laps across maps and cars in one
file. `game.recorder.clear()` in the console wipes them.

## Why this format

The recording is numeric state/action data, not video, so the useful
precedent is the tabular half of robot imitation-learning datasets:

- **LeRobotDataset v3** stores low-dimensional, high-frequency state and
  action streams in **Apache Parquet**, with JSON metadata that declares
  feature names, dtypes/shapes, fps, episode boundaries and normalisation
  stats. Video is only added for camera observations.
  <https://huggingface.co/docs/lerobot/en/lerobot-dataset-v3>
- **Parquet** is columnar and compressed: loading only `observation.state`
  and `action.steer` does not read the other columns, it memory-maps cleanly
  and it is what `datasets`, pandas and pyarrow expect.
- **One episode = one lap**, with `episode_index`, `frame_index` and
  `timestamp`, exactly like LeRobot. Splits must be by episode, not by frame,
  or the validation set leaks.
- **Raw export stays JSONL** because it is append-only, inspectable, and
  trivially parsed by any language. It is a transport format, not the
  training format. JSONL per step also survives a mid-lap export.

We do not write MP4 because there is no camera stream. We do not use CSV
because it loses types and is ~3-5x larger. We do not emit a custom binary
blob because you would have to write a reader before you could look at your
own data.

`data.parquet` follows LeRobot's tabular conventions (`index`,
`episode_index`, `frame_index`, `timestamp`, `observation.state`,
`action.*`), so adapting it to `LeRobotDataset` later is a metadata job, not
a rewrite.

## Raw JSONL schema (`pixel-drift/runs@1`)

One JSON object per line:

| `kind` | Contents |
| --- | --- |
| `header` | schema, `fps`, `physicsHz`, `obs`/`act` field names, units |
| `track` | map id/name, `roadHalf`, start pose, centreline `points: [[x,z],…]` |
| `episode` | id, index, map, car, variant, power, driver, player, input, launch, `lapMs`, sample count, complete, per-episode stats, event list |
| step | `e` episode index, `s` step index, `o` observation array, `a` action array |

Everything is in metres, radians and seconds. `steer` is `+1 = left`.
`power` is a one-tick activation pulse (pressed this tick), not a held button.

The first episode after PLAY begins **before** the start line, so it includes
the standing launch; it is marked `launch: true`. Events (`impact`, `power`,
`reset`) carry a step/time and, for impacts, strength and position. Per-episode
stats include off-track seconds, impacts, power uses and reset count. Record at
120 Hz with `?rec=120` if you need physics-step fidelity.

Run files are browser-local until the admin uses **UPLOAD RUNS** (or a player
exports with `X`). Uploads are stored under `server/data/runs/<player>/` and
indexed in `manifest.jsonl`; nothing is uploaded silently.

### Observation (`o`, 19 floats, 60 Hz)

| # | Name | Meaning |
| ---: | --- | --- |
| 0–1 | `x`, `z` | world position |
| 2 | `heading` | yaw; forward is `(-sin h, -cos h)` |
| 3–4 | `vx`, `vz` | world velocity |
| 5 | `speed` | forward speed, m/s |
| 6 | `slip` | lateral speed magnitude, m/s |
| 7 | `steerAngle` | front wheel angle, rad |
| 8 | `groundY` | deck height (overpass), m |
| 9 | `pitch` | ramp pitch, rad |
| 10–12 | `drifting`, `onRoad`, `onKerb` | 0/1 |
| 13 | `trackIndex` | nearest centreline point index |
| 14 | `progress` | 0..1 around the lap from the start line |
| 15 | `trackDist` | distance to the nearest centreline point, m |
| 16–18 | `powerTime`, `powerCd`, `powerCharge` | power state |

### Action (`a`, 4 floats)

`throttle` (-1..1, negative brakes/reverses), `steer` (-1..1, +1 left),
`handbrake` (0/1), `power` (0/1 activation pulse).

A sample is taken every 1/60 s from the fixed 120 Hz physics loop, so the
spacing is exact and the run is deterministic. At 60 Hz one minute of driving
is 3,600 rows.

## Converted dataset

`observation.state` is a **track-relative** vector. Absolute world coordinates
are useful for replays but a bad policy input: the same corner appears at
different `x,z` on every map and a model can memorise positions instead of
learning to drive.

| # | Name | Meaning |
| ---: | --- | --- |
| 0 | `speed` | forward speed, m/s |
| 1 | `lat_offset` | signed distance from centreline, **+ = right**, m |
| 2 | `heading_error` | car heading − track heading, **+ = nose left**, rad |
| 3 | `yaw_rate` | `d(heading)/dt`, **+ = turning left**, rad/s |
| 4 | `steer_angle` | front wheel angle, rad |
| 5 | `slip` | lateral speed, m/s |
| 6–8 | `drifting`, `on_road`, `on_kerb` | 0/1 |
| 9 | `ground_y` | overpass height, m |
| 10 | `progress` | 0..1 around the lap |
| 11–13 | `power_time`, `power_cd`, `power_charge` | power state |
| 14–17 | `look_left_5m/10m/20m/40m` | road centre offset ahead in the **car** frame, **+ = road is to the left**, m |
| 18 | `curve_ahead_15m` | track heading change over the next 15 m, **+ = left-hand corner**, rad |

The raw 19-value vector is preserved as `observation.raw`, so you can build a
different feature set without re-recording.

`action.steer`, `action.throttle`, `action.handbrake`, `action.power` are
separate float columns.

Other columns: `index`, `episode_index`, `frame_index`, `timestamp`,
`task_index` (one task text per map), `map_id`, `done`.

`episodes.parquet` has per-lap boundaries (`dataset_from_index`,
`dataset_to_index`), length, map/car/power, `lap_ms` and `complete` (a reset
mid-lap writes an incomplete episode; filter it out for behaviour cloning).

`stats.json` holds mean/std/min/max for normalisation. `splits.json` is a
stable hash-ranked split by episode, with at least one training lap.

## Training notes

- **Filter** to `complete = true` and `driver = 'human'` once you have human
  laps; the recorder also labels demo/autopilot laps.
- **Split by episode.** A lap is highly correlated with itself.
- Normalise with `stats.json`, then predict `steer` and `throttle` first.
  Handbrake and power are sparse binary events; add them as auxiliary heads or
  a separate classifier rather than regressing them with the same weight.
- **Sequence models** (GRU/TCN, 8–32 frame windows) beat a per-frame MLP
  because steering depends on what is coming, not only the current state. The
  lookahead features already encode some of that.
- **Mirror augmentation** is cheap once you use the track-relative state:
  negate `lat_offset`, `heading_error`, `yaw_rate`, `steer_angle`, the four
  `look_left_*`, `curve_ahead_15m`, and negate the steer action. Leave speed,
  throttle, flags and power alone. Do not mirror the raw `x,z,heading` view.
- **Action chunks** (predict the next 8–16 actions) tend to remove the
  twitchiness of single-frame cloning.
- **Condition on car/map** if you mix them: car variant changes grip and
  power; map changes layout. Either add one-hot inputs or train per car.
- An hour of driving is ~216k frames; a few hours is a reasonable start for a
  small BC policy on 19 features.

## Files

| File | Purpose |
| --- | --- |
| `convert_runs.py` | JSONL → Parquet + NPZ + metadata |
| `train_bc.py` | ridge baseline and optional torch MLP |
