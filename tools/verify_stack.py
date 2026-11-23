"""Verify the hero-car slice sheet by measuring it, not by looking.

  python tools/verify_stack.py tmp/opus-top-1x.png tmp/opus-slices.png

Checks, per the stack spec:
  (a) 15 slices, each 24x43, ground slice first;
  (b) opaque pixel count per slice decreases then stabilises
      (the tyre protrusion lives on the bottom slices only);
  (c) tyre pixels exist on the bottom slices outside the body silhouette;
  (d) no slice is empty.
Plus: flat single-colour wall slices with a monotone cream ramp that tops out
at exactly #e8e0c8, a near-black ground slice, the window band only on
slices 10..12 inside the cabin rows, and gold hubs on the wall and the top.
"""
import sys
import numpy as np
from PIL import Image

W, L, SLICES = 24, 43, 15
BODY = np.array([232, 224, 200])
GLASS = np.array([20, 26, 38])
TYRE = np.array([16, 16, 22])
HUB = np.array([198, 170, 92])

failures = []


def check(ok, msg):
    print(f"  {'ok  ' if ok else 'FAIL'} {msg}")
    if not ok:
        failures.append(msg)


def main():
    top, sheet = sys.argv[1], sys.argv[2]
    art = np.array(Image.open(top).convert("RGBA").resize((W, L), Image.NEAREST))
    mask = art[..., 3] > 8
    a = np.array(Image.open(sheet).convert("RGBA"))

    print(f"(a) sheet geometry")
    check(a.shape[:2] == (L, W * SLICES), f"sheet is {W * SLICES}x{L} (15 x 24x43)")

    sl = [a[:, z * W:(z + 1) * W] for z in range(SLICES)]
    counts = [int((s[..., 3] > 8).sum()) for s in sl]

    print(f"(b) opaque count per slice: {counts}")
    check(all(c == counts[0] for c in counts[:5]), "slices 0..4 share a footprint (body + tyres)")
    check(all(c == counts[5] for c in counts[5:14]), "slices 5..13 share the body silhouette")
    check(counts[5] < counts[0], "count decreases once the tyre protrusion ends (then stabilises)")
    check(counts[14] >= counts[0], "top slice carries the drawing plus the tyre protrusion")

    print(f"(c) tyres outside the body silhouette, slices 0..4")
    for z in range(5):
        s = sl[z]
        op = s[..., 3] > 8
        tyre_out = op & ~mask & (np.abs(s[..., :3].astype(int) - TYRE).sum(-1) < 12)
        check(int(tyre_out.sum()) >= 12, f"slice {z}: {int(tyre_out.sum())} tyre px outside the body")

    print(f"(d) no empty slice")
    check(all(c > 0 for c in counts), "every slice has opaque pixels")

    print(f"(e) wall: flat fills, monotone cream ramp")
    ramp = []
    for z in range(5, 14):
        s = sl[z]
        op = s[..., 3] > 8
        glass = np.abs(s[..., :3].astype(int) - GLASS).sum(-1) < 12
        u = np.unique(s[op & ~glass][:, :3].reshape(-1, 3), axis=0)
        check(len(u) == 1, f"slice {z}: flat fill {tuple(int(v) for v in u[0])}" if len(u) == 1
              else f"slice {z}: {len(u)} wall colours (outline stripes?)")
        ramp.append(u[0] if len(u) == 1 else None)
    ok_ramp = all(ramp[i] is not None and ramp[i - 1] is not None and
                  ramp[i][0] >= ramp[i - 1][0] for i in range(1, len(ramp)))
    check(ok_ramp, "ramp lightens monotonically toward slice 13")
    check(ramp[-1] is not None and tuple(ramp[-1]) == tuple(BODY),
          f"slice 13 is full cream {tuple(int(v) for v in BODY)} (seamless with the drawing)")

    print(f"(f) bottom slice is a near-black ground shadow")
    s = sl[0]
    op = s[..., 3] > 8
    lum = s[..., :3].astype(int).sum(-1)
    check(bool((lum[op] < 120).all()), f"slice 0 max channel-sum {int(lum[op].max())} (near-black)")

    print(f"(g) side windows: dark band on slices 10..12 only, inside the cabin")
    glass_rows = np.nonzero(((art[..., :3] == GLASS).all(-1) & mask).any(axis=1))[0]
    wy0, wy1 = int(glass_rows.min()), int(glass_rows.max())
    print(f"      cabin rows in the drawing: y {wy0}..{wy1}")
    for z in range(1, 14):
        s = sl[z]
        g = (s[..., 3] > 8) & (np.abs(s[..., :3].astype(int) - GLASS).sum(-1) < 12)
        n = int(g.sum())
        if 10 <= z <= 12:
            ys = np.nonzero(g.any(axis=1))[0]
            inside = bool(len(ys)) and ys.min() >= wy0 and ys.max() <= wy1
            check(n > 0 and inside, f"slice {z}: {n} glass px within cabin rows")
        else:
            check(n == 0, f"slice {z}: no window glass")

    print(f"(h) gold hubs, wall + top")
    for z, want in ((2, 8), (14, 8)):
        s = sl[z]
        h = (s[..., 3] > 8) & (np.abs(s[..., :3].astype(int) - HUB).sum(-1) < 12)
        check(int(h.sum()) >= want, f"slice {z}: {int(h.sum())} gold hub px")
    s = sl[14]
    t = (s[..., 3] > 8) & ~mask & (np.abs(s[..., :3].astype(int) - TYRE).sum(-1) < 12)
    check(int(t.sum()) >= 12, f"slice 14: {int(t.sum())} tyre px outside the body (visible from above)")

    print(f"\n{'ALL CHECKS PASS' if not failures else f'{len(failures)} FAILURES'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
