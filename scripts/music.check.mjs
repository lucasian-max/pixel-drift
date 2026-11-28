#!/usr/bin/env node
// scripts/music.check.mjs — the music, proven without a speaker.
//
// Two halves, because the music is two halves:
//   1. the pattern tables in src/music.ts — well formed, in key, seamless loop
//   2. the synth in src/sound.ts — driven against a fake AudioContext that
//      records every node and every gain/frequency ramp, so we can assert the
//      graph the way a listener would hear it: music under the engine, drums
//      firing, nothing scheduled at an illegal value, mute honest across reloads.
//
// Run by `npm test`. `node --test scripts/music.check.mjs` also works.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';

/* src/sound.ts imports './music' the way Vite resolves it; node needs the
   extension, so teach the loader that one trick before importing the synth. */
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) {
      try { return next(`${specifier}.ts`, context); } catch { /* fall through */ }
    }
    return next(specifier, context);
  },
});

const music = await import('../src/music.ts');
const { TRACKS, MAP_IDS, loopSteps, loopSeconds, stepEvents, stepSeconds, midiToName, trackFor } = music;

/* ------------------------------------------------------------ pattern tables */

test('one loop per circuit, and the ids are the maps the world builds', () => {
  const world = fs.readFileSync(new URL('../src/world.ts', import.meta.url), 'utf8');
  const ids = [...world.matchAll(/\bid:\s*'([a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(ids.sort(), [...MAP_IDS].sort());
  for (const id of MAP_IDS) {
    const t = TRACKS[id];
    assert.equal(t.id, id);
    assert.ok(t.circuit.length > 0 && t.mood.length > 0 && t.key.length > 0, `${id}: needs a readable spec`);
    assert.ok(Number.isFinite(t.bpm) && t.bpm >= 60 && t.bpm <= 160, `${id}: bpm ${t.bpm}`);
    assert.ok(t.bars >= 2 && t.bars <= 8, `${id}: ${t.bars} bars`);
  }
});

test('every row covers the whole loop', () => {
  for (const id of MAP_IDS) {
    const t = TRACKS[id];
    const span = loopSteps(t);
    assert.equal(span, t.bars * 8);
    for (const row of ['bassRow', 'leadRow', 'padRow', 'drumRow']) {
      assert.equal(t[row].length, span, `${id}.${row} is ${t[row].length} steps, loop is ${span}`);
    }
    for (const voice of ['bass', 'lead', 'pad']) {
      const v = t[voice];
      assert.ok(v.level >= 0 && v.level <= 1, `${id}.${voice}.level`);
      assert.ok(v.gate > 0, `${id}.${voice}.gate`);
      assert.ok(v.attack >= 0 && v.attack < v.gate * stepSeconds(t) + 1, `${id}.${voice}.attack fits the note`);
    }
    assert.ok(t.drumLevel >= 0 && t.drumLevel <= 1, `${id}.drumLevel`);
  }
});

test('bass and lead stay inside the map scale, in audible range', () => {
  for (const id of MAP_IDS) {
    const t = TRACKS[id];
    const set = new Set(t.pitchClasses);
    for (const row of [t.bassRow, t.leadRow]) {
      for (const midi of row) {
        if (midi == null) continue;
        assert.ok(midi >= 28 && midi <= 96, `${id}: ${midiName(midi)} out of range`);
        assert.ok(set.has(((midi % 12) + 12) % 12), `${id}: ${midiName(midi)} is outside ${t.key}`);
      }
    }
    // the key name's tonic must be one of them, or the spec is a lie
    const tonic = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 }[
      t.key.split(' ')[0]
    ];
    assert.ok(set.has(tonic), `${id}: tonic of "${t.key}" missing from the rows`);
  }
});

test('the loop is seamless: step n and step n+loop are the same hits', () => {
  for (const id of MAP_IDS) {
    const t = TRACKS[id];
    const span = loopSteps(t);
    for (let i = 0; i < span; i++) {
      assert.deepEqual(stepEvents(t, i + span), stepEvents(t, i), `${id}: step ${i} drifts across the loop`);
      assert.deepEqual(stepEvents(t, i - span), stepEvents(t, i), `${id}: step ${i} before the loop`);
    }
    assert.deepEqual(stepEvents(t, 0), stepEvents(t, span * 3), `${id}: third repeat`);
  }
});

test('every loop carries bass, a melody and percussion', () => {
  for (const id of MAP_IDS) {
    const t = TRACKS[id];
    const counts = { bass: 0, lead: 0, pad: 0 };
    const drums = { kick: 0, snare: 0, hat: 0, shaker: 0 };
    for (let i = 0; i < loopSteps(t); i++) {
      for (const hit of stepEvents(t, i)) {
        if (hit.kind === 'note') counts[hit.voice]++;
        else drums[hit.drum]++;
        if (hit.kind === 'note') {
          assert.ok(hit.dur > 0 && Number.isFinite(hit.dur), `${id}: note length`);
          for (const m of hit.midi) assert.ok(Number.isFinite(music.midiToFreq(m)));
        } else {
          assert.ok(hit.level > 0 && hit.level <= 1, `${id}: ${hit.drum} level`);
        }
      }
    }
    assert.ok(counts.bass >= 4, `${id}: only ${counts.bass} bass notes`);
    assert.ok(counts.lead >= 4, `${id}: only ${counts.lead} lead notes`);
    const drumTotal = drums.kick + drums.snare + drums.hat + drums.shaker;
    assert.ok(drumTotal >= 4, `${id}: only ${drumTotal} drum hits`);
    // Mirage Mesa is the one loop that is deliberately dry: no pad at all
    if (id === 'mesa') assert.equal(counts.pad, 0, 'mesa must stay dry');
    else assert.ok(counts.pad >= t.bars, `${id}: only ${counts.pad} pad hits`);
  }
});

test('the tempos and loop lengths say what each map is', () => {
  const bpm = Object.fromEntries(MAP_IDS.map((id) => [id, TRACKS[id].bpm]));
  assert.ok(bpm.alpine < 80, 'Frostbite Pass is the slow one');
  assert.ok(bpm.coast >= 88 && bpm.coast <= 104, 'Saltmarsh Coast is mid-tempo');
  assert.ok(bpm.sakura > bpm.alpine && bpm.sakura < bpm.coast, 'Sakura is gentler than the cruise, quicker than the pass');
  assert.ok(bpm.mesa > 108 && bpm.mesa < 124, 'Mirage Mesa drives');
  assert.ok(bpm.interlagos >= 128, 'Interlagos is the fastest');
  for (const id of MAP_IDS) {
    const secs = loopSeconds(TRACKS[id]);
    assert.ok(secs >= 8 && secs <= 20, `${id}: loop is ${secs.toFixed(2)}s`);
  }
});

test('unknown map ids fall back to a real loop', () => {
  assert.equal(trackFor('coast').id, 'coast');
  assert.equal(trackFor('nope').id, 'coast');
  assert.equal(trackFor('').id, 'coast');
});

/* ---------------------------------------------------------------- fake graph */

function fakeAudio(rate = 48000) {
  const log = {
    osc: [], gain: 0, filter: 0, source: 0, ramps: [], bad: [], targets: [], connected: [],
  };
  const param = (name, value = 0) => {
    const p = {
      name, value,
      setValueAtTime(v) { p.value = v; return p; },
      linearRampToValueAtTime(v) { p.value = v; return p; },
      exponentialRampToValueAtTime(v, at) {
        log.ramps.push({ name, v, at });
        // real WebAudio throws on <= 0 and on a ramp from an unset value
        if (!(v > 0)) log.bad.push({ name, v, at });
        p.value = v;
        return p;
      },
      setTargetAtTime(v) { p.value = v; log.targets.push({ name, v }); return p; },
    };
    return p;
  };
  const wired = (node) => ({
    ...node,
    connect(dst) {
      log.connected.push({ from: node.kind, to: dst && dst.kind });
      return dst;
    },
  });
  const ctx = {
    currentTime: 0,
    sampleRate: rate,
    destination: { kind: 'destination', connect: () => ctx.destination },
    resume() {},
    createGain: () => { log.gain++; return wired({ kind: 'gain', gain: param('gain', 1) }); },
    createBiquadFilter: () => {
      log.filter++;
      return wired({ kind: 'filter', type: 'lowpass', frequency: param('frequency', 350), Q: param('Q', 1) });
    },
    createOscillator: () => {
      log.osc.push({ type: 'sine', frequency: param('frequency', 440), detune: param('detune', 0) });
      return wired({
        kind: 'osc',
        get frequency() { return log.osc[log.osc.length - 1].frequency; },
        get detune() { return log.osc[log.osc.length - 1].detune; },
        start(at) { log.osc[log.osc.length - 1].started = at; },
        stop() {},
      });
    },
    createBuffer: (_ch, len) => ({ length: len, getChannelData: () => new Float32Array(len) }),
    createBufferSource: () => {
      log.source++;
      return wired({
        kind: 'source', buffer: null, loop: false,
        playbackRate: param('playbackRate', 1),
        start() {}, stop() {},
      });
    },
  };
  return { ctx, log, advance: (dt) => { ctx.currentTime += dt; } };
}

function installGlobals({ AudioContext: AC, muted = null }) {
  const store = new Map();
  if (muted != null) store.set('sprite-drift:muted', muted);
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  globalThis.addEventListener = () => {};
  globalThis.window = globalThis;
  globalThis.AudioContext = AC;
  return store;
}

const { Sound } = await import('../src/sound.ts');

const DRIVING = { speed: 9, slip: 0.2, onRoad: true, onKerb: false };

/** boot one Sound against a fresh fake context and let `seconds` of game pass */
function play(mapId, seconds, { muted = null, paused = false, speed = () => 9 } = {}) {
  const audio = fakeAudio();
  const store = installGlobals({ AudioContext: function FakeAudioContext() { return audio.ctx; }, muted });
  const sound = new Sound(mapId);
  sound.start();
  const engineOsc = audio.log.osc.length;   // the engine's own oscillators, before any music
  const car = { ...DRIVING };
  const t0 = audio.ctx.currentTime;
  for (let i = 0; i < Math.round(seconds * 120); i++) {
    car.speed = speed(i);
    sound.update(car, 0.7, paused);
    audio.advance(1 / 120);
  }
  return { sound, audio, car, store, engineOsc, elapsed: audio.ctx.currentTime - t0 };
}

/* ------------------------------------------------------------------- the graph */

test('a muted tab stays muted across reloads', () => {
  const { sound, audio, store } = play('coast', 2, { muted: '1' });
  assert.equal(sound.muted, true);
  assert.equal(sound.levels.master, 0, 'muted tab must not make a sound');
  assert.ok(audio.log.osc.length > 0, 'the sequencer still steps while muted');
  assert.equal(sound.toggleMute(), false);
  assert.equal(store.get('sprite-drift:muted'), '0', 'unmuting is remembered too');
  assert.equal(sound.levels.master, 0.55);
  assert.equal(sound.toggleMute(), true);
  assert.equal(store.get('sprite-drift:muted'), '1');
  assert.equal(sound.levels.master, 0);
});

test('the music bus sits under the engine and under the master', () => {
  const { sound } = play('coast', 3, { speed: () => 0 });
  const { master, music } = sound.levels;
  assert.equal(master, 0.55);
  assert.ok(music > 0.08 && music <= 0.12, `music bus at ${music}`);
  assert.ok(music < master / 4, 'music is a carpet, not the feature');
  // the engine is louder than the carpet at rest and still louder at speed
  const { sound: fast } = play('coast', 3, { speed: () => 26 });
  assert.ok(fast.levels.engine > sound.levels.engine, 'engine rises with speed');
  assert.ok(fast.levels.music < sound.levels.music, 'high engine pitch ducks the music further');
  assert.ok(fast.levels.music >= 0.07, 'never ducks to silence while driving');
});

test('the pause and title screens go quiet without unplugging the bus', () => {
  const { sound, audio, engineOsc } = play('alpine', 3, { paused: true });
  assert.equal(sound.levels.music, 0, 'paused tab: music silent');
  assert.equal(audio.log.osc.length, engineOsc, 'paused tab: no music notes scheduled at all');
  // the bus target reached zero, rather than being torn out of the graph
  assert.ok(audio.log.targets.some((x) => x.name === 'gain' && x.v === 0), 'bus ducked to zero');
});

test('each circuit builds a graph, fires its notes, and never schedules garbage', (t) => {
  for (const id of MAP_IDS) {
    const track = TRACKS[id];
    const { sound, audio } = play(id, 8, { speed: (i) => 6 + (i % 240) / 24 });
    const seq = sound.sequencer;
    t.diagnostic(`${id}: ${audio.log.osc.length} osc, ${audio.log.source} noise, step ${seq.step}/${seq.steps}`);
    assert.equal(seq.track, id);
    assert.ok(seq.step >= 0 && seq.step < loopSteps(track), `${id}: step out of the loop`);
    assert.ok(audio.log.osc.length >= 20, `${id}: only ${audio.log.osc.length} oscillators`);
    assert.ok(audio.log.source > 0, `${id}: percussion never fired`);
    assert.deepEqual(audio.log.bad, [], `${id}: scheduled an exponential ramp to <= 0`);
    for (const o of audio.log.osc) {
      assert.ok(Number.isFinite(o.frequency.value), `${id}: non-finite pitch`);
      assert.ok(o.frequency.value >= 20 && o.frequency.value <= 16000, `${id}: ${o.frequency.value}Hz`);
    }
    // every note plays through the music bus, which plays into the master
    assert.ok(audio.log.connected.some((c) => c.from === 'gain' && c.to === 'gain'), 'notes reach a bus');
  }
});

test('the sequencer walks each loop, wrapping exactly on the loop length', () => {
  for (const id of MAP_IDS) {
    const span = loopSteps(TRACKS[id]);
    // a hair over one full loop at this tempo
    const secs = loopSeconds(TRACKS[id]) + stepSeconds(TRACKS[id]) * 0.5;
    const { sound } = play(id, secs, { speed: () => 0 });
    const seq = sound.sequencer;
    assert.equal(seq.steps, span);
    assert.ok(seq.step < span, `${id}: wrapped`);
    const played = Math.floor((loopSeconds(TRACKS[id]) + 0.1) / stepSeconds(TRACKS[id]));
    assert.ok(played >= span, `${id}: window is shorter than the loop`);
  }
});

test('swapping the loop under a running bus keeps the pulse', () => {
  const audio = fakeAudio();
  installGlobals({ AudioContext: function FakeAudioContext() { return audio.ctx; } });
  const sound = new Sound('coast');
  sound.start();
  const car = { ...DRIVING };
  for (let i = 0; i < 400; i++) { sound.update(car, 0.5, false); audio.advance(1 / 120); }
  const before = sound.sequencer.step;
  const cursor = audio.ctx.currentTime;
  sound.setTrack('mesa');
  assert.equal(sound.sequencer.track, 'mesa');
  assert.equal(sound.sequencer.step, 0, 'the new loop starts at its top');
  assert.equal(sound.sequencer.steps, loopSteps(TRACKS.mesa));
  const count = audio.log.osc.length;
  for (let i = 0; i < 240; i++) { sound.update(car, 0.5, false); audio.advance(1 / 120); }
  assert.ok(audio.log.osc.length > count, 'the mesa pattern is playing');
  assert.ok(audio.ctx.currentTime > cursor, 'the clock never restarted');
  assert.equal(sound.levels.master, 0.55, 'no gain change on the swap');
  sound.setTrack('coast');
  sound.setTrack('coast');
  assert.equal(sound.sequencer.step, 0);
});

function midiName(midi) {
  return midiToName(midi);
}
