"""Turn four flat views of an object (top, side, front, back) into sprite stacking slices.

  python views_to_slices.py car_views.png car_slices.png --shade 0.25

The sheet holds four drawings: the top view (the tallest), the side view (the widest), then the front and back in
reading order. The side view should face left (--side-nose right if it doesn't); the top view is turned to match it,
so its windows sit over the tallest part of the side view (or set --top-nose up or down yourself).
Writes one row of slices, the ground slice on the left, all the size of the top view.
"""
import argparse

import numpy as np
from PIL import Image


def find_views(sheet):
    """the drawings on the sheet, biggest first four, in reading order (rows, then left to right)"""
    solid = sheet[..., 3] >= 128
    grown = solid.copy()
    for _ in range(2):                                   # pixels 2 apart still count as one drawing
        g = grown.copy()
        g[1:] |= grown[:-1]; g[:-1] |= grown[1:]; g[:, 1:] |= grown[:, :-1]; g[:, :-1] |= grown[:, 1:]
        grown = g
    seen = np.zeros(solid.shape, bool)
    boxes = []
    for y0, x0 in zip(*np.nonzero(grown)):
        if seen[y0, x0]:
            continue
        stack, ys, xs = [(y0, x0)], [], []
        seen[y0, x0] = True
        while stack:
            y, x = stack.pop()
            ys.append(y); xs.append(x)
            for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= yy < solid.shape[0] and 0 <= xx < solid.shape[1] and grown[yy, xx] and not seen[yy, xx]:
                    seen[yy, xx] = True
                    stack.append((yy, xx))
        if len(ys) > 40:
            boxes.append((min(xs), min(ys), max(xs) + 1, max(ys) + 1))
    big = max((b[2] - b[0]) * (b[3] - b[1]) for b in boxes)
    boxes = [b for b in boxes if (b[2] - b[0]) * (b[3] - b[1]) >= 0.2 * big]      # drop labels and specks
    boxes.sort(key=lambda b: (round((b[1] + b[3]) / 2 / (sheet.shape[0] / 2.2)), b[0]))
    assert len(boxes) == 4, f"found {len(boxes)} drawings, expected top, side, front and back"
    views = []
    for x0, y0, x1, y1 in boxes:
        v = sheet[y0:y1, x0:x1].copy()
        ys, xs = np.nonzero(v[..., 3] >= 128)
        v = v[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        v[..., 3] = np.where(v[..., 3] >= 128, 255, 0)
        views.append(v)
    # the top view is the tallest drawing, the side view the widest; front and back keep reading order
    top = max(views, key=lambda v: v.shape[0] / v.shape[1])
    side = max((v for v in views if v is not top), key=lambda v: v.shape[1] / v.shape[0])
    return [top, side] + [v for v in views if v is not top and v is not side]


def strip_outline(v, dark=70):
    """a dark pixel on the edge of a drawing is its outline: give it the colour of the pixel inside it"""
    m = v[..., 3] > 0
    pad = np.pad(m, 1)
    edge = m & ~(pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:])
    line = edge & (v[..., :3].astype(int).sum(-1) / 3 < dark)
    out = v.copy()
    for y, x in zip(*np.nonzero(line)):
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            yy, xx = y + dy, x + dx
            if 0 <= yy < m.shape[0] and 0 <= xx < m.shape[1] and m[yy, xx] and not line[yy, xx]:
                out[y, x] = v[yy, xx]
                break
    return out


def one_palette(views, n):
    """map every view onto one shared palette of n colours, no dithering"""
    px = np.concatenate([v[v[..., 3] > 0][:, :3] for v in views])
    px = np.unique(px // 6 * 6 + 3, axis=0).astype(np.uint8)
    pal = Image.fromarray(px.reshape(1, -1, 3), "RGB").quantize(n, method=Image.MEDIANCUT, dither=Image.NONE)
    pal = np.array(pal.getpalette()[:n * 3]).reshape(-1, 3)
    out = []
    for v in views:
        q = v.copy()
        q[..., :3] = pal[((v[..., None, :3].astype(int) - pal[None, None]) ** 2).sum(-1).argmin(-1)]
        out.append(q)
    return out


def fit(v, w, h):
    return np.array(Image.fromarray(v).resize((w, h), Image.NEAREST))


def edge_colour(view, row, i):
    """a side view's colour at (row, i), pulled inside that row's drawn span"""
    xs = np.nonzero(view[row, :, 3])[0]
    return None if len(xs) == 0 else view[row, min(max(i, xs[0]), xs[-1]), :3]


def carve(top, side, front, back, shade=0.0):
    """top: (L, W). side: (H, L), column = y. front, back: (H, W). Row 0 of a side view is the top of the object.
    shade: how much darker the sides are than the tops, most at the ground (0 = no shading).
    Returns slices [z, y, x, rgba], z = 0 on the ground."""
    L, W = top.shape[:2]
    H = side.shape[0]
    occ = np.zeros((H, L, W), bool)
    for z in range(H):
        r = H - 1 - z
        along = side[r, :, 3] > 0                                    # over y
        across = (front[r, :, 3] > 0) | (back[r, :, 3] > 0)          # over x
        occ[z] = (top[..., 3] > 0) & along[:, None] & across[None, :]
    vol = np.zeros((H, L, W, 4), np.uint8)
    covered = np.zeros((L, W), bool)                                 # something higher in this column
    for z in range(H - 1, -1, -1):
        r = H - 1 - z
        above = covered.copy()
        covered |= occ[z]
        # distance from each cell to the open air, going -x, +x, -y, +y: the nearest one is the face it shows
        o = occ[z]
        ix = np.arange(W)[None, :].repeat(L, 0)
        iy = np.arange(L)[:, None].repeat(W, 1)
        d = np.stack([
            ix - np.maximum.accumulate(np.where(~o, ix, -1), axis=1),
            np.minimum.accumulate(np.where(~o, ix, W)[:, ::-1], axis=1)[:, ::-1] - ix,
            iy - np.maximum.accumulate(np.where(~o, iy, -1), axis=0),
            np.minimum.accumulate(np.where(~o, iy, L)[::-1], axis=0)[::-1] - iy,
        ])
        face, depth = d.argmin(0), d.min(0)
        for y, x in zip(*np.nonzero(o)):
            if not above[y, x]:
                c = top[y, x, :3]                                    # seen from above
            elif depth[y, x] > 2:                                    # under a higher part: carry its colour down,
                c = vol[z + 1, y, x, :3]                             # it shows as the face below that part's edge
            else:
                f = face[y, x]
                c = (edge_colour(side, r, y) if f < 2 else edge_colour(back, r, x) if f == 2
                     else edge_colour(front, r, x))
                if c is None:
                    c = top[y, x, :3]
            if above[y, x] and depth[y, x] <= 2 and shade:           # a side face: darker, more so near the ground
                c = (np.asarray(c, float) * (1 - shade * (1 - z / max(H - 1, 1)) - shade * 0.4)).clip(0, 255)
            vol[z, y, x] = (*np.asarray(c, np.uint8), 255)
    return vol


def match_top(top, side):
    """'down' or 'up': which way round the top view puts its windows over the tall part of the side view"""
    tall = (fit(side, side.shape[1], side.shape[0])[..., 3] > 0).sum(0)
    tall = np.interp(np.linspace(0, len(tall) - 1, top.shape[0]), np.arange(len(tall)), tall) >= 0.8 * tall.max()
    dark = ((top[..., :3].astype(int).sum(-1) < 240) & (top[..., 3] > 0)).mean(1)
    return "down" if (dark * tall).sum() >= (dark[::-1] * tall).sum() else "up"


def views_to_slices(sheet, top_nose="auto", side_nose="left", colours=24, shade=0.0):
    top, side, front, back = one_palette([strip_outline(v) for v in find_views(sheet)], colours)
    if side_nose == "left":
        side = side[:, ::-1]                                         # now column = y, front at the end
    if top_nose == "auto":
        top_nose = match_top(top, side)
    if top_nose == "up":
        top = top[::-1]
    L, W = top.shape[:2]
    H = round(side.shape[0] * L / side.shape[1])                     # height in px at the top view's scale
    return carve(top, fit(side, L, H), fit(front, W, H), fit(back, W, H), shade)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("sheet")
    p.add_argument("out")
    p.add_argument("--top-nose", choices=["auto", "up", "down"], default="auto")
    p.add_argument("--side-nose", choices=["left", "right"], default="left")
    p.add_argument("--colours", type=int, default=24)
    p.add_argument("--shade", type=float, default=0.0, help="darken the sides, 0.25 is a good start")
    a = p.parse_args()
    sheet = np.array(Image.open(a.sheet).convert("RGBA"))
    vol = views_to_slices(sheet, a.top_nose, a.side_nose, a.colours, a.shade)
    Image.fromarray(np.concatenate(list(vol), axis=1)).save(a.out)
    print(f"{len(vol)} slices of {vol.shape[2]} x {vol.shape[1]} px -> {a.out}")


if __name__ == "__main__":
    main()
