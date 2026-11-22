"""Bake a row slice sheet into N pre-rendered directions (the guide's approach).

Each frame rotates every slice on the ground, squashes it for the camera, then
lifts it one pixel per slice — exactly the draw order the guide specifies.
The game then just draws one sprite, so there is no per-frame stacking and no
depth fighting.

  python tools/bake_directions.py slices.png out.png --slices 17 --dirs 32
"""
import argparse
import math
import numpy as np
from PIL import Image


def main():
    p = argparse.ArgumentParser()
    p.add_argument("sheet")
    p.add_argument("out")
    p.add_argument("--slices", type=int, required=True)
    p.add_argument("--dirs", type=int, default=32)
    p.add_argument("--squash", type=float, default=0.75)
    a = p.parse_args()

    sheet = Image.open(a.sheet).convert("RGBA")
    w = sheet.width // a.slices
    h = sheet.height
    sl = [sheet.crop((i * w, 0, (i + 1) * w, h)) for i in range(a.slices)]

    fw = int(math.ceil(w * 1.45)) + 2
    fh = int(math.ceil(h * a.squash)) + a.slices + 4
    cx, cy = fw // 2, fh - a.slices - 2

    out = Image.new("RGBA", (fw * a.dirs, fh), (0, 0, 0, 0))
    for d in range(a.dirs):
        turn = d * 360.0 / a.dirs
        frame = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        for z in range(a.slices):
            piece = sl[z].rotate(turn, resample=Image.NEAREST, expand=True)
            sq = piece.resize((piece.width, max(1, int(round(piece.height * a.squash)))), Image.NEAREST)
            x = cx - sq.width // 2
            y = cy + sq.height // 2 - z - sq.height + 1
            frame.alpha_composite(sq, (x, y))
        out.paste(frame, (d * fw, 0))

    out.save(a.out)
    print(f"{a.dirs} directions, frame {fw}x{fh} -> {a.out}")


if __name__ == "__main__":
    main()
