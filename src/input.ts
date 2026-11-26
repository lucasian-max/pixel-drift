import type { CarControls } from './car';

export class Input {
  private keys = new Set<string>();
  steer = 0;
  throttle = 0;
  handbrake = false;
  look = 0;          // -1 … 1, rotates the camera
  zoom = 0;          // accumulated wheel input
  resetPressed = false;
  paused = false;
  device: 'keyboard' | 'gamepad' | 'mixed' = 'keyboard';

  constructor() {
    addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (e.code === 'KeyR') this.resetPressed = true;
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('wheel', (e) => { this.zoom += e.deltaY * 0.0015; }, { passive: true });

    const pad = () => navigator.getGamepads?.()[0] ?? null;
    this.pad = pad();
    addEventListener('gamepadconnected', () => { this.pad = pad(); });
  }

  private pad: Gamepad | null = null;

  read(): CarControls {
    const k = this.keys;
    let steer = 0, throttle = 0, hb = false;
    let usedKeys = false;
    if (k.has('KeyA') || k.has('ArrowLeft')) { steer += 1; usedKeys = true; }
    if (k.has('KeyD') || k.has('ArrowRight')) { steer -= 1; usedKeys = true; }
    if (k.has('KeyW') || k.has('ArrowUp')) { throttle += 1; usedKeys = true; }
    if (k.has('KeyS') || k.has('ArrowDown')) { throttle -= 1; usedKeys = true; }
    if (k.has('Space')) { hb = true; usedKeys = true; }
    if (k.has('ShiftLeft') || k.has('ShiftRight')) { throttle = Math.min(1, throttle + 0.35); usedKeys = true; }
    this.look = 0;
    if (k.has('KeyQ')) this.look -= 1;
    if (k.has('KeyE')) this.look += 1;

    this.pad = navigator.getGamepads?.()[0] ?? this.pad;
    const p = this.pad;
    let usedPad = false;
    if (p) {
      const ax = p.axes[0] ?? 0;
      const rt = p.buttons[7]?.value ?? 0;
      const lt = p.buttons[6]?.value ?? 0;
      if (Math.abs(ax) > 0.12) { steer -= ax; usedPad = true; }
      if (rt > 0.02 || lt > 0.02) usedPad = true;
      throttle += rt - lt;
      if (p.buttons[0]?.pressed || p.buttons[5]?.pressed) { hb = true; usedPad = true; }
      this.look += (p.buttons[4]?.pressed ? -1 : 0) + (p.buttons[5]?.pressed ? 1 : 0);
    }
    if (usedKeys || usedPad) {
      this.device = usedKeys && usedPad ? 'mixed' : usedPad ? 'gamepad' : 'keyboard';
    }

    this.steer = clamp(steer, -1, 1);
    this.throttle = clamp(throttle, -1, 1);
    this.handbrake = hb;
    return { throttle: this.throttle, steer: this.steer, handbrake: this.handbrake };
  }

  /** drop queued presses, e.g. F pressed on the title before the race starts */
  forget(...codes: string[]) {
    for (const code of codes) this.keys.delete(code);
  }

  /** true once per physical press */
  consumeKey(code: string) {
    if (!this.keys.has(code)) return false;
    this.keys.delete(code);
    return true;
  }

  consumeReset() {
    const r = this.resetPressed;
    this.resetPressed = false;
    return r;
  }
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
