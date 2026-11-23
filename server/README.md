# sprite-drift API

Dependency-free accounts + leaderboard API for the game. Uses only Node
built-ins (`node:http`, `node:crypto`, `node:fs`) — no npm packages.

- **Listen address:** `127.0.0.1:8790` (localhost only; it is never exposed
  directly — the Vite dev server proxies `/api` to it, and the Cloudflare
  tunnel fronts Vite).
- **Data:** `server/data/db.json` (created on first run, gitignored).
- **Log:** one line per request — `METHOD path STATUS ms`.

## Run

```sh
node server/api.mjs        # or: npm run api
```

The server does not touch the Vite dev server; start/stop them independently.
It flushes pending writes and exits cleanly on SIGINT/SIGTERM.

## Wire it into Vite

Add the `proxy` entry to the existing `server` block in `vite.config.ts`:

```ts
// vite.config.ts
export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5180,
    allowedHosts: ['drift.lucasian.tech', '.lucasian.tech', '.trycloudflare.com', '.cfargotunnel.com'],
    proxy: {
      '/api': 'http://127.0.0.1:8790',
    },
  },
  // ...preview, build unchanged
});
```

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
| POST   | `/api/times`  | cookie | `{ms}` (`map` optional, default `"coast"`) | `200 {times}` after upsert, `401`, `400` ms out of range |

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
