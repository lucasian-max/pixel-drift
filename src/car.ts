import * as THREE from 'three';
import { loadSheet, SpriteStack, type StackDef } from './stack';
import type { World } from './world';

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
  vx = 0;
  vz = 0;
  steerAngle = 0;
  speed = 0;          // forward speed, units/s
  slip = 0;           // |lateral velocity|
  drifting = false;
  onRoad = true;
  group = new THREE.Group();
  model!: SpriteStack;
  driftScore = 0;
  private skidTimer = 0;

  private def: StackDef = { layers: 28, sheetW: 48, sheetH: 76, worldW: 2.2, lift: 0.022 };

  async init(world: World) {
    await this.setSkin('car-red');
    this.x = world.start.x;
    this.z = world.start.z;
    this.heading = world.start.heading;
    return this;
  }

  async setSkin(file: string) {
    const sheet = await loadSheet(`/sprites/${file}.png`);
    if (this.model) this.group.remove(this.model);
    this.model = new SpriteStack(sheet, this.def);
    // the slice is drawn nose-up; this group's -Z is forward
    this.model.position.y = 0.02;
    this.group.add(this.model);
  }

  reset(world: World) {
    this.x = world.start.x;
    this.z = world.start.z;
    this.heading = world.start.heading;
    this.vx = this.vz = 0;
    this.steerAngle = 0;
    this.driftScore = 0;
    this.sync();
  }

  private sync() {
    this.group.position.set(this.x, 0, this.z);
    this.group.rotation.y = this.heading;
  }

  update(dt: number, c: CarControls, world: World) {
    const fx = -Math.sin(this.heading), fz = -Math.cos(this.heading);
    const rx = Math.cos(this.heading), rz = -Math.sin(this.heading);
    let vLong = this.vx * fx + this.vz * fz;
    let vLat = this.vx * rx + this.vz * rz;

    this.onRoad = world.roadAt(this.x, this.z);
    const surface = this.onRoad ? 1 : 0.62;

    // engine / brakes
    const throttle = c.throttle;
    if (throttle > 0) {
      const top = 30 * surface;
      if (vLong < top) vLong += 21 * throttle * surface * dt;
    } else if (throttle < 0) {
      if (vLong > 0.6) vLong -= 34 * dt;
      else if (vLong > -10) vLong += 13 * throttle * surface * dt;
    }
    // rolling drag
    const drag = this.onRoad ? 0.55 : 2.1;
    vLong -= vLong * drag * dt;
    vLong = THREE.MathUtils.clamp(vLong, -10, 32);

    // steering: less lock at speed, smooth into it
    // less lock the faster you go: full lock at a crawl, ~18deg at top speed
    const lock = MAX_STEER * (1 - 0.68 * Math.min(1, Math.abs(vLong) / 24));
    const target = c.steer * lock;
    this.steerAngle += (target - this.steerAngle) * Math.min(1, dt * 9);

    const yawRate = (vLong / WHEELBASE) * Math.tan(this.steerAngle);
    this.heading += yawRate * dt;

    // lateral grip: low grip = the car keeps its old velocity while the nose turns
    const grip = c.handbrake ? 2.1 : this.onRoad ? 9.5 : 5.0;
    vLat *= Math.exp(-grip * dt);
    if (c.handbrake && Math.abs(vLong) > 4) vLat += -yawRate * 0.55 * dt * Math.abs(vLong);

    // recompose in the old frame, then the rotation above produces slip next step
    this.vx = fx * vLong + rx * vLat;
    this.vz = fz * vLong + rz * vLat;

    this.x += this.vx * dt;
    this.z += this.vz * dt;

    this.collide(world);

    const sp = Math.hypot(this.vx, this.vz);
    this.speed = vLong;
    this.slip = Math.abs(vLat);
    this.drifting = this.slip > 2.4 && sp > 5;

    if (this.drifting) this.driftScore += this.slip * dt * 12;
    else this.driftScore = Math.max(0, this.driftScore - dt * 26);

    // skid marks + dust from the rear wheels
    this.skidTimer -= dt;
    if (this.drifting && this.skidTimer <= 0) {
      this.skidTimer = 0.028;
      const bx = this.x + fx * -1.05, bz = this.z + fz * -1.05;
      world.addSkid(bx + rx * 0.55, bz + rz * 0.55, this.heading, this.slip / 8);
      world.addSkid(bx - rx * 0.55, bz - rz * 0.55, this.heading, this.slip / 8);
    }

    this.sync();
    this.model.rotation.z = 0;
    // body roll: lean into the corner, tiny squash on bumps
    const roll = THREE.MathUtils.clamp(-yawRate * 0.03, -0.09, 0.09);
    this.model.rotation.z += (roll - this.model.rotation.z) * Math.min(1, dt * 8);
  }

  private collide(world: World) {
    const R = 1.15;
    for (const c of world.colliders) {
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
        }
      }
    }
    const edge = 44;
    if (Math.abs(this.x) > edge) { this.x = Math.sign(this.x) * edge; this.vx *= -0.3; }
    if (Math.abs(this.z) > edge) { this.z = Math.sign(this.z) * edge; this.vz *= -0.3; }
  }
}
