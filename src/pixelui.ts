import type { Car } from './car';

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
const HINT = 'rgba(242,238,225,0.42)';

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
  maps?: { id: string; name: string }[];
  mapIndex?: number;
  mapName?: string;
  /** force the NEW BEST banner for a couple of seconds (also auto-detected) */
  bestFlash?: boolean;
}

const fmt = (t: number) => {
  if (!isFinite(t) || t <= 0) return '--:--.--';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t * 100) % 100);
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

interface Button { id: string; x: number; y: number; w: number; h: number; label: string }

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
  private bSolo: Button = { id: 'solo', x: 0, y: 0, w: 148, h: 28, label: 'RACE SOLO' };
  private buttons: Button[] = [];

  /* NEW BEST banner bookkeeping */
  private lastBest = -1;
  private bestUntil = -1;

  onAction?: (a: string) => void;

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
  } = {}) {
    const c = this.ctx;
    this.font(o.size ?? 8, o.weight ?? 400);
    c.fillStyle = o.color ?? CREAM;
    c.textAlign = o.align ?? 'left';
    c.textBaseline = o.baseline ?? 'top';
    c.fillText(s, x, y);
  }

  /** Convert a pointer event to internal pixels and return the button under it. */
  hit(clientX: number, clientY: number): string | null {
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
    const ms = 64, mx = 8, my = this.h - ms - 32;
    pxRect(c, mx, my, ms, ms, SLAB);
    pxBorder(c, mx, my, ms, ms, LINE);
    this.drawMap(car, mx + 5, my + 5, ms - 10);
    const stage = (state.mapName ?? state.maps?.[state.mapIndex ?? 0]?.name ?? 'SPRITE DRIFT').toUpperCase();
    this.font(8, 700);
    const nw = Math.ceil(c.measureText(stage).width) + 12;
    let nx = Math.round(mx + ms / 2 - nw / 2);
    if (nx < 4) nx = 4;
    pxRect(c, nx, my + ms + 6, nw, 14, CREAM);
    this.text(stage, nx + nw / 2, my + ms + 8, { size: 8, weight: 700, color: INK, align: 'center' });

    /* ---- dashboard (bottom-right): big digits, gear, 14-seg bar ---- */
    const sw = 150, sh = 82, sx = this.w - sw - 8, sy = this.h - sh - 8;
    pxRect(c, sx, sy, sw, sh, SLAB);
    pxBorder(c, sx, sy, sw, sh, LINE);
    this.text('KM/H', sx + sw - 8, sy + 5, { size: 8, color: DIM, align: 'right' });
    this.text(String(kmh), sx + sw - 6, sy + 14, { size: 48, weight: 700, color: CREAM, align: 'right' });
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
      this.text('WASD DRIVE   SPACE DRIFT   R RESET', this.w / 2, this.h - 16, {
        size: 8, color: HINT, align: 'center',
      });
    }

    /* ---- pause ---- */
    if (state.paused) {
      c.fillStyle = 'rgba(8,11,10,0.66)';
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

  /* ----------------------------------------------------------- minimap --- */

  private drawMap(car: Car, x: number, y: number, size: number) {
    const c = this.ctx;
    const half = size / 2;
    const sc = size * 0.96;
    const px = (v: number) => x + half + v * sc;

    /* road: dim outer stroke + bright 1px centreline (crisp outline look) */
    c.beginPath();
    for (let i = 0; i < this.mapPts.length; i += 2) {
      if (i === 0) c.moveTo(px(this.mapPts[0]), px(this.mapPts[1]));
      else c.lineTo(px(this.mapPts[i]), px(this.mapPts[i + 1]));
    }
    c.closePath();
    c.lineJoin = 'round';
    c.strokeStyle = 'rgba(242,238,225,0.2)';
    c.lineWidth = 4;
    c.stroke();
    c.strokeStyle = 'rgba(242,238,225,0.85)';
    c.lineWidth = 1;
    c.stroke();

    /* start-line mini-checker */
    const sx = px(this.tickX), sz = px(this.tickZ);
    c.fillStyle = CREAM;
    c.fillRect(Math.round(sx + this.tickNX * -3), Math.round(sz + this.tickNZ * -3), 3, 3);
    c.fillStyle = 'rgba(242,238,225,0.35)';
    c.fillRect(Math.round(sx), Math.round(sz), 3, 3);

    /* car wedge */
    const cx = x + half + ((car.x - this.mapCX) / this.mapExt) * sc;
    const cz = y + half + ((car.z - this.mapCZ) / this.mapExt) * sc;
    const fx = -Math.sin(car.heading), fz = -Math.cos(car.heading);
    const rx = Math.cos(car.heading), rz = -Math.sin(car.heading);
    c.fillStyle = ACCENT;
    c.beginPath();
    c.moveTo(cx + fx * 3.5, cz + fz * 3.5);
    c.lineTo(cx - fx * 2.2 + rx * 2.4, cz - fz * 2.2 + rz * 2.4);
    c.lineTo(cx - fx * 2.2 - rx * 2.4, cz - fz * 2.2 - rz * 2.4);
    c.closePath();
    c.fill();
    c.strokeStyle = INK;
    c.lineWidth = 1;
    c.stroke();
  }

  /* ------------------------------------------------------------- title --- */

  private drawTitle(time: number, state: UiState) {
    const c = this.ctx;
    const { w, h } = this;
    c.fillStyle = 'rgba(9,13,12,0.7)';
    c.fillRect(0, 0, w, h);

    /* the motif: scrolling chequered timing strips framing the screen */
    this.checkerEdge(0, time, -1);
    this.checkerEdge(h - 16, time, 1);

    const cx = Math.round(w / 2);

    const kicker = state.room ? `ROOM ${state.room} — SHARE THIS LINK` : 'SPRITE-STACKED PIXEL RACER';
    this.text(kicker, cx, 56, { size: 8, weight: 700, color: ACCENT, align: 'center' });

    /* lockup with hard offset shadow blocks */
    this.text('SPRITE', cx + 3, 77, { size: 48, weight: 700, color: SHADOW, align: 'center' });
    this.text('SPRITE', cx, 74, { size: 48, weight: 700, color: CREAM, align: 'center' });
    this.text('DRIFT', cx + 3, 129, { size: 48, weight: 700, color: SHADOW, align: 'center' });
    this.text('DRIFT', cx, 126, { size: 48, weight: 700, color: ACCENT, align: 'center' });

    /* track chooser */
    const maps = state.maps ?? [{ id: 'x', name: state.mapName ?? 'Sprite Drift' }];
    const mi = Math.max(0, Math.min(maps.length - 1, state.mapIndex ?? 0));
    const name = (maps[mi]?.name ?? 'Sprite Drift').toUpperCase();
    this.text('TRACK', cx, 206, { size: 8, color: DIM, align: 'center' });
    this.font(16, 700);
    const nameW = Math.ceil(c.measureText(name).width);
    const nameY = 218;
    const bY = nameY - 4;
    this.bPrev.x = Math.round(cx - nameW / 2 - 34); this.bPrev.y = bY;
    this.bNext.x = Math.round(cx + nameW / 2 + 10); this.bNext.y = bY;
    for (const b of [this.bPrev, this.bNext]) {
      pxRect(c, b.x, b.y, b.w, b.h, 'rgba(18,22,26,0.92)');
      pxBorder(c, b.x, b.y, b.w, b.h, 'rgba(242,238,225,0.55)');
      this.text(b.label, b.x + b.w / 2, b.y + 4, { size: 16, weight: 700, color: CREAM, align: 'center' });
      this.buttons.push(b);
    }
    this.text(name, cx, nameY, { size: 16, weight: 700, color: CREAM, align: 'center' });

    /* SOLO button: chunky arcade key with offset block */
    this.bSolo.x = Math.round(cx - this.bSolo.w / 2);
    this.bSolo.y = 256;
    pxRect(c, this.bSolo.x + 2, this.bSolo.y + 2, this.bSolo.w, this.bSolo.h, SHADOW);
    pxRect(c, this.bSolo.x, this.bSolo.y, this.bSolo.w, this.bSolo.h, ACCENT);
    pxBorder(c, this.bSolo.x, this.bSolo.y, this.bSolo.w, this.bSolo.h, CREAM);
    this.text(this.bSolo.label, cx, this.bSolo.y + 6, { size: 16, weight: 700, color: CREAM, align: 'center' });
    this.buttons.push(this.bSolo);

    /* hard blink, attract-mode style */
    const on = (time % 1.2) < 0.85;
    this.text('OR PRESS SPACE', cx, 296, { size: 8, color: on ? DIM : 'rgba(242,238,225,0.15)', align: 'center' });

    this.text('WASD / ARROWS DRIVE   SPACE HANDBRAKE   Q E LOOK   R RESET   M MUTE', cx, h - 26, {
      size: 8, color: HINT, align: 'center',
    });
  }

  /** two-row, 8px-cell chequered strip that slowly scrolls sideways */
  private checkerEdge(y: number, time: number, dir: number) {
    const c = this.ctx;
    const cell = 8, rows = 2;
    const scroll = time * 12 * dir;
    const s = Math.floor(scroll / cell);
    const d = Math.floor(((scroll % cell) + cell) % cell);
    const n = Math.ceil(this.w / cell) + 1;
    for (let i = -1; i <= n; i++) {
      for (let j = 0; j < rows; j++) {
        const on = ((i - s + j) % 2 + 2) % 2 === 0;
        c.fillStyle = on ? 'rgba(242,238,225,0.85)' : 'rgba(242,238,225,0.12)';
        c.fillRect(i * cell - d, y + j * cell, cell, cell);
      }
    }
  }
}
