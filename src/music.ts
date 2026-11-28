/* Pixel Drift's circuits, as music — KEPT AS DATA, NOT PLAYED.
 *
 * The owner listened to this and rejected it: the game runs silent apart from
 * the car. These tables stay because they are good, tested descriptions of what
 * each circuit sounds like, and a future decision to try again should not start
 * from a blank page. Nothing in src/ imports this file — see scripts/music.check.mjs,
 * which holds that line with a test.
 *
 * Everything here is data plus two pure helpers: a table per circuit (notes,
 * drums, tempo, key) and `stepEvents(track, step)` which turns one eighth-note
 * step of that table into the hits a synth would play. No samples, no files,
 * no licensing.
 *
 * The grid is eight eighth-notes per bar — one row entry per step. A bar of
 * 4/4 is steps 0..7 (beats on 0, 2, 4, 6). Tracks loop after `bars` bars.
 *
 * The title screen reuses the Saltmarsh Coast loop on purpose: the first clean
 * user gesture (the one that starts a run) is the first moment an AudioContext
 * is allowed to make sound, so a separate title theme could never be heard.
 */

export type MapId = 'coast' | 'alpine' | 'sakura' | 'mesa' | 'interlagos';
export type Wave = 'sine' | 'square' | 'sawtooth' | 'triangle';
export type Drum = 'kick' | 'snare' | 'hat' | 'shaker';
export type MelodicVoice = 'bass' | 'lead' | 'pad';

/** one row entry per step; null is a rest */
export type NoteRow = readonly (number | null)[];
/** a chord (or a single note) per step; null is a rest */
export type ChordRow = readonly (readonly number[] | null)[];
export type DrumRow = readonly (Drum | null)[];

export interface VoiceSpec {
  readonly wave: Wave;
  readonly level: number;   // 0..1 inside the music bus
  readonly gate: number;    // note length in steps
  readonly attack: number;  // seconds to full level
}

export interface NoteHit {
  readonly kind: 'note';
  readonly voice: MelodicVoice;
  readonly wave: Wave;
  readonly midi: readonly number[];
  readonly level: number;
  readonly attack: number;
  readonly dur: number;     // seconds
}

export interface DrumHit {
  readonly kind: 'drum';
  readonly drum: Drum;
  readonly level: number;
  readonly dur: number;     // seconds
}

export type Hit = NoteHit | DrumHit;

export interface TrackSpec {
  readonly id: MapId;
  readonly circuit: string;
  readonly mood: string;
  readonly key: string;
  readonly bpm: number;
  readonly bars: number;
  /** every pitch class the bass and lead rows draw on, for the drift guard */
  readonly pitchClasses: readonly number[];
  readonly bass: VoiceSpec;
  readonly lead: VoiceSpec;
  readonly pad: VoiceSpec;
  readonly drumLevel: number;
  readonly bassRow: NoteRow;
  readonly leadRow: NoteRow;
  readonly padRow: ChordRow;
  readonly drumRow: DrumRow;
}

export const STEPS_PER_BAR = 8;
/** eighth notes at the track's tempo */
export const stepSeconds = (t: TrackSpec) => 60 / t.bpm / 2;
export const loopSteps = (t: TrackSpec) => t.bars * STEPS_PER_BAR;
export const loopSeconds = (t: TrackSpec) => loopSteps(t) * stepSeconds(t);

export const midiToFreq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

const PITCH: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** 'A2' -> 45, 'C#4' -> 61, 'Bb2' -> 46 */
export function noteToMidi(name: string): number {
  const m = /^([a-gA-G])([#b]?)(-?\d+)$/.exec(name);
  if (!m) throw new Error(`music: bad note name "${name}"`);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + ((PITCH[m[1].toLowerCase()] + acc + 12) % 12);
}

export const midiToName = (midi: number) => {
  const r = Math.round(midi);
  return `${SHARP[((r % 12) + 12) % 12]}${Math.floor(r / 12) - 1}`;
};

const n = noteToMidi;
const DRUM_SHAPE: Record<Drum, { gate: number; level: number }> = {
  kick: { gate: 1.1, level: 0.85 },
  snare: { gate: 0.7, level: 0.42 },
  hat: { gate: 0.3, level: 0.22 },
  shaker: { gate: 0.45, level: 0.3 },
};

/* ---------------------------------------------------------------- circuits */

/* SALTMARSH COAST — 96 bpm, A major. The cruise: warm triangle bass walking
   under Amaj7 | F#m7 | Dmaj7 | E, a soft square lead that mostly rests, half-bar
   pad swells, brushed offbeat hats. Nothing hurries. */
const coast: TrackSpec = {
  id: 'coast',
  circuit: 'Saltmarsh Coast',
  mood: 'laid-back, warm, mid-tempo — a cruise',
  key: 'A major (Amaj7 | F#m7 | Dmaj7 | E)',
  bpm: 96,
  bars: 4,
  pitchClasses: [1, 2, 4, 6, 8, 9, 11],
  bass: { wave: 'triangle', level: 0.5, gate: 1.9, attack: 0.008 },
  lead: { wave: 'square', level: 0.2, gate: 0.9, attack: 0.012 },
  pad: { wave: 'triangle', level: 0.05, gate: 4, attack: 0.3 },
  drumLevel: 0.35,
  bassRow: [
    n('A2'), null, null, n('A2'), null, n('E3'), null, n('A2'),   // Amaj7
    n('F#2'), null, null, n('F#2'), null, n('C#3'), null, n('F#2'), // F#m7
    n('D2'), null, null, n('D2'), null, n('A2'), null, n('D2'),    // Dmaj7
    n('E2'), null, null, n('E2'), null, n('B2'), null, n('G#2'),   // E
  ],
  leadRow: [
    null, null, n('A4'), null, n('C#5'), null, null, n('E5'),
    null, n('C#5'), null, n('E5'), null, n('C#5'), null, null,
    n('F#5'), null, n('E5'), null, null, n('C#5'), null, null,
    n('B4'), null, null, n('A4'), null, n('F#4'), null, null,
  ],
  padRow: [
    [n('A3'), n('C#4'), n('E4'), n('G#4')], null, null, null,
    [n('A3'), n('C#4'), n('E4'), n('G#4')], null, null, null,
    [n('F#3'), n('A3'), n('C#4'), n('E4')], null, null, null,
    [n('F#3'), n('A3'), n('C#4'), n('E4')], null, null, null,
    [n('D3'), n('F#3'), n('A3'), n('C#4')], null, null, null,
    [n('D3'), n('F#3'), n('A3'), n('C#4')], null, null, null,
    [n('E3'), n('G#3'), n('B3'), n('E4')], null, null, null,
    [n('E3'), n('G#3'), n('B3'), n('E4')], null, null, null,
  ],
  drumRow: [
    'kick', 'hat', null, 'hat', 'kick', 'hat', 'snare', 'hat',
    'kick', 'hat', null, 'hat', 'kick', 'hat', 'snare', 'hat',
    'kick', 'hat', null, 'hat', 'kick', 'hat', 'snare', 'hat',
    'kick', 'hat', null, 'hat', 'kick', 'hat', 'snare', 'hat',
  ],
};

/* FROSTBITE PASS — 72 bpm, C major / E aeolian, almost no percussion. Wide
   sine bells in the high register over one slow triangle pad swell a bar,
   bass only where a bar turns. Air, not drive. */
const alpine: TrackSpec = {
  id: 'alpine',
  circuit: 'Frostbite Pass',
  mood: 'airy, sparse, icy — slower and higher',
  key: 'E aeolian (Em9 | Cmaj7 | Am7 | Bm7)',
  bpm: 72,
  bars: 4,
  pitchClasses: [0, 2, 4, 7, 9, 11],
  bass: { wave: 'sine', level: 0.5, gate: 5.5, attack: 0.02 },
  lead: { wave: 'sine', level: 0.24, gate: 1.6, attack: 0.02 },
  pad: { wave: 'triangle', level: 0.055, gate: 7.5, attack: 0.9 },
  drumLevel: 0.2,
  bassRow: [
    n('E2'), null, null, null, null, null, null, null,
    n('C2'), null, null, null, null, null, null, null,
    n('A2'), null, null, null, null, null, null, null,
    n('B2'), null, null, null, null, null, null, null,
  ],
  leadRow: [
    null, null, null, n('B5'), null, null, n('E6'), null,
    null, null, n('G5'), null, null, n('E5'), null, null,
    null, n('A5'), null, null, null, null, n('C6'), null,
    null, null, null, n('D5'), null, null, n('B4'), null,
  ],
  padRow: [
    [n('E4'), n('B4'), n('D5'), n('F#5')], null, null, null, null, null, null, null,
    [n('C4'), n('G4'), n('B4'), n('E5')], null, null, null, null, null, null, null,
    [n('A3'), n('E4'), n('G4'), n('B4')], null, null, null, null, null, null, null,
    [n('B3'), n('F#4'), n('A4'), n('D5')], null, null, null, null, null, null, null,
  ],
  drumRow: [
    'kick', null, null, null, null, null, null, null,
    null, null, null, null, null, null, 'shaker', null,
    'kick', null, null, null, null, null, null, null,
    null, null, 'shaker', null, null, null, null, null,
  ],
};

/* SAKURA CIRCUIT — 88 bpm, D hirajoshi (D E F A Bb). Plucked triangle koto
   line over a D/A drone with an F colour in the third bar, sparse wooden
   ticks instead of a drum kit. */
const sakura: TrackSpec = {
  id: 'sakura',
  circuit: 'Sakura Circuit',
  mood: 'Japanese pentatonic, gentle, melodic',
  key: 'D hirajoshi (D E F A Bb)',
  bpm: 88,
  bars: 4,
  pitchClasses: [2, 4, 5, 9, 10],
  bass: { wave: 'triangle', level: 0.44, gate: 1.4, attack: 0.008 },
  lead: { wave: 'triangle', level: 0.3, gate: 0.75, attack: 0.006 },
  pad: { wave: 'sine', level: 0.05, gate: 4, attack: 0.35 },
  drumLevel: 0.3,
  bassRow: [
    n('D2'), null, null, n('A2'), null, null, n('D2'), null,
    n('D2'), null, null, n('A2'), null, null, n('D2'), null,
    n('D2'), null, null, n('F2'), null, null, n('D2'), null,
    n('D2'), null, null, n('A2'), null, null, n('Bb2'), null,
  ],
  leadRow: [
    n('A4'), null, n('Bb4'), null, n('A4'), n('F4'), null, n('D4'),
    null, n('E4'), n('F4'), null, n('A4'), null, null, n('D5'),
    n('D5'), null, n('Bb4'), n('A4'), null, n('F4'), n('A4'), null,
    null, n('D4'), null, n('F4'), n('A4'), null, n('Bb4'), null,
  ],
  padRow: [
    [n('D3'), n('A3')], null, null, null, null, null, null, null,
    [n('D3'), n('A3'), n('F4')], null, null, null, null, null, null, null,
    [n('D3'), n('A3'), n('A4')], null, null, null, null, null, null, null,
    [n('D3'), n('A3'), n('D4')], null, null, null, null, null, null, null,
  ],
  drumRow: [
    'kick', null, 'shaker', null, null, null, 'shaker', null,
    'kick', null, 'shaker', null, null, null, 'shaker', null,
    'kick', null, 'shaker', null, null, null, 'shaker', null,
    'kick', null, 'shaker', null, null, null, 'shaker', null,
  ],
};

/* MIRAGE MESA — 116 bpm, E phrygian. Dry on purpose: no pad, square bass
   hammering eighth-note ostinatos low, a bare saw lead, and a dusty kit on
   the front foot. The b2 (F) does the desert work. */
const mesa: TrackSpec = {
  id: 'mesa',
  circuit: 'Mirage Mesa',
  mood: 'dry, driving, low and dusty — desert engine music',
  key: 'E phrygian (E F G A B C D)',
  bpm: 116,
  bars: 4,
  pitchClasses: [0, 2, 4, 5, 7, 9, 11],
  bass: { wave: 'square', level: 0.4, gate: 0.85, attack: 0.004 },
  lead: { wave: 'sawtooth', level: 0.16, gate: 1.2, attack: 0.02 },
  pad: { wave: 'triangle', level: 0, gate: 1, attack: 0.3 },
  drumLevel: 0.7,
  bassRow: [
    n('E2'), n('E2'), null, n('E2'), n('E2'), null, n('E2'), n('F2'),
    n('E2'), n('E2'), null, n('E2'), n('E2'), null, n('F2'), n('E2'),
    n('D2'), n('D2'), null, n('D2'), n('D2'), null, n('D2'), n('E2'),
    n('C2'), n('C2'), null, n('C2'), n('C2'), null, n('F2'), n('E2'),
  ],
  leadRow: [
    n('E4'), null, n('C5'), null, null, n('B4'), null, null,
    n('A4'), null, null, n('G4'), null, null, n('C5'), null,
    null, n('D5'), null, null, n('C5'), null, n('B4'), null,
    n('A4'), null, null, n('E4'), null, null, n('F4'), null,
  ],
  padRow: [
    null, null, null, null, null, null, null, null,
    null, null, null, null, null, null, null, null,
    null, null, null, null, null, null, null, null,
    null, null, null, null, null, null, null, null,
  ],
  drumRow: [
    'kick', 'hat', null, 'kick', 'snare', 'hat', null, 'hat',
    'kick', 'hat', null, 'kick', 'snare', 'hat', null, 'hat',
    'kick', 'hat', null, 'kick', 'snare', 'hat', null, 'hat',
    'kick', 'hat', null, 'kick', 'snare', 'hat', null, 'hat',
  ],
};

/* INTERLAGOS — 128 bpm, C major. The fastest of the five and the busiest
   underneath: shaker on every offbeat, kick on the beat, snare lifting the
   turnarounds, a bright square lead riding a C | Am | F | G pad. Eight bars
   rather than four, so the rotation (Am | F | G | C) can answer the first
   statement and the loop still lasts fifteen seconds of a lap. */
const interlagos: TrackSpec = {
  id: 'interlagos',
  circuit: 'Interlagos',
  mood: 'bright, energetic, a little samba in the percussion',
  key: 'C major (C | Am | F | G, answered by Am | F | G | C)',
  bpm: 128,
  bars: 8,
  pitchClasses: [0, 2, 4, 5, 7, 9, 11],
  bass: { wave: 'triangle', level: 0.48, gate: 1.2, attack: 0.006 },
  lead: { wave: 'square', level: 0.2, gate: 0.85, attack: 0.01 },
  pad: { wave: 'square', level: 0.038, gate: 4, attack: 0.2 },
  drumLevel: 0.75,
  bassRow: [
    n('C2'), null, null, n('C2'), null, n('G2'), null, n('C2'),
    n('A2'), null, null, n('A2'), null, n('E3'), null, n('A2'),
    n('F2'), null, null, n('F2'), null, n('C3'), null, n('F2'),
    n('G2'), null, null, n('G2'), null, n('D3'), null, n('B2'),
    n('A2'), null, null, n('A2'), null, n('E3'), null, n('A2'),
    n('F2'), null, null, n('F2'), null, n('C3'), null, n('F2'),
    n('G2'), null, null, n('G2'), null, n('D3'), null, n('B2'),
    n('C2'), null, null, n('C2'), null, n('G2'), null, n('C2'),
  ],
  leadRow: [
    n('C5'), null, n('E5'), n('G5'), null, n('E5'), n('C5'), null,
    n('A5'), null, n('G5'), n('E5'), null, n('C5'), null, null,
    n('A5'), null, n('C6'), null, n('A5'), n('F5'), n('D5'), null,
    n('G5'), null, n('E5'), null, n('D5'), n('E5'), n('G5'), null,
    n('E5'), null, n('A5'), null, n('C6'), null, n('A5'), null,
    n('F5'), null, n('A5'), null, n('C6'), null, n('A5'), null,
    n('G5'), null, n('B5'), null, n('D6'), null, n('B5'), null,
    n('E5'), null, n('G5'), null, n('C5'), null, null, null,
  ],
  padRow: [
    [n('C3'), n('E3'), n('G3')], null, null, null,
    [n('C3'), n('E3'), n('G3')], null, null, null,
    [n('A2'), n('C3'), n('E3')], null, null, null,
    [n('A2'), n('C3'), n('E3')], null, null, null,
    [n('F2'), n('A2'), n('C3')], null, null, null,
    [n('F2'), n('A2'), n('C3')], null, null, null,
    [n('G2'), n('B2'), n('D3')], null, null, null,
    [n('G2'), n('B2'), n('D3')], null, null, null,
    [n('A2'), n('C3'), n('E3')], null, null, null,
    [n('A2'), n('C3'), n('E3')], null, null, null,
    [n('F2'), n('A2'), n('C3')], null, null, null,
    [n('F2'), n('A2'), n('C3')], null, null, null,
    [n('G2'), n('B2'), n('D3')], null, null, null,
    [n('G2'), n('B2'), n('D3')], null, null, null,
    [n('C3'), n('E3'), n('G3')], null, null, null,
    [n('C3'), n('E3'), n('G3')], null, null, null,
  ],
  drumRow: [
    'kick', 'shaker', 'snare', 'shaker', 'kick', 'shaker', 'snare', 'shaker',
    'kick', 'shaker', 'snare', 'shaker', 'kick', 'shaker', 'snare', 'shaker',
    'kick', 'shaker', 'snare', 'shaker', 'kick', 'shaker', 'snare', 'shaker',
    'kick', 'shaker', 'snare', 'shaker', 'kick', 'shaker', 'snare', 'shaker',
    'kick', 'shaker', 'snare', 'shaker', 'kick', 'shaker', 'snare', 'shaker',
    'kick', 'shaker', 'snare', 'shaker', 'kick', 'shaker', 'snare', 'shaker',
    'kick', 'shaker', 'snare', 'shaker', 'kick', 'snare', 'kick', 'shaker',
    'kick', 'shaker', 'snare', 'shaker', 'kick', 'snare', 'snare', 'shaker',
  ],
};

export const TRACKS: Record<MapId, TrackSpec> = { coast, alpine, sakura, mesa, interlagos };
export const MAP_IDS = Object.keys(TRACKS) as MapId[];

/** the track for a map id; anything unknown falls back to the coast cruise */
export const trackFor = (id: string): TrackSpec => TRACKS[id as MapId] ?? coast;

/* --------------------------------------------------------------- sequencer */

/** every hit on one step of the loop, ready to schedule. Pure. */
export function stepEvents(track: TrackSpec, step: number): Hit[] {
  const span = loopSteps(track);
  const i = ((Math.trunc(step) % span) + span) % span;
  const stepDur = stepSeconds(track);
  const out: Hit[] = [];

  const note = (row: NoteRow, voice: MelodicVoice) => {
    const midi = row[i];
    if (midi == null) return;
    const spec = track[voice];
    if (spec.level <= 0) return;
    out.push({
      kind: 'note', voice, wave: spec.wave, midi: [midi],
      level: spec.level, attack: spec.attack, dur: stepDur * spec.gate,
    });
  };
  note(track.bassRow, 'bass');
  note(track.leadRow, 'lead');

  const chord = track.padRow[i];
  if (chord && chord.length && track.pad.level > 0) {
    out.push({
      kind: 'note', voice: 'pad', wave: track.pad.wave, midi: [...chord],
      level: track.pad.level, attack: track.pad.attack, dur: stepDur * track.pad.gate,
    });
  }

  const drum = track.drumRow[i];
  if (drum && track.drumLevel > 0) {
    const shape = DRUM_SHAPE[drum];
    out.push({
      kind: 'drum', drum,
      level: shape.level * track.drumLevel,
      dur: stepDur * shape.gate,
    });
  }
  return out;
}
