// server/botguard.test.mjs — the input proof: what counts as a bot, what does
// not, and what a malformed proof is allowed to decide (nothing).
//
// The real case these encode: account srihari2_0 recorded 35 episodes around
// the coast circuit at 30-45 u/s with every single sample at a:[0,0,0,0], and
// 12 of its last 50 laps came in at exactly 9183ms. A clean human lap of the
// same circuit steers 270-350 times.
import test from 'node:test';
import assert from 'node:assert/strict';

import { BOTGUARD, checkProof, readProof } from './botguard.mjs';
import { auditPlayers, scanJsonlText } from './scripts/audit-bots.mjs';

/* ------------------------------------------------------------------ proofs */

test('a zero-input proof on a real lap is a bot', () => {
  const proof = readProof({ samples: 557, steer: 0, throttle: 0 });
  assert.deepEqual(proof, { samples: 557, steer: 0, throttle: 0 });
  const verdict = checkProof(proof, 9283);
  assert.equal(verdict.state, 'bot');
  assert.equal(verdict.reason, 'no steering input');
});

test('a zero-steer proof is a bot even when the throttle was held', () => {
  const verdict = checkProof({ samples: 600, steer: 0, throttle: 590 }, 11912);
  assert.equal(verdict.state, 'bot');
  assert.equal(verdict.reason, 'no steering input');
});

test('zero input of any kind is a bot on a long episode', () => {
  // under the lap-time rule, so the second rule is what has to catch it
  const verdict = checkProof({ samples: 300, steer: 0, throttle: 0 }, 3800);
  assert.equal(verdict.state, 'bot');
  assert.equal(verdict.reason, 'no input at all');
});

test('a human proof is accepted', () => {
  const verdict = checkProof({ samples: 620, steer: 312, throttle: 604 }, 11912);
  assert.equal(verdict.state, 'human');
});

test('a human proof that lifted and coasted a little is accepted', () => {
  const verdict = checkProof({ samples: 620, steer: 61, throttle: 480 }, 11912);
  assert.equal(verdict.state, 'human');
});

test('a short lap is not judged by the steering rule', () => {
  // an off-the-line blast can be 3 s without touching the wheel
  const verdict = checkProof({ samples: 180, steer: 0, throttle: 175 }, BOTGUARD.MIN_LAP_MS);
  assert.equal(verdict.state, 'human');
});

test('a missing proof is unknown, never a rejection', () => {
  assert.equal(readProof(undefined), null);
  assert.equal(readProof(null), null);
  assert.equal(readProof({}), null);
  assert.equal(checkProof(null, 11912).state, 'unknown');
  assert.equal(checkProof(readProof(undefined), 11912).state, 'unknown');
});

test('a malformed proof cannot fake a human or a bot', () => {
  const bad = [
    { samples: 500 },                                        // partial
    { samples: '500', steer: 0, throttle: 0 },               // strings
    { samples: 500.5, steer: 250, throttle: 400 },           // floats
    { samples: 500, steer: -1, throttle: 400 },              // negative
    { samples: 500, steer: 501, throttle: 400 },             // more steers than samples
    { samples: 0, steer: 0, throttle: 0 },                   // empty
    { samples: 500, steer: 0, throttle: 900 },               // impossible throttle
    [500, 0, 0],                                             // wrong shape
    'zero',
  ];
  for (const raw of bad) {
    assert.equal(readProof(raw), null, JSON.stringify(raw));
    assert.equal(checkProof(readProof(raw), 11912).state, 'unknown', JSON.stringify(raw));
  }
});

/* ------------------------------------------------------------ the audit */

const HEADER = JSON.stringify({ kind: 'header', schema: 'pixel-drift/runs@1', fps: 60 });
const TRACK = JSON.stringify({ kind: 'track', id: 'coast', name: 'Saltmarsh Coast', roadHalf: 4.4 });

/** One episode line plus `samples` step lines, in the recorder's format. */
function episodeLines({ index, player, lapMs, samples, steer, throttle, speed = 32, createdAt }) {
  const out = [JSON.stringify({
    kind: 'episode', id: `ep-${player}-${index}`, index, map: 'coast', car: 'GROUP B', variant: 1,
    power: 'THUNDERCLAP', driver: 'human', player, input: 'keyboard', launch: false,
    createdAt, lapMs, samples, complete: true, partial: false, stats: null, events: [],
  })];
  for (let s = 0; s < samples; s++) {
    const o = [0, 0, 0, 0, 0, speed, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0];
    out.push(JSON.stringify({ e: index, s, o, a: [throttle ? 1 : 0, steer ? 1 : 0, 0, 0] }));
  }
  return out;
}

function runFile(specs) {
  const lines = [HEADER, TRACK];
  for (const spec of specs) lines.push(...episodeLines(spec));
  return lines.join('\n') + '\n';
}

test('the audit flags a zero-input script and clears a human', () => {
  const botLaps = [9283, 9750, 9183, 9183, 9150, 9200, 8950, 9300, 9183, 9383];
  const bot = runFile(botLaps.map((lapMs, i) => ({
    index: i, player: 'srihari2_0', lapMs, samples: 557, steer: 0, throttle: 0, speed: 38,
    createdAt: `2026-11-27T02:58:${String(i).padStart(2, '0')}.000Z`,
  })));
  const humanLaps = [15566, 14233, 14566, 14020, 14888, 15111, 14760, 14400, 14990, 15320];
  const human = runFile(humanLaps.map((lapMs, i) => ({
    index: i, player: 'srihari', lapMs, samples: 1002, steer: 300, throttle: 980, speed: 24,
    createdAt: `2026-11-25T23:30:${String(i).padStart(2, '0')}.000Z`,
  })));

  const report = auditPlayers([...scanJsonlText(bot, { file: 'bot.jsonl' }), ...scanJsonlText(human, { file: 'human.jsonl' })]);
  const byName = new Map(report.map((p) => [p.player, p]));
  assert.equal(byName.get('srihari2_0').suspect, true);
  assert.equal(byName.get('srihari2_0').suspectEpisodes, 10);
  assert.equal(byName.get('srihari').suspect, false);
  assert.equal(byName.get('srihari').suspectEpisodes, 0);
});

test('the audit needs more than one repeated lap time', () => {
  const laps = [15566, 14233, 15566, 14020, 14888];
  const file = runFile(laps.map((lapMs, i) => ({
    index: i, player: 'djbravo', lapMs, samples: 900, steer: 280, throttle: 860, speed: 22,
    createdAt: `2026-11-25T23:30:0${i}.000Z`,
  })));
  const [report] = auditPlayers(scanJsonlText(file, { file: 'laps.jsonl' }), { repeatMin: 3 });
  assert.equal(report.repeatMax, 2);
  assert.equal(report.suspect, false);
});

test('a partial episode with no input is not a lap and not a signal', () => {
  // a crash, a reset, or the menu: the car coasts with no keys and the episode
  // never finished. Two of djbravo's 94 real uploads look exactly like this.
  const lines = [HEADER, TRACK, JSON.stringify({
    kind: 'episode', id: 'partial', index: 0, map: 'alpine', car: 'PEARL GT', variant: 0,
    power: 'PEARL DRIFT', driver: 'human', player: 'djbravo', input: 'keyboard', launch: false,
    createdAt: '2026-11-27T03:18:18.812Z', lapMs: 0, samples: 92, complete: false,
    partial: true, stats: null, events: [],
  })];
  for (let s = 0; s < 92; s++) {
    const o = [0, 0, 0, 0, 0, 18, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0];
    lines.push(JSON.stringify({ e: 0, s, o, a: [0, 0, 0, 0] }));
  }
  const [report] = auditPlayers(scanJsonlText(lines.join('\n') + '\n', { file: 'partial.jsonl' }));
  assert.equal(report.suspectEpisodes, 0);
  assert.equal(report.suspect, false);
});

test('the audit attributes episodes by their player field, not the folder', () => {
  const file = runFile([{
    index: 0, player: 'srihari', lapMs: 14566, samples: 900, steer: 280, throttle: 860,
    createdAt: '2026-11-25T23:30:00.000Z',
  }]);
  const [report] = auditPlayers(scanJsonlText(file, { file: 'x.jsonl', userHint: 'srihari2_0' }));
  assert.equal(report.player, 'srihari');
});
