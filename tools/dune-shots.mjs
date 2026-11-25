// Studio + in-game capture harness for the DUNE RUNNER shots.
//
//   node tools/dune-shots.mjs <name> [name ...]     (names: side front rear top iso drive worm)
//
// One fresh headless Chromium per capture on :9224 (SwiftShader WebGL; llvmpipe dies on this
// box with "BindToCurrentSequence failed"). The tab is loaded exactly once — the game's startup
// address carries the URL — because this headless build only pumps rAF for a session's *first*
// document load; a second navigate renders nothing at all, which is what produced the blank
// studio PNGs. Spare tabs are never opened, so nothing can race the capture.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
process.chdir(ROOT);

const BASE = 'http://127.0.0.1:5193';
const CDP = 'http://127.0.0.1:9224';
const OUT = 'shots/cars';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SHOTS = {
  side: { screen: 'studio', file: 'dune-side.png' },
  front: { screen: 'studio', file: 'dune-front.png' },
  rear: { screen: 'studio', file: 'dune-rear.png' },
  top: { screen: 'studio', file: 'dune-top.png' },
  iso: { screen: 'studio', file: 'dune-iso.png' },
  drive: { screen: 'ingame', file: 'dune-ingame-drive.png' },
  worm: { screen: 'ingame', file: 'dune-ingame-wormhole.png', worm: true },
  // aim-disc mock (scripts/worm-preview.html): the 14 m placement ring + marker + landing dust
  aim: { screen: 'studio', file: 'dune-worm-aim.png', url: `${BASE}/scripts/worm-preview.html` },
};

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

/** Poll an in-page expression until it is truthy (250 ms per attempt). */
async function until(c, expression, tries = 40) {
  for (let i = 0; i < tries; i++) {
    await sleep(250);
    try { if (await evaluate(c, expression)) return true; } catch { /* context swap during load */ }
  }
  return false;
}

function killBrowser() {
  spawnSync('bash', ['-c', 'pkill -x chromium; pkill -f chrome_crashpad_handler; pkill -f "usr/bin/xvfb-run"']);
}

/** Start the one browser for this capture, its single tab already pointed at `url`. */
async function open(url) {
  killBrowser();
  await sleep(1500);
  spawnSync('bash', ['-c', 'rm -rf tmp/chrome-profile']);
  const child = spawn('xvfb-run', ['-a', '-s', '-screen 0 1280x720x24', 'chromium',
    '--no-sandbox', '--disable-dev-shm-usage', '--disable-extensions',
    '--ozone-platform=x11', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--remote-debugging-port=9224', `--user-data-dir=${ROOT}/tmp/chrome-profile`,
    '--window-size=1280,720', url],
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
  const loaded = await until(c, `document.readyState === 'complete' && location.href.startsWith('${BASE}')`);
  if (!loaded) throw new Error('page never finished loading');
  return c;
}

async function capture(name, spec) {
  const url = spec.url ?? (spec.screen === 'studio'
    ? `${BASE}/scripts/car-preview.html?variant=2&view=${name}&zoom=1`
    : `${BASE}/?skip&car=2`);
  const c = await open(url);
  await sleep(700);

  if (spec.screen === 'studio') {
    // the preview renders synchronously when its module runs, so carReady also proves WebGL live
    if (!await until(c, 'window.carReady === true', 24)) throw new Error('carReady never set (WebGL blocked in this session)');
    await evaluate(c, 'window.scrollTo(0, 0)');
    await sleep(400);
  } else {
    if (!await until(c, `typeof game !== 'undefined' && !!game?.car`, 40)) throw new Error('game handle never appeared');
    await sleep(1200);
    const info = await evaluate(c, `(async () => {
      const out = {};
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true }));
      const t0 = performance.now(); let n = 0;
      await new Promise((res) => { const tick = () => { n++; if (performance.now() - t0 < 900) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
      out.frames = n;
      out.from = [game.car.x, game.car.z];
      out.speed = +game.car.speed.toFixed(2);
      ${spec.worm ? `
      // fire the power, then let two real frames land so the departure ring, the ghost body and
      // the arrival flash are all on screen in the captured frame
      game.car.powerCd = 0;
      out.blinkOk = game.car.activatePower(game.world);
      const t1 = performance.now();
      let k = 0;
      await new Promise((res) => { const t = () => (++k >= 2 ? res() : requestAnimationFrame(t)); requestAnimationFrame(t); });
      out.to = [game.car.x, game.car.z];
      out.blinkMs = Math.round(performance.now() - t1);
      out.powerTime = +game.car.powerTime.toFixed(2);
      ` : ''}
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true }));
      return out;
    })()`);
    console.log(' ', JSON.stringify(info));
  }

  const { data } = await c.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, spec.file), Buffer.from(data, 'base64'));
  const bytes = fs.statSync(path.join(OUT, spec.file)).size;
  if (bytes < 5000) throw new Error(`${spec.file} came back blank (${bytes} bytes)`);
  console.log(`${spec.file} ${bytes} bytes`);
  c.close();
}

const names = process.argv.slice(2);
if (names.length === 0) throw new Error(`pass shot names: ${Object.keys(SHOTS).join(' ')}`);
let failed = 0;
for (const name of names) {
  const spec = SHOTS[name];
  if (!spec) throw new Error(`unknown shot ${name}`);
  let ok = false;
  for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
    try {
      await capture(name, spec);
      ok = true;
    } catch (err) {
      console.warn(`  ${name} attempt ${attempt}: ${err.message}`);
    }
  }
  if (!ok) failed = 1;
}
killBrowser();
process.exit(failed);
