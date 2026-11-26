/* src/account.ts — tiny account store + leaderboard API client.
   All calls are same-origin against the Vite-proxied /api and never throw:
   network/server failures surface as `offline` (refresh) or an `error`
   message (login/signup/logout). */

export interface User { id: string; username: string; role?: 'admin' | 'player' }
export interface TimeEntry { rank: number; username: string; ms: number; at: string }
export interface LapTracePoint {
  x: number;
  z: number;
  t: number;
  /** power event mark; 'blink' is a WORMHOLE placement frame */
  e?: 'blink';
}

export interface AccountResult { ok: boolean; error?: string }
export interface SubmitResult { ok: boolean; rank?: number; improved?: boolean; error?: string }
export interface AdminResult { ok: boolean; removed?: number; error?: string }

/** Public availability of the server's gated features (true = everyone sees it). */
export interface Features { ghost?: boolean; [name: string]: boolean | undefined }

/** The rank-1 lap for one map, replayed as a ghost car. Stored traces are
    compact [x, z, t] triples; t is ms from the lap's start. */
export interface GhostLap {
  username: string;
  ms: number;
  trace: number[][] | LapTracePoint[];
  car?: string | null;
  variant?: number | null;
}

/* Laps the server never answered. A dropped connection, a redeploy or a session
   that expired mid-race used to lose the lap outright — the driver saw a
   two-second warning and the time was gone. They wait here and go out again on
   the next login or the next saved lap; a lap the server actually *rejected* is
   answered business, not retried. */
interface PendingLap {
  ms: number;
  trace: LapTracePoint[];
  map: string;
  car?: string;
  variant?: number;
}

const PENDING_KEY = 'pixel-drift:pending-laps';
const PENDING_MAX = 8;   // a session's worth; older laps age out first

function readPending(): PendingLap[] {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? (list as PendingLap[]) : [];
  } catch {
    return [];   // unreadable (private mode, hand-edited): start clean
  }
}

function writePending(list: PendingLap[]): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(-PENDING_MAX)));
  } catch { /* private mode: the lap is lost, same as before */ }
}

/* server rules (server/store.mjs) */
const USERNAME_RE = /^[a-z0-9_]{3,16}$/;
const PASSWORD_MIN = 8;
const MS_MIN = 1000;   // trusted times; the server allows any real lap
const MS_MAX = 1800000;

const OFFLINE_MSG = 'cannot reach the server';

function humanError(status: number, code?: string): string {
  switch (status) {
    case 400:
      if (code === 'invalid_username') return 'username must be 3-16 chars: a-z, 0-9, _';
      if (code === 'invalid_password') return 'password must be at least 8 characters';
      return 'invalid input';
    case 401: return 'wrong username or password';
    case 409: return 'that username is taken';
    case 429: return 'too many attempts, wait a minute';
    default: return 'server error, try again';
  }
}

interface Read<T> { ok: boolean; status: number; body?: T }

/** fetch wrapper: resolves for every outcome, rejects nothing. status 0 = network. */
async function request<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<Read<T>> {
  try {
    const r = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.status === 204) return { ok: true, status: 204 };
    let parsed: T | undefined;
    try { parsed = (await r.json()) as T; } catch { /* empty or non-JSON body */ }
    return { ok: r.ok, status: r.status, body: parsed };
  } catch {
    return { ok: false, status: 0 };
  }
}

export const account = {
  user: null as User | null,
  /** board the current `times` belong to; one board per map */
  map: 'coast',
  times: [] as TimeEntry[],
  /** gated features the server made public, and this map's ghost payload */
  features: null as Features | null,
  ghost: null as GhostLap | null,
  offline: false,
  busy: false,

  /** Load session + the leaderboard for one map. A 401 just means signed
      out; only a network/5xx failure flips `offline`. */
  async refresh(map?: string): Promise<void> {
    this.busy = true;
    const boardMap = map ?? this.map;
    const sameMap = boardMap === this.map;
    this.map = boardMap;
    let offline = false;
    let user: User | null = null;
    let times: TimeEntry[] = sameMap ? this.times : [];

    const me = await request<{ user?: User | null; features?: Features }>('/api/me', 'GET');
    if (me.status === 0 || me.status >= 500) offline = true;
    else if (me.ok) user = me.body?.user ?? null;

    const board = await request<{ times?: TimeEntry[]; features?: Features; ghost?: GhostLap }>(
      `/api/times?map=${encodeURIComponent(boardMap)}`, 'GET',
    );
    if (board.status === 0 || board.status >= 500) offline = true;
    else if (board.ok) {
      times = board.body?.times ?? [];
      // the board answers for one map: a missing ghost belongs to that map too
      this.ghost = board.body?.ghost ?? null;
      this.features = board.body?.features ?? me.body?.features ?? this.features;
    } else if (me.ok) {
      this.features = me.body?.features ?? this.features;
      this.ghost = null;
    }

    this.user = user;
    this.times = times;
    this.offline = offline;
    this.busy = false;
  },

  async login(username: string, password: string): Promise<AccountResult> {
    return authPost('/api/login', username, password);
  },

  async signup(username: string, password: string): Promise<AccountResult> {
    return authPost('/api/signup', username, password);
  },

  async logout(): Promise<AccountResult> {
    this.busy = true;
    const r = await request<unknown>('/api/logout', 'POST');
    this.busy = false;
    if (!r.ok) return { ok: false, error: OFFLINE_MSG };
    this.user = null;
    return { ok: true };
  },

  /** Admin only: delete one player's best time on the current board. */
  async adminDeleteTime(map: string, username: string): Promise<AdminResult> {
    return this.adminPost('/api/admin/delete-time', { map, username });
  },

  /** Admin only: wipe one map's board. */
  async adminClearMap(map: string): Promise<AdminResult> {
    return this.adminPost('/api/admin/clear-map', { map });
  },

  /** Admin only: flip one gated feature's public availability. */
  async adminSetFeature(feature: string, enabled: boolean): Promise<AdminResult> {
    const r = await request<{ features?: Features }>('/api/admin/feature', 'POST', { feature, enabled });
    if (r.status === 401) this.user = null;
    if (!r.ok) {
      const error = r.status === 403 ? 'admin only' : 'request failed';
      return { ok: false, error };
    }
    this.features = r.body?.features ?? this.features;
    return { ok: true };
  },

  async adminPost(path: string, body: Record<string, string>): Promise<AdminResult> {
    const r = await request<{ times?: TimeEntry[]; removed?: number }>(path, 'POST', body);
    if (r.status === 401) this.user = null;
    if (!r.ok) {
      const error = r.status === 403 ? 'admin only' : 'request failed';
      return { ok: false, error };
    }
    this.times = r.body?.times ?? [];
    // the board moved and this answer carries no line: a ghost from the row
    // that just went away must not keep racing until the next refresh
    this.ghost = null;
    return { ok: true, removed: r.body?.removed };
  },

  /** Post a lap time with its replay trace for one map. Silent no-op when
      signed out or out of range; the board (`times`) refreshes from the
      POST response. `meta` tags the car for the data desk. */
  async submitLap(
    ms: number,
    trace: LapTracePoint[],
    map?: string,
    meta?: { car: string; variant: number },
  ): Promise<SubmitResult> {
    if (!this.user) return { ok: false, error: 'sign in to save times' };
    if (!Number.isInteger(ms) || ms < MS_MIN || ms > MS_MAX) {
      return { ok: false, error: 'lap time out of range' };
    }
    const lapMap = map ?? this.map;
    const name = this.user.username;
    const previousBest = this.times.find((t) => t.username === name)?.ms;
    const r = await request<{ times?: TimeEntry[]; error?: string; reason?: string }>(
      '/api/times', 'POST', { ms, trace, map: lapMap, car: meta?.car, variant: meta?.variant },
    );
    if (!r.ok) {
      if (r.status === 401) this.user = null;   // session expired mid-race
      // no answer at all (offline, redeploy) or signed out mid-lap: the lap is
      // still a lap, so keep it and send it again rather than dropping it
      if (r.status === 0 || r.status === 401 || r.status >= 500) {
        writePending([...readPending(), { ms, trace, map: lapMap, car: meta?.car, variant: meta?.variant }]);
        return { ok: false, error: 'LAP NOT SAVED · WILL RETRY' };
      }
      const reason = typeof r.body?.reason === 'string' ? r.body.reason : 'lap not saved';
      return { ok: false, error: `LAP NOT SAVED · ${reason.toUpperCase()}` };
    }
    const times = r.body?.times ?? [];
    this.map = lapMap;
    this.times = times;
    const mine = times.find((t) => t.username === name && t.ms === ms);
    return { ok: true, rank: mine?.rank, improved: previousBest === undefined || ms < previousBest };
  },

  /** Send the laps that never got an answer. Returns how many landed. */
  async flushPending(): Promise<number> {
    if (!this.user) return 0;      // they wait for a session that can carry them
    const list = readPending();
    if (!list.length) return 0;
    const left: PendingLap[] = [];
    let landed = 0;
    for (const lap of list) {
      const r = await request<{ times?: TimeEntry[] }>('/api/times', 'POST', lap);
      if (r.ok) {
        landed++;
        // the response carries the board for the lap's own map: only take it
        // when that is the board on screen
        if (lap.map === this.map) this.times = r.body?.times ?? this.times;
        continue;
      }
      // still no answer: keep it. An answered rejection is a finished lap.
      if (r.status === 0 || r.status === 401 || r.status >= 500) left.push(lap);
    }
    writePending(left);
    return landed;
  },
};

async function authPost(path: string, username: string, password: string): Promise<AccountResult> {
  /* validate up front for instant feedback (mirrors the server rules) */
  if (!USERNAME_RE.test(username)) {
    return { ok: false, error: 'username must be 3-16 chars: a-z, 0-9, _' };
  }
  if (password.length < PASSWORD_MIN) {
    return { ok: false, error: 'password must be at least 8 characters' };
  }
  account.busy = true;
  const r = await request<{ user?: User; error?: string }>(path, 'POST', {
    username, password,
  });
  account.busy = false;
  if (!r.ok) {
    return { ok: false, error: r.status === 0 ? OFFLINE_MSG : humanError(r.status, r.body?.error) };
  }
  account.user = r.body?.user ?? null;
  account.offline = false;
  void account.refresh(account.map);   // board may only be reachable now that we are online
  return { ok: true };
}
