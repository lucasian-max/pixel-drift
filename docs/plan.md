# Sprite Drift — work plan

Cadence per block: design note → implement in slices (one commit each) → verify three
states (parked / mid-corner / at speed) → failure cases → tests → docs.

## Done

- **Map detail pass** — town shifted into the infield, forested outside, kerbs,
  start gantry, sponsor boards down the main straight, turn boards at the sharp
  corners.
- **Block 3 — audio** — engine synth with gear bands, tyre squeal from slip,
  kerb rattle, gravel rumble, impact thud, and a chip loop ducked under the
  engine.
- **Accounts + leaderboard** — sign in, one best lap per player, top 10 board on
  the title screen and in the API.
- **Block 5 — multiplayer rooms** — room codes in the URL, 20 Hz WebSocket
  state, interpolated remote stacks, and server-side lap sanity. Design note:
  [docs/multiplayer.md](multiplayer.md).

## Next

- Room chip: show the room best and a lap-complete flash.
- Server checkpoint timestamps to tighten validation beyond accumulated `u`.
- Replays from the recorded pose stream.
- Chat / emotes in the room chip.

## Known gaps

- Room races are not server-authoritative; a determined client could still
  fake progress. The server catches instant laps, not a patient cheater.
- The live dev server must keep `ws: true` on the `/api` proxy for rooms.
