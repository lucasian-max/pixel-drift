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
  ENGINE_ORDERS, LIMITER_FRAC,
  STINGERS, crankHz, cueLength, engineCutoff, engineLevel, gearOf, revsOf, stingerFor,
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
  assert.equal(revsOf(0), audio.IDLE_RPM);
  assert.equal(revsOf(1), audio.REDLINE_RPM);
  assert.ok(revsOf(0.5) > audio.IDLE_RPM && revsOf(0.5) < audio.REDLINE_RPM);
  // the top of a band and the bottom of the next: the shift, heard as a drop
  const beforeShift = gearOf(5.5);   // 20 km/h: still gear 1, nearly out of it
  const afterShift = gearOf(6.3);    // 23 km/h: gear 2, back at the bottom
  assert.equal(beforeShift.gear, 1);
  assert.equal(afterShift.gear, 2);
  const hz = (g) => crankHz(revsOf(g.frac));
  assert.ok(hz(beforeShift) - hz(afterShift) > 60, 'the note must drop on the shift');
});

test('the firing note sits where a four-stroke puts it', () => {
  // 900–7000 rpm is 15–117 Hz of crank; order 2 is the firing frequency, 30–233 Hz
  assert.ok(Math.abs(crankHz(revsOf(0)) - 15) < 0.01);
  assert.ok(Math.abs(crankHz(revsOf(1)) - 7000 / 60) < 0.01);
  const orders = ENGINE_ORDERS.map((o) => o.order);
  assert.ok(orders.includes(0.5) && orders.includes(2), 'low lope plus firing order');
  assert.ok(ENGINE_ORDERS.length >= 4, 'a stack, not a single tone');
  const sum = ENGINE_ORDERS.reduce((a, o) => a + o.gain, 0);
  assert.ok(sum > 0.6 && sum < 1.2, `stack sums to ${sum}`);
  for (const o of ENGINE_ORDERS) {
    assert.ok(['sine', 'square', 'sawtooth', 'triangle'].includes(o.type));
    assert.ok(o.gain > 0 && o.gain <= 1);
    assert.ok(o.load >= 0 && o.load <= 1 && o.withRevs >= 0 && o.withRevs <= 1);
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

test('the cue layer is gone: two voices, and only two', () => {
  // the owner listened: powers stay, everything else goes. Pin it, so the
  // chimes/squeal/impact/click layer cannot creep back in unnoticed.
  for (const gone of ['LAP_EVENTS', 'LAP_BEST_EVENTS', 'START_EVENTS', 'CLICK_EVENTS', 'GRAVEL_EVENTS', 'impactEvents', 'squealCentre', 'squealQ', 'squealTone']) {
    assert.equal(audio[gone], undefined, `${gone} must stay deleted`);
  }
  // the two voices that remain both start at or after zero
  for (const cue of [...STINGERS.map((s) => s.events), audio.POWER_LAND_EVENTS]) {
    assert.ok(cue.every((e) => e.at >= 0), 'a cue must not start before it is played');
  }
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

const IDLE = { speed: 0, slip: 0, onRoad: true, onKerb: false };

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
  assert.equal(audio.log.osc.length, 8 + 1, 'eight orders and the limiter lfo, and nothing else');
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
  for (let i = 1; i <= 720; i++) bases.push(crankHz(revsOf(gearOf(i * 0.05).frac)));
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
  assert.ok(s.base >= 14 && s.base <= 120, `crank at ${s.base} Hz`);
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

test('the mix is conservative and the master is compressed', () => {
  const { sound, audio } = boot();
  drive(sound, audio, (i) => ({ speed: 6 + (i % 240) / 20 }), 480);
  sound.power('PEARL DRIFT');
  assert.equal(sound.levels.master, 0.55);
  assert.equal(audio.log.comp, 1);
  assert.ok(sound.levels.engine <= 0.10, `engine level ${sound.levels.engine}`);
  assert.ok(gainRamps(audio.log).length > 0, 'the cue was rendered');
  for (const r of gainRamps(audio.log)) assert.ok(r.v > 0 && r.v <= 0.36, `gain ${r.v}`);
  assert.deepEqual(audio.log.bad, [], 'nothing illegal was scheduled all drive');
  // every continuing voice is wired into the master, which is wired into the pump
  assert.ok(audio.log.connected.some((c) => c.from === 'gain' && c.to === 'comp'), 'master → compressor');
  assert.ok(audio.log.connected.some((c) => c.from === 'comp' && c.to === 'destination'));
});

test('paused is silence, not a torn-out graph', () => {
  const { sound, audio } = boot();
  drive(sound, audio, { speed: 14 }, 30, 1 / 120, 0.9, false);
  const osc = audio.log.osc.length;
  drive(sound, audio, { speed: 14 }, 30, 1 / 120, 0.9, true);
  assert.equal(sound.levels.engine, 0);
  assert.equal(sound.engineState.limiter, 0);
  assert.equal(audio.log.osc.length, osc, 'no nodes were built for a paused frame');
  assert.ok(audio.log.targets.some((x) => x.v === 0), 'the voices were turned down, not cut out');
});
