// server/store.mjs — dependency-free accounts + leaderboard store.
// Uses only node:fs, node:path, node:crypto. No external packages.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const SESSION_COOKIE = 'sd_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const USERNAME_RE = /^[a-z0-9_]{3,16}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;
export const TIME_MIN_MS = 1_000;   // trusted times: only reject nonsense
export const TIME_MAX_MS = 1_800_000;
export const DEFAULT_MAP = 'coast';
export const MAP_RE = /^[a-z0-9_-]{1,32}$/;
export const ROLE_ADMIN = 'admin';
export const ROLE_PLAYER = 'player';
/** Gated features: public availability lives in db.features, one flag each.
 *  Add a name here to gate another one. */
export const FEATURES = ['ghost', 'lapbar'];

/** Admin names come from SPRITE_ADMINS and/or server/data/admins.json,
 *  never from the client. The data folder is gitignored. */
function loadAdminNames(dataPath) {
  const names = new Set();
  for (const part of String(process.env.SPRITE_ADMINS ?? '').split(/[,\s]+/)) {
    if (part) names.add(part);
  }
  try {
    const file = path.join(path.dirname(dataPath), 'admins.json');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(parsed)) for (const name of parsed) {
      if (typeof name === 'string' && name) names.add(name);
    }
  } catch {
    /* no admins file is fine */
  }
  return names;
}

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64; // bytes -> 128 hex chars
const SAVE_DEBOUNCE_MS = 1000; // at most one disk write per second
const DUMMY_SALT = '00'.repeat(16); // burn time on unknown-user logins

export class StoreError extends Error {
  constructor(status, code, message) {
    super(message ?? code);
    this.name = 'StoreError';
    this.status = status;
    this.code = code;
  }
}

export function hashPassword(password, saltHex) {
  return crypto
    .scryptSync(String(password), Buffer.from(saltHex, 'hex'), KEYLEN, SCRYPT)
    .toString('hex');
}

export function verifyPassword(password, saltHex, hashHex) {
  const expected = Buffer.from(String(hashHex), 'hex');
  const actual = Buffer.from(hashPassword(password, saltHex), 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/** Every feature name the game knows. Features are PUBLIC by default (the
 *  owner ships straight to players); the map only exists to turn one OFF,
 *  so a value of false (or a db from before this map) still hides it only
 *  when explicitly demanded. */
function readFeatures(raw) {
  const out = {};
  for (const name of FEATURES) out[name] = !(raw && typeof raw === 'object' && raw[name] === false);
  return out;
}

export function emptyDb() {
  return { users: [], sessions: {}, times: [], laps: [], features: readFeatures(null) };
}

export class Store {
  constructor(dataPath) {
    this.dataPath = dataPath;
    this.admins = loadAdminNames(dataPath);
    this.db = emptyDb();
    this.sessions = new Map(); // token -> { userId, expires }
    this._timer = null;
    this._dirty = false;
    this._load();
    fs.mkdirSync(path.dirname(this.dataPath), { recursive: true });
  }
  _load() {
    let raw;
    try {
      raw = fs.readFileSync(this.dataPath, 'utf8');
    } catch {
      return; // no file yet — fresh start
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      // Corrupt db: set it aside and start fresh rather than crash the game.
      try {
        fs.renameSync(this.dataPath, `${this.dataPath}.corrupt`);
      } catch {
        /* ignore */
      }
      console.error(
        `[store] could not parse ${this.dataPath} (${err.message}); started fresh, old file kept as .corrupt`,
      );
      return;
    }
    this.db = {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      sessions: {},
      times: Array.isArray(parsed.times) ? parsed.times : [],
      laps: Array.isArray(parsed.laps) ? parsed.laps : [],
      features: readFeatures(parsed.features),
    };
    // seed the lap history once from pre-history best times
    if (!Array.isArray(parsed.laps) && this.db.times.length > 0) {
      this.db.laps = this.db.times.map((t) => ({
        userId: t.userId, username: t.username, ms: t.ms, at: t.at, map: t.map,
        summary: null, migrated: true,
      }));
      this._scheduleSave();
    }
    this._syncRoles();
    const now = Date.now();
    const stored =
      parsed.sessions && typeof parsed.sessions === 'object' ? parsed.sessions : {};
    for (const [token, s] of Object.entries(stored)) {
      if (!s || typeof s.expires !== 'number' || s.expires <= now) continue;
      if (!this._userById(s.userId)) continue;
      this.sessions.set(token, { userId: s.userId, expires: s.expires });
    }
  }

  _scheduleSave() {
    this._dirty = true;
    if (this._timer !== null) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      if (!this._dirty) return;
      try {
        this.flush();
      } catch (err) {
        console.error('[store] save failed:', err.message);
        this._dirty = true; // retry on next change
      }
    }, SAVE_DEBOUNCE_MS);
  }

  // Atomic write: dump to a tmp file, then rename it over the real one.
  flush() {
    if (!this._dirty) return;
    this._dirty = false;
    const snapshot = { ...this.db, sessions: Object.fromEntries(this.sessions) };
    const json = JSON.stringify(snapshot, null, 2);
    const tmp = `${this.dataPath}.tmp`;
    fs.writeFileSync(tmp, json);
    fs.renameSync(tmp, this.dataPath);
  }

  close() {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this.flush();
  }
  _roleFor(username) {
    return this.admins.has(username) ? ROLE_ADMIN : ROLE_PLAYER;
  }

  /** Derive roles from the admin list and persist the change if it moved. */
  _syncRoles() {
    let changed = false;
    for (const u of this.db.users) {
      const role = this._roleFor(u.username);
      if (u.role !== role) {
        u.role = role;
        changed = true;
      }
    }
    if (changed) this._scheduleSave();
  }

  _publicUser(user) {
    return { id: user.id, username: user.username, role: this._roleFor(user.username) };
  }

  isAdmin(user) {
    return !!user && this._roleFor(user.username) === ROLE_ADMIN;
  }

  /** Public availability of every gated feature. Never the admin's own view. */
  features() {
    return { ...readFeatures(this.db.features) };
  }

  /** A player sees a feature when it is public, or always as an admin. */
  featureVisible(name, user) {
    return this.features()[name] === true || this.isAdmin(user);
  }

  /** Admin: flip one feature's public availability. Creates the map on first
   *  use, so a db from before the gate existed is only written when toggled. */
  setFeature(name, enabled) {
    if (!FEATURES.includes(name)) {
      throw new StoreError(400, 'invalid_feature', `feature must be one of: ${FEATURES.join(', ')}`);
    }
    if (typeof enabled !== 'boolean') {
      throw new StoreError(400, 'invalid_enabled', 'enabled must be true or false');
    }
    this.db.features = readFeatures(this.db.features);
    this.db.features[name] = enabled;
    this._scheduleSave();
    return this.features();
  }

  /** The ghost car: the rank-1 line for one map, or null without a trace to
   *  replay. Shape matches the stored trace: compact [x, z, t, heading, event?]
   *  points (heading may be null on older lines). */
  ghostFor(map = DEFAULT_MAP) {
    const best = this.db.times
      .filter((t) => t.map === map)
      .sort((a, b) => a.ms - b.ms)[0];
    if (!best || !Array.isArray(best.trace) || best.trace.length < 2) return null;
    return {
      username: best.username,
      ms: best.ms,
      trace: best.trace,
      car: best.car ?? null,
      variant: best.variant ?? null,
    };
  }

  _userById(id) {
    return this.db.users.find((u) => u.id === id) ?? null;
  }

  _userByName(username) {
    return this.db.users.find((u) => u.username === username) ?? null;
  }

  signup(username, password) {
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
      throw new StoreError(400, 'invalid_username', 'username must be 3-16 characters: a-z, 0-9, _');
    }
    if (
      typeof password !== 'string' ||
      password.length < PASSWORD_MIN ||
      password.length > PASSWORD_MAX
    ) {
      throw new StoreError(400, 'invalid_password', `password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters`);
    }
    if (this._userByName(username)) {
      throw new StoreError(409, 'username_taken', 'username already taken');
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const user = {
      id: crypto.randomUUID(),
      username,
      salt,
      hash: hashPassword(password, salt),
      role: this._roleFor(username),
      createdAt: new Date().toISOString(),
    };
    this.db.users.push(user);
    this._scheduleSave();
    return this._publicUser(user);
  }

  // Returns {id, username} on success, null on any failure. Callers emit one
  // generic "invalid username or password" so failures are indistinguishable.
  login(username, password) {
    if (typeof username !== 'string' || typeof password !== 'string') return null;
    const user = this._userByName(username);
    if (!user) {
      hashPassword(password, DUMMY_SALT); // comparable work so unknown users aren't a timing oracle
      return null;
    }
    if (!verifyPassword(password, user.salt, user.hash)) return null;
    return this._publicUser(user);
  }
  createSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    this.sessions.set(token, { userId, expires: Date.now() + SESSION_TTL_MS });
    this._scheduleSave();
    return token;
  }

  userForToken(token) {
    if (typeof token !== 'string' || token === '') return null;
    const session = this.sessions.get(token);
    if (!session) return null;
    if (Date.now() >= session.expires) {
      this.sessions.delete(token);
      this._scheduleSave();
      return null;
    }
    const user = this._userById(session.userId);
    if (!user) {
      this.sessions.delete(token);
      this._scheduleSave();
      return null;
    }
    return this._publicUser(user);
  }

  destroySession(token) {
    if (typeof token === 'string' && this.sessions.delete(token)) this._scheduleSave();
  }
  // Records a finish time; keeps only each user's best (lowest) ms per map.
  // Returns the current top-10 board for that map.
  submitTime(user, ms, map = DEFAULT_MAP, trace = null, summary = null, car = null, variant = null) {
    if (!Number.isInteger(ms) || ms < TIME_MIN_MS || ms > TIME_MAX_MS) {
      throw new StoreError(400, 'invalid_ms', `ms must be an integer between ${TIME_MIN_MS} and ${TIME_MAX_MS}`);
    }
    if (typeof map !== 'string' || !MAP_RE.test(map)) {
      throw new StoreError(400, 'invalid_map', 'map must match [a-z0-9_-]{1,32}');
    }
    const at = new Date().toISOString();
    this.db.laps.push({
      userId: user.id, username: user.username, ms, at, map,
      summary: summary ?? null, car, variant,
    });
    if (this.db.laps.length > 5000) this.db.laps.splice(0, this.db.laps.length - 5000);

    const shortTrace = this._shortTrace(trace);
    const best = this.db.times.find((t) => t.userId === user.id && t.map === map);
    if (best) {
      if (ms >= best.ms) {
        this._scheduleSave();
        return this.topTimes(map); // not an improvement, but the lap is logged
      }
      best.ms = ms;
      best.at = at;
      best.summary = summary ?? null;
      best.trace = shortTrace;
      best.car = car;
      best.variant = variant;
    } else {
      this.db.times.push({
        userId: user.id, username: user.username, ms, at, map,
        summary: summary ?? null, trace: shortTrace, car, variant,
      });
    }
    this._scheduleSave();
    return this.topTimes(map);
  }

  /** Keep the best lap's line small enough for db.json, for future replays. */
  _shortTrace(trace) {
    if (!Array.isArray(trace) || trace.length === 0) return null;
    const step = Math.max(1, Math.ceil(trace.length / 240));
    const out = [];
    // [x, z, t, heading|null, event?] — heading feeds the ghost car's nose,
    // event marks ('blink'/'power') every power it used. [3] stays aligned
    // even when a point has no heading, so [4] keeps its meaning.
    const push = (p) => {
      const a = [Math.round(p.x * 100) / 100, Math.round(p.z * 100) / 100, Math.round(p.t)];
      a.push(Number.isFinite(p.h) ? Math.round(p.h * 100) / 100 : null);
      if (p.e) a.push(p.e);
      out.push(a);
    };
    // event points ride along even when the step skips them; kept in t order
    for (let i = 0; i < trace.length; i++) {
      if (i % step === 0 || trace[i].e) push(trace[i]);
    }
    const last = trace[trace.length - 1];
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== Math.round(last.x * 100) / 100 || prev[1] !== Math.round(last.z * 100) / 100) {
      push(last);
    }
    return out;
  }

  /** Admin dashboard aggregates. mapNames maps ids to display names. */
  stats(mapNames = {}) {
    const players = new Map();
    const maps = new Map();
    const cars = new Map();
    for (const lap of this.db.laps) {
      let p = players.get(lap.username);
      if (!p) {
        p = { username: lap.username, laps: 0, bestMs: null, bestMap: null };
        players.set(lap.username, p);
      }
      p.laps++;
      if (p.bestMs === null || lap.ms < p.bestMs) {
        p.bestMs = lap.ms;
        p.bestMap = lap.map;
      }
      let m = maps.get(lap.map);
      if (!m) {
        m = {
          id: lap.map, name: mapNames[lap.map] ?? lap.map, laps: 0, msSum: 0,
          bestMs: null, bestUser: null, lastAt: null, players: new Set(),
        };
        maps.set(lap.map, m);
      }
      m.laps++;
      m.msSum += lap.ms;
      m.players.add(lap.username);
      if (m.bestMs === null || lap.ms < m.bestMs) {
        m.bestMs = lap.ms;
        m.bestUser = lap.username;
      }
      if (!m.lastAt || lap.at > m.lastAt) m.lastAt = lap.at;

      if (lap.car) {
        let c = cars.get(lap.car);
        if (!c) {
          c = { car: lap.car, laps: 0, msSum: 0, bestMs: null, bestUser: null, players: new Set() };
          cars.set(lap.car, c);
        }
        c.laps++;
        c.msSum += lap.ms;
        c.players.add(lap.username);
        if (c.bestMs === null || lap.ms < c.bestMs) {
          c.bestMs = lap.ms;
          c.bestUser = lap.username;
        }
      }
    }

    const mapRows = [...maps.values()]
      .map((m) => ({
        id: m.id, name: m.name, laps: m.laps, players: m.players.size,
        avgMs: Math.round(m.msSum / m.laps), bestMs: m.bestMs,
        bestUser: m.bestUser, lastAt: m.lastAt,
      }))
      .sort((a, b) => b.laps - a.laps);

    const recent = [...this.db.laps]
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, 15)
      .map((l) => ({
        username: l.username, map: l.map, ms: l.ms, at: l.at, car: l.car ?? null,
        avgSpeed: l.summary?.avgSpeed ?? null, pathLength: l.summary?.pathLength ?? null,
      }));

    const carRows = [...cars.values()]
      .map((c) => ({
        car: c.car, laps: c.laps, players: c.players.size,
        bestMs: c.bestMs, bestUser: c.bestUser, avgMs: Math.round(c.msSum / c.laps),
      }))
      .sort((a, b) => b.laps - a.laps || a.bestMs - b.bestMs);

    const playerRows = [...players.values()].sort((a, b) => a.bestMs - b.bestMs);
    let bestLap = null;
    for (const lap of this.db.laps) if (!bestLap || lap.ms < bestLap.ms) bestLap = lap;

    return {
      generatedAt: new Date().toISOString(),
      totalLaps: this.db.laps.length,
      totalPlayers: players.size,
      totalMaps: maps.size,
      bestLap: bestLap ? {
        username: bestLap.username, map: bestLap.map, ms: bestLap.ms, at: bestLap.at,
      } : null,
      players: playerRows,
      maps: mapRows,
      cars: carRows,
      recent,
    };
  }

  /** Admin moderation: drop one player's best on one map. */
  deleteTime(map, username) {
    if (typeof map !== 'string' || !MAP_RE.test(map)) {
      throw new StoreError(400, 'invalid_map', 'map must match [a-z0-9_-]{1,32}');
    }
    if (typeof username !== 'string' || username === '') {
      throw new StoreError(400, 'invalid_username', 'username required');
    }
    const before = this.db.times.length;
    this.db.times = this.db.times.filter((t) => !(t.map === map && t.username === username));
    this.db.laps = this.db.laps.filter((l) => !(l.map === map && l.username === username));
    if (this.db.times.length !== before) this._scheduleSave();
    return { removed: before - this.db.times.length, times: this.topTimes(map) };
  }

  /** Admin moderation: wipe a map's board. */
  clearTimes(map) {
    if (typeof map !== 'string' || !MAP_RE.test(map)) {
      throw new StoreError(400, 'invalid_map', 'map must match [a-z0-9_-]{1,32}');
    }
    const before = this.db.times.length;
    this.db.times = this.db.times.filter((t) => t.map !== map);
    this.db.laps = this.db.laps.filter((l) => l.map !== map);
    if (this.db.times.length !== before) this._scheduleSave();
    return { removed: before - this.db.times.length, times: this.topTimes(map) };
  }

  topTimes(map = DEFAULT_MAP, limit = 10) {
    return this.db.times
      .filter((t) => t.map === map)
      .sort((a, b) => a.ms - b.ms)
      .slice(0, limit)
      .map((t, i) => ({ rank: i + 1, username: t.username, ms: t.ms, at: t.at }));
  }

  /** A player's own anticheat-validated best ms per map: the source of truth
      for the stats page, which never trusts the browser's local values. */
  bestsFor(userId) {
    const bests = {};
    for (const t of this.db.times) {
      if (t.userId === userId && !(t.map in bests)) bests[t.map] = t.ms;
    }
    return bests;
  }
}
