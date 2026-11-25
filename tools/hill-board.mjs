#!/usr/bin/env node
// Paste three 1280x720 renders into one board with a caption strip.
//   node tools/hill-board.mjs <outPng> <label> <prefix:view> <prefix:view> ...
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const [out, label, ...specs] = process.argv.slice(2);
if (!out || !label || !specs.length) throw new Error('usage: node tools/hill-board.mjs <out.png> <label> <prefix:view> ...');
const dir = 'shots/hill';
// magick inherits LD_LIBRARY_PATH from the agent runtime, whose libstdc++ lacks
// GLIBCXX_3.4.30 and kills ImageMagick before it draws anything. Drop it.
const ENV = { ...process.env };
delete ENV.LD_LIBRARY_PATH;
const run = (args) => {
  const r = spawnSync('magick', args, { stdio: 'pipe', env: ENV });
  if (r.status !== 0) { process.stderr.write(String(r.stderr)); process.exit(r.status ?? 1); }
};
const parts = specs.map((s) => {
  const [p, v] = s.split(':');
  const o = `${dir}/_b-${p}-${v}.png`;
  run([path.join(dir, `${p}-${v}.png`), '-resize', '50%', '-crop', '640x300+0+75', '+repage', o]);
  return o;
});
const strip = `${dir}/_b-strip.png`;
run([...parts, '+append', strip]);
const w = Number(String(spawnSync('magick', ['identify', '-format', '%w', strip], { env: ENV }).stdout));
run([strip, '-background', '#1b1b1b', '-gravity', 'NorthWest', '-splice', '0x22',
  '-pointsize', '18', '-fill', '#ffd76a', '-annotate', '+6+4', label, out]);
console.log(out, `${w}px`);
