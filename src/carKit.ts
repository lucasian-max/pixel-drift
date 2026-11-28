// src/carKit.ts — the scaffolding both bespoke car shells sit on.
// Axes: +Z = forward (nose), +X = right, +Y = up. Ground at y = 0.
import * as THREE from 'three';

export type V2 = [number, number];

export interface Section {
  z: number;
  yb: number; // underside height
  yl: number; // top of the lower chamfer
  hw: number; // flank half-width
  ys: number; // shoulder height
  tw: number; // deck half-width
  yt: number; // deck centre height
}

export const S = (z: number, yb: number, yl: number, hw: number, ys: number, tw: number, yt: number): Section =>
  ({ z, yb, yl, hw, ys, tw, yt });

/** Section at an arbitrary z, interpolated between the two stations around it. */
export function bodyAt(secs: Section[], z: number): Section {
  if (z >= secs[0].z) return secs[0];
  const last = secs[secs.length - 1];
  if (z <= last.z) return last;
  for (let i = 0; i < secs.length - 1; i++) {
    const a = secs[i], b = secs[i + 1];
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

/** Wheel dimensions that differ between shells: rim style, tread count, sidewall band. */
export interface WheelStyle {
  width: number;
  treads: number;
  treadH: number;
  treadD: number;
  treadR: number;
  discR: number;
  rim: [radius: number, tube: number];
  band?: [radius: number, tube: number];
  spoke: [w: number, h: number, d: number];
  spokeAt: [x: number, y: number];
  hubR: number;
  capR: number;
}

export interface WheelMats {
  tyre: THREE.Material;
  ink: THREE.Material;
  face: THREE.Material;
  band?: THREE.Material;
}

/** Both shells ride on the same 0.35 m tyre. */
const WHEEL_R = 0.35;

/** Body stations straight out of a section table, plus the primitives a livery is built from. */
export class CarShell {
  readonly car = new THREE.Group();
  readonly brakes: THREE.Mesh[] = [];
  private readonly outer = new THREE.MeshBasicMaterial({ color: 0x050505, side: THREE.BackSide });
  private readonly brakeMat = new THREE.MeshLambertMaterial({ color: 0xd02a2a, emissive: 0x330000 });

  constructor() {
    this.car.name = 'car';
  }

  lam(color: number, extra: THREE.MeshLambertMaterialParameters = {}) {
    return new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
  }

  /** Panel material that sits just off the surface, for decals painted onto flanks. */
  decal(color: number) {
    return this.lam(color, {
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  }

  /** Hull mesh, not yet added: the caller names it and outlines it. */
  hull(secs: Section[], mats: THREE.Material[], skirt: Set<number>) {
    return new THREE.Mesh(loft(secs, j => (skirt.has(j) ? 1 : 0)), mats);
  }

  /** Inverted-hull outline scaled about the geometry's bbox centre. */
  outline(mesh: THREE.Mesh, s = 1.025) {
    const geo = mesh.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const c = geo.boundingBox!.getCenter(new THREE.Vector3());
    const o = new THREE.Mesh(geo, this.outer);
    o.scale.setScalar(s);
    o.position.copy(c).multiplyScalar(1 - s);
    o.raycast = () => {};
    o.castShadow = false;
    o.userData.isOutline = true;
    mesh.add(o);
    return mesh;
  }

  box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    this.car.add(m);
    return m;
  }

  beam(a: THREE.Vector3, b: THREE.Vector3, t: number, mat: THREE.Material) {
    const d = new THREE.Vector3().subVectors(b, a);
    const m = new THREE.Mesh(new THREE.BoxGeometry(t, d.length(), t), mat);
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    this.car.add(m);
    return m;
  }

  /** Flat panel on a flank (normal ±x); points are [z, y] in world space. */
  sidePanel(pts: V2[], side: 1 | -1, x: number, mat: THREE.Material) {
    const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(side > 0 ? -z : z, y)));
    const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat);
    m.rotation.y = (side * Math.PI) / 2;
    m.position.x = side * x;
    this.car.add(m);
    return m;
  }

  /**
   * Livery block painted on the flank that follows the hull: points are [z, y] and
   * every vertex is pushed out to the body half-width at its own z, so a panel that
   * runs the length of a tapering flank stays proud of it instead of sinking in at
   * the door line or floating off the tail. Needs a decal material.
   */
  flankPanel(secs: Section[], pts: V2[], side: 1 | -1, mat: THREE.Material, lift = 0.006) {
    const contour = pts.map(([z, y]) => new THREE.Vector2(z, y));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const pos: number[] = [];
    for (const [a, b, c] of tris) {
      for (const i of [a, b, c]) {
        const [z, y] = pts[i];
        pos.push(side * (bodyAt(secs, z).hw + lift), y, z);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    this.car.add(m);
    return m;
  }

  /**
   * Vertical livery band running the flank from z0 (front) to z1 (rear): bottom edge at
   * y0, top edge following top(z). Sampled at every body station, so the strip tracks a
   * flank that tapers instead of chording straight through it — which is what happens to
   * any panel wide enough to straddle the nose taper. Needs a decal material.
   */
  flankBand(secs: Section[], side: 1 | -1, z0: number, z1: number, y0: number,
    top: (z: number) => number, mat: THREE.Material, lift = 0.006) {
    const zs = [z0, ...secs.map(s => s.z).filter(z => z < z0 && z > z1), z1];
    const pos: number[] = [];
    for (let i = 0; i < zs.length - 1; i++) {
      const za = zs[i], zb = zs[i + 1];
      const xa = side * (bodyAt(secs, za).hw + lift);
      const xb = side * (bodyAt(secs, zb).hw + lift);
      const ta = top(za), tb = top(zb);
      pos.push(xa, y0, za, xb, y0, zb, xa, ta, za);
      pos.push(xa, ta, za, xb, y0, zb, xb, tb, zb);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    this.car.add(m);
    return m;
  }

  /** Wheel arch cut into the flank: half annulus extruded outward. */
  flare(zc: number, side: 1 | -1, o: { ro: number; ri: number; cy: number; y0: number; depth: number; x: number },
    mat: THREE.Material) {
    const pts: V2[] = [[zc + o.ro, o.y0], [zc + o.ro, o.cy]];
    for (let i = 1; i <= 16; i++) {
      const a = (i / 16) * Math.PI;
      pts.push([zc + o.ro * Math.cos(a), o.cy + o.ro * Math.sin(a)]);
    }
    pts.push([zc - o.ro, o.y0], [zc - o.ri, o.y0], [zc - o.ri, o.cy]);
    for (let i = 16; i >= 1; i--) {
      const a = (i / 16) * Math.PI;
      pts.push([zc + o.ri * Math.cos(a), o.cy + o.ri * Math.sin(a)]);
    }
    pts.push([zc + o.ri, o.y0]);

    const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(side > 0 ? -z : z, y)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: o.depth, bevelEnabled: false });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.y = (side * Math.PI) / 2;
    m.position.x = side * o.x;
    this.car.add(m);
    return m;
  }

  /** Dark half-disc behind a wheel: the arch opening the tyre reads against. Needs a decal material. */
  archWell(secs: Section[], zc: number, side: 1 | -1, o: { r: number; cy: number; y0: number }, mat: THREE.Material) {
    const pts: V2[] = [[zc - o.r, o.y0]];
    for (let i = 16; i >= 0; i--) {
      const a = (i / 16) * Math.PI;
      pts.push([zc + o.r * Math.cos(a), o.cy + o.r * Math.sin(a)]);
    }
    pts.push([zc + o.r, o.y0]);
    const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(side > 0 ? -z : z, y)));
    const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat);
    m.rotation.y = (side * Math.PI) / 2;
    m.position.x = side * (bodyAt(secs, zc).hw + 0.004);
    this.car.add(m);
    return m;
  }

  /** Thin strip lying on the deck surface between z0 (front) and z1 (rear). */
  deckStrip(secs: Section[], x0: number, x1: number, z0: number, z1: number, mat: THREE.Material, lift = 0.008) {
    const zs = [z0, ...secs.map(s => s.z).filter(z => z < z0 && z > z1), z1];
    const pos: number[] = [];
    for (let i = 0; i < zs.length - 1; i++) {
      const za = zs[i], zb = zs[i + 1];
      const ya = bodyAt(secs, za).yt + lift, yb = bodyAt(secs, zb).yt + lift;
      pos.push(x0, ya, za, x1, yb, zb, x0, yb, zb);
      pos.push(x0, ya, za, x1, ya, za, x1, yb, zb);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    this.car.add(m);
    return m;
  }

  /** Band that hugs the shoulder from x0 out to the flank. */
  shoulderStrip(secs: Section[], side: 1 | -1, x0: number, x1: number, z0: number, z1: number,
    mat: THREE.Material, lift = 0.006) {
    const zs = [z0, ...secs.map(s => s.z).filter(z => z < z0 && z > z1), z1];
    const rows: THREE.Vector3[][] = [];
    const surfaceY = (s: Section, x: number) => {
      const t = (x - s.tw) / Math.max(0.001, s.hw - s.tw);
      return s.yt + (s.ys - s.yt) * Math.max(0, Math.min(1, t));
    };
    for (const z of zs) {
      const s = bodyAt(secs, z);
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
    this.car.add(m);
    return m;
  }

  /** One wheel: tyre with tread blocks, brake disc, rim, five spokes, hub cap. */
  wheel(style: WheelStyle, mats: WheelMats) {
    const spin = new THREE.Group();
    const tg = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, style.width, 16);
    tg.rotateZ(Math.PI / 2);
    spin.add(this.outline(new THREE.Mesh(tg, mats.tyre), 1.018));

    for (let i = 0; i < style.treads; i++) {
      const a = (i / style.treads) * Math.PI * 2;
      const tread = new THREE.Mesh(new THREE.BoxGeometry(style.width + 0.002, style.treadH, style.treadD), mats.ink);
      tread.position.set(0, Math.cos(a) * style.treadR, Math.sin(a) * style.treadR);
      tread.rotation.x = a;
      spin.add(tread);
    }

    const face = new THREE.Group();
    face.position.x = style.width / 2 + 0.004;
    spin.add(face);

    const discGeo = new THREE.CylinderGeometry(style.discR, style.discR, 0.018, 16);
    discGeo.rotateZ(Math.PI / 2);
    face.add(new THREE.Mesh(discGeo, mats.ink));

    if (style.band && mats.band) {
      const bandGeo = new THREE.TorusGeometry(style.band[0], style.band[1], 4, 18);
      bandGeo.rotateY(Math.PI / 2);
      face.add(new THREE.Mesh(bandGeo, mats.band));
    }

    const rimGeo = new THREE.TorusGeometry(style.rim[0], style.rim[1], 4, 16);
    rimGeo.rotateY(Math.PI / 2);
    face.add(new THREE.Mesh(rimGeo, mats.face));

    for (let i = 0; i < 5; i++) {
      const p = new THREE.Group();
      p.rotation.x = (i * 2 * Math.PI) / 5;
      const sp = new THREE.Mesh(
        new THREE.BoxGeometry(style.spoke[0], style.spoke[1], style.spoke[2]), mats.face);
      sp.position.set(style.spokeAt[0], style.spokeAt[1], 0);
      p.add(sp);
      face.add(p);
    }
    const hubGeo = new THREE.CylinderGeometry(style.hubR, style.hubR, 0.040, 10);
    hubGeo.rotateZ(Math.PI / 2);
    face.add(new THREE.Mesh(hubGeo, mats.face));
    const capGeo = new THREE.CylinderGeometry(style.capR, style.capR, 0.030, 8);
    capGeo.rotateZ(Math.PI / 2);
    const cap = new THREE.Mesh(capGeo, mats.ink);
    cap.position.x = 0.024;
    face.add(cap);
    return spin;
  }

  /** Mount the four wheels, index what the sim animates, and shadow the shell. */
  finish(o: { wheel: WheelStyle; mats: WheelMats; frontZ: number; rearZ: number }) {
    const wheelX = 1.025 - o.wheel.width / 2;
    const wheels: THREE.Group[] = [];
    const defs: [string, number, number][] = [
      ['wheelFL', -1, o.frontZ], ['wheelFR', 1, o.frontZ],
      ['wheelRL', -1, o.rearZ], ['wheelRR', 1, o.rearZ],
    ];
    for (const [name, side, z] of defs) {
      const mount = new THREE.Group();
      mount.name = name + 'Mount';
      mount.position.set(side * wheelX, WHEEL_R, z);
      if (side < 0) mount.rotation.y = Math.PI;
      const spin = this.wheel(o.wheel, o.mats);
      spin.name = name;
      mount.add(spin);
      this.car.add(mount);
      wheels.push(spin);
    }
    this.car.userData.wheels = wheels;
    this.car.userData.frontMounts =
      this.car.children.filter(c => c.name === 'wheelFLMount' || c.name === 'wheelFRMount');
    this.car.userData.brakes = this.brakes;

    this.car.traverse(o2 => {
      if ((o2 as THREE.Mesh).isMesh && !o2.userData.isOutline) {
        o2.castShadow = true;
        o2.receiveShadow = true;
      }
    });
    return this.car;
  }

  /** Tail lamp that the brake lights switch on: returns the box and registers it. */
  tailLamp(w: number, h: number, x: number, y: number, z: number) {
    const m = this.box(w, h, 0.02, this.brakeMat, x, y, z);
    this.brakes.push(m);
    return m;
  }
}
