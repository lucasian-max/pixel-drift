/* Pixel Drift's audio numbers, as data.
 *
 * Everything the synth plays is described here first: the per-car engine
 * voices (each car's idle, stop and harmonic stack), the low wide tyre scrub,
 * the layered impacts, and the note sequences the power stingers play. The
 * mix is the engine under the powers, with the scrub and the hits as the
 * physics the driver feels. sound.ts does nothing but wire nodes and push
 * these numbers into them, which means the tuning can be read, reviewed and
 * tested without a speaker.
 *
 * Pure: no AudioContext, no window, no side effects. scripts/audio.check.mjs
 * holds that line.
 */

export type Wave = 'sine' | 'square' | 'sawtooth' | 'triangle';

/* ---------------------------------------------------------------- the engine */

/** the HUD's gear band in km/h (pixelui.ts prints `1 + floor(kmh / 22)`) */
export const GEAR_KMH = 22;
/** the top gear the HUD will show */
export const TOP_GEAR = 6;
/** at or past this fraction of a gearband the engine is on the limiter */
export const LIMITER_FRAC = 0.94;

export interface GearState {
  /** the number the HUD prints; 1..6, or the reverse gear */
  readonly gear: number;
  readonly reverse: boolean;
  /** how far through its band the needle sits, 0..1 */
  readonly frac: number;
  readonly kmh: number;
}

/**
 * The gear the dashboard shows and the fraction of it the car is pulling.
 * The HUD derives its number from speed alone, so the engine does the same
 * thing from the same speed: the note can never show a gear the HUD doesn't.
 */
export function gearOf(speed: number): GearState {
  // the dashboard rounds before dividing, so the engine rounds the same way:
  // at 21.6 km/h the HUD already reads gear 2, and the note must agree
  const kmh = Math.round(Math.abs(speed) * 3.6);
  const reverse = speed < -0.5;
  const gear = Math.min(TOP_GEAR, 1 + Math.floor(kmh / GEAR_KMH));
  const lo = (gear - 1) * GEAR_KMH;
  const frac = Math.max(0, Math.min(1, (kmh - lo) / GEAR_KMH));
  return { gear, reverse, frac, kmh };
}

/** crank revolutions for a position inside a gear: this car's idle at the
 *  bottom, this car's redline at the top — the range is the voice's own */
export const revsOf = (frac: number, v: EngineVoice) =>
  v.idle + Math.max(0, Math.min(1, frac)) * (v.redline - v.idle);

/** a four-stroke crank, in hertz: revolutions per minute over sixty */
export const crankHz = (revs: number) => revs / 60;

export interface OrderSpec {
  /** multiple of the crank frequency. Half-integer orders exist because a
      four-stroke fires once every two revolutions */
  readonly order: number;
  readonly type: Wave;
  /** full-throttle level of this partial */
  readonly gain: number;
  /** how much of this partial only exists under load, 0..1 */
  readonly load: number;
  /** partials that fade in with revs (the bright ones) rather than sit at idle */
  readonly withRevs: number;
}

/** one car's engine: its idle, its stop, and the harmonic stack that gives it a
 *  voice. The gear bands are shared (the HUD owns them), so what differs per
 *  car is the character: where the note starts, where it stops, and which
 *  partials shout. */
export interface EngineVoice {
  readonly idle: number;
  readonly redline: number;
  readonly orders: readonly OrderSpec[];
}

/* PEARL GT — the smooth screamer: evens forward, sine and triangle, so the
   note climbs without a snarl and sings at the top of the box. */
const PEARL_ENGINE: EngineVoice = {
  idle: 1000, redline: 7800,
  orders: [
    { order: 0.5, type: 'sine', gain: 0.07, load: 0.0, withRevs: 0 },
    { order: 1, type: 'sine', gain: 0.10, load: 0.0, withRevs: 0 },
    { order: 2, type: 'sine', gain: 0.22, load: 0.15, withRevs: 0 },
    { order: 3, type: 'triangle', gain: 0.08, load: 0.5, withRevs: 0.5 },
    { order: 4, type: 'sine', gain: 0.15, load: 0.45, withRevs: 0.5 },
    { order: 6, type: 'triangle', gain: 0.10, load: 0.4, withRevs: 0.75 },
    { order: 8, type: 'sine', gain: 0.05, load: 0.55, withRevs: 0.9 },
  ],
};

/* GROUP B — the rally grumble: strong half-orders for the lope, sawtooth mid,
   and it stops early because a Group B engine is all midrange. */
const GROUPB_ENGINE: EngineVoice = {
  idle: 850, redline: 6600,
  orders: [
    { order: 0.5, type: 'sawtooth', gain: 0.14, load: 0.0, withRevs: 0 },
    { order: 1, type: 'sawtooth', gain: 0.17, load: 0.0, withRevs: 0 },
    { order: 1.5, type: 'square', gain: 0.06, load: 0.6, withRevs: 0.3 },
    { order: 2, type: 'sawtooth', gain: 0.22, load: 0.3, withRevs: 0 },
    { order: 3, type: 'square', gain: 0.12, load: 0.7, withRevs: 0.6 },
    { order: 4, type: 'sawtooth', gain: 0.14, load: 0.5, withRevs: 0.6 },
    { order: 6, type: 'square', gain: 0.05, load: 0.5, withRevs: 0.8 },
  ],
};

/* DUNE RUNNER — the torque truck: the low orders dominate, the note barely
   bothers with the bright ones, and it stops lowest of the three. */
const DUNE_ENGINE: EngineVoice = {
  idle: 750, redline: 5800,
  orders: [
    { order: 0.5, type: 'triangle', gain: 0.18, load: 0.0, withRevs: 0 },
    { order: 1, type: 'triangle', gain: 0.22, load: 0.0, withRevs: 0 },
    { order: 2, type: 'triangle', gain: 0.20, load: 0.25, withRevs: 0 },
    { order: 3, type: 'sawtooth', gain: 0.10, load: 0.55, withRevs: 0.5 },
    { order: 4, type: 'triangle', gain: 0.08, load: 0.4, withRevs: 0.6 },
    { order: 6, type: 'sawtooth', gain: 0.035, load: 0.5, withRevs: 0.85 },
  ],
};

/** the three cars, in variant order (PEARL GT, GROUP B, DUNE RUNNER) */
export const ENGINE_VOICES: readonly EngineVoice[] = [PEARL_ENGINE, GROUPB_ENGINE, DUNE_ENGINE];

/** the voice for a car variant; an out-of-range variant still gets an engine */
export function engineVoice(variant: number): EngineVoice {
  return ENGINE_VOICES[Math.max(0, Math.min(ENGINE_VOICES.length - 1, Math.round(variant)))] ?? PEARL_ENGINE;
}

/**
 * Where the lowpass sits. Off the throttle the note is a dull rumble; on it,
 * the filter opens and the bright partials above come through — the on-load /
 * off-load split that engine audio lives on.
 */
export const engineCutoff = (frac: number, load: number) =>
  240 + Math.max(0, Math.min(1, frac)) * 1900 + Math.max(0, Math.min(1, load)) * 700;

/** exhaust and induction: a band of noise over the notes, which is what gives
 *  the car presence on the small speakers most players actually use */
export const hissCentre = (frac: number, load: number) =>
  460 + Math.max(0, Math.min(1, frac)) * 900 + Math.max(0, Math.min(1, load)) * 260;

/** engine level 0..1 of the master: idle is quiet, flat out and loaded is not.
 *  Held low on purpose: the mix is a quiet engine under the power stingers,
 *  and the car should never drown the game out. */
export const engineLevel = (kmh: number, throttle: number) =>
  0.034 + Math.abs(throttle) * 0.030 + Math.min(1, kmh / 130) * 0.014;

/** the hiss layer's own level, as a share of the engine's */
export const hissLevel = (load: number) => 0.28 + Math.max(0, Math.min(1, load)) * 0.34;

/* ----------------------------------------------------------------- tyre scrub */

/**
 * The squeal the owner asked back, rebuilt so it is not the old whistle: no
 * sung partial at all (that was the shriek), and the band sits low and wide
 * instead of high and narrow. Tyre scrub in the good arcade racers is a
 * textured hiss that leans on you as the slide builds — rubber on road, not
 * a kettle. Centre stays under ~1 kHz, the band never tightens past 2.2.
 */
export const squealCentre = (slip: number, kmh: number) => {
  const s = Math.max(0, Math.min(1, slip / 6));
  return 560 + s * 320 + Math.min(120, kmh * 0.7);
};

/** wide, always: a scrub, never a focused shriek */
export const squealQ = (slip: number) => 1.1 + Math.max(0, Math.min(1, slip / 6)) * 1.1;

/* --------------------------------------------------------- one-shot vocabulary
   One shape for every one-shot: a tone that may glide, or a burst of filtered
   noise. sound.ts renders both; nothing else knows what a stinger is. */

export interface Tone {
  readonly k: 'tone';
  readonly at: number;      // seconds from the cue's start
  readonly f: number;       // hertz
  readonly to?: number;     // glide target, when it is not a steady note
  readonly dur: number;
  readonly type: Wave;
  readonly gain: number;    // peak, inside the fx bus
}

export interface Noise {
  readonly k: 'noise';
  readonly at: number;
  readonly centre: number;  // bandpass centre
  readonly to?: number;     // sweep target
  readonly q: number;
  readonly dur: number;
  readonly gain: number;
  readonly rate?: number;   // playback rate of the shared noise buffer
}

export type Event = Tone | Noise;

const tone = (at: number, f: number, dur: number, type: Wave, gain: number, to?: number): Tone =>
  to == null ? { k: 'tone', at, f, dur, type, gain } : { k: 'tone', at, f, to, dur, type, gain };
const noise = (at: number, centre: number, q: number, dur: number, gain: number, to?: number, rate?: number): Noise =>
  to == null ? { k: 'noise', at, centre, q, dur, gain, rate } : { k: 'noise', at, centre, to, q, dur, gain, rate };

/** how long a cue runs, for tests and for the renderer's stop times */
export const cueLength = (events: readonly Event[]) =>
  events.reduce((end, e) => Math.max(end, e.at + e.dur), 0);

/* -------------------------------------------------------------------- impact */

/**
 * A hit is layered, and the layers switch on with the hit: a low thud that
 * carries the weight, a body knock for the sheet metal, a short crack for the
 * transient, and — past a quarter strength — a spray of debris on top.
 * The owner kept these when the rest of the cue layer went.
 */
export function impactEvents(strength: number): Event[] {
  const s = Math.max(0, Math.min(1, strength));
  const out: Event[] = [
    tone(0, 130, 0.22, 'triangle', Math.min(0.34, 0.10 + s * 0.26), 40),
    noise(0, 620 + s * 420, 0.9, 0.10, 0.06 + s * 0.10),
    noise(0, 3200, 0.7, 0.035, 0.035 + s * 0.045),
  ];
  if (s > 0.25) {
    // debris: a spray that scatters, so a second, slower grain follows the first
    out.push(noise(0.01, 2400, 0.6, 0.12 + s * 0.20, 0.10 * s, 1200));
    out.push(noise(0.07, 1700, 0.7, 0.10 + s * 0.16, 0.06 * s, 900, 0.8));
  }
  return out;
}

/* ------------------------------------------------------------------ powers */

export interface Stinger {
  readonly name: string;
  readonly events: readonly Event[];
}

/* PEARL DRIFT — the orb shimmer. A struck bell: inharmonic partials, long
   decay, and one soft gliss underneath as the rear lets go. Loud enough to be
   heard over the engine it fires on top of, which is the whole point. */
const pearl: Stinger = {
  name: 'PEARL DRIFT',
  events: [
    tone(0, 1318.5, 0.9, 'sine', 0.10),
    tone(0, 2637, 0.55, 'sine', 0.038),
    tone(0, 3730, 0.35, 'sine', 0.026),
    tone(0, 660, 0.28, 'sine', 0.062, 990),
    noise(0, 6000, 0.8, 0.45, 0.026, 9000),
  ],
};

/* THUNDERCLAP — the burst. A crack on the transient, a falling square for the
   shove, a sub thump under it and a noise sweep for the air being pushed. */
const thunder: Stinger = {
  name: 'THUNDERCLAP',
  events: [
    tone(0, 1800, 0.06, 'square', 0.055, 1200),
    tone(0.01, 420, 0.28, 'square', 0.10, 90),
    tone(0, 150, 0.24, 'triangle', 0.14, 48),
    noise(0.005, 3500, 0.7, 0.30, 0.085, 400),
  ],
};

/* TUNNEL — the phase. Time stops: an upward shimmer under a whoosh as the
   world goes still. The snap when the car re-appears is POWER_LAND_EVENTS,
   because the player aims between the two and that can take a moment. */
const tunnel: Stinger = {
  name: 'TUNNEL',
  events: [
    tone(0, 400, 0.35, 'sine', 0.11, 1500),
    tone(0.002, 404, 0.35, 'sine', 0.062, 1516),
    noise(0, 600, 1.2, 0.38, 0.082, 2400),
  ],
};

/** ...and the snap: the car is simply somewhere else */
export const POWER_LAND_EVENTS: readonly Event[] = [
  tone(0, 1400, 0.12, 'sine', 0.09, 180),
  tone(0, 120, 0.14, 'triangle', 0.07, 58),
  noise(0, 1800, 2.0, 0.05, 0.06),
];

export const STINGERS: readonly Stinger[] = [pearl, thunder, tunnel];

/** the stinger for a power name; an unknown power still gets a voice */
export function stingerFor(name: string): Stinger {
  return STINGERS.find((s) => s.name === name) ?? {
    name: name || 'POWER',
    events: [tone(0, 520, 0.09, 'square', 0.06, 780), tone(0.09, 780, 0.14, 'square', 0.045, 1040)],
  };
}

/* ------------------------------------------------------------- game feel ----
   The lap chimes, the start lift, the UI clicks and the gravel scuffs are gone:
   the owner listened and kept exactly one voice of the cue layer — the powers.
   The engine above is the other voice, and it is the whole soundtrack. */
