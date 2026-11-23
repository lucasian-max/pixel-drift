import * as THREE from 'three';

/**
 * Hero car lofted from the four-view sheet: the plan view narrows at the nose,
 * bulges over the arches and tapers at the tail, while the side view sets the
 * roofline. Lofting (instead of extruding a constant-width profile) is what
 * gives it the sheet's teardrop plan shape.
 */

const CREAM = 0xe8e0c8;
const GLASS = 0x141b26;
const TYRE = 0x141419;
const HUB = 0xc6aa5c;
const TEAL = 0x2aa197;
const MAGENTA = 0xc23a86;
const INK = 0x0c0a10;
const RED = 0xd93b34;

const mat = (c: number) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });

function outline(mesh: THREE.Mesh, k = 1.035) {
  const m = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide }));
  m.scale.copy(mesh.scale).multiplyScalar(k);
  m.position.copy(mesh.position);
  m.rotation.copy(mesh.rotation);
  m.renderOrder = -1;
  return m;
}

const lerpTable = (t: [number, number][], v: number) => {
  if (v <= t[0][0]) return t[0][1];
  if (v >= t[t.length - 1][0]) return t[t.length - 1][1];
  for (let i = 0; i < t.length - 1; i++) {
    if (v <= t[i + 1][0]) {
      const k = (v - t[i][0]) / (t[i + 1][0] - t[i][0]);
      return t[i][1] + (t[i + 1][1] - t[i][1]) * k;
    }
  }
  return 0;
};

const HALF_W: [number, number][] = [
  [-2.30, 0.52], [-2.00, 0.74], [-1.55, 0.90], [-1.05, 1.01],
  [-0.20, 1.04], [0.80, 1.04], [1.40, 1.00], [1.95, 0.94], [2.30, 0.86],
];
const TOP_H: [number, number][] = [
  [-2.30, 0.30], [-1.85, 0.38], [-1.20, 0.46], [-0.55, 0.51],
  [0.30, 0.54], [1.10, 0.53], [1.75, 0.46], [2.30, 0.34],
];

function loftedBody(): THREE.BufferGeometry {
  const N = 30;
  const z0 = -2.30, z1 = 2.30;
  const floor = 0.10;
  const pos: number[] = [];
  const station = (z: number) => {
    const w = lerpTable(HALF_W, z);
    const y = lerpTable(TOP_H, z);
    return {
      bl: [-w, floor, z], br: [w, floor, z],
      tr: [w * 0.94, y, z], tl: [-w * 0.94, y, z],
    };
  };
  const quad = (a: number[], b: number[], c: number[], d: number[]) => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  };
  for (let i = 0; i < N; i++) {
    const za = z0 + ((z1 - z0) * i) / N;
    const zb = z0 + ((z1 - z0) * (i + 1)) / N;
    const A = station(za), B = station(zb);
    quad(A.bl as number[], A.br as number[], B.br as number[], B.bl as number[]); // floor
    quad(A.br as number[], A.tr as number[], B.tr as number[], B.br as number[]); // right
    quad(A.tr as number[], A.tl as number[], B.tl as number[], B.tr as number[]); // roof
    quad(A.tl as number[], A.bl as number[], B.bl as number[], B.tl as number[]); // left
  }
  const nose = station(z0), tail = station(z1);
  quad(nose.bl as number[], nose.tl as number[], nose.tr as number[], nose.br as number[]);
  quad(tail.br as number[], tail.tr as number[], tail.tl as number[], tail.bl as number[]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

export function buildCarModel(): THREE.Group {
  const g = new THREE.Group();

  // skirt / splitter
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(1.98, 0.10, 4.4), mat(INK));
  skirt.position.set(0, 0.09, 0);
  g.add(skirt);

  // lofted body
  const body = new THREE.Mesh(loftedBody(), mat(CREAM));
  g.add(outline(body), body);

  // cabin: raked bubble, narrower than the body
  const c = new THREE.Shape();
  c.moveTo(-0.34, 0.0);
  c.lineTo(1.50, 0.0);
  c.lineTo(1.20, 0.30);
  c.lineTo(0.02, 0.30);
  c.closePath();
  const canopyGeo = new THREE.ExtrudeGeometry(c, {
    depth: 1.22, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 1,
  });
  canopyGeo.translate(0, 0, -0.61);
  canopyGeo.rotateY(Math.PI / 2);
  const canopy = new THREE.Mesh(canopyGeo, mat(GLASS));
  canopy.position.set(0, 0.62, 0.88);
  g.add(outline(canopy, 1.02), canopy);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.05, 0.86), mat(CREAM));
  roof.position.set(0, 0.925, 0.94);
  g.add(roof);

  // pop-up headlight lids
  for (const x of [-0.60, 0.60]) {
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.28), mat(0xd8cfb4));
    lid.position.set(x, 0.405, -1.66);
    g.add(lid);
  }

  // stripes over bonnet + roof, and the diagonal flank slash
  for (const [x, colour] of [[-0.15, TEAL], [0.15, MAGENTA]] as [number, number][]) {
    const s1 = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.02, 4.2), mat(colour));
    s1.position.set(x, 0.63, -0.02);
    g.add(s1);
    const s2 = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.02, 0.84), mat(colour));
    s2.position.set(x, 0.955, 0.94);
    g.add(s2);
  }
  const slash = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.26, 1.10), mat(TEAL));
  slash.position.set(1.01, 0.36, 1.42);
  slash.rotation.x = -0.36;
  g.add(slash);
  const slash2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.11, 1.10), mat(MAGENTA));
  slash2.position.set(1.015, 0.235, 1.42);
  slash2.rotation.x = -0.36;
  g.add(slash2);

  // wheels: tyre + gold hub with spokes
  const tyre = new THREE.CylinderGeometry(0.33, 0.33, 0.30, 12);
  tyre.rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.19, 0.19, 0.32, 10);
  hub.rotateZ(Math.PI / 2);
  for (const z of [-1.44, 1.38]) {
    for (const x of [-0.99, 0.99]) {
      const w = new THREE.Mesh(tyre, mat(TYRE));
      w.position.set(x, 0.33, z);
      g.add(w);
      const h = new THREE.Mesh(hub, mat(HUB));
      h.position.set(x * 1.01, 0.33, z);
      g.add(h);
      for (let i = 0; i < 4; i++) {
        const sp = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.30, 0.035), mat(0x8a7440));
        sp.position.set(x * 1.02, 0.33, z);
        sp.rotation.x = (i * Math.PI) / 4;
        g.add(sp);
      }
    }
  }

  // rear wing on tall end plates
  const wing = new THREE.Mesh(new THREE.BoxGeometry(2.18, 0.07, 0.40), mat(INK));
  wing.position.set(0, 0.99, 2.22);
  g.add(wing);
  for (const x of [-1.06, 1.06]) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.54, 0.44), mat(INK));
    plate.position.set(x, 0.72, 2.20);
    g.add(plate);
  }

  // tail bar + diffuser
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.16, 0.05), mat(INK));
  tail.position.set(0, 0.32, 2.30);
  g.add(tail);
  for (const x of [-0.52, 0.52]) {
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.08, 0.03), mat(RED));
    tl.position.set(x, 0.32, 2.33);
    g.add(tl);
  }
  const diff = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.09, 0.20), mat(0x8f96a2));
  diff.position.set(0, 0.155, 2.28);
  g.add(diff);

  // nose grille + indicators
  const grille = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.09, 0.04), mat(INK));
  grille.position.set(0, 0.21, -2.31);
  g.add(grille);
  for (const x of [-0.62, 0.62]) {
    const ind = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.05, 0.03), mat(0xffe9a8));
    ind.position.set(x, 0.27, -2.30);
    g.add(ind);
  }

  return g;
}
