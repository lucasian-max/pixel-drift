"""Cut a drawn turntable sheet into N aligned direction frames.

  python tools/turntable.py sheet.png out.png --cols 4 --rows 2 --scale 0.22
"""
import argparse
import numpy as np
from PIL import Image


def main():
    p = argparse.ArgumentParser()
    p.add_argument("sheet")
    p.add_argument("out")
    p.add_argument("--cols", type=int, default=4)
    p.add_argument("--rows", type=int, default=2)
    p.add_argument("--scale", type=float, default=0.22)
    a = p.parse_args()

    src = Image.open(a.sheet).convert("RGB")
    w, h = src.size
    cw, ch = w // a.cols, h // a.rows

    cells = []
    for r in range(a.rows):
        for c in range(a.cols):
            cell = src.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch)).convert("RGBA")
            arr = np.array(cell).astype(int)
            # white background -> transparent
            white = (arr[..., 0] > 235) & (arr[..., 1] > 235) & (arr[..., 2] > 235)
            arr[..., 3] = np.where(white, 0, 255)
            cell = Image.fromarray(arr.astype(np.uint8))
            bbox = cell.getbbox()
            if bbox:
                cell = cell.crop(bbox)
            cells.append(cell)

    fw = max(c.width for c in cells) + 6
    fh = max(c.height for c in cells) + 6
    out = Image.new("RGBA", (fw * len(cells), fh), (0, 0, 0, 0))
    for i, cell in enumerate(cells):
        x = i * fw + (fw - cell.width) // 2
        y = fh - 3 - cell.height
        out.alpha_composite(cell, (x, y))

    if a.scale != 1.0:
        out = out.resize((max(1, int(out.width * a.scale)), max(1, int(out.height * a.scale))), Image.NEAREST)

    out.save(a.out)
    print(f"{len(cells)} frames of {out.width // len(cells)}x{out.height} -> {a.out}")


if __name__ == "__main__":
    main()
