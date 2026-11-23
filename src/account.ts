/* src/account.ts — tiny account store + leaderboard API client.
   All calls are same-origin against the Vite-proxied /api and never throw:
   network/server failures surface as `offline` (refresh) or an `error`
   message (login/signup/logout). */

export interface User { id: string; username: string }
export interface TimeEntry { rank: number; username: string; ms: number; at: number }

export interface AccountResult { ok: boolean; error?: string }
export interface SubmitResult { ok: boolean; rank?: number }

/* server rules (server/store.mjs) */
const USERNAME_RE = /^[a-z0-9_]{3,16}$/;
const PASSWORD_MIN = 8;
const MS_MIN = 15000;
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
  times: [] as TimeEntry[],
  offline: false,
  busy: false,

  /** Load session + leaderboard. A 401 just means signed out; only a
      network/5xx failure flips `offline`. */
  async refresh(): Promise<void> {
    this.busy = true;
    let offline = false;
    let user: User | null = null;
    let times = this.times;

    const me = await request<{ user?: User | null }>('/api/me', 'GET');
    if (me.status === 0 || me.status >= 500) offline = true;
    else if (me.ok) user = me.body?.user ?? null;

    const board = await request<{ times?: TimeEntry[] }>('/api/times', 'GET');
    if (board.status === 0 || board.status >= 500) offline = true;
    else if (board.ok) times = board.body?.times ?? [];

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

  /** Post a lap time. Silent no-op when signed out or out of range; the
      board (`times`) refreshes from the POST response. */
  async submitLap(ms: number): Promise<SubmitResult> {
    if (!this.user) return { ok: false };
    if (!Number.isInteger(ms) || ms < MS_MIN || ms > MS_MAX) return { ok: false };
    const name = this.user.username;
    const r = await request<{ times?: TimeEntry[] }>('/api/times', 'POST', { ms });
    if (!r.ok) {
      if (r.status === 401) this.user = null;   // session expired mid-race
      return { ok: false };
    }
    const times = r.body?.times ?? [];
    this.times = times;
    const mine = times.find((t) => t.username === name && t.ms === ms);
    return { ok: true, rank: mine?.rank };
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
  void account.refresh();   // board may only be reachable now that we are online
  return { ok: true };
}
