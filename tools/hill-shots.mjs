#!/usr/bin/env node
// Hill-climb capture: one fresh headless Chromium per shot on :9228, one document load per browser
// (this build only pumps rAF for a session's first load), 1280x720 @1dpr.
//
//   node tools/hill-shots.mjs <outPrefix> [view ...]     (default views: side, iso)
//
// Writes shots/hill/<outPrefix>-<view>.png. Same flags as tools/dune-shots.mjs, different ports.
// The run() below catches its own errors: an uncaught rejection here leaves the process hanging.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
process.chdir(ROOT);

const BASE = 'http://127.0.0.1:5201';
const PORT = 9228;
const CDP = `http://127.0.0.1:${PORT}`;
const OUT = 'shots/hill';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id === undefined) return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    };
  }
  ready() { return new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; }); }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  close() { this.ws.close(); }
}

const evaluate = async (c, expression) => {
  const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};

async function until(c, expression, tries = 40) {
  for (let i = 0; i < tries; i++) {
    await sleep(250);
    try { if (await evaluate(c, expression)) return true; } catch { /* context swap during load */ }
  }
  return false;
}

function killBrowser() {
  spawnSync('bash', ['-c', `pkill -f "remote-debugging-port=${PORT}"; pkill -f chrome_crashpad_handler`]);
}

async function open(url) {
  await sleep(800);
  const prof = `${ROOT}/tmp/hill-profile-${PORT}`;
  spawnSync('bash', ['-c', `rm -rf ${prof}`]);
  const child = spawn('xvfb-run', ['-a', '-s', '-screen 0 1280x720x24', 'chromium',
    '--no-sandbox', '--disable-dev-shm-usage', '--disable-extensions',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion',
    '--ozone-platform=x11', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`,
    '--window-size=1280,720', 'about:blank'],
  { detached: true, stdio: 'ignore' });
  child.unref();
  let pages = [];
  for (let i = 0; i < 80; i++) {
    try { pages = (await (await fetch(`${CDP}/json`)).json()).filter((t) => t.type === 'page'); if (pages.length) break; } catch {}
    await sleep(250);
  }
  if (pages.length !== 1) throw new Error(`expected one page target, got ${pages.length}`);
  const c = new Cdp(pages[0].webSocketDebuggerUrl);
  await c.ready();
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  // navigate the blank tab itself so the *first* document load is the preview page
  const r = await c.send('Page.navigate', { url });
  if (r.errorText) throw new Error(`navigate failed: ${r.errorText}`);
  if (!await until(c, `document.readyState === 'complete' && location.href.startsWith('${BASE}')`)) {
    throw new Error(`page never finished loading (href: ${await evaluate(c, 'location.href')})`);
  }
  return c;
}

async function capture(prefix, view) {
  killBrowser();
  const c = await open(`${BASE}/scripts/car-preview.html?view=${view}&zoom=1&variant=2`);
  await sleep(600);
  if (!await until(c, 'window.carReady === true', 24)) throw new Error('carReady never set');
  const frames = await evaluate(c, `new Promise((res) => {
    const t0 = performance.now(); let n = 0;
    const tick = () => { n++; performance.now() - t0 < 250 ? requestAnimationFrame(tick) : res(n); };
    requestAnimationFrame(tick);
  })`);
  if (!frames) throw new Error('rAF dead — broken flags');
  await sleep(200);
  const file = path.join(OUT, `${prefix}-${view}.png`);
  const { data } = await c.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  const bytes = fs.statSync(file).size;
  if (bytes < 5000) throw new Error(`${file} blank (${bytes} bytes)`);
  console.log(`${file} ${bytes} bytes, rAF ${frames}`);
  c.close();
}

async function run() {
  const [prefix, ...rest] = process.argv.slice(2);
  if (!prefix) throw new Error('usage: node tools/hill-shots.mjs <outPrefix> [view ...]');
  const views = rest.length ? rest : ['side', 'iso'];
  const capPrefix = prefix.split('/').pop();
  fs.mkdirSync(OUT, { recursive: true });
  let failed = 0;
  for (const view of views) {
    let ok = false;
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      try { await capture(capPrefix, view); ok = true; }
      catch (err) { console.warn(`  ${view} attempt ${attempt}: ${err.message}`); killBrowser(); }
    }
    if (!ok) failed = 1;
  }
  killBrowser();
  return failed;
}

run().then((code) => process.exit(code), (err) => { console.error(err); killBrowser(); process.exit(1); });
