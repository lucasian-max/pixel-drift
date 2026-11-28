// src/desertCar.ts — 1980s desert rally-raid buggy built from the four-view sheet.
// Axes: +Z = forward (nose), +X = right, +Y = up. Ground at y = 0.
// Size: ~4.45 L × 2.02 W × 1.44 H. Shares the GROUP B running gear.
import * as THREE from 'three';
import { CarShell, S, bodyAt, type Section, type WheelStyle } from './carKit';

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

// Greenhouse sunk into the deck: raked screen, roof narrowed above the belt, wagon tail.
const CABIN: Section[] = [
  S(0.92, 0.76, 0.78, 0.80, 0.82, 0.74, 0.80),
  S(0.56, 0.79, 0.81, 0.83, 0.90, 0.68, 1.15),
  S(-0.14, 0.81, 0.83, 0.85, 0.98, 0.58, 1.30),
  S(-0.72, 0.81, 0.83, 0.85, 0.98, 0.58, 1.30),
  S(-1.62, 0.81, 0.83, 0.85, 0.98, 0.58, 1.30),
  S(-1.95, 0.80, 0.82, 0.83, 0.99, 0.62, 1.12),
  S(-2.16, 0.78, 0.80, 0.79, 0.86, 0.73, 0.86),
];

// Raid tyre: the widest of the three, twelve blocks, and a white sidewall band.
const WHEEL: WheelStyle = {
  width: 0.29,
  treads: 12,
  treadH: 0.06,
  treadD: 0.078,
  treadR: 0.318,
  discR: 0.23,
  rim: [0.205, 0.028],
  band: [0.293, 0.016],
  spoke: [0.038, 0.185, 0.062],
  spokeAt: [0.01, 0.105],
  hubR: 0.062,
  capR: 0.036,
};

const FRONT_Z = 1.45;
const REAR_Z = -1.5;

const SAND = 0xead5a6;
const ORANGE = 0xe2621f;
const WHITE = 0xede6d8;
const INK = 0x15181a;
const GLASS = 0x1f2a2b;
const TYRE = 0x141416;
const GOLD = 0x8f6510;
const AMBER = 0xf2a63a;
const CREAM = 0xf2eee1;

export function buildDesertCar(): THREE.Group {
  const shell = new CarShell();
  const box = shell.box.bind(shell);
  const beam = shell.beam.bind(shell);
  const outline = shell.outline.bind(shell);
  const at = (z: number) => bodyAt(BODY, z);
  /** proud of whatever half-width the hull has at z, for bolted-on trim */
  const proud = (z: number) => at(z).hw + 0.006;
  const shoulderStrip = (side: 1 | -1, x0: number, x1: number, z0: number, z1: number,
    mat: THREE.Material, lift?: number) => shell.shoulderStrip(BODY, side, x0, x1, z0, z1, mat, lift);

  const M = {
    sand: shell.lam(SAND),
    orange: shell.lam(ORANGE),
    white: shell.lam(WHITE),
    cream: shell.lam(CREAM),
    ink: shell.lam(INK),
    glass: shell.lam(GLASS),
    tyre: shell.lam(TYRE),
    gold: shell.lam(GOLD, { emissive: 0x1c1000 }),
    amber: shell.lam(AMBER, { emissive: 0x402000 }),
    lamp: shell.lam(0xf7f2d8, { emissive: 0x1a1204 }),
    band: shell.lam(0xf2eee1),
    dOrange: shell.decal(ORANGE),
    dInk: shell.decal(INK),
    dCream: shell.decal(CREAM),
  };

  // ---------- Body shell: sand, black skirt below the raised sill ----------
  const body = shell.hull(BODY, [M.sand, M.ink], new Set([0, 1, 7]));
  body.name = 'body';
  shell.car.add(outline(body, 1.018));

  // ---------- Arch openings: a dark well, then the orange eyebrow over it ----------
  // The eyebrow is centred on the wheel, so it has to break the shoulder line by a
  // finger's width: that blister is the raid stance, where the rally car stays flush.
  const WELL = { r: 0.375, cy: 0.350, y0: 0.100 };
  const ARCH = { ro: 0.415, ri: 0.385, cy: 0.350, y0: 0.100, depth: 0.075, x: 0.940 };
  for (const side of [1, -1] as const) {
    shell.archWell(BODY, FRONT_Z, side, WELL, M.dInk);
    shell.archWell(BODY, REAR_Z, side, WELL, M.dInk);
    shell.flare(FRONT_Z, side, { ...ARCH, x: at(FRONT_Z).hw - 0.005 }, M.orange);
    shell.flare(REAR_Z, side, { ...ARCH, x: at(REAR_Z).hw - 0.005 }, M.orange);
    for (const z of [FRONT_Z - 0.46, REAR_Z - 0.46]) {
      box(0.02, 0.26, 0.26, M.ink, side * (proud(z) + 0.014), 0.175, z); // mudflap
    }
  }

  // ---------- Greenhouse: wrap-around dark glass, sand pillars and long roof ----------
  const cabin = shell.hull(CABIN, [M.glass], new Set());
  cabin.name = 'cabin';
  shell.car.add(outline(cabin, 1.022));

  for (const side of [1, -1] as const) {
    // One frame: A post -> rail -> C post, all landing on y 1.30, uniform 0.075 width.
    // Proud of the glass by ~0.03 so the posts read at 360p without going chunky.
    beam(new THREE.Vector3(side * 0.86, 0.86, 0.90), new THREE.Vector3(side * 0.60, 1.30, -0.04), 0.075, M.sand); // A-pillar
    beam(new THREE.Vector3(side * 0.88, 0.86, -0.34), new THREE.Vector3(side * 0.60, 1.30, -0.34), 0.075, M.sand); // B-pillar
    beam(new THREE.Vector3(side * 0.60, 1.30, -0.04), new THREE.Vector3(side * 0.60, 1.30, -1.62), 0.060, M.sand); // roof rail
    beam(new THREE.Vector3(side * 0.60, 1.30, -1.62), new THREE.Vector3(side * 0.88, 0.86, -2.02), 0.075, M.sand); // C-pillar
    box(0.018, 0.024, 2.86, M.dInk, side * 0.842, 0.755, -0.56); // window sill trim
  }
  outline(box(1.12, 0.030, 1.54, M.sand, 0, 1.300, -0.8325), 1.012); // roof panel
  for (const side of [1, -1] as const) {
    box(0.016, 0.020, 1.55, M.dInk, side * 0.552, 1.296, -0.8325); // rain gutter
  }

  // ---------- Roof rack: rails on legs, cross bars, two sand ladders lashed down ----------
  for (const side of [1, -1] as const) {
    box(0.045, 0.045, 1.90, M.ink, side * 0.46, 1.372, -0.86); // rail
    for (const z of [0.06, -0.76, -1.58]) {
      box(0.045, 0.062, 0.045, M.ink, side * 0.46, 1.346, z);  // leg onto the roof panel
    }
  }
  for (const z of [0.10, -0.76, -1.62]) {
    box(0.96, 0.034, 0.048, M.ink, 0, 1.386, z); // cross bar
  }
  for (const side of [1, -1] as const) {
    box(0.19, 0.028, 1.22, M.ink, side * 0.29, 1.412, -0.80); // sand ladder
    for (let i = 0; i < 5; i++) {
      box(0.19, 0.012, 0.028, M.cream, side * 0.29, 1.430, -0.26 - i * 0.26); // ladder rung
    }
  }

  // ---------- Snorkel: raid intake up the outside of the A-pillar ----------
  beam(new THREE.Vector3(0.90, 0.80, 0.74), new THREE.Vector3(0.86, 1.33, 0.18), 0.055, M.ink);
  box(0.076, 0.095, 0.15, M.ink, 0.86, 1.375, 0.14); // intake head

  // ---------- Bonnet: plain sand, one dark vent, pins ----------
  box(0.44, 0.020, 0.22, M.ink, 0, at(0.90).yt + 0.012, 0.90); // bonnet vent
  for (const side of [1, -1] as const) {
    box(0.055, 0.016, 0.055, M.ink, side * 0.52, at(1.68).yt + 0.012, 1.68); // bonnet pin
  }

  // ---------- Flank livery: one orange waist band, cream piping, worked surfaces ----------
  // Deliberately horizontal where the rally car is vertical: the raid car wears its
  // colour as a belt with the arches pulled out of it, not as door blocks.
  for (const side of [1, -1] as const) {
    shell.flankBand(BODY, side, 1.86, -2.12, 0.30, () => 0.560, M.dOrange);
    shell.flankBand(BODY, side, 1.86, -2.12, 0.560, () => 0.600, M.dCream, 0.008);
    box(0.014, 0.016, 2.70, M.dInk, side * (proud(0.0) + 0.010), 0.250, 0.00); // sill line
    box(0.012, 0.40, 0.010, M.dInk, side * (proud(0.0) + 0.002), 0.470, 0.92);  // front door seam
    box(0.012, 0.40, 0.010, M.dInk, side * (proud(0.0) + 0.002), 0.470, -0.46); // rear door seam
    box(0.024, 0.030, 0.15, M.ink, side * (proud(0.0) + 0.006), 0.640, 0.22);   // door handle
    box(0.024, 0.030, 0.15, M.ink, side * (proud(0.0) + 0.006), 0.640, -0.62);
    box(0.024, 0.060, 0.12, M.ink, side * (proud(0.80) + 0.004), 0.800, 0.80);  // front fender badge
    box(0.050, 0.040, 0.10, M.ink, side * 0.960, 0.870, 0.70);                 // mirror stalk
    box(0.140, 0.090, 0.06, M.ink, side * 1.026, 0.895, 0.68);                 // mirror head
    box(0.035, 0.055, 0.22, M.amber, side * (proud(1.50) + 0.004), 0.420, 1.50); // side marker
    const filler = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.012, 10), M.ink);
    filler.rotation.z = Math.PI / 2;
    filler.position.set(side * (proud(-1.52) + 0.004), 0.720, -1.52);
    shell.car.add(filler);
  }
  // Orange over the rear haunch deck, so the belt reads from above as well as the side.
  for (const side of [1, -1] as const) {
    shoulderStrip(side, 0.54, 1.0, -1.12, -2.12, M.dOrange, 0.008);
  }

  // ---------- Nose: black tube bumper, two round driving lamps, twin grille slots ----------
  box(1.82, 0.04, 0.18, M.ink, 0, 0.105, 2.12);   // skid plate
  box(1.66, 0.16, 0.10, M.ink, 0, 0.19, 2.13);    // air dam
  box(1.78, 0.13, 0.13, M.ink, 0, 0.37, 2.14);    // tube bumper bar
  box(1.16, 0.21, 0.09, M.ink, 0, 0.565, 2.11);   // lamp pod backing
  for (const side of [1, -1] as const) {
    box(0.12, 0.30, 0.12, M.ink, side * 0.82, 0.44, 2.14);        // bumper stub
    box(0.34, 0.08, 0.07, M.ink, side * 0.27, 0.46, 2.17);        // grille slot
    box(0.10, 0.035, 0.05, M.amber, side * 0.72, 0.375, 2.16);    // indicator
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.04, 14), M.lamp);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(side * 0.30, 0.555, 2.16);
    shell.car.add(lens);
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.146, 0.016, 4, 14), M.ink);
    bezel.position.set(side * 0.30, 0.555, 2.185);
    shell.car.add(bezel);
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.056, 0.03, 10), M.lamp);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(side * 0.52, 0.50, 2.13);
    shell.car.add(pod);
    const podRim = new THREE.Mesh(new THREE.TorusGeometry(0.063, 0.010, 4, 10), M.ink);
    podRim.position.set(side * 0.52, 0.50, 2.145);
    shell.car.add(podRim);
  }
  box(0.10, 0.055, 0.05, M.orange, -0.62, 0.22, 2.19); // tow hook

  // ---------- Tail: bumper, lights, ducktail, tow step, spare wheel, exhaust ----------
  box(1.74, 0.15, 0.12, M.ink, 0, 0.30, -2.26);   // rear bumper
  box(0.40, 0.10, 0.10, M.ink, 0.42, 0.255, -2.36); // tow step
  box(1.10, 0.08, 0.20, M.ink, 0, 0.115, -2.20);   // under-rider
  for (const side of [1, -1] as const) {
    shell.tailLamp(0.34, 0.12, side * 0.50, 0.60, -2.30);
    box(0.10, 0.05, 0.02, M.amber, side * 0.28, 0.60, -2.30);
  }
  box(0.30, 0.10, 0.02, M.white, 0, 0.44, -2.31);  // plate
  outline(box(1.34, 0.055, 0.16, M.ink, 0, 0.905, -2.19), 1.05); // ducktail
  box(0.06, 0.14, 0.10, M.ink, 0.56, 0.83, -2.18); // ducktail riser
  box(0.06, 0.14, 0.10, M.ink, -0.56, 0.83, -2.18); // ducktail riser

  // Spare wheel bolted to the tailgate: the equipment a raid car is recognised by, and
  // the reason its tail is taller than the other two.
  const spare = shell.wheel(WHEEL, { tyre: M.tyre, ink: M.ink, face: M.gold, band: M.band });
  spare.rotation.y = Math.PI / 2;
  spare.position.set(0, 0.90, -2.32);
  shell.car.add(spare);
  box(0.09, 0.34, 0.07, M.ink, 0, 0.98, -2.22); // spare mount

  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.14, 10), M.ink);
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.set(0.54, 0.22, -2.32);
  shell.car.add(exhaust);

  // ---------- Wheels: gold rims, chunky tread, white sidewall band ----------
  return shell.finish({
    wheel: WHEEL,
    mats: { tyre: M.tyre, ink: M.ink, face: M.gold, band: M.band },
    frontZ: FRONT_Z,
    rearZ: REAR_Z,
  });
}
