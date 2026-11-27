// server/botguard.mjs — the input half of lap validation.
//
// validateLap (server/anticheat.mjs) reads the line a lap drove: shortcuts,
// teleports, backwards placement. It cannot see the controller, so a script
// that follows a clean racing line while never pressing a key passes it. The
// recorder sends a lap's input activity with the lap (src/recorder.ts
// LapProof: samples / steer / throttle), and this module decides whether that
// activity is plausible for a human who drove the time.
//
// Dependency-free on purpose: the API is node:http only.
//
// The flag is read by the caller (server/api.mjs): off means observation only,
// on means a 422. Nothing here looks at the store.

/** Thresholds. A lap shorter than MIN_LAP_MS is too short for the "no steering"
 *  rule to mean anything (a straight-line blast off a start line), and a
 *  handful of samples cannot establish a pattern either way. */
export const BOTGUARD = {
  MIN_LAP_MS: 4000,
  MIN_SAMPLES: 50,
};

const isCount = (v) => Number.isInteger(v) && v >= 0;

/** Read a submitted proof from a request body.
 *
 *  Returns {samples, steer, throttle} or null for "unknown" — absent, the
 *  wrong shape, a count larger than the sample count, or a float. A malformed
 *  field must never decide a verdict: it may not fake a human proof and it may
 *  not fake a rejection either. */
export function readProof(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const samples = raw.samples;
  const steer = raw.steer;
  const throttle = raw.throttle;
  if (!isCount(samples) || !isCount(steer) || !isCount(throttle)) return null;
  if (samples === 0) return null;
  if (steer > samples || throttle > samples) return null;
  return { samples, steer, throttle };
}

/** Judge a proof against the lap it came with.
 *
 *  'bot'     — the evidence is there and it is impossible for a human lap:
 *              no steering at all on a lap long enough to need some, or no
 *              input of any kind over a whole lap.
 *  'human'   — the proof shows input that a driver made.
 *  'unknown' — no usable proof (missing or malformed).
 *
 *  Unknown is not a pass: callers decide what to do with it, and the API
 *  accepts it because a client tab opened before this shipped cannot send
 *  anything else.
 */
export function checkProof(proof, ms) {
  if (!proof) return { state: 'unknown' };
  if (proof.steer === 0 && ms > BOTGUARD.MIN_LAP_MS) {
    return { state: 'bot', reason: 'no steering input', proof };
  }
  if (proof.steer + proof.throttle === 0 && proof.samples > BOTGUARD.MIN_SAMPLES) {
    return { state: 'bot', reason: 'no input at all', proof };
  }
  return { state: 'human', proof };
}
