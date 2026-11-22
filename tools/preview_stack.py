"""Composite a row slice sheet the way the game does, for eyeballing.

  python tools/preview_stack.py slices.png out.png [--slices 17] [--squash 0.75] [--scale 8]
"""
import argparse
import numpy as np
from PIL import Image


def main():
    p = argparse.ArgumentParser()
    p.add_argument("sheet")
    p.add_argument("out")
    p.add_argument("--slices", type=int, required=True)
    p.add_argument("--squash", type=float, default=0.75)
    p.add_argument("--scale", type=int, default=8)
    a = p.parse_args()

    im = np.array(Image.open(a.sheet).convert("RGBA")).astype(np.float32)
    h, w = im.shape[:2]
    sw = w // a.slices
    S = a.scale
    sh = int(round(h * a.squash))
    out = np.zeros(((sh + a.slices + 2) * S, sw * S, 4), np.float32)

    for z in range(a.slices):
        sl = im[:, z * sw:(z + 1) * sw]
        # squash each slice vertically (nearest)
        ys = (np.arange(sh) / a.squash).astype(int).clip(0, h - 1)
        sq = sl[ys]
        dy = (a.slices - 1 - z) * S
        for y in range(sh):
            for x in range(sw):
                px = sq[y, x]
                if px[3] < 8:
                    continue
                y0 = dy + y * S
                x0 = x * S
                a_ = px[3] / 255.0
                dst = out[y0:y0 + S, x0:x0 + S]
                da = dst[..., 3] / 255.0
                oa = a_ + da * (1 - a_)
                for c in range(3):
                    dst[..., c] = (px[c] * a_ + dst[..., c] * da * (1 - a_)) / np.maximum(oa, 1e-6)
                dst[..., 3] = oa * 255

    img = Image.fromarray(out.clip(0, 255).astype(np.uint8))
    bg = Image.new("RGBA", img.size, (63, 107, 63, 255))
    Image.alpha_composite(bg, img).save(a.out)
    print("wrote", a.out, img.size)


if __name__ == "__main__":
    main()
