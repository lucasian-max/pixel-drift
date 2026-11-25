// UI playtest capture: one fresh Chromium per shot on :9228, the single tab loaded straight at
// the page under test (this headless build only pumps rAF for a session's first document load).
//
//   node tools/ui-playtest.mjs <shot> [shot ...]
//
// A shot = { url, steps: [...] } where each step is a page expression or a wait.
// Output: shots/ui/<shot>.png
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
process.chdir(ROOT);

const BASE = process.env.UI_PLAYTEST_BASE || 'http://127.0.0.1:5204';
const CDP = 'http://127.0.0.1:9228';
const OUT = 'shots/ui';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** pointerdown at the 1280x720 screen point for internal UI point (ux, uy) of the 360-tall canvas.
 *  The pointerdown handler must run in an ISOLATED world: Vite serves the app modules unminified,
 *  so a main-world `window.dispatchEvent` reaches the app's listener with an un-rewritten
 *  "pointerdown" string, and the main thread then dies on the unknown event type. */
const click = (ux, uy) => ({ click: [Math.round(ux * (720 / 360)), uy * (720 / 360)] });
const GARAGE_BTN = [288, 244];      // title VIEW CAR centre, internal pixels
const PLAY_BTN = [288, 272];        // title PLAY centre
const MENU_BTN = [277, 95];         // in-race M MENU centre

const k = (type, code, key = code.replace(/^Key/, '').toLowerCase()) =>
  `window.dispatchEvent(new KeyboardEvent('${type}', { code: '${code}', key: '${key}', bubbles: true }))`;
const tap = (code, key) => `${k('keydown', code, key)}; ${k('keyup', code, key)}`;
const hold = (code, key) => k('keydown', code, key);
const release = (code, key) => k('keyup', code, key);
const wait = (ms) => ({ wait: ms });
const run = (js) => ({ js });

/** chase-lock readout: is the lock on, and is the camera actually behind the car?
 *  The camera offset is (sin camYaw, cos camYaw) * dist, so atan2(dx, dz) recovers
 *  camYaw and the angle to car.heading is the "behind the right way" error. */
const CAMERR = `(() => {
  const g = window.game, c = g.car, p = g.camera.position;
  const yaw = Math.atan2(p.x - c.x, p.z - c.z);
  let e = yaw - c.heading; e = Math.atan2(Math.sin(e), Math.cos(e));
  return { chase: g.chase, headDeg: +(c.heading * 180 / Math.PI).toFixed(1),
           camDeg: +(yaw * 180 / Math.PI).toFixed(1), offDeg: +(e * 180 / Math.PI).toFixed(1),
           speed: +c.speed.toFixed(2) };
})()`;
/** real pointer drag on the game canvas (isolated world: synthetic events) */
const drag = (fx0, fy0, fx1, fy1) => `(() => {
  const c = document.getElementById('game'), r = c.getBoundingClientRect();
  const ev = (type, fx, fy) => new PointerEvent(type, { clientX: r.left + r.width * fx,
    clientY: r.top + r.height * fy, pointerId: 1, bubbles: true });
  c.dispatchEvent(ev('pointerdown', ${fx0}, ${fy0}));
  c.dispatchEvent(ev('pointermove', ${fx1}, ${fy1}));
  c.dispatchEvent(ev('pointerup', ${fx1}, ${fy1}));
})()`;
const wheel = (dy) => `window.dispatchEvent(new WheelEvent('wheel', { deltaY: ${dy}, bubbles: true }))`;

/** where the car lands in normalised device coords: |x|,|y| <= 1 means fully in frame,
 *  so anything outside is a studio camera that has cropped a long car. */
const PROJECT = `(() => {
  const g = window.game;
  const p = g.car.group.position.clone().project(g.camera);
  return { ndc: [+p.x.toFixed(2), +p.y.toFixed(2)], inFrame: Math.abs(p.x) < 0.92 && Math.abs(p.y) < 0.82 };
})()`;

/** hit-test every registered button at its own centre, and report any that answer with
 *  another id (overlapping buttons), plus the boxes themselves for the record. */
const HITS = `(() => {
  const ui = window.game.ui, cv = document.getElementById('ui'), r = cv.getBoundingClientRect();
  const toClient = (x, y) => [r.left + (x / ui.w) * r.width, r.top + (y / ui.h) * r.height];
  const bad = [], boxes = [];
  for (const b of ui.buttons) {
    const [cx, cy] = toClient(b.x + b.w / 2, b.y + b.h / 2);
    const got = ui.hit(cx, cy);
    boxes.push(b.id + '@' + Math.round(b.x) + ',' + Math.round(b.y) + ' ' + b.w + 'x' + b.h);
    if (got !== b.id) bad.push({ want: b.id, got });
  }
  return { n: ui.buttons.length, bad, boxes };
})()`;

const SHOTS = {
  // ---- in-race HUD, mid-lap at speed. ?fast runs the autopilot N seconds at boot, which
  // is the only way to get a lived-in lap on screen: this headless renderer managed 2 fps,
  // so wall-clock waiting advances almost no simulation time.
  hud: {
    url: `${BASE}/?skip&demo&fast=12&car=2`,
    steps: [wait(4500), run(`({ laps: game.laps, t: +game.lapTime.toFixed(2), speed: +game.car.speed.toFixed(1) })`)],
  },
  // ---- aim mode: the TUNNEL power armed, disc + prompt on screen
  aim: {
    url: `${BASE}/?skip&car=2`,
    steps: [
      wait(3000),
      run(`game.car.powerCd = 0; game.car.activatePower(game.world)`),
      wait(150),
      run(`(() => { const c = document.getElementById('game'); const r = c.getBoundingClientRect();
        c.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + r.width * 0.62, clientY: r.top + r.height * 0.34, bubbles: true })); })()`),
      wait(4000),
      run(`({ aiming: game.car.aiming })`),
      // the marker settles for a moment after arming; sample the scene's own marker twice
      // to confirm it stops at a held pointer (accepted behaviour: it must stop, not vanish)
      run(`(() => { const m = game.scene.getObjectByName('wormMarker');
        window.__aimA = [m.position.x, m.position.z]; return { at: window.__aimA }; })()`),
      wait(2500),
      run(`(() => { const m = game.scene.getObjectByName('wormMarker');
        const b = [m.position.x, m.position.z], a = window.__aimA;
        return { from: a, to: b, drift: +Math.hypot(b[0] - a[0], b[1] - a[1]).toFixed(3) }; })()`),
    ],
  },
  // ---- Esc cancels the armed wrap, and whether it also silently un-pauses a run the
  // player paused *after* arming (lapTime only advances when started && !aiming)
  aimescape: {
    url: `${BASE}/?skip&demo&fast=6&car=2`,
    steps: [
      wait(3000),
      run(`game.car.powerCd = 0; game.car.activatePower(game.world)`),
      wait(200),
      run(`(() => { const c = document.getElementById('game'), r = c.getBoundingClientRect();
        c.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + r.width * 0.6, clientY: r.top + r.height * 0.4, bubbles: true })); })()`),
      run(tap('KeyP', 'p')), wait(400),          // pause while armed
      run(tap('Escape', 'Escape')), wait(400),   // cancel the aim
      run(`({ aiming: game.car.aiming, t0: +game.lapTime.toFixed(2) })`),
      wait(1500),
      run(`({ aiming: game.car.aiming, t1: +game.lapTime.toFixed(2) })`),
    ],
  },
  // ---- Enter confirms an armed placement
  aimenter: {
    url: `${BASE}/?skip&demo&fast=6&car=2`,
    steps: [
      wait(3000),
      run(`({ before: [ +game.car.x.toFixed(1), +game.car.z.toFixed(1) ], aiming: game.car.aiming })`),
      run(`game.car.powerCd = 0; game.car.activatePower(game.world)`),
      wait(200),
      run(`(() => { const c = document.getElementById('game'), r = c.getBoundingClientRect();
        c.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + r.width * 0.62, clientY: r.top + r.height * 0.34, bubbles: true })); })()`),
      wait(600),
      run(`({ marker: (() => { const m = game.scene.getObjectByName('wormMarker');
        return [+m.position.x.toFixed(1), +m.position.z.toFixed(1)]; })() })`),
      run(tap('Enter', 'Enter')), wait(600),
      run(`({ aiming: game.car.aiming, after: [ +game.car.x.toFixed(1), +game.car.z.toFixed(1) ] })`),
    ],
  },
  // ---- pause while armed
  aimpause: {
    url: `${BASE}/?skip&car=2`,
    steps: [
      wait(3000),
      run(`game.car.powerCd = 0; game.car.activatePower(game.world)`),
      wait(150),
      run(`(() => { const c = document.getElementById('game'); const r = c.getBoundingClientRect();
        c.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + r.width * 0.6, clientY: r.top + r.height * 0.4, bubbles: true })); })()`),
      run(tap('KeyP', 'p')),
      wait(700),
      run(`({ aiming: game.car.aiming })`),
    ],
  },
  // ---- title, signed out
  title: {
    url: `${BASE}/`,
    steps: [wait(2200)],
  },
  // ---- the sign-in modal over the title
  loginmodal: {
    url: `${BASE}/`,
    steps: [wait(2600), { call: 'login' }, wait(1200)],
  },
  // ---- NEW BEST banner: a completed lap drops bestTime, which flashes the banner for
  // 2.6s of real time, so it is caught here right after the boot fast-forward
  newbest: {
    url: `${BASE}/?skip&demo&fast=73.5&car=0`,
    steps: [wait(13000), run(`({ laps: game.laps, t: +game.lapTime.toFixed(1) })`)],
  },
  newbest7: {
    url: `${BASE}/?skip&demo&fast=73.5&car=0`,
    steps: [wait(6500), run(`({ laps: game.laps, t: +game.lapTime.toFixed(2) })`)],
  },
  newbest9: {
    url: `${BASE}/?skip&demo&fast=73.5&car=0`,
    steps: [wait(8500), run(`({ laps: game.laps, t: +game.lapTime.toFixed(2) })`)],
  },
  // ---- garage: all three cars, broadside, spin frozen so framing is comparable.
  // camYaw is 0.6 in the garage, so ry = -0.971 puts each car's long axis square across
  // the screen: the harshest test of pad overhang and studio-camera crop.
  garage0: {
    url: `${BASE}/?car=0`,
    steps: [wait(2200), { call: 'garage' }, wait(5200), run(tap('KeyP', 'p')),
      run(`game.car.group.rotation.y = -0.971`), wait(300)],
  },
  garage1: {
    url: `${BASE}/?car=1`,
    steps: [wait(2200), { call: 'garage' }, wait(5200), run(tap('KeyP', 'p')),
      run(`game.car.group.rotation.y = -0.971`), wait(300)],
  },
  garage2: {
    url: `${BASE}/?car=2`,
    steps: [wait(2200), { call: 'garage' }, wait(5200), run(tap('KeyP', 'p')),
      run(`game.car.group.rotation.y = -0.971`), wait(300)],
  },
  // ---- garage arrival: a couple of frames after VIEW CAR, while the view tween is still
  // running. The car must already be inside the frame (focus is snapped, not panned).
  garage2arrive: {
    url: `${BASE}/?car=2`,
    steps: [wait(2200), { call: 'garage' }, wait(800), run(PROJECT), wait(600), run(PROJECT)],
  },
  // ---- garage arrival for the short car, same instant, for comparison
  garage0arrive: {
    url: `${BASE}/?car=0`,
    steps: [wait(2200), { call: 'garage' }, wait(800), run(PROJECT)],
  },
  // ---- title, signed out (with board)
  title: {
    url: `${BASE}/`,
    steps: [wait(2400), run(`[...document.querySelectorAll('canvas')].map((c) => c.id + ':' + c.width + 'x' + c.height)`), run(`game && game.car.variant`)],
  },
  // ---- dashboard signed out
  dash: {
    url: `${BASE}/dashboard.html`,
    steps: [wait(1800)],
  },
  // ---- paused mid race
  paused: {
    url: `${BASE}/?skip&car=2`,
    steps: [wait(1600), run(tap('KeyP', 'p')), wait(500)],
  },
  // ---- C at the line, T relock chip
  line: {
    url: `${BASE}/?skip&car=2`,
    steps: [wait(1600), run(tap('KeyC', 'c')), wait(500)],
  },
  // ---- lock off while rolling, so the chip should read T RELOCK CAM
  chipoff: {
    url: `${BASE}/?skip&car=2`,
    steps: [
      wait(1600), run(hold('KeyW', 'w')), wait(1500),
      run(wheel(60)), run(drag(0.5, 0.5, 0.62, 0.5)), wait(500),
      run(`({ chase: game.chase })`),
    ],
  },

  // ---- every button's own centre must hit-test back to its own id: catches buttons
  // drawn on top of each other (the first match wins in ui.hit) without needing a screenshot
  hitsgarage: {
    url: `${BASE}/?car=2`,
    steps: [wait(2200), { call: 'garage' }, wait(3000), run(HITS)],
  },
  hitstitle: {
    url: `${BASE}/`,
    steps: [wait(3000), run(HITS)],
  },
  hitsrace: {
    url: `${BASE}/?skip&demo&fast=6&car=2`,
    steps: [wait(3000), run(HITS)],
  },
  // ---- (a) T relocks while rolling: forward, then reverse
  lockfwd: {
    url: `${BASE}/?skip&car=0`,
    steps: [
      wait(1600), run(hold('KeyW', 'w')), wait(1800),
      run(CAMERR),
      run(drag(0.5, 0.5, 0.63, 0.5)), wait(120),
      run(`({ afterDrag: game.chase })`),
      run(tap('KeyT', 't')), wait(1100),
      run(CAMERR),
      run(release('KeyW', 'w')),
    ],
  },
  lockrev: {
    url: `${BASE}/?skip&car=0`,
    steps: [
      wait(1600), run(hold('KeyS', 's')), wait(1800),
      run(CAMERR),
      run(drag(0.5, 0.5, 0.63, 0.5)), wait(120),
      run(tap('KeyT', 't')), wait(1100),
      run(CAMERR),
      run(release('KeyS', 's')),
    ],
  },
  // ---- a look held on the title must not be inherited by the race camera
  lockstart: {
    url: `${BASE}/?car=0`,
    steps: [
      wait(2400), run(hold('KeyE', 'e')), wait(900), run(release('KeyE', 'e')),
      run(tap('Space', ' ')), wait(500),
      run(CAMERR),
    ],
  },
  // ---- (c) M to title and back
  locktitle: {
    url: `${BASE}/?skip&car=0`,
    steps: [
      wait(1600), run(`({ begin: game.chase })`),
      run(tap('KeyM', 'm')), wait(500),
      run(`({ onTitle: game.chase, running: game.running })`),
      run(tap('Space', ' ')), wait(600),
      run(CAMERR),
    ],
  },
  // ---- (d) VIEW CAR then back to the circuit
  lockgarage: {
    url: `${BASE}/?car=2`,
    steps: [
      wait(2200), { call: 'garage' }, wait(1200),
      run(`({ inGarage: game.ui ? true : true })`),
      run(tap('Enter', 'Enter')), wait(700),
      run(`({ afterBack: game.chase, running: game.running })`),
      run(tap('Space', ' ')), wait(700),
      run(CAMERR),
    ],
  },
  // ---- relock settle curve after a drag, with the frame rate, so a slow headless
  // render can be told apart from a camera that genuinely never settles
  locksettle: {
    url: `${BASE}/?skip&car=0`,
    steps: [
      wait(1600),
      run(`new Promise((res) => { let n = 0; const t0 = performance.now();
        const tick = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(tick);
          else res({ fps: n }); }; requestAnimationFrame(tick); })`),
      run(hold('KeyW', 'w')), wait(1500),
      run(drag(0.5, 0.5, 0.63, 0.5)), wait(150),
      run(tap('KeyT', 't')),
      wait(400), run(CAMERR),
      wait(600), run(CAMERR),
      wait(1000), run(CAMERR),
      wait(2000), run(CAMERR),
      run(release('KeyW', 'w')),
    ],
  },
  // ---- (e) Q/E drops the lock, and T takes it back
  locklook: {
    url: `${BASE}/?skip&car=0`,
    steps: [
      wait(1600), run(hold('KeyW', 'w')), wait(1200),
      run(hold('KeyE', 'e')), wait(500),
      run(`({ afterE: game.chase })`),
      run(release('KeyE', 'e')), run(tap('KeyT', 't')), wait(900),
      run(CAMERR),
      run(release('KeyW', 'w')),
    ],
  },
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

async function until(c, expression, tries = 40) {
  for (let i = 0; i < tries; i++) {
    await sleep(250);
    try { if (await evaluate(c, expression)) return true; } catch { /* context swap during load */ }
  }
  return false;
}

function killBrowser() {
  spawnSync('bash', ['-c', 'pkill -f "remote-debugging-port=9228"']);
}

async function open(spec) {
  const url = spec.url;
  killBrowser();
  await sleep(1200);
  const profile = `${process.env.HOME}/tmp/ui-playtest-profile-9228-${process.pid}-${Date.now()}`;
  spawnSync('bash', ['-c', `rm -rf ${profile}`]);
  // an inherited LD_LIBRARY_PATH can point at a bundled libstdc++ that chromium
  // loads in place of the system one, dying on a missing GLIBCXX_3.4.30
  const env = { ...process.env };
  for (const v of ['LD_LIBRARY_PATH', 'LD_PRELOAD', 'PYTHONPATH']) delete env[v];
  const child = spawn('xvfb-run', ['-a', '-s', '-screen 0 1280x720x24', 'chromium',
    '--no-sandbox', '--disable-dev-shm-usage', '--disable-extensions',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion',
    '--ozone-platform=x11', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--remote-debugging-port=9228', `--user-data-dir=${profile}`,
    '--window-size=1280,720', url],
  { detached: true, stdio: 'ignore', env });
  child.unref();
  let pages = [];
  for (let i = 0; i < 80; i++) {
    try {
      // only a tab on the page under test counts: a stale tab from another playtest session
      // can sit on this port, and the startup tab is about:blank until our URL commits
      pages = (await (await fetch(`${CDP}/json`)).json())
        .filter((t) => t.type === 'page' && t.url.startsWith(new URL(spec.url).origin));
      if (pages.length) break;
    } catch {}
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

/** the dev server on BASE must be serving THIS checkout: 5196-5205 are squatted by
 *  neighbouring lanes' worktrees, and a stray server there silently screenshots their
 *  code instead of ours. tools/ui-playtest.mjs exists only in this worktree. */
async function assertOwnServer() {
  const r = await fetch(`${BASE}/tools/ui-playtest.mjs`).catch(() => null);
  if (!r || !r.ok) throw new Error(`${BASE} is not serving this checkout (marker ${r ? r.status : 'no response'})`);
}

async function capture(name, spec) {
  const c = await open(spec);
  const log = [];
  for (const step of spec.steps) {
    if (step.wait) await sleep(step.wait);
    else if (step.call) {
      // Call the screen's own action wiring directly. This must run in the MAIN world:
      // `game` is set on `window` by main.ts, and an isolated world has its own globals,
      // so `game.ui.onAction` there is a TypeError on undefined. Function calls involve
      // no synthetic events, so the isolated-world trick that `click` needs is not needed.
      const q = `window.game ? (window.game.ui.onAction(${JSON.stringify(step.call)}), 'ok') : 'no game global'`;
      const r = await evaluate(c, q);
      log.push(`call ${step.call} -> ${r}`);
    } else if (step.click) {
      const [cx, cy] = step.click;
      const q = `document.getElementById('game').dispatchEvent(new PointerEvent('pointerdown', { clientX: ${cx}, clientY: ${cy}, pointerId: 1, bubbles: true }))`;
      const r = await c.send('Page.createIsolatedWorld', { frameId: (await c.send('Page.getFrameTree')).frameTree.frame.id, worldName: 'ui-probe' });
      const ev = await c.send('Runtime.evaluate', { expression: q, contextId: r.executionContextId, returnByValue: true });
      log.push(`click ${cx},${cy}${ev.exceptionDetails ? ' ERR' : ''}`);
    } else if (step.js) {
      try { log.push(await evaluate(c, step.js)); } catch (e) { log.push(`ERR ${e.message}`); }
    }
  }
  const { data } = await c.send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  const bytes = fs.statSync(file).size;
  console.log(`${name}: ${bytes} bytes ${log.length ? JSON.stringify(log) : ''}`);
  if (bytes < 5000) throw new Error(`${name} came back blank (${bytes} bytes)`);
  c.close();
}

const names = process.argv.slice(2);
if (names.length === 0) throw new Error(`pass shot names: ${Object.keys(SHOTS).join(' ')}`);
await assertOwnServer();
let failed = 0;
for (const name of names) {
  const spec = SHOTS[name];
  if (!spec) throw new Error(`unknown shot ${name}`);
  let ok = false;
  for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
    try { await capture(name, spec); ok = true; }
    catch (err) { console.warn(`  ${name} attempt ${attempt}: ${err.message}`); }
  }
  if (!ok) failed = 1;
}
killBrowser();
process.exit(failed);
