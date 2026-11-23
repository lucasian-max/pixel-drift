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
export const TIME_MIN_MS = 15_000;
export const TIME_MAX_MS = 1_800_000;
export const DEFAULT_MAP = 'coast';
export const MAP_RE = /^[a-z0-9_-]{1,32}$/;

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

export function emptyDb() {
  return { users: [], sessions: {}, times: [] };
}

export class Store {
  constructor(dataPath) {
    this.dataPath = dataPath;
    this.db = emptyDb();
    this.sessions = new Map(); // token -> { userId, expires }
    this._timer = null;
    this._dirty = false;
    this._load();
    fs.mkdirSync(path.dirname(this.dataPath), { recursive: true });
  }

  // ---- persistence ---------------------------------------------------------

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
    };
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

  // ---- users ---------------------------------------------------------------

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
      createdAt: new Date().toISOString(),
    };
    this.db.users.push(user);
    this._scheduleSave();
    return { id: user.id, username: user.username };
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
    return { id: user.id, username: user.username };
  }

  // ---- sessions --------------------------------------------------------------

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
    return { id: user.id, username: user.username };
  }

  destroySession(token) {
    if (typeof token === 'string' && this.sessions.delete(token)) this._scheduleSave();
  }

  // ---- leaderboard -----------------------------------------------------------

  // Records a finish time; keeps only each user's best (lowest) ms per map.
  // Returns the current top-10 board for that map.
  submitTime(user, ms, map = DEFAULT_MAP) {
    if (!Number.isInteger(ms) || ms < TIME_MIN_MS || ms > TIME_MAX_MS) {
      throw new StoreError(400, 'invalid_ms', `ms must be an integer between ${TIME_MIN_MS} and ${TIME_MAX_MS}`);
    }
    if (typeof map !== 'string' || !MAP_RE.test(map)) {
      throw new StoreError(400, 'invalid_map', 'map must match [a-z0-9_-]{1,32}');
    }
    const at = new Date().toISOString();
    const best = this.db.times.find((t) => t.userId === user.id && t.map === map);
    if (best) {
      if (ms >= best.ms) return this.topTimes(map); // not an improvement
      best.ms = ms;
      best.at = at;
    } else {
      this.db.times.push({ userId: user.id, username: user.username, ms, at, map });
    }
    this._scheduleSave();
    return this.topTimes(map);
  }

  topTimes(map = DEFAULT_MAP, limit = 10) {
    return this.db.times
      .filter((t) => t.map === map)
      .sort((a, b) => a.ms - b.ms)
      .slice(0, limit)
      .map((t, i) => ({ rank: i + 1, username: t.username, ms: t.ms, at: t.at }));
  }
}
