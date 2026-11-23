"""Stack the hero car the way the Spritecook guide's car is built.

Sheet = one ROW, ground slice first, 15 slices of 24x43. The drawing
(tmp/opus-top-1x.png, 24x32) is stretched to 24x43 and rides on top.

  * slices 1..13 are the side wall: one flat fill per slice, cream #e8e0c8
    darkened toward the ground by SHADE, reaching full cream where the wall
    meets the drawing. No per-slice outline - stacked outlines read as
    vertical stripes.
  * slice 0 is a near-black ground shadow of the whole footprint.
  * four black tyre ellipses sit at the corners on slices 0..4, centred on
    the side wall so they protrude exactly 1px past the body, with a gold
    hub. The top slice carries the same wheels, so they read from above
    (the protrusion is never covered) and from the side (the band).
  * slices 10..12 carry a dark window band, 2px in from each side edge,
    only within the cabin (the rows where the drawing has windshield glass).
  * slice 14 is the drawing itself, outline included.
"""
import argparse
import numpy as np
from PIL import Image

W, L, SLICES = 24, 43, 15
BODY = np.array([232, 224, 200], np.float32)   # cream #e8e0c8
SHADOW = np.array([18, 16, 22], np.uint8)      # near-black ground shadow
TYRE = np.array([16, 16, 22], np.uint8)       # black tyre
HUB = np.array([198, 170, 92], np.uint8)       # gold hub
GLASS = np.array([20, 26, 38], np.uint8)       # matches the windshield glass
SHADE = 0.30                                   # wall darkening toward the ground
TYRE_Z = 5                                     # tyres live on slices 0..4
HUB_Z = 2                                      # hub cap on the side wall
WIN_Z0, WIN_Z1 = 10, 12                        # side-window band
AXLES = (0.176, 0.752)                         # axle rows as a fraction of length
TYRE_RX, TYRE_RY = 1.6, 2.8                    # 3px wide, ~6px long, 1px proud
HUB_RX, HUB_RY = 0.8, 1.0                      # 1x2 gold dot per wheel


def stack(art, shade):
    mask = art[..., 3] > 8

    ys, xs = np.nonzero(mask)
    y0, y1 = ys.min(), ys.max()
    length = y1 - y0

    def ellipse(cy, cx, ry, rx):
        yy, xx = np.mgrid[0:L, 0:W]
        return (((yy - cy) / ry) ** 2 + ((xx - cx) / rx) ** 2) <= 1.0

    # wheels: one axle line per end of the car, centred on the side wall
    # (the outline column), so each tyre sticks out exactly 1px past the body
    tyres = np.zeros((L, W), bool)
    hubs = np.zeros((L, W), bool)
    for frac in AXLES:
        cy = y0 + length * frac
        band = mask[int(cy - TYRE_RY):int(cy + TYRE_RY) + 1]
        bx = np.nonzero(band.any(axis=0))[0]
        for cx in (bx.min(), bx.max()):
            tyres |= ellipse(cy, cx, TYRE_RY, TYRE_RX)
            hubs |= ellipse(cy, cx, HUB_RY, HUB_RX)

    # the cabin is wherever the drawing's windshield glass sits
    glass_rows = np.nonzero(((art[..., :3] == GLASS).all(-1) & mask).any(axis=1))[0]
    windows = np.zeros((L, W), bool)
    for y in range(glass_rows.min(), glass_rows.max() + 1):
        row = np.nonzero(mask[y])[0]
        windows[y, row[0]:row[0] + 2] = True
        windows[y, row[-2]:row[-1] + 1] = True

    row = np.zeros((L, W * SLICES, 4), np.uint8)
    for z in range(SLICES):
        sl = np.zeros((L, W, 4), np.uint8)
        if z == SLICES - 1:
            sl[mask] = art[mask]                       # the drawing, outline included
            sl[tyres] = np.array([*TYRE, 255], np.uint8)
            sl[hubs] = np.array([*HUB, 255], np.uint8)
        elif z == 0:
            sl[mask | tyres] = np.array([*SHADOW, 255], np.uint8)
            sl[tyres] = np.array([*TYRE, 255], np.uint8)
        else:
            # flat fill, one shade step per slice, darkest just above the
            # shadow (z=1 -> 1-shade) and full cream at the top (z=13)
            k = 1.0 - shade * (SLICES - 2 - z) / (SLICES - 3)
            sl[mask] = np.array([*(BODY * k), 255], np.uint8)
            if z < TYRE_Z:
                sl[tyres] = np.array([*TYRE, 255], np.uint8)
                if z == HUB_Z:
                    sl[hubs] = np.array([*HUB, 255], np.uint8)
            if WIN_Z0 <= z <= WIN_Z1:
                sl[windows] = np.array([*GLASS, 255], np.uint8)
        row[:, z * W:(z + 1) * W] = sl
    return row


def main():
    p = argparse.ArgumentParser()
    p.add_argument("top")
    p.add_argument("out")
    p.add_argument("--shade", type=float, default=SHADE)
    a = p.parse_args()

    src = Image.open(a.top).convert("RGBA")
    art = np.array(src.resize((W, L), Image.NEAREST))
    Image.fromarray(stack(art, a.shade)).save(a.out)
    print(f"{SLICES} slices of {W}x{L} -> {a.out}")


if __name__ == "__main__":
    main()
