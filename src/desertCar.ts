// src/desertCar.ts — 1980s desert rally-raid buggy built from the four-view sheet.
// Axes: +Z = forward (nose), +X = right, +Y = up. Ground at y = 0.
// Size: ~4.45 L × 2.02 W × 1.32 H. Shares the GROUP B running gear.
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

// Tall raid hull: raised sill, flat flanks, near-flat deck, short tail.
const BODY: Section[] = [
  S(2.20, 0.22, 0.30, 0.78, 0.48, 0.60, 0.50),
  S(1.90, 0.19, 0.27, 0.90, 0.60, 0.78, 0.62),
  S(1.60, 0.18, 0.26, 0.94, 0.68, 0.86, 0.72),
  S(1.10, 0.18, 0.26, 0.96, 0.70, 0.88, 0.76),
  S(0.60, 0.18, 0.26, 0.97, 0.72, 0.89, 0.78),
  S(0.00, 0.18, 0.26, 0.97, 0.74, 0.90, 0.79),
  S(-0.90, 0.18, 0.26, 0.97, 0.75, 0.90, 0.79),
  S(-1.70, 0.18, 0.26, 0.96, 0.74, 0.88, 0.78),
  S(-2.25, 0.24, 0.32, 0.88, 0.68, 0.80, 0.74),
];

// Greenhouse sunk into the deck: upright screen, long wagon roof tapering to the tail.
const CABIN: Section[] = [
  S(0.92, 0.76, 0.78, 0.80, 0.82, 0.74, 0.80),
  S(0.68, 0.79, 0.81, 0.83, 0.88, 0.68, 1.19),
  S(0.18, 0.81, 0.83, 0.85, 1.08, 0.64, 1.30),
  S(-0.72, 0.81, 0.83, 0.85, 1.08, 0.64, 1.30),
  S(-1.35, 0.81, 0.83, 0.85, 1.08, 0.64, 1.30),
  S(-1.82, 0.80, 0.82, 0.83, 0.98, 0.70, 1.06),
  S(-2.10, 0.78, 0.80, 0.79, 0.84, 0.74, 0.82),
];

const WHEEL_R = 0.35;
const WHEEL_W = 0.29;
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

const SAND = 0xead5a6;
const ORANGE = 0xd4642a;
const WHITE = 0xede6d8;
const INK = 0x15181a;
const GLASS = 0x1f2a2b;
const TYRE = 0x141416;
const GOLD = 0xb8892c;
const AMBER = 0xf2a63a;
const CREAM = 0xf2eee1;

export function buildDesertCar(): THREE.Group {
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
    sand: lam(SAND),
    orange: lam(ORANGE),
    white: lam(WHITE),
    ink: lam(INK),
    glass: lam(GLASS),
    tyre: lam(TYRE),
    gold: lam(GOLD),
    amber: lam(AMBER, { emissive: 0x402000 }),
    lamp: lam(0xf7f2d8, { emissive: 0x1a1204 }),
    band: lam(0xf2eee1),
    dOrange: decal(ORANGE),
    dInk: decal(INK),
    dCream: decal(CREAM),
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

  // ---------- Body shell: sand, black skirt below the raised sill ----------
  const skirt = new Set([0, 1, 7]);
  const body = new THREE.Mesh(loft(BODY, j => (skirt.has(j) ? 1 : 0)), [M.sand, M.ink]);
  body.name = 'body';
  car.add(outline(body, 1.018));

  // ---------- Greenhouse: wrap-around dark glass, white pillars and long roof ----------
  const cabin = new THREE.Mesh(loft(CABIN, () => 0), M.glass);
  cabin.name = 'cabin';
  car.add(outline(cabin, 1.022));

  for (const s of [1, -1] as const) {
    beam(new THREE.Vector3(s * 0.80, 0.74, 0.90), new THREE.Vector3(s * 0.64, 1.24, 0.68), 0.065, M.white); // A-pillar
    beam(new THREE.Vector3(s * 0.64, 1.27, 0.18), new THREE.Vector3(s * 0.64, 1.27, -1.35), 0.055, M.white); // roof rail
    beam(new THREE.Vector3(s * 0.64, 1.27, -1.35), new THREE.Vector3(s * 0.76, 0.80, -2.06), 0.070, M.white); // C-pillar
    box(0.018, 0.024, 2.86, M.dInk, s * 0.842, 0.755, -0.56); // window sill trim
  }
  outline(box(1.24, 0.030, 1.58, M.white, 0, 1.300, -0.585), 1.012); // roof panel
  for (const s of [1, -1] as const) {
    box(0.016, 0.020, 1.60, M.dInk, s * 0.612, 1.296, -0.585); // rain gutter
  }

  // ---------- Bonnet: plain sand, one dark vent (no stripes — desert differs from the garage) ----------
  box(0.44, 0.020, 0.22, M.ink, 0, bodyAt(0.90).yt + 0.012, 0.90); // bonnet vent
  for (const s of [1, -1] as const) {
    box(0.055, 0.016, 0.055, M.ink, s * 0.52, bodyAt(1.68).yt + 0.012, 1.68); // bonnet pin
  }

  // ---------- Flank livery: burnt-orange band, cream pinstripe, rugged details ----------
  for (const s of [1, -1] as const) {
    const band: V2[] = [[1.72, 0.22], [1.72, 0.56], [-1.95, 0.56], [-1.95, 0.22]];
    sidePanel(band, s, 0.958, M.dOrange);
    const stripe: V2[] = [[1.72, 0.565], [1.72, 0.595], [-1.95, 0.595], [-1.95, 0.565]];
    sidePanel(stripe, s, 0.960, M.dCream);
    box(0.012, 0.32, 0.010, M.dInk, s * 0.961, 0.730, 0.42);  // door seam
    box(0.020, 0.030, 0.14, M.ink, s * 0.964, 0.780, 0.05);   // door handle
    box(0.024, 0.06, 0.12, M.ink, s * 0.958, 0.80, 0.80);    // front fender badge
    box(0.05, 0.04, 0.10, M.ink, s * 0.955, 0.86, 0.74);      // mirror stalk
    box(0.14, 0.09, 0.06, M.ink, s * 1.02, 0.885, 0.72);      // mirror head
    box(0.03, 0.04, 0.12, M.amber, s * (bodyAt(1.62).hw + 0.01), 0.36, 1.62); // side marker
    const filler = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.012, 10), M.ink);
    filler.rotation.z = Math.PI / 2;
    filler.position.set(s * 0.958, 0.72, -1.52);
    car.add(filler);
  }

  // ---------- Flares: the car's strongest read — chunky orange arches ----------
  const flare = (zc: number, side: 1 | -1) => {
    const ro = 0.475, ri = 0.400, cy = 0.35, y0 = 0.16;
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
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.065, bevelEnabled: false });
    const m = new THREE.Mesh(geo, M.orange);
    m.rotation.y = (side * Math.PI) / 2;
    m.position.x = side * 0.985;
    car.add(m);
  };

  for (const s of [1, -1] as const) {
    flare(FRONT_Z, s);
    flare(REAR_Z, s);
    for (const z of [FRONT_Z - 0.46, REAR_Z - 0.46]) {
      box(0.26, 0.22, 0.025, M.ink, s * 0.885, 0.17, z); // mudflap
    }
  }

  // ---------- Nose: black tube bumper, two round driving lamps, twin grille slots ----------
  box(1.82, 0.04, 0.18, M.ink, 0, 0.105, 2.12);   // skid plate
  box(1.66, 0.16, 0.10, M.ink, 0, 0.19, 2.13);    // air dam
  box(1.78, 0.13, 0.13, M.ink, 0, 0.37, 2.14);    // tube bumper bar
  box(1.16, 0.18, 0.09, M.ink, 0, 0.56, 2.11);    // lamp pod backing
  for (const s of [1, -1] as const) {
    box(0.12, 0.30, 0.12, M.ink, s * 0.82, 0.44, 2.14);          // bumper stub
    box(0.34, 0.08, 0.07, M.ink, s * 0.27, 0.46, 2.17);           // grille slot
    box(0.10, 0.035, 0.05, M.amber, s * 0.72, 0.375, 2.16);       // indicator
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.04, 14), M.lamp);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(s * 0.30, 0.555, 2.16);
    car.add(lens);
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.014, 4, 14), M.ink);
    bezel.position.set(s * 0.30, 0.555, 2.185);
    car.add(bezel);
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.056, 0.03, 10), M.lamp);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(s * 0.52, 0.50, 2.13);
    car.add(pod);
  }
  box(0.10, 0.055, 0.05, M.orange, -0.62, 0.22, 2.19); // tow hook

  // ---------- Tail: bumper, lights, ducktail, tow step, exhaust ----------
  box(1.74, 0.15, 0.12, M.ink, 0, 0.30, -2.26);   // rear bumper
  box(0.40, 0.10, 0.10, M.ink, 0.42, 0.255, -2.36); // tow step
  box(1.10, 0.08, 0.20, M.ink, 0, 0.115, -2.20);   // under-rider
  for (const s of [1, -1] as const) {
    const tl = box(0.34, 0.12, 0.02, brakeMat, s * 0.50, 0.60, -2.30);
    brakes.push(tl);
    box(0.10, 0.05, 0.02, M.amber, s * 0.28, 0.60, -2.30);
  }
  box(0.30, 0.10, 0.02, M.white, 0, 0.44, -2.31);  // plate
  outline(box(1.34, 0.055, 0.15, M.ink, 0, 0.795, -2.18), 1.05); // ducktail
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.14, 10), M.ink);
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.set(0.54, 0.22, -2.32);
  car.add(exhaust);

  // ---------- Wheels: gold rims, chunky tread, white sidewall band ----------
  const makeWheel = (): THREE.Group => {
    const spin = new THREE.Group();
    const tg = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, WHEEL_W, 16);
    tg.rotateZ(Math.PI / 2);
    spin.add(outline(new THREE.Mesh(tg, M.tyre), 1.018));

    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const tread = new THREE.Mesh(new THREE.BoxGeometry(0.292, 0.06, 0.078), M.ink);
      tread.position.set(0, Math.cos(a) * 0.318, Math.sin(a) * 0.318);
      tread.rotation.x = a;
      spin.add(tread);
    }

    const face = new THREE.Group();
    face.position.x = WHEEL_W / 2 + 0.004;
    spin.add(face);

    const discGeo = new THREE.CylinderGeometry(0.23, 0.23, 0.018, 16);
    discGeo.rotateZ(Math.PI / 2);
    face.add(new THREE.Mesh(discGeo, M.ink));

    const bandGeo = new THREE.TorusGeometry(0.293, 0.016, 4, 18);
    bandGeo.rotateY(Math.PI / 2);
    face.add(new THREE.Mesh(bandGeo, M.band));

    const rimGeo = new THREE.TorusGeometry(0.205, 0.028, 4, 16);
    rimGeo.rotateY(Math.PI / 2);
    face.add(new THREE.Mesh(rimGeo, M.gold));

    for (let i = 0; i < 5; i++) {
      const p = new THREE.Group();
      p.rotation.x = (i * 2 * Math.PI) / 5;
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.185, 0.062), M.gold);
      sp.position.set(0.01, 0.105, 0);
      p.add(sp);
      face.add(p);
    }
    const hubGeo = new THREE.CylinderGeometry(0.062, 0.062, 0.040, 10);
    hubGeo.rotateZ(Math.PI / 2);
    face.add(new THREE.Mesh(hubGeo, M.gold));
    const capGeo = new THREE.CylinderGeometry(0.036, 0.036, 0.030, 8);
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
