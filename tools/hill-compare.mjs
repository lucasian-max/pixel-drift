#!/usr/bin/env node
// Paste two hill-shots renders into one composite: top row = A (viewA | viewB), bottom row = B (same pair).
//   node tools/hill-compare.mjs <aPrefix> <bPrefix> <outPng> [labelA] [labelB] [viewA] [viewB]
// Views default to "side rearq"; crops keep only the horizontal band the car occupies
// so the whole comparison fits in one picture.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const [a, b, out, la = a, lb = b, va = 'side', vb = 'rearq'] = process.argv.slice(2);
if (!out) throw new Error('usage: node tools/hill-compare.mjs <a> <b> <out.png> [labelA] [labelB] [viewA] [viewB]');
const dir = 'shots/hill';
const f = (p, v) => path.join(dir, `${p}-${v}.png`);

// an inherited LD_LIBRARY_PATH can point at an older bundled libstdc++ (no
// GLIBCXX_3.4.30), which kills ImageMagick before it draws anything. Drop it.
const ENV = { ...process.env };
delete ENV.LD_LIBRARY_PATH;

const run = (args) => {
  const r = spawnSync('magick', args, { stdio: 'pipe', env: ENV });
  if (r.status !== 0) { process.stderr.write(String(r.stderr)); process.exit(r.status ?? 1); }
};

// half-scale each render, crop to the car band, paste side by side
const half = (file, v) => {
  const o = `${dir}/_${path.basename(file).replace(/\.png$/, '')}-${v}.png`;
  run([file, '-resize', '50%', '-crop', '640x300+0+75', '+repage', o]);
  return o;
};

const row = (p) => {
  const o = `${dir}/_${p}.png`;
  run([half(f(p, va), va), half(f(p, vb), vb), '+append', o]);
  return o;
};

const ra = row(a), rb = row(b);
run([ra, rb, '-append', out]);
const h = Number(String(spawnSync('magick', ['identify', '-format', '%h', out], { env: ENV }).stdout));
run([out,
  '-background', '#1b1b1b', '-gravity', 'NorthWest', '-splice', '0x22',
  '-pointsize', '18', '-fill', '#ffd76a',
  '-annotate', '+6+4', `A  ${la}`,
  '-annotate', '+646+4', `A  ${vb}`,
  '-annotate', `+6+${h / 2 + 26}`, `B  ${lb}`,
  '-annotate', `+646+${h / 2 + 26}`, `B  ${vb}`,
  out]);
console.log(out, `${1280}x${h + 22}`);
