import type { Car } from './car';

/** Tiny synthesised engine + tyre squeal. No assets, starts on first input. */
export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engA!: OscillatorNode;
  private engB!: OscillatorNode;
  private engGain!: GainNode;
  private filter!: BiquadFilterNode;
  private squeal!: GainNode;
  private rumble!: GainNode;
  muted = false;

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(ctx.destination);

    // engine
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 700;
    this.filter.Q.value = 3;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0.0;
    this.engA = ctx.createOscillator();
    this.engA.type = 'sawtooth';
    this.engA.frequency.value = 60;
    this.engB = ctx.createOscillator();
    this.engB.type = 'square';
    this.engB.frequency.value = 90;
    const bGain = ctx.createGain();
    bGain.gain.value = 0.35;
    this.engA.connect(this.filter);
    this.engB.connect(bGain).connect(this.filter);
    this.filter.connect(this.engGain).connect(this.master);
    this.engA.start();
    this.engB.start();

    // noise source shared by squeal + rumble
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2100;
    bp.Q.value = 5;
    this.squeal = ctx.createGain();
    this.squeal.gain.value = 0;
    noise.connect(bp).connect(this.squeal).connect(this.master);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    this.rumble = ctx.createGain();
    this.rumble.gain.value = 0;
    noise.connect(lp).connect(this.rumble).connect(this.master);
    noise.start();

    addEventListener('keydown', (e) => {
      if (e.code === 'KeyM') {
        this.muted = !this.muted;
        this.master.gain.setTargetAtTime(this.muted ? 0 : 0.55, ctx.currentTime, 0.05);
      }
    });
  }

  update(car: Car, throttle: number, paused: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const sp = Math.abs(car.speed);
    const gearSpan = 9;
    const gearFrac = (sp % gearSpan) / gearSpan;
    const rpm = 0.35 + gearFrac * 0.65;
    const target = 46 + sp * 1.6 + rpm * 26;
    this.engA.frequency.setTargetAtTime(target, t, 0.06);
    this.engB.frequency.setTargetAtTime(target * 1.51, t, 0.06);
    this.filter.frequency.setTargetAtTime(420 + sp * 34 + throttle * 120, t, 0.08);

    const load = paused ? 0 : 0.022 + Math.abs(throttle) * 0.028 + sp * 0.0011;
    this.engGain.gain.setTargetAtTime(load, t, 0.08);

    const slip = Math.min(1, car.slip / 7);
    this.squeal.gain.setTargetAtTime(paused ? 0 : slip * 0.055 * Math.min(1, sp / 6), t, 0.05);
    this.rumble.gain.setTargetAtTime(paused || car.onRoad ? 0 : Math.min(0.06, sp * 0.0022), t, 0.1);
  }
}
