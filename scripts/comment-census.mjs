#!/usr/bin/env node
// Counts comment items for a path or directory (does not enforce anything).
//
//   node scripts/comment-census.mjs [path ...]
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { scan } from "./comment-scan.mjs";

const targets = process.argv.slice(2);
let total = 0;
const walk = (path) => {
  const stat = statSync(path);
  return stat.isDirectory()
    ? readdirSync(path).flatMap((name) => walk(join(path, name)))
    : [path];
};

for (const file of targets.flatMap(walk).filter((f) => /\.(ts|mjs|js|html)$/.test(f))) {
  const items = scan(readFileSync(file, "utf8"));
  total += items.length;
  console.log(`${String(items.length).padStart(4)}  ${file}`);
}
console.log(`${String(total).padStart(4)}  total`);
