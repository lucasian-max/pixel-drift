#!/usr/bin/env node
// scripts/music.check.mjs — the circuit music tables, proven without a speaker.
//
// The music is NOT played: the owner listened to it and had it taken out of the
// game, and src/sound.ts no longer imports anything from src/music.ts. What
// survives here is the part that is still true and still worth keeping honest —
// the tables themselves. They are a written record of what each circuit sounds
// like, they are in key, they loop seamlessly, and a future attempt at music
// should start from them rather than from a blank page.
//
// The synth's own proof (graph shape, ramps, pitch ranges) lives next door in
// scripts/audio.check.mjs, against a fake AudioContext.
//
// Run by `npm test`. `node --test scripts/music.check.mjs` also works.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const music = await import('../src/music.ts');
const { TRACKS, MAP_IDS, loopSteps, loopSeconds, stepEvents, stepSeconds, midiToName, trackFor } = music;
const SRC = new URL('../src/', import.meta.url);

/* ------------------------------------------------------- kept, not played */

test('nothing in src/ plays the music tables', () => {
  const offenders = [];
  for (const name of fs.readdirSync(SRC)) {
    if (!name.endsWith('.ts') || name === 'music.ts') continue;
    const text = fs.readFileSync(new URL(name, SRC), 'utf8');
    // an import, a re-export, or a dynamic import of the music module
    if (/from\s+['"]\.\/music['"]/.test(text) || /import\(\s*['"]\.\/music['"]\s*\)/.test(text)) {
      offenders.push(name);
    }
  }
  assert.deepEqual(offenders, [], 'music.ts is data now: no module may import it');
});

test('the tables stay pure data: no audio nodes, no window, no side effects', () => {
  const text = fs.readFileSync(new URL('music.ts', SRC), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')   // the prose may say "AudioContext"; the code may not
    .replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(text, /AudioContext|createOscillator|createGain|window\.|localStorage/);
});

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

function midiName(midi) {
  return midiToName(midi);
}
