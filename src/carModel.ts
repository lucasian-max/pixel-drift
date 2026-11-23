import * as THREE from 'three';

/**
 * Hero car modelled from the four-view sheet: very low wedge, long nose with
 * pop-up headlights, set-back bubble canopy, black skirt, and the tall
 * twin-plate rear wing. Flat shaded, inverted-hull outline.
 */

const CREAM = 0xe8e0c8;
const CREAM_D = 0xc9bfa3;
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

function extrude(shape: THREE.Shape, width: number, bevel = 0.045) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1,
  });
  geo.translate(0, 0, -width / 2);
  geo.rotateY(Math.PI / 2);
  return geo;
}

export function buildCarModel(): THREE.Group {
  const g = new THREE.Group();

  // ---- black skirt / splitter the body sits on
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.10, 4.5), mat(INK));
  skirt.position.set(0, 0.09, 0);
  g.add(skirt);

  // ---- body: long low nose, shoulder, short tucked deck
  const p = new THREE.Shape();
  p.moveTo(-2.32, 0.10);
  p.lineTo(2.30, 0.10);
  p.lineTo(2.30, 0.32);
  p.lineTo(1.62, 0.46);
  p.lineTo(0.30, 0.52);
  p.lineTo(-1.30, 0.44);
  p.lineTo(-2.28, 0.28);
  p.closePath();
  const body = new THREE.Mesh(extrude(p, 2.02), mat(CREAM));
  g.add(outline(body), body);

  // ---- cabin: small bubble set back, raked at both ends
  const c = new THREE.Shape();
  c.moveTo(-0.32, 0.0);
  c.lineTo(1.52, 0.0);
  c.lineTo(1.24, 0.30);
  c.lineTo(-0.02, 0.30);
  c.closePath();
  const canopy = new THREE.Mesh(extrude(c, 1.28, 0.035), mat(GLASS));
  canopy.position.set(0, 0.60, 0.86);
  g.add(outline(canopy, 1.025), canopy);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.055, 0.95), mat(CREAM));
  roof.position.set(0, 0.91, 0.94);
  g.add(roof);

  // ---- pop-up headlight flaps on the bonnet
  for (const x of [-0.62, 0.62]) {
    const flap = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, 0.30), mat(CREAM_D));
    flap.position.set(x, 0.45, -1.62);
    g.add(flap);
  }

  // ---- livery: twin stripe over bonnet/roof, and a diagonal slash on the flank
  for (const [x, colour] of [[-0.16, TEAL], [0.16, MAGENTA]] as [number, number][]) {
    const s1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.025, 4.25), mat(colour));
    s1.position.set(x, 0.70, -0.02);
    g.add(s1);
    const s2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.92), mat(colour));
    s2.position.set(x, 0.95, 0.94);
    g.add(s2);
  }
  const slash = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.24, 1.15), mat(TEAL));
  slash.position.set(1.015, 0.38, 1.45);
  slash.rotation.x = -0.34;
  g.add(slash);
  const slash2 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.10, 1.15), mat(MAGENTA));
  slash2.position.set(1.02, 0.27, 1.45);
  slash2.rotation.x = -0.34;
  g.add(slash2);

  // ---- wheels: black tyres with big gold hubs
  const wheelGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.30, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.32, 10);
  hubGeo.rotateZ(Math.PI / 2);
  for (const z of [-1.42, 1.36]) {
    for (const x of [-1.00, 1.00]) {
      const w = new THREE.Mesh(wheelGeo, mat(TYRE));
      w.position.set(x, 0.33, z);
      g.add(w);
      const hub = new THREE.Mesh(hubGeo, mat(HUB));
      hub.position.set(x * 1.01, 0.33, z);
      g.add(hub);
    }
  }

  // ---- rear wing: high blade on two tall end plates
  const wing = new THREE.Mesh(new THREE.BoxGeometry(2.24, 0.07, 0.40), mat(INK));
  wing.position.set(0, 0.98, 2.24);
  g.add(wing);
  for (const x of [-1.08, 1.08]) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.52, 0.46), mat(INK));
    plate.position.set(x, 0.72, 2.22);
    g.add(plate);
  }

  // ---- tail panel: black bar with red lights, plus diffuser
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.60, 0.16, 0.06), mat(INK));
  tail.position.set(0, 0.34, 2.31);
  g.add(tail);
  for (const x of [-0.56, 0.56]) {
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.09, 0.03), mat(RED));
    tl.position.set(x, 0.34, 2.345);
    g.add(tl);
  }
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.30, 0.10, 0.22), mat(0x8f96a2));
  diffuser.position.set(0, 0.16, 2.28);
  g.add(diffuser);

  // ---- nose: grille + indicators
  const grille = new THREE.Mesh(new THREE.BoxGeometry(1.10, 0.10, 0.05), mat(INK));
  grille.position.set(0, 0.22, -2.33);
  g.add(grille);
  for (const x of [-0.78, 0.78]) {
    const ind = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.06, 0.04), mat(0xffe9a8));
    ind.position.set(x, 0.30, -2.32);
    g.add(ind);
  }

  return g;
}
