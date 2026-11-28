import type { Car } from './car';
import {
  CLICK_EVENTS, ENGINE_ORDERS, GRAVEL_EVENTS, LAP_BEST_EVENTS, LAP_EVENTS, LIMITER_FRAC,
  POWER_LAND_EVENTS, START_EVENTS, crankHz, engineCutoff, engineLevel, gearOf, hissCentre,
  hissLevel, impactEvents, revsOf, squealCentre, squealQ, squealTone, stingerFor,
} from './audio';
import type { Event, OrderSpec } from './audio';

/**
 * Pixel Drift's soundtrack: the car, and nothing else. No assets, no music —
 * every voice here is oscillators and one shared noise buffer, built on the
 * first input and then only ever retuned. The numbers it plays live in
 * src/audio.ts; this file is the wiring.
 *
 * Layout: engine (a harmonic stack through one lowpass, with a limiter chop on
 * top) and the surfaces (squeal, gravel, kerb) run continuously off the car's
 * state; impacts, power stingers, lap chimes and UI clicks are one-shots
 * rendered from the event tables. Master sits low and a compressor catches the
 * frames where a stinger and an impact land together.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private pump!: DynamicsCompressorNode;

  // engine: one oscillator per harmonic order, into one lowpass
  private filter!: BiquadFilterNode;
  private engGain!: GainNode;
  private orders: { osc: OscillatorNode; gain: GainNode; spec: OrderSpec }[] = [];
  private limiterLfo!: OscillatorNode;
  private limiterDepth!: GainNode;

  // surfaces
  private squeal!: GainNode;
  private squealBp!: BiquadFilterNode;
  private squealToneOsc!: OscillatorNode;
  private squealToneGain!: GainNode;
  private rumble!: GainNode;
  private rattle!: GainNode;
  private kerb!: GainNode;

  private hiss!: GainNode;
  private hissBp!: BiquadFilterNode;

  private noiseBuf: AudioBuffer | null = null;
  private wasGravel = false;
  private lastGear = 1;
  private lastFrac = 0;

  muted = (() => {
    // remembered between visits: a muted tab should not blast on relaunch
    try { return localStorage.getItem('sprite-drift:muted') === '1'; } catch { return false; }
  })();

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    this.ctx = ctx;

    // master → compressor → speakers: the compressor exists so a power stinger
    // landing on the same frame as an impact has somewhere to go but up
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    this.pump = ctx.createDynamicsCompressor();
    this.pump.threshold.value = -16;
    this.pump.knee.value = 10;
    this.pump.ratio.value = 3;
    this.pump.attack.value = 0.004;
    this.pump.release.value = 0.18;
    this.master.connect(this.pump).connect(ctx.destination);

    /* ---- engine ----------------------------------------------------------
       Each order is its own oscillator, tuned to a multiple of the crank
       frequency, and its own gain so the load/revs mix can move per partial.
       One lowpass across the stack does the on-load/off-load timbre. */
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = engineCutoff(0, 0);
    this.filter.Q.value = 1.1;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0.0;
    this.filter.connect(this.engGain).connect(this.master);
    for (const spec of ENGINE_ORDERS) {
      const osc = ctx.createOscillator();
      osc.type = spec.type;
      osc.frequency.value = crankHz(revsOf(0)) * spec.order;
      const gain = ctx.createGain();
      gain.gain.value = spec.gain * (1 - spec.load);
      osc.connect(gain).connect(this.filter);
      osc.start();
      this.orders.push({ osc, gain, spec });
    }

    /* rev limiter: a square wave chopping the engine's gain, silent until the
       needle sits on the stop. Sub-audio, so it reads as a stutter, not a tone */
    this.limiterLfo = ctx.createOscillator();
    this.limiterLfo.type = 'square';
    this.limiterLfo.frequency.value = 28;
    this.limiterDepth = ctx.createGain();
    this.limiterDepth.gain.value = 0;
    this.limiterLfo.connect(this.limiterDepth).connect(this.engGain.gain);
    this.limiterLfo.start();

    /* ---- shared noise ---------------------------------------------------- */
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;

    // tyre squeal: a narrow noise band for the hiss plus a sung partial on top,
    // both pitched from the slide so the shriek rises with the slip
    this.squealBp = ctx.createBiquadFilter();
    this.squealBp.type = 'bandpass';
    this.squealBp.frequency.value = squealCentre(0, 0);
    this.squealBp.Q.value = squealQ(0);
    this.squeal = ctx.createGain();
    this.squeal.gain.value = 0;
    noise.connect(this.squealBp).connect(this.squeal).connect(this.master);
    this.squealToneOsc = ctx.createOscillator();
    this.squealToneOsc.type = 'triangle';
    this.squealToneOsc.frequency.value = squealTone(squealCentre(0, 0));
    this.squealToneGain = ctx.createGain();
    this.squealToneGain.gain.value = 0.35;
    this.squealToneOsc.connect(this.squealToneGain).connect(this.squeal);
    this.squealToneOsc.start();

    // gravel: a low scuff with a dry rattle over it
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    this.rumble = ctx.createGain();
    this.rumble.gain.value = 0;
    noise.connect(lp).connect(this.rumble).connect(this.master);
    const rattle = ctx.createBiquadFilter();
    rattle.type = 'bandpass';
    rattle.frequency.value = 1250;
    rattle.Q.value = 0.8;
    this.rattle = ctx.createGain();
    this.rattle.gain.value = 0;
    noise.connect(rattle).connect(this.rattle).connect(this.master);

    // kerb: low, hollow rattle — the painted strip under two wheels
    const kp = ctx.createBiquadFilter();
    kp.type = 'bandpass';
    kp.frequency.value = 150;
    kp.Q.value = 0.7;
    this.kerb = ctx.createGain();
    this.kerb.gain.value = 0;
    noise.connect(kp).connect(this.kerb).connect(this.master);

    // exhaust and induction: a band of noise riding the engine's load. This is
    // the layer a laptop speaker can actually reproduce when the note sits at 40 Hz
    this.hissBp = ctx.createBiquadFilter();
    this.hissBp.type = 'bandpass';
    this.hissBp.frequency.value = hissCentre(0, 0);
    this.hissBp.Q.value = 1.1;
    this.hiss = ctx.createGain();
    this.hiss.gain.value = 0;
    noise.connect(this.hissBp).connect(this.hiss).connect(this.master);

    noise.start();

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

  /* ------------------------------------------------------------- one-shots */

  /** one-shot renderer: every cue in audio.ts is a list of these two shapes */
  private play(events: readonly Event[]) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t0 = ctx.currentTime;
    for (const e of events) {
      const at = t0 + e.at;
      const g = ctx.createGain();
      // start from a hair above zero: an exponential ramp cannot leave zero
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(e.gain, at + Math.min(0.006, e.dur * 0.3));
      g.gain.exponentialRampToValueAtTime(0.0008, at + e.dur);
      g.connect(this.master);

      if (e.k === 'tone') {
        const osc = ctx.createOscillator();
        osc.type = e.type;
        osc.frequency.setValueAtTime(e.f, at);
        if (e.to != null) osc.frequency.exponentialRampToValueAtTime(e.to, at + e.dur);
        osc.connect(g);
        osc.start(at);
        osc.stop(at + e.dur + 0.02);
        continue;
      }
      if (!this.noiseBuf) { g.disconnect(); continue; }
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      src.playbackRate.value = e.rate ?? 1;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = e.q;
      bp.frequency.setValueAtTime(e.centre, at);
      if (e.to != null) bp.frequency.exponentialRampToValueAtTime(e.to, at + e.dur);
      src.connect(bp).connect(g);
      src.start(at);
      src.stop(at + e.dur + 0.02);
    }
  }

  /** a hit: thud, knock, crack, and debris once it is hard enough */
  impact(strength: number) {
    this.play(impactEvents(strength));
  }

  /** a power firing, by the name on the car: TUNNEL, THUNDERCLAP, PEARL DRIFT */
  power(name: string) {
    this.play(stingerFor(name).events);
  }

  /** the aimed blink landing: TUNNEL's snap, after the player has chosen where */
  powerLand() {
    this.play(POWER_LAND_EVENTS);
  }

  /** crossing the line; `best` when it is a new personal best */
  lap(best: boolean) {
    this.play(best ? LAP_BEST_EVENTS : LAP_EVENTS);
  }

  /** the run has started: the car has left the line */
  go() {
    this.play(START_EVENTS);
  }

  /** a menu press */
  click() {
    this.play(CLICK_EVENTS);
  }

  /** current gain targets, read-only: master, engine, hiss, squeal */
  get levels() {
    return {
      master: this.master ? this.master.gain.value : 0,
      engine: this.engGain ? this.engGain.gain.value : 0,
      hiss: this.hiss ? this.hiss.gain.value : 0,
      squeal: this.squeal ? this.squeal.gain.value : 0,
    };
  }

  /** what the engine is doing right now, read-only — for probes and tests */
  get engineState() {
    return {
      gear: this.lastGear,
      frac: this.lastFrac,
      base: crankHz(revsOf(this.lastFrac)),
      cutoff: this.filter ? this.filter.frequency.value : 0,
      limiter: this.limiterDepth ? this.limiterDepth.gain.value : 0,
    };
  }

  /** what the tyres are doing right now, read-only — for probes and tests */
  get drift() {
    return {
      level: this.squeal ? this.squeal.gain.value : 0,
      centre: this.squealBp ? this.squealBp.frequency.value : 0,
      q: this.squealBp ? this.squealBp.Q.value : 0,
      tone: this.squealToneOsc ? this.squealToneOsc.frequency.value : 0,
    };
  }

  /* ---------------------------------------------------------------- per frame */

  update(car: Car, throttle: number, paused: boolean) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const gear = gearOf(car.speed);
    const { reverse, kmh } = gear;
    // reverse has one long band rather than six: the note sits low and rises
    const frac = reverse ? Math.min(1, kmh / 14) : gear.frac;
    this.lastFrac = frac;
    this.lastGear = gear.gear;
    const base = crankHz(revsOf(frac));
    const load = paused ? 0 : Math.min(1, Math.abs(throttle));

    /* engine: pitch follows the crank, each partial's level follows load and
       revs, so the shift drops the note and closing the throttle dulls it */
    for (const o of this.orders) {
      o.osc.frequency.setTargetAtTime(base * o.spec.order, t, 0.05);
      const open = 1 - o.spec.load + o.spec.load * load;
      const bright = 1 - o.spec.withRevs + o.spec.withRevs * frac;
      o.gain.gain.setTargetAtTime(o.spec.gain * open * bright, t, 0.08);
    }
    this.filter.frequency.setTargetAtTime(engineCutoff(frac, load), t, 0.08);

    const level = paused ? 0 : engineLevel(kmh, throttle);
    this.engGain.gain.setTargetAtTime(level, t, 0.08);
    this.hissBp.frequency.setTargetAtTime(hissCentre(frac, load), t, 0.08);
    this.hiss.gain.setTargetAtTime(paused ? 0 : level * hissLevel(load), t, 0.08);
    const onLimit = !paused && !reverse && frac > LIMITER_FRAC && load > 0.55;
    this.limiterDepth.gain.setTargetAtTime(onLimit ? level * 0.45 : 0, t, 0.02);

    /* squeal: the signature sound of a drifting game. Pitch, width and level
       all follow the slide, and it lets go slower than it grabs */
    const slip = Math.max(0, car.slip);
    const squealLevel = paused || !car.onRoad ? 0 : Math.min(0.10, Math.pow(Math.min(1, slip / 6), 1.1) * Math.min(1, kmh / 25) * 0.10);
    const centre = squealCentre(slip, kmh);
    this.squeal.gain.setTargetAtTime(squealLevel, t, squealLevel > 0 ? 0.05 : 0.12);
    this.squealBp.frequency.setTargetAtTime(centre, t, 0.04);
    this.squealBp.Q.setTargetAtTime(squealQ(slip), t, 0.06);
    this.squealToneOsc.frequency.setTargetAtTime(squealTone(centre), t, 0.04);

    /* off the road: a low scuff plus a rattle, and a one-shot the first frame
       the wheel drops onto it, so the surface change is heard and not just felt */
    const gravel = !car.onRoad && !car.onKerb;
    if (gravel && !this.wasGravel && !paused) this.play(GRAVEL_EVENTS);
    this.wasGravel = gravel;
    this.rumble.gain.setTargetAtTime(
      paused || !gravel ? 0 : Math.min(0.09, kmh * 0.0009), t, 0.1,
    );
    this.rattle.gain.setTargetAtTime(
      paused || !gravel ? 0 : Math.min(0.032, kmh * 0.00032), t, 0.1,
    );
    const kerbPulse = 0.55 + 0.45 * Math.sin(t * 150);
    const kerb = Math.min(1, Math.abs(car.speed) / 9);
    this.kerb.gain.setTargetAtTime(
      paused || !car.onKerb ? 0 : kerbPulse * kerb * 0.07, t, 0.02,
    );
  }
}
