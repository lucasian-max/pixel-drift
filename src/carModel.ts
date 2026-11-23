import * as THREE from 'three';

/**
 * Hero car as a real 3D model, proportioned from the four-view sheet:
 * long low nose, cabin set back, short rear deck, wide stance, big wing.
 * Flat-shaded, with an inverted-hull outline for the pixel-art rim.
 */

const CREAM = 0xe8e0c8;
const CREAM_D = 0xc9bfa3;
const GLASS = 0x17212e;
const TYRE = 0x141419;
const HUB = 0xc6aa5c;
const TEAL = 0x2aa197;
const MAGENTA = 0xc23a86;
const INK = 0x0c0a10;

const mat = (c: number) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });

function outline(mesh: THREE.Mesh, k = 1.035) {
  const m = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide }));
  m.scale.copy(mesh.scale).multiplyScalar(k);
  m.position.copy(mesh.position);
  m.rotation.copy(mesh.rotation);
  m.renderOrder = -1;
  return m;
}

function extrude(shape: THREE.Shape, width: number, bevel = 0.05) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1,
  });
  geo.translate(0, 0, -width / 2);
  geo.rotateY(Math.PI / 2);
  return geo;
}

export function buildCarModel(): THREE.Group {
  const g = new THREE.Group();

  // ---- body: long nose, shoulder, short tucked tail
  const p = new THREE.Shape();
  p.moveTo(-2.30, 0.12);
  p.lineTo(2.30, 0.12);
  p.lineTo(2.30, 0.44);
  p.lineTo(1.42, 0.58);
  p.lineTo(0.30, 0.64);
  p.lineTo(-1.25, 0.56);
  p.lineTo(-2.22, 0.38);
  p.closePath();

  const body = new THREE.Mesh(extrude(p, 2.06), mat(CREAM));
  body.position.y = 0.20;
  g.add(outline(body), body);

  // ---- cabin: low bubble set back over the rear axle
  const c = new THREE.Shape();
  c.moveTo(-0.10, 0.0);
  c.lineTo(1.45, 0.0);
  c.lineTo(1.20, 0.34);
  c.lineTo(0.10, 0.34);
  c.closePath();
  const canopy = new THREE.Mesh(extrude(c, 1.34, 0.045), mat(GLASS));
  canopy.position.set(0, 0.80, 0.90);
  g.add(outline(canopy, 1.03), canopy);

  // ---- painted roof panel
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.07, 1.05), mat(CREAM));
  roof.position.set(0, 1.15, 0.98);
  g.add(roof);

  // ---- livery: twin stripes over bonnet, roof and deck
  for (const [x, colour] of [[-0.17, TEAL], [0.17, MAGENTA]] as [number, number][]) {
    const s1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 4.3), mat(colour));
    s1.position.set(x, 0.84, -0.05);
    g.add(s1);
    const s2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 1.0), mat(colour));
    s2.position.set(x, 1.19, 0.98);
    g.add(s2);
  }

  // ---- wheels + arches
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.30, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.32, 8);
  hubGeo.rotateZ(Math.PI / 2);
  const archGeo = new THREE.BoxGeometry(0.34, 0.30, 0.96);
  for (const z of [-1.42, 1.32]) {
    for (const x of [-1.00, 1.00]) {
      const arch = new THREE.Mesh(archGeo, mat(INK));
      arch.position.set(x * 1.0, 0.30, z);
      g.add(arch);
      const w = new THREE.Mesh(wheelGeo, mat(TYRE));
      w.position.set(x, 0.34, z);
      g.add(w);
      const hub = new THREE.Mesh(hubGeo, mat(HUB));
      hub.position.set(x * 1.03, 0.34, z);
      g.add(hub);
    }
  }

  // ---- rear wing on two stalks
  const wing = new THREE.Mesh(new THREE.BoxGeometry(2.12, 0.06, 0.44), mat(CREAM_D));
  wing.position.set(0, 0.92, 2.12);
  g.add(outline(wing), wing);
  for (const x of [-0.78, 0.78]) {
    const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.26, 0.12), mat(INK));
    stalk.position.set(x, 0.76, 2.08);
    g.add(stalk);
  }

  // ---- lights + grille + exhausts
  for (const x of [-0.70, 0.70]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.10, 0.05), mat(0xffe9a8));
    hl.position.set(x, 0.46, -2.31);
    g.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.10, 0.05), mat(0xd93b34));
    tl.position.set(x, 0.52, 2.30);
    g.add(tl);
  }
  const grille = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.12, 0.05), mat(INK));
  grille.position.set(0, 0.30, -2.30);
  g.add(grille);
  for (const x of [-0.30, 0.30]) {
    const ex = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.10, 0.06), mat(0x8f96a2));
    ex.position.set(x, 0.26, 2.32);
    g.add(ex);
  }

  return g;
}
