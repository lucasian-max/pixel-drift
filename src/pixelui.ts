import type { Car } from './car';
import type { TimeEntry, User } from './account';

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
  /** one chip row per player-tunable thing, hit id setting-${name} */
  settingsRows?: { name: string; label: string; on: boolean }[];
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

export type HitId = 'prev-map' | 'next-map' | 'prev-car' | 'next-car' | 'solo' | 'login' | 'logout'
  | 'power-info' | 'garage' | 'garage-back' | 'menu'
  | 'admin' | 'admin-close' | 'admin-clear' | 'admin-dashboard' | 'admin-upload' | `admin-del-${number}`
  | 'settings' | `setting-${string}`;

interface Button { id: HitId; x: number; y: number; w: number; h: number; label: string }

export class PixelUI {
  private ctx: CanvasRenderingContext2D;
  private w = 576;
  private h = 360;

  private mapPts: Float32Array;
  private mapCX = 0; private mapCZ = 0; private mapExt = 1;
  private tickX = 0; private tickZ = 0; private tickNX = 0; private tickNZ = 0;

  private bPrev: Button = { id: 'prev-map', x: 0, y: 0, w: 24, h: 24, label: '<' };
  private bNext: Button = { id: 'next-map', x: 0, y: 0, w: 24, h: 24, label: '>' };
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

  hit(clientX: number, clientY: number): HitId | null {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const x = ((clientX - r.left) / r.width) * this.w;
    const y = ((clientY - r.top) / r.height) * this.h;
    for (const b of this.buttons) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.id;
    }
    return null;
  }

  draw(state: UiState, time: number) {
    const c = this.ctx;
    c.clearRect(0, 0, this.w, this.h);
    c.imageSmoothingEnabled = false;

    if (state.adminPanel) {
      this.drawAdminPanel(state);
      return;
    }

    if (!state.started) {
      if (state.garage) this.drawGarage(state);
      else this.drawTitle(time, state);
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

    /* two tiers — the name with its arrows, then POWER · CLASS — with the corner
       buttons in the bottom tier. The old single band put
       the POWER line at by+27, straight through the 24px arrow boxes, so the tag
       was painted over and the class name was cut in half. Ratings shrink, then
       the name drops a size, before either is dropped, so 4:3 keeps every axis,
       and the POWER line is measured at the spacing it is drawn with — unspaced
       widths left it off-centre. */
    const by = this.h - 70;
    pxRect(c, 8, by, w - 16, 62, SLAB);
    pxBorder(c, 8, by, w - 16, 62, LINE);

    const compact = w < 600;
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
       offset put them on top of longer names (DUNE RUNNER is 155px at 16px) */
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

    const pwName = state.power?.name ?? '';
    const cls = state.carClass ?? '';
    const tag = cls ? ` · ${cls}` : '';
    const pwW = this.measure(pwName, 8, 400, 1);
    const tagW = tag ? this.measure(tag, 8, 400, 1) : 0;
    const showTag = tagW > 0 && pwW + tagW <= w - 32;
    const lineW = showTag ? pwW + tagW : pwW;
    const leftEdge = ratings ? rEdge + 6 : 16;

    const lineX = Math.max(leftEdge, Math.round(cx - lineW / 2));
    this.text(pwName, lineX, by + 34, { size: 8, color: ACCENT, spacing: 1 });
    if (showTag) this.text(tag, lineX + pwW, by + 34, { size: 8, color: DIM, spacing: 1 });

    this.bInfo.label = 'POWER INFO';
    this.bInfo.x = w - 156;
    this.bInfo.y = by + 46;
    this.bGarageBack.x = w - 64;
    this.bGarageBack.y = by + 46;
    for (const b of [this.bInfo, this.bGarageBack]) {
      pxRect(c, b.x, b.y, b.w, b.h, SLAB);
      pxBorder(c, b.x, b.y, b.w, b.h, 'rgba(242,238,225,0.55)');
      this.text(b.label, b.x + b.w / 2, b.y + 3, { size: 8, color: CREAM, align: 'center' });
      this.buttons.push(b);
    }

    // ratings, left of the name: ten hard segments per axis so 6 and 7 read apart
    if (ratings) {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const ry = by + 3 + i * 10;
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

    if (state.powerInfo) this.drawPowerInfo(state);
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

  private drawTitle(time: number, state: UiState) {
    const c = this.ctx;
    const { w, h } = this;
    this.buttons.length = 0;
    c.fillStyle = 'rgba(12,14,18,0.72)';
    c.fillRect(0, 0, w, h);

    this.checkerEdge(0, time, -1);
    this.checkerEdge(h - 16, time, 1);

    const cx = Math.round(w / 2);

    this.text('PIXEL', cx + 3, 61, { size: 48, weight: 700, color: SHADOW, align: 'center' });
    this.text('PIXEL', cx, 58, { size: 48, weight: 700, color: CREAM, align: 'center' });
    this.text('DRIFT', cx + 3, 113, { size: 48, weight: 700, color: SHADOW, align: 'center' });
    this.text('DRIFT', cx, 110, { size: 48, weight: 700, color: ACCENT, align: 'center' });

    const carNames = state.carNames ?? ['CAR'];
    const ci = ((state.car.variant % carNames.length) + carNames.length) % carNames.length;
    const carName = (carNames[ci] ?? 'CAR').toUpperCase();
    this.text('CAR', cx + 1, 203, { size: 8, color: SHADOW, align: 'center', spacing: 3 });
    this.text('CAR', cx, 202, { size: 8, color: 'rgba(242,238,225,0.85)', align: 'center', spacing: 3 });
    this.font(16, 700);
    const carW = Math.ceil(c.measureText(carName).width);
    this.text(carName, cx + 2, 216, { size: 16, weight: 700, color: SHADOW, align: 'center' });
    this.text(carName, cx, 214, { size: 16, weight: 700, color: CREAM, align: 'center' });
    const arrowButton = (b: Button, dir: number) => {
      pxRect(c, b.x, b.y, b.w, b.h, SLAB);
      pxBorder(c, b.x, b.y, b.w, b.h, 'rgba(242,238,225,0.55)');
      this.pixelArrow(b.x + 6, b.y + 7, dir);
      this.buttons.push(b);
    };
    this.bCarPrev.x = Math.round(cx - carW / 2 - 34);
    this.bCarPrev.y = 208;
    this.bCarNext.x = Math.round(cx + carW / 2 + 10);
    this.bCarNext.y = 208;
    arrowButton(this.bCarPrev, -1);
    arrowButton(this.bCarNext, 1);

    const maps = state.maps ?? [{ id: 'x', name: state.mapName ?? 'Pixel Drift' }];
    const mi = Math.max(0, Math.min(maps.length - 1, state.mapIndex ?? 0));
    const name = (maps[mi]?.name ?? 'Pixel Drift').toUpperCase();
    this.text('TRACK', cx + 1, 167, { size: 8, color: SHADOW, align: 'center', spacing: 3 });
    this.text('TRACK', cx, 166, { size: 8, color: 'rgba(242,238,225,0.85)', align: 'center', spacing: 3 });
    this.font(16, 700);
    const nameW = Math.ceil(c.measureText(name).width);
    const nameY = 178;
    this.text(name, cx + 2, nameY + 2, { size: 16, weight: 700, color: SHADOW, align: 'center' });
    this.text(name, cx, nameY, { size: 16, weight: 700, color: CREAM, align: 'center' });
    this.bPrev.x = Math.round(cx - nameW / 2 - 34);
    this.bPrev.y = 172;
    this.bNext.x = Math.round(cx + nameW / 2 + 10);
    this.bNext.y = 172;
    arrowButton(this.bPrev, -1);
    arrowButton(this.bNext, 1);

    this.bInfo.label = 'POWER INFO';
    this.bInfo.x = Math.round(cx - 74);
    this.bInfo.y = 238;
    this.bGarage.x = Math.round(cx + 4);
    this.bGarage.y = 238;
    for (const b of [this.bInfo, this.bGarage]) {
      pxRect(c, b.x, b.y, b.w, b.h, SLAB);
      pxBorder(c, b.x, b.y, b.w, b.h, 'rgba(242,238,225,0.45)');
      this.text(b.label, b.x + b.w / 2, b.y + 2, { size: 8, color: CREAM, align: 'center' });
      this.buttons.push(b);
    }
    // the player's own switches own this corner: mute lives in SETTINGS and N
    this.bSettings.label = 'SETTINGS';
    this.bSettings.w = 66;
    this.bSettings.x = this.w - 8 - this.bSettings.w;
    this.bSettings.y = this.h - 44;
    pxRect(c, this.bSettings.x, this.bSettings.y, this.bSettings.w, this.bSettings.h, SLAB);
    pxBorder(c, this.bSettings.x, this.bSettings.y, this.bSettings.w, this.bSettings.h, 'rgba(242,238,225,0.55)');
    this.text(this.bSettings.label, this.bSettings.x + this.bSettings.w / 2, this.bSettings.y + 3, {
      size: 8, color: CREAM, align: 'center',
    });
    this.buttons.push(this.bSettings);

    this.bSolo.label = 'PLAY';
    this.bSolo.w = 104;
    this.bSolo.x = Math.round(cx - 52);
    this.bSolo.y = 258;
    const key = (b: Button, fill: string) => {
      pxRect(c, b.x + 2, b.y + 2, b.w, b.h, SHADOW);
      pxRect(c, b.x, b.y, b.w, b.h, fill);
      c.fillStyle = CREAM;
      c.fillRect(b.x, b.y, b.w, 1);
      c.fillRect(b.x, b.y + b.h - 1, b.w, 1);
      c.fillRect(b.x, b.y + 1, 1, b.h - 2);
      c.fillRect(b.x + b.w - 1, b.y + 1, 1, b.h - 2);
      this.text(b.label, b.x + b.w / 2, b.y + 6, {
        size: 16, weight: 700, color: CREAM, align: 'center',
      });
      this.buttons.push(b);
    };
    key(this.bSolo, ACCENT);

    const acct = state.account;
    let blinkY = 296;
    if (acct) {
      if (acct.user) {
        const admin = acct.user.role === 'admin';
        this.text((admin ? 'ADMIN · ' : '') + 'SIGNED IN AS ' + acct.user.username.toUpperCase(), cx, 290, {
          size: 8, color: admin ? ACCENT : 'rgba(242,238,225,0.8)', align: 'center', spacing: 1,
        });
        if (admin) {
          this.bAdmin.x = Math.round(cx - 71);
          this.bAdmin.y = 302;
          pxRect(c, this.bAdmin.x, this.bAdmin.y, this.bAdmin.w, this.bAdmin.h, ACCENT);
          pxBorder(c, this.bAdmin.x, this.bAdmin.y, this.bAdmin.w, this.bAdmin.h, CREAM);
          this.text(this.bAdmin.label, this.bAdmin.x + this.bAdmin.w / 2, this.bAdmin.y + 3,
            { size: 8, weight: 700, color: CREAM, align: 'center' });
          this.buttons.push(this.bAdmin);
          this.bLogout.x = Math.round(cx - 1);
        } else {
          this.bLogout.x = Math.round(cx - this.bLogout.w / 2);
        }
        this.bLogout.label = acct.busy ? '...' : 'SIGN OUT';
        this.bLogout.y = 302;
        pxRect(c, this.bLogout.x, this.bLogout.y, this.bLogout.w, this.bLogout.h, SLAB);
        pxBorder(c, this.bLogout.x, this.bLogout.y, this.bLogout.w, this.bLogout.h, 'rgba(242,238,225,0.55)');
        this.text(this.bLogout.label, this.bLogout.x + this.bLogout.w / 2, this.bLogout.y + 3,
          { size: 8, color: CREAM, align: 'center' });
        this.buttons.push(this.bLogout);
        blinkY = 320;
      } else {
        this.bLogin.label = acct.busy ? '...' : 'SIGN IN';
        this.bLogin.x = Math.round(cx - this.bLogin.w / 2);
        this.bLogin.y = 292;
        pxRect(c, this.bLogin.x, this.bLogin.y, this.bLogin.w, this.bLogin.h, SLAB);
        pxBorder(c, this.bLogin.x, this.bLogin.y, this.bLogin.w, this.bLogin.h, 'rgba(242,238,225,0.55)');
        this.text(this.bLogin.label, cx, this.bLogin.y + 3, { size: 8, color: CREAM, align: 'center' });
        this.buttons.push(this.bLogin);
        blinkY = 312;
      }
    }

    /* the board hugs the corner but never over the track selector: its right
       arrow reaches as deep as the longest map name is wide, so the panel's
       left edge starts past it (and the board hides if there is no room) */
    const trackArrowRight = Math.round(w / 2 + nameW / 2 + 10) + 24;
    const boardLx = Math.max(w - 188, trackArrowRight + 6);
    if (acct && w >= 560 && w - 8 - boardLx >= 116) {
      /* the board hangs off the top-right corner: an ink header naming the panel
         over the track it belongs to, then a real little table — rank gutter,
         player, time — under dim column labels and a hairline. The winner is
         painted in accent so the top of the board reads before the numbers do;
         your own row gets a cream tick and a lifted fill. Ranks sit in a fixed
         gutter and the time column is measured before the name is cut, so a
         14-character name truncates instead of running into it. */
      const lx = boardLx, pw = w - 8 - boardLx, py = 34;
      const pad = 9;
      const right = lx + pw - pad;
      const hh = 26;                          // ink header: panel name over track
      const rh = 14;                          // row height
      const n = acct.offline ? 0 : Math.min(10, acct.times.length);
      const labelH = n === 0 ? 0 : 13;        // column labels only label rows
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
        // nothing ranked: the state at full weight, then what it means for you
        this.text(acct.offline ? 'OFFLINE' : 'NO TIMES YET', lx + pw / 2, py + hh + 11, {
          size: 8, weight: 700, color: acct.offline ? ACCENT : CREAM,
          align: 'center', spacing: 2,
        });
        this.text(acct.offline ? 'BOARD UNREACHABLE' : 'BE THE FIRST', lx + pw / 2, py + hh + 22,
          { size: 8, color: DIM, align: 'center' });
      } else {
        /* without the labels the rank gutter and the time column read as loose
           numbers; one dim line and a hairline turn them into a table */
        this.text('RK', rankX, py + hh + 2, { size: 8, color: DIM, align: 'right' });
        this.text('PLAYER', nameX, py + hh + 2, { size: 8, color: DIM });
        this.text('TIME', right, py + hh + 2, { size: 8, color: DIM, align: 'right' });
        c.fillStyle = LINE;
        c.fillRect(lx + 6, py + hh + 11, pw - 12, 1);

        const me = (acct.user?.username ?? '').toUpperCase();
        for (let i = 0; i < n; i++) {
          const t = acct.times[i];
          const ry = py + hh + labelH + i * rh;
          const lead = t.rank === 1;
          const mine = me !== '' && t.username.toUpperCase() === me;
          if (lead) {
            // the leader is painted, not tinted: the board's answer at a glance
            pxRect(c, lx + 3, ry, pw - 6, rh, ACCENT);
          } else if (mine) {
            c.fillStyle = 'rgba(242,238,225,0.1)';
            c.fillRect(lx + 3, ry, pw - 6, rh);
          } else if (i % 2 === 1) {
            c.fillStyle = 'rgba(242,238,225,0.045)';
            c.fillRect(lx + 3, ry, pw - 6, rh);
          }
          if (mine) {
            // your line, wherever it sits: tick in the rank gutter
            c.fillStyle = 'rgba(242,238,225,0.75)';
            c.fillRect(lx + 3, ry + 2, 2, rh - 4);
          }
          const y = ry + 4;
          this.text(String(t.rank).padStart(2, '0'), rankX, y, {
            size: 8, weight: lead ? 700 : 400, color: lead ? CREAM : DIM, align: 'right',
          });
          let name = t.username.toUpperCase();
          const weight = lead || mine ? 700 : 400;
          this.font(8, weight);
          while (name.length > 1 && c.measureText(name).width > nameMax) name = name.slice(0, -1);
          this.text(name, nameX, y, { size: 8, weight, color: CREAM });
          this.text(fmtMs(t.ms), right, y, { size: 8, weight: 700, color: CREAM, align: 'right' });
        }
      }
    }

    const on = (time % 1.2) < 0.85;
    this.text('OR PRESS SPACE', cx, blinkY, { size: 8, color: on ? CREAM : 'rgba(242,238,225,0.15)', align: 'center', spacing: 1 });

    this.text('WASD DRIVE   SPACE DRIFT   F POWER   Q E LOOK   R RESET   N MUTE', cx, h - 26, {
      size: 8, color: HINT, align: 'center',
    });
    if (state.powerInfo) this.drawPowerInfo(state);
    if (state.settings) this.drawSettings(state);
  }

  /** The player's own switches: sound now, the ghost car the same way. A
      modal like POWER INFO — dimmed world, this.buttons cleared so only the
      panel can be hit, and its own relabelled CLOSE. */
  private drawSettings(state: UiState) {
    const c = this.ctx;
    this.buttons.length = 0;
    c.fillStyle = 'rgba(10,12,16,0.62)';
    c.fillRect(0, 0, this.w, this.h);
    const w = 226, h = 118;
    const x = Math.round((this.w - w) / 2), y = Math.round((this.h - h) / 2);
    pxRect(c, x, y, w, h, SLAB);
    pxRect(c, x, y, w, 14, INK);
    pxBorder(c, x, y, w, h, 'rgba(242,238,225,0.75)');
    c.fillStyle = ACCENT;
    c.fillRect(x + 5, y + 4, 2, 8);
    this.text('SETTINGS', x + 12, y + 3, { size: 8, weight: 700, color: CREAM, spacing: 2 });
    this.text('YOUR GAME, YOUR RULES', x + w - 9, y + 3, { size: 8, color: DIM, align: 'right' });
    const rows = state.settingsRows ?? [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const ry = y + 30 + i * 20;
      this.text(r.label, x + 12, ry, { size: 8, weight: 700, color: CREAM });
      const label = r.on ? 'ON' : 'OFF';
      const cw = this.measure(label, 8, 700) + 16;
      const bx = x + w - cw - 12, by = ry - 3;
      pxRect(c, bx, by, cw, 14, r.on ? ACCENT : SLAB);
      pxBorder(c, bx, by, cw, 14, r.on ? CREAM : 'rgba(242,238,225,0.55)');
      this.text(label, bx + cw / 2, by + 3, {
        size: 8, weight: 700, color: r.on ? CREAM : DIM, align: 'center',
      });
      this.buttons.push({ id: `setting-${r.name}`, x: bx, y: by, w: cw, h: 14, label });
    }
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

  // Font glyphs read thin at this size, so arrows are drawn by hand.
  private pixelArrow(x: number, y: number, dir: number) {
    const c = this.ctx;
    c.fillStyle = CREAM;
    for (let i = 0; i < 4; i++) {
      const hgt = 3 + i * 2;
      const yy = Math.round(y + (9 - hgt) / 2);
      const xx = Math.round(dir < 0 ? x + 6 - i * 2 : x + i * 2);
      c.fillRect(xx, yy, 2, hgt);
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
