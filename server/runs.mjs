// server/runs.mjs — stores uploaded 60 Hz run exports on disk.
//
// The browser recorder exports JSONL. An authenticated player can POST that
// file (optionally gzipped) to /api/runs; it is validated just enough to be a
// real recorder export, written under server/data/runs/<user>/, and indexed in
// a JSONL manifest for the data desk and the training converter.
//
// Nothing is uploaded automatically: the admin panel has an explicit
// "UPLOAD RUNS" button, and friends can export with X or call
// game.recorder.upload() from the console.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { StoreError } from './store.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const RUNS_DIR = path.join(here, 'data', 'runs');
const MANIFEST = path.join(RUNS_DIR, 'manifest.jsonl');
const INDEX = path.join(RUNS_DIR, 'episode-ids.json');
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;     // compressed body
const MAX_JSONL_BYTES = 32 * 1024 * 1024;     // decompressed
const USER_RE = /^[a-z0-9_]{1,32}$/;

export const RUN_UPLOAD_LIMIT = MAX_UPLOAD_BYTES;

function safeUser(user) {
  return USER_RE.test(user?.username ?? '') ? user.username : 'unknown';
}

function isGzip(buf, contentType = '') {
  return /gzip/i.test(contentType) || (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b);
}

function validateJsonl(text) {
  let header = null;
  let episodes = 0;
  let steps = 0;
  const episodeIds = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      throw new StoreError(400, 'invalid_jsonl', 'upload is not valid JSONL');
    }
    if (rec.kind === 'header') {
      header = rec;
    } else if (rec.kind === 'episode') {
      episodes++;
      if (typeof rec.id === 'string' && rec.id) episodeIds.push(rec.id);
    } else if (Object.prototype.hasOwnProperty.call(rec, 'e')) {
      steps++;
    }
  }
  if (!header || typeof header !== 'object') {
    throw new StoreError(400, 'missing_header', 'run file has no header line');
  }
  if (typeof header.fps !== 'number' || header.fps <= 0) {
    throw new StoreError(400, 'missing_fps', 'run header has no fps');
  }
  if (episodes === 0) {
    throw new StoreError(400, 'no_episodes', 'run file has no episodes');
  }
  return { header, episodes, steps, episodeIds };
}

function loadEpisodeIds() {
  try {
    const ids = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
    return new Set(Array.isArray(ids) ? ids : []);
  } catch {
    return new Set();
  }
}

function saveEpisodeIds(ids) {
  const tmp = `${INDEX}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify([...ids]));
  fs.renameSync(tmp, INDEX);
}

/** Save one JSONL upload and append it to the manifest. */
export function saveRun(user, buf, contentType) {
  if (buf.length > MAX_UPLOAD_BYTES) {
    throw new StoreError(413, 'payload_too_large', `upload must be under ${MAX_UPLOAD_BYTES} bytes`);
  }
  let text;
  try {
    text = isGzip(buf, contentType)
      ? zlib.gunzipSync(buf, { maxOutputLength: MAX_JSONL_BYTES }).toString('utf8')
      : buf.toString('utf8');
  } catch (err) {
    if (err?.code === 'ERR_BUFFER_TOO_LARGE' || err?.code === 'ERR_OUT_OF_RANGE') {
      throw new StoreError(413, 'payload_too_large', 'decompressed run is too large');
    }
    throw new StoreError(400, 'invalid_gzip', 'could not decompress the upload');
  }
  const bytes = Buffer.byteLength(text);
  if (bytes > MAX_JSONL_BYTES) {
    throw new StoreError(413, 'payload_too_large', 'decompressed run is too large');
  }
  const parsed = validateJsonl(text);
  const known = loadEpisodeIds();
  if (parsed.episodeIds.length > 0 && parsed.episodeIds.every((id) => known.has(id))) {
    return {
      ok: true, skipped: true, user: safeUser(user),
      episodes: 0, bytes: 0, uploadedAt: new Date().toISOString(),
    };
  }
  const name = safeUser(user);
  const dir = path.join(RUNS_DIR, name);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const id = crypto.randomUUID();
  const file = path.join(dir, `${stamp}-${id.slice(0, 8)}.jsonl`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
  const meta = {
    id,
    user: name,
    file: path.relative(RUNS_DIR, file),
    bytes,
    episodes: parsed.episodes,
    steps: parsed.steps,
    fps: parsed.header.fps,
    schema: parsed.header.schema ?? null,
    uploadedAt: new Date().toISOString(),
  };
  fs.appendFileSync(MANIFEST, JSON.stringify(meta) + '\n');
  for (const id of parsed.episodeIds) known.add(id);
  saveEpisodeIds(known);
  return { ...meta, skipped: false };
}

function readManifest() {
  try {
    return fs.readFileSync(MANIFEST, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Totals plus the most recent uploads, for the data desk. */
export function listRuns() {
  const all = readManifest();
  const totals = { files: all.length, episodes: 0, bytes: 0 };
  const users = new Map();
  for (const r of all) {
    totals.episodes += r.episodes ?? 0;
    totals.bytes += r.bytes ?? 0;
    const u = users.get(r.user) ?? { user: r.user, files: 0, episodes: 0, bytes: 0 };
    u.files++;
    u.episodes += r.episodes ?? 0;
    u.bytes += r.bytes ?? 0;
    users.set(r.user, u);
  }
  const recent = [...all]
    .sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)))
    .slice(0, 20);
  return {
    totals,
    users: [...users.values()].sort((a, b) => b.episodes - a.episodes),
    recent,
  };
}
