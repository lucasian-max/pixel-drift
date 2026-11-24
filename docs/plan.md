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
  state, interpolated remote stacks, synchronized countdown, first-to-3
  finish and room rematch. Design note: [docs/multiplayer.md](multiplayer.md).
- **Anti-cheat + resilience** — server-authoritative lap count, road-corridor
  checks from pose telemetry, trace-checked leaderboard submissions, and local
  systemd services for the API and web server.

## Next

- Room chip: show the room best and a lap-complete flash.
- A second circuit/board once the map set returns.
- Replays from the recorded pose stream.
- Chat / emotes in the room chip.

## Known gaps

- Room physics is client-side; the server validates route, speed and lap order
  but does not re-simulate the car. A fabricated on-road HTTP trace can still
  beat the leaderboard, though not by cutting the grass.
- The nest host that used to serve `api.lucasian.tech` is unreachable; the game
  now uses the local API. `SPRITE_API` points a dev server elsewhere.
