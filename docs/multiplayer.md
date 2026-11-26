# Multiplayer rooms — ARCHIVED

> **Not in the shipped build.** Online rooms are mothballed; solo racing and
> the leaderboard are the active game. This document describes the archived
> implementation, preserved on the `multiplayer` branch and the
> `multiplayer-archive` tag. To recover it:
>
> ```sh
> git checkout multiplayer
> # or inspect without switching:
> git show multiplayer-archive:src/net.ts
> ```
>
> Re-enabling means restoring the client entry point, room UI, WebSocket
> transport in the API, and the `ws` dependency. The solo leaderboard's lap
> checks live in `server/anticheat.mjs` against `server/track-data.json`.

Casual same-circuit racing. A room is a four-character code in the URL
(`?room=FNXZ`); the title screen showed it so the link could be shared.

## Topology

```
browser ──HTTP /api/rooms──►  local API (node, 127.0.0.1:8790)
browser ──WS  /api/ws?room──►  local API          lobby + poses + laps
```

- Vite proxies `/api` (including the WebSocket upgrade) to the API.
- The API and web server run as `sprite-drift-api` / `sprite-drift-web`
  systemd user services; Cloudflare tunnels `drift.lucasian.tech` to Vite.
- Rooms live in memory for two hours after the last client leaves. No database.
- Up to 8 racers per room. Eight is the grid size the client staggers for.
- Any valid code creates a room on first join, so a shared URL is enough.

## Protocol

Client → server:

| Message | Fields | When |
| --- | --- | --- |
| `start` | — | PLAY is pressed; starts the room countdown |
| `state` | `x, z, h, sp, u` | 20 Hz while racing |
| `lap` | `ms, lap` | once per crossing |
| `reset` | — | R: restart this car, or the room after a finish |

`u` in a state is ignored. The server computes lap progress from the reported
`x,z` against its own centreline, so a modified client cannot fake progress by
sending a rising `u` while parked.

Server → client:

| Message | Fields |
| --- | --- |
| `welcome` | `id, name, slot, room, count, racers[], best, finished, winner, startIn, racing, laps` |
| `start` | `ms` (3600) |
| `states` | `racers[]` (`id, name, slot, place, x, z, h, sp, u, lap, best`), `count, best, finished, winner, laps` |
| `lap` | `id, name, ms, valid, reason, lap, best, bestLap` |
| `finish` | `winner, standings[], laps` |
| `rematch` | `laps` |
| `left` | `id, name, count` |

The server broadcasts one aggregate `states` frame at 20 Hz. Remote cars are
smoothed on the client (`1 - exp(-11 dt)`), so a 50 ms gap reads as motion, not
teleporting.

## Race flow

1. A player presses PLAY/START. The first `start` sets a 3.6 s countdown and
   broadcasts `start` to every socket; all clients reset to the grid and run
   the same countdown.
2. Each client simulates its own car and sends a 20 Hz pose. The server tracks
   slots, places, the authoritative lap count, best laps and finish.
3. The first racer to three **valid** laps sets `finished`; everyone sees
   `finish` and the results card.
4. Any player presses R to reset; after a finish this rematches the room for
   everyone (reset to the grid, new countdown).

A late joiner gets `startIn`/`racing` in `welcome` and syncs to the countdown
or starts immediately if the race is already underway.

## Anti-cheat

Lap validation has two layers:

**Route (server):**

1. Every 20 Hz pose is checked against the coast centreline. More than 0.6 s
   outside road + kerb marks the lap `off_track`.
2. A pose that jumps more than 12 units at an impossible speed marks the lap
   `dirty` (teleport / cut).
3. Progress accumulates from `u` deltas; wrap-around counts forward, jumps over
   0.08 are dropped. A lap needs ≥ 0.85.
4. `ms` must be 12 s–10 min; a valid event increments the server's own lap
   count, so the client's lap number can never skip or declare a finish.
5. The state's `lap` field is ignored; a client cannot declare itself finished.

Invalid laps broadcast `valid:false` with `reason` (`off_track`,
`invalid_progress`, `invalid_time`) and reset the progress window.

**Global leaderboard (HTTP):**

`POST /api/times` requires a 5 Hz trace. The server rejects (`400 invalid_lap`)
if any sample leaves the corridor, the implied speed is impossible, the trace
does not span the claimed `ms`, or progress does not cover the circuit. Missing
traces are rejected.

**Client feedback:**

The game records its own off-road time and furthest distance, refuses to
submit dirty laps, and shows `OFF TRACK — LAP WON'T COUNT` and
`LAP NOT COUNTED — OFF TRACK`.

## Failure cases

- **API down:** socket closes, the HUD chip turns red, the client keeps racing
  solo and retries every 1.8 s. The leaderboard shows `OFFLINE`.
- **Room full:** the upgrade handler closes with code 4005.
- **Invalid room code:** the client keeps retrying with `CONNECTING…`; use the
  four-character alphabet (no `I/O/0/1`).
- **Duplicate tab:** each connection gets its own id and grid slot.
- **Tab hidden:** the socket stays open but the render loop pauses; the last
  pose freezes for others and resumes on focus.
- **Reset (R):** the local car returns to its grid slot and the server resets
  that car's progress. After a finish it rematches everyone.

## Why not server-authoritative physics

The car is a 120 Hz arcade model tuned for feel, not determinism. Simulating it
twice (client for feel, server for truth) would require reconciling drift and
steering latency with no gain for a casual room. The server owns the roster,
grid, countdown, authoritative lap count and route checks; clients own their
own car pose. A determined attacker can still fabricate an on-road trace
through the HTTP API; the route checks stop shortcut driving and ordinary
modified clients, not a bespoke replay forgery.
