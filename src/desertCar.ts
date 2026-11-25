// src/desertCar.ts — 1980s desert rally-raid buggy built from the four-view sheet.
// Axes: +Z = forward (nose), +X = right, +Y = up. Ground at y = 0.
// Size: ~4.45 L × 2.02 W × 1.32 H. Shares the GROUP B running gear.
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
  const sidePanel = shell.sidePanel.bind(shell);
  const outline = shell.outline.bind(shell);
  const at = (z: number) => bodyAt(BODY, z);

  const M = {
    sand: shell.lam(SAND),
    orange: shell.lam(ORANGE),
    white: shell.lam(WHITE),
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

  // ---------- Greenhouse: wrap-around dark glass, white pillars and long roof ----------
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

  // ---------- Bonnet: plain sand, one dark vent (no stripes — desert differs from the garage) ----------
  box(0.44, 0.020, 0.22, M.ink, 0, at(0.90).yt + 0.012, 0.90); // bonnet vent
  for (const side of [1, -1] as const) {
    box(0.055, 0.016, 0.055, M.ink, side * 0.52, at(1.68).yt + 0.012, 1.68); // bonnet pin
  }

  // ---------- Flank livery: burnt-orange band, cream pinstripe, rugged details ----------
  for (const side of [1, -1] as const) {
    const band: [number, number][] = [[1.72, 0.44], [1.72, 0.63], [-1.95, 0.63], [-1.95, 0.44]];
    sidePanel(band, side, 0.958, M.dOrange);
    const stripe: [number, number][] = [[1.72, 0.638], [1.72, 0.672], [-1.95, 0.672], [-1.95, 0.638]];
    sidePanel(stripe, side, 0.960, M.dCream);
    box(0.012, 0.32, 0.010, M.dInk, side * 0.961, 0.730, 0.42);  // door seam
    box(0.020, 0.030, 0.14, M.ink, side * 0.964, 0.780, 0.05);   // door handle
    box(0.024, 0.06, 0.12, M.ink, side * 0.958, 0.80, 0.80);     // front fender badge
    box(0.05, 0.04, 0.10, M.ink, side * 0.955, 0.86, 0.74);      // mirror stalk
    box(0.14, 0.09, 0.06, M.ink, side * 1.02, 0.885, 0.72);      // mirror head
    box(0.035, 0.055, 0.22, M.amber, side * 0.965, 0.40, 1.50);  // side marker / louvre
    const filler = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.012, 10), M.ink);
    filler.rotation.z = Math.PI / 2;
    filler.position.set(side * 0.958, 0.72, -1.52);
    shell.car.add(filler);
  }

  // ---------- Flares: the car's strongest read — chunky orange arches ----------
  const ARCH = { ro: 0.50, ri: 0.415, cy: 0.35, y0: 0.10, depth: 0.08, x: 0.985 };
  for (const side of [1, -1] as const) {
    shell.flare(FRONT_Z, side, ARCH, M.orange);
    shell.flare(REAR_Z, side, ARCH, M.orange);
    for (const z of [FRONT_Z - 0.46, REAR_Z - 0.46]) {
      box(0.26, 0.22, 0.025, M.ink, side * 0.885, 0.17, z); // mudflap
    }
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
  }
  box(0.10, 0.055, 0.05, M.orange, -0.62, 0.22, 2.19); // tow hook

  // ---------- Tail: bumper, lights, ducktail, tow step, exhaust ----------
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
