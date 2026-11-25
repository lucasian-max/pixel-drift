#!/usr/bin/env node
// server/api.mjs — accounts + leaderboard HTTP API (solo build).
// node:http only. Binds 127.0.0.1:8790; Vite proxies /api to it.
//
// Run: node server/api.mjs   (or: npm run api)
//
// Multiplayer rooms and their WebSocket transport are archived on the
// `multiplayer` branch / `multiplayer-archive` tag.

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Store,
  StoreError,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  DEFAULT_MAP,
} from './store.mjs';
import { validateLap, mapNames } from './anticheat.mjs';
import { saveRun, listRuns, RUN_UPLOAD_LIMIT } from './runs.mjs';

const HOST = '127.0.0.1';
const PORT = 8790;
const BODY_LIMIT_BYTES = 32768; // lap traces (kept for replays) need the headroom
const AUTH_WINDOW_MS = 60_000; // 10 signup/login attempts per IP per 60s
const AUTH_MAX = 10;
const MAP_RE = /^[a-z0-9_-]{1,32}$/; // must match Store's map validation
const KNOWN_PATHS = new Set([
  '/api/signup',
  '/api/login',
  '/api/logout',
  '/api/me',
  '/api/times',
  '/api/admin/delete-time',
  '/api/admin/clear-map',
  '/api/admin/stats',
  '/api/runs',
  '/api/admin/runs',
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
    for (const [key, list] of authHits) {
      if (list.every((t) => now - t >= AUTH_WINDOW_MS)) authHits.delete(key);
    }
  }
  return hits.length > AUTH_MAX;
}

function readRawBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    let overflow = false;
    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > limit) {
        overflow = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (overflow) return reject(new StoreError(413, 'payload_too_large', 'upload too large'));
      resolve(Buffer.concat(chunks));
    });
    req.on('error', () => reject(new StoreError(400, 'read_error', 'could not read upload')));
  });
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

// ---- request handling ----------------------------------------------------------

async function handle(req, res, pathname) {
  if (!KNOWN_PATHS.has(pathname)) {
    return send(res, 404, { error: 'not_found' });
  }

  const token = parseCookies(req)[SESSION_COOKIE];
  const user = token ? store.userForToken(token) : null;

  if (pathname === '/api/me') {
    if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
    if (!user) return send(res, 401, { error: 'unauthorized' });
    return send(res, 200, { user });
  }

  if (pathname === '/api/times') {
    if (req.method === 'GET') {
      const asked = new URL(req.url, 'http://localhost').searchParams.get('map');
      const map = asked && MAP_RE.test(asked) ? asked : DEFAULT_MAP;
      return send(res, 200, { map, times: store.topTimes(map) });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
    if (!user) return send(res, 401, { error: 'unauthorized' });
    const body = await readJsonBody(req);
    const map = typeof body.map === 'string' ? body.map : DEFAULT_MAP;
    // Validate the submitted lap against the circuit before it reaches the
    // board. Shortcuts, teleports and missing/edited traces are rejected.
    const verdict = validateLap(map, body.ms, body.trace);
    if (!verdict.ok) {
      console.log(`[anticheat] reject ${user.username} ${map} ${body.ms}ms: ${verdict.reason}`);
      return send(res, 422, { error: 'invalid_trace', reason: verdict.reason });
    }
    const car = typeof body.car === 'string' && body.car.trim()
      ? body.car.trim().slice(0, 32)
      : null;
    const variant = Number.isInteger(body.variant) && body.variant >= 0 && body.variant <= 9
      ? body.variant
      : null;
    return send(res, 200, {
      times: store.submitTime(user, body.ms, map, body.trace, verdict.summary, car, variant),
    });
  }

  if (pathname === '/api/runs') {
    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
    if (!user) return send(res, 401, { error: 'unauthorized' });
    const body = await readRawBody(req, RUN_UPLOAD_LIMIT);
    const meta = saveRun(user, body, req.headers['content-type']);
    return send(res, 200, { ok: true, ...meta });
  }

  if (pathname === '/api/admin/runs') {
    if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
    if (!user) return send(res, 401, { error: 'unauthorized' });
    if (!store.isAdmin(user)) return send(res, 403, { error: 'forbidden' });
    return send(res, 200, listRuns());
  }

  if (pathname === '/api/admin/stats') {
    if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
    if (!user) return send(res, 401, { error: 'unauthorized' });
    if (!store.isAdmin(user)) return send(res, 403, { error: 'forbidden' });
    return send(res, 200, store.stats(mapNames()));
  }

  if (pathname.startsWith('/api/admin/')) {
    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
    if (!user) return send(res, 401, { error: 'unauthorized' });
    if (!store.isAdmin(user)) return send(res, 403, { error: 'forbidden' });
    const body = await readJsonBody(req);
    if (pathname === '/api/admin/delete-time') {
      return send(res, 200, store.deleteTime(body.map, body.username));
    }
    // /api/admin/clear-map
    return send(res, 200, store.clearTimes(body.map));
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
  console.log(`Pixel Drift API listening on http://${HOST}:${PORT} (db: ${store.dataPath})`);
});

// ---- graceful shutdown -------------------------------------------------------------

function shutdown() {
  console.log('[api] shutting down');
  store.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', () => store.close());
