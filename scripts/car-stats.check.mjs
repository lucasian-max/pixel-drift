#!/usr/bin/env node
// Guards the per-car tuning in src/carStats.ts against quiet drift:
//   - the three cars must actually differ in the ways the garage promises
//   - no car may outrun the anti-cheat's derived speed cap
// Fails CI. Run by `npm test`.
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../src/carStats.ts', import.meta.url), 'utf8');
const rows = [...src.matchAll(/\{\s*top:\s*([\d.]+),\s*accel:\s*([\d.]+),\s*grip:\s*([\d.]+),\s*steer:\s*([\d.]+),\s*power:\s*([\d.]+)\s*\}/g)]
  .map((m) => ({ top: +m[1], accel: +m[2], grip: +m[3], steer: +m[4], power: +m[5] }));

const fail = (msg) => { console.error(`car-stats: ${msg}`); process.exit(1); };
const names = ['PEARL GT', 'GROUP B', 'DUNE RUNNER'];
const [pearl, groupB, dune] = rows;

if (rows.length !== 3) fail(`expected 3 tuning rows, parsed ${rows.length}`);

// the garage promises: Pearl = grip/steer, Group B = speed/launch, Dune = slowest.
if (!(groupB.top > pearl.top && pearl.top > dune.top)) fail(`top speeds must run GROUP B > PEARL GT > DUNE RUNNER, got ${rows.map((r) => r.top)}`);
if (!(groupB.accel > pearl.accel && pearl.accel > dune.accel)) fail(`accel must run GROUP B > PEARL GT > DUNE RUNNER, got ${rows.map((r) => r.accel)}`);
if (!(pearl.grip > dune.grip && dune.grip > groupB.grip)) fail(`grip must run PEARL GT > DUNE RUNNER > GROUP B, got ${rows.map((r) => r.grip)}`);
if (!(pearl.steer > dune.steer && dune.steer > groupB.steer)) fail(`steer must run PEARL GT > DUNE RUNNER > GROUP B, got ${rows.map((r) => r.steer)}`);
if (!(pearl.power > groupB.power)) fail('PEARL GT must pay the longest power cooldown');

// server/anticheat.mjs rejects unmarked segments faster than 72 u/s, derived
// from 32 base x 1.5 power x 1.5 headroom. A tuned car must stay under it even
// at top speed with its fastest power and the clamp overshoot.
const CAP = 72;
for (const [i, r] of rows.entries()) {
  const worst = (r.top + 2) * 1.5;   // clamp bound x the biggest speed multiplier in ./powers
  if (worst >= CAP) fail(`${names[i]} can legally reach ${worst} u/s, at or past the anti-cheat cap ${CAP}`);
}

console.log(`car-stats: ok — ${rows.map((r, i) => `${names[i]} ${r.top} u/s`).join(', ')}, all under the ${CAP} u/s validator cap`);

// the powers carry their own 1..10 strength (garage POWER bar); the tunnel is
// the Dune Runner's whole identity, so it must stay the unique top rating
const powerSrc = fs.readFileSync(new URL('../src/powers.ts', import.meta.url), 'utf8');
const ratings = [...powerSrc.matchAll(/rating:\s*(\d+)/g)].map((m) => +m[1]);
if (ratings.length !== 3) fail(`expected 3 power ratings, parsed ${ratings.length}`);
for (const [i, r] of ratings.entries()) {
  if (!(r >= 1 && r <= 10)) fail(`${names[i]} power rating ${r} outside 1..10`);
}
const best = Math.max(...ratings);
const tied = ratings.filter((r) => r === best).length;
if (ratings[2] !== best || tied !== 1) fail(`the tunnel's power rating must be the unique top, got ${ratings}`);
console.log(`car-stats: power ratings ${ratings.join(' / ')} — tunnel is the unique top`);
