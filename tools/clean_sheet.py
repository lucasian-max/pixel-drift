"""Build a crisp sprite-stack sheet from one top-down drawing.

The four-view carve repeats the livery down every slice, which turns the car
into noise. This keeps the drawing for the top slice and builds a clean body
below it: flat panels, a hard outline, a dark underbody and real tyres that
stick out past the bodywork.

  python tools/clean_sheet.py top.png out.png --slices 12 --scale 2
"""
import argparse
import numpy as np
from PIL import Image

BODY_LIT = np.array([236, 227, 205], np.float32)
BODY = np.array([206, 195, 168], np.float32)
BODY_D = np.array([142, 131, 108], np.float32)
BODY_X = np.array([74, 68, 56], np.float32)
GLASS = np.array([38, 44, 58], np.float32)
OUTLINE = np.array([18, 16, 22], np.float32)
TYRE = np.array([16, 16, 22], np.float32)
HUB = np.array([198, 172, 92], np.float32)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("top")
    p.add_argument("out")
    p.add_argument("--slices", type=int, default=12)
    p.add_argument("--scale", type=int, default=2)
    a = p.parse_args()

    src = Image.open(a.top).convert("RGBA")
    if a.scale != 1:
        src = src.resize((src.width * a.scale, src.height * a.scale), Image.NEAREST)
    top = np.array(src)
    h, w = top.shape[:2]
    mask = top[..., 3] > 8

    ys, xs = np.nonzero(mask)
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    length = y1 - y0 + 1
    wheel_h = max(4, int(length * 0.13))
    wheel_w = max(4, int(w * 0.22))

    def box(cy, cx, hh, hw):
        yy, xx = np.mgrid[0:h, 0:w]
        return (np.abs(yy - cy) <= hh) & (np.abs(xx - cx) <= hw)

    wheels = np.zeros((h, w), bool)
    axles = [y0 + length * 0.22, y0 + length * 0.78]
    for ay in axles:
        for ax in (x0 - wheel_w * 0.35, x1 + wheel_w * 0.35):
            wheels |= box(ay, ax, wheel_h, wheel_w * 0.5)

    # silhouette edge, 1px
    pad = np.pad(mask, 1)
    edge = mask & ~(pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:])
    edge_w = wheels & ~(np.pad(wheels, 1)[:-2, 1:-1] & np.pad(wheels, 1)[2:, 1:-1]
                        & np.pad(wheels, 1)[1:-1, :-2] & np.pad(wheels, 1)[1:-1, 2:])

    n = a.slices
    row = np.zeros((h, w * n, 4), np.uint8)
    cabin_y0 = y0 + length * 0.30
    cabin_y1 = y0 + length * 0.72

    for z in range(n):
        sl = np.zeros((h, w, 4), np.uint8)
        if z == n - 1:
            sl[mask] = top[mask]
            sl[edge, :3] = OUTLINE
        else:
            t = z / max(n - 2, 1)
            body = BODY_X * (1 - t) + BODY * t
            if z == n - 2:
                body = BODY_LIT
            sl[mask, :3] = body
            sl[mask, 3] = 255
            # glass band on the flanks, where the cabin is
            if z >= n - 5 and z <= n - 2:
                band = mask & (np.mgrid[0:h, 0:w][0] > cabin_y0) & (np.mgrid[0:h, 0:w][0] < cabin_y1)
                sl[band, :3] = GLASS
            sl[edge, :3] = OUTLINE
            if z <= 2:
                sl[wheels & ~edge_w, :3] = TYRE
                sl[edge_w, :3] = OUTLINE
                if z == 1:
                    hub = np.zeros((h, w), bool)
                    for ay in axles:
                        for ax in (x0 - wheel_w * 0.35, x1 + wheel_w * 0.35):
                            hub |= box(ay, ax, wheel_h * 0.35, wheel_w * 0.22)
                    sl[hub & wheels, :3] = HUB
        row[:, z * w:(z + 1) * w] = sl

    Image.fromarray(row).save(a.out)
    print(f"{n} slices of {w}x{h} -> {a.out}")


if __name__ == "__main__":
    main()
