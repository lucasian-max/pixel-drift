# Multiplayer rooms

Casual same-circuit racing. A room is a four-character code in the URL
(`?room=WUAP`); the title screen shows it so the link can be shared.

## Topology

```
browser  ──HTTP /api/rooms──►  api host (node)      create a code
browser  ──WS  /api/ws?room──► api host            lobby + poses + lap events
```

- The API stays on the same host as the leaderboard; Vite proxies `/api`
  (including the WebSocket upgrade) in dev, Cloudflare tunnels it in production.
- Rooms live in memory for two hours after the last client leaves. No database.
- Up to 8 racers per room. Eight is the grid size the client staggers for.

## Protocol

Client → server:

| Message | Fields | Rate |
| --- | --- | --- |
| `state` | `x, z, h, sp, u, lap` | 20 Hz while racing |
| `lap` | `ms, lap` | once per crossing |

`u` is lap progress in `[0,1)` from the client's nearest-track lookup; the
server only uses it to validate that the car went round.

Server → client:

| Message | Fields |
| --- | --- |
| `welcome` | `id, name, slot, room, count, racers[], best` |
| `states` | `racers[]` (`id, name, slot, place, x, z, h, sp, u, lap`), `count, best` |
| `lap` | `id, name, ms, valid, lap, best` |
| `left` | `id, count` |

The server broadcasts one aggregate `states` frame at 20 Hz. Remote cars are
smoothed on the client (`1 - exp(-11 dt)`), so a 50 ms gap reads as motion, not
teleporting.

## Lap validation

The client still owns its physics, so the server checks the cheap invariants
that catch an instant-lap cheat:

1. Progress accumulates from reported `u` deltas; wrap-around from `~0.99` to
   `~0.01` counts forward, jumps over 0.08 are dropped.
2. A lap needs accumulated progress ≥ 0.85.
3. `ms` must be between 8.5 s and 10 min.
4. The lap number must be exactly the last accepted lap + 1.

Invalid laps are broadcast with `valid: false` and do not enter the room best.
The global leaderboard is still the signed-in player's own submission, so a
room race does not bypass the account API.

## Failure cases

- **Server down / tunnel down:** socket closes, the HUD chip turns red, the
  client keeps racing solo and retries every 1.8 s.
- **Room full:** the upgrade handler closes with code 4005; the client's normal
  retry treats it as unavailable.
- **Unknown room code:** the upgrade is rejected with 404 before a socket is
  accepted.
- **Duplicate tab:** each connection gets its own id and grid slot.
- **Tab hidden:** the socket stays open but the render loop pauses, so the
  car's last pose freezes for other racers and resumes on focus.
- **Reset (R):** the local car returns to its grid slot; the server sees the
  jump and does not count it as lap progress.

## Why not server-authoritative physics

The car is a 120 Hz arcade model tuned for feel, not determinism. Simulating it
twice (client for feel, server for truth) would require reconciling drift and
steering latency with no gain for a casual room. The server therefore owns the
roster, grid, timing rules and lap sanity, and clients own their own car.
