import * as THREE from 'three';

/**
 * The hero car as an actual 3D model: an extruded side profile (the 80s wedge),
 * a glass canopy, wheels, wing and the teal/magenta livery. Flat-shaded, with an
 * inverted-hull outline so it keeps the pixel-art edge.
 */

const CREAM = 0xe8e0c8;
const CREAM_D = 0xbfb497;
const GLASS = 0x17212e;
const TYRE = 0x141419;
const HUB = 0xc6aa5c;
const TEAL = 0x2aa197;
const MAGENTA = 0xc23a86;
const INK = 0x0c0a10;

function mat(color: number) {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

function outline(mesh: THREE.Mesh, k = 1.035) {
  const m = new THREE.Mesh(
    mesh.geometry,
    new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide }),
  );
  m.scale.copy(mesh.scale).multiplyScalar(k);
  m.position.copy(mesh.position);
  m.rotation.copy(mesh.rotation);
  m.renderOrder = -1;
  return m;
}

export function buildCarModel(): THREE.Group {
  const g = new THREE.Group();

  // ---- side profile, extruded across the width: low nose, high tail
  const p = new THREE.Shape();
  p.moveTo(-2.25, 0.16);          // nose bottom
  p.lineTo(2.24, 0.20);           // tail bottom
  p.lineTo(2.18, 0.54);           // tail top, tucked in
  p.lineTo(1.55, 0.70);           // boot
  p.lineTo(-0.35, 0.80);          // shoulder
  p.lineTo(-1.55, 0.60);          // bonnet
  p.lineTo(-2.15, 0.44);          // nose top
  p.closePath();

  const bodyGeo = new THREE.ExtrudeGeometry(p, {
    depth: 2.0, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 1,
  });
  bodyGeo.translate(0, 0, -1.0);
  bodyGeo.rotateY(Math.PI / 2);   // profile along Z, width along X
  const body = new THREE.Mesh(bodyGeo, mat(CREAM));
  body.position.y = 0.12;
  g.add(outline(body), body);

  // ---- canopy: a tapered glass box sitting on the shoulder
  const c = new THREE.Shape();
  c.moveTo(-1.05, 0.0);          // windscreen base
  c.lineTo(0.98, 0.0);           // rear glass base
  c.lineTo(0.72, 0.40);          // rear roofline
  c.lineTo(-0.52, 0.40);         // front roofline (raked)
  c.closePath();
  const canopyGeo = new THREE.ExtrudeGeometry(c, {
    depth: 1.30, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 1,
  });
  canopyGeo.translate(0, 0, -0.65);
  canopyGeo.rotateY(Math.PI / 2);
  const canopy = new THREE.Mesh(canopyGeo, mat(GLASS));
  canopy.position.set(0, 0.74, 0.30);
  g.add(outline(canopy, 1.03), canopy);

  // ---- roof panel, so the canopy reads as glass with a painted roof
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.10, 0.07, 1.10), mat(CREAM));
  roof.position.set(0, 1.16, 0.38);
  g.add(roof);

  // ---- livery: two stripes over the body and the roof
  for (const [x, colour] of [[-0.16, TEAL], [0.16, MAGENTA]] as [number, number][]) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.035, 4.1), mat(colour));
    stripe.position.set(x, 0.9, 0);
    g.add(stripe);
    const roofStripe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 1.45), mat(colour));
    roofStripe.position.set(x, 1.22, 0.35);
    g.add(roofStripe);
  }

  // ---- wheels: black cylinders with a gold hub disc
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.30, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.32, 8);
  hubGeo.rotateZ(Math.PI / 2);
  for (const z of [-1.35, 1.3]) {
    for (const x of [-1.02, 1.02]) {
      const w = new THREE.Mesh(wheelGeo, mat(TYRE));
      w.position.set(x, 0.36, z);
      g.add(outline(w, 1.02), w);
      const hub = new THREE.Mesh(hubGeo, mat(HUB));
      hub.position.set(x * 1.02, 0.36, z);
      g.add(hub);
    }
  }

  // ---- rear wing on two stalks
  const wing = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.06, 0.42), mat(CREAM_D));
  wing.position.set(0, 1.02, 2.05);
  g.add(outline(wing), wing);
  for (const x of [-0.75, 0.75]) {
    const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.34, 0.14), mat(INK));
    stalk.position.set(x, 0.92, 1.95);
    g.add(stalk);
  }

  // ---- lights
  for (const x of [-0.72, 0.72]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.06), mat(0xffe9a8));
    hl.position.set(x, 0.5, -2.27);
    g.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.06), mat(0xd93b34));
    tl.position.set(x, 0.62, 2.24);
    g.add(tl);
  }

  // ---- grille
  const grille = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.14, 0.06), mat(INK));
  grille.position.set(0, 0.34, -2.26);
  g.add(grille);

  return g;
}
