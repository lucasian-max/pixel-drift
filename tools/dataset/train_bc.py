#!/usr/bin/env python3
"""Baseline behaviour cloning on a sprite-drift dataset.

Two models are provided:
  ridge  closed-form linear policy, numpy only, good sanity check
  mlp    small PyTorch network, predicts steer/throttle/handbrake/power

The point is not to win a race; it is to prove the recorded data is
learnable and to give you a starting script for a real policy (GRU /
transformer over observation windows, action chunks, etc.).

Usage:
  python3 train_bc.py dataset/                 # ridge baseline
  python3 train_bc.py dataset/ --model mlp     # needs torch

Inputs: data.parquet, splits.json, stats.json, info.json written by
convert_runs.py. Splits are by episode, never by frame.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def load(dataset: Path):
    import numpy as np
    import pyarrow.parquet as pq

    info = json.loads((dataset / "info.json").read_text())
    stats = json.loads((dataset / "stats.json").read_text())
    splits = json.loads((dataset / "splits.json").read_text())
    table = pq.read_table(
        dataset / "data.parquet",
        columns=["episode_index", "observation.state",
                 "action.steer", "action.throttle", "action.handbrake", "action.power"],
    ).to_pydict()

    state = np.asarray(table["observation.state"], dtype=np.float32)
    actions = np.stack([
        np.asarray(table["action.steer"], dtype=np.float32),
        np.asarray(table["action.throttle"], dtype=np.float32),
        np.asarray(table["action.handbrake"], dtype=np.float32),
        np.asarray(table["action.power"], dtype=np.float32),
    ], axis=1)
    episodes = np.asarray(table["episode_index"], dtype=np.int32)

    if not splits["train"]:
        raise SystemExit("no training episodes; use a lower --val-fraction when converting")
    train = np.isin(episodes, splits["train"])
    val = np.isin(episodes, splits["val"])
    if not val.any():
        val = train  # tiny datasets: report train fit rather than nothing

    mean = np.asarray(stats["observation.state"]["mean"], dtype=np.float32)
    std = np.asarray(stats["observation.state"]["std"], dtype=np.float32)
    std[std < 1e-6] = 1.0
    return info, state, actions, episodes, train, val, mean, std


def report(name: str, pred, target, keys=("steer", "throttle", "handbrake", "power")) -> None:
    import numpy as np
    err = pred - target
    mae = np.mean(np.abs(err), axis=0)
    rmse = np.sqrt(np.mean(err ** 2, axis=0))
    corr = []
    for i in range(target.shape[1]):
        a, b = pred[:, i], target[:, i]
        if np.std(a) < 1e-8 or np.std(b) < 1e-8:
            corr.append(float("nan"))
        else:
            corr.append(float(np.corrcoef(a, b)[0, 1]))
    print(f"\n{name}: {len(target)} frames")
    for i, key in enumerate(keys[:target.shape[1]]):
        c = f"{corr[i]:+.3f}" if corr[i] == corr[i] else "  n/a"
        print(f"  {key:10s} mae {mae[i]:.3f}   rmse {rmse[i]:.3f}   corr {c}")


def ridge(dataset: Path, out: Path, alpha: float) -> None:
    import numpy as np
    info, state, actions, _, train, val, mean, std = load(dataset)
    x = (state - mean) / std
    xb = np.concatenate([x, np.ones((len(x), 1), dtype=np.float32)], axis=1)
    y = actions[:, :2]

    xtx = xb[train].T @ xb[train] + alpha * np.eye(xb.shape[1], dtype=np.float32)
    w = np.linalg.solve(xtx, xb[train].T @ y[train])
    report("train", xb[train] @ w, y[train])
    if val is not train:
        report("val", xb[val] @ w, y[val])

    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez(out, weights=w, mean=mean, std=std,
             state_names=np.asarray(info["observation.state.names"]))
    print(f"\nsaved {out}")
    print("  steer = [state, 1] @ weights[:, 0] after (state - mean) / std")


def mlp(dataset: Path, out: Path, epochs: int, batch: int, lr: float) -> None:
    try:
        import torch
        import torch.nn as nn
    except ImportError:
        raise SystemExit("PyTorch is not installed: pip install torch")
    import numpy as np

    info, state, actions, _, train, val, mean, std = load(dataset)
    x = (state - mean) / std
    xt = torch.from_numpy(x)
    yt = torch.from_numpy(actions)
    tr = torch.from_numpy(np.flatnonzero(train))
    va = torch.from_numpy(np.flatnonzero(val))

    class Policy(nn.Module):
        def __init__(self, features: int):
            super().__init__()
            self.net = nn.Sequential(
                nn.Linear(features, 128), nn.ReLU(),
                nn.Linear(128, 128), nn.ReLU(),
                nn.Linear(128, 4),
            )

        def forward(self, x):
            return self.net(x)

    model = Policy(x.shape[1])
    opt = torch.optim.Adam(model.parameters(), lr=lr)
    lossf = nn.MSELoss()
    for epoch in range(1, epochs + 1):
        model.train()
        order = tr[torch.randperm(len(tr))]
        total = 0.0
        for i in range(0, len(order), batch):
            idx = order[i:i + batch]
            opt.zero_grad()
            loss = lossf(model(xt[idx]), yt[idx])
            loss.backward()
            opt.step()
            total += float(loss) * len(idx)
        if epoch == 1 or epoch % max(1, epochs // 5) == 0:
            model.eval()
            with torch.no_grad():
                pred = model(xt).numpy()
            vr = np.mean(np.abs(pred[va.numpy()] - actions[va.numpy()]))
            print(f"epoch {epoch:3d}  train mse {total / len(tr):.4f}  val mae {vr:.4f}")

    model.eval()
    with torch.no_grad():
        pred = model(xt).numpy()
    report("train", pred[train.numpy()], actions[train.numpy()])
    report("val", pred[va.numpy()], actions[va.numpy()])
    out.parent.mkdir(parents=True, exist_ok=True)
    torch.save({
        "state_dict": model.state_dict(),
        "features": x.shape[1],
        "mean": mean,
        "std": std,
        "state_names": info["observation.state.names"],
    }, out)
    print(f"\nsaved {out}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("dataset", type=Path)
    ap.add_argument("--model", choices=["ridge", "mlp"], default="ridge")
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--alpha", type=float, default=1.0)
    ap.add_argument("--epochs", type=int, default=20)
    ap.add_argument("--batch", type=int, default=256)
    ap.add_argument("--lr", type=float, default=1e-3)
    args = ap.parse_args()
    if args.out is None:
        args.out = args.dataset / ("policy_ridge.npz" if args.model == "ridge" else "policy_mlp.pt")
    if args.model == "ridge":
        ridge(args.dataset, args.out, args.alpha)
    else:
        mlp(args.dataset, args.out, args.epochs, args.batch, args.lr)


if __name__ == "__main__":
    main()
