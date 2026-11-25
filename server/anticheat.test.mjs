// server/anticheat.test.mjs — synthetic lap traces against the real circuit.
//
// The fixture drives the centreline of server/track-data.json at a fixed
// speed and samples it the way src/main.ts samples a live lap: every 200 ms,
// plus an exact final point on the line. Powers are applied the way the game
// fires them (the aimed WORMHOLE + the mark main.ts puts on the trace): the
// placement frame puts the car at the frame's position and carries
// { e: 'blink' }; the car keeps rolling from there.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateLap, RULES, trackList } from './anticheat.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = JSON.parse(fs.readFileSync(path.join(here, 'track-data.json'), 'utf8'));
const TRACK = DATA.coast;
const PTS = TRACK.points;
const N = PTS.length;
const START = PTS.reduce(
  (best, p, i) =>
    Math.hypot(p[0] - TRACK.start.x, p[1] - TRACK.start.z) <
    Math.hypot(PTS[best][0] - TRACK.start.x, PTS[best][1] - TRACK.start.z) ? i : best,
  0,
);

const SAMPLE_MS = 200; // the client's lap trace interval
const STEP = 2;        // metres between synthetic path points

/** The centreline as a uniform path of STEP-metre samples from the line. */
function lapPath() {
  const out = [];
  let i = START;
  let travelled = 0;
  for (let guard = 0; guard < N * 4 && travelled < TRACK.length - 0.3; guard++) {
    const a = PTS[i];
    const b = PTS[(i + 1) % N];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) { i = (i + 1) % N; continue; }
    for (let k = 0; k < len; k += STEP) {
      const f = k / len;
      out.push({ x: a[0] + (b[0] - a[0]) * f, z: a[1] + (b[1] - a[1]) * f, s: travelled + k });
    }
    travelled += len;
    i = (i + 1) % N;
  }
  return out;
}

const PATH = lapPath();
const TOTAL = PATH[PATH.length - 1].s;

/** Point at arc length s along the centreline. */
function at(s) {
  if (s <= 0) return PATH[0];
  let lo = 0;
  let hi = PATH.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (PATH[mid].s <= s) lo = mid;
    else hi = mid - 1;
  }
  return PATH[lo];
}

/** Unit direction of the centreline at arc length s. */
function dirAt(s) {
  const a = at(Math.max(0, s - 1));
  const b = at(Math.min(TOTAL, s + 1));
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const d = Math.hypot(dx, dz) || 1;
  return [dx / d, dz / d];
}

/**
 * Drive the lap at `speed` units/s, sampled every `sample` ms. Each blink is
 * { at, delta?: [dx, dz] }: on the placement frame the car lands `delta`
 * (default: BLINK_MAX straight ahead) from its previous frame and the frame
 * carries e: 'blink'. Placement frames take no clock time.
 */
function drive(speed, { blinks = [], sample = SAMPLE_MS } = {}) {
  const marks = blinks
    .map((b) => ({ s: b.at, delta: b.delta ?? null, done: false }))
    .sort((a, b) => a.s - b.s);
  const trace = [{ x: PATH[0].x, z: PATH[0].z, t: 0 }];
  let t = 0;
  let placed = 0; // metres gained by placements, for the car's position
  for (;;) {
    const next = t + sample;
    const s = Math.min(TOTAL, (next / 1000) * speed + placed);
    if (s >= TOTAL) break;
    t = next;
    const hit = marks.find((m) => !m.done && m.s <= s);
    if (!hit) {
      const p = at(s);
      trace.push({ x: p.x, z: p.z, t });
      continue;
    }
    hit.done = true;
    const before = trace[trace.length - 1];
    const ahead = dirAt(s);
    const delta = hit.delta ?? [ahead[0] * RULES.BLINK_MAX, ahead[1] * RULES.BLINK_MAX];
    const was = at(s);
    const nx = before.x + delta[0];
    const nz = before.z + delta[1];
    // the car resumes rolling from where it landed; the clock keeps ticking
    placed = Math.min(TOTAL - s, Math.max(0, (nx - was.x) * ahead[0] + (nz - was.z) * ahead[1]));
    trace.push({ x: nx, z: nz, t, e: 'blink' });
  }
  const ms = Math.round((TOTAL / speed) * 1000);
  trace.push({ x: PATH[PATH.length - 1].x, z: PATH[PATH.length - 1].z, t: ms });
  return { ms, trace };
}

/** How far along the lap a placement sits. */
const REL = (f) => TOTAL * f;

function markTimes(trace) {
  return trace.filter((p) => p.e === 'blink').map((p) => p.t);
}

const clean = drive(30);

test('fixture sanity: the clean lap is a real lap', () => {
  const v = validateLap('coast', clean.ms, clean.trace);
  assert.equal(v.ok, true, v.reason);
  assert.ok(v.summary.pathLength > TRACK.length * 0.8);
  assert.ok(Math.abs(v.summary.avgSpeed - 30) < 1);
});

test('clean full-throttle lap passes', () => {
  for (const speed of [20, 30, 31]) {
    const lap = drive(speed);
    const v = validateLap('coast', lap.ms, lap.trace);
    assert.equal(v.ok, true, `${speed} u/s: ${v.reason}`);
  }
});

test('clean lap with a marked WORMHOLE placement passes', () => {
  // aimed placement: lands full radius ahead of the previous sample
  const lap = drive(30, { blinks: [{ at: REL(0.9) }] });
  assert.equal(markTimes(lap.trace).length, 1);
  const v = validateLap('coast', lap.ms, lap.trace);
  assert.equal(v.ok, true, v.reason);
  assert.equal(v.summary.blinks, 1);
});

test('a marked sideways 12 m placement passes', () => {
  // aimed WORMHOLE: 12 m to the side of the travel line, still inside the disc
  const lap = drive(30, { blinks: [{ at: REL(0.8), delta: [0, 12] }] });
  assert.equal(markTimes(lap.trace).length, 1);
  const v = validateLap('coast', lap.ms, lap.trace);
  assert.equal(v.ok, true, v.reason);
});

test('two marked placements at or past the cooldown pass', () => {
  // the car drives both placements for real (more travel than one lap, so
  // each lands ahead on the road); the second fires ten seconds after the
  // first, on the trace clock
  const lap = drive(30);
  const firstAt = Math.floor(lap.trace.length * 0.2);
  const secondAt = Math.min(lap.trace.length - 3, firstAt + 50);
  for (const k of [firstAt, secondAt]) {
    // a placement lands 1 m up the road on its own frame: inside the disc,
    // and the car keeps rolling where it landed
    const p = lap.trace[k];
    const q = lap.trace[k - 1];
    const left = Math.hypot(p.x - q.x, p.z - q.z) || 1;
    lap.trace[k] = { x: q.x + ((p.x - q.x) / left) * 1.1, z: q.z + ((p.z - q.z) / left) * 1.1, t: p.t, e: 'blink' };
  }
  const at = markTimes(lap.trace);
  assert.equal(at.length, 2, `marks ${at}`);
  const gap = Math.abs(at[1] - at[0]);
  assert.ok(gap >= RULES.WORMHOLE_COOLDOWN * 1000, `marks ${at}`);
  const v = validateLap('coast', lap.ms, lap.trace);
  assert.equal(v.ok, true, v.reason);
  assert.equal(v.summary.blinks, 2, v.reason);
});

test('an unmarked 14 m teleport fails', () => {
  // same geometry as a legal placement, but the frame carries no mark
  const lap = drive(30);
  const i = Math.floor(lap.trace.length * 0.5);
  const a = lap.trace[i - 1];
  const p = lap.trace[i];
  lap.trace[i] = { x: a.x + 12, z: a.z, t: p.t };
  const v = validateLap('coast', lap.ms, lap.trace);
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'impossible speed');
});

test('a marked 24 m placement fails', () => {
  const lap = drive(30, { blinks: [{ at: REL(0.3), delta: [0, 24] }] });
  assert.equal(markTimes(lap.trace).length, 1);
  const v = validateLap('coast', lap.ms, lap.trace);
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'blink jump too far');
});

test('a marked 23 m placement passes (collide push-out slack)', () => {
  // 22 m promised + a hair of barrier push-out is legal play; anything past
  // BLINK_MAX + PUSH_SLACK still rejects (see the 24 m test above)
  const lap = drive(30, { blinks: [{ at: REL(0.4), delta: [0, 23] }] });
  const v = validateLap('coast', lap.ms, lap.trace);
  assert.equal(v.ok, true, `reason: ${v.reason}`);
});

test('a tunnel-heavy lap is judged against its own skip budget', () => {
  // a slowish lap (~30 s, sampled clear of the still threshold) carrying three
  // full-radius placements loses 3 x
  // BLINK_MAX of rolled route by design; the length ratio alone would call
  // this "route too short"
  const lap = drive(12, { blinks: [{ at: REL(0.1006) }, { at: REL(0.4804) }, { at: REL(0.8603) }] });
  assert.equal(markTimes(lap.trace).length, 3);  
  // (this lap's marks are spaced clear of the 9 s cooldown in wall time)
  const v = validateLap('coast', lap.ms, lap.trace);
  assert.equal(v.ok, true, `reason: ${v.reason}`);
});

test('marked placements closer together than the cooldown fail', () => {
  const lap = drive(30);
  for (const k of [Math.floor(lap.trace.length * 0.8), Math.floor(lap.trace.length * 0.86)]) {
    const p = lap.trace[k];
    lap.trace[k] = { ...p, e: 'blink' };
  }
  assert.equal(markTimes(lap.trace).length, 2);
  const v = validateLap('coast', lap.ms, lap.trace);
  assert.equal(v.ok, false, `reason: ${v.reason}`);
  assert.equal(v.reason, 'blink marks too frequent');
});

test('a sideways-marked teleport to the infield fails', () => {
  // 25 m sideways in one marked frame: outside the disc, and off the circuit
  const lap = drive(30, { blinks: [{ at: REL(0.8), delta: [0, 25] }] });
  const v = validateLap('coast', lap.ms, lap.trace);
  assert.equal(v.ok, false);
  assert.ok(/blink jump too far|off the circuit|impossible/.test(v.reason), v.reason);
});

test('a drift between successive circuit laps passes', () => {
  // the car spins and reverses direction without net travel for a while
  const lap = drive(30);
  for (let i = 50; i < 54; i++) {
    lap.trace[i] = { ...lap.trace[i - 1], x: lap.trace[i - 1].x + (i % 2 ? 1.5 : -1.5) };
  }
  // the drift ate its travel: the car rolls on to the line afterwards
  for (let i = 54; i < lap.trace.length - 1; i++) {
    lap.trace[i].t += 600;
  }
  lap.trace[lap.trace.length - 1].t += 600;
  const v = validateLap('coast', lap.ms, lap.trace);
  assert.equal(v.ok, true, v.reason);
});

test('a doctored (shortened) clock fails', () => {
  const lap = drive(30);
  const forced = Math.round(lap.ms * 0.4);
  const v = validateLap('coast', forced, lap.trace);
  assert.equal(v.ok, false);
  // the trace clock outruns the submitted time
  assert.ok(/malformed|clock|impossible|line/.test(v.reason), v.reason);
  // edit the whole clock: trace and submitted time shrink together
  for (const p of lap.trace) p.t = Math.round(p.t * 0.4);
  const w = validateLap('coast', forced, lap.trace);
  assert.equal(w.ok, false);
  assert.equal(w.reason, 'impossible speed');
});

test('a frozen clock fails', () => {
  const lap = drive(30);
  for (const p of lap.trace) p.t = Math.round(p.t / 2);
  const v = validateLap('coast', lap.ms, lap.trace);
  assert.equal(v.ok, false);
  assert.ok(/clock|impossible/.test(v.reason), v.reason);
});

test('a start/stop jitter trace fails', () => {
  // stop, hop, stop, hop, stop, hop: three 0.6 s stands on a full lap
  // a stop is at least two samples held at one spot, then a step
  const lap = drive(30);
  const stops = [26, 38, 50];
  for (const from of stops) {
    const q = lap.trace[from - 1];
    for (let k = from; k < from + 3; k++) {
      lap.trace[k] = { x: q.x, z: q.z, t: lap.trace[k].t };
    }
  }
  const v = validateLap('coast', lap.ms, lap.trace);
  // a stop is held samples; either the stall check or the speed cap catches
  // the hop that makes up the lost ground
  assert.equal(v.ok, false, 'jitter accepted');
  assert.ok(/stalls|impossible/.test(v.reason), v.reason);
});

test('unknown event marks are rejected', () => {
  const lap = drive(30);
  lap.trace[5] = { ...lap.trace[5], e: 'warp' };
  const v = validateLap('coast', lap.ms, lap.trace);
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'unknown trace event');
});

test('laps on circuits without trace data are refused', () => {
  for (const c of trackList()) {
    if (c.id === 'coast') continue;
    assert.equal(validateLap(c.id, clean.ms, clean.trace).ok, false);
  }
});

test('rules keep the derived numbers honest', () => {
  assert.equal(RULES.MAX_SPEED, 72); // 32 hard clamp × 1.5 power × 1.5 headroom
  assert.equal(RULES.BLINK_MAX, 22);
  assert.equal(RULES.WORMHOLE_COOLDOWN, 9);
  assert.ok(!('BLINK_ANGLE' in RULES), 'aimed placements have no direction rule');
});

/* Submissions captured from real validator runs, replayed byte-for-byte. These
   fixtures carry no RULES constants, so a rule change that flips a verdict fails
   here instead of quietly agreeing with itself. */
test('captured submissions replay to their recorded verdict', () => {
  const dir = path.join(here, 'fixtures/rejections');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  assert.ok(files.length >= 4, `fixture set present (${files.length})`);
  assert.ok(files.includes('clean-lap.json'), 'the set keeps a lap that is accepted');
  for (const file of files) {
    const fx = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    assert.deepEqual(validateLap(fx.mapId, fx.ms, fx.trace), fx.verdict, file);
  }
});
