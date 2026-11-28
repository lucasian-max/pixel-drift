import type { Car } from './car';
import { loopSteps, midiToFreq, stepEvents, stepSeconds, trackFor } from './music';
import type { Drum, Hit, TrackSpec } from './music';

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
  muted = (() => {
    // remembered between visits: a muted tab should not blast on relaunch
    try { return localStorage.getItem('sprite-drift:muted') === '1'; } catch { return false; }
  })();
  private musicGain!: GainNode;
  private musicNext = 0;
  private musicStep = 0;
  private track: TrackSpec;
  private noiseBuf: AudioBuffer | null = null;

  /** the circuit's loop is chosen here; a map switch is a fresh Sound */
  constructor(track: string = 'coast') {
    this.track = trackFor(track);
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
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

    // music bus, a carpet under the engine rather than a feature of its own
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.11;
    this.musicGain.connect(this.master);
    this.musicNext = ctx.currentTime + 0.2;

    // N mutes (M returns to the menu); a held key would toggle it back and forth
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyN' && !e.repeat) this.toggleMute();
    });
  }

  toggleMute() {
    this.muted = !this.muted;
    try { localStorage.setItem('sprite-drift:muted', this.muted ? '1' : '0'); } catch { /* private mode */ }
    const ctx = this.ctx;
    if (ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.55, ctx.currentTime, 0.05);
    return this.muted;
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

  /* ---- music -------------------------------------------------------------
     One sequencer, five pattern tables (see music.ts). It schedules a quarter
     second ahead of the clock so a busy frame cannot leave a hole in the loop,
     and it never touches the graph's shape: only notes and the bus gain move.
     Swapping the loop under a running bus keeps musicNext, so the pulse does
     not restart when the track changes. */

  /** which loop is playing, and where in it — for probes and the HUD-free tests */
  get sequencer() {
    return { track: this.track.id, step: this.musicStep, steps: loopSteps(this.track) };
  }

  /** current gain targets, read-only: master, music bus, engine */
  get levels() {
    return {
      master: this.master ? this.master.gain.value : 0,
      music: this.musicGain ? this.musicGain.gain.value : 0,
      engine: this.engGain ? this.engGain.gain.value : 0,
    };
  }

  /** the map switch: next step plays the new circuit, the bus keeps running */
  setTrack(id: string) {
    const next = trackFor(id);
    if (next.id === this.track.id) return;
    this.track = next;
    this.musicStep = 0;
  }

  private pump(t: number) {
    if (!this.ctx) return;
    const track = this.track;
    const span = loopSteps(track);
    const dur = stepSeconds(track);
    // a pause leaves the cursor in the past; never schedule a burst of catch-up
    if (this.musicNext < t) this.musicNext = t + 0.05;
    while (this.musicNext < t + 0.25) {
      const at = this.musicNext;
      for (const hit of stepEvents(track, this.musicStep)) this.voice(hit, at);
      this.musicStep = (this.musicStep + 1) % span;
      this.musicNext += dur;
    }
  }

  private voice(hit: Hit, at: number) {
    if (hit.kind === 'drum') { this.drum(hit.drum, at, hit.dur, hit.level); return; }
    for (const midi of hit.midi) {
      const g = this.ctx!.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(hit.level, at + hit.attack);
      g.gain.exponentialRampToValueAtTime(0.0005, at + hit.dur);
      g.connect(this.musicGain);
      const freq = midiToFreq(midi);
      const o = this.ctx!.createOscillator();
      o.type = hit.wave;
      o.frequency.value = freq;
      o.connect(g);
      o.start(at);
      o.stop(at + hit.dur + 0.02);
      // the pad is a chord, so it gets one detuned twin to sound wide, cheap
      if (hit.voice === 'pad') {
        const twin = this.ctx!.createOscillator();
        twin.type = hit.wave;
        twin.frequency.value = freq;
        twin.detune.value = -8;
        twin.connect(g);
        twin.start(at);
        twin.stop(at + hit.dur + 0.02);
      }
    }
  }

  /** percussion: a pitched body for the kick, filtered noise for the rest */
  private drum(kind: Drum, at: number, dur: number, level: number) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, at);
    g.gain.exponentialRampToValueAtTime(0.0005, at + dur);
    g.connect(this.musicGain);
    if (kind === 'kick') {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(160, at);
      o.frequency.exponentialRampToValueAtTime(46, at + dur * 0.8);
      o.connect(g);
      o.start(at);
      o.stop(at + dur + 0.02);
      return;
    }
    if (!this.noiseBuf) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = kind === 'hat' || kind === 'shaker' ? 1.6 : 1;
    const f = ctx.createBiquadFilter();
    if (kind === 'snare') { f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 1.1; }
    else if (kind === 'hat') { f.type = 'highpass'; f.frequency.value = 7200; f.Q.value = 0.9; }
    else { f.type = 'bandpass'; f.frequency.value = 5200; f.Q.value = 1.6; }
    src.connect(f).connect(g);
    src.start(at);
    src.stop(at + Math.max(dur, 0.08) + 0.02);
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

    /* music: the carpet. Silence on the title/pause screens, and the faster the
       engine turns the further it sits back, so the note stays the loudest thing */
    const pitch = Math.min(1, sp / 26);
    this.musicGain.gain.setTargetAtTime(paused ? 0 : 0.12 - pitch * 0.035, t, 0.2);
    if (!paused) this.pump(t);
  }
}
