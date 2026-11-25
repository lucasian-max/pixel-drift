// src/carModel.ts — 1980s cream wedge supercar (Three.js r187, no textures)
// Axes: +Z = forward (nose), +X = right, +Y = up. Ground at y = 0.
// Size: ~4.6 L × 2.05 W × 0.95 H.
import * as THREE from 'three';
import { buildRallyCar } from './rallyCar';

type V2 = [number, number];

interface Section {
  z: number;
  yb: number;  // underside height
  hwB: number; // underside half-width
  yl: number;  // top of skirt chamfer
  hw: number;  // flank half-width
  ys: number;  // shoulder height
  tw: number;  // deck half-width
  yt: number;  // deck centre height
}

const S = (z: number, yb: number, yl: number, hw: number, ys: number, tw: number, yt: number): Section =>
  ({ z, yb, hwB: hw - 0.1, yl, hw, ys, tw, yt });

// Body stations, nose → tail. Low pointed nose, raised front fenders, flat mid, short deck.
const BODY: Section[] = [
  S(2.30, 0.20, 0.26, 0.66, 0.32, 0.50, 0.34),
  S(1.95, 0.17, 0.24, 0.86, 0.50, 0.66, 0.48),
  S(1.45, 0.15, 0.22, 0.95, 0.68, 0.74, 0.60),
  S(0.95, 0.15, 0.22, 0.97, 0.66, 0.78, 0.63),
  S(0.50, 0.15, 0.22, 0.98, 0.64, 0.80, 0.66),
  S(-0.90, 0.15, 0.22, 0.98, 0.66, 0.80, 0.70),
  S(-1.50, 0.15, 0.22, 0.98, 0.70, 0.82, 0.71),
  S(-1.95, 0.17, 0.24, 0.97, 0.70, 0.84, 0.72),
  S(-2.30, 0.22, 0.28, 0.93, 0.66, 0.82, 0.70),
];

// Greenhouse stations (sunk into the deck).
const CABIN: Section[] = [
  S(0.66, 0.58, 0.60, 0.80, 0.64, 0.72, 0.655),
  S(-0.25, 0.60, 0.62, 0.82, 0.71, 0.58, 0.93),
  S(-0.95, 0.62, 0.64, 0.82, 0.72, 0.58, 0.93),
  S(-1.35, 0.64, 0.66, 0.78, 0.70, 0.62, 0.74),
];

const WHEEL_R = 0.33;
const WHEEL_W = 0.26;
const WHEEL_X = 1.025 - WHEEL_W / 2;
const FRONT_Z = 1.45;
const REAR_Z = -1.5;

function bodyAt(z: number): Section {
  if (z >= BODY[0].z) return BODY[0];
  const last = BODY[BODY.length - 1];
  if (z <= last.z) return last;
  for (let i = 0; i < BODY.length - 1; i++) {
    const a = BODY[i], b = BODY[i + 1];
    if (z <= a.z && z >= b.z) {
      const t = (a.z - z) / (a.z - b.z);
      const l = (p: number, q: number) => p + (q - p) * t;
      return {
        z, yb: l(a.yb, b.yb), hwB: l(a.hwB, b.hwB), yl: l(a.yl, b.yl), hw: l(a.hw, b.hw),
        ys: l(a.ys, b.ys), tw: l(a.tw, b.tw), yt: l(a.yt, b.yt),
      };
    }
  }
  return last;
}

function ring(s: Section): THREE.Vector3[] {
  const pts: V2[] = [
    [-s.hwB, s.yb], [s.hwB, s.yb], [s.hw, s.yl], [s.hw, s.ys],
    [s.tw, s.yt], [-s.tw, s.yt], [-s.hw, s.ys], [-s.hw, s.yl],
  ];
  return pts.map(([x, y]) => new THREE.Vector3(x, y, s.z));
}

/** Lofts sections (ordered +z → -z) into a closed hull. Groups: per ring-edge j via matFor(j), caps → 0. */
function loft(secs: Section[], matFor: (j: number) => number): THREE.BufferGeometry {
  const rings = secs.map(ring);
  const n = 8;
  const pos: number[] = [];
  const g = new THREE.BufferGeometry();
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) =>
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);

  for (let j = 0; j < n; j++) {
    const start = pos.length / 3;
    const j1 = (j + 1) % n;
    for (let i = 0; i < rings.length - 1; i++) {
      const a = rings[i], b = rings[i + 1];
      tri(a[j], b[j], b[j1]);
      tri(a[j], b[j1], a[j1]);
    }
    g.addGroup(start, pos.length / 3 - start, matFor(j));
  }
  const capStart = pos.length / 3;
  const f = rings[0], r = rings[rings.length - 1];
  for (let k = 1; k < n - 1; k++) {
    tri(f[0], f[k], f[k + 1]);
    tri(r[0], r[k + 1], r[k]);
  }
  g.addGroup(capStart, pos.length / 3 - capStart, 0);

  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

const PALETTES = [
  { body: 0xf1e4bc, a: 0x1fa59a, b: 0xc2287e },
];

// one extra slot for the sheet-built rally car
const RALLY_VARIANT = PALETTES.length;
export const CAR_VARIANTS = PALETTES.length + 1;
export const CAR_NAMES = ['PEARL GT', 'GROUP B'];

export function buildCarModel(variant = 0): THREE.Group {
  if (variant === RALLY_VARIANT) return buildRallyCar();
  const pal = PALETTES[((variant % PALETTES.length) + PALETTES.length) % PALETTES.length];
  const car = new THREE.Group();
  car.name = 'car';

  const lam = (color: number, extra: THREE.MeshLambertMaterialParameters = {}) =>
    new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });

  const M = {
    cream: lam(pal.body),
    dark: lam(0x17191f),
    glass: lam(0x141821),
    well: lam(0x0c0d10),
    tyre: lam(0x141414),
    gold: lam(0xc49a2c),
    red: lam(0xd02a2a, { emissive: 0x550000 }),
    amber: lam(0xf0a030, { emissive: 0x402000 }),
    teal: lam(pal.a, { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    magenta: lam(pal.b, { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    arch: lam(0x0c0d10, { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
  };
  const outlineMat = new THREE.MeshBasicMaterial({ color: 0x050505, side: THREE.BackSide });
  const brakeMat = new THREE.MeshLambertMaterial({ color: 0xd02a2a, emissive: 0x330000 });
  const brakes: THREE.Mesh[] = [];

  /** Inverted-hull outline scaled about the geometry's bbox centre. */
  const outline = (mesh: THREE.Mesh, s = 1.03) => {
    const geo = mesh.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const c = geo.boundingBox!.getCenter(new THREE.Vector3());
    const o = new THREE.Mesh(geo, outlineMat);
    o.scale.setScalar(s);
    o.position.copy(c).multiplyScalar(1 - s);
    o.raycast = () => {};
    o.castShadow = false;
    o.userData.isOutline = true;
    mesh.add(o);
    return mesh;
  };

  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    car.add(m);
    return m;
  };

  const beam = (a: THREE.Vector3, b: THREE.Vector3, t: number, mat: THREE.Material) => {
    const d = new THREE.Vector3().subVectors(b, a);
    const m = new THREE.Mesh(new THREE.BoxGeometry(t, d.length(), t), mat);
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    car.add(m);
    return m;
  };

  /** Flat panel on a flank (normal ±x), points given as [z, y]. */
  const sidePanel = (pts: V2[], side: 1 | -1, x: number, mat: THREE.Material) => {
    const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(side > 0 ? -z : z, y)));
    const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat);
    m.rotation.y = side * Math.PI / 2;
    m.position.x = side * x;
    car.add(m);
    return m;
  };

  /** Thin strip lying on the deck surface between z0 (front) and z1 (rear). */
  const deckStrip = (x0: number, x1: number, z0: number, z1: number, mat: THREE.Material, lift = 0.006) => {
    const zs = [z0, ...BODY.map(s => s.z).filter(z => z < z0 && z > z1), z1];
    const pos: number[] = [];
    for (let i = 0; i < zs.length - 1; i++) {
      const za = zs[i], zb = zs[i + 1];
      const ya = bodyAt(za).yt + lift, yb = bodyAt(zb).yt + lift;
      pos.push(x0, ya, za, x1, yb, zb, x0, yb, zb);
      pos.push(x0, ya, za, x1, ya, za, x1, yb, zb);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    car.add(m);
    return m;
  };

  // ---------- Body (cream, black skirt on underside + lower chamfers) ----------
  const skirtEdges = new Set([0, 1, 7]);
  const body = new THREE.Mesh(loft(BODY, j => (skirtEdges.has(j) ? 1 : 0)), [M.cream, M.dark]);
  body.name = 'body';
  car.add(outline(body));

  // ---------- Greenhouse: black glass + cream A-pillars, roof, rails, C-pillars ----------
  const cabin = new THREE.Mesh(loft(CABIN, () => 0), M.glass);
  cabin.name = 'cabin';
  car.add(outline(cabin, 1.025));

  for (const s of [1, -1] as const) {
    beam(new THREE.Vector3(s * 0.73, 0.655, 0.64), new THREE.Vector3(s * 0.59, 0.935, -0.25), 0.05, M.cream); // A-pillar
    beam(new THREE.Vector3(s * 0.59, 0.935, -0.25), new THREE.Vector3(s * 0.59, 0.935, -0.95), 0.04, M.cream); // roof rail
    beam(new THREE.Vector3(s * 0.59, 0.935, -0.95), new THREE.Vector3(s * 0.66, 0.74, -1.35), 0.05, M.cream); // C-pillar
  }
  box(1.12, 0.015, 0.68, M.cream, 0, 0.938, -0.6); // roof panel

  // ---------- Engine-lid vents ----------
  box(1.04, 0.03, 0.6, M.dark, 0, 0.725, -1.72);
  for (let i = 0; i < 6; i++) box(0.98, 0.025, 0.04, M.cream, 0, 0.745, -1.48 - i * 0.095);
  box(0.06, 0.03, 0.6, M.cream, 0, 0.745, -1.72);

  // ---------- Bonnet twin stripes ----------
  deckStrip(-0.11, -0.04, 2.2, 0.62, M.teal);
  deckStrip(0.04, 0.11, 2.2, 0.62, M.magenta);

  // ---------- Flank band (teal, magenta beneath) + wheel wells + markers ----------
  const teal: V2[] = [[0.4, 0.34], [-0.45, 0.34], [-0.85, 0.62], [-0.67, 0.62], [-0.36, 0.42], [0.4, 0.42]];
  const mag: V2[] = [[0.4, 0.26], [-0.55, 0.26], [-1.02, 0.62], [-0.85, 0.62], [-0.45, 0.34], [0.4, 0.34]];

  const archPts = (zc: number): V2[] => {
    const r = WHEEL_R + 0.05;
    const cap = bodyAt(zc).ys - 0.03;
    const pts: V2[] = [];
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI;
      pts.push([zc + r * Math.cos(a), Math.min(WHEEL_R + r * Math.sin(a), cap)]);
    }
    pts.push([zc - r, WHEEL_R - 0.05], [zc + r, WHEEL_R - 0.05]);
    return pts;
  };

  for (const s of [1, -1] as const) {
    sidePanel(teal, s, 0.98 + 0.006, M.teal);
    sidePanel(mag, s, 0.98 + 0.006, M.magenta);
    box(0.02, 0.04, 0.12, M.amber, s * (bodyAt(1.75).hw + 0.005), 0.36, 1.75); // side marker
  }

  // ---------- Nose ----------
  box(1.3, 0.05, 0.16, M.dark, 0, 0.16, 2.26);   // black splitter lip
  box(0.7, 0.04, 0.05, M.dark, 0, 0.24, 2.29);  // slim intake slot
  for (const s of [1, -1]) {
    const l = box(0.18, 0.03, 0.08, M.amber, s * 0.4, 0.43, 2.1);
    l.rotation.x = 0.38;
    box(0.30, 0.075, 0.03, M.dark, s * 0.50, 0.280, 2.305);  // headlight housing
    box(0.24, 0.050, 0.02, M.cream, s * 0.50, 0.280, 2.320); // headlight lens
  }

  // ---------- Tail: black bar, red lights, diffuser ----------
  box(1.72, 0.15, 0.04, M.dark, 0, 0.52, -2.31);
  for (const s of [1, -1]) {
    const tl = box(0.42, 0.07, 0.02, brakeMat, s * 0.55, 0.53, -2.335);
    brakes.push(tl);
  }
  outline(box(1.5, 0.1, 0.3, M.dark, 0, 0.17, -2.2));
  for (let i = 0; i < 4; i++) box(0.02, 0.12, 0.28, M.dark, -0.45 + i * 0.3, 0.12, -2.22);

  // ---------- Wing: blade on two slim vertical plates ----------
  for (const s of [1, -1]) {
    outline(box(0.04, 0.24, 0.26, M.dark, s * 0.78, 0.81, -2.17));
    outline(box(0.04, 0.14, 0.42, M.dark, s * 0.99, 0.9, -2.15)); // blade endplate
  }
  const blade = box(1.98, 0.045, 0.4, M.dark, 0, 0.93, -2.15);
  blade.name = 'wing';
  outline(blade);

  // ---------- Wheels ----------
  const makeWheel = (): THREE.Group => {
    const spin = new THREE.Group();
    const tg = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, WHEEL_W, 14);
    tg.rotateZ(Math.PI / 2);
    spin.add(outline(new THREE.Mesh(tg, M.tyre)));

    const face = new THREE.Group();
    face.position.x = WHEEL_W / 2 + 0.004;
    spin.add(face);

    const disc = new THREE.CylinderGeometry(0.25, 0.25, 0.02, 14);
    disc.rotateZ(Math.PI / 2);
    face.add(new THREE.Mesh(disc, M.well));

    const rimGeo = new THREE.TorusGeometry(0.22, 0.03, 4, 14);
    rimGeo.rotateY(Math.PI / 2);
    face.add(new THREE.Mesh(rimGeo, M.gold));

    for (let i = 0; i < 5; i++) {
      const p = new THREE.Group();
      p.rotation.x = (i * 2 * Math.PI) / 5;
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.06), M.gold);
      sp.position.set(0.01, 0.11, 0);
      p.add(sp);
      face.add(p);
    }
    const hub = new THREE.CylinderGeometry(0.075, 0.075, 0.04, 10);
    hub.rotateZ(Math.PI / 2);
    face.add(new THREE.Mesh(hub, M.gold));
    const cap = new THREE.CylinderGeometry(0.045, 0.045, 0.03, 8);
    cap.rotateZ(Math.PI / 2);
    const capM = new THREE.Mesh(cap, M.well);
    capM.position.x = 0.025;
    face.add(capM);
    return spin;
  };

  const wheels: THREE.Group[] = [];
  const wheelDefs: [string, number, number][] = [
    ['wheelFL', -1, FRONT_Z], ['wheelFR', 1, FRONT_Z],
    ['wheelRL', -1, REAR_Z], ['wheelRR', 1, REAR_Z],
  ];
  for (const [name, side, z] of wheelDefs) {
    const mount = new THREE.Group();
    mount.name = name + 'Mount';
    mount.position.set(side * WHEEL_X, WHEEL_R, z);
    if (side < 0) mount.rotation.y = Math.PI;
    const spin = makeWheel();
    spin.name = name; // rotate spin.rotation.x to roll
    mount.add(spin);
    car.add(mount);
    wheels.push(spin);
  }
  car.userData.wheels = wheels;
  car.userData.frontMounts = car.children.filter((c) => c.name === 'wheelFLMount' || c.name === 'wheelFRMount');
  car.userData.brakes = brakes;

  car.traverse(o => {
    if ((o as THREE.Mesh).isMesh && !o.userData.isOutline) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  return car;
}
