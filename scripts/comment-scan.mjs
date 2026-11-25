// String-aware comment scanner: a `//` or `/*` only counts when it is not inside
// a string, template literal (including `${}`) or regular-expression literal.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const FILES = [
  "src/account.ts", "src/car.ts", "src/carModel.ts", "src/desertCar.ts",
  "src/input.ts", "src/main.ts", "src/pixelui.ts", "src/powers.ts",
  "src/rallyCar.ts", "src/recorder.ts", "src/sound.ts", "src/stack.ts",
  "src/world.ts", "server/api.mjs", "scripts/car-preview.html",
];

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// A `//` right after one of these is a URL scheme, not a comment.
const SCHEME = /(?:https?|wss?|file|data|blob):$/;
// A `/` after one of these opens a regular expression literal.
const REGEX_AFTER = /[=(,:[!&|?{};+\-*%<>~^]$/;
const REGEX_KEYWORD = /\b(?:return|typeof|case|in|of|new|delete|void|throw)$/;
// A quote after one of these ends an operand, so it must be a string opener.
const EXPRESSION_END = /[\w$\])}]$/;

function opensString(quote, prev) {
  if (quote === "`") return !EXPRESSION_END.test(prev);
  return !REGEX_AFTER.test(prev) && !EXPRESSION_END.test(prev) && !REGEX_KEYWORD.test(prev);
}

function lineAt(source, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (source.charCodeAt(i) === 10) line += 1;
  return line;
}

function skipString(source, start, quote) {
  let i = start + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") { i += 2; continue; }
    if (ch === quote) return i + 1;
    if (quote === "`" && ch === "$" && source[i + 1] === "{") {
      const stop = skipExpression(source, i + 2);
      if (stop !== -1) { i = stop; continue; }
    }
    i += 1;
  }
  return source.length;
}

function skipExpression(source, start) {
  let i = start;
  let depth = 1;
  let last = "";
  while (i < source.length) {
    const ch = source[i];
    if ((ch === '"' || ch === "'" || ch === "`") && opensString(ch, last)) {
      i = skipString(source, i, ch);
      last = ch;
      continue;
    }
    if (ch === "{" || ch === "(" || ch === "[") depth += 1;
    if (ch === "}" || ch === ")" || ch === "]") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    if (!/\s/.test(ch)) last = ch;
    i += 1;
  }
  return -1;
}

function skipRegex(source, start) {
  let i = start + 1;
  let inClass = false;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\n") return -1;
    if (ch === "\\") { i += 2; continue; }
    if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "/" && !inClass) {
      i += 1;
      while (i < source.length && /[a-z]/i.test(source[i])) i += 1;
      return i;
    }
    i += 1;
  }
  return -1;
}

// Returns one entry per comment item: `{ line, text }`. A block comment counts
// once regardless of how many lines it covers.
export function scan(source) {
  const items = [];
  let i = 0;
  let last = "";
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/" && !SCHEME.test(last)) {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      items.push({ line: lineAt(source, i), text: source.slice(i, stop) });
      i = stop;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      items.push({ line: lineAt(source, i), text: source.slice(i, stop) });
      i = stop;
      continue;
    }
    if ((ch === '"' || ch === "'" || ch === "`") && opensString(ch, last)) {
      i = skipString(source, i, ch);
      last = ch;
      continue;
    }
    if (ch === "/" && (last === "" || REGEX_AFTER.test(last) || REGEX_KEYWORD.test(last))) {
      const stop = skipRegex(source, i);
      if (stop !== -1) { i = stop; last = "/"; continue; }
    }
    if (!/\s/.test(ch)) last = ch;
    i += 1;
  }
  return items;
}

export function countFile(path) {
  const full = join(ROOT, path);
  if (!existsSync(full)) return 0;
  return scan(readFileSync(full, "utf8")).length;
}
