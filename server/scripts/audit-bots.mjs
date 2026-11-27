#!/usr/bin/env node
// server/scripts/audit-bots.mjs — find scripts in the stored run exports.
//
// A lap can be geometrically perfect and still not be driving: the anticheat
// reads the line, not the hands. This scans the recorder's 60 Hz episodes
// (server/data/runs/<user>/*.jsonl, or the private HF dataset once the sync
// cron has pruned them) and reports two independent signals:
//
//   1. input-less laps — >90% of the samples have zero throttle AND zero
//      steer while the car is moving above 5 u/s. Nobody coasts a circuit at
//      racing speed with the keys untouched. Only laps that finished count:
//      a partial episode is a reset or a menu, and a car left rolling after a
//      crash with no input on it is a human thing to do.
//   2. repeated lap times — the same exact millisecond value showing up
//      again and again in a player's recent laps. A human lap clock is noisy;
//      a script replaying a fixed line is not.
//
// Usage:
//   node server/scripts/audit-bots.mjs <dir> [<dir> ...]
//   node server/scripts/audit-bots.mjs --hf [--user srihari2_0] [--limit 40]
//
// Dirs may be a runs root (subdirectory per player), a player directory, or a
// raw/ checkout of the dataset. Files are attributed by the episode's player
// field, falling back to the file's parent directory.
//
// Options:
//   --hf              download the files named in the manifest (token required)
//   --user NAME       only this player (in --hf mode, only their files)
//   --limit N         cap how many files per player --hf fetches
//   --cache DIR       where --hf keeps downloads (default: <tmp>/pixel-drift-runs)
//   --manifest FILE   manifest to read in --hf mode
//   --repo NAME       dataset repo in --hf mode (default lucasian-max/pixel-drift-runs)
//   --repeat-min N    exact repeats in recent laps that count as a signal (3)
//   --recent N        how many recent laps the repeat signal looks at (50)
//   --json            print the report as JSON
//
// Exit codes: 0 nothing found, 1 suspects found, 2 the scan could not run.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const DATA = path.join(ROOT, 'server', 'data');
const DEFAULT_MANIFEST = path.join(DATA, 'runs', 'manifest.jsonl');
const DEFAULT_REPO = 'lucasian-max/pixel-drift-runs';

/** Moving, as far as "the car is driving itself" is concerned. */
const IDLE_SPEED = 5;
/** Share of a lap's samples that may carry no input and still look human. */
const IDLE_FRACTION = 0.9;
/** Below this many samples an episode is a fragment, not a lap. */
const MIN_EPISODE_SAMPLES = 50;

const OBS_SPEED = 5; // o[5]
const ACT_THROTTLE = 0; // a[0]
const ACT_STEER = 1; // a[1]

/** Accumulate one file's episodes line by line. Header and track lines carry
 *  no driving; episode lines open a record; step lines feed it. */
function makeScanner(file, userHint) {
  const episodes = [];
  const open = new Map();
  const push = (line) => {
    if (!line.trim()) return;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      return; // a truncated last line is not a reason to lose the file
    }
    if (rec.kind === 'episode') {
      const ep = {
        file,
        player: typeof rec.player === 'string' && rec.player ? rec.player : userHint,
        id: rec.id ?? null,
        map: rec.map ?? null,
        lapMs: Number.isFinite(rec.lapMs) ? rec.lapMs : null,
        createdAt: typeof rec.createdAt === 'string' ? rec.createdAt : null,
        complete: rec.complete !== false,
        samples: 0,
        moving: 0,
        idleMoving: 0,
        steer: 0,
        throttle: 0,
      };
      open.set(rec.index ?? episodes.length, ep);
      episodes.push(ep);
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(rec, 'e')) return;
    const ep = open.get(rec.e);
    if (!ep || !Array.isArray(rec.o) || !Array.isArray(rec.a)) return;
    ep.samples++;
    const speed = Math.abs(rec.o[OBS_SPEED] ?? 0);
    const moving = speed > IDLE_SPEED;
    if (moving) ep.moving++;
    const throttle = rec.a[ACT_THROTTLE] ?? 0;
    const steer = rec.a[ACT_STEER] ?? 0;
    if (throttle === 0 && steer === 0 && moving) ep.idleMoving++;
    if (steer !== 0) ep.steer++;
    if (throttle > 0) ep.throttle++;
  };
  return { episodes, push };
}

/** Scan a whole JSONL text, for tests and small fixtures. */
export function scanJsonlText(text, { file = '<memory>', userHint = null } = {}) {
  const scanner = makeScanner(file, userHint);
  for (const line of text.split('\n')) scanner.push(line);
  return scanner.episodes;
}

/** Scan one JSONL file off disk, a line at a time. */
export async function scanFile(file, userHint = null) {
  const scanner = makeScanner(file, userHint);
  const rl = readline.createInterface({
    input: fs.createReadStream(file, 'utf8'),
    crlfDelay: Infinity,
  });
  for await (const line of rl) scanner.push(line);
  return scanner.episodes;
}

/** Group episode records into one verdict per player. */
export function auditPlayers(episodes, opts = {}) {
  const repeatMin = opts.repeatMin ?? 3;
  const recent = opts.recent ?? 50;
  const players = new Map();

  for (const ep of episodes) {
    const name = ep.player ?? 'unknown';
    let p = players.get(name);
    if (!p) {
      p = {
        player: name,
        files: new Set(),
        episodes: [],
        samples: 0,
        suspectEpisodes: [],
        maxIdleFrac: 0,
        lapsJudged: 0,
        lapTimes: [],
        repeatMax: 0,
        repeatValue: null,
        reasons: [],
      };
      players.set(name, p);
    }
    p.files.add(ep.file);
    p.episodes.push(ep);
    p.samples += ep.samples;
    if (ep.lapMs) p.lapTimes.push({ ms: ep.lapMs, createdAt: ep.createdAt ?? '' });
    // Only a lap that finished counts as evidence. A partial episode is a run
    // that ended in a reset or a menu, and a car left coasting with no input
    // after a crash is a human thing to do — two of djbravo's 94 were exactly
    // that. The signal is about laps that reached the board.
    if (!ep.complete || !ep.lapMs || ep.samples < MIN_EPISODE_SAMPLES) continue;
    p.lapsJudged++;
    const idleFrac = ep.samples ? ep.idleMoving / ep.samples : 0;
    if (idleFrac > p.maxIdleFrac) p.maxIdleFrac = idleFrac;
    if (idleFrac > IDLE_FRACTION) {
      p.suspectEpisodes.push({
        file: ep.file,
        id: ep.id,
        map: ep.map,
        lapMs: ep.lapMs,
        samples: ep.samples,
        idleMoving: ep.idleMoving,
        idleFrac: +idleFrac.toFixed(3),
      });
    }
  }

  const report = [];
  for (const p of players.values()) {
    // the most recent laps, in the order they were driven
    const laps = p.lapTimes
      .slice()
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      .slice(-recent)
      .map((l) => l.ms);
    const counts = new Map();
    for (const ms of laps) counts.set(ms, (counts.get(ms) ?? 0) + 1);
    for (const [ms, count] of counts) {
      if (count > p.repeatMax || (count === p.repeatMax && p.repeatValue !== null && ms < p.repeatValue)) {
        p.repeatMax = count;
        p.repeatValue = ms;
      }
    }

    if (p.suspectEpisodes.length > 0) {
      const worst = p.suspectEpisodes.reduce((a, b) => (b.idleFrac > a.idleFrac ? b : a));
      p.reasons.push(
        `${p.suspectEpisodes.length}/${p.lapsJudged} completed laps are >${Math.round(IDLE_FRACTION * 100)}% ` +
        `zero-input while moving (worst ${(worst.idleFrac * 100).toFixed(1)}% of ${worst.samples} samples, ` +
        `${worst.lapMs}ms on ${worst.map ?? '?'})`,
      );
    }
    if (p.repeatMax >= repeatMin) {
      p.reasons.push(
        `lap time ${p.repeatValue}ms appears ${p.repeatMax} times in the last ${laps.length} laps`,
      );
    }
    report.push({
      player: p.player,
      files: p.files.size,
      episodes: p.episodes.length,
      samples: p.samples,
      lapsJudged: p.lapsJudged,
      suspectEpisodes: p.suspectEpisodes.length,
      maxIdleFrac: +p.maxIdleFrac.toFixed(3),
      laps: laps.length,
      repeatMax: p.repeatMax,
      repeatValue: p.repeatValue,
      suspect: p.reasons.length > 0,
      reasons: p.reasons,
      examples: p.suspectEpisodes.slice(0, 3),
    });
  }
  report.sort((a, b) => Number(b.suspect) - Number(a.suspect) || b.suspectEpisodes - a.suspectEpisodes ||
    a.player.localeCompare(b.player));
  return report;
}

/* ---------------------------------------------------------------- sources */

/** Every .jsonl under a directory tree, one level of nesting deep enough for
 *  both layouts: runs/<user>/*.jsonl and raw/<user>/*.jsonl. */
function collectLocal(root) {
  const out = [];
  const walk = (dir, depth, hint) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < 3) walk(full, depth + 1, entry.name);
      } else if (entry.name.endsWith('.jsonl') && entry.name !== 'manifest.jsonl') {
        out.push({ file: full, userHint: hint });
      }
    }
  };
  walk(root, 0, path.basename(path.resolve(root)));
  return out;
}

function readSetting(env, file) {
  const fromEnv = process.env[env];
  if (fromEnv) return fromEnv.trim();
  try {
    return fs.readFileSync(file, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

function readManifest(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`cannot read manifest ${file}: ${err.message}`);
  }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      if (rec && typeof rec.file === 'string') out.push(rec);
    } catch {
      /* skip a torn line */
    }
  }
  return out;
}

/** Download the manifest's files from the private dataset into a cache dir.
 *  The token comes from HF_TOKEN or server/data/hf-token and is never printed. */
async function fetchFromHf(opts) {
  const token = readSetting('HF_TOKEN', path.join(DATA, 'hf-token'));
  if (!token) throw new Error('no Hugging Face token: set HF_TOKEN or write server/data/hf-token');
  const repo = opts.repo ?? readSetting('HF_DATASET', path.join(DATA, 'hf-dataset')) ?? DEFAULT_REPO;
  const manifest = readManifest(opts.manifest ?? DEFAULT_MANIFEST);
  const wanted = manifest.filter((rec) => !opts.user || rec.user === opts.user);
  if (wanted.length === 0) throw new Error(`no manifest entries${opts.user ? ` for ${opts.user}` : ''}`);

  const perUser = new Map();
  const files = [];
  for (const rec of wanted) {
    const seen = (perUser.get(rec.user) ?? 0) + 1;
    perUser.set(rec.user, seen);
    if (opts.limit && seen > opts.limit) continue;
    files.push(rec);
  }

  const cache = opts.cache ?? path.join(os.tmpdir(), 'pixel-drift-runs');
  const local = [];
  let fetched = 0;
  let cached = 0;
  for (const rec of files) {
    const target = path.join(cache, rec.file);
    if (fs.existsSync(target) && fs.statSync(target).size > 0) {
      cached++;
      local.push({ file: target, userHint: rec.user });
      continue;
    }
    const url = `https://huggingface.co/datasets/${repo}/resolve/main/raw/${rec.file
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      throw new Error(`download failed for ${rec.file}: HTTP ${res.status}`);
    }
    const text = await res.text();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
    fetched++;
    local.push({ file: target, userHint: rec.user });
  }
  console.error(`[audit] ${repo}: ${fetched} downloaded, ${cached} already cached, ${local.length} files`);
  return local;
}

/* ------------------------------------------------------------------- main */

function printReport(report) {
  const header = ['player', 'files', 'episodes', 'suspect', 'idle%', 'laps', 'repeat'];
  const rows = report.map((p) => [
    p.player,
    String(p.files),
    String(p.episodes),
    String(p.suspectEpisodes),
    `${(p.maxIdleFrac * 100).toFixed(1)}%`,
    String(p.laps),
    p.repeatMax > 1 ? `${p.repeatMax}x${p.repeatValue}` : '-',
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
  console.log(line(header));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) console.log(line(row));
  const suspects = report.filter((p) => p.suspect);
  if (suspects.length === 0) {
    console.log('\nno suspect players');
    return;
  }
  console.log(`\n${suspects.length} suspect player${suspects.length === 1 ? '' : 's'}:`);
  for (const p of suspects) {
    console.log(`\n  ${p.player}`);
    for (const reason of p.reasons) console.log(`    - ${reason}`);
    for (const ex of p.examples) {
      console.log(`    · ${ex.id ?? '?'} ${ex.map ?? '?'} ${ex.lapMs ?? '?'}ms ` +
        `${ex.idleMoving}/${ex.samples} idle samples (${(ex.idleFrac * 100).toFixed(1)}%) ${ex.file}`);
    }
  }
}

async function main(argv) {
  const args = argv.slice(2);
  const opts = { dirs: [], hf: false, user: null, limit: 0, cache: null, manifest: null, repo: null, repeatMin: 3, recent: 50, json: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--hf') opts.hf = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--user') opts.user = args[++i];
    else if (a === '--limit') opts.limit = Number(args[++i]) || 0;
    else if (a === '--cache') opts.cache = path.resolve(args[++i]);
    else if (a === '--manifest') opts.manifest = path.resolve(args[++i]);
    else if (a === '--repo') opts.repo = args[++i];
    else if (a === '--repeat-min') opts.repeatMin = Number(args[++i]) || 3;
    else if (a === '--recent') opts.recent = Number(args[++i]) || 50;
    else if (a === '-h' || a === '--help') {
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n')
        .filter((l) => l.startsWith('//') || l.startsWith('#!')).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
      return 0;
    } else if (a.startsWith('-')) {
      throw new Error(`unknown option ${a}`);
    } else {
      opts.dirs.push(path.resolve(a));
    }
  }

  let sources;
  if (opts.hf) {
    sources = await fetchFromHf(opts);
  } else {
    if (opts.dirs.length === 0) {
      throw new Error('give a runs directory, or --hf to read the dataset');
    }
    sources = [];
    for (const dir of opts.dirs) {
      if (!fs.existsSync(dir)) throw new Error(`no such directory: ${dir}`);
      sources.push(...collectLocal(dir));
    }
  }
  if (sources.length === 0) throw new Error('no .jsonl run files found');

  const episodes = [];
  for (const { file, userHint } of sources) {
    if (opts.user && userHint && userHint !== opts.user) continue;
    episodes.push(...await scanFile(file, userHint));
  }
  const report = auditPlayers(episodes, { repeatMin: opts.repeatMin, recent: opts.recent });
  const filtered = opts.user ? report.filter((p) => p.player === opts.user) : report;

  if (opts.json) {
    console.log(JSON.stringify({ files: sources.length, players: filtered }, null, 2));
  } else {
    printReport(filtered);
  }
  return filtered.some((p) => p.suspect) ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`[audit] ${err.message}`);
      process.exit(2);
    },
  );
}
