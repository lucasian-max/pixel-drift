#!/usr/bin/env node
// Enforces the comment ratchet: no tracked file may hold more comment items than
// its snapshot entry allows. Lower counts pass; new comments fail.
//
//   node scripts/comment-ratchet.mjs           check against the snapshot
//   node scripts/comment-ratchet.mjs --update  rewrite the snapshot as master
//
// Never hand-edit scripts/comment-ratchet.json upward. After a purge or a small
// cleanup that lowers counts, run --update so the ceiling follows the code down.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FILES, ROOT, countFile } from "./comment-scan.mjs";

const SNAPSHOT = join(ROOT, "scripts/comment-ratchet.json");
const perFile = {};
const detail = [];
for (const path of FILES) {
  const count = countFile(path);
  perFile[path] = count;
  detail.push(`${String(count).padStart(4)}  ${path}`);
}
const total = FILES.reduce((sum, path) => sum + perFile[path], 0);

if (process.argv.includes("--update")) {
  writeFileSync(SNAPSHOT, `${JSON.stringify({ total, perFile }, null, 2)}\n`);
  console.log(`comment-ratchet: snapshot updated, ${total} comment items`);
  process.exit(0);
}

if (!existsSync(SNAPSHOT)) {
  console.error("comment-ratchet: no snapshot; run with --update");
  process.exit(1);
}

const previous = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
let failed = false;
for (const path of FILES) {
  const allowed = previous.perFile[path] ?? 0;
  if (perFile[path] > allowed) {
    console.error(`${path}: ${perFile[path]} comment items, snapshot allows ${allowed}`);
    failed = true;
  }
}
if (total > previous.total) {
  console.error(`total: ${total} comment items, snapshot allows ${previous.total}`);
  failed = true;
}

if (failed) {
  console.error("\nNew comments are over the ratchet. Delete them, or lower the");
  console.error("ceiling after a purge with `npm run lint:comments -- --update`.");
  process.exit(1);
}

console.log(`comment-ratchet: ${total}/${previous.total} comment items, under ceiling`);
