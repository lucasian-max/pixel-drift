// server/anticheat.mjs — checks a lap trace against the real circuit.
//
// The client sends the timed lap trace it already keeps for replays:
//   [{ x, z, t }, ...]   x/z metres, t milliseconds from the lap start,
// sampled at 5 Hz plus an exact final point on the line.
//
// The server owns the track centreline (server/track-data.json, generated
// from the game's own smoothed track), so a shortcut cannot invent geometry.
//
// What it rejects:
//   - missing / empty / malformed traces
//   - timestamps that do not line up with the submitted lap time
//   - laps that do not start and finish at the start/finish line
//   - routes much shorter or longer than one lap
//   - teleports and impossible segment speeds
//   - points far away from the circuit (cutting across the infield)
//   - traces that never cover most of the circuit's bounding box
//
// It is deliberately generous: off-road excursions, drifts, wide lines and
// figure-eight crossings all pass. It stops casual shortcuts and edits, not
// a determined forger who rewrites an entire plausible trace.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const TRACK_FILE = path.join(here, 'track-data.json');

const MAX_SPEED = 65;          // units/s; top speed with a power is ~45
const MAX_OFF_TRACK = 14;      // metres beyond the road edge
const START_SLACK = 35;        // metres from the start/finish line
const MIN_LENGTH_RATIO = 0.85; // shortest believable lap vs centreline
const MAX_LENGTH_RATIO = 2.0;  // drifting/spinning leeway
const MAX_CLOCK_SLACK = 2500;  // ms between last trace t and submitted ms

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

function nearestDist(track, x, z) {
  let best = Infinity;
  for (const p of track) {
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
    tracks[id] = {
      id,
      name: t.name,
      roadHalf: t.roadHalf,
      start: t.start,
      points,
      box,
      length: t.length,
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

function fail(reason) {
  return { ok: false, reason };
}

export function validateLap(mapId, ms, trace) {
  const track = tracks()[mapId];
  if (!track) return fail('unknown circuit');
  if (!Array.isArray(trace)) return fail('missing lap trace');

  // enough samples to describe a lap (short synthetic laps get some slack)
  const minSamples = ms < 5000 ? 5 : ms < 15000 ? 10 : 16;
  if (trace.length < minSamples) return fail('lap trace too short');

  let prev = null;
  for (const p of trace) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z) || !Number.isFinite(p.t)) {
      return fail('malformed lap trace');
    }
    if (p.t < 0 || p.t > ms + 5000) return fail('malformed lap trace');
    if (prev && p.t < prev.t - 1) return fail('lap trace timestamps jump');
    prev = p;
  }

  const first = trace[0];
  const last = trace[trace.length - 1];
  if (first.t > 2000) return fail('lap trace starts late');
  if (Math.abs(ms - last.t) > MAX_CLOCK_SLACK) return fail('lap clock mismatch');

  const fromLine = (p) => Math.hypot(p.x - track.start.x, p.z - track.start.z);
  if (fromLine(first) > START_SLACK || fromLine(last) > START_SLACK) {
    return fail('lap does not start and finish at the line');
  }

  let length = 0;
  let maxSpeed = 0;
  let maxOff = 0;
  const route = [];
  for (let i = 0; i < trace.length; i++) {
    const p = trace[i];
    route.push(p);
    const off = nearestDist(track.points, p.x, p.z);
    if (off > maxOff) maxOff = off;
    if (i > 0) {
      const a = trace[i - 1];
      const d = Math.hypot(p.x - a.x, p.z - a.z);
      length += d;
      const dt = (p.t - a.t) / 1000;
      if (dt > 0.02) {
        const v = d / dt;
        if (v > maxSpeed) maxSpeed = v;
      }
    }
  }

  if (maxOff > track.roadHalf + MAX_OFF_TRACK) return fail('off the circuit');
  if (length < track.length * MIN_LENGTH_RATIO) return fail('route too short');
  if (length > track.length * MAX_LENGTH_RATIO) return fail('route too long');
  if (maxSpeed > MAX_SPEED) return fail('impossible speed');

  const avgSpeed = length / (ms / 1000);
  if (avgSpeed > MAX_SPEED) return fail('impossible speed');

  // a real lap covers most of the circuit, not just one corner
  const rb = bbox(route.map((p) => [p.x, p.z]));
  const coversW = rb.w > track.box.w * 0.55;
  const coversH = rb.h > track.box.h * 0.55;
  if (!coversW || !coversH) return fail('incomplete circuit');

  return {
    ok: true,
    summary: {
      pathLength: Math.round(length * 10) / 10,
      avgSpeed: Math.round(avgSpeed * 100) / 100,
      maxSpeed: Math.round(maxSpeed * 100) / 100,
      maxOffTrack: Math.round(maxOff * 100) / 100,
      samples: trace.length,
    },
  };
}
