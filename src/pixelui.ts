import type { Car } from './car';
import type { TimeEntry, User } from './account';

/* ------------------------------------------------------------ palette ----- */
const CREAM = '#f2eee1';
const INK = '#14161a';
const ACCENT = '#e0513f';

const DIM = 'rgba(242,238,225,0.55)';
const INKD = 'rgba(20,22,26,0.55)';          // ink labels on cream cards
const SLAB = 'rgba(43,43,51,0.88)';           // asphalt glass panels
const LINE = 'rgba(242,238,225,0.22)';        // quiet cream border
const SEG_OFF = 'rgba(242,238,225,0.14)';     // unlit speed segment
const SEG_RED_OFF = 'rgba(224,81,63,0.22)';   // unlit redline segment
const RULE = 'rgba(20,22,26,0.18)';           // ruled line on cream
const SHADOW = 'rgba(8,10,12,0.8)';          // hard offset block
const HINT = 'rgba(242,238,225,0.58)';
const ASPHALT = '#2b2b33';

/** live view of the account store (src/account.ts) */
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
  throttle: number;
  laps: number;
  room?: string;
  racers?: number;
  connected?: boolean;
  place?: number;
  /** transient room notice, e.g. "ACE JOINED" */
  toast?: string;
  maps?: { id: string; name: string }[];
  mapIndex?: number;
  mapName?: string;
  lapHistory?: number[];
  countdown?: number;
  finished?: boolean;
  results?: { name: string; best: number }[];
  /** force the NEW BEST banner for a couple of seconds (also auto-detected) */
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

/** leaderboard times arrive from the server as integer milliseconds */
const fmtMs = (ms: number) => {
  if (!isFinite(ms) || ms <= 0) return '--:--.--';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `${m}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
};

/** flat rect with 1px clipped corners */
function pxRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string) {
  c.fillStyle = fill;
  c.fillRect(x + 1, y, w - 2, h);
  c.fillRect(x, y + 1, w, h - 2);
}
/** 1px border that respects the clipped corners */
function pxBorder(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string) {
  c.fillStyle = col;
  c.fillRect(x + 1, y, w - 2, 1);
  c.fillRect(x + 1, y + h - 1, w - 2, 1);
  c.fillRect(x, y + 1, 1, h - 2);
  c.fillRect(x + w - 1, y + 1, 1, h - 2);
}

/** every clickable thing on the canvas */
export type HitId = 'prev-map' | 'next-map' | 'solo' | 'online' | 'login' | 'logout';

interface Button { id: HitId; x: number; y: number; w: number; h: number; label: string }

export class PixelUI {
  private ctx: CanvasRenderingContext2D;
  private w = 576;
  private h = 360;

  /* minimap: track normalized to [-0.5, 0.5], computed once */
  private mapPts: Float32Array;
  private mapCX = 0; private mapCZ = 0; private mapExt = 1;
  private tickX = 0; private tickZ = 0; private tickNX = 0; private tickNZ = 0;

  /* persistent buttons (no per-frame allocation) */
  private bPrev: Button = { id: 'prev-map', x: 0, y: 0, w: 24, h: 24, label: '<' };
  private bNext: Button = { id: 'next-map', x: 0, y: 0, w: 24, h: 24, label: '>' };
  private bSolo: Button = { id: 'solo', x: 0, y: 0, w: 148, h: 28, label: 'SOLO' };
  private bOnline: Button = { id: 'online', x: 0, y: 0, w: 112, h: 28, label: 'ONLINE' };
  private bLogin: Button = { id: 'login', x: 0, y: 0, w: 72, h: 14, label: 'SIGN IN' };
  private bLogout: Button = { id: 'logout', x: 0, y: 0, w: 72, h: 14, label: 'SIGN OUT' };
  private buttons: Button[] = [];

  /* NEW BEST banner bookkeeping */
  private lastBest = -1;
  private bestUntil = -1;

  onAction?: (a: HitId) => void;

  constructor(private canvas: HTMLCanvasElement, track: { x: number; z: number }[]) {
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

    /* start-line tick: perpendicular to the first track segment */
    const a = track[0];
    const b = track[1] ?? track[0];
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

  /** Convert a pointer event to internal pixels and return the button under it. */
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

  /* --------------------------------------------------------------- draw --- */

  draw(state: UiState, time: number) {
    const c = this.ctx;
    c.clearRect(0, 0, this.w, this.h);
    c.imageSmoothingEnabled = false;

    if (!state.started) {
      this.drawTitle(time, state);
      return;
    }
    this.buttons.length = 0;

    const car = state.car;
    const kmh = Math.round(Math.abs(car.speed) * 3.6);
    const gear = car.speed < -0.5 ? 'R' : Math.min(6, 1 + Math.floor(kmh / 22)).toString();

    /* NEW BEST: auto-detected from bestTime drops, or forced via bestFlash */
    const best = state.bestTime;
    if (this.lastBest < 0) this.lastBest = best;
    else {
      if (isFinite(best) && best > 0 && (this.lastBest <= 0 || best < this.lastBest - 1e-6)) {
        this.bestUntil = time + 2.6;
      }
      this.lastBest = best;
    }
    if (state.bestFlash) this.bestUntil = Math.max(this.bestUntil, time + 2.6);

    /* ---- rally timecard (top-left) ---- */
    const tx = 8, ty = 16, tw = 136, th = 46;
    pxRect(c, tx, ty, tw, th, CREAM);
    c.fillStyle = ACCENT;                       // red spine
    c.fillRect(tx, ty + 3, 3, th - 6);
    const lapLabel = 'LAP ' + Math.min(99, state.laps + 1).toString().padStart(2, '0');
    this.font(8, 700);
    const lapW = Math.ceil(c.measureText(lapLabel).width) + 14;
    pxRect(c, tx + 2, ty - 9, lapW, 11, ACCENT);  // clipboard tab
    this.text(lapLabel, tx + 2 + lapW / 2, ty - 7, { size: 8, weight: 700, color: CREAM, align: 'center' });
    this.text('TIME', tx + 10, ty + 7, { size: 8, color: INKD });
    this.text(fmt(state.lapTime), tx + tw - 8, ty + 4, { size: 16, weight: 700, color: INK, align: 'right' });
    c.fillStyle = RULE;
    c.fillRect(tx + 8, ty + 27, tw - 14, 1);
    this.text('BEST', tx + 10, ty + 31, { size: 8, color: INKD });
    this.text(fmt(state.bestTime), tx + tw - 8, ty + 31, { size: 8, color: INK, align: 'right' });

    /* ---- drift card (top-right) ---- */
    const dw = 88, dh = 38, dx = this.w - dw - 8, dy = 8;
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

    /* ---- room chip (top-centre, online only) ---- */
    if (state.room) {
      let label = `ROOM ${state.room}  ${state.racers ?? 1} RACING`;
      if (state.place && (state.racers ?? 1) > 1) label += `  P${state.place}/${state.racers}`;
      this.font(8);
      const cw = Math.ceil(c.measureText(label).width) + 14;
      const rx = Math.round((this.w - cw) / 2);
      pxRect(c, rx, 8, cw, 16, SLAB);
      pxBorder(c, rx, 8, cw, 16, state.connected ? 'rgba(242,238,225,0.3)' : ACCENT);
      this.text(label, this.w / 2, 12, { size: 8, color: state.connected ? CREAM : ACCENT, align: 'center' });
    }
    if (state.toast) this.drawToast(state.toast, 58);

    /* ---- NEW BEST banner ---- */
    if (time < this.bestUntil) {
      const bbw = 118, bbh = 22;
      const bx = Math.round(this.w / 2 - bbw / 2);
      const by = state.room ? 30 : 10;
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

    /* ---- minimap + stage name chip (bottom-left) ---- */
    const ms = 96, mx = 8, my = this.h - ms - 26;
    pxRect(c, mx, my, ms, ms, SLAB);
    pxBorder(c, mx, my, ms, ms, LINE);
    this.drawMap(car, mx + 5, my + 5, ms - 10);
    const stage = (state.mapName ?? state.maps?.[state.mapIndex ?? 0]?.name ?? 'SPRITE DRIFT').toUpperCase();
    this.font(8, 700);
    const nw = Math.max(ms, Math.ceil(c.measureText(stage).width) + 12);
    pxRect(c, mx, my + ms + 6, nw, 14, CREAM);
    this.text(stage, mx + nw / 2, my + ms + 8, { size: 8, weight: 700, color: INK, align: "center" });

    /* ---- dashboard (bottom-right): big digits, gear, 14-seg bar ---- */
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

    /* ---- first-lap hints ---- */
    if (state.laps === 0) {
      const msg = 'WASD DRIVE   SPACE DRIFT   R RESET';
      this.font(8);
      const hw = Math.ceil(c.measureText(msg).width) + 16;
      const hx = Math.round(this.w / 2 - hw / 2), hy = this.h - 18;
      pxRect(c, hx, hy, hw, 14, SLAB);
      pxBorder(c, hx, hy, hw, 14, LINE);
      this.text(msg, this.w / 2, hy + 3, { size: 8, color: 'rgba(242,238,225,0.8)', align: 'center' });
    }

    /* ---- pause ---- */
    if ((state.countdown ?? 0) > 0) {
      const n = Math.ceil(state.countdown!);
      const cx2 = Math.round(this.w / 2);
      const y0 = 54;
      pxRect(c, cx2 - 26, y0 - 8, 52, 22, 'rgba(16,19,22,0.85)');
      pxBorder(c, cx2 - 26, y0 - 8, 52, 22, 'rgba(242,238,225,0.25)');
      for (let i = 0; i < 3; i++) {
        const lit = n <= 3 - i;
        c.fillStyle = lit ? (n === 1 ? '#49c46a' : ACCENT) : 'rgba(242,238,225,0.14)';
        c.fillRect(cx2 - 18 + i * 13, y0, 9, 9);
      }
    }
    if (state.finished) {
      c.fillStyle = 'rgba(8,11,10,0.6)';
      c.fillRect(0, 0, this.w, this.h);
      this.text('RACE COMPLETE', this.w / 2, this.h / 2 - 26, { size: 24, weight: 700, align: 'center' });
      this.text(`BEST OF 3   ${fmt(state.bestTime)}`, this.w / 2, this.h / 2 + 8, { size: 8, color: CREAM, align: 'center' });
      (state.results ?? []).slice(0, 5).forEach((r, i) => {
        this.text(`${i + 1}  ${r.name.slice(0, 8)}  ${fmt(r.best)}`, this.w / 2, this.h / 2 + 24 + i * 11, {
          size: 8, color: DIM, align: 'center',
        });
      });
      this.text('R TO RACE AGAIN', this.w / 2, this.h / 2 + 24 + Math.max(1, (state.results ?? []).length) * 11 + 6, { size: 8, color: DIM, align: 'center' });
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
      this.text('P TO RESUME', this.w / 2, this.h / 2 + 18, { size: 8, color: DIM, align: 'center' });
    }
  }

  /** transient room notice: cream on red, centred */
  private drawToast(text: string, y: number) {
    const c = this.ctx;
    this.font(8, 700);
    const w = Math.ceil(c.measureText(text).width) + 18;
    const x = Math.round((this.w - w) / 2);
    pxRect(c, x, y, w, 15, ACCENT);
    pxBorder(c, x, y, w, 15, 'rgba(242,238,225,0.85)');
    this.text(text, this.w / 2, y + 4, { size: 8, weight: 700, color: CREAM, align: 'center' });
  }

  /* ----------------------------------------------------------- minimap --- */
  private drawMap(car: Car, x: number, y: number, size: number) {
    const c = this.ctx;

    // fit the whole circuit, with a margin, from its own bounds
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

    // road: dark casing then a bright line, 1px, no glow
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

    // start line tick
    if (this.tickX || this.tickZ) {
      c.strokeStyle = 'rgba(242,238,225,0.55)';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(px(this.tickX - this.tickNX * 0.05), pz(this.tickZ - this.tickNZ * 0.05));
      c.lineTo(px(this.tickX + this.tickNX * 0.05), pz(this.tickZ + this.tickNZ * 0.05));
      c.stroke();
    }

    // car: a filled wedge pointing where it faces
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

  /* ------------------------------------------------------------- title --- */

  private drawTitle(time: number, state: UiState) {
    const c = this.ctx;
    const { w, h } = this;
    this.buttons.length = 0;   // rebuilt every frame
    c.fillStyle = 'rgba(12,14,18,0.72)';
    c.fillRect(0, 0, w, h);

    /* the motif: scrolling chequered timing strips framing the screen */
    this.checkerEdge(0, time, -1);
    this.checkerEdge(h - 16, time, 1);

    const cx = Math.round(w / 2);

    const kicker = state.room
      ? state.connected === false
        ? `ROOM ${state.room} · CONNECTING…`
        : `ROOM ${state.room} · ${state.racers ?? 1} IN ROOM · SHARE THIS LINK`
      : 'SPRITE-STACKED PIXEL RACER';
    this.text(kicker, cx, 56, { size: 8, weight: 700, color: ACCENT, align: 'center', spacing: 2 });
    if (state.toast) this.drawToast(state.toast, 26);

    /* lockup with hard offset shadow blocks */
    this.text('SPRITE', cx + 3, 77, { size: 48, weight: 700, color: SHADOW, align: 'center' });
    this.text('SPRITE', cx, 74, { size: 48, weight: 700, color: CREAM, align: 'center' });
    this.text('DRIFT', cx + 3, 129, { size: 48, weight: 700, color: SHADOW, align: 'center' });
    this.text('DRIFT', cx, 126, { size: 48, weight: 700, color: ACCENT, align: 'center' });

    /* track chooser */
    const maps = state.maps ?? [{ id: 'x', name: state.mapName ?? 'Sprite Drift' }];
    const mi = Math.max(0, Math.min(maps.length - 1, state.mapIndex ?? 0));
    const name = (maps[mi]?.name ?? 'Sprite Drift').toUpperCase();
    this.text('TRACK', cx, 206, { size: 8, color: 'rgba(242,238,225,0.8)', align: 'center', spacing: 3 });
    this.font(16, 700);
    const nameW = Math.ceil(c.measureText(name).width);
    const nameY = 218;
    const bY = nameY - 5;
    this.bPrev.x = Math.round(cx - nameW / 2 - 40); this.bPrev.y = bY;
    this.bNext.x = Math.round(cx + nameW / 2 + 16); this.bNext.y = bY;
    for (const b of [this.bPrev, this.bNext]) {
      pxRect(c, b.x, b.y, b.w, b.h, 'rgba(18,22,26,0.92)');
      pxBorder(c, b.x, b.y, b.w, b.h, 'rgba(242,238,225,0.55)');
      this.pixelArrow(b.x + b.w / 2 - 4, b.y + b.w / 2 - 4, b.id === 'prev-map' ? -1 : 1);
      this.buttons.push(b);
    }
    this.text(name, cx, nameY, { size: 16, weight: 700, color: CREAM, align: 'center' });

    /* SOLO + ONLINE buttons: chunky arcade keys with offset blocks */
    const hasRoom = !!state.room;
    this.bSolo.label = hasRoom ? 'START' : 'SOLO';
    this.bSolo.w = 104;
    this.bSolo.x = Math.round(hasRoom ? cx - 52 : cx - 114);
    this.bSolo.y = 256;
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
    if (!hasRoom) {
      this.bOnline.x = Math.round(cx + 2);
      this.bOnline.y = 256;
      key(this.bOnline, 'rgba(18,22,26,0.92)');
    }

    /* ---- account line under SOLO ---- */
    const acct = state.account;
    let blinkY = 296;
    if (acct) {
      if (acct.user) {
        this.text('SIGNED IN AS ' + acct.user.username.toUpperCase(), cx, 290, {
          size: 8, color: 'rgba(242,238,225,0.8)', align: 'center', spacing: 1,
        });
        this.bLogout.label = acct.busy ? '...' : 'SIGN OUT';
        this.bLogout.x = Math.round(cx - this.bLogout.w / 2);
        this.bLogout.y = 302;
        pxRect(c, this.bLogout.x, this.bLogout.y, this.bLogout.w, this.bLogout.h, SLAB);
        pxBorder(c, this.bLogout.x, this.bLogout.y, this.bLogout.w, this.bLogout.h, 'rgba(242,238,225,0.55)');
        this.text(this.bLogout.label, cx, this.bLogout.y + 3, { size: 8, color: CREAM, align: 'center' });
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

    /* ---- leaderboard column (right edge) ---- */
    if (acct && w >= 560) {
      const lx = w - 176;
      this.text('LEADERBOARD', w - 8, 48, { size: 8, weight: 700, color: CREAM, align: 'right', spacing: 2 });
      c.fillStyle = LINE;
      c.fillRect(lx, 60, 168, 1);
      if (acct.offline) {
        this.text('OFFLINE', w - 8, 66, { size: 8, color: DIM, align: 'right', spacing: 1 });
      } else {
        this.font(8);
        const timeW = Math.ceil(c.measureText('00:00.00').width);
        const nameMax = 168 - 18 - timeW;
        const n = Math.min(5, acct.times.length);
        for (let i = 0; i < n; i++) {
          const t = acct.times[i];
          const y = 66 + i * 12;
          this.text(String(t.rank).padStart(2, '0'), lx, y, { size: 8, color: DIM });
          let name = t.username.toUpperCase();
          while (name.length > 1 && c.measureText(name).width > nameMax) name = name.slice(0, -1);
          this.text(name, lx + 18, y, { size: 8, color: CREAM });
          this.text(fmtMs(t.ms), w - 8, y, { size: 8, color: CREAM, align: 'right' });
        }
        if (n === 0) this.text('NO TIMES YET', w - 8, 66, { size: 8, color: DIM, align: 'right', spacing: 1 });
      }
    }

    /* hard blink, attract-mode style */
    const on = (time % 1.2) < 0.85;
    this.text('OR PRESS SPACE', cx, blinkY, { size: 8, color: on ? CREAM : 'rgba(242,238,225,0.15)', align: 'center', spacing: 1 });

    this.text('WASD / ARROWS DRIVE   SPACE HANDBRAKE   Q E LOOK   R RESET   M MUTE', cx, h - 26, {
      size: 8, color: HINT, align: 'center',
    });
  }

  /** chunky 8x9 pixel arrow (font glyphs read thin at this size) */
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

  /** two-row, 8px-cell chequered strip; pattern crawls in whole cells (crisp edges) */
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
