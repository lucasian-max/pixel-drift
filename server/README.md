# sprite-drift API

Accounts and the solo leaderboard for the game. Dependency-free Node HTTP
(`node:http`, `node:crypto`, `node:fs`).

- **Listen address:** `127.0.0.1:8790` (localhost only; Vite proxies `/api` to
  it, and the Cloudflare tunnel fronts Vite).
- **Data:** `server/data/db.json` (created on first run, gitignored).
- **Log:** one line per request — `METHOD path STATUS ms`.

Multiplayer rooms and their WebSocket transport are **archived**, not part of
this build. The complete implementation is on the `multiplayer` branch and the
`multiplayer-archive` tag; see [docs/multiplayer.md](../docs/multiplayer.md).

## Run

```sh
node server/api.mjs        # or: npm run api
```

The live setup runs it as the `sprite-drift-api` systemd user service on this
machine; `sprite-drift-web` runs Vite on 5180. Both are enabled and linger is
on, so they survive a session logout.

The server does not touch the Vite dev server; start/stop them independently.
It flushes pending writes and exits cleanly on SIGINT/SIGTERM.

## Wire it into Vite

`vite.config.ts` proxies `/api` to the local API:

```ts
// vite.config.ts
proxy: { '/api': { target: 'http://127.0.0.1:8790', changeOrigin: true } },
```

Point a dev server at another host with
`SPRITE_API=https://api.example.com npx vite --port 5182`.

With this in place, pages on `https://drift.lucasian.tech` can call
`fetch('/api/...')` same-origin, so no CORS handling is needed anywhere.

## Endpoints

| Method | Path          | Auth   | Body                      | Response |
| ------ | ------------- | ------ | ------------------------- | -------- |
| POST   | `/api/signup` | —      | `{username, password}`    | `200 {user:{id,username}}` + session cookie, `409` username taken, `400` invalid input, `429` rate limited |
| POST   | `/api/login`  | —      | `{username, password}`    | `200 {user:{id,username}}` + session cookie, `401` `invalid username or password` |
| POST   | `/api/logout` | —      | —                         | `204`, clears the session cookie |
| GET    | `/api/me`     | cookie | —                         | `200 {user:{id,username}}` or `401` |
| GET    | `/api/times`  | —      | —                         | `200 {times:[{rank,username,ms,at}]}` top 10, ascending |
| POST   | `/api/times`  | cookie | `{ms, trace?:[{x,z,t}]}` (`map` optional, default `"coast"`) | `200 {times}` after upsert, `401`, `400 invalid_ms` |

## Lap submission

`POST /api/times` accepts the submitted `ms` after the normal integer/range
check and upserts the player's best time. The optional `trace` is accepted for
replay tooling but is not validated and cannot reject a lap. The client still
records traces locally and sends them for replays.

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

The unit files are `deploy/sprite-drift-api.service` and
`deploy/sprite-drift-web.service`.

```sh
mkdir -p ~/.config/systemd/user
ln -sf /home/lucasian/Work/sprite-drift/deploy/sprite-drift-api.service ~/.config/systemd/user/
ln -sf /home/lucasian/Work/sprite-drift/deploy/sprite-drift-web.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now sprite-drift-api.service sprite-drift-web.service
```

Manage them with:

```sh
systemctl --user status sprite-drift-api.service
systemctl --user restart sprite-drift-api.service
journalctl --user -u sprite-drift-api.service -f
```

With `loginctl enable-linger "$USER"` both services survive a session logout.
The Cloudflare tunnel maps `drift.lucasian.tech` to Vite on `127.0.0.1:5180`.
