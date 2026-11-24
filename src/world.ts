import * as THREE from 'three';
import { instancedStack, loadSheet, shadowPatch, type Placement, type StackDef } from './stack';

export const WORLD = 172;
let ROAD_HALF = 4.4;
// set from the active map when the world is built          // world is WORLD × WORLD units
const PX = 2048;                  // ground texture resolution
const GX = 180;                   // ground is painted wider than the playable area
const HALF_G = GX / 2;
const PPU = PX / GX;              // pixels per world unit
const HALF = WORLD / 2;

export interface Collider { x: number; z: number; r: number }

export interface World {
  group: THREE.Group;
  name: string;
  mapId: string;
  sky: string;
  roadHalf: number;
  update(): void;
  colliders: Collider[];
  roadAt(x: number, z: number): boolean;
  kerbAt(x: number, z: number): boolean;
  nearbyRoad(x: number, z: number, dist: number): boolean;
  start: { x: number; z: number; heading: number };
  addSkid(x: number, z: number, angle: number, strength: number): void;
  clearSkid(): void;
  minimapPath: { x: number; z: number }[];
  track: { x: number; z: number }[];
}

type P2 = { x: number; z: number };

export interface MapDef {
  id: string;
  name: string;
  ctrl: [number, number][];
  roadHalf: number;
  smooth?: boolean;
  palette: {
    grass: string; tones: [string, string, string, string, string];
    bladeA: string; bladeB: string;
    sand: string; water: string; waterLt: string;
    shoulder: string; asphalt: string; grainA: string; grainB: string;
    line: string; kerbA: string; kerbB: string;
  };
  lake?: { x: number; z: number; rx: number; rz: number };
  tint?: string;
  trees?: 'pine' | 'palm' | 'mixed';
  town?: [number, number][];
  props?: { trees: number; rocks: number; buildings: number; lampStride: number; rockScale: number };
  density?: number;
  buildingScale?: number;
  sky?: string;
  /** place tiered grandstands on the outside of the longest straights */
  grandstands?: boolean;
  /** continuous metal armco instead of loose tyre stacks */
  armco?: boolean;
  /** white motor yachts in the lake */
  yachts?: { x: number; z: number; rot: number; scale: number }[];
  /** landmark ferris wheel */
  ferris?: { x: number; z: number; rot: number; scale: number };
  /** landmark torii gate */
  torii?: { x: number; z: number; rot: number; scale: number };
}

/** Closed parametric figure-eight: rx across, rz along, crossing at (0, 0). */
function figure8(rx: number, rz: number, n = 64, phase = 0): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = phase + (i / n) * Math.PI * 2;
    pts.push([rx * Math.sin(t), rz * Math.sin(2 * t)]);
  }
  return pts;
}

export const MAPS: MapDef[] = [
  {
    id: 'coast', name: 'Saltmarsh Coast', roadHalf: 4.4,
    // 28-point lap: start/finish on the long top straight, fast double-apex
    // sweep down the east side, genuine 180° hairpin over the lake, a wide
    // exit corner rolling onto the back run, a quick left-right chicane, and
    // a stadium 180° U-turn up the west side back onto the straight.
    ctrl: [
      [-51.4, 18.6], [-59.0, 26.3], [-61.8, 36.7], [-59.0, 47.1], [-51.4, 54.7],
      [-41.0, 57.5], [-25.4, 57.5], [-9.8, 57.5], [5.9, 57.5], [21.4, 57.5], [31.2, 57.5],
      [42.2, 55.1], [51.2, 48.1], [57.9, 40.3], [61.0, 29.4], [61.4, 18.1],
      [60.1, -5.2], [55.9, -18.2], [44.9, -26.3], [31.2, -26.3], [20.2, -18.2],
      [15.9, -5.2], [12.3, 7.8], [2.9, 17.3], [-10.1, 20.8],
      [-20.8, 20.4], [-31.9, 16.4], [-41.0, 15.9]],
    palette: {
      grass: '#4f7c46', tones: ['#5b8c4e', '#3d6636', '#6fa05d', '#33582f', '#7fb367'],
      bladeA: '#8cc274', bladeB: '#356031',
      sand: '#c9bd8b', water: '#2f6f86', waterLt: 'rgba(96,170,186,0.55)',
      shoulder: '#6b6350', asphalt: '#43434b', grainA: '#6a6a76', grainB: '#2b2b33',
      line: 'rgba(232,226,206,0.85)', kerbA: '#d8d2bc', kerbB: '#c8463c',
    },
    lake: { x: 34, z: -37, rx: 11, rz: 8 },
    trees: 'mixed', density: 1,
    props: { trees: 280, rocks: 58, buildings: 15, lampStride: 58, rockScale: 1 },
  },
  {
    // NASCAR-style stadium: two long straights, two banked U-turns, no sweepers
    id: 'canyon', name: 'Redrock Speedway', roadHalf: 5.2, smooth: false,
    ctrl: [[-30, -22], [6, -22], [22, -18], [28, -8], [28, 8], [22, 18], [6, 22],
      [-30, 22], [-38, 14], [-38, -14]],
    palette: {
      grass: '#c9a86a', tones: ['#d4b476', '#b8955a', '#dcc086', '#a88450', '#e2cb95'],
      bladeA: '#e8d29b', bladeB: '#96754a',
      sand: '#b08a52', water: '#3b7a86', waterLt: 'rgba(120,180,180,0.45)',
      shoulder: '#8d7348', asphalt: '#4a4740', grainA: '#6d6a5f', grainB: '#2f2d29',
      line: 'rgba(238,228,200,0.8)', kerbA: '#e6ddc4', kerbB: '#b5432f',
    },
    lake: { x: -35, z: 31, rx: 9, rz: 7 },
    trees: 'pine', density: 0.55, tint: '#f0d9b0',
    props: { trees: 18, rocks: 120, buildings: 4, lampStride: 78, rockScale: 1.9 },
    town: [[-8, -6], [7, -8], [-9, 9], [8, 10]],
  },
  {
    // city block: four 90-degree corners plus an inward chicane notch
    id: 'night', name: 'Neon Blocks', roadHalf: 4.0, smooth: false,
    ctrl: [[-26, -26], [26, -26], [26, -8], [12, -8], [12, 8], [26, 8], [26, 26],
      [-26, 26], [-26, 0]],
    palette: {
      grass: '#243a34', tones: ['#2b463c', '#1c2f2a', '#33524a', '#16241f', '#3d5f52'],
      bladeA: '#4b7a68', bladeB: '#12201c',
      sand: '#2f4a44', water: '#16323d', waterLt: 'rgba(60,120,140,0.5)',
      shoulder: '#232a2c', asphalt: '#2b2b33', grainA: '#454552', grainB: '#1b1b21',
      line: 'rgba(240,230,190,0.7)', kerbA: '#e0c05a', kerbB: '#b5432f',
    },
    lake: { x: 33, z: 34, rx: 9, rz: 7 },
    trees: 'pine', density: 0.35, tint: '#42604f',
    props: { trees: 12, rocks: 18, buildings: 15, lampStride: 34, rockScale: 0.8 },
    town: [[-12, -12], [-2, -12], [8, -12], [-12, 0], [8, 0], [-12, 12], [-2, 12], [8, 12]],
  },
  {
    // dumbbell: two round ends joined by a tight waist
    id: 'alpine', name: 'Frostbite Pass', roadHalf: 4.0,
    ctrl: [[-30, -12], [-16, -20], [-4, -8], [4, -8], [16, -20], [30, -12],
      [30, 10], [16, 18], [4, 6], [-4, 6], [-16, 18], [-30, 10]],
    palette: {
      grass: '#dfe6ea', tones: ['#eef3f6', '#c9d5dc', '#f7fafc', '#b6c6d0', '#ffffff'],
      bladeA: '#ffffff', bladeB: '#a9bcc8',
      sand: '#b9c6cd', water: '#7fb0c4', waterLt: 'rgba(190,225,235,0.55)',
      shoulder: '#93a2ab', asphalt: '#4a4f57', grainA: '#737a84', grainB: '#2f333a',
      line: 'rgba(250,252,255,0.85)', kerbA: '#f2f6f8', kerbB: '#3f6fb0',
    },
    lake: { x: -34, z: -34, rx: 9, rz: 7 },
    trees: 'pine', density: 1.0, tint: '#eef4f8',
    props: { trees: 130, rocks: 55, buildings: 6, lampStride: 52, rockScale: 1.3 },
    town: [[-9, -5], [9, -3], [0, 9]],
  },
  {
    // Tight harbour street circuit: long quay straight, a casino climb,
    // a hairpin around the marina and a late chicane back onto the quay.
    id: 'harbour', name: 'Harbour Grand Prix', roadHalf: 3.7, smooth: false,
    ctrl: [
      [-44, -30], [-22, -34], [2, -34], [20, -31], [30, -27], [36, -20],
      [44, -12], [46, 2], [42, 14], [34, 22], [26, 26], [22, 30],
      [12, 33], [-2, 33], [-16, 30], [-26, 24], [-34, 17], [-40, 8],
      [-44, -4], [-44, -16], [-40, -24], [-32, -28],
    ],
    palette: {
      grass: '#8b8b86', tones: ['#9a9a94', '#777771', '#a6a6a0', '#6a6a64', '#b3b3ac'],
      bladeA: '#c4c4ba', bladeB: '#5f5f5a',
      sand: '#d6c7a3', water: '#1f6f95', waterLt: 'rgba(112,196,220,0.5)',
      shoulder: '#6f6f6a', asphalt: '#4b4b53', grainA: '#73737f', grainB: '#303038',
      line: 'rgba(244,240,226,0.9)', kerbA: '#efe8d8', kerbB: '#c8463c',
    },
    lake: { x: 2, z: -7, rx: 20, rz: 12 },
    trees: 'palm', density: 0.7, tint: '#ffe7b0', buildingScale: 1.55,
    props: { trees: 64, rocks: 8, buildings: 36, lampStride: 34, rockScale: 0.55 },
    town: [[-30, -20], [-26, 4], [-14, -22], [16, -20], [28, -6], [8, 20], [-8, -24], [30, 12], [-14, 12], [18, 12], [-34, -4], [-22, -12], [22, -20], [34, -10], [24, 4], [0, 16], [-20, 20], [12, 24], [-62, -38], [58, -38], [60, 20], [-58, 24], [0, 46], [-40, 46], [40, 46]],
    sky: '#8ec8de',
    grandstands: true,
    armco: true,
    yachts: [
      { x: -6, z: -10, rot: 0.35, scale: 1.35 },
      { x: 7, z: -4, rot: -0.5, scale: 1.15 },
      { x: -11, z: -1, rot: 1.4, scale: 1.0 },
      { x: 12, z: -11, rot: 2.4, scale: 1.5 },
      { x: -1, z: 1, rot: 2.9, scale: 0.9 },
      { x: 9, z: 2, rot: 0.8, scale: 0.8 },
    ],
  },
  {
    // Suzuka-inspired figure-eight: the track crosses itself at the infield,
    // with a forest, a pond, a torii gate and a ferris wheel.
    id: 'sakura', name: 'Sakura Circuit', roadHalf: 4.2, smooth: true,
    ctrl: figure8(47, 31, 64, 0.35),
    palette: {
      grass: '#315b42', tones: ['#3c6e4e', '#244632', '#4c825f', '#1b3727', '#5d9572'],
      bladeA: '#7fb38a', bladeB: '#1c3a29',
      sand: '#b9b08c', water: '#2b6f72', waterLt: 'rgba(110,190,185,0.5)',
      shoulder: '#6b6653', asphalt: '#41434a', grainA: '#646671', grainB: '#282a30',
      line: 'rgba(248,246,232,0.88)', kerbA: '#f2eee2', kerbB: '#c8463c',
    },
    lake: { x: 0, z: -23, rx: 9, rz: 6 },
    trees: 'pine', density: 1.15, tint: '#d7ead7',
    props: { trees: 230, rocks: 38, buildings: 6, lampStride: 42, rockScale: 1.1 },
    town: [[-18, -4], [20, 4], [0, 10]],
    sky: '#9fbea7',
    grandstands: true,
    ferris: { x: -20, z: 0, rot: 0.2, scale: 1.1 },
    torii: { x: 22, z: 0, rot: Math.PI / 2, scale: 1.1 },
  },
];

/** Fill long polygon edges with points so roadAt/minimap see the whole straight. */
function densify(pts: P2[], maxStep = 0.55): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(d / maxStep));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}

function sampleTrack(ctrl: [number, number][], smooth = true): P2[] {
  if (smooth) {
    const curve = new THREE.CatmullRomCurve3(
      ctrl.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'catmullrom', 0.5,
    );
    return curve.getPoints(900).map((p) => ({ x: p.x, z: p.z }));
  }
  // polygon with filleted corners: keeps the hard layout while giving the
  // kerb offset a radius to work with
  const n = ctrl.length;
  const r = 4.5;
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const a = ctrl[(i - 1 + n) % n], b = ctrl[i], c = ctrl[(i + 1) % n];
    const la = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
    const lc = Math.hypot(c[0] - b[0], c[1] - b[1]) || 1;
    const p1 = { x: b[0] + ((a[0] - b[0]) / la) * r, z: b[1] + ((a[1] - b[1]) / la) * r };
    const p2 = { x: b[0] + ((c[0] - b[0]) / lc) * r, z: b[1] + ((c[1] - b[1]) / lc) * r };
    out.push(p1);
    for (let k = 1; k <= 6; k++) {
      const t = k / 6;
      const u = 1 - t;
      out.push({
        x: u * u * p1.x + 2 * u * t * b[0] + t * t * p2.x,
        z: u * u * p1.z + 2 * u * t * b[1] + t * t * p2.z,
      });
    }
  }
  return densify(out);
}

/** Pick a straight stretch, away from self-crossings, for the start line. */
function straightestIndex(track: P2[]): number {
  const n = track.length;
  const win = n > 300 ? 16 : 4;
  const avoid = Math.max(24, Math.round(n * 0.08));
  let best = Math.floor(n / 3), bestScore = -Infinity;
  for (let i = 0; i < n; i += 2) {
    const b = track[i];
    const a = track[(i - win + n) % n];
    const c = track[(i + win) % n];
    const v1x = b.x - a.x, v1z = b.z - a.z;
    const v2x = c.x - b.x, v2z = c.z - b.z;
    const l1 = Math.hypot(v1x, v1z) || 1, l2 = Math.hypot(v2x, v2z) || 1;
    const dot = (v1x * v2x + v1z * v2z) / (l1 * l2);
    const span = Math.hypot(c.x - a.x, c.z - a.z);
    const score = dot * 100 + span;
    if (score <= bestScore) continue;
    let crossing = false;
    for (let k = 0; k < n; k += 4) {
      if (Math.abs(k - i) < avoid) continue;
      const p = track[k];
      if ((p.x - b.x) ** 2 + (p.z - b.z) ** 2 < 14 * 14) { crossing = true; break; }
    }
    if (crossing) continue;
    bestScore = score;
    best = i;
  }
  return best;
}

function offsetPath(pts: P2[], dist: number): P2[] {
  return pts.map((p, i) => {
    const a = pts[(i - 1 + pts.length) % pts.length];
    const b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: p.x + (dz / len) * dist, z: p.z - (dx / len) * dist };
  });
}

function strokePath(ctx: CanvasRenderingContext2D, pts: P2[], color: string, width: number) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = (p.x + HALF_G) * PPU, y = (p.z + HALF_G) * PPU;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.closePath();
  ctx.stroke();
}

function dotted(ctx: CanvasRenderingContext2D, pts: P2[], color: string, width: number, on: number, off: number) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash([on, off]);
  ctx.lineCap = 'butt';
  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = (p.x + HALF_G) * PPU, y = (p.z + HALF_G) * PPU;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function paintGround(track: P2[], map: MapDef): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = PX;
  const g = cv.getContext('2d')!;

  const rnd = mulberry(1337);

  // grass base, then one-texel grain so it reads at the game's pixel scale
  g.fillStyle = map.palette.grass;
  g.fillRect(0, 0, PX, PX);


  // dense pixel grain: 1–2 texel specks in four grass tones
  const tones = map.palette.tones;
  for (let i = 0; i < 42000; i++) {
    const x = (rnd() * PX) | 0, y = (rnd() * PX) | 0;
    g.fillStyle = tones[(rnd() * tones.length) | 0];
    g.globalAlpha = 0.55 + rnd() * 0.45;
    g.fillRect(x, y, 2, 2);
  }
  g.globalAlpha = 1;

  // blades: short vertical light specks
  for (let i = 0; i < 3000; i++) {
    const x = (rnd() * PX) | 0, y = (rnd() * PX) | 0;
    g.fillStyle = rnd() > 0.6 ? map.palette.bladeA : map.palette.bladeB;
    g.globalAlpha = 0.6 + rnd() * 0.4;
    g.fillRect(x, y, 1, 2);
  }
  g.globalAlpha = 1;

  // clover / dirt clusters
  for (let i = 0; i < 420; i++) {
    const cx = rnd() * PX, cy = rnd() * PX;
    for (let k = 0; k < 14; k++) {
      g.fillStyle = rnd() > 0.5 ? map.palette.bladeB : map.palette.bladeA;
      g.globalAlpha = 0.35;
      g.fillRect((cx + (rnd() - 0.5) * 22) | 0, (cy + (rnd() - 0.5) * 22) | 0, 2, 2);
    }
  }
  g.globalAlpha = 1;

  // lake (if the map has one)
  if (map.lake) {
    const lx = (map.lake.x + HALF_G) * PPU, ly = (map.lake.z + HALF_G) * PPU;
    g.fillStyle = map.palette.sand;
    g.beginPath();
    g.ellipse(lx, ly, map.lake.rx * PPU, map.lake.rz * PPU, 0.35, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = map.palette.water;
    g.beginPath();
    g.ellipse(lx, ly, (map.lake.rx - 2) * PPU, (map.lake.rz - 1.8) * PPU, 0.35, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = map.palette.waterLt;
    g.beginPath();
    g.ellipse(lx - 2 * PPU, ly - 1.5 * PPU, map.lake.rx * 0.55 * PPU, map.lake.rz * 0.42 * PPU, 0.35, 0, Math.PI * 2);
    g.fill();
    for (let i = 0; i < 40; i++) {
      const a = rnd() * Math.PI * 2, r = rnd();
      g.fillStyle = 'rgba(220,245,250,0.45)';
      g.fillRect(lx + Math.cos(a) * map.lake.rx * 0.8 * PPU * r, ly + Math.sin(a) * map.lake.rz * 0.7 * PPU * r, 6, 2);
    }
  }

  // dirt shoulder + asphalt
  strokePath(g, track, map.palette.shoulder, (ROAD_HALF * 2 + 1.6) * PPU);
  strokePath(g, track, map.palette.asphalt, ROAD_HALF * 2 * PPU);

  // asphalt grain
  g.globalAlpha = 1;
  for (let i = 0; i < 24000; i++) {
    const p = track[(rnd() * track.length) | 0];
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * ROAD_HALF * 0.96;
    const x = (p.x + Math.cos(a) * r + HALF_G) * PPU;
    const y = (p.z + Math.sin(a) * r + HALF_G) * PPU;
    g.globalAlpha = 0.5 + rnd() * 0.4;
    g.fillStyle = rnd() > 0.5 ? map.palette.grainA : map.palette.grainB;
    g.fillRect(x | 0, y | 0, rnd() > 0.7 ? 2 : 1, 1);
  }

  g.globalAlpha = 1;

  // white edge lines
  strokePath(g, offsetPath(track, ROAD_HALF - 0.45), map.palette.line, 0.34 * PPU);
  strokePath(g, offsetPath(track, -(ROAD_HALF - 0.45)), map.palette.line, 0.34 * PPU);

  // red/white kerbs
  for (const side of [1, -1]) {
    const edge = offsetPath(track, side * (ROAD_HALF + 0.15));
    strokePath(g, edge, map.palette.kerbA, 0.7 * PPU);
    dotted(g, edge, map.palette.kerbB, 0.7 * PPU, 1.5 * PPU, 1.5 * PPU);

  }

  // centre dashes
  dotted(g, track, 'rgba(246,246,240,0.62)', 0.16 * PPU, 1.9 * PPU, 2.4 * PPU);

  // start / finish checker
  const si = straightestIndex(track);
  const s = track[si], s2 = track[(si + 3) % track.length];
  const ang = Math.atan2(s2.z - s.z, s2.x - s.x) + Math.PI * 0.5;   // start line runs ACROSS the road
  g.save();
  g.translate((s.x + HALF_G) * PPU, (s.z + HALF_G) * PPU);
  g.rotate(ang);
  const cw = 0.9 * PPU;
  for (let row = 0; row < 2; row++) {
    for (let col = -6; col < 6; col++) {
      g.fillStyle = (row + col) % 2 === 0 ? '#f2eee2' : '#33333a';
      g.fillRect(col * cw * 0.85, (row - 1) * cw * 0.85, cw * 0.85, cw * 0.85);
    }
  }
  g.restore();

  return cv;
}

function mulberry(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cream sponsor board with a hard accent rule, drawn at pixel scale. */
function boardTexture(label: string, accent: string): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = 160; cv.height = 48;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#f2eee1';
  g.fillRect(0, 0, 160, 48);
  g.fillStyle = accent;
  g.fillRect(0, 0, 160, 4);
  g.fillRect(0, 44, 160, 4);
  g.fillStyle = '#14161a';
  g.fillRect(6, 9, 148, 2);
  g.fillRect(6, 37, 148, 2);
  g.font = 'bold 20px monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, 80, 25);
  for (let i = 0; i < 4; i++) {
    g.fillStyle = i % 2 === 0 ? accent : '#14161a';
    g.fillRect(4 + i * 4, 4, 3, 3);
    g.fillRect(160 - 7 - i * 4, 41, 3, 3);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Turn board: three chunky chevrons, pointing left (-1) or right (+1). */
function arrowTexture(dir: number): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 64;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#14161a';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#f2eee1';
  g.fillRect(0, 0, 64, 3);
  g.fillRect(0, 61, 64, 3);
  g.fillRect(0, 0, 3, 64);
  g.fillRect(61, 0, 3, 64);
  g.fillStyle = '#e0513f';
  for (let i = 0; i < 3; i++) {
    const x = 18 + i * 14;
    for (let k = 0; k < 6; k++) {
      const w = 3;
      const up = 8 + k * 4;
      const down = 56 - k * 4;
      g.fillRect(dir > 0 ? x + k * 3 : x - k * 3, up, w, 6);
      g.fillRect(dir > 0 ? x + k * 3 : x - k * 3, down, w, 6);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export async function buildWorld(scene: THREE.Scene, mapId?: string): Promise<World> {
  const map = MAPS.find((m) => m.id === mapId) ?? MAPS[0];
  ROAD_HALF = map.roadHalf ?? 4.4;
  const group = new THREE.Group();
  scene.add(group);

  const track = sampleTrack(map.ctrl, map.smooth !== false);

  // ---- road membership grid -------------------------------------------------
  const cell = 1;
  const dim = Math.ceil(WORLD / cell);
  const grid = new Uint8Array(dim * dim);
  const kerbs = new Uint8Array(dim * dim);
  const gx = (x: number) => Math.floor((x + HALF) / cell);
  for (let i = 0; i < dim; i++) {
    for (let j = 0; j < dim; j++) {
      const x = i * cell - HALF + cell / 2;
      const z = j * cell - HALF + cell / 2;
      let best = 1e9;
      for (const p of track) {
        const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d < best) best = d;
      }
      const d = Math.sqrt(best);
      const at = j * dim + i;
      if (d < ROAD_HALF) grid[at] = 1;
      // a wheel-width either side of the painted kerb band
      if (d >= ROAD_HALF - 1.0 && d <= ROAD_HALF + 0.55) kerbs[at] = 1;
    }
  }
  const roadAt = (x: number, z: number) => {
    const i = gx(x), j = gx(z);
    if (i < 0 || j < 0 || i >= dim || j >= dim) return false;
    return grid[j * dim + i] === 1;
  };
  const kerbAt = (x: number, z: number) => {
    const i = gx(x), j = gx(z);
    if (i < 0 || j < 0 || i >= dim || j >= dim) return false;
    return kerbs[j * dim + i] === 1;
  };
  const nearbyRoad = (x: number, z: number, dist: number) => {
    for (const p of track) {
      if ((p.x - x) ** 2 + (p.z - z) ** 2 < dist * dist) return true;
    }
    return false;
  };

  // ---- ground ---------------------------------------------------------------
  const canvas = paintGround(track, map);
  const groundTex = new THREE.CanvasTexture(canvas);
  groundTex.magFilter = THREE.NearestFilter;
  groundTex.minFilter = THREE.NearestFilter;
  groundTex.generateMipmaps = false;
  groundTex.colorSpace = THREE.SRGBColorSpace;
  groundTex.anisotropy = 4;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GX, GX),
    new THREE.MeshBasicMaterial({ map: groundTex, toneMapped: false }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  group.add(ground);

  // ---- skid decal layer ------------------------------------------------------
  const SK = 512;
  const skidCanvas = document.createElement('canvas');
  skidCanvas.width = skidCanvas.height = SK;
  const skidCtx = skidCanvas.getContext('2d')!;
  const skidTex = new THREE.CanvasTexture(skidCanvas);
  skidTex.colorSpace = THREE.SRGBColorSpace;
  const skidMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD, WORLD),
    new THREE.MeshBasicMaterial({
      map: skidTex, transparent: true, depthWrite: false, opacity: 0.55, toneMapped: false,
    }),
  );
  skidMesh.rotation.x = -Math.PI / 2;
  skidMesh.position.y = 0.008;
  skidMesh.renderOrder = 1;
  group.add(skidMesh);
  let skidDirty = false, skidPending = false;

  const addSkid = (x: number, z: number, angle: number, strength: number) => {
    if (skidPending) return;
    skidPending = true;
    const px = ((x + HALF) / WORLD) * SK;
    const py = ((z + HALF) / WORLD) * SK;
    skidCtx.save();
    skidCtx.translate(px, py);
    skidCtx.rotate(-angle);
    skidCtx.fillStyle = `rgba(22,20,24,${Math.min(0.32, 0.12 + strength * 0.25)})`;
    skidCtx.fillRect(-2.2, -5, 2.0, 10);
    skidCtx.fillRect(0.6, -5, 2.0, 10);
    skidCtx.restore();
    skidDirty = true;
    requestAnimationFrame(() => { skidPending = false; });
  };
  const clearSkid = () => {
    skidCtx.clearRect(0, 0, SK, SK);
    skidDirty = true;
  };

  // ---- props ----------------------------------------------------------------
  const [pineTex, snowTex, palmTex, rockTex, lampTex, tyreTex, bldA, bldB, bldC, shadowTex,
    cactusTex, mesaTex, pylonTex] = await Promise.all([
    loadSheet('/sprites/pine.png'), loadSheet('/sprites/pine-snow.png'), loadSheet('/sprites/palm.png'),
    loadSheet('/sprites/rock.png'), loadSheet('/sprites/lamp.png'), loadSheet('/sprites/tyres.png'),
    loadSheet('/sprites/building-a.png'), loadSheet('/sprites/building-b.png'),
    loadSheet('/sprites/building-c.png'), loadSheet('/sprites/shadow.png'),
    loadSheet('/sprites/cactus.png'), loadSheet('/sprites/mesa.png'), loadSheet('/sprites/pylon.png'),
  ]);

  const defs: Record<string, StackDef> = {
    pine: { url: '', layers: 18, sheetW: 40, sheetH: 40, worldW: 3.1, lift: 0.125 },
    palm: { url: '', layers: 18, sheetW: 40, sheetH: 40, worldW: 3.4, lift: 0.135 },
    rock: { url: '', layers: 10, sheetW: 28, sheetH: 28, worldW: 1.9, lift: 0.09 },
    lamp: { url: '', layers: 26, sheetW: 16, sheetH: 16, worldW: 1.0, lift: 0.075 },
    tyres: { url: '', layers: 12, sheetW: 24, sheetH: 24, worldW: 1.5, lift: 0.072 },
    cactus: { url: '', layers: 12, sheetW: 24, sheetH: 24, worldW: 1.7, lift: 0.062 },
    mesa: { url: '', layers: 10, sheetW: 40, sheetH: 40, worldW: 6.0, lift: 0.17 },
    pylon: { url: '', layers: 24, sheetW: 16, sheetH: 16, worldW: 1.2, lift: 0.058 },
    snowpine: { url: '', layers: 18, sheetW: 40, sheetH: 40, worldW: 3.1, lift: 0.125 },
    bldA: { url: '', layers: 14, sheetW: 64, sheetH: 64, worldW: 7.0, lift: 0.30 },
    bldB: { url: '', layers: 14, sheetW: 64, sheetH: 64, worldW: 7.0, lift: 0.30 },
    bldC: { url: '', layers: 14, sheetW: 64, sheetH: 64, worldW: 7.0, lift: 0.30 },
  };

  const colliders: Collider[] = [];
  const shadows: Placement[] = [];
  const rnd = mulberry(90210);
  const taken: { x: number; z: number; r: number }[] = [];

  const inLake = (x: number, z: number, pad = 1) => {
    if (!map.lake) return false;
    const dx = (x - map.lake.x) / (map.lake.rx + pad);
    const dz = (z - map.lake.z) / (map.lake.rz + pad);
    return dx * dx + dz * dz < 1;
  };
  const free = (x: number, z: number, r: number, pad = 2.4) => {
    if (Math.abs(x) > HALF - 2 || Math.abs(z) > HALF - 2) return false;
    if (inLake(x, z, 1.5)) return false;
    if (nearbyRoad(x, z, ROAD_HALF + pad + r)) return false;
    for (const t of taken) if ((t.x - x) ** 2 + (t.z - z) ** 2 < (t.r + r) ** 2) return false;
    return true;
  };

  // town in the infield
  const TOWN: [number, number][] = [
    [2, -8], [13, -10], [20, -2], [6, 2], [17, 7], [-2, 6],
    [4, 14], [14, 16], [-6, -2], [22, 26], [-10, 12], [10, 22],
    [-14, -4], [26, 14], [0, 26],
  ];
  const buildings: Placement[][] = [[], [], []];
  const town = map.town ?? TOWN;
  const townCount = map.props?.buildings ?? town.length;
  town.slice(0, townCount).forEach(([x, z], i) => {
    const r = 4.2;
    if (!free(x, z, r)) return;
    const rot = Math.round(rnd() * 3) * (Math.PI / 2) + (rnd() - 0.5) * 0.15;
    buildings[i % 3].push({ x, z, rot, scale: (map.buildingScale ?? 1) * (0.9 + rnd() * 0.25) });
    taken.push({ x, z, r });
    colliders.push({ x, z, r: 4.0 });
    shadows.push({ x, z, rot, scale: 1.35 });
  });

  // trees: a corridor along the track, then loose clusters in the open
  const pines: Placement[] = [], palms: Placement[] = [];
  const addTree = (x: number, z: number, palm = false) => {
    if (!free(x, z, 1.5, 0.9)) return;
    if (palm) palms.push({ x, z, rot: rnd() * 6.28, scale: 0.9 + rnd() * 0.3 });
    else pines.push({ x, z, rot: rnd() * 6.28, scale: 0.85 + rnd() * 0.45 });
    taken.push({ x, z, r: 1.5 });
    colliders.push({ x, z, r: 0.7 });
    shadows.push({ x, z, rot: 0, scale: 1.7 });
  };

  // corridor: step around the lap, offset outward from the kerb at varied depth
  for (let i = 0; i < track.length; i += 9) {
    if (rnd() > 0.62) continue;
    const p = track[i];
    const q = track[(i + 4) % track.length];
    const dx = q.x - p.x, dz = q.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    const side = rnd() > 0.5 ? 1 : -1;
    const out = ROAD_HALF + 1.8 + rnd() * 7.5;
    const x = p.x + (dz / len) * out * side;
    const z = p.z - (dx / len) * out * side;
    const nearLake = map.lake ? Math.hypot(x - map.lake.x, z - map.lake.z) < map.lake.rx + 2 : false;
    const palmChance = map.trees === 'palm' ? 0.9 : map.trees === 'mixed' ? 0.45 : 0.08;
    addTree(x + (rnd() - 0.5) * 2, z + (rnd() - 0.5) * 2, nearLake ? rnd() > 0.35 : rnd() < palmChance);
  }
  // scattered woodland
  let guard = 0;
  const treeTarget = map.props?.trees ?? Math.round(190 * (map.density ?? 1));
  while (pines.length + palms.length < treeTarget && guard++ < 3000) {
    const x = (rnd() - 0.5) * (WORLD - 8);
    const z = (rnd() - 0.5) * (WORLD - 8);
    const palmChance = map.trees === 'palm' ? 0.9 : map.trees === 'mixed' ? 0.45 : 0.08;
    const nearLake = map.lake ? Math.hypot(x - map.lake.x, z - map.lake.z) < map.lake.rx + 3 : false;
    addTree(x, z, nearLake ? rnd() > 0.35 : rnd() < palmChance);
  }

  // rocks
  const rocks: Placement[] = [];
  const rockCount = map.props?.rocks ?? 34;
  for (let i = 0; i < rockCount; i++) {
    const x = (rnd() - 0.5) * (WORLD - 10);
    const z = (rnd() - 0.5) * (WORLD - 10);
    if (!free(x, z, 1.3)) continue;
    rocks.push({ x, z, rot: rnd() * 6.28, scale: (0.7 + rnd() * 0.7) * (map.props?.rockScale ?? 1) });
    taken.push({ x, z, r: 1.3 });
    colliders.push({ x, z, r: 0.7 });
    shadows.push({ x, z, rot: 0, scale: 1.5 });
  }

  // lamps along the outside of the track
  const lamps: Placement[] = [];
  for (let i = 0; i < track.length; i += (map.props?.lampStride ?? 58)) {
    const p = track[i];
    const q = track[(i + 6) % track.length];
    const dx = q.x - p.x, dz = q.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = dz / len, nz = -dx / len;
    const x = p.x + nx * (ROAD_HALF + 1.6);
    const z = p.z + nz * (ROAD_HALF + 1.6);
    lamps.push({ x, z, rot: Math.atan2(dx, dz), scale: 1 });
    colliders.push({ x, z, r: 0.28 });
    shadows.push({ x, z, rot: 0, scale: 0.6 });
  }

  // tyre barriers on the outside of the sharper corners
  const tyres: Placement[] = [];
  const n = track.length;
  for (let i = 0; i < n; i += 14) {
    const a = track[(i - 8 + n) % n], b = track[i], c = track[(i + 8) % n];
    const v1x = b.x - a.x, v1z = b.z - a.z, v2x = c.x - b.x, v2z = c.z - b.z;
    const l1 = Math.hypot(v1x, v1z) || 1, l2 = Math.hypot(v2x, v2z) || 1;
    const curv = (v1x * v2z - v1z * v2x) / (l1 * l2);
    if (Math.abs(curv) < 0.14) continue;
    if (tyres.some((t) => (t.x - b.x) ** 2 + (t.z - b.z) ** 2 < 64)) continue;
    const nx = v1z / l1, nz = -v1x / l1;
    const side = curv > 0 ? 1 : -1;
    for (let k = -2; k <= 2; k++) {
      const bx = b.x + nx * side * (ROAD_HALF + 1.1) + (v1x / l1) * k * 1.5;
      const bz = b.z + nz * side * (ROAD_HALF + 1.1) + (v1z / l1) * k * 1.5;
      tyres.push({ x: bx, z: bz, rot: rnd() * 6.28, scale: 0.95 + rnd() * 0.15 });
      colliders.push({ x: bx, z: bz, r: 0.62 });
      shadows.push({ x: bx, z: bz, rot: 0, scale: 0.9 });
    }
  }

  // ---- F1-inspired landmarks ------------------------------------------------
  const basic = (color: number) => new THREE.MeshBasicMaterial({ color, toneMapped: false });
  const addBox = (g: THREE.Group, w: number, h: number, d: number, color: number,
    x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), basic(color));
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };

  if (map.grandstands) {
    let ccx = 0, ccz = 0;
    for (const p of track) { ccx += p.x; ccz += p.z; }
    ccx /= track.length; ccz /= track.length;
    const standStart = straightestIndex(track);
    const offsets = [46, 300, 610];
    const seatColours = [0xe0513f, 0xf2eee1, 0x2b6d7a];
    offsets.forEach((off, k) => {
      const i = (standStart + off) % track.length;
      const p = track[i], q = track[(i + 6) % track.length];
      const dx = q.x - p.x, dz = q.z - p.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = dz / len, nz = -dx / len;
      const a = Math.hypot(p.x + nx * 4 - ccx, p.z + nz * 4 - ccz);
      const b = Math.hypot(p.x - nx * 4 - ccx, p.z - nz * 4 - ccz);
      const side = a > b ? 1 : -1;
      const x = p.x + nx * side * (ROAD_HALF + 7.4);
      const z = p.z + nz * side * (ROAD_HALF + 7.4);
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      g.rotation.y = Math.atan2(dx, dz);
      addBox(g, 6.2, 0.30, 13.5, 0x5a5a62, 0, 0.15, 0);
      for (let row = 0; row < 4; row++) {
        const rx = side * (-1.9 + row * 1.2);
        addBox(g, 1.25, 0.45, 12.6, seatColours[(row + k) % 3], rx, 0.55 + row * 0.46, 0);
      }
      // open grandstand: tiered seats read from above; low wall and banner behind
      addBox(g, 0.40, 1.35, 13.6, 0x2b2d33, side * 3.0, 0.68, 0);
      addBox(g, 0.14, 0.70, 7.0, 0xe0513f, side * -3.0, 1.45, 0);
      addBox(g, 0.10, 0.18, 13.4, 0xf2eee1, side * 3.0, 1.40, 0);
      group.add(g);
      colliders.push({ x, z, r: 7.0 });
    });
  }

  if (map.armco) {
    const pieces: { x: number; z: number; rot: number }[] = [];
    for (let i = 0; i < track.length; i += 5) {
      const p = track[i], q = track[(i + 5) % track.length];
      const dx = q.x - p.x, dz = q.z - p.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = dz / len, nz = -dx / len;
      for (const side of [-1, 1]) {
        pieces.push({
          x: p.x + nx * side * (ROAD_HALF + 1.15),
          z: p.z + nz * side * (ROAD_HALF + 1.15),
          rot: Math.atan2(dx, dz),
        });
      }
    }
    const railGeo = new THREE.BoxGeometry(0.12, 0.46, 4.65);
    const capGeo = new THREE.BoxGeometry(0.18, 0.08, 4.65);
    const rails = new THREE.InstancedMesh(railGeo, basic(0xb9bec4), pieces.length);
    const caps = new THREE.InstancedMesh(capGeo, basic(0xeef0ec), pieces.length);
    const dummy = new THREE.Object3D();
    pieces.forEach((p, i) => {
      dummy.position.set(p.x, 0.40, p.z);
      dummy.rotation.set(0, p.rot, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      rails.setMatrixAt(i, dummy.matrix);
      dummy.position.y = 0.66;
      dummy.updateMatrix();
      caps.setMatrixAt(i, dummy.matrix);
      if (i % 3 === 0) colliders.push({ x: p.x, z: p.z, r: 0.8 });
    });
    rails.instanceMatrix.needsUpdate = true;
    caps.instanceMatrix.needsUpdate = true;
    group.add(rails, caps);
  }

  if (map.yachts) {
    for (const y of map.yachts) {
      const g = new THREE.Group();
      g.position.set(y.x, 0.02, y.z);
      g.rotation.y = y.rot;
      g.scale.setScalar(y.scale);
      addBox(g, 5.8, 0.68, 1.75, 0xf6f3e8, 0, 0.38, 0);       // hull
      addBox(g, 4.9, 0.12, 1.55, 0xe6dcc2, -0.1, 0.76, 0);     // deck
      addBox(g, 2.0, 0.78, 1.25, 0xf6f3e8, -0.45, 1.20, 0);    // cabin
      addBox(g, 1.8, 0.24, 1.28, 0x1b2b36, -0.45, 1.24, 0);    // windows
      addBox(g, 1.3, 0.10, 1.34, 0xc8463c, -0.45, 1.62, 0);    // cabin roof
      addBox(g, 0.08, 3.3, 0.08, 0xd8d8d8, -0.55, 2.4, 0);     // mast
      addBox(g, 0.55, 0.06, 0.06, 0xd8d8d8, -0.55, 2.9, 0.2);  // spreader
      addBox(g, 0.9, 0.08, 0.9, 0xe0513f, 2.1, 0.78, 0);       // bow cushion
      group.add(g);
    }
  }

  if (map.ferris) {
    const f = map.ferris;
    const g = new THREE.Group();
    g.position.set(f.x, 0, f.z);
    g.rotation.y = f.rot;
    g.scale.setScalar(f.scale);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(5, 0.18, 4, 30), basic(0xf2eee1));
    rim.position.y = 7.2;
    g.add(rim);
    const rim2 = new THREE.Mesh(new THREE.TorusGeometry(4.6, 0.09, 4, 30), basic(0xe0513f));
    rim2.position.y = 7.2;
    g.add(rim2);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.5, 12), basic(0x2b2d33));
    hub.rotation.x = Math.PI / 2;
    hub.position.y = 7.2;
    g.add(hub);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.10, 5, 0.10), basic(0xd8d8d8));
      sp.position.set(Math.cos(a) * 2.5, 7.2 + Math.sin(a) * 2.5, 0);
      sp.rotation.z = a - Math.PI / 2;
      g.add(sp);
      const car = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.62), basic(
        [0xe0513f, 0xf2eee1, 0x2b6d7a][i % 3],
      ));
      car.position.set(Math.cos(a) * 5, 7.2 + Math.sin(a) * 5, 0);
      g.add(car);
    }
    for (const sx of [-3.6, 3.6]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.34, 8.2, 0.34), basic(0xf2eee1));
      leg.position.set(sx * 0.5, 3.6, 0);
      leg.rotation.z = sx > 0 ? -0.38 : 0.38;
      g.add(leg);
    }
    addBox(g, 8.0, 0.3, 2.0, 0x2b2d33, 0, 0.15, 0);
    group.add(g);
    colliders.push({ x: f.x, z: f.z, r: 4.0 });
  }

  if (map.torii) {
    const t = map.torii;
    const g = new THREE.Group();
    g.position.set(t.x, 0, t.z);
    g.rotation.y = t.rot;
    g.scale.setScalar(t.scale);
    const red = 0xc8463c, ink = 0x1d1f24;
    addBox(g, 0.55, 6.0, 0.55, red, -2.2, 3.0, 0);
    addBox(g, 0.55, 6.0, 0.55, red, 2.2, 3.0, 0);
    addBox(g, 6.3, 0.50, 0.70, red, 0, 6.1, 0);
    addBox(g, 5.4, 0.36, 0.62, red, 0, 4.9, 0);
    addBox(g, 6.9, 0.14, 0.82, ink, 0, 6.42, 0);
    addBox(g, 0.8, 0.25, 0.8, ink, -2.2, 0.12, 0);
    addBox(g, 0.8, 0.25, 0.8, ink, 2.2, 0.12, 0);
    group.add(g);
    colliders.push({ x: t.x - 2.2, z: t.z, r: 0.7 }, { x: t.x + 2.2, z: t.z, r: 0.7 });
  }

  const tint = map.tint ? new THREE.Color(map.tint) : undefined;
  group.add(instancedStack(pineTex, defs.pine, pines, tint));
  group.add(instancedStack(palmTex, defs.palm, palms, tint));
  group.add(instancedStack(rockTex, defs.rock, rocks, tint));
  group.add(instancedStack(lampTex, defs.lamp, lamps, tint));
  group.add(instancedStack(tyreTex, defs.tyres, tyres, tint));
  group.add(instancedStack(bldA, defs.bldA, buildings[0], tint));
  group.add(instancedStack(bldB, defs.bldB, buildings[1], tint));
  group.add(instancedStack(bldC, defs.bldC, buildings[2], tint));
  group.add(shadowPatch(shadowTex, shadows, 2.6));

  // start on the long bottom straight, facing along the tangent
  const si = straightestIndex(track);
  const ahead = track.length > 300 ? 8 : 3;
  const s0 = track[si], s1 = track[(si + ahead) % track.length];
  const start = { x: s0.x, z: s0.z, heading: Math.atan2(-(s1.x - s0.x), -(s1.z - s0.z)) };

  // ---- start gantry over the line
  {
    const g = new THREE.Group();
    const steel = new THREE.MeshBasicMaterial({ color: 0x2a2d33, toneMapped: false });
    const span = (ROAD_HALF + 1.6) * 2;
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.28, 5.2, 0.28), steel);
      post.position.set(side * (span / 2 - 0.14), 2.6, 0);
      g.add(post);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.7), steel);
      foot.position.set(side * (span / 2 - 0.14), 0.09, 0);
      g.add(foot);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 0.3, 0.36), steel);
    beam.position.set(0, 5.2, 0);
    g.add(beam);

    // banner: cream field, black chequer band, hanging under the beam
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 48;
    const c2 = cv.getContext('2d')!;
    c2.fillStyle = '#f2eee1'; c2.fillRect(0, 0, 256, 48);
    for (let i = 0; i < 32; i++) {
      c2.fillStyle = i % 2 === 0 ? '#22252a' : '#f2eee1';
      c2.fillRect(i * 8, 0, 8, 10);
    }
    c2.fillStyle = '#22252a';
    c2.font = 'bold 16px monospace';
    c2.textAlign = 'center';
    c2.fillText('SPRITE DRIFT', 128, 34);
    const tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    const bannerGeo = new THREE.PlaneGeometry(span - 0.6, 0.95);
    for (const zside of [0.19, -0.19]) {
      const banner = new THREE.Mesh(bannerGeo, new THREE.MeshBasicMaterial({
        map: tex, side: THREE.DoubleSide, toneMapped: false,
      }));
      banner.position.set(0, 4.6, zside);
      banner.rotation.y = zside > 0 ? 0 : Math.PI;
      g.add(banner);
    }

    g.position.set(start.x, 0, start.z);
    g.rotation.y = start.heading;
    group.add(g);
  }

  // ---- marker boards --------------------------------------------------------
  {
    const furniture = new THREE.Group();
    const postMat = new THREE.MeshBasicMaterial({ color: 0x24262b, toneMapped: false });
    const backMat = new THREE.MeshBasicMaterial({ color: 0xe8e2d2, toneMapped: false });
    const n = track.length;

    const placeBoard = (x: number, z: number, rot: number, tex: THREE.Texture,
      w: number, h: number, bottom: number) => {
      const g = new THREE.Group();
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, bottom + h * 0.5, 0.12), postMat);
        post.position.set(side * (w / 2 - 0.22), (bottom + h * 0.5) / 2, 0);
        g.add(post);
      }
      const geo = new THREE.PlaneGeometry(w, h);
      const face = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
      face.position.set(0, bottom + h / 2, 0.02);
      g.add(face);
      const back = new THREE.Mesh(geo, backMat);
      back.position.set(0, bottom + h / 2, -0.02);
      back.rotation.y = Math.PI;
      g.add(back);
      g.position.set(x, 0, z);
      g.rotation.y = rot;
      furniture.add(g);
    };

    // outward is whichever side of the track is farther from the infield
    let ccx = 0, ccz = 0;
    for (const p of track) { ccx += p.x; ccz += p.z; }
    ccx /= n; ccz /= n;

    const sideAt = (p: P2, nx: number, nz: number) => {
      const a = Math.hypot(p.x + nx * 4 - ccx, p.z + nz * 4 - ccz);
      const b = Math.hypot(p.x - nx * 4 - ccx, p.z - nz * 4 - ccz);
      return a > b ? 1 : -1;
    };

    const straightLabels = ['SPRITE', 'TURBO', 'DRIFT', '8-BIT', 'PIXEL', 'OIL'];
    const accents = ['#e0513f', '#2b6d7a', '#b5432f'];

    // sponsor boards flank the start straight, clear of the gantry
    let bi = 0;
    for (let k = -140; k <= 140; k += 34) {
      if (Math.abs(k) < 22) continue;
      const i = (((si + k) % n) + n) % n;
      const p = track[i], q = track[(i + 4) % n];
      const dx = q.x - p.x, dz = q.z - p.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = dz / len, nz = -dx / len;
      const side = sideAt(p, nx, nz);
      const off = ROAD_HALF + 2.0 + (bi % 2) * 0.3;
      const x = p.x + nx * side * off;
      const z = p.z + nz * side * off;
      // face down the straight toward oncoming cars, angled in toward the road
      const rot = Math.atan2(-dx, -dz) - side * 0.55;
      const tex = boardTexture(straightLabels[bi % straightLabels.length], accents[bi % accents.length]);
      placeBoard(x, z, rot, tex, 3.9, 1.18, 1.05);
      bi++;
    }

    // turn boards at the sharpest corners, placed on the outside of the bend
    const curvAt = (i: number) => {
      const a = track[(i - 8 + n) % n], b = track[i], c = track[(i + 8) % n];
      const v1x = b.x - a.x, v1z = b.z - a.z, v2x = c.x - b.x, v2z = c.z - b.z;
      const l1 = Math.hypot(v1x, v1z) || 1, l2 = Math.hypot(v2x, v2z) || 1;
      return (v1x * v2z - v1z * v2x) / (l1 * l2);
    };
    let lastBoard = -999;
    for (let i = 0; i < n; i++) {
      const c = Math.abs(curvAt(i));
      if (c < 0.14 || c < Math.abs(curvAt((i - 1 + n) % n)) || c < Math.abs(curvAt((i + 1) % n))) continue;
      if (i - lastBoard < 80) continue;
      const p = track[i], q = track[(i + 4) % n], r = track[(i - 4 + n) % n];
      const tx = q.x - r.x, tz = q.z - r.z;
      const len = Math.hypot(tx, tz) || 1;
      const nx = tz / len, nz = -tx / len;
      const side = sideAt(p, nx, nz);
      const x = p.x + nx * side * (ROAD_HALF + 3.0);
      const z = p.z + nz * side * (ROAD_HALF + 3.0);
      const rot = Math.atan2(-tx, -tz) - side * 0.35;
      placeBoard(x, z, rot, arrowTexture(curvAt(i) > 0 ? 1 : -1), 2.1, 2.1, 1.0);
      lastBoard = i;
    }
    group.add(furniture);
  }

  return {
    group, colliders, roadAt, kerbAt, nearbyRoad, start, addSkid, clearSkid,
    roadHalf: ROAD_HALF,
    name: map.name,
    mapId: map.id,
    sky: map.sky ?? '#4e7a45',
    minimapPath: track.filter((_, i) => i % 2 === 0),
    track,
    update() {
      if (skidDirty) {
        skidTex.needsUpdate = true;
        skidDirty = false;
      }
    },
  };
}
