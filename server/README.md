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

`ws` is already in the project's dev dependencies. On a deploy host, create a
`package.json` with `{ "type": "module", "dependencies": { "ws": "^8.23.0" } }`
next to `server/` and run `npm install --omit=dev` once.

The server does not touch the Vite dev server; start/stop them independently.
It flushes pending writes and exits cleanly on SIGINT/SIGTERM.

## Wire it into Vite

`vite.config.ts` already proxies `/api` to the deployed API and forwards the
WebSocket upgrade:

```ts
// vite.config.ts
proxy: { '/api': { target: 'https://api.lucasian.tech', changeOrigin: true, secure: true, ws: true } },
```

For a local API, start a second dev server with
`SPRITE_API=http://127.0.0.1:8790 npx vite --port 5182`.

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
| POST   | `/api/times`  | cookie | `{ms}` (`map` optional, default `"coast"`) | `200 {times}` after upsert, `401`, `400` ms out of range |
| POST   | `/api/rooms`  | —      | —                         | `200 {room, players}`, `429` too many rooms |
| GET    | `/api/ws?room=CODE` | cookie | —                  | WebSocket upgrade; `404` unknown code, `4005` room full |

## Rooms

`POST /api/rooms` returns a four-character code (alphabet excludes `I/O/0/1`).
Clients join `GET /api/ws?room=CODE`; the socket is a plain JSON protocol:

- client → server: `{t:'state',x,z,h,sp,u,lap}` at 20 Hz, `{t:'lap',ms,lap}`.
- server → client: `welcome`, `states` (20 Hz, up to 8 racers), `lap`, `left`.

The server owns slots, places, and best lap in the room. A lap counts only when
the client's reported progress added up to at least 0.85 of the circuit, the
clock is between 8.5 s and 10 min, and the lap number is sequential. See
[`docs/multiplayer.md`](../docs/multiplayer.md) for the full protocol.

Rooms are in memory and expire two hours after going empty. No room state is
written to `db.json`.

Notes:

- All `/api` responses send `Cache-Control: no-store`.
- JSON request bodies are capped at 4KB (`413` beyond that).
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
automatically (`Restart=always`) if it ever dies. Nothing is enabled or
started by this repo itself — that is up to you.
