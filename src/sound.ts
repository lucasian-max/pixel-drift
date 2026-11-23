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
  private kerb!: GainNode;
  muted = false;
  private musicGain!: GainNode;
  private musicNext = 0;
  private musicStep = 0;
  private noiseBuf: AudioBuffer | null = null;

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

    // kerb: low, hollow rattle — the painted strip under two wheels
    const kp = ctx.createBiquadFilter();
    kp.type = 'bandpass';
    kp.frequency.value = 150;
    kp.Q.value = 0.7;
    this.kerb = ctx.createGain();
    this.kerb.gain.value = 0;
    noise.connect(kp).connect(this.kerb).connect(this.master);

    noise.start();
    this.noiseBuf = buf;

    // music bus, ducked under the engine
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.16;
    this.musicGain.connect(this.master);
    this.musicNext = ctx.currentTime + 0.2;

    addEventListener('keydown', (e) => {
      if (e.code === 'KeyM') {
        this.muted = !this.muted;
        this.master.gain.setTargetAtTime(this.muted ? 0 : 0.55, ctx.currentTime, 0.05);
      }
    });
  }

  /** one-shot thud + gravel burst, strength 0..1 */
  impact(strength: number) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.5, 0.15 + strength * 0.45), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    g.connect(this.master);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    o.connect(g);
    o.start(t); o.stop(t + 0.24);

    if (this.noiseBuf) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.playbackRate.value = 0.7 + Math.random() * 0.3;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 900 + strength * 900; bp.Q.value = 0.8;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.16 * strength, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      src.connect(bp).connect(ng).connect(this.master);
      src.start(t); src.stop(t + 0.32);
    }
  }

  /** 8-step chiptune loop, scheduled ahead of the clock */
  private pump(t: number) {
    if (!this.ctx) return;
    const step = 60 / 132 / 2;                 // 132 bpm, eighth notes
    const bass = [0, 0, 7, 0, 5, 0, 3, 0];     // semitones over A2
    const arp = [12, 19, 24, 19, 15, 19, 24, 27];
    while (this.musicNext < t + 0.25) {
      const i = this.musicStep % 8;
      const at = this.musicNext;
      const bar = Math.floor(this.musicStep / 8) % 2;
      const root = 110 * Math.pow(2, (bar === 0 ? 0 : 5) / 12);
      this.blip(root * Math.pow(2, bass[i] / 12), at, step * 1.8, 0.10, 'triangle');
      if (i % 2 === 0) {
        this.blip(root * Math.pow(2, arp[i] / 12), at, step * 0.9, 0.035, 'square');
      }
      this.musicStep++;
      this.musicNext += step;
    }
  }

  private blip(freq: number, at: number, dur: number, vol: number, type: OscillatorType) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    o.connect(g).connect(this.musicGain);
    o.start(at); o.stop(at + dur + 0.02);
  }

  update(car: Car, throttle: number, paused: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const sp = Math.abs(car.speed);
    const gearSpan = 9;
    const gearFrac = (sp % gearSpan) / gearSpan;
    // each gear pulls to the top of its band, then drops on the shift
    const rpm = 0.30 + Math.pow(gearFrac, 0.7) * 0.70;
    const target = 46 + sp * 1.6 + rpm * 26;
    this.engA.frequency.setTargetAtTime(target, t, 0.06);
    this.engB.frequency.setTargetAtTime(target * 1.51, t, 0.06);
    this.filter.frequency.setTargetAtTime(420 + sp * 34 + throttle * 120, t, 0.08);

    const load = paused ? 0 : 0.022 + Math.abs(throttle) * 0.028 + sp * 0.0011;
    this.engGain.gain.setTargetAtTime(load, t, 0.08);

    const slip = Math.min(1, car.slip / 7);
    const rolling = car.onRoad || car.onKerb;
    this.squeal.gain.setTargetAtTime(
      paused || !rolling ? 0 : slip * 0.055 * Math.min(1, sp / 6), t, 0.05,
    );

    // gravel outside the kerb, a pulsed rattle on the kerb itself
    const gravel = !car.onRoad && !car.onKerb;
    this.rumble.gain.setTargetAtTime(
      paused || !gravel ? 0 : Math.min(0.06, sp * 0.0022), t, 0.1,
    );
    const kerbPulse = 0.55 + 0.45 * Math.sin(t * 150);
    const kerb = Math.min(1, Math.abs(car.speed) / 9);
    this.kerb.gain.setTargetAtTime(
      paused || !car.onKerb ? 0 : kerbPulse * kerb * 0.05, t, 0.02,
    );

    // music: duck with throttle, stop when paused
    this.musicGain.gain.setTargetAtTime(paused ? 0 : 0.13, t, 0.2);
    if (!paused) this.pump(t);
  }
}
