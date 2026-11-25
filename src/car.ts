import * as THREE from 'three';
import { buildCarModel, CAR_VARIANTS } from './carModel';
import { CAR_POWERS, type CarPower } from './powers';
import type { World } from './world';
import { DUST } from './wormFx';

const WHEELBASE = 1.75;
const MAX_STEER = 0.64;

export interface CarControls {
  throttle: number;   // -1 … 1
  steer: number;      // +1 = left
  handbrake: boolean;
}

export class Car {
  x = 0;
  z = 0;
  heading = 0;
  groundY = 0;
  trackIndex = 0;
  vx = 0;
  vz = 0;
  steerAngle = 0;
  speed = 0;          // forward speed, units/s
  slip = 0;           // |lateral velocity|
  drifting = false;
  onRoad = true;
  onKerb = false;
  group = new THREE.Group();
  tilt = new THREE.Group();
  model!: THREE.Group;
  pitch = 0;
  variant = 0;
  driftScore = 0;
  onImpact?: (strength: number) => void;
  private skidTimer = 0;
  powerTime = 0;
  powerCd = 0;
  private fxLight!: THREE.PointLight;
  private fxRing!: THREE.Mesh;
  private fxRingMat!: THREE.MeshBasicMaterial;
  private fxBolts!: THREE.Group;
  private fxBoltMat!: THREE.MeshBasicMaterial;
  private fxBoltSegs: THREE.Mesh[] = [];
  private fxOrbs!: THREE.Group;
  private fxOrbMat!: THREE.MeshBasicMaterial;
  private fxOrbMeshes: THREE.Mesh[] = [];
  private fxTimer = 0;
  private ghostOn = false;
  private glowOn = false;
  powerCharge = 0;
  /** TUNNEL aim mode: the sim is frozen and main is placing the car */
  aiming = false;
  private wormRings: THREE.Group[] = [];
  private wormMats: THREE.MeshBasicMaterial[] = [];
  private wormRimMats: THREE.MeshBasicMaterial[] = [];
  private wormLife: number[] = [];
  private fxFlash = 0;
  private arrivalRing!: THREE.Mesh;
  private arrivalRingMat!: THREE.MeshBasicMaterial;

  get power(): CarPower {
    return CAR_POWERS[this.variant] ?? CAR_POWERS[0];
  }

  get powerActive(): boolean {
    return this.powerTime > 0;
  }

  get powerReady(): boolean {
    return this.powerCd <= 0;
  }

  async init(world: World) {
    this.group.add(this.tilt);
    await this.setSkin('car-dirs');
    this.initFx();
    this.x = world.start.x;
    this.z = world.start.z;
    this.heading = world.start.heading;
    return this;
  }

  async setSkin(_file: string) {
    if (this.model) this.tilt.remove(this.model);
    this.model = buildCarModel(this.variant);
    this.model.rotation.y = Math.PI;   // the model is built nose toward +Z
    this.tilt.add(this.model);
    this.ghostOn = false;
    this.glowOn = false;
  }

  setVariant(v: number) {
    this.variant = ((v % CAR_VARIANTS) + CAR_VARIANTS) % CAR_VARIANTS;
    this.powerTime = 0;
    this.powerCd = 0;
    this.powerCharge = 0;
    this.aiming = false;
    this.clearWormFx();
    void this.setSkin('car');
  }

  activatePower(world?: World): boolean {
    if (this.powerCd > 0) return false;
    const p = this.power;
    if (p.aim && world) {
      this.aiming = true;   // the wrap opens: freeze and aim a placement
      return true;
    }
    this.powerTime = p.duration;
    this.powerCd = p.cooldown;
    this.powerCharge = 0;
    if (p.burst) {
      this.vx += -Math.sin(this.heading) * p.burst;
      this.vz += -Math.cos(this.heading) * p.burst;
    }
    if (p.blink && world) {
      const fx = -Math.sin(this.heading), fz = -Math.cos(this.heading);
      this.dropWormRing(world, this.x, this.z);   // departure portal stays behind
      this.x += fx * p.blink;
      this.z += fz * p.blink;
      this.collide(world, false);                 // never arrive inside a wall
      this.fxFlash = 0.38;                        // arrival ground-ring flash
    }
    return true;
  }

  /** Place the car at the aimed point, clamped inside the blink radius. */
  confirmAim(world: World, x: number, z: number): boolean {
    if (!this.aiming) return false;
    const p = this.power;
    let dx = x - this.x, dz = z - this.z;
    const d = Math.hypot(dx, dz);
    const r = p.blink ?? 14;
    if (d > r) { dx *= r / d; dz *= r / d; }
    this.aiming = false;
    this.dropWormRing(world, this.x, this.z);     // the sand bursts where we left
    this.x += dx;
    this.z += dz;
    this.collide(world, false);                   // never arrive inside a wall
    this.fxFlash = 0.38;                          // arrival ground-ring flash
    this.powerTime = p.duration;
    this.powerCd = p.cooldown;
    this.powerCharge = 0;
    return true;
  }

  /** Close the wrap without spending the cooldown. */
  cancelAim(): boolean {
    if (!this.aiming) return false;
    this.aiming = false;
    return true;
  }

  prevVariant() {
    this.setVariant(this.variant - 1);
  }

  nextVariant() {
    this.setVariant(this.variant + 1);
  }

  reset(world: World) {
    this.x = world.start.x;
    this.z = world.start.z;
    this.heading = world.start.heading;
    this.vx = this.vz = 0;
    this.steerAngle = 0;
    this.driftScore = 0;
    this.groundY = 0;
    this.trackIndex = 0;
    this.pitch = 0;
    this.powerTime = 0;
    this.powerCd = 0;
    this.powerCharge = 0;
    this.aiming = false;
    this.setGhost(false);
    this.clearWormFx();
    this.sync();
  }

  private sync() {
    this.group.position.set(this.x, this.groundY, this.z);
    this.group.rotation.y = this.heading;
    this.tilt.rotation.x = this.pitch;
  }

  update(dt: number, c: CarControls, world: World) {
    const fx = -Math.sin(this.heading), fz = -Math.cos(this.heading);
    const rx = Math.cos(this.heading), rz = -Math.sin(this.heading);
    let vLong = this.vx * fx + this.vz * fz;
    let vLat = this.vx * rx + this.vz * rz;

    this.onRoad = world.roadAt(this.x, this.z);
    this.onKerb = world.kerbAt(this.x, this.z);
    const surface = this.onRoad ? 1 : 0.62;

    const power = this.power;
    const powered = this.powerTime > 0;
    const speedK = powered ? power.speed : 1;
    const accelK = powered ? power.accel : 1;

    // engine / brakes
    const throttle = c.throttle;
    if (throttle > 0) {
      const top = 30 * surface * speedK;
      if (vLong < top) vLong += 21 * throttle * surface * accelK * dt;
    } else if (throttle < 0) {
      if (vLong > 0.6) vLong -= 34 * dt;
      else if (vLong > -10) vLong += 13 * throttle * surface * dt;
    }
    // rolling drag
    const drag = this.onRoad ? 0.55 : 2.1;
    vLong -= vLong * drag * dt;
    vLong = THREE.MathUtils.clamp(vLong, -10, 32 * speedK);

    // steering: less lock at speed, smooth into it
    // less lock the faster you go: full lock at a crawl, ~18deg at top speed
    const lock = MAX_STEER * (1 - 0.68 * Math.min(1, Math.abs(vLong) / 24)) * (powered ? power.steer : 1);
    const target = c.steer * lock;
    this.steerAngle += (target - this.steerAngle) * Math.min(1, dt * 9);

    const yawRate = (vLong / WHEELBASE) * Math.tan(this.steerAngle);
    this.heading += yawRate * dt;

    // lateral grip: low grip = the car keeps its old velocity while the nose turns
    const gripK = powered ? (power.driftGrip ?? power.grip) : 1;
    const grip = (c.handbrake ? 2.1 : this.onRoad ? 9.5 : 5.0) * gripK;
    vLat *= Math.exp(-grip * dt);
    if (c.handbrake && Math.abs(vLong) > 4) vLat += -yawRate * 0.55 * dt * Math.abs(vLong);

    // recompose in the old frame, then the rotation above produces slip next step
    this.vx = fx * vLong + rx * vLat;
    this.vz = fz * vLong + rz * vLat;

    this.x += this.vx * dt;
    this.z += this.vz * dt;

    this.collide(world, powered && !!power.ghost);

    const sp = Math.hypot(this.vx, this.vz);
    this.speed = vLong;
    this.slip = Math.abs(vLat);
    this.drifting = this.slip > 2.4 && sp > 5;

    if (this.drifting) {
      this.driftScore += this.slip * dt * 12 * (powered ? (power.driftScore ?? 1) : 1);
      if (powered && power.driftScore) {
        this.powerCharge = Math.min(40, this.powerCharge + this.slip * dt * 10);
      }
    } else this.driftScore = Math.max(0, this.driftScore - dt * 26);

    // skid marks + dust from the rear wheels
    this.skidTimer -= dt;
    if (this.drifting && this.skidTimer <= 0) {
      this.skidTimer = 0.028;
      const bx = this.x + fx * -1.05, bz = this.z + fz * -1.05;
      world.addSkid(bx + rx * 0.55, bz + rz * 0.55, this.heading, this.slip / 8);
      world.addSkid(bx - rx * 0.55, bz - rz * 0.55, this.heading, this.slip / 8);
    }

    const wasPowered = this.powerTime > 0;
    this.groundY = world.groundAt ? world.groundAt(this.x, this.z, this.heading, this.trackIndex) : 0;
    if (world.groundAt) {
      const half = 0.9;
      const hF = world.groundAt(this.x + fx * half, this.z + fz * half, this.heading, this.trackIndex);
      const hB = world.groundAt(this.x - fx * half, this.z - fz * half, this.heading, this.trackIndex);
      const targetPitch = this.groundY > 0.02 ? Math.atan2(hF - hB, half * 2) : 0;
      this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * (this.groundY > 0.02 ? 8 : 14));
    } else {
      this.pitch += (0 - this.pitch) * Math.min(1, dt * 8);
    }
    this.powerTime = Math.max(0, this.powerTime - dt);
    this.powerCd = Math.max(0, this.powerCd - dt);
    if (wasPowered && this.powerTime <= 0 && power.exitBoost && this.powerCharge > 0) {
      const boost = Math.min(11, this.powerCharge * power.exitBoost * 0.28);
      this.vx += fx * boost;
      this.vz += fz * boost;
    }
    if (!powered) this.powerCharge = 0;
    this.updateFx(dt);

    this.sync();
    const wheels = (this.model.userData.wheels as THREE.Object3D[] | undefined) ?? [];
    for (const w of wheels) w.rotation.x -= (vLong * dt) / 0.33;

    // front wheels steer, brake lights glow on the pedal / handbrake
    const mounts = (this.model.userData.frontMounts as THREE.Object3D[] | undefined) ?? [];
    for (const m of mounts) {
      if (m.userData.baseY === undefined) m.userData.baseY = m.rotation.y;
      m.rotation.y = m.userData.baseY + this.steerAngle;
    }
    const brakes = (this.model.userData.brakes as THREE.Mesh[] | undefined) ?? [];
    const lit = c.throttle < -0.05 || c.handbrake;
    for (const b of brakes) {
      const mat = b.material as THREE.MeshLambertMaterial;
      mat.emissiveIntensity = lit ? 3.2 : 0.5;
    }
    const t = performance.now() * 0.001;
    this.model.position.y = Math.sin(t * 46) * 0.0016 * Math.min(1, Math.abs(vLong) / 8);
  }

  /** Yellow/coloured glow, ground ring and pixel lightning bolts. */
  private initFx() {
    if (this.fxLight) return;
    const p = this.power;
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

    this.fxRingMat = new THREE.MeshBasicMaterial({
      map: tex, color: p.color, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    this.fxRing = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 4.4), this.fxRingMat);
    this.fxRing.rotation.x = -Math.PI / 2;
    this.fxRing.position.y = 0.03;
    this.fxRing.renderOrder = 2;
    this.group.add(this.fxRing);
    // arrival burst: a bright ground disc under the car that only the flash lights up
    this.arrivalRingMat = new THREE.MeshBasicMaterial({
      map: tex, color: p.color, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    this.arrivalRing = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.arrivalRingMat);
    this.arrivalRing.rotation.x = -Math.PI / 2;
    this.arrivalRing.position.y = 0.06;
    this.arrivalRing.renderOrder = 4;
    this.arrivalRing.visible = false;
    this.group.add(this.arrivalRing);

    this.fxLight = new THREE.PointLight(p.color, 0, 15, 2);
    this.fxLight.position.set(0, 0.9, 0);
    this.group.add(this.fxLight);

    this.fxBoltMat = new THREE.MeshBasicMaterial({
      color: 0xfff08a, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    const boltGeo = new THREE.BoxGeometry(1, 0.14, 0.14);
    this.fxBolts = new THREE.Group();
    this.fxBoltSegs = [];
    for (let i = 0; i < 6 * 5; i++) {
      const seg = new THREE.Mesh(boltGeo, this.fxBoltMat);
      seg.visible = false;
      seg.frustumCulled = false;
      this.fxBoltSegs.push(seg);
      this.fxBolts.add(seg);
    }
    this.fxBolts.visible = false;
    this.group.add(this.fxBolts);

    this.fxOrbMat = new THREE.MeshBasicMaterial({
      color: p.color, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    this.fxOrbs = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.21, 0), this.fxOrbMat);
      orb.visible = false;
      this.fxOrbMeshes.push(orb);
      this.fxOrbs.add(orb);
    }
    this.fxOrbs.visible = false;
    this.group.add(this.fxOrbs);
  }

  private updateFx(dt: number) {
    if (!this.fxLight) return;
    const p = this.power;
    const on = this.powerTime > 0;
    const t = performance.now() * 0.001;
    const flash = Math.max(0, this.fxFlash) / 0.38;
    this.fxFlash = Math.max(0, this.fxFlash - dt);
    this.fxLight.color.setHex(p.color);
    this.fxLight.intensity = (on ? 3.0 + Math.sin(t * 34) * 1.3 : 0) + 5.0 * flash;
    // tunnel flashes wear straw, not amber: the sand glow separates from the orange body trim
    const dustFlavour = !!p.blink;
    if (dustFlavour) {
      this.fxRingMat.color.setHex(DUST.hot);
      this.arrivalRingMat.color.setHex(DUST.hot);
      this.fxLight.color.setHex(DUST.amber);
    }
    const pulse = on ? 0.34 + Math.sin(t * 16) * 0.10 : 0;
    this.fxRingMat.opacity = flash > 0 ? Math.max(pulse, 0.95 * flash) : pulse;
    this.fxRing.scale.setScalar(
      flash > 0 ? 0.5 + (1 - flash) * 1.5 : on ? 1 + Math.sin(t * 9) * 0.10 : 1,
    );
    // tunnel arrival: the burst must out-shout the power glow under the car, not sit in it
    const burst = p.blink && flash > 0 ? flash : 0;
    this.arrivalRing.visible = burst > 0;
    if (burst > 0) {
      this.arrivalRingMat.opacity = 0.95 * burst;
      this.arrivalRing.scale.setScalar(0.15 + (1 - burst) * 2.9);
    }
    for (let i = 0; i < this.wormRings.length; i++) {
      if (this.wormLife[i] <= 0) continue;
      this.wormLife[i] -= dt;
      const k = Math.max(0, this.wormLife[i]) / 0.55;
      const ring = this.wormRings[i];
      ring.visible = this.wormLife[i] > 0;
      ring.scale.setScalar(0.72 + (1 - k) * 0.55);
      this.wormMats[i].opacity = Math.min(0.95, k * 1.6);
    }
    this.fxBolts.visible = on && !!p.zap;
    this.fxOrbs.visible = on && !!p.orbs;
    this.fxOrbMat.color.setHex(p.color);
    if (this.fxOrbs.visible) {
      for (let i = 0; i < this.fxOrbMeshes.length; i++) {
        const a = t * 2.2 + (i / this.fxOrbMeshes.length) * Math.PI * 2;
        const r = 1.75 + Math.sin(t * 3 + i * 2) * 0.14;
        const orb = this.fxOrbMeshes[i];
        orb.position.set(Math.cos(a) * r, 0.86 + Math.sin(t * 4 + i) * 0.22, Math.sin(a) * r);
        orb.rotation.set(t * 1.7 + i, t * 2.1 + i, 0);
        orb.visible = true;
      }
    }
    this.setGlow(on);
    this.setGhost(on && !!p.ghost);

    this.fxTimer -= dt;
    if (this.fxBolts.visible && this.fxTimer <= 0) {
      this.fxTimer = 0.045;
      this.writeBolts(t);
      this.fxBoltMat.opacity = 0.65 + Math.random() * 0.35;
      this.fxBoltMat.color.setHex(Math.random() > 0.35 ? 0xfff08a : 0xffe14a);
    }
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
        a.set(px, py, pz); b.set(nx, ny, nz);
        const dir = b.clone().sub(a);
        const len = dir.length() || 0.001;
        const seg = this.fxBoltSegs[n++];
        seg.position.copy(a).addScaledVector(dir, 0.5);
        seg.scale.set(len, 0.14, 0.14);
        seg.quaternion.setFromUnitVectors(up, dir.normalize());
        seg.visible = true;
        px = nx; py = ny; pz = nz;
      }
    }
  }

  /** Tint the body material so the paint itself glows. */
  private setGlow(on: boolean) {
    if (on === this.glowOn) return;
    this.glowOn = on;
    const body = this.model?.getObjectByName('body') as THREE.Mesh | undefined;
    if (!body) return;
    const mats = Array.isArray(body.material) ? body.material : [body.material];
    for (const m of mats) {
      const lm = m as THREE.MeshLambertMaterial;
      if (!lm.emissive) continue;
      lm.emissive.setHex(on ? this.power.color : 0x000000);
      lm.emissiveIntensity = on ? (this.power.zap ? 0.45 : 0.30) : 0;
    }
  }

  /** Night Cloak: fade the body while the power is active. */
  private setGhost(on: boolean) {
    if (on === this.ghostOn) return;
    this.ghostOn = on;
    if (!this.model) return;
    this.model.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        mat.transparent = on;
        mat.opacity = on ? 0.45 : 1;
        mat.depthWrite = !on;
        mat.needsUpdate = true;
      }
    });
  }

  /** Park a dust-vortex mouth on the ground where the tunnel opened. */
  private dropWormRing(world: World, x: number, z: number) {
    if (this.wormRings.length === 0) {
      for (let i = 0; i < 3; i++) {
        const mat = new THREE.MeshBasicMaterial({
          color: this.power.color, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
        });
        // sandstone outer torus, amber inner torus: the ring reads as a kicked-up pit of dirt
        const rimMat = new THREE.MeshBasicMaterial({
          color: DUST.sand, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
        });
        const ring = new THREE.Group();
        ring.visible = false;
        ring.renderOrder = 3;
        const outer = new THREE.Mesh(new THREE.TorusGeometry(1.85, 0.16, 5, 26), rimMat);
        outer.rotation.x = -Math.PI / 2;
        const inner = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.10, 4, 20), mat);
        inner.rotation.x = -Math.PI / 2;
        ring.add(outer, inner);
        this.wormRimMats.push(rimMat);
        this.wormRings.push(ring);
        this.wormMats.push(mat);
        this.wormLife.push(0);
        world.group.add(ring);
      }
    }
    let s = 0;
    for (let i = 1; i < this.wormRings.length; i++) {
      if (this.wormLife[i] < this.wormLife[s]) s = i;
    }
    this.wormMats[s].color.setHex(DUST.amber);     // inner torus: bright sand
    this.wormMats[s].opacity = 0.95;
    this.wormRimMats[s].opacity = 0.8;             // outer torus keeps its sandstone colour
    const ring = this.wormRings[s];
    ring.position.set(x, 0.05, z);
    ring.scale.setScalar(0.72);
    ring.visible = true;
    this.wormLife[s] = 0.55;
  }

  private clearWormFx() {
    this.fxFlash = 0;
    for (let i = 0; i < this.wormRings.length; i++) this.wormLife[i] = 0;
    for (const r of this.wormRings) r.visible = false;
  }

  private collide(world: World, ghost = false) {
    const R = 1.9;   // the car is 4.6 long, a 1.15 circle let the nose clip through barriers
    const hit = (c: { x: number; z: number; r: number }) => {
      const dx = this.x - c.x, dz = this.z - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + R;
      if (d < min && d > 1e-4) {
        const nx = dx / d, nz = dz / d;
        this.x = c.x + nx * min;
        this.z = c.z + nz * min;
        const vn = this.vx * nx + this.vz * nz;
        if (vn < 0) {
          this.vx -= vn * nx * 1.4;
          this.vz -= vn * nz * 1.4;
          if (-vn > 2 && this.onImpact) this.onImpact(Math.min(1, -vn / 14));
        }
      }
    };
    if (!ghost) for (const c of world.colliders) hit(c);
    if (!ghost && this.groundY > 0.8) for (const c of world.bridgeColliders ?? []) hit(c);
    const edge = 82;
    if (Math.abs(this.x) > edge) { this.x = Math.sign(this.x) * edge; this.vx *= -0.3; }
    if (Math.abs(this.z) > edge) { this.z = Math.sign(this.z) * edge; this.vz *= -0.3; }
  }
}
