import * as THREE from 'three';
import { instancedStack, loadSheet, shadowPatch, type Placement, type StackDef } from './stack';

export const WORLD = 172;
// Set from the active map in buildWorld; the world is WORLD × WORLD units.
let ROAD_HALF = 4.4;
const PX = 2048;
// The painted ground is wider than the playable area, so props and the camera
// never see the texture edge.
const GX = 180;
const HALF_G = GX / 2;
const PPU = PX / GX;
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
  groundAt?: (x: number, z: number, heading: number, trackIdx?: number) => number;
  bridgeColliders?: Collider[];
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
  trees?: 'pine' | 'palm' | 'mixed' | 'sakura';
  town?: [number, number][];
  props?: { trees: number; rocks: number; buildings: number; lampStride: number; rockScale: number };
  density?: number;
  buildingScale?: number;
  sky?: string;
  petals?: boolean;
  snow?: boolean;
  snowGear?: boolean;
  grandstands?: boolean;
  armco?: boolean;
  yachts?: { x: number; z: number; rot: number; scale: number }[];
  ferris?: { x: number; z: number; rot: number; scale: number };
  torii?: { x: number; z: number; rot: number; scale: number };
  pagoda?: { x: number; z: number; rot: number; scale: number };
  pondBridge?: boolean;
  fuji?: { x: number; z: number; scale: number };
  /** The drivable bridge at the figure-eight crossing; see ADR 004. */
  overpass?: boolean;
}

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
    id: 'alpine', name: 'Frostbite Pass', roadHalf: 4.2, smooth: true,
    ctrl: [
      [-50, 4], [-40, 22], [-20, 36], [4, 42], [28, 38], [46, 28], [58, 10],
      [58, -10], [50, -30], [34, -44], [12, -50],
      [-8, -48], [-14, -43], [-15, -36], [-10, -31], [0, -29], [10, -29],
      [19, -28], [26, -24], [29, -19], [28, -15], [21, -12], [9, -11],
      [-3, -11], [-15, -12], [-23, -14], [-27, -15], [-36, -19], [-44, -24],
      [-49, -18], [-52, -8],
    ],
    palette: {
      grass: '#dfe6ea', tones: ['#eef3f6', '#c9d5dc', '#f7fafc', '#b6c6d0', '#ffffff'],
      bladeA: '#ffffff', bladeB: '#a9bcc8',
      sand: '#b9c6cd', water: '#8fc9dc', waterLt: 'rgba(205,240,248,0.65)',
      shoulder: '#93a2ab', asphalt: '#4a4f57', grainA: '#737a84', grainB: '#2f333a',
      line: 'rgba(250,252,255,0.85)', kerbA: '#f2f6f8', kerbB: '#3f6fb0',
    },
    lake: { x: 2, z: 8, rx: 10, rz: 7 },
    trees: 'pine', density: 1.0, tint: '#f3fbff', snow: true, snowGear: true,
    props: { trees: 230, rocks: 44, buildings: 0, lampStride: 46, rockScale: 1.2 },
    town: [],
    sky: '#cfe4f2',
  },
  {
    id: 'sakura', name: 'Sakura Circuit', roadHalf: 4.2, smooth: true,
    ctrl: figure8(58, 38, 72, 0.35),
    palette: {
      grass: '#315b42', tones: ['#3c6e4e', '#244632', '#4c825f', '#1b3727', '#5d9572'],
      bladeA: '#7fb38a', bladeB: '#1c3a29',
      sand: '#b9b08c', water: '#2b6f72', waterLt: 'rgba(110,190,185,0.5)',
      shoulder: '#6b6653', asphalt: '#41434a', grainA: '#646671', grainB: '#282a30',
      line: 'rgba(248,246,232,0.88)', kerbA: '#f2eee2', kerbB: '#c8463c',
    },
    lake: { x: 0, z: -30, rx: 10, rz: 7 },
    trees: 'sakura', density: 1.15, tint: '#ffe2ef', petals: true,
    props: { trees: 190, rocks: 38, buildings: 0, lampStride: 42, rockScale: 1.1 },
    town: [],
    sky: '#9fbea7',
    ferris: { x: -30, z: 0, rot: 0.2, scale: 1.15 },
    torii: { x: 28, z: 0, rot: Math.PI / 2, scale: 1.1 },
    pagoda: { x: 0, z: 30, rot: 0, scale: 0.8 },
    pondBridge: true,
    overpass: true,
  },
];

// Fill long polygon edges with points so roadAt/minimap see the whole straight.
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
  // Polygon with filleted corners: keeps the hard layout while giving the
  // kerb offset a radius to work with.
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

// Pick the straightest stretch, away from self-crossings, for the start line.
function straightestIndex(track: P2[], minOriginDist = 0): number {
  const n = track.length;
  const win = n > 300 ? 16 : 4;
  const avoid = Math.max(24, Math.round(n * 0.08));
  let best = Math.floor(n / 3), bestScore = -Infinity;
  for (let i = 0; i < n; i += 2) {
    const b = track[i];
    if (Math.hypot(b.x, b.z) < minOriginDist) continue;
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

  g.fillStyle = map.palette.grass;
  g.fillRect(0, 0, PX, PX);

  const tones = map.palette.tones;
  for (let i = 0; i < 42000; i++) {
    const x = (rnd() * PX) | 0, y = (rnd() * PX) | 0;
    g.fillStyle = tones[(rnd() * tones.length) | 0];
    g.globalAlpha = 0.55 + rnd() * 0.45;
    g.fillRect(x, y, 2, 2);
  }
  g.globalAlpha = 1;

  for (let i = 0; i < 3000; i++) {
    const x = (rnd() * PX) | 0, y = (rnd() * PX) | 0;
    g.fillStyle = rnd() > 0.6 ? map.palette.bladeA : map.palette.bladeB;
    g.globalAlpha = 0.6 + rnd() * 0.4;
    g.fillRect(x, y, 1, 2);
  }
  g.globalAlpha = 1;

  // Cherry petals: a soft pink scatter under the blossom trees.
  if (map.petals) {
    for (let i = 0; i < 9000; i++) {
      const x = (rnd() * PX) | 0, y = (rnd() * PX) | 0;
      g.fillStyle = rnd() > 0.45 ? 'rgba(255,196,218,0.55)' : 'rgba(255,225,236,0.45)';
      g.fillRect(x, y, rnd() > 0.6 ? 2 : 1, 1);
    }
    for (let i = 0; i < 180; i++) {
      const cx = rnd() * PX, cy = rnd() * PX;
      for (let k = 0; k < 10; k++) {
        g.fillStyle = rnd() > 0.5 ? 'rgba(255,190,214,0.5)' : 'rgba(255,232,240,0.4)';
        g.fillRect((cx + (rnd() - 0.5) * 20) | 0, (cy + (rnd() - 0.5) * 20) | 0, 1, 1);
      }
    }
  }

  for (let i = 0; i < 420; i++) {
    const cx = rnd() * PX, cy = rnd() * PX;
    for (let k = 0; k < 14; k++) {
      g.fillStyle = rnd() > 0.5 ? map.palette.bladeB : map.palette.bladeA;
      g.globalAlpha = 0.35;
      g.fillRect((cx + (rnd() - 0.5) * 22) | 0, (cy + (rnd() - 0.5) * 22) | 0, 2, 2);
    }
  }
  g.globalAlpha = 1;

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

  if (map.snow && map.lake) {
    const lx = (map.lake.x + HALF_G) * PPU, ly = (map.lake.z + HALF_G) * PPU;
    g.save();
    g.beginPath();
    g.ellipse(lx, ly, (map.lake.rx - 2) * PPU, (map.lake.rz - 1.8) * PPU, 0.35, 0, Math.PI * 2);
    g.clip();
    g.strokeStyle = 'rgba(230,250,255,0.55)';
    g.lineWidth = 2;
    for (let i = 0; i < 18; i++) {
      const sx = lx + (rnd() - 0.5) * map.lake.rx * 2 * PPU;
      const sy = ly + (rnd() - 0.5) * map.lake.rz * 2 * PPU;
      g.beginPath();
      g.moveTo(sx, sy);
      let px = sx, py = sy;
      for (let k = 0; k < 3; k++) {
        px += (rnd() - 0.5) * 28; py += (rnd() - 0.5) * 28;
        g.lineTo(px, py);
      }
      g.stroke();
    }
    g.restore();
  }

  strokePath(g, track, map.palette.shoulder, (ROAD_HALF * 2 + 1.6) * PPU);
  strokePath(g, track, map.palette.asphalt, ROAD_HALF * 2 * PPU);

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

  strokePath(g, offsetPath(track, ROAD_HALF - 0.45), map.palette.line, 0.34 * PPU);
  strokePath(g, offsetPath(track, -(ROAD_HALF - 0.45)), map.palette.line, 0.34 * PPU);

  for (const side of [1, -1]) {
    const edge = offsetPath(track, side * (ROAD_HALF + 0.15));
    strokePath(g, edge, map.palette.kerbA, 0.7 * PPU);
    dotted(g, edge, map.palette.kerbB, 0.7 * PPU, 1.5 * PPU, 1.5 * PPU);

  }

  dotted(g, track, 'rgba(246,246,240,0.62)', 0.16 * PPU, 1.9 * PPU, 2.4 * PPU);

  const si = straightestIndex(track, map.overpass ? 46 : 0);
  const s = track[si], s2 = track[(si + 3) % track.length];
  // The start line runs across the road, not along it.
  const ang = Math.atan2(s2.z - s.z, s2.x - s.x) + Math.PI * 0.5;
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

/** Japanese circuit board: cream field, red rising sun, kanji. */
function jpBoardTexture(label: string, accent: string): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = 160; cv.height = 64;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#f6f0e4'; g.fillRect(0, 0, 160, 64);
  g.fillStyle = accent; g.fillRect(0, 0, 160, 7); g.fillRect(0, 57, 160, 7);
  g.fillStyle = '#22252a';
  g.fillRect(5, 9, 150, 2); g.fillRect(5, 53, 150, 2);
  g.beginPath(); g.arc(25, 27, 11, 0, Math.PI * 2); g.fillStyle = '#c8463c'; g.fill();
  g.fillStyle = '#f6f0e4'; g.beginPath(); g.arc(25, 27, 7, 0, Math.PI * 2); g.fill();
  g.font = 'bold 27px "Noto Sans CJK JP", "Noto Sans JP", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#1b1d22';
  g.fillText(label, 100, 32);
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function jpBannerTexture(label: string, accent: string): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 192;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#f6f0e4'; g.fillRect(0, 0, 64, 192);
  g.fillStyle = accent; g.fillRect(0, 0, 64, 8); g.fillRect(0, 184, 64, 8);
  g.fillStyle = '#22252a'; g.fillRect(4, 12, 56, 2); g.fillRect(4, 178, 56, 2);
  g.font = 'bold 44px "Noto Sans CJK JP", "Noto Sans JP", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#1b1d22';
  const chars = [...label];
  chars.forEach((ch, i) => g.fillText(ch, 32, 40 + i * 54));
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

  // Fig-eight overpass: one branch climbs a short bridge, the other passes
  // underneath; which branch rises is picked by x-tangent, not heading.
  let bridge: { cx: number; cz: number; dirx: number; dirz: number;
    halfW: number; deckHalf: number; ramp: number; height: number; upperIdx: number } | null = null;
  const bridgeColliders: Collider[] = [];
  if (map.overpass) {
    const near: number[] = [];
    for (let i = 0; i < track.length; i += 2) {
      if (Math.hypot(track[i].x, track[i].z) < 2.2) near.push(i);
    }
    const i0 = near[0] ?? 0;
    const i1 = near.find((i) => Math.abs(i - i0) > track.length / 4)
      ?? (i0 + Math.floor(track.length / 2)) % track.length;
    const tangent = (i: number) => {
      const a = track[(i - 5 + track.length) % track.length];
      const b = track[(i + 5) % track.length];
      const dx = b.x - a.x, dz = b.z - a.z;
      const l = Math.hypot(dx, dz) || 1;
      return { x: dx / l, z: dz / l };
    };
    const t0 = tangent(i0);
    const t1 = tangent(i1);
    const dir = t0.x >= t1.x ? t0 : t1;
    bridge = {
      cx: 0, cz: 0, dirx: dir.x, dirz: dir.z,
      halfW: ROAD_HALF + 1.2, deckHalf: 0, ramp: 14.0, height: 3.4,
      upperIdx: dir === t0 ? i0 : i1,
    };
  }
  const bridgeHeight = (along: number) => {
    if (!bridge) return 0;
    const a = Math.abs(along);
    if (a >= bridge.ramp) return 0;
    const t = a / bridge.ramp;
    return bridge.height * (1 - t * t);
  };
  const groundAt = (x: number, z: number, heading: number, trackIdx?: number) => {
    if (!bridge) return 0;
    if (trackIdx !== undefined) {
      const n = track.length;
      let d = trackIdx - bridge.upperIdx;
      d = ((d + n / 2) % n + n) % n - n / 2;
      if (Math.abs(d) > 70) return 0;
    }
    const dx = x - bridge.cx, dz = z - bridge.cz;
    const along = dx * bridge.dirx + dz * bridge.dirz;
    const across = dx * -bridge.dirz + dz * bridge.dirx;
    if (Math.abs(across) > bridge.halfW || Math.abs(along) >= bridge.ramp) return 0;
    if (trackIdx === undefined) {
      const fwdX = -Math.sin(heading), fwdZ = -Math.cos(heading);
      if (fwdX * bridge.dirx + fwdZ * bridge.dirz < 0.6) return 0;
    }
    return bridgeHeight(along);
  };

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

  const [pineTex, sakuraTex, snowTex, palmTex, rockTex, lampTex, tyreTex, bldA, bldB, bldC, shadowTex,
    cactusTex, mesaTex, pylonTex] = await Promise.all([
    loadSheet('/sprites/pine.png'), loadSheet('/sprites/sakura.png'),
    loadSheet('/sprites/pine-snow.png'), loadSheet('/sprites/palm.png'),
    loadSheet('/sprites/rock.png'), loadSheet('/sprites/lamp.png'), loadSheet('/sprites/tyres.png'),
    loadSheet('/sprites/building-a.png'), loadSheet('/sprites/building-b.png'),
    loadSheet('/sprites/building-c.png'), loadSheet('/sprites/shadow.png'),
    loadSheet('/sprites/cactus.png'), loadSheet('/sprites/mesa.png'), loadSheet('/sprites/pylon.png'),
  ]);

  const defs: Record<string, StackDef> = {
    pine: { url: '', layers: 18, sheetW: 40, sheetH: 40, worldW: 3.1, lift: 0.125 },
    sakura: { url: '', layers: 18, sheetW: 40, sheetH: 40, worldW: 3.1, lift: 0.125 },
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

  const pines: Placement[] = [], palms: Placement[] = [], sakuras: Placement[] = [];
  const addTree = (x: number, z: number, palm = false) => {
    if (!free(x, z, 1.5, 0.9)) return;
    if (map.trees === 'sakura') sakuras.push({ x, z, rot: rnd() * 6.28, scale: 0.85 + rnd() * 0.45 });
    else if (palm) palms.push({ x, z, rot: rnd() * 6.28, scale: 0.9 + rnd() * 0.3 });
    else pines.push({ x, z, rot: rnd() * 6.28, scale: 0.85 + rnd() * 0.45 });
    taken.push({ x, z, r: 1.5 });
    colliders.push({ x, z, r: 0.7 });
    shadows.push({ x, z, rot: 0, scale: 1.7 });
  };

  // Trees: a corridor along the track, then loose woodland clusters in the open.
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
    const palmChance = map.snow ? 0 : map.trees === 'palm' ? 0.9 : map.trees === 'mixed' ? 0.45 : 0.08;
    addTree(x + (rnd() - 0.5) * 2, z + (rnd() - 0.5) * 2, !map.snow && nearLake ? rnd() > 0.35 : rnd() < palmChance);
  }

  let guard = 0;
  const treeTarget = map.props?.trees ?? Math.round(190 * (map.density ?? 1));
  while (pines.length + palms.length + sakuras.length < treeTarget && guard++ < 3000) {
    const x = (rnd() - 0.5) * (WORLD - 8);
    const z = (rnd() - 0.5) * (WORLD - 8);
    const palmChance = map.snow ? 0 : map.trees === 'palm' ? 0.9 : map.trees === 'mixed' ? 0.45 : 0.08;
    const nearLake = map.lake ? Math.hypot(x - map.lake.x, z - map.lake.z) < map.lake.rx + 3 : false;
    addTree(x, z, !map.snow && nearLake ? rnd() > 0.35 : rnd() < palmChance);
  }

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

  const lamps: Placement[] = [];
  for (let i = 0; i < track.length; i += (map.props?.lampStride ?? 58)) {
    const p = track[i];
    const q = track[(i + 6) % track.length];
    const dx = q.x - p.x, dz = q.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = dz / len, nz = -dx / len;
    const x = p.x + nx * (ROAD_HALF + 1.6);
    const z = p.z + nz * (ROAD_HALF + 1.6);
    // A nearby branch of the circuit can put the lamp on tarmac; skip those.
    if (nearbyRoad(x, z, ROAD_HALF + 0.7)) continue;
    lamps.push({ x, z, rot: Math.atan2(dx, dz), scale: 1 });
    colliders.push({ x, z, r: 0.28 });
    shadows.push({ x, z, rot: 0, scale: 0.6 });
  }

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
      if (nearbyRoad(bx, bz, ROAD_HALF + 0.5)) continue;
      tyres.push({ x: bx, z: bz, rot: rnd() * 6.28, scale: 0.95 + rnd() * 0.15 });
      colliders.push({ x: bx, z: bz, r: 0.62 });
      shadows.push({ x: bx, z: bz, rot: 0, scale: 0.9 });
    }
  }

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

  if (bridge) {
    const g = new THREE.Group();
    g.position.set(bridge.cx, 0, bridge.cz);
    g.rotation.y = Math.atan2(bridge.dirx, bridge.dirz);
    const W = bridge.halfW * 2;
    const H = bridge.height;
    const rp = bridge.ramp;
    const segs = 18;

    const deckMat = new THREE.MeshBasicMaterial({ color: 0x6b4a3a, toneMapped: false });
    const verts: number[] = [];
    for (let i = 0; i < segs; i++) {
      const za = -rp + (2 * rp * i) / segs;
      const zb = -rp + (2 * rp * (i + 1)) / segs;
      const ya = bridgeHeight(za), yb = bridgeHeight(zb);
      verts.push(-W / 2, ya, za, W / 2, yb, zb, W / 2, ya, za);
      verts.push(-W / 2, ya, za, -W / 2, yb, zb, W / 2, yb, zb);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, deckMat));

    for (let i = 1; i < segs; i++) {
      const z = -rp + (2 * rp * i) / segs;
      addBox(g, W - 0.34, 0.020, 0.10, 0x4a3228, 0, bridgeHeight(z) + 0.025, z);
    }
    const beam = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, t: number, color: number) => {
      const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz);
      const d = b.clone().sub(a);
      const m = new THREE.Mesh(new THREE.BoxGeometry(t, d.length(), t), basic(color));
      m.position.copy(a).addScaledVector(d, 0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
      g.add(m);
    };

    for (const sx of [-W / 2 + 0.12, W / 2 - 0.12]) {
      for (let i = 0; i < segs; i++) {
        const za = -rp + (2 * rp * i) / segs;
        const zb = -rp + (2 * rp * (i + 1)) / segs;
        const ya = bridgeHeight(za), yb = bridgeHeight(zb);
        beam(sx, ya + 0.04, za, sx, yb + 0.04, zb, 0.22, 0xf2eee1);
        beam(sx, ya + 0.55, za, sx, yb + 0.55, zb, 0.085, 0xb5523f);
        beam(sx, ya + 1.02, za, sx, yb + 1.02, zb, 0.075, 0xb5523f);
      }
      for (let i = 0; i <= segs; i++) {
        const z = -rp + (2 * rp * i) / segs;
        const y = bridgeHeight(z);
        addBox(g, 0.13, 0.95, 0.13, 0xb5523f, sx, y + 0.50, z);
        if (i % 4 === 0) {
          addBox(g, 0.30, 0.34, 0.30, 0xffe1a0, sx, y + 1.20, z);
          addBox(g, 0.46, 0.10, 0.46, 0x2b2d33, sx, y + 1.42, z);
        }
      }
    }

    const stone = 0xa8adb3;
    for (const sx of [-W / 2 + 0.58, W / 2 - 0.58]) {
      for (const z of [-5.8, 5.8]) {
        const h = bridgeHeight(z);
        addBox(g, 0.58, h, 0.58, stone, sx, h / 2, z);
        const wx = bridge.cx + sx * bridge.dirz + z * bridge.dirx;
        const wz = bridge.cz - sx * bridge.dirx + z * bridge.dirz;
        colliders.push({ x: wx, z: wz, r: 0.5 });
      }
    }
    addBox(g, W - 0.7, 0.28, 0.55, stone, 0, H - 0.34, 0);
    for (const sx of [-W / 2 + 0.35, W / 2 - 0.35]) {
      for (let z = -10; z <= 10; z += 2.5) {
        const wx = bridge.cx + sx * bridge.dirz + z * bridge.dirx;
        const wz = bridge.cz - sx * bridge.dirx + z * bridge.dirz;
        bridgeColliders.push({ x: wx, z: wz, r: 0.35 });
      }
    }

    for (const sx of [-W / 2 - 0.02, W / 2 + 0.02]) {
      const plaque = new THREE.Mesh(
        new THREE.PlaneGeometry(2.2, 0.95),
        new THREE.MeshBasicMaterial({ map: jpBoardTexture('桜橋', '#c8463c'), toneMapped: false }),
      );
      plaque.position.set(sx, H + 0.72, 0);
      plaque.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
      g.add(plaque);
    }
    group.add(g);
  }

  if (map.pagoda) {
    const pd = map.pagoda;
    const g = new THREE.Group();
    g.position.set(pd.x, 0, pd.z);
    g.rotation.y = pd.rot;
    g.scale.setScalar(pd.scale);
    const red = 0xc8463c, roof = 0x8f2f2f, cream = 0xe8dcc2, stone = 0x9aa0a6, gold = 0xd9b45a;
    addBox(g, 9.2, 0.6, 9.2, stone, 0, 0.3, 0);
    addBox(g, 4.8, 3.0, 4.8, cream, 0, 2.1, 0);
    for (const px of [-2.1, 2.1]) for (const pz of [-2.1, 2.1]) {
      addBox(g, 0.34, 3.2, 0.34, red, px, 2.1, pz);
    }
    addBox(g, 7.6, 0.45, 7.6, roof, 0, 3.85, 0);
    addBox(g, 7.9, 0.10, 7.9, cream, 0, 4.05, 0);
    addBox(g, 3.6, 2.6, 3.6, cream, 0, 5.35, 0);
    for (const px of [-1.5, 1.5]) for (const pz of [-1.5, 1.5]) {
      addBox(g, 0.28, 2.8, 0.28, red, px, 5.35, pz);
    }
    addBox(g, 6.4, 0.42, 6.4, roof, 0, 6.85, 0);
    addBox(g, 6.7, 0.10, 6.7, cream, 0, 7.04, 0);
    addBox(g, 2.6, 2.2, 2.6, cream, 0, 8.15, 0);
    for (const px of [-1.0, 1.0]) for (const pz of [-1.0, 1.0]) {
      addBox(g, 0.24, 2.4, 0.24, red, px, 8.15, pz);
    }
    addBox(g, 5.2, 0.38, 5.2, roof, 0, 9.45, 0);
    addBox(g, 5.5, 0.10, 5.5, cream, 0, 9.62, 0);
    addBox(g, 0.22, 1.7, 0.22, gold, 0, 10.4, 0);
    group.add(g);
    colliders.push({ x: pd.x, z: pd.z, r: 5.2 });
  }

  if (map.pondBridge && map.lake) {
    const g = new THREE.Group();
    g.position.set(map.lake.x, 0, map.lake.z);
    const red = 0xc8463c, deck = 0xd9b45a;
    for (let i = -2; i <= 2; i++) {
      const h = 1.2 + (1 - Math.abs(i) / 2) * 0.9;
      addBox(g, 3.4, 0.18, 2.4, deck, i * 3.1, h, 0);
      for (const zs of [-1.25, 1.25]) addBox(g, 0.14, 0.9, 0.14, red, i * 3.1, h + 0.6, zs);
    }
    for (const zs of [-1.25, 1.25]) {
      addBox(g, 15.6, 0.12, 0.12, red, 0, 2.65, zs);
      addBox(g, 15.6, 0.10, 0.10, red, 0, 2.15, zs);
    }
    group.add(g);
  }

  if (map.fuji) {
    const f = map.fuji;
    const g = new THREE.Group();
    g.position.set(f.x, 0, f.z);
    g.scale.setScalar(f.scale);
    const base = new THREE.Mesh(new THREE.ConeGeometry(24, 32, 6), basic(0x6f8296));
    base.position.y = 16;
    g.add(base);
    const snow = new THREE.Mesh(new THREE.ConeGeometry(8.5, 11, 6), basic(0xf2f6f8));
    snow.position.y = 26.5;
    g.add(snow);
    group.add(g);
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

  if (map.snowGear) {
    const white = 0xf4f8fb, blue = 0x4f8fb5, red = 0xc8463c, ink = 0x22262c, steel = 0x9aa7b0;

    const lift = new THREE.Group();
    for (const z of [-22, 0, 22]) {
      addBox(lift, 0.55, 8.4, 0.55, steel, 66, 4.2, z);
      addBox(lift, 3.4, 0.24, 0.3, steel, 66, 8.2, z);
      addBox(lift, 0.32, 0.34, 0.32, red, 64.4, 8.0, z);
      addBox(lift, 0.32, 0.34, 0.32, red, 67.6, 8.0, z);
    }
    for (const z of [-11, 11]) {
      addBox(lift, 0.12, 0.12, 44, ink, 64.5, 8.1, 0);
      addBox(lift, 0.12, 0.12, 44, ink, 67.5, 8.1, 0);
    }
    for (const z of [-16, -5, 6, 17]) {
      addBox(lift, 0.08, 1.0, 0.08, ink, 66, 7.5, z);
      addBox(lift, 1.0, 1.15, 1.15, red, 66, 6.7, z);
      addBox(lift, 0.8, 0.7, 0.9, white, 66, 6.75, z);
    }
    group.add(lift);

    const cannon = (x: number, z: number, rot: number) => {
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      g.rotation.y = rot;
      addBox(g, 1.0, 0.28, 1.0, ink, 0, 0.14, 0);
      addBox(g, 0.55, 2.3, 0.55, white, 0, 1.3, 0);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.38, 2.0, 8), basic(blue));
      barrel.rotation.x = Math.PI / 2.7;
      barrel.position.set(0, 2.65, 0.65);
      g.add(barrel);
      addBox(g, 0.75, 0.75, 0.10, ink, 0, 2.9, 1.55);
      const pile = new THREE.Mesh(new THREE.ConeGeometry(1.6, 1.0, 7), basic(white));
      pile.position.set(0, 0.5, 2.0);
      g.add(pile);
      group.add(g);
      colliders.push({ x, z, r: 1.1 });
    };
    cannon(-55, 20, 0.6);
    cannon(61, -28, -0.7);
    cannon(20, -56, Math.PI);

    // Scan outward from the service area for a patch free enough to park the
    // snowcat, so rocks or trees never evict it.
    let catAt: [number, number] | null = null;
    for (let a = 0; a < 96 && !catAt; a++) {
      const ang = a * 0.61;
      const rad = 7 + (a % 6) * 3.5;
      const px = 34 + Math.cos(ang) * rad;
      const pz = 6 + Math.sin(ang) * rad;
      if (free(px, pz, 3)) catAt = [px, pz];
    }
    if (catAt) {
      const [cx, cz] = catAt;
      const g = new THREE.Group();
      g.position.set(cx, 0, cz);
      g.rotation.y = 0.4;
      addBox(g, 4.2, 1.2, 2.0, red, 0, 1.0, 0);
      addBox(g, 2.0, 1.2, 1.7, white, -0.7, 2.05, 0);
      addBox(g, 1.7, 0.7, 1.5, ink, -0.7, 2.15, -0.58);
      for (const sx of [-1.6, 1.6]) {
        addBox(g, 0.55, 1.2, 3.0, ink, sx, 0.62, 0);
        for (const z of [-0.9, 0, 0.9]) addBox(g, 0.62, 0.10, 0.16, steel, sx, 0.74, z);
      }
      const blade = addBox(g, 4.2, 1.5, 0.22, white, 0, 0.85, 2.15);
      blade.rotation.x = -0.18;
      addBox(g, 0.25, 2.2, 0.25, red, -1.1, 3.1, -0.65);
      addBox(g, 0.25, 2.2, 0.25, red, 1.1, 3.1, -0.65);
      group.add(g);
      colliders.push({ x: cx, z: cz, r: 3.2 });
    }

    if (map.lake) {
      const huts: [number, number, number][] = [[-2, 8, 0.25], [7, 5, -0.35], [1, 13, 0.7]];
      for (const [x, z, rot] of huts) {
        const g = new THREE.Group();
        g.position.set(x, 0, z);
        g.rotation.y = rot;
        addBox(g, 2.2, 1.7, 2.2, white, 0, 0.85, 0);
        addBox(g, 2.5, 0.22, 2.5, blue, 0, 1.8, 0);
        addBox(g, 0.55, 1.0, 0.08, ink, 0, 0.8, 1.12);
        addBox(g, 0.22, 0.9, 0.22, ink, 0.6, 2.2, -0.4);
        group.add(g);
        colliders.push({ x, z, r: 1.7 });
      }
    }
  }

  let snowfall: { points: THREE.Points; pos: Float32Array; speed: Float32Array } | null = null;
  if (map.snow) {
    const N = 1400;
    const pos = new Float32Array(N * 3);
    const speed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * WORLD;
      pos[i * 3 + 1] = Math.random() * 32;
      pos[i * 3 + 2] = (Math.random() - 0.5) * WORLD;
      speed[i] = 0.018 + Math.random() * 0.025;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff, size: 1.7, sizeAttenuation: false,
      transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    group.add(points);
    snowfall = { points, pos, speed };
  }

  const tint = map.tint ? new THREE.Color(map.tint) : undefined;
  group.add(instancedStack(map.snow ? snowTex : pineTex, map.snow ? defs.snowpine : defs.pine, pines, tint));
  group.add(instancedStack(sakuraTex, defs.sakura, sakuras, tint));
  group.add(instancedStack(palmTex, defs.palm, palms, tint));
  group.add(instancedStack(rockTex, defs.rock, rocks, tint));
  group.add(instancedStack(lampTex, defs.lamp, lamps, tint));
  group.add(instancedStack(tyreTex, defs.tyres, tyres, tint));
  group.add(instancedStack(bldA, defs.bldA, buildings[0], tint));
  group.add(instancedStack(bldB, defs.bldB, buildings[1], tint));
  group.add(instancedStack(bldC, defs.bldC, buildings[2], tint));
  group.add(shadowPatch(shadowTex, shadows, 2.6));

  const si = straightestIndex(track, map.overpass ? 46 : 0);
  const ahead = track.length > 300 ? 8 : 3;
  const s0 = track[si], s1 = track[(si + ahead) % track.length];
  const start = { x: s0.x, z: s0.z, heading: Math.atan2(-(s1.x - s0.x), -(s1.z - s0.z)) };

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

    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 48;
    const c2 = cv.getContext('2d')!;
    c2.fillStyle = '#f2eee1'; c2.fillRect(0, 0, 256, 48);
    for (let i = 0; i < 32; i++) {
      c2.fillStyle = i % 2 === 0 ? '#22252a' : '#f2eee1';
      c2.fillRect(i * 8, 0, 8, 10);
    }
    c2.fillStyle = '#22252a';
    c2.textAlign = 'center';
    if (map.id === 'sakura') {
      c2.font = 'bold 19px "Noto Sans CJK JP", "Noto Sans JP", sans-serif';
      c2.fillText('桜サーキット', 128, 34);
    } else {
      c2.font = 'bold 16px monospace';
      c2.fillText('PIXEL DRIFT', 128, 34);
    }
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
      // Named so main.ts can hide it behind the title; see ADR 005.
      banner.name = 'gantryBanner';
      g.add(banner);
    }

    g.position.set(start.x, 0, start.z);
    g.rotation.y = start.heading;
    group.add(g);
  }

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

    let ccx = 0, ccz = 0;
    for (const p of track) { ccx += p.x; ccz += p.z; }
    ccx /= n; ccz /= n;

    const sideAt = (p: P2, nx: number, nz: number) => {
      const a = Math.hypot(p.x + nx * 4 - ccx, p.z + nz * 4 - ccz);
      const b = Math.hypot(p.x - nx * 4 - ccx, p.z - nz * 4 - ccz);
      return a > b ? 1 : -1;
    };

    const straightLabels = map.id === 'sakura'
      ? ['桜', '鈴鹿', '日本', '富士', '速度', '東京']
      : ['PIXEL', 'TURBO', 'DRIFT', '8-BIT', 'NITRO', 'OIL'];
    const accents = ['#e0513f', '#2b6d7a', '#b5432f'];

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
      const rot = Math.atan2(-dx, -dz) - side * 0.55;
      const tex = map.id === 'sakura'
        ? jpBoardTexture(straightLabels[bi % straightLabels.length], accents[bi % accents.length])
        : boardTexture(straightLabels[bi % straightLabels.length], accents[bi % accents.length]);
      placeBoard(x, z, rot, tex, 3.9, 1.18, 1.05);
      bi++;
    }

    if (map.id === 'sakura') {
      const banners = ['桜', '鈴鹿'];
      banners.forEach((label, k) => {
        const i = (((si + (k === 0 ? -16 : 16)) % n) + n) % n;
        const p = track[i], q = track[(i + 4) % n];
        const dx = q.x - p.x, dz = q.z - p.z;
        const len = Math.hypot(dx, dz) || 1;
        const nx = dz / len, nz = -dx / len;
        const side = sideAt(p, nx, nz);
        const x = p.x + nx * side * (ROAD_HALF + 2.6);
        const z = p.z + nz * side * (ROAD_HALF + 2.6);
        const rot = Math.atan2(-dx, -dz) - side * 0.35;
        placeBoard(x, z, rot, jpBannerTexture(label, k === 0 ? '#c8463c' : '#22252a'), 1.5, 3.4, 1.1);
      });
    }

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
      const side = curvAt(i) > 0 ? 1 : -1;
      const x = p.x + nx * side * (ROAD_HALF + 3.0);
      const z = p.z + nz * side * (ROAD_HALF + 3.0);
      lastBoard = i;
      if (nearbyRoad(x, z, ROAD_HALF + 1.2)) continue;
      const rot = Math.atan2(-tx, -tz) - side * 0.35;
      placeBoard(x, z, rot, arrowTexture(curvAt(i) > 0 ? 1 : -1), 2.1, 2.1, 1.0);
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
    groundAt,
    bridgeColliders: bridge ? bridgeColliders : undefined,
    update() {
      if (skidDirty) {
        skidTex.needsUpdate = true;
        skidDirty = false;
      }
      if (snowfall) {
        const p = snowfall.pos;
        for (let i = 0; i < snowfall.speed.length; i++) {
          p[i * 3 + 1] -= snowfall.speed[i];
          p[i * 3] += 0.004;
          if (p[i * 3 + 1] < 0) {
            p[i * 3 + 1] = 30 + Math.random() * 4;
            p[i * 3] = (Math.random() - 0.5) * WORLD;
            p[i * 3 + 2] = (Math.random() - 0.5) * WORLD;
          }
        }
        (snowfall.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      }
    },
  };
}
