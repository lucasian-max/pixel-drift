# sprite-drift API

Accounts, leaderboard and multiplayer rooms for the game. Uses Node built-ins
for HTTP and storage plus [`ws`](https://github.com/websockets/ws) for the
WebSocket upgrade — no framework.

- **Listen address:** `127.0.0.1:8790` (localhost only; it is never exposed
  directly — the Vite dev server proxies `/api` to it, and the Cloudflare
  tunnel fronts Vite).
- **Data:** `server/data/db.json` (created on first run, gitignored).
- **Log:** one line per request — `METHOD path STATUS ms`; room joins/leaves
  add `[room CODE] + name` lines.

## Run

```sh
node server/api.mjs        # or: npm run api
```

The live setup runs it as the `sprite-drift-api` systemd user service on this
machine; `sprite-drift-web` runs Vite on 5180. Both are enabled and linger is
on, so they survive a session logout.

`ws` is in the project's dev dependencies. If you deploy the API elsewhere,
create a `package.json` with
`{ "type": "module", "dependencies": { "ws": "^8.23.0" } }` next to `server/`
and run `npm install --omit=dev` once.

The server does not touch the Vite dev server; start/stop them independently.
It flushes pending writes and exits cleanly on SIGINT/SIGTERM.

## Wire it into Vite

`vite.config.ts` proxies `/api` to the local API and forwards the WebSocket
upgrade:

```ts
// vite.config.ts
proxy: { '/api': { target: 'http://127.0.0.1:8790', changeOrigin: true, ws: true } },
```

Point a dev server at another host with
`SPRITE_API=https://api.example.com npx vite --port 5182`.

With this in place, pages on `https://drift.lucasian.tech` can call
`fetch('/api/...')` and `new WebSocket('/api/ws')` same-origin, so no CORS
handling is needed anywhere.

## Endpoints

| Method | Path          | Auth   | Body                      | Response |
| ------ | ------------- | ------ | ------------------------- | -------- |
| POST   | `/api/signup` | —      | `{username, password}`    | `200 {user:{id,username}}` + session cookie, `409` username taken, `400` invalid input, `429` rate limited |
| POST   | `/api/login`  | —      | `{username, password}`    | `200 {user:{id,username}}` + session cookie, `401` `invalid username or password` |
| POST   | `/api/logout` | —      | —                         | `204`, clears the session cookie |
| GET    | `/api/me`     | cookie | —                         | `200 {user:{id,username}}` or `401` |
| GET    | `/api/times`  | —      | —                         | `200 {times:[{rank,username,ms,at}]}` top 10, ascending |
| POST   | `/api/times`  | cookie | `{ms, trace:[{x,z,t}]}` (`map` optional, default `"coast"`) | `200 {times}` after upsert, `400 invalid_lap`, `401`, `400 invalid_ms` |
| POST   | `/api/rooms`  | —      | —                         | `200 {room, players}`, `429` too many rooms |
| GET    | `/api/ws?room=CODE` | cookie | —                  | WebSocket upgrade; any valid code creates a room; `4005` room full |

## Rooms

`POST /api/rooms` returns a four-character code (alphabet excludes `I/O/0/1`),
but any valid code also creates a room on first join, so a shared URL is enough.

Client → server:

- `{t:'state',x,z,h,sp,u,lap}` at 20 Hz. The server **ignores `lap` and `u`**;
  progress comes from its own centreline lookup against `x,z`, and only a
  validated `lap` event advances the race.
- `{t:'lap',ms,lap}` on crossing.
- `{t:'start'}` starts the synchronized 3.6 s countdown for everyone.
- `{t:'reset'}` restarts this car, or the whole room after a finish.

Server → client: `welcome`, `states` (20 Hz, up to 8 racers, includes
`best`/`finished`/`winner`), `start`, `lap` (with `valid`, `reason`,
`bestLap`), `finish`, `rematch`, `left`.

A room race is first to three laps. The server finishes the race for everyone
when the first valid lap count reaches three, then broadcasts the standings.
`reset` after a finish starts a rematch for the room.

## Anti-cheat

- **Corridor:** every 20 Hz pose is checked against the coast centreline. More
  than 0.9 s outside the road + kerb corridor voids the lap.
- **Teleports:** a pose that jumps more than 12 units at an impossible speed
  voids the lap.
- **Authoritative laps:** the client's `lap` field is ignored; only validated
  `lap` events move the counter, so a modified client cannot declare itself
  finished.
- **Global board:** `POST /api/times` requires a 5 Hz trace. The server checks
  the corridor, speed, lap coverage, monotonic time and `ms`; a missing or
  grass-cutting trace is `400 invalid_lap`.
- **Client:** the game also tracks off-road time and the furthest point from
  the road, refuses to submit dirty laps, and shows `OFF TRACK` / `LAP NOT
  COUNTED` feedback.

This stops normal shortcuts and modified-client lap declarations. A determined
attacker can still fabricate an on-road trace through the HTTP API; making that
impossible needs cryptographic sampling or server-side simulation.

Notes:

- All `/api` responses send `Cache-Control: no-store`.
- JSON request bodies are capped at 32KB (`413` beyond that); lap traces need
  the headroom.
- Signup/login are rate limited: 10 attempts per IP per 60s, then `429`.
  The server prefers `X-Forwarded-For` when present (safe because it only
  binds to localhost); if you later enable Vite's `xfwd` proxy option, the
  limit becomes per-visitor instead of per-proxy.

## Accounts

- Usernames: 3–16 chars, `[a-z0-9_]`, lowercase, unique.
- Passwords: 8–200 chars, stored as scrypt (`N=16384, r=8, p=1`) + 16-byte
  random salt, hex-encoded, verified with `timingSafeEqual`.
- Sessions: 32 random bytes (hex) in a `sd_session` cookie —
  `HttpOnly; SameSite=Lax; Path=/`, 7-day expiry. Failed logins always
  return the same generic `invalid username or password`.

## Storage

`server/data/db.json`:

```json
{
  "users": [{ "id", "username", "salt", "hash", "createdAt" }],
  "sessions": { "<token>": { "userId", "expires" } },
  "times": [{ "userId", "username", "ms", "at", "map" }]
}
```

Writes are debounced (at most one per second) and atomic: dump to
`db.json.tmp`, then `rename()` over the real file. The db is loaded on boot;
expired sessions are pruned then. `server/data/` is gitignored.

Only each user's best (lowest) `ms` per map is kept — a slower submission
never replaces a better one. There is a single board, `coast`, but every
time entry carries a `map` field so more boards can be added later.

## Keep it running (systemd --user)

The unit file is `deploy/sprite-drift-api.service`. To install it:

```sh
mkdir -p ~/.config/systemd/user
ln -sf /home/lucasian/Work/sprite-drift/deploy/sprite-drift-api.service ~/.config/systemd/user/sprite-drift-api.service
systemctl --user daemon-reload
```

Then manage it with:

```sh
systemctl --user enable --now sprite-drift-api.service   # start on login
systemctl --user status  sprite-drift-api.service
systemctl --user restart sprite-drift-api.service
journalctl --user -u sprite-drift-api.service -f          # tail logs
```

The unit runs `node server/api.mjs` from the repo directory and restarts
automatically (`Restart=always`) if it ever dies.

The web server is the matching `deploy/sprite-drift-web.service`:

```sh
ln -sf /home/lucasian/Work/sprite-drift/deploy/sprite-drift-web.service ~/.config/systemd/user/sprite-drift-web.service
systemctl --user daemon-reload
systemctl --user enable --now sprite-drift-web.service
```

With `loginctl enable-linger "$USER"` both services survive a session logout.
The Cloudflare tunnel maps `drift.lucasian.tech` to Vite on `127.0.0.1:5180`.
