#!/usr/bin/env node
// Paste two hill-shots renders into one composite: top row = A (side | iso), bottom row = B (side | iso).
//   node tools/hill-compare.mjs <aPrefix> <bPrefix> <outPng> [labelA] [labelB]
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const [a, b, out, la = a, lb = b] = process.argv.slice(2);
if (!out) throw new Error('usage: node tools/hill-compare.mjs <a> <b> <out.png> [labelA] [labelB]');
const dir = 'shots/hill';
const f = (p, v) => path.join(dir, `${p}-${v}.png`);

const run = (args) => {
  const r = spawnSync('magick', args, { stdio: 'pipe' });
  if (r.status !== 0) { process.stderr.write(String(r.stderr)); process.exit(r.status ?? 1); }
};

const row = (p) => {
  run([f(p, 'side'), '-crop', '1280x470+0+130', '+repage',
    f(p, 'iso'), '-crop', '1280x470+0+130', '+repage',
    '+append', '-resize', '50%', `${dir}/_${p}.png`]);
  return `${dir}/_${p}.png`;
};

const ra = row(a), rb = row(b);
run([ra, rb, '-append', out]);
const h = Number(String(spawnSync('magick', ['identify', '-format', '%h', out]).stdout));
run([out,
  '-background', '#1b1b1b', '-gravity', 'NorthWest', '-splice', '0x22',
  '-pointsize', '18', '-fill', '#ffd76a',
  '-annotate', '+6+4', `A  ${la}`,
  '-annotate', '+646+4', 'A  iso',
  '-annotate', `+6+${h / 2 + 26}`, `B  ${lb}`,
  '-annotate', `+646+${h / 2 + 26}`, 'B  iso',
  out]);
console.log(out, `${1280}x${h + 22}`);
