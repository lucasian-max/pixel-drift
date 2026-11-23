"""Carve a car stack from a four-view sheet, with tyres guaranteed visible.

The AI's top view hides the wheels under the body, so the carve loses them.
This paints four tyres into the top view (and the front/back views stay as
drawn) before carving, so the stack has black wheels at the corners.

  python tools/car_stack.py sheet.png out.png --slices 15
"""
import argparse
import sys
import numpy as np
from PIL import Image

sys.path.insert(0, "tools")
import views_to_slices as V  # noqa: E402


def ellipse(h, w, cy, cx, ry, rx):
    yy, xx = np.mgrid[0:h, 0:w]
    return ((yy - cy) / ry) ** 2 + ((xx - cx) / rx) ** 2 <= 1.0


def main():
    p = argparse.ArgumentParser()
    p.add_argument("sheet")
    p.add_argument("out")
    p.add_argument("--shade", type=float, default=0.22)
    p.add_argument("--colours", type=int, default=32)
    p.add_argument("--side-nose", default="right")
    a = p.parse_args()

    sheet = np.array(Image.open(a.sheet).convert("RGBA"))
    views = V.find_views(sheet)
    top, side, front, back = views

    # pad the top view so wheels can stick out of the body
    pad = 3
    th, tw = top.shape[:2]
    canvas = np.zeros((th, tw + pad * 2, 4), np.uint8)
    canvas[:, pad:pad + tw] = top
    mask = canvas[..., 3] > 8
    ys, xs = np.nonzero(mask)
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    length = y1 - y0

    tyre = np.array([14, 14, 20, 255], np.uint8)
    hub = np.array([196, 170, 92, 255], np.uint8)
    outline = np.array([12, 10, 16, 255], np.uint8)
    ry = max(2.0, length * 0.055)
    rx = max(2.0, tw * 0.075)

    for ay in (y0 + length * 0.22, y0 + length * 0.78):
        for ax in (x0 - 1.0, x1 + 1.0):
            ring = ellipse(th, canvas.shape[1], ay, ax, ry + 0.6, rx + 0.6)
            wheel = ellipse(th, canvas.shape[1], ay, ax, ry, rx)
            canvas[ring] = outline
            canvas[wheel] = tyre
            canvas[ellipse(th, canvas.shape[1], ay, ax, ry * 0.4, rx * 0.4)] = hub

    vol = V.views_to_slices(
        None, "auto", a.side_nose, a.colours, a.shade, None,
        override=(canvas, side, front, back),
    )
    Image.fromarray(np.concatenate(list(vol), axis=1)).save(a.out)
    print(f"{len(vol)} slices of {vol.shape[2]}x{vol.shape[1]} -> {a.out}")


if __name__ == "__main__":
    main()
