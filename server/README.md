# Pixel Drift API

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
| POST   | `/api/times`  | cookie | `{ms, trace:[{x,z,t}], map?}` | `200 {times}` after upsert, `401`, `400 invalid_ms`, `422 invalid_trace` |
| POST   | `/api/admin/delete-time` | admin | `{map, username}` | `200 {removed, times}`, `403`, `401` |
| POST   | `/api/admin/clear-map` | admin | `{map}` | `200 {removed, times}`, `403`, `401` |
| GET    | `/api/admin/stats` | admin | — | `200` aggregate laps/players/maps/recent, `403`, `401` |
| POST   | `/api/runs` | cookie | gzip or plain JSONL recorder export (≤8 MB) | `200 {ok, episodes, bytes}`, `401`, `400`, `413` |
| GET    | `/api/admin/runs` | admin | — | `200` upload totals/users/recent, `403`, `401` |

## Lap submission and anti-cheat

`POST /api/times` requires the lap's position trace:
`[{x,z,t}, ...]` in metres and milliseconds, sampled at roughly 5 Hz plus an
exact final point on the line. The server validates it against
`track-data.json`, its own copy of the smoothed centrelines, before the time
can reach the board.

Checks (all generous; clean racing passes):

- the trace has enough samples and timestamps are monotonic;
- the last timestamp matches the submitted `ms` (2.5 s slack);
- the first and last points are within 35 m of the start/finish line;
- each sample is within `roadHalf + 14 m` of the centreline;
- route length is 85%–200% of one lap;
- no segment exceeds 65 units/s (top speed with a power is ~45);
- the route's bounding box covers at least 55% of the circuit's bounds.

Failures return `422 {error:"invalid_trace", reason:"..."}` and are not
stored. A determined forger can still fabricate a full plausible trace; this
stops shortcuts, teleports, edited clocks and missing telemetry, not
determined reverse engineering.

`server/track-data.json` is generated from the game's actual smoothed track
(`game.world.track`, `start`, `roadHalf`, `name` per map). Regenerate it
whenever a circuit layout changes, or the server will validate against the
old line. Current lengths: Coast 358.2 m, Frostbite 420.6 m, Sakura 410.0 m.

Every accepted submission is also appended to the lap history (capped at
5000) for the data desk. The best entry keeps a downsampled trace for future
replays.

Notes:

- All `/api` responses send `Cache-Control: no-store`.
- JSON request bodies are capped at 32KB (`413` beyond that); lap traces need
  the headroom.
- Signup/login are rate limited: 10 attempts per IP per 60s, then `429`.
  The server prefers `X-Forwarded-For` when present (safe because it only
  binds to localhost); if you later enable Vite's `xfwd` proxy option, the
  limit becomes per-visitor instead of per-proxy.

## Admin accounts

Admin names are never chosen by the client. Set them in either place:

```sh
SPRITE_ADMINS=lucasian node server/api.mjs
# or, gitignored:
echo '["lucasian"]' > server/data/admins.json
```

The role is derived from that list on load and on signup/login, exposed as
`user.role` (`admin` or `player`) by `/api/me`, login and signup. Admin
endpoints check the session role; a signed-in player gets `403`.

Admins get an **ADMIN** button on the title screen. The panel deletes one
player's best time on the current circuit (confirm-free) or clears that
circuit's board (requires a second confirming click). The list is
`server/data/admins.json` or `SPRITE_ADMINS`, never a password.

## Accounts

- Usernames: 3–16 chars, `[a-z0-9_]`, lowercase, unique.
- Passwords: 8–200 chars, stored as scrypt (`N=16384, r=8, p=1`) + 16-byte
  random salt, hex-encoded, verified with `timingSafeEqual`.
- Sessions: 32 random bytes (hex) in a `sd_session` cookie —
  `HttpOnly; SameSite=Lax; Path=/`, 7-day expiry. Failed logins always
  return the same generic `invalid username or password`.

## Data desk

`/dashboard.html` (served by Vite from `public/`) is an admin-only dashboard:
per-circuit boards, total laps/players, fastest lap, car usage, recent laps,
the local 60 Hz recorder runs from the admin's own browser, and any uploaded
run files. It uses the same admin cookie; non-admins get a gate. The in-game
admin panel has **DASHBOARD** and **UPLOAD RUNS** buttons.

Complete laps from signed-in players upload automatically when the lap ends
(plus any pending complete laps on the next session) to `POST /api/runs`,
which stores them under `server/data/runs/<user>/` and appends
`server/data/runs/manifest.jsonl`. Partials, resets and guests stay local.
A file is capped at 8 MB compressed / 32 MB decompressed. The raw files are
decompressed JSONL and are deleted after the HF sync commits them. The browser
drops its copy once the server accepts a complete lap.

## Hugging Face sync

`tools/hf_sync.py` uploads new run files to a **private** dataset
(`raw/<player>/...`), defaulting to `<hf-user>/pixel-drift-runs`. Configure a
write token and run it:

```bash
echo 'hf_...' > server/data/hf-token && chmod 600 server/data/hf-token
server/.venv/bin/python tools/hf_sync.py
```

Then install the timer so new runs sync every minute:

```bash
ln -sf "$PWD/deploy/pixel-drift-hf-sync.service" ~/.config/systemd/user/
ln -sf "$PWD/deploy/pixel-drift-hf-sync.timer" ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now pixel-drift-hf-sync.timer
```

State is kept in `server/data/runs/.hf-uploaded.json`; only new files are
committed. Uploaded paths include `README.md` (dataset card) and
`raw/<player>/<file>.jsonl`. The repo is forced private. After a successful
commit the local raw file is deleted (`--keep` disables pruning), so the game
machine only holds the manifest and whatever is waiting for the next sync.

Merge uploads before training:

```bash
python3 tools/dataset/merge_runs.py server/data/runs/*/*.jsonl -o runs-all.jsonl
python3 tools/dataset/convert_runs.py runs-all.jsonl -o dataset/
```

Run `?rec=120` to record at 120 Hz instead of 60 Hz. Episode metadata now
includes player, input device, launch flag, event list (impact/power/reset) and
per-episode stats (off-track seconds, impacts, power uses).

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
