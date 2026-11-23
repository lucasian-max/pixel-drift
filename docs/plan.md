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

## Now: Block 5 — multiplayer rooms

Design note: [docs/multiplayer.md](multiplayer.md).

1. `POST /api/rooms` creates a four-character room code.
2. `WS /api/ws?room=CODE` joins; 20 Hz aggregate state at 8 racers.
3. Client interpolates remote stacks and draws a name tag.
4. Server-side lap sanity: accumulated progress, minimum lap time, lap order.
5. Room code lives in the URL and on the title screen, so a room is a link.

What could break: a tunnel/proxy that does not forward WebSocket upgrades;
rooms leaking memory (TTL cleanup); a client with a paused tab starving the
socket; lap timing drifting between clients (each client owns its own clock).

## Later

- Chat / emotes in the room chip.
- Server-side checkpoint timestamps to tighten validation beyond progress.
- Replays from the recorded pose stream.
