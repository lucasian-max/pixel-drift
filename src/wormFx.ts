// src/wormFx.ts — the DUNE RUNNER's earth-toned power visuals.
// One palette, one aim ring, one placement marker, one dust burst. Everything wears the
// nearest-filter pixel look and stays additive-on-road / normal-on-grass so the sand reads
// on both the asphalt and the verge at 360p.
//
//   DUST_HOT      #F6C86B  pale straw — the lifted dust at its brightest, arrival core
//   DUST_AMBER    #E8A33D  car's AMBER trim — inner portal torus, aim ribbon
//   DUST_TERRA    #D4642A  car's ORANGE flares — outer portal torus, aim bed
//   DUST_SAND     #C9A46A  sand body, one step darker — default dust puff
//   DUST_DIRT     #8C6B44  shaded earth — marker rim, burst anchor
import * as THREE from 'three';

export const DUST = {
  hot: 0xf6c86b,
  amber: 0xe8a33d,
  terra: 0xd4642a,
  sand: 0xc9a46a,
  dirt: 0x8c6b44,
} as const;

/** Ground-hugging soft disc (radial alpha), NEAREST-sampled like everything else in the game. */
function dustTexture(size = 32): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  const grd = g.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,0.30)');
  grd.addColorStop(0.70, 'rgba(255,255,255,0.12)');
  grd.addColorStop(0.94, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface WormAimRing {
  group: THREE.Group;
  /** radius of the placement disc, metres (14 by design) */
  readonly radius: number;
  /** move the disc under the car; heading only steers the forward chevrons */
  place(x: number, z: number, heading: number): void;
  /** where the pointer sits inside the disc, as a world position (clamped to the radius) */
  marker(x: number, z: number): void;
  show(on: boolean): void;
  dispose(): void;
}

/**
 * Flat 14 m aim disc + chunky placement marker, for main's aim mode.
 * `mesh.material.opacity` never animates on its own: main owns the in/out fade, so the
 * ring is perfectly steady (no flicker) while the mouse moves.
 */
export function createWormAimRing(radius = 14): WormAimRing {
  const group = new THREE.Group();
  group.name = 'wormAim';
  group.visible = false;

  const tex = dustTexture();
  // the bed takes the existing additive ring look (reads on asphalt); the rim is drawn
  // normal-blended one step paler so the 14 m edge survives on light grass too
  const bed = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 48),
    new THREE.MeshBasicMaterial({
      map: tex, color: DUST.terra, transparent: true, opacity: 0.22, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    }),
  );
  bed.rotation.x = -Math.PI / 2;
  bed.position.y = 0.04;
  bed.renderOrder = 2;
  const rim = new THREE.Mesh(
    new THREE.RingGeometry(radius - 0.35, radius, 64),
    new THREE.MeshBasicMaterial({
      color: DUST.sand, transparent: true, opacity: 0.55, depthWrite: false,
      toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }),
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.045;
  rim.renderOrder = 3;
  group.add(bed, rim);

  // forward emphasis: a broken arc of four chunky chevrons inside the rim
  const chevrons = new THREE.Group();
  const chevMat = new THREE.MeshBasicMaterial({
    color: DUST.amber, transparent: true, opacity: 0.7, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  });
  for (let i = 0; i < 4; i++) {
    const span = 0.34;                                   // radians of arc per chevron
    const arc = new THREE.ShapeGeometry(new THREE.Shape([
      new THREE.Vector2(radius * 0.55, 0),
      new THREE.Vector2(radius * 0.86, 0),
      new THREE.Vector2(radius * 0.86, radius * 0.17),
      new THREE.Vector2(radius * 0.55, radius * 0.22),
    ]));
    arc.rotateX(-Math.PI / 2);
    arc.rotateY(-Math.PI / 2 - (i - 1.5) * 0.5 + Math.PI / 2);
    const m = new THREE.Mesh(arc, chevMat);
    m.position.y = 0.05;
    m.renderOrder = 4;
    chevrons.add(m);
  }
  group.add(chevrons);

  // marker: a small target ring + four corner ticks, pivoted at the landing spot
  const marker = new THREE.Group();
  marker.name = 'wormMarker';
  const mkMat = new THREE.MeshBasicMaterial({
    color: DUST.hot, transparent: true, opacity: 0.95, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  });
  const mk = new THREE.Mesh(new THREE.RingGeometry(1.55, 1.95, 16), mkMat);
  mk.rotation.x = -Math.PI / 2;
  mk.position.y = 0.07;
  mk.renderOrder = 5;
  marker.add(mk);
  // dark under-ring: a cream pixel-outlined halo so the marker survives pale sand, not
  // only asphalt (the HUD's trick for cream-on-anything)
  const haloMat = new THREE.MeshBasicMaterial({ color: 0x2a1c10, transparent: true, opacity: 0.45, depthWrite: false, toneMapped: false });
  const halo = new THREE.Mesh(new THREE.RingGeometry(1.95, 2.35, 16), haloMat);
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.065;
  halo.renderOrder = 4;
  marker.add(halo);
  // a short chevron inside the ring shows the heading the car keeps on landing
  // (the group already faces forward: line the head up with local +z)
  // bright arrow inside the ring plus dark shadow pairs beyond it: a 1-frame read
  // bright arrow inside the ring: the landing frame (pre-rotated flat on -z ground)
  const arrow = new THREE.ShapeGeometry(new THREE.Shape([
    new THREE.Vector2(0.36, 0),
    new THREE.Vector2(-0.20, 0.26),
    new THREE.Vector2(-0.04, 0),
    new THREE.Vector2(-0.20, -0.26),
  ]));
  arrow.rotateX(-Math.PI / 2);
  const tip = new THREE.Mesh(arrow, mkMat);
  tip.position.set(0, 0.071, 0.30);
  tip.renderOrder = 5;
  marker.add(tip);
  const wing = new THREE.ShapeGeometry(new THREE.Shape([
    new THREE.Vector2(0.30, 0),
    new THREE.Vector2(-0.14, 0.20),
    new THREE.Vector2(0.02, 0),
    new THREE.Vector2(-0.14, -0.20),
  ]));
  wing.rotateX(-Math.PI / 2);
  for (const s of [1, -1]) {
    const w = new THREE.Mesh(wing, haloMat);
    w.position.set(s * 1.45, 0.069, 0.30);
    w.renderOrder = 4;
    marker.add(w);
  }
  group.add(marker);

  return {
    group,
    radius,
    place(x, z, heading) {
      bed.position.set(x, 0.04, z);
      rim.position.set(x, 0.045, z);
      chevrons.position.set(x, 0, z);
      // chevrons sit on the forward (-z) side; forward for the car is -x sin(h), -z cos(h)
      chevrons.rotation.y = heading;
      marker.position.set(x, 0, z);
    },
    marker(x, z) {
      const ox = -bed.position.x, oz = -bed.position.z;
      const d = Math.hypot(x + ox, z + oz);
      const k = d > radius ? radius / d : 1;
      marker.position.set(bed.position.x - ox * k, 0.07, bed.position.z - oz * k);
    },
    show(on) { group.visible = on; },
    dispose() {
      group.removeFromParent();
      tex.dispose();
      for (const m of [bed, rim, mk, halo, tip, ...marker.children.filter((c) => c !== mk && c !== halo && c !== tip), ...chevrons.children]) {
        const mesh = m as THREE.Mesh;
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
      chevMat.dispose();
      mkMat.dispose();
      haloMat.dispose();
    },
  };
}

/**
 * The departure/arrival dust burst used at the two ends of a placement: a rising, expanding
 * column of sand puffs. Allocation-free after construction; caller ticks it with dt.
 */
export class WormDustBurst {
  readonly group = new THREE.Group();
  private parts: { mesh: THREE.Mesh; ang: number; r0: number; vy: number; size: number }[] = [];
  private mat: THREE.MeshBasicMaterial;
  private tex: THREE.CanvasTexture;
  private life = 0;
  private readonly max = 0.5;

  constructor(count = 14) {
    this.tex = dustTexture(16);
    this.mat = new THREE.MeshBasicMaterial({
      map: this.tex, color: DUST.sand, transparent: true, opacity: 0,
      depthWrite: false, toneMapped: false,
    });
    // one shared quad: 12 triangles of billboard would alias into teeth at 360p
    const puffGeo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(puffGeo, this.mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 6;
      mesh.visible = false;
      this.group.add(mesh);
      const ang = (i / count) * Math.PI * 2 + (i % 3) * 0.31;
      this.parts.push({ mesh, ang, r0: 0.5 + (i % 4) * 0.22, vy: 0.25 + (i % 5) * 0.09, size: 1.1 + (i % 3) * 0.45 });
    }
    this.group.visible = false;
  }

  /** Fire at a landing spot; `hot` is the brighter arrival flavour. */
  burst(x: number, z: number, hot = false) {
    this.group.visible = true;
    this.life = this.max;
    this.mat.color.setHex(hot ? DUST.hot : DUST.sand);
    this.mat.opacity = hot ? 0.9 : 0.75;
    this.group.position.set(x, 0, z);
    for (const p of this.parts) p.mesh.visible = true;
  }

  update(dt: number) {
    if (this.life <= 0) return;
    this.life -= dt;
    const k = Math.max(0, this.life) / this.max;      // 1 → 0
    this.mat.opacity = 0.85 * k;
    const s = 1 + (1 - k) * 1.6;
    for (const p of this.parts) {
      const m = p.mesh;
      m.scale.setScalar(p.size * s);
      m.position.set(Math.cos(p.ang) * (p.r0 + (1 - k) * 1.8), p.vy * (1 - k) + 0.08, Math.sin(p.ang) * (p.r0 + (1 - k) * 1.8));
    }
    if (this.life <= 0) {
      this.group.visible = false;
      for (const p of this.parts) p.mesh.visible = false;
    }
  }

  dispose() {
    this.group.removeFromParent();
    this.mat.dispose();
    this.tex.dispose();
    this.parts[0]?.mesh.geometry.dispose();
  }
}
