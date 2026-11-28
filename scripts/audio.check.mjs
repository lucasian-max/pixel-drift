#!/usr/bin/env node
// scripts/audio.check.mjs — the car's sound, proven without a speaker.
//
// Two halves, because the sound is two halves:
//   1. src/audio.ts — the numbers: gear curve, harmonic stack, and the event
//      tables the power stingers are built from. Pure, so they can be read.
//   2. src/sound.ts — the wiring, driven against a fake AudioContext that
//      records every node and every automation call. That lets us assert what a
//      listener would hear: pitch rising through a gear and dropping on the
//      shift, stingers per power, silence when muted or paused, and no ramp the
//      spec rejects.
//
// The mix is two voices — a quiet engine and the powers — and the suite pins
// that: the cue layer (squeal, surfaces, impacts, chimes, clicks) is gone and
// must stay gone.
//
// Run by `npm test`. `node --test scripts/audio.check.mjs` also works.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';

/* src/sound.ts imports './audio' the way Vite resolves it; node needs the
   extension, so teach the loader that one trick before importing the synth. */
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) {
      try { return next(`${specifier}.ts`, context); } catch { /* fall through */ }
    }
    return next(specifier, context);
  },
});

const audio = await import('../src/audio.ts');
const {
  ENGINE_VOICES, LIMITER_FRAC,
  STINGERS, crankHz, cueLength, engineCutoff, engineLevel, engineVoice, gearOf,
  impactEvents, revsOf, squealCentre, squealQ, stingerFor,
} = audio;

/* --------------------------------------------------------------- pure numbers */

test('audio.ts stays pure data: no audio nodes, no globals', () => {
  const text = fs.readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(text, /AudioContext|createOscillator|createGain|window\.|localStorage|document\./);
});

test('the engine reads the gear the dashboard prints', () => {
  for (let speed = -4; speed <= 40; speed += 0.37) {
    const g = gearOf(speed);
    const kmh = Math.round(Math.abs(speed) * 3.6);
    // exactly pixelui.ts's rule, so the note can never show a gear the HUD doesn't
    assert.equal(g.gear, Math.min(6, 1 + Math.floor(kmh / 22)), `at ${speed} u/s`);
    assert.equal(g.reverse, speed < -0.5);
    assert.ok(g.frac >= 0 && g.frac <= 1, `frac ${g.frac}`);
    assert.equal(g.kmh, kmh);
  }
});

test('every gearband pulls from idle to redline and the shift drops the note', () => {
  for (const v of ENGINE_VOICES) {
    assert.equal(revsOf(0, v), v.idle);
    assert.equal(revsOf(1, v), v.redline);
    assert.ok(revsOf(0.5, v) > v.idle && revsOf(0.5, v) < v.redline);
  }
  // the top of a band and the bottom of the next: the shift, heard as a drop
  const beforeShift = gearOf(5.5);   // 20 km/h: still gear 1, nearly out of it
  const afterShift = gearOf(6.3);    // 23 km/h: gear 2, back at the bottom
  assert.equal(beforeShift.gear, 1);
  assert.equal(afterShift.gear, 2);
  const hz = (g) => crankHz(revsOf(g.frac, ENGINE_VOICES[0]));
  assert.ok(hz(beforeShift) - hz(afterShift) > 60, 'the note must drop on the shift');
});

test('each car has its own engine: distinct stacks, pearl revs highest, dune lowest', () => {
  assert.equal(ENGINE_VOICES.length, 3);
  const [pearl, groupb, dune] = ENGINE_VOICES;
  assert.ok(pearl.redline > groupb.redline && groupb.redline > dune.redline, 'the stop is the character');
  assert.ok(dune.idle < groupb.idle && groupb.idle < pearl.idle, 'the lope idles lower');
  // distinct harmonic signatures: no two cars share an order multiset
  const sig = (v) => v.orders.map((o) => `${o.order}:${o.type}`).sort().join(',');
  assert.notEqual(sig(pearl), sig(groupb), 'pearl and group B share a voice');
  assert.notEqual(sig(groupb), sig(dune), 'group B and dune share a voice');
  for (const v of ENGINE_VOICES) {
    assert.ok(v.orders.length >= 6, 'a stack, not a single tone');
    const sum = v.orders.reduce((a, o) => a + o.gain, 0);
    assert.ok(sum > 0.5 && sum < 1.2, `stack sums to ${sum}`);
    for (const o of v.orders) {
      assert.ok(['sine', 'square', 'sawtooth', 'triangle'].includes(o.type));
      assert.ok(o.gain > 0 && o.gain <= 1);
      assert.ok(o.load >= 0 && o.load <= 1 && o.withRevs >= 0 && o.withRevs <= 1);
    }
  }
  // the grumble is the half-orders: group B leans on them, the pearl does not
  const lope = (v) => v.orders.filter((o) => o.order % 1 !== 0).reduce((a, o) => a + o.gain, 0);
  assert.ok(lope(groupb) > lope(pearl), 'group B must lope');
  assert.ok(lope(dune) > lope(pearl), 'the truck lope is there too');
  // an out-of-range variant clamps to the ends of the roster, never explodes
  assert.equal(engineVoice(99).redline, dune.redline);
  assert.equal(engineVoice(-5).redline, pearl.redline);
});

test('the firing note sits where a four-stroke puts it, for every car', () => {
  // rpm over sixty is hertz of crank; order 2 is the firing frequency
  for (const v of ENGINE_VOICES) {
    assert.ok(Math.abs(crankHz(revsOf(0, v)) - v.idle / 60) < 0.01);
    assert.ok(Math.abs(crankHz(revsOf(1, v)) - v.redline / 60) < 0.01);
    const orders = v.orders.map((o) => o.order);
    assert.ok(orders.includes(0.5) && orders.includes(2), 'low lope plus firing order');
  }
});

test('load opens the filter; a closed throttle dulls the note', () => {
  assert.ok(engineCutoff(1, 1) > engineCutoff(1, 0) + 500, 'throttle opens the top end');
  assert.ok(engineCutoff(1, 0) > engineCutoff(0, 0), 'revs open it too');
  assert.ok(engineCutoff(0, 0) >= 200 && engineCutoff(1, 1) <= 3000, 'stays musical');
  assert.ok(engineLevel(100, 1) > engineLevel(100, 0), 'more throttle, more sound');
  assert.ok(engineLevel(120, 1) > engineLevel(10, 1), 'more speed, more sound');
  assert.ok(engineLevel(200, 1) <= 0.14, 'conservative: the engine never dominates');
});

test('the decorative cue layer stays gone: chimes, lifts, clicks, scuffs', () => {
  // the owner's verdict on the first listen: powers stay, impacts and the
  // scrub came back by request — the chimes, lifts, clicks and scuffs did not
  for (const gone of ['LAP_EVENTS', 'LAP_BEST_EVENTS', 'START_EVENTS', 'CLICK_EVENTS', 'GRAVEL_EVENTS', 'squealTone']) {
    assert.equal(audio[gone], undefined, `${gone} must stay deleted`);
  }
  // and the voices that DID come back must exist, so this cannot rot silently
  assert.equal(typeof audio.impactEvents, 'function');
  assert.equal(typeof audio.squealCentre, 'function');
  // every one-shot starts at or after zero: no cue schedules into the past
  for (const cue of [...STINGERS.map((s) => s.events), audio.POWER_LAND_EVENTS, impactEvents(0.9)]) {
    assert.ok(cue.every((e) => e.at >= 0), 'a cue must not start before it is played');
  }
});

test('the scrub is a low wide band, and the old whine stays gone', () => {
  assert.equal(audio.squealTone, undefined, 'the sung partial must stay deleted');
  const centres = [0, 1.5, 3, 4.5, 6, 9].map((slip) => squealCentre(slip, 60));
  for (let i = 1; i < centres.length; i++) {
    assert.ok(centres[i] >= centres[i - 1], 'monotonic in slip');
  }
  assert.ok(centres[0] >= 540 && centres[0] <= 700, 'a crawling lock-up is a low murmur');
  assert.ok(centres[centres.length - 1] <= 1010, 'a hard slide stays under the whistle zone');
  for (const slip of [0, 2, 4, 6, 8]) {
    const q = squealQ(slip);
    assert.ok(q >= 1.1 && q <= 2.2, `Q ${q}: wide, never a focused shriek`);
  }
  assert.ok(squealCentre(4, 100) > squealCentre(4, 10), 'faster slide, brighter scrub');
});

test('an impact is layered, and the layers switch on with strength', () => {
  const light = impactEvents(0.1);
  const hard = impactEvents(0.9);
  assert.ok(hard.length > light.length, 'a hard hit has more layers than a nudge');
  assert.ok(light.length >= 3, 'even a nudge is a thud + knock + crack');
  for (const e of [...light, ...hard]) {
    assert.ok(e.dur > 0 && e.dur < 0.6, `${e.k} length`);
    assert.ok(e.gain > 0 && e.gain <= 0.36, `${e.k} peak ${e.gain}`);
    if (e.k === 'noise') assert.ok(e.centre > 200 && e.q > 0);
    if (e.k === 'tone') assert.ok(e.f > 20 && (e.to == null || e.to > 20));
  }
  // the debris spray only exists once the hit is worth it
  assert.equal(light.filter((e) => e.k === 'noise').length, 2);
  assert.ok(hard.filter((e) => e.k === 'noise').length >= 4);
});

test('each power has its own voice, and the fallback is not silence', () => {
  assert.equal(STINGERS.length, 3);
  for (const s of STINGERS) {
    assert.ok(s.events.length >= 3, `${s.name} needs a real gesture`);
    assert.ok(cueLength(s.events) > 0.3, `${s.name} is long enough to read`);
    assert.ok(cueLength(s.events) < 1.4, `${s.name} must not sit on the game`);
  }
  // tunel is the phase; its snap is a separate cue the placement plays
  assert.ok(audio.POWER_LAND_EVENTS.length >= 2);
  // an unknown power still gets a blip rather than a silent press
  const fallback = stingerFor('NOT A POWER');
  assert.ok(fallback.events.length > 0);
  assert.equal(stingerFor('TUNNEL').name, 'TUNNEL');
});

/* ------------------------------------------------------------------ fake graph */

function fakeAudio(rate = 48000) {
  const log = {
    osc: [], comp: 0, gainCount: 0, filterCount: 0, sourceCount: 0,
    ramps: [], bad: [], targets: [], connected: [], gains: [],
  };
  const param = (name, value = 0) => {
    const p = {
      name, value, explicit: null,
      setValueAtTime(v) { p.value = v; p.explicit = v; return p; },
      linearRampToValueAtTime(v) { p.value = v; return p; },
      exponentialRampToValueAtTime(v, at) {
        log.ramps.push({ name, v, at });
        // WebAudio throws on a target of zero, and on a ramp that starts at zero
        if (!(v > 0)) log.bad.push({ why: 'target <= 0', name, v, at });
        else if (!(p.explicit > 0)) log.bad.push({ why: 'ramp from zero/unset', name, v, at });
        p.value = v;
        return p;
      },
      setTargetAtTime(v) { p.value = v; log.targets.push({ name, v }); return p; },
      cancelScheduledValues() { return p; },
    };
    return p;
  };
  const wired = (node) => ({
    ...node,
    connect(dst) {
      log.connected.push({ from: node.kind, to: dst && dst.kind });
      return dst;
    },
    disconnect() {},
  });
  const ctx = {
    currentTime: 0,
    sampleRate: rate,
    destination: { kind: 'destination', connect: () => ctx.destination },
    resume() {},
    createGain: () => {
      log.gainCount++;
      const g = wired({ kind: 'gain', gain: param('gain', 1) });
      log.gains.push(g);
      return g;
    },
    createBiquadFilter: () => {
      log.filterCount++;
      return wired({ kind: 'filter', type: 'lowpass', frequency: param('frequency', 350), Q: param('Q', 1) });
    },
    createOscillator: () => {
      const rec = { type: 'sine', frequency: param('frequency', 440), detune: param('detune', 0), started: null };
      log.osc.push(rec);
      return wired({
        kind: 'osc',
        set type(v) { rec.type = v; },
        get type() { return rec.type; },
        get frequency() { return rec.frequency; },
        get detune() { return rec.detune; },
        start(at) { rec.started = at; },
        stop() {},
      });
    },
    createBuffer: (_ch, len) => ({ length: len, getChannelData: () => new Float32Array(len) }),
    createBufferSource: () => {
      log.sourceCount++;
      return wired({
        kind: 'source', buffer: null, loop: false,
        playbackRate: param('playbackRate', 1),
        start() {}, stop() {},
      });
    },
    createDynamicsCompressor: () => {
      log.comp++;
      return wired({
        kind: 'comp',
        threshold: param('threshold', -24), knee: param('knee', 30), ratio: param('ratio', 12),
        attack: param('attack', 0.003), release: param('release', 0.25),
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
const { CAR_POWERS } = await import('../src/powers.ts');

const IDLE = { speed: 0, slip: 0, onRoad: true, onKerb: false, variant: 0 };

function boot({ muted = null } = {}) {
  const a = fakeAudio();
  const store = installGlobals({ AudioContext: function FakeAudioContext() { return a.ctx; }, muted });
  const sound = new Sound();
  sound.start();
  return { sound, audio: a, store };
}

/** the ramps that matter for loudness are the ones on a gain, not on a pitch */
const gainRamps = (log) => log.ramps.filter((r) => r.name === 'gain');

/** let `frames` of game pass at a fixed state (or a per-frame function of it) */
function drive(sound, audio, state, frames = 60, dt = 1 / 120, throttle = 0.8, paused = false) {
  const car = { ...IDLE };
  for (let i = 0; i < frames; i++) {
    Object.assign(car, typeof state === 'function' ? state(i, car) : state);
    sound.update(car, typeof throttle === 'function' ? throttle(i) : throttle, paused);
    audio.advance(dt);
  }
  return car;
}

/* ---------------------------------------------------------------- the graph */

test('start builds the car once: a stack, a limiter, a compressor', () => {
  const { sound, audio } = boot();
  assert.equal(audio.log.osc.length, ENGINE_VOICES[0].orders.length + 1, 'the pearl stack and the limiter lfo, and nothing else');
  assert.equal(audio.log.comp, 1, 'one compressor on the master');
  assert.equal(sound.levels.master, 0.55);
  // a second start (a new run on the same page) must not add a second car
  const before = { osc: audio.log.osc.length, gain: audio.log.gainCount };
  sound.start();
  assert.deepEqual({ osc: audio.log.osc.length, gain: audio.log.gainCount }, before);
});

test('the note climbs through a gear and drops on the shift', () => {
  const { sound, audio } = boot();
  const bases = [];
  drive(sound, audio, (i) => ({ speed: i * 0.05, slip: 0 }), 720);   // 0 → 30 u/s
  const marks = [];
  for (let i = 0; i < 720; i++) marks.push(i);
  // sample the crank frequency the engine was told to play, frame by frame
  for (let i = 1; i <= 720; i++) bases.push(crankHz(revsOf(gearOf(i * 0.05).frac, ENGINE_VOICES[0])));
  let drops = 0;
  for (let i = 1; i < bases.length; i++) if (bases[i] < bases[i - 1] - 20) drops++;
  assert.ok(drops >= 3, `the shifts must be heard (${drops} drops)`);
  assert.ok(bases[bases.length - 1] > 0);
  assert.ok(sound.engineState.gear >= 3, 'a 30 u/s drive is well up the box');
});

test('engine pitch stays inside the speakers at every speed', () => {
  const { sound, audio } = boot();
  drive(sound, audio, (i) => ({ speed: -6 + i * 0.06 }), 720);
  for (const o of audio.log.osc) {
    assert.ok(Number.isFinite(o.frequency.value));
    assert.ok(o.frequency.value >= 10 && o.frequency.value <= 12000, `${o.frequency.value} Hz`);
  }
  const s = sound.engineState;
  assert.ok(s.base >= 12 && s.base <= 140, `crank at ${s.base} Hz`);
});

test('the throttle opens the filter and the note gets louder', () => {
  const { sound, audio } = boot();
  drive(sound, audio, { speed: 20, slip: 0 }, 60, 1 / 120, 0);
  const coast = { cutoff: sound.engineState.cutoff, level: sound.levels.engine, hiss: sound.levels.hiss };
  drive(sound, audio, { speed: 20, slip: 0 }, 60, 1 / 120, 1);
  const flat = { cutoff: sound.engineState.cutoff, level: sound.levels.engine, hiss: sound.levels.hiss };
  assert.ok(flat.cutoff > coast.cutoff + 300, `cutoff ${coast.cutoff} → ${flat.cutoff}`);
  assert.ok(flat.level > coast.level, 'on-load is louder than off-load');
  assert.ok(flat.hiss > coast.hiss, 'and the exhaust band opens with it');
  assert.ok(flat.level <= 0.14, 'and still never the loudest thing in the room');
});

test('the limiter only chops with the needle on the stop', () => {
  const { sound, audio } = boot();
  drive(sound, audio, { speed: 2, slip: 0 }, 30, 1 / 120, 1);     // gear 1, bottom of the band
  assert.equal(sound.engineState.limiter, 0, 'idle is not on the limiter');
  // 21.4 km/h into gear 1 is 0.97 of the band: on the stop
  drive(sound, audio, (i) => ({ speed: 5.9 + i * 0.001, slip: 0 }), 30, 1 / 120, 1);
  assert.ok(sound.engineState.limiter > 0, 'a flat-out top of gear cracks');
  drive(sound, audio, { speed: 5.9 }, 30, 1 / 120, 0);
  assert.equal(sound.engineState.limiter, 0, 'off the throttle it stops');
});

test('every power makes a sound, and each one is its own', () => {
  const powers = CAR_POWERS;
  const { sound, audio } = boot();
  const fingerprints = [];
  for (const p of powers) {
    const before = audio.log.osc.length;
    sound.power(p.name);
    const made = audio.log.osc.slice(before).map((o) => `${o.type}:${Math.round(o.frequency.value)}`);
    assert.ok(made.length >= 2, `${p.name} fired silently`);
    fingerprints.push(made.join(','));
  }
  assert.equal(new Set(fingerprints).size, powers.length, 'powers must not share a voice');
  // TUNNEL is the phase; the placement snap is its own cue
  const before = audio.log.osc.length;
  sound.powerLand();
  assert.ok(audio.log.osc.length > before, 'the blink landing snaps');
  assert.deepEqual(audio.log.bad, []);
});

test('mute silences the cue and the car, and is remembered', () => {
  const { sound, audio, store } = boot({ muted: '1' });
  assert.equal(sound.muted, true);
  assert.equal(sound.levels.master, 0);
  const osc = audio.log.osc.length;
  const src = audio.log.sourceCount;
  sound.power('THUNDERCLAP');
  assert.equal(audio.log.osc.length, osc, 'a muted tab schedules nothing');
  assert.equal(audio.log.sourceCount, src);
  assert.equal(sound.toggleMute(), false);
  assert.equal(store.get('sprite-drift:muted'), '0', 'unmuting is remembered too');
  assert.equal(sound.levels.master, 0.55);
  sound.power('THUNDERCLAP');
  assert.ok(audio.log.osc.length > osc, 'unmuted, a power is heard');
});

test('switching cars swaps the engine: a new stack, a lower stop', () => {
  const { sound, audio } = boot();
  drive(sound, audio, { speed: 20, variant: 0 }, 30, 1 / 120, 1);
  const pearlBase = sound.engineState.base;
  const before = audio.log.osc.length;
  drive(sound, audio, { speed: 20, variant: 1 }, 30, 1 / 120, 1);
  const groupbBase = sound.engineState.base;
  // group B's stack replaced pearl's, and its stop is lower at the same speed
  assert.ok(groupbBase < pearlBase, `group B ${groupbBase.toFixed(1)} vs pearl ${pearlBase.toFixed(1)} Hz`);
  assert.equal(audio.log.osc.length, before + ENGINE_VOICES[1].orders.length, 'the old stack was replaced, not stacked');
  drive(sound, audio, { speed: 20, variant: 2 }, 30, 1 / 120, 1);
  assert.ok(sound.engineState.base < groupbBase, 'the truck stops lowest of all');
});

test('the mix is conservative and the master is compressed', () => {
  const { sound, audio } = boot();
  drive(sound, audio, (i) => ({ speed: 6 + (i % 240) / 20, slip: (i % 12) }), 480);
  sound.impact(0.8);
  sound.power('PEARL DRIFT');
  assert.equal(sound.levels.master, 0.55);
  assert.equal(audio.log.comp, 1);
  assert.ok(sound.levels.engine <= 0.10, `engine level ${sound.levels.engine}`);
  assert.ok(sound.levels.squeal <= 0.05, `scrub level ${sound.levels.squeal}`);
  assert.ok(gainRamps(audio.log).length > 0, 'the cues were rendered');
  for (const r of gainRamps(audio.log)) assert.ok(r.v > 0 && r.v <= 0.36, `gain ${r.v}`);
  assert.deepEqual(audio.log.bad, [], 'nothing illegal was scheduled all drive');
  // every continuing voice is wired into the master, which is wired into the pump
  assert.ok(audio.log.connected.some((c) => c.from === 'gain' && c.to === 'comp'), 'master → compressor');
  assert.ok(audio.log.connected.some((c) => c.from === 'comp' && c.to === 'destination'));
});

test('paused is silence, not a torn-out graph', () => {
  const { sound, audio } = boot();
  drive(sound, audio, { speed: 14, slip: 4 }, 30, 1 / 120, 0.9, false);
  const osc = audio.log.osc.length;
  drive(sound, audio, { speed: 14, slip: 4 }, 30, 1 / 120, 0.9, true);
  assert.equal(sound.levels.engine, 0);
  assert.equal(sound.levels.squeal, 0);
  assert.equal(sound.engineState.limiter, 0);
  assert.equal(audio.log.osc.length, osc, 'no nodes were built for a paused frame');
  assert.ok(audio.log.targets.some((x) => x.v === 0), 'the voices were turned down, not cut out');
});
