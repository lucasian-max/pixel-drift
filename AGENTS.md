# Working rules for this repo

## Features ship to players straight away

The owner's standing directive: build it, verify it, push it public. Do not
hold features behind admin gates for review — that era is over.

1. **Ship public by default.** The feature system (`server/store.mjs`
   `FEATURES`, the db `features` map, served through `/api/me` and
   `/api/times`) is PUBLIC-friendly: a flag is on unless its value is
   explicitly `false`. `ghost` and `lapbar` are both live for everyone.
2. **Use a flag only as a kill-switch.** If something rolls out broken, flip
   that one flag off (`/api/admin/feature`, or the in-game admin panel) — and
   say so. URL kill-switches (`?ghost=0` etc.) stay available.
3. **Tell the owner what shipped, with a screenshot.** They should hear what
   players got from you, not from the players.

The owner is still the only admin (`server/data/admins.json`, `lucasian`);
admin powers (panel, dashboard) are theirs alone.

## Verification is not optional

Ship fast does not mean ship blind: typecheck, `npm test`, and a real
screenshot of anything visual before you push. Visuals are judged from the
render, not from rotation values or geometry math — a correct heading number
with an un-flipped model still renders backwards.
