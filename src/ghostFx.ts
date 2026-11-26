/* src/ghostFx.ts — the ghost car shows its powers the way the player car does.

   A record's trace carries power marks ('blink' placements, 'power'
   firings); while the replay clock sits inside one of those windows this rig
   lights the ghost up: orbiting pearls for PEARL DRIFT, pixel lightning for
   THUNDERCLAP, a dust burst for a TUNNEL blink — plus the pulsing ground
   ring, the point light and the glowing paint the player's own car gets.
   The visuals mirror src/car.ts's updateFx() deliberately: the ghost should
   read as "me, but faster", not as a different renderer's idea of a power. */

import * as THREE from 'three';
import { CAR_POWERS } from './powers';
import { DUST } from './wormFx';

const FLASH = 0.38;   // seconds of activation burst

export class GhostFx {
  private p: (typeof CAR_POWERS)[number];
  private light: THREE.PointLight;
  private ringMat: THREE.MeshBasicMaterial;
  private ring: THREE.Mesh;
  private arrivalMat: THREE.MeshBasicMaterial;
  private arrival: THREE.Mesh;
  private orbMat: THREE.MeshBasicMaterial;
  private orbs: THREE.Group;
  private orbMeshes: THREE.Mesh[] = [];
  private boltMat: THREE.MeshBasicMaterial;
  private bolts: THREE.Group;
  private boltSegs: THREE.Mesh[] = [];
  private boltTimer = 0;
  private glowOn = false;

  constructor(parent: THREE.Group, variant: number) {
    this.p = CAR_POWERS[variant] ?? CAR_POWERS[0];
    // the same radial ground glow the car rig paints on a 64x64 canvas
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d')!;
    const grd = g.createRadialGradient(32, 32, 3, 32, 32, 31);
    grd.addColorStop(0, 'rgba(255,255,255,0.95)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;

    this.ringMat = new THREE.MeshBasicMaterial({
      map: tex, color: this.p.color, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 4.4), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.03;
    this.ring.renderOrder = 2;
    parent.add(this.ring);

    // the blink arrival burst: a bright disc that only the flash lights up
    this.arrivalMat = new THREE.MeshBasicMaterial({
      map: tex, color: this.p.color, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    this.arrival = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.arrivalMat);
    this.arrival.rotation.x = -Math.PI / 2;
    this.arrival.position.y = 0.06;
    this.arrival.renderOrder = 4;
    this.arrival.visible = false;
    parent.add(this.arrival);

    this.light = new THREE.PointLight(this.p.color, 0, 15, 2);
    this.light.position.set(0, 0.9, 0);
    parent.add(this.light);

    this.boltMat = new THREE.MeshBasicMaterial({
      color: 0xfff08a, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    const boltGeo = new THREE.BoxGeometry(1, 0.14, 0.14);
    this.bolts = new THREE.Group();
    for (let i = 0; i < 6 * 5; i++) {
      const seg = new THREE.Mesh(boltGeo, this.boltMat);
      seg.visible = false;
      seg.frustumCulled = false;
      this.boltSegs.push(seg);
      this.bolts.add(seg);
    }
    this.bolts.visible = false;
    parent.add(this.bolts);

    this.orbMat = new THREE.MeshBasicMaterial({
      color: this.p.color, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    this.orbs = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.21, 0), this.orbMat);
      orb.visible = false;
      this.orbMeshes.push(orb);
      this.orbs.add(orb);
    }
    this.orbs.visible = false;
    parent.add(this.orbs);
  }

  /** `on` = the replay clock sits in a power window; `flash` = activation seconds left. */
  update(dt: number, on: boolean, flash: number) {
    const t = performance.now() * 0.001;
    const f = Math.max(0, Math.min(1, flash / FLASH));
    this.light.color.setHex(this.p.color);
    this.light.intensity = (on ? 3.0 + Math.sin(t * 34) * 1.3 : 0) + 5.0 * f;
    // a blink wears straw tones, same as the player's arrival burst
    if (this.p.blink) {
      this.ringMat.color.setHex(DUST.hot);
      this.arrivalMat.color.setHex(DUST.hot);
      this.light.color.setHex(DUST.amber);
    }
    const pulse = on ? 0.34 + Math.sin(t * 16) * 0.10 : 0;
    this.ringMat.opacity = f > 0 ? Math.max(pulse, 0.95 * f) : pulse;
    this.ring.scale.setScalar(f > 0 ? 0.5 + (1 - f) * 1.5 : on ? 1 + Math.sin(t * 9) * 0.10 : 1);
    const burst = this.p.blink && f > 0 ? f : 0;
    this.arrival.visible = burst > 0;
    if (burst > 0) {
      this.arrivalMat.opacity = 0.95 * burst;
      this.arrival.scale.setScalar(0.15 + (1 - burst) * 2.9);
    }
    this.bolts.visible = on && !!this.p.zap;
    this.orbs.visible = on && !!this.p.orbs;
    if (this.orbs.visible) {
      for (let i = 0; i < this.orbMeshes.length; i++) {
        const a = t * 2.2 + (i / this.orbMeshes.length) * Math.PI * 2;
        const r = 1.75 + Math.sin(t * 3 + i * 2) * 0.14;
        const orb = this.orbMeshes[i];
        orb.position.set(Math.cos(a) * r, 0.86 + Math.sin(t * 4 + i) * 0.22, Math.sin(a) * r);
        orb.rotation.set(t * 1.7 + i, t * 2.1 + i, 0);
        orb.visible = true;
      }
    }
    this.setGlow(on || f > 0);
    this.boltTimer -= dt;
    if (this.bolts.visible && this.boltTimer <= 0) {
      this.boltTimer = 0.045;
      this.writeBolts(t);
      this.boltMat.opacity = 0.65 + Math.random() * 0.35;
      this.boltMat.color.setHex(Math.random() > 0.35 ? 0xfff08a : 0xffe14a);
    }
    if (!on && f === 0) this.bolts.visible = false;
  }

  /** Local-space pixel lightning: six jagged arcs from roof to ground. */
  private writeBolts(t: number) {
    const up = new THREE.Vector3(1, 0, 0);
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    let n = 0;
    for (let bolt = 0; bolt < 6; bolt++) {
      const a0 = (bolt / 6) * Math.PI * 2 + t * 0.7;
      let px = Math.cos(a0) * 2.2;
      let pz = Math.sin(a0) * 2.2;
      let py = 1.42;
      for (let s = 0; s < 5; s++) {
        const f = (s + 1) / 5;
        const ang = a0 + f * 0.40;
        const nx = Math.cos(ang) * (2.2 + f * 0.65) + (Math.random() - 0.5) * 0.55;
        const nz = Math.sin(ang) * (2.2 + f * 0.65) + (Math.random() - 0.5) * 0.55;
        const ny = 1.42 * (1 - f) + 0.05 * f;
        a.set(px, py, pz);
        b.set(nx, ny, nz);
        const dir = b.clone().sub(a);
        const len = dir.length() || 0.001;
        const seg = this.boltSegs[n++];
        seg.position.copy(a).addScaledVector(dir, 0.5);
        seg.scale.set(len, 0.14, 0.14);
        seg.quaternion.setFromUnitVectors(up, dir.normalize());
        seg.visible = true;
        px = nx; py = ny; pz = nz;
      }
    }
  }

  /** Tint the ghost body so the paint glows while the power runs. */
  private setGlow(on: boolean) {
    if (on === this.glowOn) return;
    this.glowOn = on;
    const body = this.ring.parent?.getObjectByName('body') as THREE.Mesh | undefined;
    if (!body) return;
    const mats = Array.isArray(body.material) ? body.material : [body.material];
    for (const m of mats) {
      const lm = m as THREE.MeshLambertMaterial;
      if (!lm.emissive) continue;
      lm.emissive.setHex(on ? this.p.color : 0x000000);
      lm.emissiveIntensity = on ? (this.p.zap ? 0.45 : 0.30) : 0;
    }
  }
}
