// src/rallyCar.ts — 1980s Group B rally coupe built from the four-view sheet.
// Axes: +Z = forward (nose), +X = right, +Y = up. Ground at y = 0.
// Size: ~4.45 L × 2.02 W × 1.30 H. Shares the hero's running gear.
import * as THREE from 'three';

type V2 = [number, number];

interface Section {
  z: number;
  yb: number; // underside height
  yl: number; // top of the lower chamfer
  hw: number; // flank half-width
  ys: number; // shoulder height
  tw: number; // deck half-width
  yt: number; // deck centre height
}

const S = (z: number, yb: number, yl: number, hw: number, ys: number, tw: number, yt: number): Section =>
  ({ z, yb, yl, hw, ys, tw, yt });

// Boxy rally body: flat bonnet, upright screen, squared roof, short boot.
const BODY: Section[] = [
  S(2.15, 0.18, 0.26, 0.80, 0.58, 0.70, 0.60),
  S(1.95, 0.16, 0.24, 0.88, 0.63, 0.78, 0.65),
  S(1.70, 0.15, 0.23, 0.93, 0.68, 0.84, 0.72),
  S(1.20, 0.15, 0.23, 0.95, 0.70, 0.86, 0.78),
  S(0.70, 0.15, 0.23, 0.96, 0.72, 0.88, 0.82),
  S(0.30, 0.15, 0.23, 0.96, 0.74, 0.88, 0.84),
  S(-0.30, 0.15, 0.23, 0.97, 0.74, 0.89, 0.86),
  S(-1.00, 0.15, 0.23, 0.97, 0.74, 0.89, 0.86),
  S(-1.60, 0.15, 0.23, 0.96, 0.74, 0.88, 0.85),
  S(-2.10, 0.18, 0.26, 0.93, 0.72, 0.85, 0.84),
  S(-2.30, 0.22, 0.30, 0.86, 0.70, 0.80, 0.82),
];

// Greenhouse sunk into the deck; the glass is one hull, trimmed with pillars.
const CABIN: Section[] = [
  S(0.62, 0.80, 0.82, 0.80, 0.86, 0.74, 0.90),
  S(0.20, 0.82, 0.84, 0.82, 1.02, 0.62, 1.29),
  S(-0.20, 0.84, 0.86, 0.82, 1.10, 0.62, 1.30),
  S(-0.85, 0.84, 0.86, 0.82, 1.10, 0.62, 1.30),
  S(-1.25, 0.84, 0.86, 0.80, 1.02, 0.66, 1.12),
  S(-1.42, 0.84, 0.86, 0.76, 0.90, 0.70, 0.90),
];

const WHEEL_R = 0.35;
const WHEEL_W = 0.27;
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
        z, yb: l(a.yb, b.yb), yl: l(a.yl, b.yl), hw: l(a.hw, b.hw),
        ys: l(a.ys, b.ys), tw: l(a.tw, b.tw), yt: l(a.yt, b.yt),
      };
    }
  }
  return last;
}

function ring(s: Section): THREE.Vector3[] {
  const hwB = s.hw - 0.04;
  const pts: V2[] = [
    [-hwB, s.yb], [hwB, s.yb], [s.hw, s.yl], [s.hw, s.ys],
    [s.tw, s.yt], [-s.tw, s.yt], [-s.hw, s.ys], [-s.hw, s.yl],
  ];
  return pts.map(([x, y]) => new THREE.Vector3(x, y, s.z));
}

/** Loft sections (ordered +z → -z) into a closed hull; groups per ring edge via matFor(j), caps → 0. */
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

const YELLOW = 0xe8b02c;
const WHITE = 0xf2eee1;
const RED = 0xd03a32;
const INK = 0x15171c;
const GLASS = 0x1b2028;
const TYRE = 0x141416;
const SILVER = 0x9aa2ab;
const AMBER = 0xf0a030;

export function buildRallyCar(): THREE.Group {
  const car = new THREE.Group();
  car.name = 'car';

  const lam = (color: number, extra: THREE.MeshLambertMaterialParameters = {}) =>
    new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
  const decal = (color: number) => lam(color, {
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  const M = {
    white: lam(WHITE),
    yellow: lam(YELLOW),
    red: lam(RED),
    ink: lam(INK),
    glass: lam(GLASS),
    tyre: lam(TYRE),
    silver: lam(SILVER),
    amber: lam(AMBER, { emissive: 0x402000 }),
    lamp: lam(0xf7f2d8, { emissive: 0x1a1204 }),
    chrome: lam(0xc6cbd2),
    dYellow: decal(YELLOW),
    dRed: decal(RED),
    dInk: decal(INK),
  };
  const outlineMat = new THREE.MeshBasicMaterial({ color: 0x050505, side: THREE.BackSide });
  const brakeMat = new THREE.MeshLambertMaterial({ color: 0xd02a2a, emissive: 0x330000 });
  const brakes: THREE.Mesh[] = [];

  /** Inverted-hull outline scaled about the geometry's bbox centre. */
  const outline = (mesh: THREE.Mesh, s = 1.025) => {
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

  /** Flat panel on a flank (normal ±x); points are [z, y] in world space. */
  const sidePanel = (pts: V2[], side: 1 | -1, x: number, mat: THREE.Material) => {
    const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(side > 0 ? -z : z, y)));
    const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat);
    m.rotation.y = (side * Math.PI) / 2;
    m.position.x = side * x;
    car.add(m);
    return m;
  };

  /** Thin strip lying on the deck surface between z0 (front) and z1 (rear). */
  const deckStrip = (x0: number, x1: number, z0: number, z1: number, mat: THREE.Material, lift = 0.008) => {
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

  /** Yellow band that hugs the shoulder from x0 out to the flank. */
  const shoulderStrip = (
    side: 1 | -1, x0: number, x1: number, z0: number, z1: number,
    mat: THREE.Material, lift = 0.006,
  ) => {
    const zs = [z0, ...BODY.map(s => s.z).filter(z => z < z0 && z > z1), z1];
    const rows: THREE.Vector3[][] = [];
    const surfaceY = (s: Section, x: number) => {
      const t = (x - s.tw) / Math.max(0.001, s.hw - s.tw);
      return s.yt + (s.ys - s.yt) * Math.max(0, Math.min(1, t));
    };
    for (const z of zs) {
      const s = bodyAt(z);
      const xa = Math.min(x0, s.hw - 0.008);
      const xm = Math.min(s.tw, s.hw - 0.008);
      const xb = Math.min(x1, s.hw - 0.008);
      // sample the flat deck and the shoulder separately so the band follows the body
      rows.push([xa, xm, xb].map(x => new THREE.Vector3(side * x, surfaceY(s, x) + lift, z)));
    }
    const pos: number[] = [];
    for (let i = 0; i < rows.length - 1; i++) {
      const a = rows[i], b = rows[i + 1];
      for (let k = 0; k < 2; k++) {
        pos.push(a[k].x, a[k].y, a[k].z, a[k + 1].x, a[k + 1].y, a[k + 1].z, b[k].x, b[k].y, b[k].z);
        pos.push(a[k + 1].x, a[k + 1].y, a[k + 1].z, b[k + 1].x, b[k + 1].y, b[k + 1].z, b[k].x, b[k].y, b[k].z);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    car.add(m);
    return m;
  };

  // ---------- Body shell: white, black skirt below the sill ----------
  const skirt = new Set([0, 1, 7]);
  const body = new THREE.Mesh(loft(BODY, j => (skirt.has(j) ? 1 : 0)), [M.white, M.ink]);
  body.name = 'body';
  car.add(outline(body, 1.018));

  // Bold yellow fender tops and rear haunches, as on the sheet.
  for (const s of [1, -1] as const) {
    shoulderStrip(s, 0.58, 0.93, 2.14, 0.98, M.dYellow, 0.020);
    shoulderStrip(s, 0.58, 0.93, -0.98, -2.14, M.dYellow, 0.020);
  }

  // ---------- Greenhouse: wrap-around dark glass, white pillars and roof ----------
  const cabin = new THREE.Mesh(loft(CABIN, () => 0), M.glass);
  cabin.name = 'cabin';
  car.add(outline(cabin, 1.022));

  for (const s of [1, -1] as const) {
    beam(new THREE.Vector3(s * 0.80, 0.80, 0.62), new THREE.Vector3(s * 0.62, 1.28, 0.18), 0.060, M.ink); // A-pillar
    beam(new THREE.Vector3(s * 0.62, 1.28, 0.18), new THREE.Vector3(s * 0.62, 1.28, -0.96), 0.055, M.white); // roof rail
    beam(new THREE.Vector3(s * 0.62, 1.28, -0.96), new THREE.Vector3(s * 0.80, 0.84, -1.40), 0.070, M.white); // C-pillar
    beam(new THREE.Vector3(s * 0.825, 0.80, -0.36), new THREE.Vector3(s * 0.66, 1.27, -0.40), 0.045, M.ink); // B-pillar
    box(0.018, 0.022, 1.86, M.dInk, s * 0.832, 0.795, -0.36); // window sill trim
  }
  outline(box(1.20, 0.030, 1.12, M.white, 0, 1.300, -0.40), 1.012); // roof panel
  // Body-colour roof scoop with a black outline and side vents, as on the sheet.
  outline(box(0.36, 0.075, 0.30, M.white, 0, 1.335, 0.01), 1.04);
  for (const s of [1, -1] as const) {
    box(0.012, 0.032, 0.18, M.ink, s * 0.185, 1.338, 0.02); // vent slot
  }

  const aerial = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.34, 6), M.ink);
  aerial.position.set(-0.46, 1.47, -1.14);
  aerial.rotation.z = -0.14;
  car.add(aerial);

  // ---------- Bonnet / boot livery and vents ----------
  deckStrip(-0.80, 0.80, 0.70, 0.55, M.dRed, 0.010);     // red cowl band
  deckStrip(-0.74, 0.74, -1.06, -1.18, M.dRed, 0.010);   // red boot band

  box(0.40, 0.020, 0.26, M.ink, 0, bodyAt(1.08).yt + 0.012, 1.08); // bonnet vent
  for (let i = 0; i < 3; i++) box(0.30, 0.010, 0.020, M.chrome, 0, bodyAt(1.08).yt + 0.026, 1.00 + i * 0.075);
  for (const s of [1, -1] as const) {
    box(0.055, 0.016, 0.055, M.chrome, s * 0.56, bodyAt(1.82).yt + 0.012, 1.82); // bonnet pin
  }

  // ---------- Flank livery: yellow rocker, black rub strip, red quarter slash ----------
  for (const s of [1, -1] as const) {
    const rocker: V2[] = [[1.62, 0.22], [1.62, 0.52], [-1.72, 0.52], [-1.72, 0.22]];
    sidePanel(rocker, s, 0.966, M.dYellow);
    const sill: V2[] = [[1.62, 0.16], [1.62, 0.22], [-1.72, 0.22], [-1.72, 0.16]];
    sidePanel(sill, s, 0.967, M.dInk);
    const slash: V2[] = [[-0.98, 0.66], [-1.14, 0.66], [-1.34, 0.38], [-1.20, 0.38]];
    sidePanel(slash, s, 0.969, M.dRed);
    box(0.012, 0.016, 2.90, M.dInk, s * 0.970, 0.545, 0.00); // rub strip
    box(0.012, 0.42, 0.010, M.dInk, s * 0.971, 0.510, 0.96); // front door seam
    box(0.012, 0.42, 0.010, M.dInk, s * 0.971, 0.510, -0.58); // rear door seam
    box(0.020, 0.030, 0.14, M.ink, s * 0.974, 0.660, 0.28);  // door handle
    box(0.020, 0.030, 0.14, M.ink, s * 0.974, 0.660, -0.74);
    // mirror on a short stalk
    box(0.05, 0.05, 0.10, M.ink, s * 0.998, 0.820, 0.62);
    box(0.16, 0.10, 0.07, M.ink, s * 1.040, 0.855, 0.60);
    // fuel filler on the rear quarter
    const filler = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.012, 10), M.chrome);
    filler.rotation.z = Math.PI / 2;
    filler.position.set(s * 0.975, 0.640, -1.16);
    car.add(filler);
  }

  // ---------- Flares and wheel arch lips ----------
  const flare = (zc: number, side: 1 | -1) => {
    const ro = 0.460, ri = 0.385, cy = 0.35, y0 = 0.15;
    const pts: V2[] = [[zc + ro, y0], [zc + ro, cy]];
    for (let i = 1; i <= 16; i++) {
      const a = (i / 16) * Math.PI;
      pts.push([zc + ro * Math.cos(a), cy + ro * Math.sin(a)]);
    }
    pts.push([zc - ro, y0], [zc - ri, y0], [zc - ri, cy]);
    for (let i = 16; i >= 1; i--) {
      const a = (i / 16) * Math.PI;
      pts.push([zc + ri * Math.cos(a), cy + ri * Math.sin(a)]);
    }
    pts.push([zc + ri, y0]);

    const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(side > 0 ? -z : z, y)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false });
    const m = new THREE.Mesh(geo, M.yellow);
    m.rotation.y = (side * Math.PI) / 2;
    m.position.x = side * 0.985;
    car.add(m);

  };

  for (const s of [1, -1] as const) {
    flare(FRONT_Z, s);
    flare(REAR_Z, s);
    for (const z of [FRONT_Z - 0.44, REAR_Z - 0.44]) {
      box(0.26, 0.20, 0.025, M.ink, s * 0.885, 0.150, z); // mudflap
    }
  }

  // ---------- Nose: yellow dam, black grille, six-lamp rally pod ----------
  box(1.76, 0.12, 0.16, M.yellow, 0, 0.275, 2.170); // bumper
  box(1.56, 0.14, 0.14, M.yellow, 0, 0.180, 2.190); // air dam
  box(1.84, 0.035, 0.20, M.ink, 0, 0.120, 2.185);   // splitter
  box(1.52, 0.18, 0.08, M.ink, 0, 0.435, 2.175);    // grille band
  box(1.54, 0.22, 0.10, M.ink, 0, 0.585, 2.160);    // lamp pod backing
  box(0.64, 0.10, 0.05, M.ink, 0, 0.205, 2.245);    // centre intake
  for (let i = 0; i < 3; i++) box(0.86, 0.012, 0.02, M.chrome, 0, 0.390 + i * 0.026, 2.218);
  box(0.10, 0.06, 0.05, M.red, -0.62, 0.235, 2.255); // tow hook

  for (const s of [1, -1] as const) {
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.086, 0.086, 0.035, 14), M.lamp);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(s * 0.36, 0.615, 2.222);
    car.add(lens);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.094, 0.012, 4, 14), M.ink);
    ring.position.set(s * 0.36, 0.615, 2.242);
    car.add(ring);
    for (const x of [0.50, 0.17]) {
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.030, 10), M.lamp);
      lens.rotation.x = Math.PI / 2;
      lens.position.set(s * x, 0.500, 2.224);
      car.add(lens);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.059, 0.009, 4, 10), M.ink);
      ring.position.set(s * x, 0.500, 2.242);
      car.add(ring);
    }
    box(0.14, 0.06, 0.04, M.ink, s * 0.620, 0.330, 2.240);   // brake duct
    box(0.10, 0.035, 0.06, M.amber, s * 0.700, 0.395, 2.230); // indicator
  }

  // ---------- Tail: bumper, light bar, wing, exhaust ----------
  box(1.72, 0.16, 0.12, M.yellow, 0, 0.320, -2.340);
  box(1.70, 0.17, 0.06, M.ink, 0, 0.680, -2.315);
  for (const s of [1, -1] as const) {
    const tl = box(0.34, 0.11, 0.02, brakeMat, s * 0.550, 0.680, -2.350);
    brakes.push(tl);
    box(0.10, 0.06, 0.02, M.amber, s * 0.315, 0.665, -2.350);
  }
  box(0.30, 0.10, 0.02, M.white, 0, 0.500, -2.350); // plate
  box(1.10, 0.08, 0.20, M.ink, 0, 0.165, -2.290);   // diffuser

  for (const s of [1, -1] as const) {
    beam(new THREE.Vector3(s * 0.42, 0.840, -2.020), new THREE.Vector3(s * 0.42, 1.200, -2.120), 0.050, M.ink);
    outline(box(0.045, 0.15, 0.28, M.ink, s * 0.800, 1.225, -2.140), 1.05);
  }
  outline(box(1.60, 0.040, 0.26, M.ink, 0, 1.225, -2.140), 1.02);
  box(1.60, 0.030, 0.030, M.ink, 0, 1.230, -2.275); // Gurney flap

  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.14, 10), M.ink);
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.set(0.55, 0.215, -2.350);
  car.add(exhaust);

  // ---------- Wheels ----------
  const makeWheel = (): THREE.Group => {
    const spin = new THREE.Group();
    const tg = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, WHEEL_W, 16);
    tg.rotateZ(Math.PI / 2);
    spin.add(outline(new THREE.Mesh(tg, M.tyre), 1.018));

    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const tread = new THREE.Mesh(new THREE.BoxGeometry(0.272, 0.055, 0.070), M.ink);
      tread.position.set(0, Math.cos(a) * 0.320, Math.sin(a) * 0.320);
      tread.rotation.x = a;
      spin.add(tread);
    }

    const face = new THREE.Group();
    face.position.x = WHEEL_W / 2 + 0.004;
    spin.add(face);

    const discGeo = new THREE.CylinderGeometry(0.225, 0.225, 0.018, 16);
    discGeo.rotateZ(Math.PI / 2);
    face.add(new THREE.Mesh(discGeo, M.ink));

    const rimGeo = new THREE.TorusGeometry(0.200, 0.026, 4, 16);
    rimGeo.rotateY(Math.PI / 2);
    face.add(new THREE.Mesh(rimGeo, M.silver));

    for (let i = 0; i < 5; i++) {
      const p = new THREE.Group();
      p.rotation.x = (i * 2 * Math.PI) / 5;
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.180, 0.058), M.silver);
      sp.position.set(0.010, 0.100, 0);
      p.add(sp);
      face.add(p);
    }
    const hubGeo = new THREE.CylinderGeometry(0.062, 0.062, 0.040, 10);
    hubGeo.rotateZ(Math.PI / 2);
    face.add(new THREE.Mesh(hubGeo, M.silver));
    const capGeo = new THREE.CylinderGeometry(0.038, 0.038, 0.030, 8);
    capGeo.rotateZ(Math.PI / 2);
    const cap = new THREE.Mesh(capGeo, M.ink);
    cap.position.x = 0.024;
    face.add(cap);
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
    spin.name = name;
    mount.add(spin);
    car.add(mount);
    wheels.push(spin);
  }
  car.userData.wheels = wheels;
  car.userData.frontMounts = car.children.filter(c => c.name === 'wheelFLMount' || c.name === 'wheelFRMount');
  car.userData.brakes = brakes;

  car.traverse(o => {
    if ((o as THREE.Mesh).isMesh && !o.userData.isOutline) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  return car;
}
