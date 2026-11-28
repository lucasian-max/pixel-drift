// src/rallyCar.ts — 1980s Group B rally coupe built from the four-view sheet.
// Axes: +Z = forward (nose), +X = right, +Y = up. Ground at y = 0.
// Size: ~4.45 L × 2.02 W × 1.36 H. Shares the hero's running gear.
import * as THREE from 'three';
import { CarShell, S, bodyAt, type Section, type WheelStyle } from './carKit';

// Boxy rally body: low blunt nose, flat bonnet, upright screen, squared roof, short boot.
const BODY: Section[] = [
  S(2.15, 0.20, 0.30, 0.76, 0.52, 0.66, 0.54),
  S(1.95, 0.16, 0.24, 0.88, 0.62, 0.78, 0.64),
  S(1.70, 0.15, 0.23, 0.93, 0.68, 0.84, 0.72),
  S(1.20, 0.15, 0.23, 0.95, 0.71, 0.86, 0.78),
  S(0.70, 0.15, 0.23, 0.96, 0.73, 0.88, 0.81),
  S(0.30, 0.15, 0.23, 0.96, 0.74, 0.88, 0.82),
  S(-0.30, 0.15, 0.23, 0.97, 0.75, 0.89, 0.84),
  S(-1.00, 0.15, 0.23, 0.97, 0.76, 0.89, 0.85),
  S(-1.60, 0.15, 0.23, 0.96, 0.76, 0.88, 0.85),
  S(-2.10, 0.18, 0.26, 0.93, 0.74, 0.85, 0.84),
  S(-2.30, 0.22, 0.30, 0.86, 0.70, 0.80, 0.82),
];

// Tall greenhouse: a rally car is a box on wheels, not a wedge, so the roof band sits
// a hand above the shoulder. The glass stops short of the roof slab, which lets the
// dark roof read as one band from above and the glass as one dark band from the side.
const CABIN: Section[] = [
  S(0.76, 0.78, 0.80, 0.84, 0.88, 0.76, 0.90),
  S(0.30, 0.80, 0.82, 0.86, 1.06, 0.66, 1.20),
  S(-0.20, 0.82, 0.84, 0.86, 1.12, 0.66, 1.26),
  S(-0.95, 0.82, 0.84, 0.86, 1.12, 0.66, 1.26),
  S(-1.28, 0.82, 0.84, 0.84, 1.06, 0.68, 1.14),
  S(-1.46, 0.82, 0.84, 0.78, 0.92, 0.72, 0.90),
];

// Gravel tyre: wide, tall sidewall, eight big blocks cut across the tread.
const WHEEL: WheelStyle = {
  width: 0.28,
  treads: 8,
  treadH: 0.062,
  treadD: 0.082,
  treadR: 0.318,
  discR: 0.235,
  rim: [0.208, 0.030],
  spoke: [0.038, 0.190, 0.062],
  spokeAt: [0.010, 0.100],
  hubR: 0.064,
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
const SILVER = 0xa8b0b9;
const AMBER = 0xf0a030;

export function buildRallyCar(): THREE.Group {
  const shell = new CarShell();
  const box = shell.box.bind(shell);
  const beam = shell.beam.bind(shell);
  const outline = shell.outline.bind(shell);
  const at = (z: number) => bodyAt(BODY, z);
  /** proud of whatever half-width the hull has at z, for bolted-on trim */
  const proud = (z: number) => at(z).hw + 0.006;
  const deckStrip = (x0: number, x1: number, z0: number, z1: number, mat: THREE.Material, lift?: number) =>
    shell.deckStrip(BODY, x0, x1, z0, z1, mat, lift);
  const shoulderStrip = (side: 1 | -1, x0: number, x1: number, z0: number, z1: number,
    mat: THREE.Material, lift?: number) => shell.shoulderStrip(BODY, side, x0, x1, z0, z1, mat, lift);
  const flank = (pts: [number, number][], side: 1 | -1, mat: THREE.Material, lift?: number) =>
    shell.flankPanel(BODY, pts, side, mat, lift);
  /** top of the paintable flank at z: the shoulder corner, so paint meets the deck edge */
  const bandTop = (z: number) => at(z).ys + 0.010;
  const archive = (z: number) => at(z).hw - 0.005;

  const M = {
    white: shell.lam(WHITE),
    yellow: shell.lam(YELLOW),
    red: shell.lam(RED),
    ink: shell.lam(INK),
    glass: shell.lam(GLASS),
    tyre: shell.lam(TYRE),
    silver: shell.lam(SILVER),
    amber: shell.lam(AMBER, { emissive: 0x402000 }),
    lamp: shell.lam(0xfff6d8, { emissive: 0x2a2008 }),
    chrome: shell.lam(0xc6cbd2),
    dWhite: shell.decal(WHITE),
    dYellow: shell.decal(YELLOW),
    dRed: shell.decal(RED),
    dInk: shell.decal(INK),
  };

  // ---------- Body shell: white, black skirt below the sill ----------
  const body = shell.hull(BODY, [M.white, M.ink], new Set([0, 1, 7]));
  body.name = 'body';
  shell.car.add(outline(body, 1.018));

  // Yellow wing tops, wrapped onto the deck: the boldest colour block on the sheet, so
  // it leads. It runs out to the shoulder on the wings and stops dead at the door lines,
  // which is where the black slab takes over.
  for (const side of [1, -1] as const) {
    shoulderStrip(side, 0.60, 1.0, 2.15, 0.58, M.dYellow, 0.008);
    shoulderStrip(side, 0.00, 1.0, 0.58, -0.62, M.dInk, 0.008);
    shoulderStrip(side, 0.00, 1.0, -0.58, -2.24, M.dYellow, 0.008);
  }

  // ---------- Arch openings: a dark well, then the yellow eyebrow over it ----------
  const WELL = { r: 0.400, cy: 0.340, y0: 0.140 };
  const ARCH = { ro: 0.450, ri: 0.395, cy: 0.340, y0: 0.130, depth: 0.070, x: 0.950 };
  for (const side of [1, -1] as const) {
    shell.archWell(BODY, FRONT_Z, side, WELL, M.dInk);
    shell.archWell(BODY, REAR_Z, side, WELL, M.dInk);
    shell.flare(FRONT_Z, side, { ...ARCH, x: archive(FRONT_Z) }, M.yellow);
    shell.flare(REAR_Z, side, { ...ARCH, x: archive(REAR_Z) }, M.yellow);
    for (const z of [FRONT_Z - 0.52, REAR_Z - 0.52]) {
      box(0.02, 0.24, 0.26, M.ink, side * (proud(z) + 0.014), 0.160, z); // mudflap
    }
  }

  // ---------- Greenhouse: dark glass in a yellow frame ----------
  // The crown is painted by the hull itself rather than by a slab laid on top of it, so
  // there is no step between glass and roof, and the roof edge stays a clean line at
  // 640×360. The crown is ink, not yellow: the roof is the one surface the garage's
  // overhead camera sees of the canopy, and a yellow slab there reads as a yellow
  // windscreen. The dark roof reads as one band from above and the glass as one dark
  // band from the side; the rally identity up top is carried by the parts bolted to
  // the roof — the lamp pod and the vent — not by painting the canopy out.
  const cabAt = (z: number) => bodyAt(CABIN, z);
  const cabin = shell.hull(CABIN, [M.glass, M.ink], new Set([4]));
  cabin.name = 'cabin';
  shell.car.add(outline(cabin, 1.022));

  for (const side of [1, -1] as const) {
    // Pillars run from the section table, not from round numbers: every end point lands
    // on the hull edge it belongs to, so no pillar hangs off the surface into the air.
    const aBase = cabAt(0.735), aTop = cabAt(0.270);
    beam(new THREE.Vector3(side * (aBase.hw + 0.004), at(0.780).yt + 0.006, 0.780),
      new THREE.Vector3(side * (aTop.tw + 0.010), aTop.yt - 0.014, 0.270), 0.050, M.yellow); // A-pillar

    // B-pillar stands straight up the flank and stops where the roof chamfer starts: a
    // raked bar would run inside the glass and show only its two ends.
    const b = cabAt(-0.340);
    box(0.026, 0.320, 0.056, M.yellow, side * (b.hw + 0.002), 0.950, -0.340);

    const cTop = cabAt(-1.240), cBase = cabAt(-1.420);
    beam(new THREE.Vector3(side * (cTop.tw + 0.010), cTop.yt - 0.012, -1.240),
      new THREE.Vector3(side * (cBase.hw + 0.004), cBase.ys + 0.004, -1.420), 0.058, M.yellow); // C-pillar

    box(0.070, 0.022, 0.050, M.ink, side * 0.905, 0.848, 0.640);   // mirror stalk
    box(0.044, 0.078, 0.110, M.ink, side * 0.958, 0.856, 0.628);   // mirror head
  }

  // Roof vent: an ink hump on the ink roof, louvred with chrome so the roof still
  // reads as one mass and the vent reads as a working part.
  outline(box(0.34, 0.060, 0.30, M.ink, 0, 1.290, -0.62), 1.04);
  for (let i = 0; i < 3; i++) {
    box(0.26, 0.014, 0.022, M.silver, 0, 1.300, -0.74 + i * 0.10); // vent louvre
  }

  // Roof lamp pod: four lenses on a bar across the roof's leading edge. This is the
  // shape that says "rally" before any livery does.
  box(0.96, 0.080, 0.12, M.ink, 0, 1.300, -0.06);
  for (const x of [-0.360, -0.130, 0.130, 0.360]) {
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.030, 12), M.lamp);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(x, 1.300, 0.010);
    shell.car.add(lens);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.009, 4, 12), M.ink);
    ring.position.set(x, 1.300, 0.022);
    shell.car.add(ring);
  }

  const aerial = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.30, 6), M.ink);
  aerial.position.set(-0.46, 1.410, -1.10);
  aerial.rotation.z = -0.14;
  shell.car.add(aerial);

  // ---------- Bonnet: black anti-glare panel, slatted vent, pins ----------
  // A black bonnet is period rally practice and, unlike a stripe, it is a panel: it
  // stops short of the nose and of both wing tops instead of running the car's length.
  deckStrip(-0.68, 0.68, 1.92, 0.60, M.dInk, 0.010);
  box(0.94, 0.024, 0.36, M.ink, 0, at(1.30).yt + 0.014, 1.30); // vent recess
  for (let i = 0; i < 6; i++) {
    box(0.86, 0.014, 0.030, M.chrome, 0, at(1.30).yt + 0.028, 1.16 + i * 0.058); // vent slats
  }
  for (const side of [1, -1] as const) {
    box(0.055, 0.016, 0.055, M.chrome, side * 0.56, at(1.82).yt + 0.012, 1.82); // bonnet pin
  }

  // ---------- Flank livery: two colour blocks and a sponsor slab ----------
  // Rally paint is a set of panels bolted together, so the flank is divided by vertical
  // edges, not by a swoop or a stripe pair: yellow over the front wing, a black door
  // slab carrying the number board, yellow over the rear quarter. Edges only.
  const board: [number, number][] = [[0.34, 0.38], [0.34, 0.60], [-0.12, 0.60], [-0.12, 0.38]];
  const bar: [number, number][] = [[0.34, 0.32], [0.34, 0.365], [-0.12, 0.365], [-0.12, 0.32]];
  for (const side of [1, -1] as const) {
    shell.flankBand(BODY, side, 2.15, 0.58, 0.24, bandTop, M.dYellow);
    shell.flankBand(BODY, side, -0.62, -2.285, 0.24, bandTop, M.dYellow);
    shell.flankBand(BODY, side, 0.58, -0.62, 0.24, bandTop, M.dInk, 0.008);
    flank(bar, side, M.dRed, 0.012);
    flank(board, side, M.dWhite, 0.010);
    // the number: one stencil stroke, with its flag, the way a 1 survives at 360p
    box(0.014, 0.140, 0.020, M.dInk, side * (proud(0.16) + 0.014), 0.492, 0.155);
    const flag = box(0.014, 0.070, 0.020, M.dInk, side * (proud(0.16) + 0.014), 0.548, 0.126);
    flag.rotation.x = side > 0 ? -0.75 : 0.75;
    box(0.014, 0.016, 2.60, M.dInk, side * (proud(0.0) + 0.010), 0.300, 0.00); // sill line
    box(0.012, 0.44, 0.010, M.dInk, side * (proud(0.0) + 0.002), 0.480, 1.18);  // wing seam
    box(0.012, 0.44, 0.010, M.dInk, side * (proud(0.0) + 0.002), 0.480, -1.02); // quarter seam
    box(0.024, 0.032, 0.15, M.chrome, side * (proud(0.0) + 0.006), 0.620, 0.26); // door handle
    box(0.024, 0.032, 0.15, M.chrome, side * (proud(0.0) + 0.006), 0.620, -0.50);
    const filler = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.014, 10), M.chrome);
    filler.rotation.z = Math.PI / 2;
    filler.position.set(side * (proud(-1.26) + 0.006), 0.660, -1.26);
    shell.car.add(filler);
  }

  // ---------- Nose: yellow bumper, black grille, four-lamp pod, splitter ----------
  box(1.74, 0.13, 0.16, M.yellow, 0, 0.300, 2.160);  // bumper
  box(1.56, 0.16, 0.12, M.yellow, 0, 0.180, 2.190);  // air dam
  box(1.86, 0.040, 0.22, M.ink, 0, 0.105, 2.170);    // splitter
  box(1.42, 0.19, 0.09, M.ink, 0, 0.455, 2.150);     // grille band
  for (let i = 0; i < 3; i++) box(0.92, 0.014, 0.02, M.chrome, 0, 0.395 + i * 0.030, 2.200);
  box(0.62, 0.11, 0.05, M.ink, 0, 0.185, 2.235);     // centre intake
  box(0.10, 0.065, 0.06, M.red, -0.62, 0.230, 2.250); // tow hook

  box(1.48, 0.24, 0.10, M.ink, 0, 0.605, 2.135);      // lamp pod backing
  for (const side of [1, -1] as const) {
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.098, 0.098, 0.040, 14), M.lamp);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(side * 0.34, 0.605, 2.196);
    shell.car.add(lens);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.107, 0.014, 4, 14), M.ink);
    ring.position.set(side * 0.34, 0.605, 2.208);
    shell.car.add(ring);
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.056, 0.034, 10), M.lamp);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(side * 0.60, 0.600, 2.190);
    shell.car.add(pod);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.063, 0.010, 4, 10), M.ink);
    rim.position.set(side * 0.60, 0.600, 2.200);
    shell.car.add(rim);
    box(0.13, 0.062, 0.04, M.ink, side * 0.640, 0.320, 2.230);   // brake duct
    box(0.11, 0.040, 0.06, M.amber, side * 0.700, 0.400, 2.220); // indicator
  }

  // ---------- Tail: bumper, black tail band with wide lamps, wing, exhaust ----------
  box(1.74, 0.70, 0.018, M.yellow, 0, 0.545, -2.301); // tail panel: the hull's white rear cap
  box(1.72, 0.17, 0.12, M.yellow, 0, 0.310, -2.340);
  box(1.66, 0.37, 0.06, M.ink, 0, 0.600, -2.318); // tail band
  for (const side of [1, -1] as const) {
    shell.tailLamp(0.44, 0.14, side * 0.520, 0.630, -2.350);
    box(0.10, 0.06, 0.02, M.amber, side * 0.235, 0.630, -2.352);
  }
  box(0.34, 0.11, 0.02, M.white, 0, 0.430, -2.348); // plate
  box(1.10, 0.09, 0.20, M.ink, 0, 0.160, -2.290);   // diffuser
  for (let i = 0; i < 4; i++) box(0.022, 0.11, 0.20, M.ink, -0.42 + i * 0.28, 0.095, -2.295);

  // Tall boot wing on two struts, roof-high: the Group B silhouette needs the top box.
  for (const side of [1, -1] as const) {
    beam(new THREE.Vector3(side * 0.42, 0.840, -2.020), new THREE.Vector3(side * 0.42, 1.200, -2.120), 0.050, M.ink);
    outline(box(0.045, 0.15, 0.28, M.ink, side * 0.800, 1.225, -2.140), 1.05);
  }
  outline(box(1.60, 0.040, 0.26, M.ink, 0, 1.225, -2.140), 1.02);
  box(1.60, 0.030, 0.030, M.ink, 0, 1.230, -2.275); // Gurney flap

  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.050, 0.050, 0.14, 10), M.ink);
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.set(0.55, 0.215, -2.350);
  shell.car.add(exhaust);

  // ---------- Wheels: silver rims, eight chunky tread blocks ----------
  return shell.finish({
    wheel: WHEEL,
    mats: { tyre: M.tyre, ink: M.ink, face: M.silver },
    frontZ: FRONT_Z,
    rearZ: REAR_Z,
  });
}
