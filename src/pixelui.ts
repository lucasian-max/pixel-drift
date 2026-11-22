import type { Car } from './car';

const CREAM = '#f2eee1';
const INK = '#14161a';
const ACCENT = '#e0513f';
const DIM = 'rgba(242,238,225,0.55)';

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
}

const fmt = (t: number) => {
  if (!isFinite(t) || t <= 0) return '--:--.--';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t * 100) % 100);
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

interface Button { id: string; x: number; y: number; w: number; h: number; label: string }

export class PixelUI {
  private ctx: CanvasRenderingContext2D;
  private w = 576;
  private h = 360;
  private track: { x: number; z: number }[];
  private buttons: Button[] = [];
  onAction?: (a: string) => void;

  constructor(private canvas: HTMLCanvasElement, track: { x: number; z: number }[]) {
    this.ctx = canvas.getContext('2d')!;
    this.track = track;
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

  draw(state: UiState, time: number) {
    const c = this.ctx;
    c.clearRect(0, 0, this.w, this.h);
    c.imageSmoothingEnabled = false;

    if (!state.started) {
      this.drawTitle(time, state);
      return;
    }
    this.buttons = [];

    const car = state.car;
    const kmh = Math.round(Math.abs(car.speed) * 3.6);
    const gear = car.speed < -0.5 ? 'R' : Math.min(6, 1 + Math.floor(kmh / 22)).toString();

    /* timing card */
    const cw = 104, ch = 32, cx = 8, cy = 8;
    pxRect(c, cx, cy, cw, ch, CREAM);
    pxBorder(c, cx + 1, cy + 1, cw - 2, ch - 2, 'rgba(20,22,26,0.25)');
    c.fillStyle = ACCENT;
    c.fillRect(cx, cy + 4, 3, ch - 8);
    this.text('LAP', cx + 8, cy + 5, { size: 8, color: 'rgba(20,22,26,0.55)' });
    this.text(fmt(state.lapTime), cx + cw - 6, cy + 4, { size: 8, color: INK, align: 'right' });
    this.text('BEST', cx + 8, cy + 18, { size: 8, color: 'rgba(20,22,26,0.55)' });
    this.text(fmt(state.bestTime), cx + cw - 6, cy + 17, { size: 8, color: INK, align: 'right' });

    /* drift card */
    const dw = 62, dh = 26, dx = this.w - dw - 8, dy = 8;
    pxRect(c, dx, dy, dw, dh, car.drifting ? ACCENT : CREAM);
    const ink = car.drifting ? CREAM : INK;
    this.text('DRIFT', dx + 6, dy + 4, { size: 8, color: car.drifting ? 'rgba(242,238,225,0.75)' : 'rgba(20,22,26,0.55)' });
    this.text(Math.round(car.driftScore).toString(), dx + dw - 6, dy + 11, { size: 8, color: ink, align: 'right' });

    /* room chip */
    if (state.room) {
      const label = `ROOM ${state.room}  ${state.racers ?? 1} RACING`;
      this.font(8);
      const tw = Math.ceil(c.measureText(label).width) + 12;
      pxRect(c, (this.w - tw) / 2, 8, tw, 16, 'rgba(16,19,22,0.82)');
      pxBorder(c, (this.w - tw) / 2, 8, tw, 16, state.connected ? 'rgba(242,238,225,0.28)' : ACCENT);
      this.text(label, this.w / 2, 12, { size: 8, color: state.connected ? CREAM : ACCENT, align: 'center' });
    }

    /* minimap */
    const ms = 64, mx = 8, my = this.h - ms - 8;
    pxRect(c, mx, my, ms, ms, 'rgba(16,19,22,0.82)');
    pxBorder(c, mx, my, ms, ms, 'rgba(242,238,225,0.22)');
    this.drawMap(car, mx + 4, my + 4, ms - 8);

    /* speed slab */
    const sw = 92, sh = 48, sx = this.w - sw - 8, sy = this.h - sh - 8;
    pxRect(c, sx, sy, sw, sh, 'rgba(16,19,22,0.82)');
    pxBorder(c, sx, sy, sw, sh, 'rgba(242,238,225,0.22)');
    this.text(kmh.toString(), sx + 7, sy + 3, { size: 24, weight: 700, color: CREAM });
    this.text('KM/H', sx + sw - 6, sy + 6, { size: 8, color: DIM, align: 'right' });
    this.text('GEAR', sx + 7, sy + 34, { size: 8, color: DIM });
    this.text(gear, sx + 40, sy + 33, { size: 8, color: ACCENT });
    const bw = sw - 14;
    c.fillStyle = 'rgba(242,238,225,0.16)';
    c.fillRect(sx + 7, sy + sh - 8, bw, 3);
    const frac = Math.min(1, Math.abs(state.throttle));
    if (frac > 0) {
      c.fillStyle = state.throttle < 0 ? DIM : ACCENT;
      c.fillRect(sx + 7, sy + sh - 8, Math.max(1, Math.round(bw * frac)), 3);
    }

    if (state.laps === 0) {
      this.text('WASD DRIVE   SPACE DRIFT   Q/E LOOK   R RESET   M MUTE', this.w / 2, this.h - 14, {
        size: 8, color: 'rgba(242,238,225,0.42)', align: 'center',
      });
    }

    if (state.paused) {
      c.fillStyle = 'rgba(8,11,10,0.62)';
      c.fillRect(0, 0, this.w, this.h);
      this.text('PAUSED', this.w / 2, this.h / 2 - 18, { size: 24, weight: 700, align: 'center' });
      this.text('P TO RESUME', this.w / 2, this.h / 2 + 14, { size: 8, color: DIM, align: 'center' });
    }
  }

  private drawMap(car: Car, x: number, y: number, size: number) {
    const c = this.ctx;
    const k = size / 84;
    const px = (v: number) => x + size / 2 + v * k;
    const pz = (v: number) => y + size / 2 + v * k;

    c.strokeStyle = 'rgba(242,238,225,0.22)';
    c.lineWidth = 4;
    c.lineJoin = 'round';
    c.beginPath();
    this.track.forEach((p, i) => (i ? c.lineTo(px(p.x), pz(p.z)) : c.moveTo(px(p.x), pz(p.z))));
    c.closePath();
    c.stroke();
    c.strokeStyle = 'rgba(242,238,225,0.55)';
    c.lineWidth = 1;
    c.stroke();

    const fx = -Math.sin(car.heading), fz = -Math.cos(car.heading);
    c.strokeStyle = ACCENT;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(px(car.x), pz(car.z));
    c.lineTo(px(car.x + fx * 5), pz(car.z + fz * 5));
    c.stroke();

    c.fillStyle = ACCENT;
    c.fillRect(Math.round(px(car.x)) - 1, Math.round(pz(car.z)) - 1, 3, 3);
  }

  /* ------------------------------------------------------------ title ----- */
  private drawTitle(time: number, state: UiState) {
    const c = this.ctx;
    const { w, h } = this;
    c.fillStyle = 'rgba(9,13,12,0.66)';
    c.fillRect(0, 0, w, h);

    const cx = w / 2;

    this.text(state.room ? `ROOM ${state.room} — SHARE THIS LINK` : 'SPRITE-STACKED PIXEL RACER', cx, h * 0.14, {
      size: 8, color: ACCENT, align: 'center',
    });

    const sw = 8, blocks = 11, stripW = sw * blocks;
    const sx = Math.round(cx - stripW / 2), sy = Math.round(h * 0.2);
    for (let i = 0; i < blocks; i++) {
      for (let j = 0; j < 2; j++) {
        c.fillStyle = (i + j) % 2 === 0 ? CREAM : 'rgba(242,238,225,0.18)';
        c.fillRect(sx + i * sw, sy + j * sw, sw, sw);
      }
    }

    this.text('SPRITE', cx, h * 0.29, { size: 48, weight: 700, color: CREAM, align: 'center' });
    this.text('DRIFT', cx, h * 0.29 + 46, { size: 48, weight: 700, color: CREAM, align: 'center' });

    // buttons
    this.buttons = [];
    const by = Math.round(h * 0.68);
    // map chooser row
    const maps = state.maps ?? [{ id: 'coast', name: 'Saltmarsh Coast' }];
    const mi = state.mapIndex ?? 0;
    const name = maps[mi]?.name?.toUpperCase() ?? 'SALT MARSH';
    this.font(8);
    const nameW = Math.ceil(c.measureText(name).width);
    const rowY = by - 34;
    const prevBtn: Button = { id: 'prev-map', label: '<', w: 18, h: 18, x: Math.round(cx - nameW / 2 - 30), y: rowY - 5 };
    const nextBtn: Button = { id: 'next-map', label: '>', w: 18, h: 18, x: Math.round(cx + nameW / 2 + 12), y: rowY - 5 };
    for (const b of [prevBtn, nextBtn]) {
      pxRect(c, b.x, b.y, b.w, b.h, 'rgba(18,22,26,0.9)');
      pxBorder(c, b.x, b.y, b.w, b.h, 'rgba(242,238,225,0.55)');
      this.text(b.label, b.x + b.w / 2, b.y + 5, { size: 8, color: CREAM, align: 'center' });
      this.buttons.push(b);
    }
    this.text(name, cx, rowY, { size: 8, color: CREAM, align: 'center' });
    this.text('TRACK', cx, rowY - 12, { size: 8, color: DIM, align: 'center' });

    const solo: Button = { id: 'solo', label: 'RACE SOLO', w: 110, h: 20, x: Math.round(cx - 55), y: by };
    pxRect(c, solo.x, solo.y, solo.w, solo.h, 'rgba(18,22,26,0.9)');
    pxBorder(c, solo.x, solo.y, solo.w, solo.h, CREAM);
    this.text(solo.label, solo.x + solo.w / 2, solo.y + 6, { size: 8, color: CREAM, align: 'center' });
    this.buttons.push(solo);

    this.text('OR PRESS SPACE', cx, by + 30, {
      size: 8, color: DIM, align: 'center',
    });

    const blink = 0.35 + 0.65 * (Math.sin(time * 3.4) * 0.5 + 0.5);
    c.globalAlpha = blink;
    this.text('CLICK OR PRESS ANY KEY', cx, by - 18, {
      size: 8, color: CREAM, align: 'center',
    });
    c.globalAlpha = 1;

    this.text('WASD / ARROWS    SPACE HANDBRAKE    Q E LOOK    R RESET', cx, h * 0.93, {
      size: 8, color: 'rgba(242,238,225,0.4)', align: 'center',
    });
  }
}
