"""Extrude a drawn top view into clean slices: flat side panels, no outline on
the lower slices (an outline per slice becomes vertical stripes once stacked),
and the tyres carried down from the drawing.

  python tools/extrude_drawn.py top.png out.png --slices 12
"""
import argparse
import numpy as np
from PIL import Image

BODY_TOP = np.array([232, 224, 200], np.float32)
BODY_MID = np.array([196, 182, 150], np.float32)
BODY_LOW = np.array([128, 118, 96], np.float32)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("top")
    p.add_argument("out")
    p.add_argument("--slices", type=int, default=12)
    a = p.parse_args()

    top = np.array(Image.open(a.top).convert("RGBA"))
    h, w = top.shape[:2]
    mask = top[..., 3] > 8

    # tyre pixels: near-black or gold in the drawing
    rgb = top[..., :3].astype(int)
    dark = rgb.sum(-1) < 110
    gold = (rgb[..., 0] > 150) & (rgb[..., 1] > 120) & (rgb[..., 2] < 140)
    tyre = (dark | gold) & mask

    n = a.slices
    row = np.zeros((h, w * n, 4), np.uint8)
    for z in range(n):
        sl = np.zeros((h, w, 4), np.uint8)
        if z == n - 1:
            sl[mask] = top[mask]
        else:
            t = z / max(n - 2, 1)
            body = BODY_LOW * (1 - t) + BODY_TOP * t
            if t > 0.55:
                body = BODY_MID * (1 - (t - 0.55) / 0.45) + BODY_TOP * ((t - 0.55) / 0.45)
            sl[mask, :3] = body
            sl[mask, 3] = 255
            if z <= 3:
                sl[tyre] = top[tyre]
        row[:, z * w:(z + 1) * w] = sl

    Image.fromarray(row).save(a.out)
    print(f"{n} slices of {w}x{h} -> {a.out}")


if __name__ == "__main__":
    main()
