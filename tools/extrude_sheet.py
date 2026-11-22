"""Build a clean sprite-stack sheet from one top-down car drawing.

The carve from four views gives realistic side faces but repeats the livery down
the stack, which reads as stripes. This extrudes the top view instead: the skirt
is a flat body colour, the wheels are explicit black blocks at the four corners,
and only the top slice carries the artwork.

  python tools/extrude_sheet.py top.png out.png --slices 15
"""
import argparse
import numpy as np
from PIL import Image

BODY = np.array([232, 224, 200], np.float32)
BODY_D = np.array([150, 138, 110], np.float32)
DARK = np.array([26, 26, 34], np.float32)
TYRE = np.array([18, 18, 24], np.float32)
HUB = np.array([214, 186, 96], np.float32)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("top")
    p.add_argument("out")
    p.add_argument("--slices", type=int, default=15)
    p.add_argument("--wheel-rows", type=int, default=4)
    a = p.parse_args()

    src = np.array(Image.open(a.top).convert("RGBA"))
    sh, sw = src.shape[:2]
    pad = 3
    h, w = sh, sw + pad * 2
    top = np.zeros((h, w, 4), np.uint8)
    top[:, pad:pad + sw] = src
    mask = top[..., 3] > 8

    n = a.slices
    row = np.zeros((h, w * n, 4), np.uint8)

    # wheel boxes: two axles, at the outer edges of the body
    ys, xs = np.nonzero(mask)
    y0, y1 = ys.min(), ys.max()
    x0, x1 = xs.min(), xs.max()
    th = y1 - y0

    def wheel_at(cy, cx, r=2.4):
        yy, xx = np.mgrid[0:h, 0:w]
        return ((yy - cy) ** 2 + (xx - cx) ** 2) <= r * r

    axles = [y0 + th * 0.24, y0 + th * 0.76]
    wheels = np.zeros((h, w), bool)
    for ay in axles:
        for ax in (x0 - 1.0, x1 + 1.0):
            wheels |= wheel_at(ay, ax)

    # silhouette edge (1px) for a dark outline
    pad = np.pad(mask, 1)
    edge = mask & ~(pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:])

    for z in range(n):
        sl = np.zeros((h, w, 4), np.uint8)
        if z == n - 1:
            sl[mask] = top[mask]
        else:
            t = z / max(n - 2, 1)
            body = BODY * (1 - t) + BODY_D * t
            sl[mask, :3] = body
            sl[mask, 3] = 255
            sl[edge, :3] = DARK
            if z < a.wheel_rows:
                sl[wheels & ~edge, :3] = TYRE
                sl[wheels & edge, :3] = TYRE * 0.6
                # hub on the lowest slice
                if z == 0:
                    hub = np.zeros((h, w), bool)
                    for ay in axles:
                        for ax in (x0 - 1.0, x1 + 1.0):
                            hub |= wheel_at(ay, ax, 0.9)
                    sl[hub & wheels, :3] = HUB
        row[:, z * w:(z + 1) * w] = sl

    Image.fromarray(row).save(a.out)
    print(f"{n} slices of {w}x{h} -> {a.out}")


if __name__ == "__main__":
    main()
