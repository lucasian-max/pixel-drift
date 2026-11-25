# Comment policy — the 2024 purge and the ratchet

This repo keeps comments that pay rent and deletes the rest. This record
explains the categories used in the purge (PR "Comment purge"), so future
comments can be judged by the same rules, and introduces the
[`npm run lint:comments`](../package.json) ratchet that keeps the count from
creeping back up.

## Categories

Every comment was classified into one of three buckets.

**DELETE** — the comment restates what the code already says. Concretely:
- Pure section banners (`// ---- camera ----`, `/* ---- dashboard ---- */`):
  the discipline names and layout carry the structure.
- Docblocks that restate the field name (`/** signed-in account is an admin */`
  above `admin?: boolean`).
- Trailing narration (`// rebuilt every frame` on a cleared array,
  palette-name labels on hex constants).
- Stale history: the two `see ADR 004/005` pointers referenced documents that
  do not exist anywhere in the repo; the remaining claim of the surviving
  pointer is kept without the dead reference.

**CONVERT** — the information is real, but the shape was wrong. Concretely:
- Mis-placed notes moved onto the line they describe (the wheel-roll note in
  `src/carModel.ts` now sits on `wheels.push(...)`).
- Redundant piles collapsed (four overlapping comments on one marker in
  `src/wormFx.ts` became one).
- Blobs that restate a docblock in `//` form were tightened to one line
  (`pixelArrow`, `checkerEdge` in `src/pixelui.ts`).
- **Lies were rewritten, not deleted**: `src/main.ts` claimed the leaderboard
  "accepts the time as-is" with "no road/speed validation" — false since the
  anti-cheat landed; those comments now point at `server/anticheat.mjs`.
  A wrong figure in the anti-cheat's physics derivation (grass top speed is
  18.6 = 30 × 0.62, not 21.25) was corrected against `src/car.ts`.

**KEEP** — the comment holds information the code cannot hold:
- **Wire contracts**: the `e: 'blink'` lap-trace mark (`src/account.ts`,
  `server/anticheat.mjs`) that lets the server tell an aimed WORMHOLE
  placement from a forged teleport; `banner.name = 'gantryBanner'`, read by
  `src/main.ts` to hide the banner behind the title; the TUNNEL aim-mode
  flag trio on `UiState`/`Car` that freezes the sim.
- **Live game rules and physics numbers**: steering lock falloff, lateral
  grip, drift charge, the anti-cheat's derived caps (72 units/s =
  32 × 1.5 × 1.5) and its one-metre push-out slack — every constant whose
  name does not carry the number's story.
- **Sculpture labels**: `// A-pillar`, `// mudflap`, `// hull` — in the car
  model files and on the world's yachts these are the only names on raw
  `box()`/`beam()` coordinates.
- **Reviewing rationale**: ducked music buses, burn-time on unknown-user
  logins (timing-oracle defence), atomic writes, cache-busting asset
  versions — the "why" that git blame can't answer without archaeology.

The judged line in each case: does the adjacent code already name the thing?
If it does (`const cannon = ...` before snow cannons), the comment is
narration and dies; if the code is numbers or names that can't carry the
meaning (a torus with two materials), the comment is the name and stays.

## The ratchet

- `scripts/comment-scan.mjs` — string-aware scanner (comments inside strings,
  template literals and regexes don't count); lists the tracked files.
- `scripts/comment-census.mjs` — ad-hoc counts for a path.
- `scripts/comment-ratchet.mjs` — enforces `scripts/comment-ratchet.json`:
  a per-file ceiling. New comments over the ceiling fail
  `npm run lint:comments`; a deliberate purge runs
  `npm run lint:comments -- --update` to lower the ceiling. Never hand-edit
  the snapshot upward — add a KEEP-worthy comment only when you can defend
  it under the categories above.
- CI (`.github/workflows/ci.yml`) runs build, tests and the ratchet on every
  push.

## Result

The purge removed 150 comment items (712 → 562 across the tracked set):
`src/pixelui.ts` 67 → 7, `src/world.ts` 95 → 27, plus banner purges in
`src/main.ts`, `src/wormFx.ts` and the server. No behavior changed: with
comments stripped, every edited file is byte-identical to `master`.
