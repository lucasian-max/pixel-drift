// src/rallyCar.ts — 1980s Group B rally coupe built from the four-view sheet.
// Axes: +Z = forward (nose), +X = right, +Y = up. Ground at y = 0.
// Size: ~4.45 L × 2.02 W × 1.30 H. Shares the hero's running gear.
import * as THREE from 'three';
import { CarShell, S, bodyAt, type Section, type WheelStyle } from './carKit';

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

const WHEEL: WheelStyle = {
  width: 0.27,
  treads: 10,
  treadH: 0.055,
  treadD: 0.070,
  treadR: 0.320,
  discR: 0.225,
  rim: [0.200, 0.026],
  spoke: [0.032, 0.180, 0.058],
  spokeAt: [0.010, 0.100],
  hubR: 0.062,
  capR: 0.038,
};

const FRONT_Z = 1.45;
const REAR_Z = -1.5;

const YELLOW = 0xe8b02c;
const WHITE = 0xf2eee1;
const RED = 0xd03a32;
const INK = 0x15171c;
const GLASS = 0x1b2028;
const TYRE = 0x141416;
const SILVER = 0x9aa2ab;
const AMBER = 0xf0a030;

export function buildRallyCar(): THREE.Group {
  const shell = new CarShell();
  const box = shell.box.bind(shell);
  const beam = shell.beam.bind(shell);
  const sidePanel = shell.sidePanel.bind(shell);
  const outline = shell.outline.bind(shell);
  const at = (z: number) => bodyAt(BODY, z);
  const deckStrip = (x0: number, x1: number, z0: number, z1: number, mat: THREE.Material, lift?: number) =>
    shell.deckStrip(BODY, x0, x1, z0, z1, mat, lift);
  const shoulderStrip = (side: 1 | -1, x0: number, x1: number, z0: number, z1: number,
    mat: THREE.Material, lift?: number) => shell.shoulderStrip(BODY, side, x0, x1, z0, z1, mat, lift);

  const M = {
    white: shell.lam(WHITE),
    yellow: shell.lam(YELLOW),
    red: shell.lam(RED),
    ink: shell.lam(INK),
    glass: shell.lam(GLASS),
    tyre: shell.lam(TYRE),
    silver: shell.lam(SILVER),
    amber: shell.lam(AMBER, { emissive: 0x402000 }),
    lamp: shell.lam(0xf7f2d8, { emissive: 0x1a1204 }),
    chrome: shell.lam(0xc6cbd2),
    dYellow: shell.decal(YELLOW),
    dRed: shell.decal(RED),
    dInk: shell.decal(INK),
  };

  // ---------- Body shell: white, black skirt below the sill ----------
  const body = shell.hull(BODY, [M.white, M.ink], new Set([0, 1, 7]));
  body.name = 'body';
  shell.car.add(outline(body, 1.018));

  // Bold yellow fender tops and rear haunches, as on the sheet.
  for (const side of [1, -1] as const) {
    shoulderStrip(side, 0.58, 0.93, 2.14, 0.98, M.dYellow, 0.020);
    shoulderStrip(side, 0.58, 0.93, -0.98, -2.14, M.dYellow, 0.020);
  }

  // ---------- Greenhouse: wrap-around dark glass, white pillars and roof ----------
  const cabin = shell.hull(CABIN, [M.glass], new Set());
  cabin.name = 'cabin';
  shell.car.add(outline(cabin, 1.022));

  for (const side of [1, -1] as const) {
    beam(new THREE.Vector3(side * 0.80, 0.80, 0.62), new THREE.Vector3(side * 0.62, 1.28, 0.18), 0.060, M.ink); // A-pillar
    beam(new THREE.Vector3(side * 0.62, 1.28, 0.18), new THREE.Vector3(side * 0.62, 1.28, -0.96), 0.055, M.white); // roof rail
    beam(new THREE.Vector3(side * 0.62, 1.28, -0.96), new THREE.Vector3(side * 0.80, 0.84, -1.40), 0.070, M.white); // C-pillar
    beam(new THREE.Vector3(side * 0.825, 0.80, -0.36), new THREE.Vector3(side * 0.66, 1.27, -0.40), 0.045, M.ink); // B-pillar
    box(0.018, 0.022, 1.86, M.dInk, side * 0.832, 0.795, -0.36); // window sill trim
  }
  outline(box(1.20, 0.030, 1.12, M.white, 0, 1.300, -0.40), 1.012); // roof panel
  // Body-colour roof scoop with a black outline and side vents, as on the sheet.
  outline(box(0.36, 0.075, 0.30, M.white, 0, 1.335, 0.01), 1.04);
  for (const side of [1, -1] as const) {
    box(0.012, 0.032, 0.18, M.ink, side * 0.185, 1.338, 0.02); // vent slot
  }

  const aerial = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.34, 6), M.ink);
  aerial.position.set(-0.46, 1.47, -1.14);
  aerial.rotation.z = -0.14;
  shell.car.add(aerial);

  // ---------- Bonnet / boot livery and vents ----------
  deckStrip(-0.80, 0.80, 0.70, 0.55, M.dRed, 0.010);     // red cowl band
  deckStrip(-0.74, 0.74, -1.06, -1.18, M.dRed, 0.010);   // red boot band

  box(0.40, 0.020, 0.26, M.ink, 0, at(1.08).yt + 0.012, 1.08); // bonnet vent
  for (let i = 0; i < 3; i++) box(0.30, 0.010, 0.020, M.chrome, 0, at(1.08).yt + 0.026, 1.00 + i * 0.075);
  for (const side of [1, -1] as const) {
    box(0.055, 0.016, 0.055, M.chrome, side * 0.56, at(1.82).yt + 0.012, 1.82); // bonnet pin
  }

  // ---------- Flank livery: yellow rocker, black rub strip, red quarter slash ----------
  for (const side of [1, -1] as const) {
    const rocker: [number, number][] = [[1.62, 0.22], [1.62, 0.52], [-1.72, 0.52], [-1.72, 0.22]];
    sidePanel(rocker, side, 0.966, M.dYellow);
    const sill: [number, number][] = [[1.62, 0.16], [1.62, 0.22], [-1.72, 0.22], [-1.72, 0.16]];
    sidePanel(sill, side, 0.967, M.dInk);
    const slash: [number, number][] = [[-0.98, 0.66], [-1.14, 0.66], [-1.34, 0.38], [-1.20, 0.38]];
    sidePanel(slash, side, 0.969, M.dRed);
    box(0.012, 0.016, 2.90, M.dInk, side * 0.970, 0.545, 0.00); // rub strip
    box(0.012, 0.42, 0.010, M.dInk, side * 0.971, 0.510, 0.96); // front door seam
    box(0.012, 0.42, 0.010, M.dInk, side * 0.971, 0.510, -0.58); // rear door seam
    box(0.020, 0.030, 0.14, M.ink, side * 0.974, 0.660, 0.28);  // door handle
    box(0.020, 0.030, 0.14, M.ink, side * 0.974, 0.660, -0.74);
    // mirror on a short stalk
    box(0.05, 0.05, 0.10, M.ink, side * 0.998, 0.820, 0.62);
    box(0.16, 0.10, 0.07, M.ink, side * 1.040, 0.855, 0.60);
    // fuel filler on the rear quarter
    const filler = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.012, 10), M.chrome);
    filler.rotation.z = Math.PI / 2;
    filler.position.set(side * 0.975, 0.640, -1.16);
    shell.car.add(filler);
  }

  // ---------- Flares and wheel arch lips ----------
  const ARCH = { ro: 0.460, ri: 0.385, cy: 0.35, y0: 0.15, depth: 0.06, x: 0.985 };
  for (const side of [1, -1] as const) {
    shell.flare(FRONT_Z, side, ARCH, M.yellow);
    shell.flare(REAR_Z, side, ARCH, M.yellow);
    for (const z of [FRONT_Z - 0.44, REAR_Z - 0.44]) {
      box(0.26, 0.20, 0.025, M.ink, side * 0.885, 0.150, z); // mudflap
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

  for (const side of [1, -1] as const) {
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.086, 0.086, 0.035, 14), M.lamp);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(side * 0.36, 0.615, 2.222);
    shell.car.add(lens);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.094, 0.012, 4, 14), M.ink);
    ring.position.set(side * 0.36, 0.615, 2.242);
    shell.car.add(ring);
    for (const x of [0.50, 0.17]) {
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.030, 10), M.lamp);
      pod.rotation.x = Math.PI / 2;
      pod.position.set(side * x, 0.500, 2.224);
      shell.car.add(pod);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.059, 0.009, 4, 10), M.ink);
      rim.position.set(side * x, 0.500, 2.242);
      shell.car.add(rim);
    }
    box(0.14, 0.06, 0.04, M.ink, side * 0.620, 0.330, 2.240);   // brake duct
    box(0.10, 0.035, 0.06, M.amber, side * 0.700, 0.395, 2.230); // indicator
  }

  // ---------- Tail: bumper, light bar, wing, exhaust ----------
  box(1.72, 0.16, 0.12, M.yellow, 0, 0.320, -2.340);
  box(1.70, 0.17, 0.06, M.ink, 0, 0.680, -2.315);
  for (const side of [1, -1] as const) {
    shell.tailLamp(0.34, 0.11, side * 0.550, 0.680, -2.350);
    box(0.10, 0.06, 0.02, M.amber, side * 0.315, 0.665, -2.350);
  }
  box(0.30, 0.10, 0.02, M.white, 0, 0.500, -2.350); // plate
  box(1.10, 0.08, 0.20, M.ink, 0, 0.165, -2.290);   // diffuser

  for (const side of [1, -1] as const) {
    beam(new THREE.Vector3(side * 0.42, 0.840, -2.020), new THREE.Vector3(side * 0.42, 1.200, -2.120), 0.050, M.ink);
    outline(box(0.045, 0.15, 0.28, M.ink, side * 0.800, 1.225, -2.140), 1.05);
  }
  outline(box(1.60, 0.040, 0.26, M.ink, 0, 1.225, -2.140), 1.02);
  box(1.60, 0.030, 0.030, M.ink, 0, 1.230, -2.275); // Gurney flap

  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.14, 10), M.ink);
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.set(0.55, 0.215, -2.350);
  shell.car.add(exhaust);

  // ---------- Wheels: silver rims, ten tread blocks ----------
  return shell.finish({
    wheel: WHEEL,
    mats: { tyre: M.tyre, ink: M.ink, face: M.silver },
    frontZ: FRONT_Z,
    rearZ: REAR_Z,
  });
}
