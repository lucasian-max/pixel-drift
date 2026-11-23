"""The guide's recipe, exactly, for one design.

Sheet = one ROW, ground slice first, 15 slices of 24x43. Every slice is the
same silhouette; only the top slice carries the art. Each slice is drawn 1px
above the previous one, so the visible depth is (slices-1) px of side wall.
Sides darken toward the ground (the guide's `shade`), and the tyres sit on the
bottom slices, proud of the body, so they read from above.
"""
import argparse
import numpy as np
from PIL import Image

W, L, SLICES = 24, 43, 15
BODY = np.array([232, 224, 200], np.float32)
DARK = np.array([18, 16, 22], np.float32)
TYRE = np.array([16, 16, 22], np.float32)
HUB = np.array([198, 170, 92], np.float32)
SHADE = 0.32


def main():
    p = argparse.ArgumentParser()
    p.add_argument("top")
    p.add_argument("out")
    p.add_argument("--shade", type=float, default=SHADE)
    a = p.parse_args()

    src = Image.open(a.top).convert("RGBA")
    top = np.array(src.resize((W, L), Image.NEAREST))
    mask = top[..., 3] > 8

    ys, xs = np.nonzero(mask)
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    length = y1 - y0

    def wheel(cy, cx, ry=2.6, rx=1.9):
        yy, xx = np.mgrid[0:L, 0:W]
        return (((yy - cy) / ry) ** 2 + ((xx - cx) / rx) ** 2) <= 1.0

    wheels = np.zeros((L, W), bool)
    hubs = np.zeros((L, W), bool)
    for ay in (y0 + length * 0.24, y0 + length * 0.76):
        for ax in (x0 - 0.4, x1 + 0.4):
            wheels |= wheel(ay, ax)
            hubs |= wheel(ay, ax, 0.9, 0.7)

    # the tyres are part of the silhouette so they survive every slice
    silhouette = mask | wheels

    row = np.zeros((L, W * SLICES, 4), np.uint8)
    for z in range(SLICES):
        sl = np.zeros((L, W, 4), np.uint8)
        if z == SLICES - 1:
            sl[mask] = top[mask]
            sl[wheels & ~mask] = np.array([*TYRE, 255], np.uint8)
            sl[hubs] = np.array([*HUB, 255], np.uint8)
        else:
            # guide's shade: darker as it approaches the ground
            k = 1.0 - a.shade * (1.0 - z / (SLICES - 1)) - a.shade * 0.4
            body = BODY * max(0.25, k)
            sl[mask, :3] = body
            sl[mask, 3] = 255
            if z == 0:
                sl[mask, :3] = body * 0.45
            if z <= 4:
                sl[wheels] = np.array([*TYRE, 255], np.uint8)
                if z == 1:
                    sl[hubs] = np.array([*HUB, 255], np.uint8)
        row[:, z * W:(z + 1) * W] = sl

    Image.fromarray(row).save(a.out)
    print(f"{SLICES} slices of {W}x{L} -> {a.out}")


if __name__ == "__main__":
    main()
