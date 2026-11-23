import * as THREE from 'three';
import { instancedStack, loadSheet, shadowPatch, type Placement, type StackDef } from './stack';

export const WORLD = 108;
let ROAD_HALF = 4.4;
// set from the active map when the world is built          // world is WORLD × WORLD units
const PX = 2048;                  // ground texture resolution
const GX = 132;                   // ground is painted wider than the playable area
const HALF_G = GX / 2;
const PPU = PX / GX;              // pixels per world unit
const HALF = WORLD / 2;

export interface Collider { x: number; z: number; r: number }

export interface World {
  group: THREE.Group;
  name: string;
  mapId: string;
  update(): void;
  colliders: Collider[];
  roadAt(x: number, z: number): boolean;
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
}

export const MAPS: MapDef[] = [
  {
    id: 'coast', name: 'Saltmarsh Coast', roadHalf: 4.4,
    // 28-point lap: start/finish on the long top straight, fast double-apex
    // sweep down the east side, genuine 180° hairpin over the lake, a wide
    // exit corner rolling onto the back run, a quick left-right chicane, and
    // a stadium 180° U-turn up the west side back onto the straight.
    ctrl: [
      [-39.5, 11.9], [-44.6, 17], [-46.5, 24], [-44.6, 31], [-39.5, 36.1],
      [-32.5, 38], [-20.5, 38], [-8.5, 38], [3.5, 38], [15.5, 38], [24, 38],
      [32.5, 36.2], [39.4, 30.8], [44.5, 24.8], [46.9, 16.4], [47.2, 7.7],
      [46.2, -4], [43, -14], [34.5, -20.2], [24, -20.2], [15.5, -14],
      [12.2, -4], [9.8, 5], [3.2, 11.6], [-5.8, 14],
      [-15, 13.7], [-24, 10.6], [-32.5, 10.2]],
    palette: {
      grass: '#4f7c46', tones: ['#5b8c4e', '#3d6636', '#6fa05d', '#33582f', '#7fb367'],
      bladeA: '#8cc274', bladeB: '#356031',
      sand: '#c9bd8b', water: '#2f6f86', waterLt: 'rgba(96,170,186,0.55)',
      shoulder: '#6b6350', asphalt: '#43434b', grainA: '#6a6a76', grainB: '#2b2b33',
      line: 'rgba(232,226,206,0.85)', kerbA: '#d8d2bc', kerbB: '#c8463c',
    },
    lake: { x: 34, z: -37, rx: 11, rz: 8 },
    trees: 'mixed', density: 1,
    props: { trees: 190, rocks: 34, buildings: 15, lampStride: 58, rockScale: 1 },
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
];

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
  return out;
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
  const si = Math.floor(track.length / 3);
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
      if (Math.sqrt(best) < ROAD_HALF) grid[j * dim + i] = 1;
    }
  }
  const roadAt = (x: number, z: number) => {
    const i = gx(x), j = gx(z);
    if (i < 0 || j < 0 || i >= dim || j >= dim) return false;
    return grid[j * dim + i] === 1;
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

  const free = (x: number, z: number, r: number, pad = 2.4) => {
    if (Math.abs(x) > HALF - 2 || Math.abs(z) > HALF - 2) return false;
    if (nearbyRoad(x, z, ROAD_HALF + pad + r)) return false;
    for (const t of taken) if ((t.x - x) ** 2 + (t.z - z) ** 2 < (t.r + r) ** 2) return false;
    return true;
  };

  // town in the infield
  const TOWN: [number, number][] = [
    [-6, -8], [5, -10], [12, -2], [-2, 2], [9, 7], [-10, 6],
    [-4, 14], [6, 16], [-14, -2], [14, 26], [-18, 12], [2, 22],
    [-22, -4], [18, 14], [-8, 26],
  ];
  const buildings: Placement[][] = [[], [], []];
  const town = map.town ?? TOWN;
  const townCount = map.props?.buildings ?? town.length;
  town.slice(0, townCount).forEach(([x, z], i) => {
    const r = 4.2;
    if (!free(x, z, r)) return;
    const rot = Math.round(rnd() * 3) * (Math.PI / 2) + (rnd() - 0.5) * 0.15;
    buildings[i % 3].push({ x, z, rot, scale: 0.9 + rnd() * 0.25 });
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
    addTree(x + (rnd() - 0.5) * 2, z + (rnd() - 0.5) * 2, nearLake && rnd() > 0.55);
  }
  // scattered woodland
  let guard = 0;
  const treeTarget = map.props?.trees ?? Math.round(190 * (map.density ?? 1));
  while (pines.length + palms.length < treeTarget && guard++ < 3000) {
    const x = (rnd() - 0.5) * (WORLD - 8);
    const z = (rnd() - 0.5) * (WORLD - 8);
    addTree(x, z, map.lake ? Math.hypot(x - map.lake.x, z - map.lake.z) < map.lake.rx + 3 && rnd() > 0.6 : false);
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
  const si = Math.floor(track.length / 3);
  const s0 = track[si], s1 = track[(si + 12) % track.length];
  const start = { x: s0.x, z: s0.z, heading: Math.atan2(-(s1.x - s0.x), -(s1.z - s0.z)) };

  return {
    group, colliders, roadAt, nearbyRoad, start, addSkid, clearSkid,
    name: map.name,
    mapId: map.id,
    minimapPath: track.filter((_, i) => i % 4 === 0),
    track,
    update() {
      if (skidDirty) {
        skidTex.needsUpdate = true;
        skidDirty = false;
      }
    },
  };
}
