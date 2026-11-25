#!/usr/bin/env python3
"""Upload new Pixel Drift run files to a private Hugging Face dataset.

Config (first found wins):
  HF_TOKEN env var, or server/data/hf-token
  HF_DATASET env var, or server/data/hf-dataset
  default repo: <your-hf-username>/pixel-drift-runs

State lives in server/data/runs/.hf-uploaded.json. Only new files are
committed. The repo is forced private.

Run manually or let the pixel-drift-hf-sync.timer run it every minute.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNS = ROOT / "server" / "data" / "runs"
STATE = RUNS / ".hf-uploaded.json"
TOKEN_FILE = ROOT / "server" / "data" / "hf-token"
REPO_FILE = ROOT / "server" / "data" / "hf-dataset"
BATCH = 20

CARD = """---
license: other
tags:
  - reinforcement-learning
  - imitation-learning
  - driving
  - pixel-drift
---

# Pixel Drift — private run dataset

Raw gameplay telemetry from Pixel Drift. Each file under `raw/<player>/` is one
auto-uploaded episode (or a merged session), in the recorder's JSONL format:

- a `header` line with schema, fps, physicsHz, observation/action names
- one `track` line per circuit (centrelines, width, start pose)
- one `episode` line per lap with car, power, player, input device, launch and
  partial flags, lap time, per-episode stats and events
- one `step` line per sample: `e`, `s`, `o` (19 observation floats), `a` (4
  action floats)

Observations/actions are metres, radians, seconds; `steer +1 = left`; `power`
is a one-tick activation pulse. See the game's `tools/dataset/README.md` for the
full schema and the converter to Parquet/NPZ.

This dataset contains gameplay telemetry and usernames. It is private.
"""


def read_setting(env: str, file: Path) -> str | None:
    value = os.environ.get(env)
    if value:
        return value.strip()
    try:
        value = file.read_text(encoding="utf-8").strip()
        return value or None
    except FileNotFoundError:
        return None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--keep", action="store_true", help="keep local raw files after upload")
    args = ap.parse_args()

    try:
        from huggingface_hub import CommitOperationAdd, HfApi
    except ImportError:
        raise SystemExit(
            "huggingface_hub is missing. Run:\n"
            "  python3 -m venv server/.venv\n"
            "  server/.venv/bin/pip install huggingface_hub"
        )

    token = read_setting("HF_TOKEN", TOKEN_FILE)
    if not token:
        raise SystemExit(
            f"No Hugging Face token. Write a write-scope token to {TOKEN_FILE} or set HF_TOKEN."
        )

    api = HfApi(token=token)
    try:
        who = api.whoami()
        username = who.get("name") or who.get("user")
    except Exception as e:
        raise SystemExit(f"HF token rejected: {e}")

    repo = read_setting("HF_DATASET", REPO_FILE) or f"{username}/pixel-drift-runs"
    try:
        api.create_repo(repo, repo_type="dataset", private=True, exist_ok=True)
    except Exception as e:
        raise SystemExit(f"Could not create/open {repo}: {e}")

    # make sure an existing repo is private
    try:
        info = api.repo_info(repo, repo_type="dataset")
        if not getattr(info, "private", True):
            api.update_repo_settings(repo_id=repo, repo_type="dataset", private=True)
    except Exception:
        pass

    RUNS.mkdir(parents=True, exist_ok=True)
    try:
        state = json.loads(STATE.read_text(encoding="utf-8"))
    except Exception:
        state = {"repo": repo, "uploaded": []}
    uploaded = set(state.get("uploaded", []))
    if state.get("repo") != repo:
        uploaded = set()

    files = sorted(
        p for p in RUNS.glob("*/*.jsonl")
        if p.is_file() and p.name != "manifest.jsonl"
    )
    pending = [p for p in files if p.relative_to(RUNS).as_posix() not in uploaded]

    if not uploaded:
        try:
            api.create_commit(
                repo_id=repo,
                repo_type="dataset",
                operations=[CommitOperationAdd("README.md", io.BytesIO(CARD.encode("utf-8")))],
                commit_message="Add dataset card",
            )
            uploaded.add("__README__")
        except Exception as e:
            print(f"warning: dataset card upload failed: {e}", file=sys.stderr)

    if not pending:
        state = {"repo": repo, "uploaded": sorted(uploaded)}
        STATE.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
        print(f"{repo}: nothing new ({len(files)} files)")
        return

    sent = 0
    for start in range(0, len(pending), BATCH):
        batch = pending[start:start + BATCH]
        ops = [
            CommitOperationAdd(
                path_in_repo=f"raw/{p.relative_to(RUNS).as_posix()}",
                path_or_fileobj=str(p),
            )
            for p in batch
        ]
        try:
            api.create_commit(
                repo_id=repo,
                repo_type="dataset",
                operations=ops,
                commit_message=f"Add {len(ops)} Pixel Drift run file(s)",
            )
        except Exception as e:
            print(f"upload failed: {e}", file=sys.stderr)
            break
        for p in batch:
            uploaded.add(p.relative_to(RUNS).as_posix())
            if not args.keep:
                try:
                    p.unlink()
                except OSError:
                    pass
        sent += len(batch)
        state = {"repo": repo, "uploaded": sorted(uploaded)}
        STATE.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
        if not args.keep:
            for d in RUNS.iterdir():
                try:
                    if d.is_dir() and not any(d.iterdir()):
                        d.rmdir()
                except OSError:
                    pass

    print(f"{repo}: uploaded {sent}/{len(pending)} new file(s)" + (
        " and pruned local copies" if not args.keep else ""))


if __name__ == "__main__":
    main()
