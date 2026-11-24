"""Turn a four-view pixel-art sheet into a sprite-stack car atlas.

  .venv-sprite/bin/python tools/four_view_car.py art/sheets/car.png art/build/car \
      --target-width 28 --side-nose left --flat e8b02c

Writes:
  <out>-row.png     horizontal slice strip, ground slice first
  <out>-atlas.png   vertical atlas for src/stack.ts SpriteStack (top slice first)

The sheet can have a white or transparent background. Views are expected as
top / side / front / back; side facing left or right (see --side-nose).
"""
import argparse
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, "tools")
import views_to_slices as V  # noqa: E402


def clean_background(img, threshold=250):
    a = np.array(img.convert("RGBA"))
    white = (a[..., 0] > threshold) & (a[..., 1] > threshold) & (a[..., 2] > threshold)
    a[..., 3] = np.where(white, 0, 255)
    return a


def fit(v, w, h):
    return np.array(Image.fromarray(v).resize((w, h), Image.NEAREST))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("sheet")
    p.add_argument("out")
    p.add_argument("--target-width", type=int, default=28)
    p.add_argument("--side-nose", choices=["left", "right"], default="left")
    p.add_argument("--colours", type=int, default=24)
    p.add_argument("--shade", type=float, default=0.18)
    p.add_argument("--flat", default="", help="hex RGB used to flatten livery on side faces")
    a = p.parse_args()

    sheet = clean_background(Image.open(a.sheet))
    views = V.find_views(sheet)
    top, side, front, back = views
    scale = a.target_width / top.shape[1]
    W = a.target_width
    L = max(8, round(top.shape[0] * scale))
    H = max(4, round(side.shape[0] * scale))

    top = fit(top, W, L)
    side = fit(side, L, H)
    front = fit(front, W, H)
    back = fit(back, W, H)

    flat = None
    if a.flat:
        s = a.flat.lstrip("#")
        flat = np.array([int(s[i:i + 2], 16) for i in (0, 2, 4)], np.uint8)

    slices = V.views_to_slices(
        None, "auto", a.side_nose, a.colours, a.shade, flat,
        override=(top, side, front, back),
    )
    row = np.concatenate(list(slices), axis=1)
    vertical = np.concatenate(list(slices)[::-1], axis=0)
    Image.fromarray(row).save(a.out + "-row.png")
    Image.fromarray(vertical).save(a.out + "-atlas.png")
    print(f"{len(slices)} slices of {W}x{L}x{H} -> {a.out}-row.png / {a.out}-atlas.png")


if __name__ == "__main__":
    main()
