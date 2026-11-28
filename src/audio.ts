/* Pixel Drift's audio numbers, as data.
 *
 * Everything the synth plays is described here first: the gear/RPM curve the
 * engine follows, the harmonic stack that gives the note its body, and the
 * note sequences the power stingers play. The mix is two voices — a quiet
 * engine and the powers — and nothing else. sound.ts does nothing but wire
 * nodes and push these numbers into them, which means the tuning can be read,
 * reviewed and tested without a speaker.
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
export const IDLE_RPM = 900;
export const REDLINE_RPM = 7000;
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

/** crank revolutions for a position inside a gear: idle at the bottom, redline at the top */
export const revsOf = (frac: number) =>
  IDLE_RPM + Math.max(0, Math.min(1, frac)) * (REDLINE_RPM - IDLE_RPM);

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

/** the harmonic stack: low orders carry the note, high orders carry the snarl.
 *  Eight of them, because a real engine's spectrum reaches well past the firing
 *  order — and because a laptop speaker drops everything under ~150 Hz, so the
 *  upper orders are what makes the car audible at all on a small machine. */
export const ENGINE_ORDERS: readonly OrderSpec[] = [
  { order: 0.5, type: 'sine', gain: 0.16, load: 0.0, withRevs: 0 },
  { order: 1, type: 'sine', gain: 0.20, load: 0.0, withRevs: 0 },
  { order: 2, type: 'sawtooth', gain: 0.30, load: 0.25, withRevs: 0 },
  { order: 3, type: 'square', gain: 0.14, load: 0.7, withRevs: 0.6 },
  { order: 4, type: 'sawtooth', gain: 0.16, load: 0.5, withRevs: 0.55 },
  { order: 6, type: 'triangle', gain: 0.09, load: 0.45, withRevs: 0.7 },
  { order: 8, type: 'sawtooth', gain: 0.06, load: 0.6, withRevs: 0.85 },
  { order: 10, type: 'square', gain: 0.035, load: 0.7, withRevs: 0.9 },
];

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
/* Removed with the rest of the cue layer: the mix is the engine and the
   powers, nothing else. The one-shot shapes and the renderer remain below,
   because the power stingers are built from them. */

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
