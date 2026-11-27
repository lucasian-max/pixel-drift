import type { Car } from './car';
import type { TimeEntry, User } from './account';
import { CAR_POWERS, powerColour } from './powers';
/* the map cards draw every circuit's shape, not just the one you are on: the
   control polygons are the only thing this needs, and they are already loaded */
import { MAPS } from './world';

const CREAM = '#f2eee1';
const INK = '#14161a';
const ACCENT = '#e0513f';

const DIM = 'rgba(242,238,225,0.55)';
const INKD = 'rgba(20,22,26,0.55)';
const SLAB = 'rgba(43,43,51,0.88)';
const LINE = 'rgba(242,238,225,0.22)';
const SEG_OFF = 'rgba(242,238,225,0.14)';
const SEG_RED_OFF = 'rgba(224,81,63,0.22)';
const RULE = 'rgba(20,22,26,0.18)';
const SHADOW = 'rgba(8,10,12,0.8)';
const HINT = 'rgba(242,238,225,0.58)';
const ASPHALT = '#2b2b33';

export interface AccountView {
  user: User | null;
  times: TimeEntry[];
  offline: boolean;
  busy: boolean;
}

export interface UiState {
  car: Car;
  lapTime: number;
  bestTime: number;
  started: boolean;
  paused: boolean;
  laps: number;
  /** parked on the line before the lap timer starts: C may swap cars */
  atLine?: boolean;
  /** chase camera lock state: false means the player orbited away */
  camLocked?: boolean;
  /** TUNNEL aim mode: the sim is frozen, the player is placing the car */
  aiming?: boolean;
  maps?: { id: string; name: string }[];
  mapIndex?: number;
  mapName?: string;
  carNames?: string[];
  /** garage ratings for the selected car, from ./carStats: 1..10 per axis */
  carStatRows?: { label: string; rating: number; best: boolean }[];
  /** one-word identity shown beside the power name in the garage */
  carClass?: string;
  power?: {
    name: string; active: boolean; ready: boolean;
    cd: number; time: number; duration: number; cooldown: number; color: string; charge?: number;
  };
  garage?: boolean;
  powerInfo?: boolean;
  /** the player's own settings modal, from the title's SETTINGS button */
  settings?: boolean;
  /** one chip row per player-tunable thing, hit id setting-${name}; a row
      with `value` is a cycler (chip shows the value, click advances it) */
  settingsRows?: { name: string; label: string; on: boolean; value?: string }[];
  /** lifetime + personal numbers for the modal's stats block: seconds and ms
      per field, 0 best = none yet */
  stats?: {
    maps: { map: string; best: number }[];
    pbAvg: number;          // mean of the bests that exist
    laps: number;           // completed laps, lifetime
    driveMs: number;        // summed lap clocks, lifetime
    favCar: string;         // the car with the most laps, '—' before any
  };
  /** the full-board modal: one map per page, every ranked player, the whole
      username. Pages flip with the tabs or A/D; the wheel scrolls rows. */
  fullBoard?: {
    maps: { id: string; name: string; rows: { rank: number; username: string; ms: number }[] }[];
    page: number;            // which map is on show (index into maps)
    scroll: number;          // rows scrolled past, clamped by the caller
    offline: boolean;
    me: string;             // uppercase own username, '' when signed out
  };
  /** the title leaderboard panel is a choice now: false hides it */
  board?: boolean;
  powerBlurb?: string;
  powerEffect?: string;
  powerDuration?: number;
  powerCooldown?: number;
  adminPanel?: boolean;
  adminConfirm?: boolean;
  adminUpload?: string;
  warning?: string;
  notice?: string;
  /** the lap just completed, in a small bar at the bottom: ms is the lap
      time, pb a new personal best, delta the gap to the old best */
  lapBar?: { ms: number; pb: boolean; delta: number | null; a: number };
  offTrack?: boolean;
  /** the ghost car is inside one of the record's power windows: the power's
      name, shown in a chip so the burst on the ghost reads as an event */
  ghostPower?: string;
  bestFlash?: boolean;
  account?: AccountView;
}

const fmt = (t: number) => {
  if (!isFinite(t) || t <= 0) return '--:--.--';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t * 100) % 100);
  return `${m}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
};

/** hours:minutes:seconds, minutes:seconds under an hour — lifetime driving time */
const fmtDur = (ms: number) => {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

const fmtMs = (ms: number) => {
  if (!isFinite(ms) || ms <= 0) return '--:--.--';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `${m}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
};

function pxRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string) {
  c.fillStyle = fill;
  c.fillRect(x + 1, y, w - 2, h);
  c.fillRect(x, y + 1, w, h - 2);
}
function pxBorder(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string) {
  c.fillStyle = col;
  c.fillRect(x + 1, y, w - 2, 1);
  c.fillRect(x + 1, y + h - 1, w - 2, 1);
  c.fillRect(x, y + 1, 1, h - 2);
  c.fillRect(x + w - 1, y + 1, 1, h - 2);
}

export type HitId = 'prev-car' | 'next-car' | 'solo' | 'login' | 'logout'
  | 'power-info' | 'garage' | 'garage-back' | 'menu'
  | 'admin' | 'admin-close' | 'admin-clear' | 'admin-dashboard' | 'admin-upload' | `admin-del-${number}`
  | 'settings' | `setting-${string}`
  | 'board-all' | 'fullboard-close' | `fb-map-${string}` | `pick-map-${string}`;

interface Button { id: HitId; x: number; y: number; w: number; h: number; label: string }

export class PixelUI {
  private ctx: CanvasRenderingContext2D;
  private w = 576;
  private h = 360;

  private mapPts: Float32Array;
  private mapCX = 0; private mapCZ = 0; private mapExt = 1;
  private tickX = 0; private tickZ = 0; private tickNX = 0; private tickNZ = 0;

  private bCarPrev: Button = { id: 'prev-car', x: 0, y: 0, w: 24, h: 24, label: '<' };
  private bCarNext: Button = { id: 'next-car', x: 0, y: 0, w: 24, h: 24, label: '>' };
  private bInfo: Button = { id: 'power-info', x: 0, y: 0, w: 70, h: 12, label: 'POWER INFO' };
  private bGarage: Button = { id: 'garage', x: 0, y: 0, w: 64, h: 12, label: 'VIEW CAR' };
  private bGarageBack: Button = { id: 'garage-back', x: 0, y: 0, w: 48, h: 14, label: 'BACK' };
  private bSettings: Button = { id: 'settings', x: 0, y: 0, w: 66, h: 14, label: 'SETTINGS' };
  private bSolo: Button = { id: 'solo', x: 0, y: 0, w: 148, h: 28, label: 'SOLO' };
  private bMenu: Button = { id: 'menu', x: 0, y: 0, w: 66, h: 18, label: 'M MENU' };
  private bLogin: Button = { id: 'login', x: 0, y: 0, w: 72, h: 14, label: 'SIGN IN' };
  private bLogout: Button = { id: 'logout', x: 0, y: 0, w: 72, h: 14, label: 'SIGN OUT' };
  private bAdmin: Button = { id: 'admin', x: 0, y: 0, w: 62, h: 14, label: 'ADMIN' };
  private bAdminClear: Button = { id: 'admin-clear', x: 0, y: 0, w: 104, h: 16, label: 'CLEAR BOARD' };
  private bAdminDash: Button = { id: 'admin-dashboard', x: 0, y: 0, w: 104, h: 16, label: 'DASHBOARD' };
  private bAdminUpload: Button = { id: 'admin-upload', x: 0, y: 0, w: 120, h: 16, label: 'UPLOAD RUNS' };
  private bAdminClose: Button = { id: 'admin-close', x: 0, y: 0, w: 58, h: 16, label: 'CLOSE' };
  private buttons: Button[] = [];

  private lastBest = -1;
  private bestUntil = -1;

  /** when the title's entrance timeline started, and the last clock seen */
  private titleAt = -1;
  private now = 0;
  /** pressed chip and the frame it went down: three frames down, one past */
  private pressId: string | null = null;
  private pressAt = -1;
  /** pointer in client space, resolved to a hit id at the end of each draw */
  private hx = -1;
  private hy = -1;
  private hoverId: string | null = null;
  /** the corner menu (account, admin, settings, power) is the UI's own state */
  private menuOpen = false;
  private menuAt = -1;
  private wasStarted = false;
  private wasGarage = false;
  /** the checker wipe between the title and the race */
  private wipeAt = -1;
  /** each circuit's outline, normalised, built once for the map cards */
  private outlines = new Map<string, { pts: Float32Array; ext: number; dot: boolean }>();

  /** the garage's power-demo window, in canvas pixels, or null when no demo is
      on screen. src/main.ts parks the power clip over exactly this rect, so the
      film and the animation it falls back to cover the same ground. */
  demoWindow: { x: number; y: number; w: number; h: number } | null = null;

  onAction?: (a: HitId) => void;

  constructor(private canvas: HTMLCanvasElement, track: { x: number; z: number }[], start?: { x: number; z: number }) {
    this.ctx = canvas.getContext('2d')!;

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of track) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
    }
    this.mapCX = (minX + maxX) / 2;
    this.mapCZ = (minZ + maxZ) / 2;
    this.mapExt = Math.max(maxX - minX, maxZ - minZ, 1);

    this.mapPts = new Float32Array(track.length * 2);
    for (let i = 0; i < track.length; i++) {
      this.mapPts[i * 2] = (track[i].x - this.mapCX) / this.mapExt;
      this.mapPts[i * 2 + 1] = (track[i].z - this.mapCZ) / this.mapExt;
    }

    const sp = start ?? track[0];
    let si = 0, sbd = Infinity;
    for (let i = 0; i < track.length; i++) {
      const d = (track[i].x - sp.x) ** 2 + (track[i].z - sp.z) ** 2;
      if (d < sbd) { sbd = d; si = i; }
    }
    const a = track[si], b = track[(si + 1) % track.length] ?? a;
    let dx = b.x - a.x, dz = b.z - a.z;
    const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    this.tickX = (a.x - this.mapCX) / this.mapExt;
    this.tickZ = (a.z - this.mapCZ) / this.mapExt;
    this.tickNX = -dz; this.tickNZ = dx;

    this.resize();

    /* hover and press are the UI's own business: #ui is pointer-events:none, so
       the probes ride the window, and they only ever read this.buttons — the
       same rects the frame was drawn with, never a second guess at them */
    addEventListener('pointermove', (e) => { this.hx = e.clientX; this.hy = e.clientY; });
    addEventListener('pointerdown', (e) => {
      this.hx = e.clientX; this.hy = e.clientY;
      const id = this.hitIdAt(e.clientX, e.clientY);
      if (!id) { this.menuOpen = false; return; }
      this.pressId = id;
      this.pressAt = -1;
      if (id !== 'menu') this.menuOpen = false;
    }, true);
  }

  /** the corner menu is drawn and hit-tested here: main.ts only forwards the
      press, so nothing about it can touch the race */
  toggleMenu() {
    this.menuOpen = !this.menuOpen;
    this.menuAt = this.now;
  }

  resize() {
    this.w = this.canvas.width;
    this.h = this.canvas.height;
    this.ctx.imageSmoothingEnabled = false;
  }

  private font(size: number, weight = 400) {
    this.ctx.font = `${weight} ${size}px Silkscreen, ui-monospace, monospace`;
  }

  /** glyph width at the spacing the text will actually be drawn with */
  private measure(s: string, size: number, weight: number, spacing = 0) {
    const c = this.ctx;
    this.font(size, weight);
    c.letterSpacing = `${spacing}px`;
    const wide = c.measureText(s).width;
    c.letterSpacing = '0px';
    return Math.ceil(wide);
  }

  private text(s: string, x: number, y: number, o: {
    size?: number; weight?: number; color?: string; align?: CanvasTextAlign; baseline?: CanvasTextBaseline;
    spacing?: number;
  } = {}) {
    const c = this.ctx;
    this.font(o.size ?? 8, o.weight ?? 400);
    c.letterSpacing = `${o.spacing ?? 0}px`;
    c.fillStyle = o.color ?? CREAM;
    c.textAlign = o.align ?? 'left';
    c.textBaseline = o.baseline ?? 'top';
    c.fillText(s, x, y);
    c.letterSpacing = '0px';
  }

  /** the id under a client-space point, against the rects the last frame drew */
  private hitIdAt(clientX: number, clientY: number): HitId | null {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const x = ((clientX - r.left) / r.width) * this.w;
    const y = ((clientY - r.top) / r.height) * this.h;
    for (const b of this.buttons) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.id;
    }
    return null;
  }

  hit(clientX: number, clientY: number): HitId | null {
    return this.hitIdAt(clientX, clientY);
  }

  draw(state: UiState, time: number) {
    const c = this.ctx;
    this.now = time;
    this.demoWindow = null;
    c.clearRect(0, 0, this.w, this.h);
    c.imageSmoothingEnabled = false;

    /* crossing between the title and the race is a change of screen, not a
       fade: the checker wipe runs out and the entrance replays behind it */
    if (state.started !== this.wasStarted) {
      this.wipeAt = time;
      this.menuOpen = false;
      this.titleAt = -1;
      this.wasStarted = state.started;
    }
    if (!!state.garage !== this.wasGarage) {
      this.titleAt = -1;
      this.wasGarage = !!state.garage;
    }

    if (state.adminPanel) {
      this.drawAdminPanel(state);
      this.drawWipe(time);
      return;
    }

    if (!state.started) {
      if (state.garage) this.drawGarage(state);
      else this.drawTitle(time, state);
      this.drawWipe(time);
      /* a clip over the demo window would sit on top of the wipe's chequers */
      if (this.wipeAt >= 0) this.demoWindow = null;
      return;
    }
    this.buttons.length = 0;

    const car = state.car;
    const kmh = Math.round(Math.abs(car.speed) * 3.6);
    const gear = car.speed < -0.5 ? 'R' : Math.min(6, 1 + Math.floor(kmh / 22)).toString();

    // NEW BEST: auto-detected from bestTime drops, or forced via bestFlash.
    const best = state.bestTime;
    if (this.lastBest < 0) this.lastBest = best;
    else {
      if (isFinite(best) && best > 0 && (this.lastBest <= 0 || best < this.lastBest - 1e-6)) {
        this.bestUntil = time + 2.6;
      }
      this.lastBest = best;
    }
    if (state.bestFlash) this.bestUntil = Math.max(this.bestUntil, time + 2.6);

    const tx = 8, ty = 16, tw = 136, th = 46;
    pxRect(c, tx, ty, tw, th, CREAM);
    c.fillStyle = ACCENT;
    c.fillRect(tx, ty + 3, 3, th - 6);
    const lapLabel = 'LAP ' + Math.min(99, state.laps + 1).toString().padStart(2, '0');
    this.font(8, 700);
    const lapW = Math.ceil(c.measureText(lapLabel).width) + 14;
    pxRect(c, tx + 2, ty - 9, lapW, 11, ACCENT);
    this.text(lapLabel, tx + 2 + lapW / 2, ty - 7, { size: 8, weight: 700, color: CREAM, align: 'center' });
    this.text('TIME', tx + 10, ty + 7, { size: 8, color: INKD });
    this.text(fmt(state.lapTime), tx + tw - 8, ty + 4, { size: 16, weight: 700, color: INK, align: 'right' });
    c.fillStyle = RULE;
    c.fillRect(tx + 8, ty + 27, tw - 14, 1);
    this.text('BEST', tx + 10, ty + 31, { size: 8, color: INKD });
    this.text(fmt(state.bestTime), tx + tw - 8, ty + 31, { size: 8, color: INK, align: 'right' });

    const dw = 88, dh = 38, dx = this.w - dw - 8, dy = 34;
    const drifting = car.drifting;
    pxRect(c, dx, dy, dw, dh, drifting ? ACCENT : SLAB);
    pxBorder(c, dx, dy, dw, dh, drifting
      ? ((time * 9) % 2 < 1 ? 'rgba(242,238,225,1)' : 'rgba(242,238,225,0.45)')
      : 'rgba(242,238,225,0.25)');
    this.text('DRIFT', dx + 6, dy + 4, { size: 8, color: drifting ? CREAM : DIM });
    this.text(String(Math.round(car.driftScore)), dx + dw - 6, dy + 12, {
      size: 16, weight: 700, color: CREAM, align: 'right',
    });
    const bw = dw - 12;
    c.fillStyle = drifting ? 'rgba(242,238,225,0.2)' : SEG_OFF;
    c.fillRect(dx + 6, dy + 30, bw, 3);
    const slipFrac = Math.min(1, car.slip / 8);
    if (slipFrac > 0) {
      c.fillStyle = drifting ? CREAM : DIM;
      c.fillRect(dx + 6, dy + 30, Math.max(1, Math.round(bw * slipFrac)), 3);
    }

    /* the banner and the key chips share the top edge: the chips are right
       aligned and may not reach back over the banner, so they measure against
       its right edge before deciding how much they can say */
    const bannerW = Math.min(180, this.w - 230);
    const bannerRight = Math.round((this.w - bannerW) / 2) + bannerW + 10;

    const pw = state.power;
    if (pw) {
      /* top banner, centred: the right edge used to stack five boxes — drift,
         power, menu, cam, sound — so nothing on that side could breathe */
      const pwW = bannerW, pwH = 34;
      const pwX = Math.round((this.w - pwW) / 2), pwY = 8;
      const active = pw.active;
      const darkText = active && pw.color === '#ffe14a';
      pxRect(c, pwX, pwY, pwW, pwH, active ? pw.color : SLAB);
      pxBorder(c, pwX, pwY, pwW, pwH, active ? 'rgba(242,238,225,0.9)' : LINE);
      this.text(pw.name, pwX + 6, pwY + 4, {
        size: 8, weight: 700, color: active ? (darkText ? INK : CREAM) : CREAM,
      });
      /* while the aim disc is open the power is mid-use: "READY / PRESS F" would be
         telling the player to fire the thing they are already placing */
      const status = state.aiming ? 'AIMING'
        : active ? 'ACTIVE' : pw.ready ? 'READY' : `${Math.ceil(pw.cd)}s`;
      this.text(status, pwX + pwW - 6, pwY + 4, {
        size: 8, weight: 700, align: 'right',
        color: active ? (darkText ? INK : CREAM) : pw.ready ? ACCENT : DIM,
      });
      const chargeFrac = active && pw.charge !== undefined ? Math.min(1, pw.charge) : undefined;
      const frac = chargeFrac !== undefined
        ? chargeFrac
        : active
          ? Math.min(1, pw.time / pw.duration)
          : 1 - Math.min(1, pw.cd / pw.cooldown);
      c.fillStyle = active ? 'rgba(20,22,26,0.28)' : SEG_OFF;
      c.fillRect(pwX + 6, pwY + pwH - 8, pwW - 12, 3);
      c.fillStyle = active ? (darkText ? INK : CREAM) : pw.color;
      c.fillRect(pwX + 6, pwY + pwH - 8, Math.max(1, Math.round((pwW - 12) * frac)), 3);
      const hint = state.aiming
        ? 'CLICK TO PLACE'
        : active
          ? (pw.charge !== undefined ? 'SLIDE TO CHARGE' : 'F')
          : 'PRESS F';
      this.text(hint, pwX + 6, pwY + 16, { size: 8, color: active ? (darkText ? INK : CREAM) : DIM });
    }

    {
      this.font(8, 700);
      const bw = Math.ceil(c.measureText('M MENU').width) + 22;
      const bh = 18;
      const bx = this.w - bw - 8, by = 8;
      pxRect(c, bx, by, bw, bh, SLAB);
      pxBorder(c, bx, by, bw, bh, LINE);
      this.text('M MENU', bx + bw / 2, by + 5, { size: 8, weight: 700, color: CREAM, align: 'center' });
      this.bMenu.x = bx; this.bMenu.y = by; this.bMenu.w = bw; this.bMenu.h = bh;
      this.buttons.push(this.bMenu);

      const unlocked = state.camLocked === false;
      const camInk = unlocked ? 'T RELOCK CAM' : 'T UNLOCK CAM';
      // measure with the weight that gets drawn: bold text is wider, and a
      // regular-weight measure used to run the label out of its own box
      this.font(8, unlocked ? 700 : 400);
      /* longest label that still stops short of the banner: the car key first,
         then the full cam label, then the bare key at 4:3 widths */
      const room = bx - 6 - bannerRight;
      const candidates = state.atLine ? [`C CAR   ${camInk}`, camInk, 'T CAM'] : [camInk, 'T CAM'];
      let keys = candidates[candidates.length - 1];
      let kw = 0;
      for (const cand of candidates) {
        const wid = Math.ceil(c.measureText(cand).width) + 12;
        if (wid <= room) { keys = cand; kw = wid; break; }
      }
      if (kw === 0) kw = Math.ceil(c.measureText(keys).width) + 12;
      const kx = Math.max(8, bx - kw - 6), ky = 11;
      pxRect(c, kx, ky, kw, 13, unlocked ? ACCENT : SLAB);
      pxBorder(c, kx, ky, kw, 13, unlocked ? CREAM : LINE);
      this.text(keys, kx + 6, ky + 3, {
        size: 8, weight: unlocked ? 700 : 400,
        color: unlocked ? CREAM : HINT,
      });
    }

    if (state.warning) this.drawToast(state.warning, 78);
    else if (state.offTrack) {
      this.drawOffChip(time);
    } else if (state.notice) {
      this.drawNotice(state.notice, 78);
    }
    if (state.ghostPower) this.drawGhostChip(time, state.ghostPower);

    if (time < this.bestUntil) {
      const bbw = 118, bbh = 22;
      const bx = Math.round(this.w / 2 - bbw / 2);
      const by = 50;
      pxRect(c, bx, by, bbw, bbh, ACCENT);
      pxBorder(c, bx, by, bbw, bbh, (time * 10) % 2 < 1 ? 'rgba(242,238,225,1)' : 'rgba(242,238,225,0.3)');
      this.text('NEW BEST', this.w / 2, by + 3, { size: 16, weight: 700, color: CREAM, align: 'center' });
      for (let j = 0; j < 2; j++) {
        for (let k = 0; k < 2; k++) {
          c.fillStyle = (j + k) % 2 === 0 ? CREAM : 'rgba(242,238,225,0.35)';
          c.fillRect(bx + 6 + j * 3, by + 6 + k * 3, 3, 3);
          c.fillRect(bx + bbw - 9 - j * 3, by + 6 + k * 3, 3, 3);
        }
      }
    }

    const ms = 96, mx = 8, my = this.h - ms - 26;
    pxRect(c, mx, my, ms, ms, SLAB);
    pxBorder(c, mx, my, ms, ms, LINE);
    this.drawMap(car, mx + 5, my + 5, ms - 10);
    const stage = (state.mapName ?? state.maps?.[state.mapIndex ?? 0]?.name ?? 'PIXEL DRIFT').toUpperCase();
    this.font(8, 700);
    const nw = Math.max(ms, Math.ceil(c.measureText(stage).width) + 12);
    pxRect(c, mx, my + ms + 6, nw, 14, CREAM);
    this.text(stage, mx + nw / 2, my + ms + 8, { size: 8, weight: 700, color: INK, align: "center" });

    const sw = 150, sh = 82, sx = this.w - sw - 8, sy = this.h - sh - 8;
    pxRect(c, sx, sy, sw, sh, SLAB);
    pxBorder(c, sx, sy, sw, sh, LINE);
    this.text('KM/H', sx + sw - 8, sy + 5, { size: 8, color: DIM, align: 'right' });
    const sp = String(kmh);
    const big = sp.length >= 3 ? 40 : 48;
    this.text(sp, sx + sw - 10, sy + (sp.length >= 3 ? 19 : 14), {
      size: big, weight: 700, color: CREAM, align: 'right',
    });
    c.fillStyle = ACCENT;
    c.fillRect(sx + 10, sy + 26, 22, 22);
    this.text(gear, sx + 21, sy + 30, { size: 16, weight: 700, color: CREAM, align: 'center' });
    this.text('GEAR', sx + 10, sy + 52, { size: 8, color: DIM });
    const iw = sw - 16, gap = 3;
    const segw = Math.floor((iw - gap * 13) / 14);
    const barW = segw * 14 + gap * 13;
    let segX = sx + 8 + ((iw - barW) >> 1);
    const segY = sy + sh - 11;
    const lit = Math.round(Math.min(1, kmh / 120) * 14);
    for (let i = 0; i < 14; i++) {
      const red = i >= 11;
      if (i < lit) c.fillStyle = red ? ACCENT : CREAM;
      else c.fillStyle = red ? SEG_RED_OFF : SEG_OFF;
      c.fillRect(segX + i * (segw + gap), segY, segw, 5);
    }

    if (state.aiming) {
      const msg = 'AIM · CLICK TO PLACE · ESC CANCELS';
      this.font(8, 700);
      const hw = Math.ceil(c.measureText(msg).width) + 16;
      const hx = Math.round(this.w / 2 - hw / 2), hy = this.h - 18;
      pxRect(c, hx, hy, hw, 14, CREAM);
      pxBorder(c, hx, hy, hw, 14, (time * 3) % 1 < 0.5 ? INK : 'rgba(21,24,26,0.35)');
      this.text(msg, this.w / 2, hy + 3, { size: 8, weight: 700, color: INK, align: 'center' });
    } else if (state.laps === 0) {
      /* the strip has to clear the minimap on one side and the speedo on the
         other; at 4:3 the full line ran under the speedo, so drop keys from the
         end until it fits between them */
      const parts = ['WASD DRIVE', 'SPACE DRIFT', 'F POWER', 'R RESET'];
      this.font(8);
      let msg = parts.join('   ');
      while (parts.length > 1 && Math.ceil(c.measureText(msg).width) + 16 > this.w - 286) {
        parts.pop();
        msg = parts.join('   ');
      }
      const hw = Math.ceil(c.measureText(msg).width) + 16;
      const hx = Math.round(this.w / 2 - hw / 2), hy = this.h - 18;
      pxRect(c, hx, hy, hw, 14, SLAB);
      pxBorder(c, hx, hy, hw, 14, LINE);
      this.text(msg, this.w / 2, hy + 3, { size: 8, color: 'rgba(242,238,225,0.8)', align: 'center' });
    }

    if (state.lapBar && !state.aiming) {
      const lb = state.lapBar;
      const left = `LAP ${fmtMs(lb.ms)}`;
      const tag = lb.pb ? 'NEW PB' : lb.delta == null ? '' : `+${(lb.delta / 1000).toFixed(2)}`;
      const lw = this.measure(left, 8, 700);
      const tw = tag ? this.measure(tag, 8, 700) + 12 : 0;
      const bw = lw + tw + 26;
      const bx = Math.round(this.w / 2 - bw / 2), by = this.h - 18;
      c.globalAlpha = lb.a;
      pxRect(c, bx, by, bw, 14, SLAB);
      pxBorder(c, bx, by, bw, 14, lb.pb ? ACCENT : LINE);
      this.text(left, bx + 13, by + 3, { size: 8, weight: 700, color: CREAM });
      if (tag) {
        this.text(tag, bx + 13 + lw + 12, by + 3, {
          size: 8, weight: 700, color: lb.pb ? ACCENT : DIM,
        });
      }
      c.globalAlpha = 1;
    }

    if (state.paused) {
      c.fillStyle = 'rgba(10,12,16,0.68)';
      c.fillRect(0, 0, this.w, this.h);
      const cells = 5, cell = 4, strip = cells * cell;
      for (let i = 0; i < cells; i++) {
        c.fillStyle = i % 2 === 0 ? CREAM : 'rgba(242,238,225,0.3)';
        c.fillRect(this.w / 2 - strip / 2 + i * cell, this.h / 2 - 24, cell, cell);
      }
      this.text('PAUSED', this.w / 2, this.h / 2 - 12, { size: 24, weight: 700, align: 'center' });
      this.text('ESC OR P TO RESUME', this.w / 2, this.h / 2 + 18, { size: 8, color: DIM, align: 'center' });
    }

    this.drawWipe(time);
  }

  /** the checker wipe: a field of 8px cells that closes in from the left and
      opens out again, on the same beat as the edges. Seven steps each way, so
      it reads as a curtain of chequers rather than a dissolve. */
  private drawWipe(time: number) {
    if (this.wipeAt < 0) return;
    const u = (time - this.wipeAt) / 0.46;
    if (u < 0 || u >= 1) { this.wipeAt = -1; return; }
    const c = this.ctx;
    const cell = 8;
    const cols = Math.ceil(this.w / cell), rows = Math.ceil(this.h / cell);
    const quant = (p: number) => Math.round(Math.min(1, Math.max(0, p)) * 7) / 7;
    const out = u < 0.62 ? quant(u / 0.62) : 1 - quant((u - 0.62) / 0.38);
    const edge = Math.round(cols * out);
    for (let i = 0; i < edge; i++) {
      for (let j = 0; j < rows; j++) {
        c.fillStyle = (i + j) % 2 === 0 ? CREAM : ASPHALT;
        c.fillRect(i * cell, j * cell, cell, cell);
      }
    }
    if (edge > 0 && edge < cols) {
      c.fillStyle = ACCENT;
      c.fillRect(edge * cell - cell, 0, cell, this.h);
    }
  }

  private drawAdminPanel(state: UiState) {
    const c = this.ctx;
    this.buttons.length = 0;
    c.fillStyle = 'rgba(10,12,16,0.72)';
    c.fillRect(0, 0, this.w, this.h);

    const w = Math.min(430, this.w - 20);
    const h = 296;
    const x = Math.round((this.w - w) / 2);
    const y = Math.round((this.h - h) / 2);
    pxRect(c, x, y, w, h, SLAB);
    pxBorder(c, x, y, w, h, ACCENT);

    this.text('ADMIN', x + 14, y + 11, { size: 16, weight: 700, color: ACCENT, spacing: 1 });
    this.text((state.mapName ?? 'LEADERBOARD').toUpperCase(), x + w - 14, y + 13, {
      size: 8, weight: 700, color: CREAM, align: 'right', spacing: 1,
    });
    this.text('DELETE A TIME OR CLEAR THE BOARD', x + 14, y + 30, { size: 8, color: DIM });

    c.fillStyle = LINE;
    c.fillRect(x + 12, y + 42, w - 24, 1);
    this.text('RK', x + 14, y + 48, { size: 8, color: DIM });
    this.text('PLAYER', x + 38, y + 48, { size: 8, color: DIM });
    this.text('TIME', x + w - 46, y + 48, { size: 8, color: DIM, align: 'right' });

    const acct = state.account;
    const rows = acct?.times ?? [];
    const n = Math.min(10, rows.length);
    for (let i = 0; i < n; i++) {
      const t = rows[i];
      const ry = y + 62 + i * 15;
      this.text(String(t.rank).padStart(2, '0'), x + 14, ry, { size: 8, color: DIM });
      let name = t.username.toUpperCase();
      this.font(8);
      while (name.length > 1 && c.measureText(name).width > w - 120) name = name.slice(0, -1);
      this.text(name, x + 38, ry, { size: 8, color: CREAM });
      this.text(fmtMs(t.ms), x + w - 46, ry, { size: 8, color: CREAM, align: 'right' });
      const bx = x + w - 32, by = ry - 2;
      pxRect(c, bx, by, 18, 11, 'rgba(224,81,63,0.18)');
      pxBorder(c, bx, by, 18, 11, 'rgba(224,81,63,0.75)');
      this.text('X', bx + 9, by + 1, { size: 8, weight: 700, color: ACCENT, align: 'center' });
      this.buttons.push({ id: `admin-del-${i}`, x: bx, y: by, w: 18, h: 11, label: 'X' });
    }
    if (n === 0) {
      this.text('NO TIMES ON THIS BOARD', x + w / 2, y + 80, {
        size: 8, color: DIM, align: 'center', spacing: 1,
      });
    }

    this.bAdminClear.label = state.adminConfirm ? 'SURE? CLEAR' : 'CLEAR BOARD';
    this.bAdminClear.x = x + 12;
    this.bAdminClear.y = y + h - 30;
    pxRect(c, this.bAdminClear.x, this.bAdminClear.y, this.bAdminClear.w, this.bAdminClear.h,
      state.adminConfirm ? ACCENT : SLAB);
    pxBorder(c, this.bAdminClear.x, this.bAdminClear.y, this.bAdminClear.w, this.bAdminClear.h,
      state.adminConfirm ? CREAM : 'rgba(242,238,225,0.55)');
    this.text(this.bAdminClear.label, this.bAdminClear.x + this.bAdminClear.w / 2,
      this.bAdminClear.y + 4, { size: 8, weight: 700, color: CREAM, align: 'center' });
    this.buttons.push(this.bAdminClear);

    this.bAdminDash.x = x + 124;
    this.bAdminDash.y = y + h - 30;
    pxRect(c, this.bAdminDash.x, this.bAdminDash.y, this.bAdminDash.w, this.bAdminDash.h, SLAB);
    pxBorder(c, this.bAdminDash.x, this.bAdminDash.y, this.bAdminDash.w, this.bAdminDash.h,
      'rgba(242,238,225,0.55)');
    this.text(this.bAdminDash.label, this.bAdminDash.x + this.bAdminDash.w / 2,
      this.bAdminDash.y + 4, { size: 8, color: CREAM, align: 'center' });
    this.buttons.push(this.bAdminDash);

    this.bAdminClose.x = x + w - this.bAdminClose.w - 12;
    this.bAdminClose.y = y + h - 30;
    pxRect(c, this.bAdminClose.x, this.bAdminClose.y, this.bAdminClose.w, this.bAdminClose.h, SLAB);
    pxBorder(c, this.bAdminClose.x, this.bAdminClose.y, this.bAdminClose.w, this.bAdminClose.h,
      'rgba(242,238,225,0.55)');
    this.text(this.bAdminClose.label, this.bAdminClose.x + this.bAdminClose.w / 2,
      this.bAdminClose.y + 4, { size: 8, color: CREAM, align: 'center' });
    this.buttons.push(this.bAdminClose);

    this.text(state.adminUpload ?? "UPLOAD THIS BROWSER'S 60 HZ RUNS", x + w / 2, y + h - 68, {
      size: 8, color: state.adminUpload ? ACCENT : HINT, align: 'center',
    });

    this.bAdminUpload.x = Math.round(x + w / 2 - this.bAdminUpload.w / 2);
    this.bAdminUpload.y = y + h - 52;
    pxRect(c, this.bAdminUpload.x, this.bAdminUpload.y, this.bAdminUpload.w, this.bAdminUpload.h, SLAB);
    pxBorder(c, this.bAdminUpload.x, this.bAdminUpload.y, this.bAdminUpload.w, this.bAdminUpload.h,
      'rgba(242,238,225,0.55)');
    this.text(this.bAdminUpload.label, this.bAdminUpload.x + this.bAdminUpload.w / 2,
      this.bAdminUpload.y + 4, { size: 8, color: CREAM, align: 'center' });
    this.buttons.push(this.bAdminUpload);
  }

  private drawPowerInfo(state: UiState) {
    const c = this.ctx;
    this.buttons.length = 0;
    c.fillStyle = 'rgba(10,12,16,0.62)';
    c.fillRect(0, 0, this.w, this.h);
    const w = Math.min(330, this.w - 24), h = 146;
    const x = Math.round((this.w - w) / 2), y = Math.round((this.h - h) / 2);
    pxRect(c, x, y, w, h, SLAB);
    pxBorder(c, x, y, w, h, 'rgba(242,238,225,0.75)');
    const name = state.power?.name ?? 'POWER';
    this.text(name, x + w / 2, y + 10, { size: 16, weight: 700, color: ACCENT, align: 'center' });
    this.text('CAR POWER', x + w / 2, y + 32, { size: 8, color: DIM, align: 'center', spacing: 2 });
    const blurb = state.powerBlurb ?? '';
    this.font(8);
    const words = blurb.split(' ');
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (c.measureText(test).width > w - 28 && line) {
        lines.push(line);
        line = word;
      } else line = test;
    }
    if (line) lines.push(line);
    lines.forEach((l, i) => {
      this.text(l, x + w / 2, y + 48 + i * 11, { size: 8, color: CREAM, align: 'center' });
    });
    if (state.powerEffect) {
      this.text(state.powerEffect, x + w / 2, y + 78, {
        size: 8, weight: 700, color: ACCENT, align: 'center', spacing: 1,
      });
    }
    this.text('PRESS F TO ACTIVATE', x + w / 2, y + 92, {
      size: 8, weight: 700, color: CREAM, align: 'center', spacing: 1,
    });
    this.text(`${(state.powerDuration ?? 0).toFixed(1)}s ACTIVE   ${state.powerCooldown ?? 0}s COOLDOWN`,
      x + w / 2, y + 106, { size: 8, color: DIM, align: 'center' });
    this.bInfo.label = 'CLOSE';
    this.bInfo.x = Math.round(x + w / 2 - 35);
    this.bInfo.y = y + h - 22;
    pxRect(c, this.bInfo.x, this.bInfo.y, this.bInfo.w, this.bInfo.h, SLAB);
    pxBorder(c, this.bInfo.x, this.bInfo.y, this.bInfo.w, this.bInfo.h, 'rgba(242,238,225,0.6)');
    this.text(this.bInfo.label, this.bInfo.x + this.bInfo.w / 2, this.bInfo.y + 2,
      { size: 8, color: CREAM, align: 'center' });
    this.buttons.push(this.bInfo);
  }

  private drawGarage(state: UiState) {
    const c = this.ctx;
    this.buttons.length = 0;
    const w = this.w;
    const cx = Math.round(w / 2);
    const rows = state.carStatRows ?? [];
    const names = state.carNames ?? ['CAR'];
    const ci = ((state.car.variant % names.length) + names.length) % names.length;
    const nm = (names[ci] ?? 'CAR').toUpperCase();
    const pw = CAR_POWERS[ci] ?? CAR_POWERS[0];
    const accent = powerColour(ci);
    const cls = state.carClass ?? '';

    /* The band is a spec sheet now, in three cells that each own their space:
       the ratings column on the left, the car's name over its arrows across the
       top, and the power plate — name in display type, the effect in a driver's
       words, a live demo of it running — on the right, under the rule.

       POWER INFO and BACK left the band completely. They were the two chips
       sitting in its corner, and at narrow widths the POWER INFO lettering ran
       under BACK's box; they are the screen's own header now — BACK top-left,
       POWER INFO top-right — corners the car never reaches at any aspect. */
    const compact = w < 600;
    const bandH = compact ? 104 : 100;
    const by = this.h - 8 - bandH;
    pxRect(c, 8, by, w - 16, bandH, SLAB);
    pxBorder(c, 8, by, w - 16, bandH, LINE);

    const rLabelX = compact ? 14 : 18;
    const rBarX = compact ? 66 : 78;
    const rSegW = compact ? 4 : 6;
    const rEdge = rBarX + 10 * (rSegW + 1) + 22;
    const ratings = rows.length > 0 && cx - 34 - rEdge - 6 >= 40;
    const maxHalf = ratings ? cx - 34 - (rEdge + 6) : Math.round((w - 96) / 2);

    let nameSize = 16;
    let nmW = this.measure(nm, nameSize, 700);
    while (nameSize > 8 && nmW > maxHalf * 2) {
      nameSize -= 4;
      nmW = this.measure(nm, nameSize, 700);
    }
    this.text(nm, cx, by + 6 + (16 - nameSize) / 2, {
      size: nameSize, weight: 700, color: CREAM, align: 'center',
    });

    /* the arrows sit outside the measured name, like the title chooser: a fixed
       offset put them on top of longer names (DUNE RUNNER is 151px at 16px) */
    this.bCarPrev.x = Math.max(12, Math.round(cx - nmW / 2 - 34));
    this.bCarPrev.y = by + 4;
    this.bCarNext.x = Math.min(w - 36, Math.round(cx + nmW / 2 + 10));
    this.bCarNext.y = by + 4;
    for (const [b, dir] of [[this.bCarPrev, -1], [this.bCarNext, 1]] as [Button, number][]) {
      pxRect(c, b.x, b.y, b.w, b.h, SLAB);
      pxBorder(c, b.x, b.y, b.w, b.h, 'rgba(242,238,225,0.55)');
      this.pixelArrow(b.x + 6, b.y + 7, dir);
      this.buttons.push(b);
    }

    // the rule that hands the lower tier to the power plate
    c.fillStyle = LINE;
    c.fillRect(12, by + 32, w - 24, 1);

    /* ---- the plate: what the power is called, and what it does ----------- */
    const tx = ratings ? rEdge + 12 : 16;
    const dw = Math.max(96, Math.min(compact ? 148 : 210, w - tx - 118));
    const dx = w - 14 - dw;
    const dh = 54;
    const dy = by + 36;
    const colW = Math.max(70, dx - 12 - tx);
    /* the plate tier's top. Every tagline is written to land in two lines at
       the narrower column, so the block never grows a stray third line */
    const py = by + 38;

    // a signature bar in the power's own colour, down the plate's edge
    c.fillStyle = accent;
    c.fillRect(tx - 6, py, 2, 48);

    /* the header names the block and the car's identity in one phrase: two
       labels at opposite ends of the row read as two unrelated things */
    let head = cls ? `CAR POWER · ${cls.toUpperCase()}` : 'CAR POWER';
    while (head.length > 6 && this.measure(head, 8, 400, 1) > colW) head = head.slice(0, -1);
    this.text(head, tx, py, { size: 8, color: DIM, spacing: 1 });

    let pwSize = compact ? 16 : 20;
    let pwW = this.measure(pw.name, pwSize, 700);
    while (pwSize > 12 && pwW > colW) {
      pwSize -= 4;
      pwW = this.measure(pw.name, pwSize, 700);
    }
    this.text(pw.name, tx, py + 12, { size: pwSize, weight: 700, color: accent });

    /* the effect in a driver's words, never the multipliers — those stay on the
       POWER INFO card for anyone who wants them */
    const lines = this.wrap(pw.tagline ?? '', colW, 8, 400).slice(0, 3);
    lines.forEach((l, i) => {
      this.text(l, tx, py + 30 + i * 10, { size: 8, color: CREAM });
    });

    this.drawPowerDemo(ci, dx, dy, dw, dh, accent);

    // ratings under the rule: ten hard segments per axis so 6 and 7 read apart
    if (ratings) {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const ry = py + i * 10;
        this.text(row.label, rLabelX, ry, { size: 8, color: row.best ? ACCENT : DIM });
        const segs = 10, gap = 1;
        for (let s = 0; s < segs; s++) {
          c.fillStyle = s < row.rating ? ACCENT : SEG_OFF;
          c.fillRect(rBarX + s * (rSegW + gap), ry + 1, rSegW, 4);
        }
        this.text(String(row.rating), rBarX + segs * (rSegW + gap) + 5, ry, {
          size: 8, weight: 700, color: row.best ? ACCENT : CREAM,
        });
      }
    }

    /* ---- the header's two chips ----------------------------------------- */
    const hot = this.hoverId;
    const chip = (b: Button, label: string, x: number, paint: (on: boolean) => void) => {
      const press = this.press(b.id);
      b.label = label;
      b.x = x;
      b.y = 10 + press.dy;
      b.h = 16 + press.dh;
      const on = hot === b.id;
      pxRect(c, b.x, b.y, b.w, b.h, SLAB);
      pxBorder(c, b.x, b.y, b.w, b.h, on ? CREAM : 'rgba(242,238,225,0.55)');
      paint(on);
      this.buttons.push({ ...b });
    };
    this.bGarageBack.w = 60;
    chip(this.bGarageBack, 'BACK', 10, () => {
      this.pixelArrow(this.bGarageBack.x + 6, this.bGarageBack.y + 4, -1);
      this.text('BACK', this.bGarageBack.x + 18, this.bGarageBack.y + 4,
        { size: 8, color: CREAM });
    });
    this.bInfo.w = 70;
    chip(this.bInfo, 'POWER INFO', w - 10 - this.bInfo.w, (on) => {
      this.text('POWER INFO', this.bInfo.x + this.bInfo.w / 2, this.bInfo.y + 4,
        { size: 8, color: CREAM, align: 'center', weight: on ? 700 : 400 });
    });
    if (state.powerInfo) this.drawPowerInfo(state);
    /* POWER INFO dims the screen and drops a card across the band, so the clip
       steps aside for as long as it is up */
    this.demoWindow = state.powerInfo ? null : { x: dx + 1, y: dy + 1, w: dw - 2, h: dh - 2 };
    this.hoverId = this.hitIdAt(this.hx, this.hy);
  }

  /** greedy wrap against a pixel width, measured at the spacing it draws with */
  private wrap(s: string, maxW: number, size: number, weight: number, spacing = 0): string[] {
    const c = this.ctx;
    this.font(size, weight);
    c.letterSpacing = `${spacing}px`;
    const out: string[] = [];
    let line = '';
    for (const word of s.split(' ')) {
      const test = line ? `${line} ${word}` : word;
      if (line && c.measureText(test).width > maxW) { out.push(line); line = word; }
      else line = test;
    }
    if (line) out.push(line);
    c.letterSpacing = '0px';
    return out;
  }

  /** The plate's live demo: a strip of road, the car, and the power doing what
      the plate says it does. Stepped at ten cells a second off the draw clock,
      every position a whole pixel — animation cells, never an alpha fade. The
      window is a mid grey on purpose: the car's glass and tyres are near-black
      and its body is cream, so both read only against something between them. */
  private drawPowerDemo(ci: number, x: number, y: number, w: number, h: number, accent: string) {
    const c = this.ctx;
    pxRect(c, x, y, w, h, '#363943');
    pxBorder(c, x, y, w, h, accent + '66');

    /* the window is a window: the launch's speed lines start behind the car and
       would otherwise print straight onto the plate at the start of its run */
    c.save();
    c.beginPath();
    c.rect(x + 1, y + 1, w - 2, h - 2);
    c.clip();

    /* each power gets the loop its action needs, so no demo ever parks at the
       end of its own film: ten cells a second, always a whole count of them */
    const loop = [2.4, 2.4, 2.0][ci] ?? 2.4;
    const cells = Math.round(loop * 10);
    const f = Math.floor(((this.now % loop) / loop) * cells);
    const ground = y + h - 12;
    const gx = x + 6;
    const gw = w - 12;

    // the road: one hard edge, then a run of kerb cells
    c.fillStyle = 'rgba(20,22,26,0.55)';
    c.fillRect(gx, ground, gw, 9);
    c.fillStyle = 'rgba(242,238,225,0.55)';
    c.fillRect(gx, ground, gw, 1);
    c.fillStyle = 'rgba(242,238,225,0.10)';
    for (let i = 0; i < gw; i += 8) c.fillRect(gx + i, ground + 4, 4, 1);

    const drawCar = (at: number, gy: number, o: { slant?: number; keep?: (i: number) => boolean } = {}) => {
      const slant = o.slant ?? 0;
      // the demo car wears the car on the turntable's own paint
      const body = ['#f1e4bc', '#e8b02c', '#ead5a6'][ci] ?? '#f1e4bc';
      const stripe = ci === 0 ? accent : '#f2eee1';
      const put = (rx: number, ry: number, rw: number, rh: number, col: string) => {
        c.fillStyle = col;
        if (!o.keep) { c.fillRect(rx, ry, rw, rh); return; }
        for (let i = 0; i < rw; i++) if (o.keep(rx + i)) c.fillRect(rx + i, ry, 1, rh);
      };
      // wheels first, so the body covers the top of them: rounded, so they read
      // as wheels and not as squares at this size
      const wheel = (wx: number) => {
        put(wx + 1, gy - 13, 9, 13, '#0e1013');
        put(wx, gy - 12, 11, 11, '#0e1013');
        put(wx + 3, gy - 9, 5, 5, '#c49a2c');
      };
      wheel(at + 5);
      wheel(at + 41);
      put(at, gy - 18, 58, 10, body);
      put(at + 2, gy - 20, 54, 2, body);
      put(at + 14 + slant, gy - 26, 24, 8, '#12141a');
      put(at + 15 + slant, gy - 26, 22, 1, body);
      put(at + 1, gy - 14, 56, 1, stripe);
      put(at + 54, gy - 19, 4, 4, '#f7f2d8');
      put(at, gy - 16, 2, 4, '#d02a2a');
    };

    const span = gw - 72;                      // 58px of car, plus air at the kerb
    const at = (p: number) => gx + 2 + Math.round(p * span);

    if (ci === 0) {
      /* the slide, then the pay-out: the car leans in and lays two skid marks,
         and at the exit those marks flash in the power's colour as it steps on */
      const lean = f >= 3 && f < 16;
      const p = f < 3 ? 0
        : f < 15 ? ((f - 3) / 12) * 0.42
        : f < 17 ? 0.42 + (f - 15) * 0.27
        : 0.96;
      const flash = f >= 15 && f < 21;
      for (let i = 3; i <= Math.min(f, 15); i++) {
        const q = ((i - 3) / 12) * 0.42;
        c.fillStyle = flash ? accent : 'rgba(242,238,225,0.50)';
        c.fillRect(at(q) + 10, ground + 1, 7, 2);
        c.fillRect(at(q) + 43, ground + 1, 7, 2);
      }
      // dust off the locked rear wheel while it slides
      if (lean && f % 2 === 0) {
        c.fillStyle = 'rgba(242,238,225,0.45)';
        c.fillRect(at(p) - 2, ground - 3, 2, 2);
        c.fillRect(at(p) - 5, ground - 1, 2, 2);
      }
      if (f >= 16 && f < 22) {
        c.fillStyle = accent;
        c.fillRect(at(p) - 14, ground - 22, 9, 1);
        c.fillRect(at(p) - 11, ground - 17, 6, 1);
      }
      drawCar(at(p), ground - (f >= 15 && f < 21 ? 1 : 0), { slant: lean ? 4 : 0 });
    } else if (ci === 1) {
      /* the shove: it sits and spits, then it is gone — three speed lines and a
         bolt over the roof while the launch lasts */
      const p = f < 6 ? 0 : Math.min(1, (f - 6) / 14);
      const firing = f >= 6 && f < 21;
      if (f < 6 && f % 2 === 0) {
        c.fillStyle = accent;
        c.fillRect(at(0) - 5, ground - 13, 3, 3);
        c.fillRect(at(0) - 10, ground - 9, 3, 2);
      }
      if (firing) {
        const len = Math.max(3, 20 - (f - 6));
        for (let k = 0; k < 3; k++) {
          c.fillStyle = k === 0 ? accent : 'rgba(242,238,225,0.55)';
          c.fillRect(at(p) - 10 - k * 6 - len, ground - 9 - k * 5, len, 1);
        }
      }
      drawCar(at(p), ground - (firing ? 1 : 0));
      if (firing && f % 2 === 0) {
        c.fillStyle = accent;
        const bx = at(p) + 6, bt = ground - 34;
        for (let i = 0; i < 6; i++) c.fillRect(bx + i * 3, bt + (i % 2 === 0 ? 0 : 3), 3, 2);
      }
    } else {
      /* the blink: a post opens where the car will land, the car comes apart
         into pixels, and the arrival ring flares — two hard radii, no fade */
      const mx = at(1);
      const armed = f >= 3 && f < 11;
      c.fillStyle = armed ? accent : accent + '77';
      for (let i = 0; i < 4; i++) c.fillRect(mx + 24, ground - 2 - i * 4, 2, 2);
      this.text('22 M', mx + 56, ground - 32, { size: 8, color: accent, align: 'right' });
      if (f < 5 || f >= 11) {
        drawCar(f < 5 ? at(0) : mx, ground);
      } else if (f < 9) {
        const keep = f < 7
          ? (i: number) => (i + f * 3) % 3 !== 0
          : (i: number) => i % 3 !== 1;
        drawCar(at(0), ground, { keep });
        for (let i = 0; i < 6; i++) {
          c.fillStyle = accent;
          c.fillRect(at(0) + 2 + ((i * 9 + f * 5) % 50), ground - 8 - ((i * 5 + f * 3) % 20), 2, 1);
        }
      }
      if (f >= 11 && f < 18) {
        /* the arrival lands on the road, not around the roof: two sparks walk
           out from under the wheels, and the dust it kicked up rises */
        const r = f < 13 ? 12 : f < 15 ? 20 : 28;
        c.fillStyle = f < 13 ? CREAM : accent;
        c.fillRect(mx + 29 - r, ground, 4, 2);
        c.fillRect(mx + 29 + r, ground, 4, 2);
        for (let i = 0; i < 3; i++) {
          c.fillRect(mx + 10 + i * 18, ground - 4 - (f - 11) * 2, 2, 2);
        }
      }
    }

    // a blinking cell so the window reads as running, not as a picture
    if (f % 5 < 3) {
      c.fillStyle = accent;
      c.fillRect(x + w - 9, y + 5, 3, 3);
    }
    c.restore();
  }

  private drawNotice(text: string, y: number) {
    const c = this.ctx;
    this.font(8, 700);
    const w = Math.ceil(c.measureText(text).width) + 22;
    const x = Math.round(this.w / 2 - w / 2);
    pxRect(c, x, y, w, 16, CREAM);
    pxBorder(c, x, y, w, 16, INK);
    this.text(text, this.w / 2, y + 4, { size: 8, weight: 700, color: INK, align: 'center' });
  }

  private drawToast(text: string, y: number) {
    const c = this.ctx;
    this.font(8, 700);
    const w = Math.ceil(c.measureText(text).width) + 18;
    const x = Math.round((this.w - w) / 2);
    pxRect(c, x, y, w, 15, ACCENT);
    pxBorder(c, x, y, w, 15, 'rgba(242,238,225,0.85)');
    this.text(text, this.w / 2, y + 4, { size: 8, weight: 700, color: CREAM, align: 'center' });
  }

  /* OFF TRACK: a chip docked in the left HUD column under the mute chip — the
     old centred toast read as a red banner floating over the world. The base
     chip holds still so the warning never vanishes while the car is off the
     road; only the border and lettering pulse, on the beat the toast blinked */
  private drawOffChip(time: number) {
    const c = this.ctx;
    const label = 'OFF TRACK';
    const w = this.measure(label, 8, 700) + 22;
    const x = 8, y = 84, h = 15;
    const on = (time * 2) % 1 < 0.7;
    pxRect(c, x, y, w, h, SLAB);
    pxBorder(c, x, y, w, h, on ? ACCENT : SEG_RED_OFF);
    c.fillStyle = ACCENT;
    c.fillRect(x + 1, y + 3, 3, h - 6);
    this.text(label, x + 10, y + 4, { size: 8, weight: 700, color: on ? ACCENT : DIM });
  }

  /* GHOST POWER: the record fired its power, and the ghost rig is lit. The
     burst on the body can be missed mid-corner, so the left column carries a
     filled chip naming the power — red fill, pulsing cream border, same
     station as OFF TRACK so the eye knows where to look */
  private drawGhostChip(time: number, power: string) {
    const c = this.ctx;
    const label = 'GHOST · ' + power.toUpperCase();
    const w = this.measure(label, 8, 700) + 22;
    const x = 8, y = 104, h = 15;
    const on = (time * 2) % 1 < 0.7;
    pxRect(c, x, y, w, h, ACCENT);
    pxBorder(c, x, y, w, h, on ? CREAM : 'rgba(242,238,225,0.45)');
    c.fillStyle = CREAM;
    c.fillRect(x + 1, y + 3, 3, h - 6);
    this.text(label, x + 10, y + 4, { size: 8, weight: 700, color: CREAM });
  }

  private drawMap(car: Car, x: number, y: number, size: number) {
    const c = this.ctx;

    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i < this.mapPts.length; i += 2) {
      minX = Math.min(minX, this.mapPts[i]); maxX = Math.max(maxX, this.mapPts[i]);
      minZ = Math.min(minZ, this.mapPts[i + 1]); maxZ = Math.max(maxZ, this.mapPts[i + 1]);
    }
    const span = Math.max(maxX - minX, maxZ - minZ, 0.001);
    const inner = size - 6;
    const sc = inner / span;
    const ox = x + size / 2 - ((minX + maxX) / 2) * sc;
    const oz = y + size / 2 - ((minZ + maxZ) / 2) * sc;
    const px = (v: number) => ox + v * sc;
    const pz = (v: number) => oz + v * sc;

    const path = () => {
      c.beginPath();
      for (let i = 0; i < this.mapPts.length; i += 2) {
        if (i === 0) c.moveTo(px(this.mapPts[0]), pz(this.mapPts[1]));
        else c.lineTo(px(this.mapPts[i]), pz(this.mapPts[i + 1]));
      }
      c.closePath();
    };
    c.lineJoin = 'round';
    c.lineCap = 'round';
    path();
    c.strokeStyle = 'rgba(10,12,16,0.85)';
    c.lineWidth = 4;
    c.stroke();
    path();
    c.strokeStyle = 'rgba(242,238,225,0.9)';
    c.lineWidth = 2;
    c.stroke();

    if (this.tickX || this.tickZ) {
      c.strokeStyle = 'rgba(242,238,225,0.55)';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(px(this.tickX - this.tickNX * 0.05), pz(this.tickZ - this.tickNZ * 0.05));
      c.lineTo(px(this.tickX + this.tickNX * 0.05), pz(this.tickZ + this.tickNZ * 0.05));
      c.stroke();
    }

    // A filled wedge pointing where the car faces.
    const cx = px((car.x - this.mapCX) / this.mapExt);
    const cz = pz((car.z - this.mapCZ) / this.mapExt);
    const fx = -Math.sin(car.heading), fz = -Math.cos(car.heading);
    const rx = Math.cos(car.heading), rz = -Math.sin(car.heading);
    c.beginPath();
    c.moveTo(cx + fx * 4.2, cz + fz * 4.2);
    c.lineTo(cx - fx * 2.4 + rx * 2.6, cz - fz * 2.4 + rz * 2.6);
    c.lineTo(cx - fx * 1.0, cz - fz * 1.0);
    c.lineTo(cx - fx * 2.4 - rx * 2.6, cz - fz * 2.4 - rz * 2.6);
    c.closePath();
    c.fillStyle = ACCENT;
    c.fill();
    c.strokeStyle = '#f2eee1';
    c.lineWidth = 1;
    c.stroke();
  }

  /* ======================================================================
     TITLE
     ----------------------------------------------------------------------
     LOGO → TRACK → CAR → PLAY in one centre column, nothing else in it:

       ┌ MENU ┐                              ┌ LEADERBOARD ┐
       │           P I X E L   D R I F T     │  rows       │
       │  TRACK          SALTMARSH COAST     │             │
       │  [▣][▣][▣]    one card per map,     └─────────────┘
       │  [▣][▣]       its own outline       [ ALL MAPS · L ]
       │  CAR            02/05
       │  < DUNE RUNNER >
       │      view car
       │    [  P L A Y  ]
       │      or press space
       └ WASD DRIVE   SPACE DRIFT   F POWER   Q E LOOK   R RESET   N MUTE ┘

     The old title stacked nine things in that column and ran out of width at
     five maps: the tab row measured ~430px and broke at eight. The grid is
     the only element that grows with the map list, the account/admin/settings
     cluster lives behind one corner button, and the column itself is laid out
     from block heights so extra rows push the gaps down, not the design off
     the canvas.
     ====================================================================== */

  /** stepped progress: 0 before `at`, 1 after at+dur, quantised so motion lands
      on whole pixels instead of sliding there (the BTD6 snap, no fades) */
  private stage(t: number, at: number, dur = 0.12, steps = 4) {
    const p = (t - at) / dur;
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    return Math.round(p * steps) / steps;
  }

  /** the squash and spring of a pressed chip: three frames down, then one past */
  private press(id: string): { dy: number; dh: number } {
    if (this.pressId !== id || this.pressAt < 0) return { dy: 0, dh: 0 };
    const p = this.now - this.pressAt;
    if (p < 0.07) return { dy: 2, dh: -3 };
    if (p < 0.16) return { dy: 0, dh: 2 };
    this.pressId = null;
    this.pressAt = -1;
    return { dy: 0, dh: 0 };
  }

  /** the map cards' outlines: the shape at 20px, from each circuit's own
      control polygon. Built once per map, so a new circuit is a new tile. */
  private outline(id: string) {
    const had = this.outlines.get(id);
    if (had) return had;
    const def = MAPS.find((m) => m.id === id);
    if (!def) return null;
    const ctrl = def.ctrl;
    const raw: [number, number][] = [];
    if (def.smooth === false) {
      for (const [x, z] of ctrl) raw.push([x, z]);
    } else {
      const n = ctrl.length;
      for (let i = 0; i < n; i++) {
        const a = ctrl[(i - 1 + n) % n], b = ctrl[i];
        const d = ctrl[(i + 1) % n], e = ctrl[(i + 2) % n];
        for (let k = 0; k < 5; k++) {
          const s = k / 5, s2 = s * s, s3 = s2 * s;
          const f = (p0: number, p1: number, p2: number, p3: number) => 0.5 * (
            2 * p1 + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s2
            + (-p0 + 3 * p1 - 3 * p2 + p3) * s3);
          raw.push([f(a[0], b[0], d[0], e[0]), f(a[1], b[1], d[1], e[1])]);
        }
      }
    }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of raw) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const mx = (minX + maxX) / 2, mz = (minZ + maxZ) / 2;
    const ext = Math.max(maxX - minX, maxZ - minZ, 1);
    const pts = new Float32Array(raw.length * 2);
    for (let i = 0; i < raw.length; i++) {
      pts[i * 2] = raw[i][0] - mx;
      pts[i * 2 + 1] = raw[i][1] - mz;
    }
    const art = { pts, ext, dot: raw.length < 3 };
    this.outlines.set(id, art);
    return art;
  }

  /** one circuit, stroked inside a box: the minimap's own outline, at tile size */
  private miniOutline(id: string, x: number, y: number, w: number, h: number,
    color: string, lw: number) {
    const o = this.outline(id);
    if (!o || o.dot) return false;
    const c = this.ctx;
    const sc = (Math.min(w, h) * 0.94) / o.ext;
    const mx = x + w / 2, my = y + h / 2;
    c.beginPath();
    for (let i = 0; i < o.pts.length; i += 2) {
      if (i === 0) c.moveTo(mx + o.pts[i] * sc, my + o.pts[i + 1] * sc);
      else c.lineTo(mx + o.pts[i] * sc, my + o.pts[i + 1] * sc);
    }
    c.closePath();
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.strokeStyle = color;
    c.lineWidth = lw;
    c.stroke();
    return true;
  }

  /**
   * A map tile: the circuit's outline over its short name, accent-painted when
   * it is the map you are on. `hot` is the hover state (lifted one pixel and a
   * brighter border), `inset` is the entrance/press squash.
   */
  private drawMapCard(x: number, y: number, cw: number, ch: number, o: {
    id: string; label: string; digit: string; on: boolean; hot: boolean;
  }) {
    const c = this.ctx;
    pxRect(c, x, y, cw, ch, o.on ? ACCENT : SLAB);
    pxBorder(c, x, y, cw, ch, o.on ? CREAM : o.hot ? 'rgba(242,238,225,0.85)' : LINE);
    const boxY = y + 3;
    const boxH = ch - 14;
    const ink = o.on ? INK : o.hot ? CREAM : 'rgba(242,238,225,0.92)';
    if (!this.miniOutline(o.id, x + 3, boxY, cw - 6, boxH, ink, o.on ? 2 : 1)) {
      // a map with no polygon yet: a centred dot, so the tile still reads
      c.fillStyle = ink;
      c.fillRect(x + cw / 2 - 1, boxY + boxH / 2 - 1, 2, 2);
    }
    this.text(o.digit, x + 4, y + 2, {
      size: 8, color: o.on ? 'rgba(20,22,26,0.55)' : 'rgba(242,238,225,0.35)',
    });
    let label = o.label;
    this.font(8, 700);
    while (label.length > 1 && c.measureText(label).width > cw - 8) label = label.slice(0, -1);
    this.text(label, x + cw / 2, y + ch - 11, {
      size: 8, weight: 700, color: o.on ? CREAM : o.hot ? CREAM : DIM, align: 'center',
    });
  }

  private drawTitle(time: number, state: UiState) {
    const c = this.ctx;
    const { w, h } = this;
    this.buttons.length = 0;
    if (this.titleAt < 0) this.titleAt = time;
    const t = time - this.titleAt;
    if (this.pressId && this.pressAt < 0) this.pressAt = time;
    const hot = this.hoverId;
    if (state.garage || state.powerInfo || state.settings || state.fullBoard) this.menuOpen = false;

    c.fillStyle = 'rgba(12,14,18,0.74)';
    c.fillRect(0, 0, w, h);
    this.checkerEdge(0, time, -1);
    this.checkerEdge(h - 16, time, 1);

    const maps = state.maps && state.maps.length
      ? state.maps
      : [{ id: '', name: state.mapName ?? 'Pixel Drift' }];
    const mi = Math.max(0, Math.min(maps.length - 1, state.mapIndex ?? 0));
    const names = state.carNames ?? ['CAR'];
    const ci = ((state.car.variant % names.length) + names.length) % names.length;
    const carName = (names[ci] ?? 'CAR').toUpperCase();

    /* ---- geometry -------------------------------------------------------
       One grid, wrapping: 3 - 6 maps sit 3 across, 7+ go 4 across, and every
       extra four is a new row. The column is laid out from the block heights
       and the slack is shared between the four groups, so the breathing room
       is a consequence of the layout, not a hand-tuned y. */
    const cols = maps.length <= 3 ? Math.max(1, maps.length) : maps.length <= 6 ? 3 : 4;
    const rows = Math.ceil(maps.length / cols);
    const colW = Math.min(248, w - 56);
    const ggap = 8;
    const cardW = Math.floor((colW - ggap * (cols - 1)) / cols);
    // a fourth row of tiles costs its height, so the tile shrinks with the list
    const cardH = rows >= 4 ? 26 : rows === 3 ? 30 : 36;
    const gridH = rows * cardH + (rows - 1) * ggap;
    const compact = rows > 2;
    const logoSize = rows >= 4 ? 30 : compact ? 36 : 48;
    const logoH = logoSize * 2 + 2;
    const carRowH = 24;
    const linkH = 11;
    const playH = 28;
    const hintH = 9;

    /* the slack is not shared evenly: a group is a caption and its content, so
       the gaps inside a group stay tight and the gaps between groups take the
       space — that is what makes it read as four things instead of eight */
    const blocks = [logoH, 10, gridH, 10, carRowH, linkH, playH, hintH];
    const weights = [2.2, 0.4, 1.8, 0.35, 0.6, 1.9, 0.7];
    const top = 22, bottom = h - 32;
    const sum = blocks.reduce((a, b) => a + b, 0);
    const slack = Math.max(0, (bottom - top) - sum);
    const unit = slack / weights.reduce((a, b) => a + b, 0);
    const gaps = weights.map((g) => Math.max(2, Math.min(18, Math.round(unit * g))));
    const lead = Math.max(0, Math.floor((slack - gaps.reduce((a, b) => a + b, 0)) / 2));
    const y: number[] = [];
    for (let i = 0, cy = top + lead; i < blocks.length; i++) {
      y.push(cy);
      cy += blocks[i] + (gaps[i] ?? 2);
    }
    const cx = Math.round(w / 2);
    const gx = Math.round((w - colW) / 2);
    const gridRight = gx + colW;

    /* ---- LOGO: two lines drop in, one after the other -------------------- */
    const l1 = this.stage(t, 0.02, 0.10, 3);
    const l2 = this.stage(t, 0.10, 0.10, 3);
    if (l1 > 0) {
      const dy = Math.round((1 - l1) * 12);
      this.text('PIXEL', cx + 3, y[0] + 3 + dy, { size: logoSize, weight: 700, color: SHADOW, align: 'center' });
      this.text('PIXEL', cx, y[0] + dy, { size: logoSize, weight: 700, color: CREAM, align: 'center' });
    }
    if (l2 > 0) {
      const dy = Math.round((1 - l2) * 12);
      this.text('DRIFT', cx + 3, y[0] + logoSize + 5 + dy, { size: logoSize, weight: 700, color: SHADOW, align: 'center' });
      this.text('DRIFT', cx, y[0] + logoSize + 2 + dy, { size: logoSize, weight: 700, color: ACCENT, align: 'center' });
    }

    /* ---- TRACK: caption row + the tile grid ------------------------------ */
    const capA = this.stage(t, 0.20, 0.12, 5);
    if (capA > 0) {
      c.save();
      c.beginPath();
      c.rect(gx - 2, y[1] - 1, Math.round((colW + 4) * capA), 13);
      c.clip();
      this.text('TRACK', gx, y[1] + 1, { size: 8, color: HINT, spacing: 2 });
      const full = (maps[mi]?.name ?? 'Pixel Drift').toUpperCase();
      let label = full;
      this.font(8, 700);
      while (label.length > 1 && c.measureText(label).width > colW * 0.62) label = label.slice(0, -1);
      this.text(label, gridRight, y[1] + 1, {
        size: 8, weight: 700, color: ACCENT, align: 'right', spacing: 1,
      });
      c.restore();
    }

    for (let i = 0; i < maps.length; i++) {
      const a = this.stage(t, 0.24 + i * 0.045, 0.09, 3);
      if (a <= 0) continue;
      const r = Math.floor(i / cols), col = i % cols;
      // a short last row sits centred under the full rows above it
      const inRow = Math.min(cols, maps.length - r * cols);
      const rowShift = Math.round(((cols - inRow) * (cardW + ggap)) / 2);
      const inset = Math.round((1 - a) * 2);
      const on = i === mi;
      // the selected tile settles one pixel low, then snaps level: two steps
      const settle = on ? Math.round((1 - a) * 1) : 0;
      const lift = hot === `pick-map-${i}` && !on ? -1 : 0;
      const press = on ? { dy: 0, dh: 0 } : this.press(`pick-map-${i}`);
      const bx = gx + rowShift + col * (cardW + ggap) + inset;
      const by = y[2] + r * (cardH + ggap) + inset + settle + lift + press.dy;
      const bw = cardW - inset * 2;
      const bh = cardH - inset * 2 + press.dh;
      this.drawMapCard(bx, by, bw, bh, {
        id: maps[i].id,
        label: (maps[i].id || maps[i].name).toUpperCase(),
        digit: i < 9 ? String(i + 1) : '',
        on,
        hot: hot === `pick-map-${i}`,
      });
      this.buttons.push({
        id: `pick-map-${i}` as HitId, x: Math.round(bx), y: Math.round(by),
        w: bw, h: bh, label: maps[i].id,
      });
    }

    /* ---- CAR: caption row, arrows, big name, the garage link ------------- */
    const carCapA = this.stage(t, 0.34, 0.10, 4);
    if (carCapA > 0) {
      this.text('CAR', gx, y[3] + 1, { size: 8, color: HINT, spacing: 2 });
      const idx = `${String(ci + 1).padStart(2, '0')}/${String(names.length).padStart(2, '0')}`;
      this.text(idx, gridRight, y[3] + 1, {
        size: 8, weight: 700, color: names.length > 1 ? CREAM : DIM, align: 'right', spacing: 1,
      });
    }

    const carA = this.stage(t, 0.40, 0.10, 4);
    if (carA > 0) {
      const slide = Math.round((1 - carA) * -6);
      /* the name has to hold up as cars arrive: 16px while it fits the band
         between the arrows, then 12, then 8, then it clips — the arrows never
         move past the column edge, so a fifth long name cannot push them out */
      const band = colW - 64;
      let size = compact ? 12 : 16;
      let nmW = this.measure(carName, size, 700);
      while (size > 8 && nmW > band) {
        size -= 4;
        nmW = this.measure(carName, size, 700);
      }
      let shown = carName;
      this.font(size, 700);
      while (shown.length > 1 && c.measureText(shown).width > band) shown = shown.slice(0, -1);
      this.font(size, 700);
      nmW = Math.ceil(c.measureText(shown).width);
      const ny = y[4] + 1;
      this.text(shown, cx + 2 + slide, ny + 3, { size, weight: 700, color: SHADOW, align: 'center' });
      this.text(shown, cx + slide, ny, { size, weight: 700, color: CREAM, align: 'center' });
      for (const [b, dir] of [[this.bCarPrev, -1], [this.bCarNext, 1]] as [Button, number][]) {
        const press = this.press(b.id);
        b.x = dir < 0
          ? Math.max(gx, Math.round(cx + slide - nmW / 2 - 30))
          : Math.min(gridRight - 24, Math.round(cx + slide + nmW / 2 + 6));
        b.y = ny + press.dy;
        b.w = 24;
        b.h = 22 + press.dh;
        const hovered = hot === b.id;
        pxRect(c, b.x, b.y, b.w, b.h, hovered ? 'rgba(242,238,225,0.18)' : SLAB);
        pxBorder(c, b.x, b.y, b.w, b.h, hovered ? CREAM : 'rgba(242,238,225,0.55)');
        this.pixelArrow(b.x + 6, b.y + 7, dir);
        this.buttons.push({ ...b });
      }
    }

    const linkA = this.stage(t, 0.50, 0.10, 3);
    if (linkA > 0) {
      const press = this.press(this.bGarage.id);
      const label = 'VIEW CAR';
      const lw = this.measure(label, 8, 700) + 12;
      this.bGarage.x = Math.round(cx - lw / 2);
      this.bGarage.y = y[5] + press.dy;
      this.bGarage.w = lw;
      this.bGarage.h = linkH + press.dh;
      const hovered = hot === this.bGarage.id;
      this.text(label, cx, this.bGarage.y + 1, {
        size: 8, weight: hovered ? 700 : 400, color: hovered ? CREAM : HINT, align: 'center',
      });
      c.fillStyle = hovered ? CREAM : 'rgba(242,238,225,0.32)';
      c.fillRect(this.bGarage.x + 3, this.bGarage.y + 9, lw - 6, 1);
      this.buttons.push({ ...this.bGarage });
    }

    /* ---- PLAY: a key, not a chip. It idles with a one-pixel breath ------ */
    const playA = this.stage(t, 0.56, 0.12, 3);
    if (playA > 0) {
      const press = this.press(this.bSolo.id);
      const settle = Math.round((1 - playA) * 8);
      const breath = (time * 1.8) % 2 < 1 ? 0 : 1;
      const hovered = hot === this.bSolo.id;
      this.bSolo.label = 'PLAY';
      this.bSolo.w = 128;
      this.bSolo.h = playH + press.dh;
      this.bSolo.x = Math.round(cx - this.bSolo.w / 2);
      this.bSolo.y = y[6] + settle + press.dy - breath;
      const b = this.bSolo;
      const shadow = hovered ? 4 : 2 + breath;
      pxRect(c, b.x + shadow, b.y + shadow, b.w, b.h, SHADOW);
      pxRect(c, b.x, b.y, b.w, b.h, hovered ? '#e6604e' : ACCENT);
      c.fillStyle = CREAM;
      c.fillRect(b.x, b.y, b.w, 1);
      c.fillRect(b.x, b.y + b.h - 1, b.w, 1);
      c.fillRect(b.x, b.y + 1, 1, b.h - 2);
      c.fillRect(b.x + b.w - 1, b.y + 1, 1, b.h - 2);
      this.text(b.label, b.x + b.w / 2, b.y + 7, {
        size: 16, weight: 700, color: CREAM, align: 'center',
      });
      this.buttons.push({ ...b });
    }

    const hintA = this.stage(t, 0.70, 0.1, 2);
    if (hintA > 0) {
      const on = (time % 1.2) < 0.85;
      this.text('OR PRESS SPACE', cx, y[7], {
        size: 8, color: on ? CREAM : 'rgba(242,238,225,0.15)', align: 'center', spacing: 1,
      });
    }

    /* ---- the leaderboard keeps the top-right corner ---------------------- */
    const acct = state.account;
    const boardW = 188;
    const boardLx = Math.max(w - boardW, gridRight + 10);
    let chipY = 20;
    if (acct && w >= 560 && state.board !== false && w - 8 - boardLx >= 116) {
      const bh = this.drawBoardPanel(state, boardLx, 20, w - 8 - boardLx);
      chipY = 20 + bh + 6;
    }
    {
      const label = 'ALL MAPS · L';
      const aw = this.measure(label, 8, 700) + 18;
      const ax = w - aw - 8;
      pxRect(c, ax, chipY, aw, 13, hot === 'board-all' ? 'rgba(242,238,225,0.18)' : SLAB);
      pxBorder(c, ax, chipY, aw, 13, hot === 'board-all' ? CREAM : 'rgba(242,238,225,0.55)');
      this.text(label, ax + aw / 2, chipY + 2.5, { size: 8, weight: 700, color: CREAM, align: 'center' });
      this.buttons.push({ id: 'board-all', x: ax, y: chipY, w: aw, h: 13, label: 'ALL MAPS' });
    }

    /* ---- ONE corner button for account, admin, settings and the power ---- */
    this.drawMenuButton(state, time, hot);
    if (this.menuOpen) this.drawMenuPanel(state, time, hot);

    this.text('WASD DRIVE   SPACE DRIFT   F POWER   Q E LOOK   R RESET   N MUTE', cx, h - 26, {
      size: 8, color: HINT, align: 'center',
    });

    if (state.powerInfo) this.drawPowerInfo(state);
    if (state.settings) this.drawSettings(state);
    if (state.fullBoard) this.drawFullBoard(state);

    this.hoverId = this.hitIdAt(this.hx, this.hy);
  }

  /** the leaderboard panel: an ink header naming the panel over the circuit it
      belongs to, then a real little table. Returns the height it took. */
  private drawBoardPanel(state: UiState, lx: number, py: number, pw: number) {
    const c = this.ctx;
    const acct = state.account!;
    const pad = 9;
    const right = lx + pw - pad;
    const hh = 26;
    const rh = 14;
    const n = acct.offline ? 0 : Math.min(10, acct.times.length);
    const labelH = n === 0 ? 0 : 13;
    const bh = n === 0 ? hh + 32 : hh + labelH + n * rh + 5;
    pxRect(c, lx, py, pw, bh, SLAB);
    pxRect(c, lx, py, pw, hh, INK);
    pxBorder(c, lx, py, pw, bh, 'rgba(242,238,225,0.45)');
    c.fillStyle = ACCENT;
    c.fillRect(lx + 5, py + 4, 2, 15);
    let track = (state.mapName ?? '').toUpperCase();
    this.font(8, 700);
    while (track.length > 1 && c.measureText(track).width > right - lx - 14) track = track.slice(0, -1);
    this.text('LEADERBOARD', lx + 12, py + 4, { size: 8, weight: 700, color: CREAM, spacing: 2 });
    this.text(track, lx + 12, py + 14, { size: 8, weight: 700, color: ACCENT, spacing: 1 });

    const nameX = lx + 30;
    const rankX = nameX - 8;
    this.font(8, 700);
    const timeW = Math.ceil(c.measureText('00:00.00').width);
    const nameMax = right - timeW - 8 - nameX;

    if (n === 0) {
      this.text(acct.offline ? 'OFFLINE' : 'NO TIMES YET', lx + pw / 2, py + hh + 11, {
        size: 8, weight: 700, color: acct.offline ? ACCENT : CREAM,
        align: 'center', spacing: 2,
      });
      this.text(acct.offline ? 'BOARD UNREACHABLE' : 'BE THE FIRST', lx + pw / 2, py + hh + 22,
        { size: 8, color: DIM, align: 'center' });
    } else {
      this.text('RK', rankX, py + hh + 2, { size: 8, color: DIM, align: 'right' });
      this.text('PLAYER', nameX, py + hh + 2, { size: 8, color: DIM });
      this.text('TIME', right, py + hh + 2, { size: 8, color: DIM, align: 'right' });
      c.fillStyle = LINE;
      c.fillRect(lx + 6, py + hh + 11, pw - 12, 1);

      const me = (acct.user?.username ?? '').toUpperCase();
      for (let i = 0; i < n; i++) {
        const row = acct.times[i];
        const ry = py + hh + labelH + i * rh;
        const lead = row.rank === 1;
        const mine = me !== '' && row.username.toUpperCase() === me;
        if (lead) {
          pxRect(c, lx + 3, ry, pw - 6, rh, ACCENT);
        } else if (mine) {
          c.fillStyle = 'rgba(242,238,225,0.1)';
          c.fillRect(lx + 3, ry, pw - 6, rh);
        } else if (i % 2 === 1) {
          c.fillStyle = 'rgba(242,238,225,0.045)';
          c.fillRect(lx + 3, ry, pw - 6, rh);
        }
        if (mine) {
          c.fillStyle = 'rgba(242,238,225,0.75)';
          c.fillRect(lx + 3, ry + 2, 2, rh - 4);
        }
        const ty = ry + 4;
        this.text(String(row.rank).padStart(2, '0'), rankX, ty, {
          size: 8, weight: lead ? 700 : 400, color: lead ? CREAM : DIM, align: 'right',
        });
        let name = row.username.toUpperCase();
        const weight = lead || mine ? 700 : 400;
        this.font(8, weight);
        while (name.length > 1 && c.measureText(name).width > nameMax) name = name.slice(0, -1);
        this.text(name, nameX, ty, { size: 8, weight, color: CREAM });
        this.text(fmtMs(row.ms), right, ty, { size: 8, weight: 700, color: CREAM, align: 'right' });
      }
    }
    return bh;
  }

  /** MENU: the account tag rides the button, so who you are is still one
      glance away — and the nine things that used to sit in the centre column
      are one click away instead of nine lines of chrome. */
  private drawMenuButton(state: UiState, time: number, hot: string | null) {
    const c = this.ctx;
    const acct = state.account;
    const admin = acct?.user?.role === 'admin';
    const tag = acct?.user ? acct.user.username.toUpperCase() : 'GUEST';
    const labelW = this.measure('MENU', 8, 700, 1);
    let tagText = tag;
    let tagW = this.measure(tagText, 8, 400);
    while (tagText.length > 1 && tagW > 84) {
      tagText = tagText.slice(0, -1);
      tagW = this.measure(tagText, 8, 400);
    }
    const bob = this.menuOpen ? 1 : 0;
    const b = this.bMenu;
    b.x = 8;
    b.y = 20 + bob;
    b.w = 7 + 6 + 5 + labelW + 7 + tagW + 8;
    b.h = 17;
    const press = this.press('menu');
    b.y += press.dy;
    b.h += press.dh;
    const lit = hot === 'menu' || this.menuOpen;
    pxRect(c, b.x + 2, b.y + 2, b.w, b.h, SHADOW);
    pxRect(c, b.x, b.y, b.w, b.h, lit ? 'rgba(242,238,225,0.16)' : SLAB);
    pxBorder(c, b.x, b.y, b.w, b.h, lit ? CREAM : 'rgba(242,238,225,0.55)');
    // three bars: the menu mark, drawn by hand like the arrows
    c.fillStyle = CREAM;
    for (let i = 0; i < 3; i++) c.fillRect(b.x + 7, b.y + 5 + i * 3, 6, 1);
    this.text('MENU', b.x + 18, b.y + 5, { size: 8, weight: 700, color: CREAM, spacing: 1 });
    this.text(tagText, b.x + b.w - 8, b.y + 5, {
      size: 8, color: admin ? ACCENT : HINT, align: 'right',
    });
    this.buttons.push({ ...b });
  }

  /** the corner panel: who you are, ADMIN, SIGN OUT / SIGN IN, SETTINGS, and
      the power's blurb. Drawn over the column, its buttons first in the hit
      list so they always win the tap. */
  private drawMenuPanel(state: UiState, time: number, hot: string | null) {
    const c = this.ctx;
    const acct = state.account;
    const admin = acct?.user?.role === "admin";
    const px = 8;
    const pw = Math.min(184, this.w - 16);
    const py = 40;
    /* sized by its content, so a one-line name and a long one take the same
       box and nothing is left empty at the bottom */
    const acctH = acct?.user ? 48 : 33;
    const full = 22 + acctH + 40 + 9;
    const ph = Math.round(full * this.stage(time - this.menuAt, 0.01, 0.09, 3));
    pxRect(c, px + 2, py + 2, pw, ph, SHADOW);
    pxRect(c, px, py, pw, ph, SLAB);
    pxBorder(c, px, py, pw, ph, CREAM);
    c.save();
    c.beginPath();
    c.rect(px, py, pw, ph);
    c.clip();
    pxRect(c, px, py, pw, 14, INK);
    c.fillStyle = ACCENT;
    c.fillRect(px + 5, py + 4, 2, 8);
    this.text("MENU", px + 12, py + 3, { size: 8, weight: 700, color: CREAM, spacing: 2 });

    const items: Button[] = [];
    const rowW = pw - 20;
    let y = py + 22;
    if (acct?.user) {
      this.text("SIGNED IN", px + 10, y, { size: 8, color: DIM, spacing: 2 });
      y += 10;
      let nm = acct.user.username.toUpperCase();
      this.font(8, 700);
      while (nm.length > 1 && c.measureText(nm).width > rowW) nm = nm.slice(0, -1);
      this.text(nm, px + 10, y, { size: 8, weight: 700, color: admin ? ACCENT : CREAM });
      y += 16;
      if (admin) {
        this.bAdmin.label = "ADMIN";
        this.bAdmin.w = 64;
        this.bAdmin.h = 14;
        this.bAdmin.x = px + 10;
        this.bAdmin.y = y;
        pxRect(c, this.bAdmin.x, this.bAdmin.y, this.bAdmin.w, this.bAdmin.h, ACCENT);
        pxBorder(c, this.bAdmin.x, this.bAdmin.y, this.bAdmin.w, this.bAdmin.h, CREAM);
        this.text("ADMIN", this.bAdmin.x + this.bAdmin.w / 2, this.bAdmin.y + 3,
          { size: 8, weight: 700, color: CREAM, align: "center" });
        items.push({ ...this.bAdmin });
        this.bLogout.label = acct.busy ? "..." : "SIGN OUT";
        this.bLogout.w = 72;
        this.bLogout.h = 14;
        this.bLogout.x = px + pw - this.bLogout.w - 10;
        this.bLogout.y = y;
        pxRect(c, this.bLogout.x, this.bLogout.y, this.bLogout.w, this.bLogout.h, SLAB);
        pxBorder(c, this.bLogout.x, this.bLogout.y, this.bLogout.w, this.bLogout.h,
          "rgba(242,238,225,0.55)");
        this.text(this.bLogout.label, this.bLogout.x + this.bLogout.w / 2, this.bLogout.y + 3,
          { size: 8, color: CREAM, align: "center" });
        items.push({ ...this.bLogout });
      } else {
        this.bLogout.label = acct.busy ? "..." : "SIGN OUT";
        this.bLogout.w = rowW;
        this.bLogout.h = 14;
        this.bLogout.x = px + 10;
        this.bLogout.y = y;
        pxRect(c, this.bLogout.x, this.bLogout.y, this.bLogout.w, this.bLogout.h, SLAB);
        pxBorder(c, this.bLogout.x, this.bLogout.y, this.bLogout.w, this.bLogout.h,
          "rgba(242,238,225,0.55)");
        this.text(this.bLogout.label, this.bLogout.x + this.bLogout.w / 2, this.bLogout.y + 3,
          { size: 8, color: CREAM, align: "center" });
        items.push({ ...this.bLogout });
      }
      y += 22;
    } else {
      this.text("NOT SIGNED IN", px + 10, y, { size: 8, color: DIM, spacing: 2 });
      y += 11;
      this.bLogin.label = acct?.busy ? "..." : "SIGN IN";
      this.bLogin.w = rowW;
      this.bLogin.h = 14;
      this.bLogin.x = px + 10;
      this.bLogin.y = y;
      pxRect(c, this.bLogin.x, this.bLogin.y, this.bLogin.w, this.bLogin.h, ACCENT);
      pxBorder(c, this.bLogin.x, this.bLogin.y, this.bLogin.w, this.bLogin.h, CREAM);
      this.text(this.bLogin.label, this.bLogin.x + this.bLogin.w / 2, this.bLogin.y + 3,
        { size: 8, weight: 700, color: CREAM, align: "center" });
      items.push({ ...this.bLogin });
      y += 22;
    }

    for (const spec of [
      { b: this.bSettings, label: "SETTINGS" },
      { b: this.bInfo, label: "POWER INFO" },
    ]) {
      const b = spec.b;
      b.label = spec.label;
      b.w = rowW;
      b.h = 14;
      b.x = px + 10;
      b.y = y;
      const hovered = hot === b.id;
      pxRect(c, b.x, b.y, b.w, b.h, hovered ? "rgba(242,238,225,0.16)" : SLAB);
      pxBorder(c, b.x, b.y, b.w, b.h, hovered ? CREAM : "rgba(242,238,225,0.55)");
      this.text(b.label, b.x + 6, b.y + 3, { size: 8, color: CREAM });
      if (b.id === "power-info") {
        let nm = (state.power?.name ?? "").toUpperCase();
        this.font(8, 400);
        while (nm.length > 1 && c.measureText(nm).width > rowW - 96) nm = nm.slice(0, -1);
        this.text(nm, b.x + b.w - 6, b.y + 3, { size: 8, color: ACCENT, align: "right" });
      }
      items.push({ ...b });
      y += 20;
    }
    c.restore();

    // the panel sits over the column, so its chips go first in the hit list
    this.buttons.unshift(...items.map((b) => ({
      id: b.id, x: Math.round(b.x), y: Math.round(b.y), w: b.w, h: b.h, label: b.label,
    })));
  }

  /** The player's own switches and their record: toggles up top, per-map bests
      under a section label, then the reset chip. A modal like POWER INFO —
      dimmed world, this.buttons cleared so only the panel can be hit, and its
      own relabelled CLOSE. */
  private drawSettings(state: UiState) {
    const c = this.ctx;
    this.buttons.length = 0;
    c.fillStyle = 'rgba(10,12,16,0.62)';
    c.fillRect(0, 0, this.w, this.h);
    const rows = state.settingsRows ?? [];
    const w = 244, h = 204 + rows.length * 20;
    const x = Math.round((this.w - w) / 2), y = Math.round((this.h - h) / 2);
    pxRect(c, x, y, w, h, SLAB);
    pxRect(c, x, y, w, 14, INK);
    pxBorder(c, x, y, w, h, 'rgba(242,238,225,0.75)');
    c.fillStyle = ACCENT;
    c.fillRect(x + 5, y + 4, 2, 8);
    this.text('SETTINGS', x + 12, y + 3, { size: 8, weight: 700, color: CREAM, spacing: 2 });
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const ry = y + 28 + i * 20;
      this.text(r.label, x + 12, ry, { size: 8, weight: 700, color: CREAM });
      const cycler = r.value !== undefined;      // the chip names the current pick
      const label = r.value ?? (r.on ? 'ON' : 'OFF');
      const cw = this.measure(label, 8, 700) + (cycler ? 18 : 16);
      const bx = x + w - cw - 12, by = ry - 3;
      pxRect(c, bx, by, cw, 14, cycler ? SLAB : (r.on ? ACCENT : SLAB));
      pxBorder(c, bx, by, cw, 14, cycler ? CREAM : (r.on ? CREAM : 'rgba(242,238,225,0.55)'));
      this.text(label, bx + cw / 2, by + 3, {
        size: 8, weight: 700, color: cycler ? CREAM : (r.on ? CREAM : DIM), align: 'center',
      });
      this.buttons.push({ id: `setting-${r.name}`, x: bx, y: by, w: cw, h: 14, label });
    }
    const toggles = rows.length;
    c.fillStyle = LINE;
    c.fillRect(x + 10, y + 38 + toggles * 20, w - 20, 1);
    const s = state.stats;
    const c1 = x + 12;                  // bests column
    const c2 = x + 140;                 // lifetime column
    const labelY = y + 50 + toggles * 20;
    this.text('YOUR BESTS', c1, labelY, { size: 8, color: DIM, spacing: 1 });
    this.text('LIFETIME', c2, labelY, { size: 8, color: DIM, spacing: 1 });
    const base = labelY + 14;
    if (s) {
      for (let i = 0; i < s.maps.length; i++) {
        const m = s.maps[i];
        const my = base + i * 13;
        const has = m.best > 0;
        this.text(m.map, c1, my, { size: 8, color: has ? CREAM : DIM });
        this.text(has ? fmtMs(m.best * 1000) : '—', x + 124, my, {
          size: 8, weight: has ? 700 : 400, color: has ? CREAM : DIM, align: 'right',
        });
      }
      const avgY = base + s.maps.length * 13;
      const hasAvg = s.pbAvg > 0;
      this.text('PB AVG', c1, avgY, { size: 8, color: DIM });
      this.text(hasAvg ? fmtMs(s.pbAvg * 1000) : '—', x + 124, avgY, {
        size: 8, weight: hasAvg ? 700 : 400, color: hasAvg ? ACCENT : DIM, align: 'right',
      });
      this.text('LAPS', c2, base, { size: 8, color: CREAM });
      this.text(String(s.laps), x + w - 12, base, { size: 8, weight: 700, color: CREAM, align: 'right' });
      this.text('ON TRACK', c2, base + 13, { size: 8, color: CREAM });
      // a long session (hours) would run into the label: clamp to what's left
      // of the column, measured at the weight it is drawn at
      let dur = fmtDur(s.driveMs);
      const trackW = this.measure('ON TRACK', 8, 400);
      this.font(8, 700);
      while (dur.length > 1 && c.measureText(dur).width > x + w - 12 - c2 - trackW - 6) dur = dur.slice(0, -1);
      this.text(dur, x + w - 12, base + 13, { size: 8, weight: 700, color: CREAM, align: 'right' });
      this.text('FAV CAR', c2, base + 26, { size: 8, color: CREAM });
      // the car's name gets its own line under the label: the column is a row
      // shorter than the bests column, so even DUNE RUNNER fits whole instead
      // of crowding into the label or losing letters to a clamp
      this.text(s.favCar || '—', x + w - 12, base + 39, { size: 8, weight: 700, color: ACCENT, align: 'right' });
    }
    // the reset sits with the numbers it wipes, not with the safe toggles
    const ry = y + h - 56;
    this.text('BEST TIMES', x + 12, ry, { size: 8, color: CREAM });
    const rw = this.measure('RESET', 8, 700) + 18;
    const rx = x + w - rw - 12;
    pxRect(c, rx, ry - 3, rw, 14, 'rgba(224,81,63,0.16)');
    pxBorder(c, rx, ry - 3, rw, 14, 'rgba(224,81,63,0.75)');
    this.text('RESET', rx + rw / 2, ry, { size: 8, weight: 700, color: ACCENT, align: 'center' });
    this.buttons.push({ id: 'setting-reset', x: rx, y: ry - 3, w: rw, h: 14, label: 'RESET' });
    this.bSettings.label = 'CLOSE';
    this.bSettings.w = 48;
    this.bSettings.x = Math.round(x + w / 2 - 24);
    this.bSettings.y = y + h - 22;
    pxRect(c, this.bSettings.x, this.bSettings.y, this.bSettings.w, this.bSettings.h, SLAB);
    pxBorder(c, this.bSettings.x, this.bSettings.y, this.bSettings.w, this.bSettings.h, 'rgba(242,238,225,0.6)');
    this.text(this.bSettings.label, this.bSettings.x + this.bSettings.w / 2, this.bSettings.y + 3, {
      size: 8, color: CREAM, align: 'center',
    });
    this.buttons.push(this.bSettings);
  }

  /** The whole hierarchy, one circuit per page: the page is a full-width
      board so usernames never truncate, tabs (or A/D) flip between maps,
      and the wheel scrolls rows when a board outlives the window. */
  private drawFullBoard(state: UiState) {
    const c = this.ctx;
    const fb = state.fullBoard!;
    this.buttons.length = 0;
    c.fillStyle = 'rgba(10,12,16,0.62)';
    c.fillRect(0, 0, this.w, this.h);
    const maps = fb.maps;
    const page = Math.max(0, Math.min(fb.page, maps.length - 1));
    const w = Math.min(this.w - 16, 620), h = Math.min(this.h - 16, 348);
    const x = Math.round((this.w - w) / 2), y = Math.round((this.h - h) / 2);
    pxRect(c, x, y, w, h, SLAB);
    pxRect(c, x, y, w, 14, INK);
    pxBorder(c, x, y, w, h, 'rgba(242,238,225,0.75)');
    c.fillStyle = ACCENT;
    c.fillRect(x + 5, y + 4, 2, 8);
    this.text('FULL LEADERBOARD', x + 12, y + 3, { size: 8, weight: 700, color: CREAM, spacing: 2 });
    if (fb.offline) {
      this.text('OFFLINE · BOARD UNREACHABLE', x + w - 12, y + 3, { size: 8, color: ACCENT, align: 'right' });
    }

    // the map tabs: one per circuit, the open page painted in accent
    const tabY = y + 20;
    const tabH = 13;
    let tx = x + 10;
    this.font(8, 700);
    for (let i = 0; i < maps.length; i++) {
      // the same short label the title picker uses: the map's id, uppercased
      const label = (maps[i].id || maps[i].name).toUpperCase();
      const tw = this.measure(label, 8, 700) + 14;
      const on = i === page;
      pxRect(c, tx, tabY, tw, tabH, on ? ACCENT : SLAB);
      pxBorder(c, tx, tabY, tw, tabH, on ? CREAM : 'rgba(242,238,225,0.4)');
      this.text(label, tx + tw / 2, tabY + 2.5, { size: 8, weight: 700, color: on ? CREAM : DIM, align: 'center' });
      this.buttons.push({ id: `fb-map-${i}` as HitId, x: tx, y: tabY, w: tw, h: tabH, label });
      tx += tw + 6;
    }
    // page counter on the right of the tab row
    this.text(`${page + 1}/${maps.length}`, x + w - 10, tabY + 2.5, { size: 8, color: DIM, align: 'right' });

    // the page: one map's full board, full names, no truncation needed
    const m = maps[page];
    const listTop = y + 44;
    const footerH = 22;
    const listH = h - 44 - footerH;
    const rh = 13;
    const visible = Math.floor(listH / rh);
    const left = x + 12;
    const right = x + w - 16;
    if (m.rows.length === 0) {
      this.text(fb.offline ? 'OFFLINE' : 'NO TIMES YET', x + w / 2, listTop + 10, {
        size: 8, weight: 700, color: fb.offline ? ACCENT : CREAM, align: 'center', spacing: 2,
      });
      this.text(fb.offline ? 'BOARD UNREACHABLE' : 'BE THE FIRST', x + w / 2, listTop + 22, {
        size: 8, color: DIM, align: 'center',
      });
    } else {
      for (let r = 0; r < visible; r++) {
        const idx = r + fb.scroll;
        if (idx >= m.rows.length) break;
        const t = m.rows[idx];
        const ry = listTop + r * rh;
        const lead = t.rank === 1;
        const mine = fb.me !== '' && t.username.toUpperCase() === fb.me;
        if (lead) {
          pxRect(c, left, ry, right - left, rh, ACCENT);
        } else if (mine) {
          c.fillStyle = 'rgba(242,238,225,0.1)';
          c.fillRect(left, ry, right - left, rh);
        } else if (idx % 2 === 1) {
          c.fillStyle = 'rgba(242,238,225,0.045)';
          c.fillRect(left, ry, right - left, rh);
        }
        if (mine) {
          c.fillStyle = 'rgba(242,238,225,0.75)';
          c.fillRect(left, ry + 2, 2, rh - 4);
        }
        const ty = ry + 2.5;
        this.text(String(t.rank).padStart(2, '0'), left + 14, ty, {
          size: 8, weight: lead ? 700 : 400, color: lead ? CREAM : DIM, align: 'right',
        });
        this.text(t.username.toUpperCase(), left + 20, ty, {
          size: 8, weight: lead || mine ? 700 : 400, color: CREAM,
        });
        this.text(fmtMs(t.ms), right, ty, { size: 8, weight: 700, color: CREAM, align: 'right' });
      }
    }

    // the scrollbar: only when the page outlives the window
    if (m.rows.length > visible) {
      const trackY = listTop, trackH = visible * rh;
      c.fillStyle = LINE;
      c.fillRect(x + w - 8, trackY, 2, trackH);
      const thumbH = Math.max(10, Math.round((visible / m.rows.length) * trackH));
      const maxScroll = m.rows.length - visible;
      const thumbY = trackY + Math.round((Math.min(fb.scroll, maxScroll) / maxScroll) * (trackH - thumbH));
      c.fillStyle = 'rgba(242,238,225,0.7)';
      c.fillRect(x + w - 8, thumbY, 2, thumbH);
    }

    // footer: flip hint, prev/next chips, close
    const fy = y + h - 15;
    this.text('A D FLIP · WHEEL SCROLLS · L CLOSES', x + 12, fy, { size: 8, color: DIM });
    const bw = 48;
    const bx = Math.round(x + w / 2 - bw / 2);
    pxRect(c, bx, fy - 4, bw, 14, SLAB);
    pxBorder(c, bx, fy - 4, bw, 14, 'rgba(242,238,225,0.6)');
    this.text('CLOSE', bx + bw / 2, fy, { size: 8, color: CREAM, align: 'center' });
    this.buttons.push({ id: 'fullboard-close', x: bx, y: fy - 4, w: bw, h: 14, label: 'CLOSE' });
  }

  // Font glyphs read thin at this size, so arrows are drawn by hand.
  /** a stepped triangle. dir < 0 points left (short bar on the left, tall on
      the right), dir > 0 points right — the two callers pass prev as -1 */
  private pixelArrow(x: number, y: number, dir: number) {
    const c = this.ctx;
    c.fillStyle = CREAM;
    for (let i = 0; i < 4; i++) {
      const hgt = dir < 0 ? 3 + i * 2 : 9 - i * 2;
      const yy = Math.round(y + (9 - hgt) / 2);
      c.fillRect(x + i * 2, yy, 2, hgt);
    }
  }

  // Crawls in whole cells so the chequer stays crisp.
  private checkerEdge(y: number, time: number, dir: number) {
    const c = this.ctx;
    const cell = 8, rows = 2;
    const s = Math.floor(time * 2.5 * dir);
    const n = Math.ceil(this.w / cell);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < rows; j++) {
        const on = ((i - s + j) % 2 + 2) % 2 === 0;
        c.fillStyle = on ? CREAM : ASPHALT;
        c.fillRect(i * cell, y + j * cell, cell, cell);
      }
    }
  }
}
