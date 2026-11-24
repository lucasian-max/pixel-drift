#!/usr/bin/env node
// server/api.mjs — dependency-free accounts + leaderboard HTTP API.
// node:http only. Binds 127.0.0.1:8790 and expects to sit behind the Vite dev
// server proxy (server.proxy '/api' -> http://127.0.0.1:8790), which is how it
// is reached through the Cloudflare tunnel at https://drift.lucasian.tech.
//
// Run: node server/api.mjs   (or: npm run api)

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  Store,
  StoreError,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  DEFAULT_MAP,
} from './store.mjs';
import { TRACK_HALF, distanceToTrack, trackU } from './track.mjs';

const HOST = '127.0.0.1';
const PORT = 8790;
const BODY_LIMIT_BYTES = 32768; // JSON request bodies (lap traces need room)
const AUTH_WINDOW_MS = 60_000; // rate limit: ...
const AUTH_MAX = 10; // ... 10 signup/login attempts per IP per 60s
const ROOM_WINDOW_MS = 60_000;
const ROOM_MAX = 30; // ... 30 room creations per IP per minute (proxied IP is shared)
const ROOM_CODE_RE = /^[A-HJ-NP-Z2-9]{4}$/; // no I/O/0/1
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_ROOM_PLAYERS = 8;
const MIN_LAP_MS = 12_000;
const MAX_LAP_MS = 600_000;
const LAPS_TO_FINISH = 3;
const TRACK_MARGIN = 2.4;      // kerbs + painted shoulder, but not the grass
const MAX_OFF_MS = 900;        // a lap may brush a kerb, not tour the lawn
const MAX_SPEED = 60;          // trace segments are sampled, so allow overshoot
const TICK_MS = 50; // 20 Hz state broadcast
const KNOWN_PATHS = new Set([
  '/api/signup',
  '/api/login',
  '/api/logout',
  '/api/me',
  '/api/times',
  '/api/rooms',
]);

const here = path.dirname(fileURLToPath(import.meta.url));
const store = new Store(path.join(here, 'data', 'db.json'));

// ---- helpers -----------------------------------------------------------------

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  if (body === undefined) {
    res.end();
    return;
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function parseCookies(req) {
  const jar = {};
  const header = req.headers.cookie;
  if (!header) return jar;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    jar[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return jar;
}

function sessionCookie(token) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000); // 604800 = 7 days
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

// The server only binds to 127.0.0.1, so an X-Forwarded-For value can only be
// set by a local trusted proxy (e.g. Vite). Use it when present, else the socket.
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress ?? 'unknown';
}

const authHits = new Map(); // ip -> recent attempt timestamps

function authRateLimited(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const hits = (authHits.get(ip) ?? []).filter((t) => now - t < AUTH_WINDOW_MS);
  hits.push(now);
  authHits.set(ip, hits);
  if (authHits.size > 10_000) {
    // opportunistic sweep so the map never grows unbounded
    for (const [key, list] of authHits) {
      if (list.every((t) => now - t >= AUTH_WINDOW_MS)) authHits.delete(key);
    }
  }
  return hits.length > AUTH_MAX;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    let overflow = false;
    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > BODY_LIMIT_BYTES) {
        overflow = true;
        chunks.length = 0; // keep draining, stop buffering
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (overflow) {
        return reject(
          new StoreError(413, 'payload_too_large', `JSON body must be under ${BODY_LIMIT_BYTES} bytes`),
        );
      }
      if (received === 0) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          return reject(new StoreError(400, 'invalid_json', 'JSON object expected'));
        }
        resolve(parsed);
      } catch {
        reject(new StoreError(400, 'invalid_json', 'request body must be valid JSON'));
      }
    });
    req.on('error', () => reject(new StoreError(400, 'read_error', 'could not read request body')));
  });
}

// ---- rooms + websocket -------------------------------------------------------

/** code -> { code, createdAt, clients: Map<id, client>, best } */
const rooms = new Map();
const roomHits = new Map();
let nextClientId = 1;

function roomRateLimited(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const hits = (roomHits.get(ip) ?? []).filter((t) => now - t < ROOM_WINDOW_MS);
  hits.push(now);
  roomHits.set(ip, hits);
  if (roomHits.size > 10_000) {
    for (const [key, list] of roomHits) {
      if (list.every((t) => now - t >= ROOM_WINDOW_MS)) roomHits.delete(key);
    }
  }
  return hits.length > ROOM_MAX;
}

function newRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 40; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) code += alphabet[(Math.random() * alphabet.length) | 0];
    if (!rooms.has(code)) return code;
  }
  return null;
}

function createRoom() {
  const code = newRoomCode();
  if (!code) return null;
  const room = { code, createdAt: Date.now(), clients: new Map(), best: null, finished: false, winner: null, startAt: 0 };
  rooms.set(code, room);
  return room;
}

function roomRoster(room) {
  const list = [...room.clients.values()];
  list.sort((a, b) => b.lap - a.lap || b.u - a.u);
  return list.map((c, i) => {
    c.place = i + 1;
    return {
      id: c.id, name: c.name, slot: c.slot, place: c.place,
      x: c.x, z: c.z, h: c.h, sp: c.speed, u: c.u, lap: c.lap,
      best: c.bestLapMs,
    };
  });
}

function sendJson(ws, body) {
  if (ws.readyState !== 1) return;   // WebSocket.OPEN
  try { ws.send(JSON.stringify(body)); } catch { /* socket died mid-write */ }
}

function broadcast(room, body) {
  for (const c of room.clients.values()) sendJson(c.ws, body);
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

/**
 * A lap submission carries 5 Hz positions. Accept it only if every sample is
 * on the road (plus kerbs), the implied speed is possible, the timestamps span
 * the claimed lap, and the samples progress around the circuit.
 */
function validateLapTrace(trace, ms) {
  if (!Number.isFinite(ms) || ms <= 0) return false;
  if (!Array.isArray(trace) || trace.length > 800) return false;
  // 5 Hz from the client; require at least 2.5 Hz so a coarse trace cannot
  // hide an infield shortcut between samples.
  if (trace.length < Math.max(10, Math.ceil(ms / 400))) return false;
  let prevT = null, prevX = 0, prevZ = 0, prevU = null, progress = 0;
  let firstU = null, lastU = null;
  for (const p of trace) {
    if (!p || typeof p !== 'object') return false;
    const x = Number(p.x), z = Number(p.z), t = Number(p.t);
    if (![x, z, t].every(Number.isFinite)) return false;
    if (t < 0 || t > ms + 1500) return false;
    if (prevT !== null && t <= prevT) return false;
    if (distanceToTrack(x, z) > TRACK_HALF + TRACK_MARGIN) return false;
    if (prevT !== null) {
      const dt = (t - prevT) / 1000;
      if (dt <= 0) return false;
      if (Math.hypot(x - prevX, z - prevZ) / dt > MAX_SPEED) return false;
    }
    const u = trackU(x, z);
    if (firstU === null) firstU = u;
    lastU = u;
    if (prevU !== null) {
      let du = u - prevU;
      if (du < -0.5) du += 1; else if (du > 0.5) du -= 1;
      if (du > 0 && du < 0.2) progress += du;
    }
    prevU = u; prevT = t; prevX = x; prevZ = z;
  }
  if (prevT === null || Math.abs(prevT - ms) > 1500) return false;
  const atLine = (u) => u === null || u < 0.08 || u > 0.92;
  if (!atLine(firstU) || !atLine(lastU)) return false;
  return progress >= 0.85 && progress <= 1.35;
}

function attachClient(ws, req, room) {
  if (room.clients.size >= MAX_ROOM_PLAYERS) {
    ws.close(4005, 'room full');
    return;
  }
  if (room.clients.size === 0) {
    room.finished = false;
    room.winner = null;
    room.best = null;
    room.startAt = 0;
  }
  const token = parseCookies(req)[SESSION_COOKIE];
  const user = token ? store.userForToken(token) : null;
  let name = user ? user.username : '';
  if (!name) {
    const taken = new Set([...room.clients.values()].map((c) => c.name));
    do { name = `GUEST${100 + ((Math.random() * 900) | 0)}`; } while (taken.has(name));
  }
  let slot = 0;
  const used = new Set([...room.clients.values()].map((c) => c.slot));
  while (used.has(slot) && slot < MAX_ROOM_PLAYERS) slot++;

  const client = {
    id: `p${nextClientId++}`, name, slot, ws,
    x: 0, z: 0, h: 0, speed: 0, u: 0, lap: 0,
    progress: 0, lastU: 0, place: 0, lastLapMs: 0, joinedAt: Date.now(),
    bestLapMs: 0, dirty: false, offMs: 0,
    lastX: 0, lastZ: 0, lastStateAt: 0,
  };
  room.clients.set(client.id, client);
  console.log(`[room ${room.code}] + ${name} (${client.id}) slot ${slot}`);

  sendJson(ws, {
    t: 'welcome', id: client.id, name, slot, room: room.code,
    count: room.clients.size, racers: roomRoster(room), best: room.best,
    finished: room.finished, winner: room.winner, laps: LAPS_TO_FINISH,
    startIn: room.startAt ? Math.max(0, room.startAt - Date.now()) : 0,
    racing: room.startAt > 0,
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'start') {
      if (room.finished) return;                       // press R for a rematch
      if (room.startAt > 0) return;                    // already counting down / racing
      room.startAt = Date.now() + 3600;
      broadcast(room, { t: 'start', ms: 3600 });
      console.log(`[room ${room.code}] start from ${name}`);
      return;
    }

    if (msg.t === 'state') {
      const x = Number(msg.x), z = Number(msg.z), h = Number(msg.h);
      const sp = Number(msg.sp);
      if (![x, z, h, sp].every(Number.isFinite)) return;
      const now = Date.now();
      const deltaMs = client.lastStateAt > 0
        ? Math.min(200, Math.max(1, now - client.lastStateAt))
        : TICK_MS;
      // Teleports and speed hacks: the car cannot cross more than its top
      // speed allows between two 20 Hz poses.
      if (client.lastStateAt > 0) {
        const dt = Math.max(0.02, (now - client.lastStateAt) / 1000);
        const jumped = Math.hypot(x - client.lastX, z - client.lastZ);
        // A paused tab can legitimately produce a long gap; a teleport is a
        // large jump AND an impossible speed.
        if (jumped > 12 && jumped / dt > MAX_SPEED * 3) client.dirty = true;
      }
      client.lastStateAt = now;
      client.lastX = x;
      client.lastZ = z;
      client.x = clamp(x, -250, 250);
      client.z = clamp(z, -250, 250);
      client.h = h;
      client.speed = clamp(sp, -80, 80);

      // Grass is a shortcut, so time outside the corridor dirties the lap.
      const off = distanceToTrack(client.x, client.z);
      if (off > TRACK_HALF + TRACK_MARGIN) {
        client.offMs += deltaMs;
        if (off > TRACK_HALF + 12) client.dirty = true;
      }

      // Progress comes from the server's own centreline lookup, never from
      // the client's reported `u`.
      client.u = trackU(client.x, client.z);
      let d = client.u - client.lastU;
      if (d < -0.5) d += 1; else if (d > 0.5) d -= 1;
      if (d > 0 && d < 0.08) client.progress += d;
      client.lastU = client.u;
      return;
    }

    if (msg.t === 'reset') {
      if (room.finished) {
        room.finished = false;
        room.winner = null;
        room.best = null;
        room.startAt = Date.now() + 3600;
        for (const c of room.clients.values()) {
          c.lap = 0; c.u = 0; c.lastU = 0; c.progress = 0;
          c.dirty = false; c.offMs = 0; c.bestLapMs = 0;
          c.lastStateAt = 0; c.lastX = 0; c.lastZ = 0;
        }
        broadcast(room, { t: 'rematch', laps: LAPS_TO_FINISH });
        broadcast(room, { t: 'start', ms: 3600 });
        console.log(`[room ${room.code}] rematch`);
      } else {
        client.lap = 0;
        client.u = 0;
        client.lastU = 0;
        client.progress = 0;
        client.dirty = false;
        client.offMs = 0;
      }
      return;
    }

    if (msg.t === 'lap') {
      const ms = Math.round(Number(msg.ms));
      let reason = '';
      if (!Number.isFinite(ms) || ms < MIN_LAP_MS || ms > MAX_LAP_MS) reason = 'invalid_time';
      else if (client.progress < 0.85 || client.progress > 1.6) reason = 'invalid_progress';
      else if (client.offMs > MAX_OFF_MS) reason = 'off_track';
      else if (client.dirty) reason = 'off_track';

      const valid = reason === '';
      if (valid) {
        // Increment the server's own count. The client's lap number is only a
        // hint; it cannot skip or declare a finish.
        client.lap += 1;
        client.lastLapMs = ms;
        if (!client.bestLapMs || ms < client.bestLapMs) client.bestLapMs = ms;
        if (!room.best || ms < room.best.ms) room.best = { name, ms };
        if (client.lap >= LAPS_TO_FINISH && !room.finished) {
          room.finished = true;
          room.winner = { id: client.id, name, ms };
          broadcast(room, {
            t: 'finish', winner: room.winner,
            standings: roomRoster(room), laps: LAPS_TO_FINISH,
          });
          console.log(`[room ${room.code}] finish ${name} ${ms}ms`);
        }
      }
      client.progress = 0;
      client.dirty = false;
      client.offMs = 0;
      client.lastU = client.u;
      broadcast(room, {
        t: 'lap', id: client.id, name, ms, valid, reason,
        lap: client.lap, best: room.best, bestLap: client.bestLapMs,
      });
      return;
    }
  });

  ws.on('close', () => {
    room.clients.delete(client.id);
    console.log(`[room ${room.code}] - ${name} (${client.id})`);
    broadcast(room, { t: 'left', id: client.id, name, count: room.clients.size });
  });
  ws.on('error', () => { /* close follows */ });
}

const wss = new WebSocketServer({ noServer: true });
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.clients.size === 0) {
      if (now - room.createdAt > ROOM_TTL_MS) rooms.delete(room.code);
      continue;
    }
    const racers = roomRoster(room);
    broadcast(room, {
      t: 'states', racers, count: room.clients.size, best: room.best,
      finished: room.finished, winner: room.winner, laps: LAPS_TO_FINISH,
    });
  }
}, TICK_MS);


// ---- request handling ----------------------------------------------------------

async function handle(req, res, pathname) {
  if (!KNOWN_PATHS.has(pathname)) {
    return send(res, 404, { error: 'not_found' });
  }

  const token = parseCookies(req)[SESSION_COOKIE];
  const user = token ? store.userForToken(token) : null;

  if (pathname === '/api/rooms') {
    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
    if (roomRateLimited(req)) return send(res, 429, { error: 'too_many_rooms' });
    const room = createRoom();
    if (!room) return send(res, 503, { error: 'no_room_codes' });
    return send(res, 200, { room: room.code, players: 0 });
  }

  if (pathname === '/api/me') {
    if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
    if (!user) return send(res, 401, { error: 'unauthorized' });
    return send(res, 200, { user });
  }

  if (pathname === '/api/times') {
    if (req.method === 'GET') return send(res, 200, { times: store.topTimes(DEFAULT_MAP) });
    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
    if (!user) return send(res, 401, { error: 'unauthorized' });
    const body = await readJsonBody(req);
    const map = typeof body.map === 'string' ? body.map : DEFAULT_MAP;
    // The coast board is telemetry-checked: a time with no trace, or a trace
    // that leaves the road, cuts the infield, or covers the lap impossibly
    // fast, never reaches the store.
    if (map === DEFAULT_MAP && !validateLapTrace(body.trace, Number(body.ms))) {
      return send(res, 400, { error: 'invalid_lap' });
    }
    return send(res, 200, { times: store.submitTime(user, body.ms, map) });
  }

  if (pathname === '/api/logout') {
    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
    store.destroySession(token);
    res.setHeader('Set-Cookie', clearSessionCookie());
    return send(res, 204);
  }

  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });

  // /api/signup and /api/login — rate-limited auth attempts.
  if (authRateLimited(req)) {
    return send(res, 429, { error: 'too_many_attempts' });
  }
  const body = await readJsonBody(req);

  if (pathname === '/api/signup') {
    const created = store.signup(body.username, body.password); // StoreError -> status/code
    res.setHeader('Set-Cookie', sessionCookie(store.createSession(created.id)));
    return send(res, 200, { user: created });
  }

  // /api/login
  const found = store.login(body.username, body.password);
  if (!found) return send(res, 401, { error: 'invalid username or password' });
  res.setHeader('Set-Cookie', sessionCookie(store.createSession(found.id)));
  return send(res, 200, { user: found });
}

// ---- server ---------------------------------------------------------------------

const server = http.createServer((req, res) => {
  const startedAt = Date.now();
  let pathname = req.url;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    /* keep raw url */
  }
  res.on('finish', () => {
    console.log(`${req.method} ${pathname} ${res.statusCode} ${Date.now() - startedAt}ms`);
  });
  handle(req, res, pathname).catch((err) => {
    if (err instanceof StoreError) return send(res, err.status, { error: err.code });
    console.error('[api] unexpected error:', err);
    if (!res.headersSent) return send(res, 500, { error: 'internal_error' });
    res.destroy();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`sprite-drift api listening on http://${HOST}:${PORT} (db: ${store.dataPath})`);
});

server.on('upgrade', (req, socket, head) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { socket.destroy(); return; }
  if (url.pathname !== '/api/ws') { socket.destroy(); return; }
  // Same-site only: the game is served from drift.lucasian.tech and the API
  // from api.lucasian.tech, so allow the lucasian.tech family plus localhost.
  const origin = req.headers.origin;
  if (origin) {
    let host = '';
    try { host = new URL(origin).hostname; } catch { socket.destroy(); return; }
    const ok = host === 'localhost' || host === '127.0.0.1'
      || host === 'lucasian.tech' || host.endsWith('.lucasian.tech')
      || host.endsWith('.trycloudflare.com') || host.endsWith('.cfargotunnel.com');
    if (!ok) { socket.destroy(); return; }
  }
  const code = (url.searchParams.get('room') ?? '').toUpperCase();
  if (!ROOM_CODE_RE.test(code)) { socket.destroy(); return; }
  // arcade rules: any code is a room, created on first join
  let room = rooms.get(code);
  if (!room) {
    room = { code, createdAt: Date.now(), clients: new Map(), best: null, finished: false, winner: null, startAt: 0 };
    rooms.set(code, room);
  }
  wss.handleUpgrade(req, socket, head, (ws) => attachClient(ws, req, room));
});

// ---- graceful shutdown -------------------------------------------------------------

function shutdown() {
  console.log('[api] shutting down');
  store.close();
  for (const room of rooms.values()) {
    for (const c of room.clients.values()) c.ws.close(1001, 'server shutting down');
  }
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', () => store.close());
