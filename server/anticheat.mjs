// server/anticheat.mjs — checks a lap trace against the real circuit.
//
// The client sends the timed lap trace it already keeps for replays:
//   [{ x, z, t }, ...]   x/z metres, t milliseconds from the lap start,
// sampled at 5 Hz plus an exact final point on the line. WORMHOLE is an
// aimed placement, so its placement frame adds an event mark:
//   { x, z, t, e: 'blink' }
//
// The server owns the track centreline (server/track-data.json, generated
// from the game's own smoothed track), so a shortcut cannot invent geometry.
//
// What it rejects:
//   - missing / empty / malformed traces, unknown event marks
//   - timestamps that do not line up with the submitted lap time
//   - laps that do not start and finish at the start/finish line
//   - routes much shorter or longer than one lap
//   - teleports and impossible segment speeds
//   - points far away from the circuit (cutting across the infield)
//   - traces that never cover most of the circuit's bounding box
//   - frozen clocks (speed spikes the clock hides)
//   - start/stop jitter instead of a continuous drive
//   - marked placements that are too long or too frequent
//
// It is deliberately generous: off-road excursions, drifts, wide lines and
// figure-eight crossings all pass. It stops casual shortcuts and edits, not
// a determined forger who rewrites an entire plausible trace.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const TRACK_FILE = path.join(here, 'track-data.json');

// src/car.ts: the car accelerates up to 30 units/s on the road (18.6 on
// grass, at the 0.62 surface factor) and is hard-clamped at 32 x the speed
// multiplier. src/powers.ts: THUNDERCLAP is the fastest power at 1.5x, so the
// fastest the game can move the car is 32 x 1.5 = 48 units/s. Drift slip,
// collision shoves and the 5 Hz clock add jitter on top, hence the headroom.
const HARD_TOP = 32;         // units/s, car.ts velocity clamp
const POWER_TOP_MULT = 1.5;  // highest power speed multiplier
const SPEED_HEADROOM = 1.5;  // slip, shoves and sampling jitter
// per-segment cap: fastest legitimate rolling speed with any margin
const MAX_SPEED = HARD_TOP * POWER_TOP_MULT * SPEED_HEADROOM; // 72 units/s

const BLINK_MAX = 22;        // metres, TUNNEL placement radius (powers.ts)
const WORMHOLE_COOLDOWN = 9; // seconds between WORMHOLE placements (powers.ts)
// the client clamps a placement to BLINK_MAX and then lets collide() nudge the
// car out of any barrier it landed against; a push-out may cross the promise
// by a hair before the client walks it back onto the circle — one metre of
// documented slack absorbs that without rent-a-gap behaviour for forgers
const PUSH_SLACK = 1;
const SAME_POINT = 2;        // metres; samples this close count as "stuck"
// one sample of rolling at the fastest legitimate speed
const ROLL_LIMIT = (MAX_SPEED * 200) / 1000; // 14.4 metres

const MAX_OFF_TRACK = 14;    // metres beyond the road edge
const START_SLACK = 35;      // metres from the start/finish line
const MIN_LENGTH_RATIO = 0.85; // shortest believable lap vs centreline
const MAX_LENGTH_RATIO = 2.0;  // drifting/spinning leeway
// share of the centreline a lap may leave unpassed: a wide line or one
// placement across a corner stays under it, cutting a branch of the circuit
// (two stretches that run close together) does not. Passing a stretch means
// coming within the road plus this slack of it; an honest lap comes within a
// couple of metres, a cut leaves a fifth of the circuit untouched.
const MAX_SKIPPED_CIRCUIT = 0.10;
const PASSED_SLACK = 6;
const MAX_CLOCK_SLACK = 2500;  // ms between last trace t and submitted ms

const LAP_START_SLACK = 2000;
const STOP_SAMPLES = 3;      // held samples that make a stand a stall
const MAX_STALLS = 2;        // stands a drift or a hold may have

function bbox(points) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minZ) minZ = p[1];
    if (p[1] > maxZ) maxZ = p[1];
  }
  return { minX, maxX, minZ, maxZ, w: maxX - minX, h: maxZ - minZ };
}

/** distance from (x,z) to the nearest centreline point */
function nearestDist(track, x, z) {
  let best = Infinity;
  for (const p of track.points) {
    const dx = p[0] - x, dz = p[1] - z;
    const d = dx * dx + dz * dz;
    if (d < best) best = d;
    if (best === 0) break;
  }
  return Math.sqrt(best);
}

function prepare(raw) {
  const tracks = {};
  for (const [id, t] of Object.entries(raw)) {
    const points = t.points;
    const box = bbox(points);
    let length = 0;
    for (let i = 1; i < points.length; i++) {
      length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    }
    tracks[id] = {
      id,
      name: t.name,
      roadHalf: t.roadHalf,
      start: t.start,
      points,
      box,
      // measured from the polyline, never trusted from the data file
      length: length || t.length,
    };
  }
  return tracks;
}

let TRACKS = null;
function tracks() {
  if (!TRACKS) TRACKS = prepare(JSON.parse(fs.readFileSync(TRACK_FILE, 'utf8')));
  return TRACKS;
}

export function mapNames() {
  const out = {};
  for (const [id, t] of Object.entries(tracks())) out[id] = t.name;
  return out;
}

export function trackList() {
  return Object.values(tracks()).map((t) => ({
    id: t.id, name: t.name, roadHalf: t.roadHalf, length: t.length,
  }));
}

/** Game-truth numbers the validator enforces; also used by the tests. */
export const RULES = {
  MAX_SPEED,
  BLINK_MAX,
  WORMHOLE_COOLDOWN,
  ROLL_LIMIT,
  PUSH_SLACK,
  MAX_OFF_TRACK,
  MAX_LENGTH_RATIO,
  MIN_LENGTH_RATIO,
  MAX_SKIPPED_CIRCUIT,
};

function fail(reason) {
  return { ok: false, reason };
}

export function validateLap(mapId, ms, trace) {
  const track = tracks()[mapId];
  if (!track) return fail('unknown circuit');
  if (!Array.isArray(trace)) return fail('missing lap trace');
  if (!Number.isFinite(ms) || ms <= 0) return fail('lap clock mismatch');

  // enough samples to describe a lap (short synthetic laps get some slack)
  const minSamples = ms < 5000 ? 5 : ms < 15000 ? 10 : 16;
  if (trace.length < minSamples) return fail('lap trace too short');
  let prev = null;
  let marks = 0;
  for (const p of trace) {
    if (!p || typeof p !== 'object' || !Number.isFinite(p.x) || !Number.isFinite(p.z) || !Number.isFinite(p.t)) {
      return fail('malformed lap trace');
    }
    if (p.e !== undefined) {
      if (p.e !== 'blink') return fail('unknown trace event');
      marks++;
    }
    if (p.t < 0 || p.t > ms + 5000) return fail('malformed lap trace');
    if (prev && p.t < prev.t - 1) return fail('lap trace timestamps jump');
    prev = p;
  }

  const first = trace[0];
  const last = trace[trace.length - 1];
  if (first.t > LAP_START_SLACK) return fail('lap trace starts late');
  if (Math.abs(ms - last.t) > MAX_CLOCK_SLACK) return fail('lap clock mismatch');

  const fromLine = (q) => Math.hypot(q.x - track.start.x, q.z - track.start.z);
  if (fromLine(first) > START_SLACK || fromLine(last) > START_SLACK) {
    return fail('lap does not start and finish at the line');
  }
  // A mark is WORMHOLE's aimed placement frame: the car lands anywhere in
  // BLINK_MAX of the previous sample, any direction, then keeps rolling. The
  // frame is the whole event, so its displacement is the jump and the radius
  // is the only length it may carry; the segment that leaves the mark is
  // rolling again.
  let length = 0;      // route the car actually rolled, placements excluded
  let maxSpeed = 0;    // fastest rolling segment
  let maxOff = 0;
  let slowSegments = 0;
  let covered = 0;     // trace clock the samples span
  let still = 0;       // consecutive samples within SAME_POINT of the last
  let lastBlinkAt = -Infinity;
  const route = [];
  for (let i = 0; i < trace.length; i++) {
    const p = trace[i];
    route.push(p);
    const off = nearestDist(track, p.x, p.z);
    if (off > maxOff) maxOff = off;
    if (i === 0) continue;

    const a = trace[i - 1];
    const dx = p.x - a.x, dz = p.z - a.z;
    const d = Math.hypot(dx, dz);
    const dt = (p.t - a.t) / 1000;
    covered += dt;
    if (d < SAME_POINT && dt > 0) {
      slowSegments++;
      still++;
    } else {
      still = 0;
    }

    if (p.e === 'blink') {
      if (a.e === 'blink') return fail('blink marks doubled');
      if (a.t - lastBlinkAt < WORMHOLE_COOLDOWN * 1000) return fail('blink marks too frequent');
      lastBlinkAt = a.t;
      if (d > BLINK_MAX + PUSH_SLACK) return fail('blink jump too far');
      continue;
    }
    if (a.e === 'blink') {
      // the car landed somewhere inside the disc and kept rolling, so the span
      // from the landing point to this sample is real travel and counts: the
      // placement only ever removes the jump itself. It credits at most one
      // sample of rolling, because part of the span can be a barrier push-out.
      length += Math.min(d, ROLL_LIMIT);
      continue;
    }

    length += d;
    if (dt > 0.02) {
      const v = d / dt;
      if (v > maxSpeed) maxSpeed = v;
      // a rolling window faster than the powered top speed is a jump nobody
      // marked
      if (v > MAX_SPEED) return fail('impossible speed');
    }
  }

  if (maxOff > track.roadHalf + MAX_OFF_TRACK) return fail('off the circuit');
  // a frozen clock hides speed: if the car barely moves for most of the lap
  // but still covers the circuit, the times were edited
  if (covered < ms / 1000 * 0.5) return fail('lap clock does not advance');
  if (slowSegments > trace.length * 0.4) return fail('lap trace barely moves');
  // start/stop jitter: a held run of samples that then steps on is a stall,
  // not a drift (a drift keeps moving between samples); the step itself is
  // usually caught as a speed spike too
  still = 0;
  let stalls = 0;
  for (let k = 1; k < trace.length; k++) {
    const step = Math.hypot(trace[k].x - trace[k - 1].x, trace[k].z - trace[k - 1].z);
    if (step < SAME_POINT) {
      still++;
      continue;
    }
    if (still >= STOP_SAMPLES && k < trace.length - 1 && step > SAME_POINT * 1.5) stalls++;
    still = 0;
  }
  if (stalls > MAX_STALLS) return fail('lap trace stalls');

  // a placement removes its own length from the rolled route by design, so the
  // ratio is applied to what the car could still have rolled: each mark may
  // legally skip up to the radius, and the cooldown check above already caps
  // how many marks a lap can carry
  const skip = marks * BLINK_MAX;
  if (length < track.length * MIN_LENGTH_RATIO - skip) return fail('route too short');
  if (length > track.length * MAX_LENGTH_RATIO) return fail('route too long');

  // average sanity: the lapped route (blinks excluded) over the submitted
  // lap time cannot need more than the powered top speed; the 1.5 headroom
  // absorbs the placements' free metres so a legal blink lap never trips it
  const avgSpeed = length / (ms / 1000);
  if (avgSpeed > MAX_SPEED * 1.5) return fail('impossible speed');

  // a real lap covers most of the circuit, not just one corner
  const rb = bbox(route.map((p) => [p.x, p.z]));
  const coversW = rb.w > track.box.w * 0.55;
  const coversH = rb.h > track.box.h * 0.55;
  if (!coversW || !coversH) return fail('incomplete circuit');

  // ...and it passes every stretch of it. A circuit that runs close to itself
  // can be cut between two of its branches while every sample still sits near
  // some part of the road, so distance-to-track never sees the cut and only the
  // route-length floor notices it. Counting the centreline points the lap never
  // came near sees the cut for what it is, whichever way it was crossed: driven
  // across the grass or placed across with a mark.
  const corridor = track.roadHalf + PASSED_SLACK;
  const reach = corridor * corridor;
  let passed = 0;
  let counted = 0;
  for (let i = 0; i < track.points.length; i += 2) {
    const c = track.points[i];
    counted++;
    for (const p of route) {
      const dx = p.x - c[0], dz = p.z - c[1];
      if (dx * dx + dz * dz <= reach) { passed++; break; }
    }
  }
  if (passed < counted * (1 - MAX_SKIPPED_CIRCUIT)) return fail('incomplete circuit');

  return {
    ok: true,
    summary: {
      pathLength: Math.round(length * 10) / 10,
      avgSpeed: Math.round(avgSpeed * 100) / 100,
      maxSpeed: Math.round(maxSpeed * 100) / 100,
      maxOffTrack: Math.round(maxOff * 100) / 100,
      samples: trace.length,
      blinks: marks,
    },
  };
}
