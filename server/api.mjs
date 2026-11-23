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

const HOST = '127.0.0.1';
const PORT = 8790;
const BODY_LIMIT_BYTES = 4096; // JSON request bodies capped at 4KB
const AUTH_WINDOW_MS = 60_000; // rate limit: ...
const AUTH_MAX = 10; // ... 10 signup/login attempts per IP per 60s
const ROOM_WINDOW_MS = 60_000;
const ROOM_MAX = 30; // ... 30 room creations per IP per minute (proxied IP is shared)
const ROOM_CODE_RE = /^[A-HJ-NP-Z2-9]{4}$/; // no I/O/0/1
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_ROOM_PLAYERS = 8;
const MIN_LAP_MS = 8_500;
const MAX_LAP_MS = 600_000;
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
  const room = { code, createdAt: Date.now(), clients: new Map(), best: null };
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

function attachClient(ws, req, room) {
  if (room.clients.size >= MAX_ROOM_PLAYERS) {
    ws.close(4005, 'room full');
    return;
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
  };
  room.clients.set(client.id, client);
  console.log(`[room ${room.code}] + ${name} (${client.id}) slot ${slot}`);

  sendJson(ws, {
    t: 'welcome', id: client.id, name, slot, room: room.code,
    count: room.clients.size, racers: roomRoster(room), best: room.best,
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'state') {
      const x = Number(msg.x), z = Number(msg.z), h = Number(msg.h);
      const sp = Number(msg.sp), u = Number(msg.u), lap = Number(msg.lap);
      if (![x, z, h, sp, u, lap].every(Number.isFinite)) return;
      client.x = clamp(x, -250, 250);
      client.z = clamp(z, -250, 250);
      client.h = h;
      client.speed = clamp(sp, -80, 80);
      client.u = ((u % 1) + 1) % 1;
      client.lap = clamp(Math.round(lap), 0, 999);
      let d = client.u - client.lastU;
      if (d < -0.5) d += 1; else if (d > 0.5) d -= 1;
      if (d > 0 && d < 0.08) client.progress += d;
      client.lastU = client.u;
      return;
    }

    if (msg.t === 'lap') {
      const ms = Math.round(Number(msg.ms));
      const lapNo = Math.round(Number(msg.lap));
      // A lap only counts if the client actually moved around the circuit and
      // the clock is inside humanly possible bounds.
      const valid = Number.isFinite(ms) && Number.isFinite(lapNo)
        && ms >= MIN_LAP_MS && ms <= MAX_LAP_MS
        && client.progress >= 0.85 && client.progress <= 1.6
        && lapNo === client.lap + 1;
      if (valid) {
        client.lap = lapNo;
        client.lastLapMs = ms;
        if (!room.best || ms < room.best.ms) room.best = { name, ms };
      }
      client.progress = 0;
      client.lastU = client.u;
      broadcast(room, {
        t: 'lap', id: client.id, name, ms, valid,
        lap: client.lap, best: room.best,
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
    broadcast(room, { t: 'states', racers, count: room.clients.size, best: room.best });
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
    room = { code, createdAt: Date.now(), clients: new Map(), best: null };
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
