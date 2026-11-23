#!/usr/bin/env python3
"""Build a 15-slice sprite-stacking sheet from a 24x32 top-down car drawing.

Guide numbers: 15 slices, 1px lift, squash 0.75 applied by the renderer
(NOT baked into the sheet). Sheet = one row, ground slice first.
"""
import os
import numpy as np
from PIL import Image

SRC = "tmp/opus-top-1x.png"
DST = "tmp/opus-slices.png"
W, H = 24, 43
N_SLICES = 15
TOP = N_SLICES - 1          # slice 14: the drawing with outline
WALL_SHADE = 0.30           # darkening toward the ground
WINDOW_SLICES = range(9, 13)
TYRE_SLICES = range(0, 5)
HUB_SLICES = range(1, 4)

SHADOW = np.array([18, 16, 22, 255], np.uint8)
TYRE = np.array([14, 14, 16, 255], np.uint8)
HUB = np.array([214, 172, 58, 255], np.uint8)
WINDOW = np.array([26, 30, 44, 255], np.uint8)
DARK_LUM = 90


def lum(rgb):
    rgb = rgb.astype(np.float32)
    return 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]


def main():
    src = Image.open(SRC).convert("RGBA")
    img = np.array(src.resize((W, H), Image.NEAREST))
    mask = img[..., 3] > 0
    if not mask.any():
        raise SystemExit("input drawing is empty")

    # ---- outline ring = silhouette pixels touching transparency / border
    pad = np.pad(mask, 1, constant_values=False)
    inner = (pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:])
    ring = mask & ~inner
    interior = mask & inner

    L = lum(img[..., :3])
    dark = L < DARK_LUM

    # ---- body colour = most common bright interior colour
    cand = img[interior & ~dark][:, :3]
    if len(cand) == 0:
        cand = img[mask][:, :3]
    cols, counts = np.unique(cand, axis=0, return_counts=True)
    body = np.append(cols[counts.argmax()], 255).astype(np.uint8)

    # ---- wall colour map: drawing without outline and without dark detail
    wall = img.copy()
    for y, x in zip(*np.nonzero(ring)):
        found = None
        for r in (1, 2, 3):
            ys = slice(max(0, y - r), min(H, y + r + 1))
            xs = slice(max(0, x - r), min(W, x + r + 1))
            ok = interior[ys, xs] & ~dark[ys, xs]
            if ok.any():
                sub = img[ys, xs][ok]
                found = sub[0]
                break
        wall[y, x] = found if found is not None else body
    wall_dark = (lum(wall[..., :3]) < DARK_LUM) & mask
    wall[wall_dark] = body
    wall[~mask] = 0
    wall[mask, 3] = 255

    # ---- per-row silhouette edges
    rows = np.nonzero(mask.any(axis=1))[0]
    y0, y1 = rows.min(), rows.max()
    left = np.full(H, -1)
    right = np.full(H, -1)
    for y in rows:
        xs = np.nonzero(mask[y])[0]
        left[y], right[y] = xs.min(), xs.max()

    # ---- cabin rows from the drawing's dark interior pixels
    dark_rows = (interior & dark).sum(axis=1) >= 2
    best, cur, start = (0, -1, -1), 0, 0
    for y in range(H):
        if dark_rows[y]:
            if cur == 0:
                start = y
            cur += 1
            if cur > best[0]:
                best = (cur, start, y)
        else:
            cur = 0
    if best[0] == 0:
        span = y1 - y0
        cab0, cab1 = y0 + int(span * 0.35), y0 + int(span * 0.65)
    else:
        cab0, cab1 = best[1], best[2]

    # ---- tyres: ellipses centred ON the silhouette edge (protrude 1px)
    span = y1 - y0
    axles = [y0 + int(round(span * 0.20)), y0 + int(round(span * 0.80))]
    tyres = []  # (cx, cy)
    for ay in axles:
        ay = int(np.clip(ay, y0, y1))
        if left[ay] < 0:
            near = rows[np.abs(rows - ay).argmin()]
            ay = int(near)
        lx = max(int(left[ay]), 1)
        rx = min(int(right[ay]), W - 2)
        tyres += [(lx, ay), (rx, ay)]
    RX, RY = 1.6, 3.6

    def paint_tyres(s, hub):
        for cx, cy in tyres:
            for dy in range(-4, 5):
                for dx in range(-2, 3):
                    if (dx / RX) ** 2 + (dy / RY) ** 2 <= 1.0:
                        x, y = cx + dx, cy + dy
                        if 0 <= x < W and 0 <= y < H:
                            s[y, x] = TYRE
            if hub:
                for dy in (-1, 0, 1):
                    y = cy + dy
                    if 0 <= y < H and (dy == 0 or True):
                        if dy == 0 or abs(dy) <= 1:
                            s[y, cx] = HUB if dy == 0 else s[y, cx]
                s[cy, cx] = HUB

    slices = []
    for i in range(N_SLICES):
        s = np.zeros((H, W, 4), np.uint8)
        if i == TOP:
            s[:] = img
            paint_tyres(s, hub=True)
        elif i == 0:
            s[mask] = SHADOW
            paint_tyres(s, hub=False)
        else:
            f = 1.0 - WALL_SHADE * (13 - i) / 13.0   # 0.70 near ground -> 1.0 at 13
            shaded = np.clip(wall[..., :3].astype(np.float32) * f, 0, 255)
            s[..., :3] = shaded.astype(np.uint8)
            s[..., 3] = np.where(mask, 255, 0)
            s[~mask] = 0
            if i in WINDOW_SLICES:
                # dark window band on the flanks, 2px deep from each flank,
                # cabin rows only
                for y in range(cab0, cab1 + 1):
                    if left[y] < 0:
                        continue
                    a, b = int(left[y]), int(right[y])
                    for x in (a, a + 1, b - 1, b):
                        if a <= x <= b:
                            s[y, x] = WINDOW
            if i in TYRE_SLICES:
                paint_tyres(s, hub=(i in HUB_SLICES))
        slices.append(s)

    sheet = np.concatenate(slices, axis=1)
    os.makedirs(os.path.dirname(DST) or ".", exist_ok=True)
    Image.fromarray(sheet, "RGBA").save(DST)

    print(f"cabin rows: {cab0}..{cab1}, tyres at {tyres}")
    print(f"{len(slices)} slices, {W}x{H} each, sheet {sheet.shape[1]}x{sheet.shape[0]} -> {DST}")
    print("renderer: lift 1px per slice, squash 0.75 (not baked into sheet)")


if __name__ == "__main__":
    main()
