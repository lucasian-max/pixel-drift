import * as THREE from 'three';
// https-only: a clean single-scheme site is what web filters and review
// processes expect; the plain-http copy serves nothing they can use
if (location.protocol === 'http:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
  location.replace(`https://${location.host}${location.pathname}${location.search}${location.hash}`);
}

import { buildWorld, MAPS } from './world';
import { createWormAimRing } from './wormFx';
import { Car } from './car';
import { CAR_NAMES } from './carModel';
import { carStatRows } from './carStats';
import { CAR_POWERS, powerColour } from './powers';
import { Input } from './input';
import { PixelUI } from './pixelui';
import { loadSheet, shadowPatch } from './stack';
import { Sound } from './sound';
import { account } from './account';
import type { LapTracePoint } from './account';
import { buildGhostModel, sampleGhost, ghostEvents } from './ghost';
import { GhostFx } from './ghostFx';
import { Recorder } from './recorder';

const gameCanvas = document.getElementById('game') as HTMLCanvasElement;
const uiCanvas = document.getElementById('ui') as HTMLCanvasElement;
const bootError = document.getElementById('boot-error') as HTMLDivElement;

const BASE_HEIGHT = 360;

/* ---- login / signup overlay (DOM; pixel-styled, CSS injected from TS) -----
   Flat dark panel, cream Silkscreen text. While hidden it is display:none,
   so it is out of the accessibility tree, holds no focus and steals no keys. */

/* Cloudflare Turnstile: an invisible-until-needed human check rendered into
 * the signup form. The site key is public by design (it identifies the
 * widget, it does not verify anything); the secret lives server-side. */
const TURNSTILE_SITEKEY = '0x4AAAAAAGWSXQab4CExjYpd';
interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  getResponse: (id?: string) => string | undefined;
  reset: (id?: string) => void;
}
declare global {
  interface Window { turnstile?: TurnstileApi; }
}

const loginForm = (() => {
  const style = document.createElement('style');
  style.textContent = `
#login-overlay { position: fixed; inset: 0; z-index: 6; display: none;
  place-items: center; background: rgba(12,14,18,0.55);
  font-family: Silkscreen, ui-monospace, monospace; color: #f2eee1; }
#login-overlay.open { display: grid; }
#login-overlay form { width: 22em; padding: 1em; background: #14161a;
  border: 2px solid #f2eee1; box-shadow: 4px 4px 0 rgba(8,10,12,0.8); }
#login-overlay h2 { margin: 0 0 0.75em; font-size: 1em; font-weight: 700;
  letter-spacing: 0.3em; color: #e0513f; }
#login-overlay label { display: block; margin: 0.9em 0 0.3em; color: rgba(242,238,225,0.55); }
#login-overlay input { width: 100%; padding: 0.55em; font: inherit; color: #f2eee1;
  background: #0e1013; border: 2px solid rgba(242,238,225,0.35); caret-color: #e0513f; }
#login-overlay input:focus { outline: none; border-color: #f2eee1; }
#login-overlay button:focus-visible { outline: 2px solid #e0513f; outline-offset: 2px; }
#login-error { min-height: 1.2em; margin: 0.7em 0 0; color: #e0513f; }
#login-turnstile { min-height: 4.2em; margin: 0.7em 0 0; }
#login-turnstile:empty { min-height: 0; margin: 0; }
.login-row { display: flex; gap: 0.5em; margin-top: 0.9em; }
.login-row button { flex: 1; font: inherit; padding: 0.55em 0.2em; cursor: pointer;
  border: 2px solid #f2eee1; }
#login-go { background: #e0513f; color: #f2eee1; }
#login-new { background: #f2eee1; color: #14161a; }
#login-cancel { background: #14161a; border-color: rgba(242,238,225,0.55);
  color: rgba(242,238,225,0.8); }`;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.id = 'login-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'false');
  overlay.setAttribute('aria-labelledby', 'login-title');
  overlay.innerHTML = `
    <form novalidate>
      <h2 id="login-title">SIGN IN</h2>
      <label for="login-user">USERNAME</label>
      <input id="login-user" autocomplete="username" spellcheck="false" maxlength="16" />
      <label for="login-pass">PASSWORD</label>
      <input id="login-pass" type="password" autocomplete="current-password" />
      <p id="login-error" aria-live="polite"></p>
      <div id="login-turnstile"></div>
      <div class="login-row">
        <button type="submit" id="login-go">SIGN IN</button>
        <button type="button" id="login-new">CREATE ACCOUNT</button>
        <button type="button" id="login-cancel">CANCEL</button>
      </div>
    </form>`;
  document.body.appendChild(overlay);

  const form = overlay.querySelector('form')!;
  const userEl = overlay.querySelector<HTMLInputElement>('#login-user')!;
  const passEl = overlay.querySelector<HTMLInputElement>('#login-pass')!;
  const errEl = overlay.querySelector<HTMLElement>('#login-error')!;
  const turnstileEl = overlay.querySelector<HTMLElement>('#login-turnstile')!;
  const newBtn = overlay.querySelector<HTMLButtonElement>('#login-new')!;
  const cancelBtn = overlay.querySelector<HTMLButtonElement>('#login-cancel')!;
  const allBtns = Array.from(overlay.querySelectorAll<HTMLButtonElement>('button'));

  /* Turnstile: loaded on first open, rendered once. Tokens are one-use, so a
     failed signup resets the widget to mint a fresh one for the retry. */
  let widgetId: string | null = null;
  function loadTurnstile() {
    if (window.turnstile) {
      if (!widgetId) widgetId = window.turnstile.render(turnstileEl, {
        sitekey: TURNSTILE_SITEKEY, theme: 'dark',
      });
      return;
    }
    if (document.querySelector('script[data-turnstile]')) return;
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.defer = true;
    s.setAttribute('data-turnstile', '');
    s.addEventListener('load', () => {
      if (window.turnstile && !widgetId) {
        widgetId = window.turnstile.render(turnstileEl, {
          sitekey: TURNSTILE_SITEKEY, theme: 'dark',
        });
      }
    });
    document.head.appendChild(s);
  }
  function turnstileToken(): string | undefined {
    return window.turnstile && widgetId !== null
      ? window.turnstile.getResponse(widgetId) || undefined
      : undefined;
  }
  function resetTurnstile() {
    if (window.turnstile && widgetId !== null) window.turnstile.reset(widgetId);
  }

  /* match the HUD grid: 8px Silkscreen at the canvas upscale factor */
  const rescale = () => {
    overlay.style.fontSize = `${Math.max(8, (8 * innerHeight) / 360)}px`;
  };
  addEventListener('resize', rescale);

  /* the game listens on window — keep the form's keys and clicks to itself */
  /* the game listens on window — keep the form's keys and clicks to itself.
     While open, anything not aimed at the form is stopped at capture so the
     game never sees it (covers focus escaping the overlay); Escape closes. */
  addEventListener('keydown', (e) => {
    if (!overlay.classList.contains('open')) return;
    if (overlay.contains(e.target as Node)) return;
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  }, { capture: true });
  overlay.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  overlay.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    if (e.target === overlay) close();   // backdrop click cancels
  });

  let working = false;
  async function submit(mode: 'login' | 'signup') {
    if (working) return;
    errEl.textContent = '';
    if (mode === 'signup') {
      const t = turnstileToken();
      if (!t) {
        errEl.textContent = window.turnstile
          ? 'human check still running — try again in a second'
          : 'human check is loading — try again in a second';
        return;
      }
      working = true;
      for (const b of allBtns) b.disabled = true;
      const r = await account.signup(userEl.value.trim().toLowerCase(), passEl.value, t);
      working = false;
      for (const b of allBtns) b.disabled = false;
      if (r.ok) { close(); passEl.value = ''; return; }
      errEl.textContent = r.error ?? 'something went wrong';
      resetTurnstile();   // the token was spent: mint a fresh one for the retry
      return;
    }
    working = true;
    for (const b of allBtns) b.disabled = true;
    const r = await account.login(userEl.value.trim().toLowerCase(), passEl.value);
    working = false;
    for (const b of allBtns) b.disabled = false;
    if (r.ok) { close(); passEl.value = ''; return; }
    errEl.textContent = r.error ?? 'something went wrong';
  }

  function open() {
    errEl.textContent = '';
    overlay.classList.add('open');
    rescale();
    loadTurnstile();
    /* defer: the opening click's default focus action would otherwise win */
    setTimeout(() => userEl.focus(), 0);
  }
  function close() {
    overlay.classList.remove('open');   // display:none -> no focus, no keys
    errEl.textContent = '';
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); void submit('login'); });
  newBtn.addEventListener('click', () => void submit('signup'));
  cancelBtn.addEventListener('click', close);

  return { open, isOpen: () => overlay.classList.contains('open') };
})();

/* ---- garage power clips (DOM <video> over the garage's demo window) ------
   Real in-game footage of each car's power, trimmed to a loop, parked over the
   window the garage's demo animation draws into. The animation keeps drawing
   underneath it: a clip that is missing, will not load, or will not autoplay
   never appears, and the pixel demo is what the band shows. Outside the garage
   the element is display:none and paused, so nothing decodes while you drive. */

const garageClip = (() => {
  /* one clip per car, in CAR_POWERS order */
  const SRC = ['/clips/pearl-drift.webm', '/clips/thunderclap.webm', '/clips/tunnel.webm'];

  const style = document.createElement('style');
  style.textContent = `
#garage-clip { position: fixed; z-index: 4; display: none; object-fit: cover;
  object-position: 50% 80%; image-rendering: pixelated; pointer-events: none; }`;
  document.head.appendChild(style);

  const el = document.createElement('video');
  el.id = 'garage-clip';
  el.muted = true;
  el.loop = true;
  el.playsInline = true;
  el.autoplay = true;
  el.preload = 'auto';
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);

  let want = -1;      // the clip the garage is asking for
  let loaded = -1;    // the clip the element holds a decoded frame of
  let dead = false;   // this clip will not load or play: show the demo instead
  let shown = false;
  const box = { x: -1, y: -1, w: -1, h: -1 };

  const hide = () => {
    if (!shown) return;
    shown = false;
    el.style.display = 'none';
    el.pause();
  };

  el.addEventListener('canplay', () => { loaded = want; });
  el.addEventListener('error', () => { dead = true; hide(); });

  return {
    /** rect: the demo window in canvas pixels, or null when there is none */
    place(rect: { x: number; y: number; w: number; h: number } | null, car: number) {
      if (!rect) { hide(); return; }
      const v = ((car % SRC.length) + SRC.length) % SRC.length;
      if (v !== want) {
        want = v;
        loaded = -1;
        dead = false;
        el.src = SRC[v];       // a different car is a different film
      }
      /* no decoded frame yet, or a clip this browser refused: the demo is the
         picture, and it is already drawn under here */
      if (dead || loaded !== v) { hide(); return; }

      const sx = innerWidth / uiCanvas.width;
      const sy = innerHeight / uiCanvas.height;
      const x = rect.x * sx, y = rect.y * sy, w = rect.w * sx, h = rect.h * sy;
      if (Math.abs(x - box.x) > 0.4 || Math.abs(y - box.y) > 0.4
        || Math.abs(w - box.w) > 0.4 || Math.abs(h - box.h) > 0.4) {
        box.x = x; box.y = y; box.w = w; box.h = h;
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.style.width = `${w}px`;
        el.style.height = `${h}px`;
      }
      if (!shown) { shown = true; el.style.display = 'block'; }
      if (el.paused) void el.play().catch(() => { dead = true; hide(); });
    },
  };
})();

async function boot() {
  const params = new URLSearchParams(location.search);
  /* gated features: public on the server, or always on for an admin session */
  const devOn = (name: string) =>
    account.features?.[name] === true || account.user?.role === 'admin';
  // Old multiplayer invites are inert now; drop the dead param from the URL.
  if (params.has('room')) {
    const clean = new URL(location.href);
    clean.searchParams.delete('room');
    history.replaceState(null, '', clean);
  }
  const renderer = new THREE.WebGLRenderer({ canvas: gameCanvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#4e7a45');
  scene.add(new THREE.AmbientLight(0xffffff, 2.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-0.6, 1.2, -0.35);
  scene.add(sun);

  const wantedMap = params.get('map');
  const mapId = MAPS.some((m) => m.id === wantedMap) ? wantedMap! : 'coast';
  const sessionReady = account.refresh(mapId);   // session + this map's leaderboard
  const world = await buildWorld(scene, mapId);
  scene.background = new THREE.Color(world.sky);
  const mapIndex = Math.max(0, MAPS.findIndex((m) => m.id === mapId));
  const overview = params.has('overview');
  // the gantry banner would fight the title lockup on the start screen;
  // it is shown again the moment a run begins
  const setGantryBanner = (on: boolean) => {
    world.group.traverse((o) => { if (o.name === 'gantryBanner') o.visible = on; });
  };
  setGantryBanner(false);
  const car = await new Car().init(world);
  // ?car=N stays for previews and probes; otherwise the player's DEFAULT CAR
  // from SETTINGS is what they start on (PEARL GT until they pick one).
  let defaultCar = 0;
  try {
    const savedCar = Number(localStorage.getItem('pixel-drift:car'));
    if (Number.isInteger(savedCar) && savedCar >= 0 && savedCar < CAR_NAMES.length) defaultCar = savedCar;
  } catch { /* private mode */ }
  const entryCar = Number(params.get('car') ?? 0);
  car.setVariant(Number.isFinite(entryCar) ? entryCar : 0);
  if (!params.has('car')) car.setVariant(defaultCar);
  scene.add(car.group);
  const aimUI = createWormAimRing(CAR_POWERS.find((p) => p.blink)?.blink ?? 22);
  scene.add(aimUI.group);
  const aimRay = new THREE.Raycaster();
  const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const aimNdc = new THREE.Vector2();
  const aimPoint = new THREE.Vector3();
  const aimAt = (cx: number, cy: number) => {
    const r = gameCanvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    aimNdc.set(((cx - r.left) / r.width) * 2 - 1, -(((cy - r.top) / r.height) * 2 - 1));
    aimRay.setFromCamera(aimNdc, camera);
    aimRay.ray.intersectPlane(aimPlane, aimPoint);
  };
  /** the aimed point, clamped to the power's blink radius around the car */
  const clampedAim = () => {
    const r = car.power.blink ?? 22;
    const dx = aimPoint.x - car.x, dz = aimPoint.z - car.z;
    const d = Math.hypot(dx, dz);
    if (d <= r || d === 0) return { x: aimPoint.x, z: aimPoint.z };
    return { x: car.x + (dx / d) * r, z: car.z + (dz / d) * r };
  };
  const recorder = new Recorder({
    id: mapId,
    name: MAPS[mapIndex]?.name ?? mapId,
    roadHalf: world.roadHalf,
    start: world.start,
    track: world.track,
  }, { fps: params.get('rec') === '120' ? 120 : 60 });
  recorder.onEpisode = (ep) => {
    // every saved episode goes up, labelled complete/partial; guest laps stay local
    if (account.user && ep.player !== 'guest') {
      void recorder.uploadEpisode(ep).catch(() => { /* retry later */ });
    }
  };
  void sessionReady.then(() => {
    if (account.user) void recorder.uploadPending().catch(() => { /* offline */ });
  });

  const driver = params.has('demo') ? 'autopilot' : 'human';
  const lapInfo = () => ({
    carName: CAR_NAMES[car.variant] ?? `CAR ${car.variant + 1}`,
    variant: car.variant,
    power: car.power.name,
    driver,
    player: account.user?.username ?? 'guest',
    input: input.device,
  }) as const;

  const shadowTex = await loadSheet('/sprites/shadow.png');
  const carShadow = shadowPatch(shadowTex, [{ x: 0, z: 0, rot: 0, scale: 1 }], 2.7);
  (carShadow.material as THREE.MeshBasicMaterial).opacity = 0.5;
  scene.add(carShadow);

  /* ---- ghost car ----------------------------------------------------------
     The map's best lap replayed as a see-through body, paced by the running
     lap clock. Gated: visible while the server makes the feature public or
     for an admin session. ?ghost=0 is the owner's kill switch, ?ghost=1
     forces it on for visual probes. Built once, on the first visible frame. */
  const ghostParam = params.get('ghost');
  const ghostAllowed = () => ghostParam !== '0' && (ghostParam === '1' || (devOn('ghost') && playerGhost));
  let ghostModel: THREE.Group | null = null;
  let ghostFx: GhostFx | null = null;   // the ghost shows its powers, not a chip
  let ghostEventsSeen = 0;               // power marks the ghost clock has passed
  let ghostBurst = 0;                    // seconds of activation flash left
  const shadowDummy = new THREE.Object3D();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 600);
  const PITCH = THREE.MathUtils.degToRad(50);
  const CAM_DIST = 140;
  let viewHeight = params.has('overview') ? 96 : 14;
  let viewTween: { from: number; to: number; t: number } | null = null;
  const tweenView = (to: number) => { viewTween = { from: viewHeight, to, t: 0 }; };
  let speedZoom = 1;
  let camYaw = 0;
  /* chase lock: on, the camera keeps settling behind the car. Armed on every
     begin(); Q/E or a drag is manual orbit and switches it off; T re-locks. */
  let chase = false;
  const focus = new THREE.Vector3(car.x, 0, car.z);
  const desired = new THREE.Vector3();

  function layout() {
    const aspect = innerWidth / Math.max(1, innerHeight);
    const h = viewHeight * speedZoom;
    camera.left = (-h * aspect) / 2;
    camera.right = (h * aspect) / 2;
    camera.top = h / 2;
    camera.bottom = -h / 2;
    camera.updateProjectionMatrix();
  }
  function resize() {
    const w = Math.max(320, Math.round(BASE_HEIGHT * (innerWidth / Math.max(1, innerHeight))));
    renderer.setSize(w, BASE_HEIGHT, false);
    uiCanvas.width = w;
    uiCanvas.height = BASE_HEIGHT;
    layout();
  }
  addEventListener('resize', () => { resize(); ui.resize(); });
  resize();
  const ui = new PixelUI(uiCanvas, world.minimapPath, world.start);
  const sound = new Sound();
  car.onImpact = (s: number) => {
    sound.impact(s);
    recorder.noteEvent('impact', { strength: s, x: car.x, z: car.z });
  };
  let running = false;
  let laps = 0;
  let acc = 0;   // fixed-step carry; declared before begin so skip can clear it
  const begin = () => {
    if (running) return;
    // never carry a queued F/C/V/X/R press or a stored boost into a new run
    input.forget('KeyF', 'KeyC', 'KeyV', 'KeyX', 'KeyR');
    input.consumeReset();
    input.paused = false;
    car.powerTime = 0;
    car.powerCd = 0;
    car.powerCharge = 0;
    car.vx = car.vz = 0;
    car.speed = 0;
    car.steerAngle = 0;
    acc = 0;
    running = true;
    /* the default view rides behind the car: start the lock already behind it, otherwise
       a look left over from the title or the studio angle swings in over the first second */
    chase = true;
    camYaw = car.heading;
    setGantryBanner(true);
    adminPanel = false;
    recorder.beginLap({ ...lapInfo(), launch: true });
    sound.start();
  };

  const gotoMapAbs = (i: number) => {
    const m = MAPS[Math.max(0, Math.min(MAPS.length - 1, i))];
    const url = new URL(location.href);
    url.searchParams.set('map', m.id);
    location.href = url.toString();
  };
  const gotoMap = (delta: number) => {
    gotoMapAbs((mapIndex + delta + MAPS.length) % MAPS.length);
  };

  const cycleCar = (delta: number) => {
    car.setVariant(car.variant + delta);
  };

  let garage = false;
  let powerInfo = false;
  let settings = false;
  /* the full-board modal: one circuit per page so names never truncate, with
     tabs (or A/D) flipping pages and the wheel scrolling the page's rows.
     Data is fetched fresh on open; a stale copy is fine until it lands. */
  let fullBoardOpen = false;
  let fullBoardData: Record<string, { rank: number; username: string; ms: number }[]> | null = null;
  let fullScroll = 0;
  let fullPage = 0;
  const openFullBoard = () => {
    if (fullBoardOpen) { fullBoardOpen = false; return; }
    if (settings) settings = false;
    if (powerInfo) powerInfo = false;
    fullBoardOpen = true;
    fullScroll = 0;
    fullPage = 0;
    void account.fetchAllBoards().then((b) => { if (b && fullBoardOpen) fullBoardData = b; });
  };
  /* the player's ghost preference: on until they switch it off in SETTINGS,
     remembered for the next visit. The ?ghost URL param outranks it. */
  const GHOST_KEY = 'sprite-drift:ghost';
  let playerGhost = true;
  try { playerGhost = localStorage.getItem(GHOST_KEY) !== '0'; } catch { /* private mode */ }
  /* same for the title's leaderboard panel: on until a player wants a clean title */
  const BOARD_KEY = 'pixel-drift:board';
  let boardOn = true;
  try { boardOn = localStorage.getItem(BOARD_KEY) !== '0'; } catch { /* private mode */ }
  /* lifetime numbers, one bump per completed lap: laps, lap clocks summed into
     time-on-track, and laps per car for the favourite. The key is versioned:
     everything counted before the circuit gate (fcd5601) is suspect — those
     backwards-WORMHOLE laps were never real — so @2 starts everyone clean. */
  const STATS_KEY = 'pixel-drift:stats@2';
  try { localStorage.removeItem('pixel-drift:stats'); } catch { /* private mode */ }
  let statsLaps = 0;
  let statsMs = 0;
  const carLaps: Record<string, number> = {};
  try {
    const raw = JSON.parse(localStorage.getItem(STATS_KEY) ?? 'null') as
      { laps?: number; ms?: number; cars?: Record<string, number> } | null;
    statsLaps = Number(raw?.laps) || 0;
    statsMs = Number(raw?.ms) || 0;
    for (const [k, v] of Object.entries(raw?.cars ?? {})) carLaps[k] = Number(v) || 0;
  } catch { /* private mode */ }
  /* honest lap floors: track metres (server/track-data.json) at the validator's
     top speed of 72 u/s, minus the same 0.85 mercy as the circuit gate. Any
     stored best below them predates the gate and came from the
     backwards-WORMHOLE trick — it is dropped, for every player, on load */
  const LAP_FLOOR: Record<string, number> = { coast: 4230, alpine: 4960, sakura: 4840, mesa: 4740, interlagos: 18790 };
  for (const m of MAPS) {
    const floor = LAP_FLOOR[m.id];
    if (!floor) continue;
    try {
      for (const key of [`pixel-drift:best:${m.id}`, `sprite-drift:best:${m.id}`]) {
        const v = Number(localStorage.getItem(key));
        if (v > 0 && v * 1000 < floor) localStorage.removeItem(key);
      }
    } catch { /* private mode */ }
  }
  let adminPanel = false;
  let adminConfirmUntil = 0;
  let adminUploadMsg = '';
  let adminUploadUntil = 0;
  let garagePad: THREE.Mesh | null = null;
  let studioGroup: THREE.Group | null = null;
  const garageHome = { x: car.x, z: car.z, heading: car.heading };
  const STUDIO = { x: 0, z: 260 };

  const setGarage = (on: boolean) => {
    if (on === garage) return;
    garage = on;
    powerInfo = false;
    if (on) {
      garageHome.x = car.x;
      garageHome.z = car.z;
      garageHome.heading = car.heading;
      // a clean studio, far outside the circuit, so the car reads on its own
      scene.background = new THREE.Color('#f4efe6');
      car.x = STUDIO.x;
      car.z = STUDIO.z;
      car.heading = world.start.heading;
      car.vx = car.vz = 0;
      car.speed = 0;
      car.steerAngle = 0;
      car.powerTime = 0;
      car.powerCd = 0;
      car.powerCharge = 0;
      car.pitch = 0;
      car.groundY = 0.24;
      car.tilt.rotation.x = 0;
      car.trackIndex = 0;
      input.forget('KeyF', 'KeyC', 'KeyV', 'KeyX', 'KeyR');
      input.consumeReset();
      car.group.position.set(car.x, 0.24, car.z);
      car.group.rotation.y = car.heading;
      focus.set(car.x, 0, car.z);

      studioGroup = new THREE.Group();
      const floor = new THREE.Mesh(
        new THREE.CircleGeometry(22, 64),
        new THREE.MeshBasicMaterial({ color: 0xf7f2e9, toneMapped: false }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(car.x, 0, car.z);
      studioGroup.add(floor);
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(4.6, 0.05, 4, 96),
        new THREE.MeshBasicMaterial({ color: 0xdfd6c5, toneMapped: false }),
      );
      rim.rotation.x = Math.PI / 2;
      rim.position.set(car.x, 0.02, car.z);
      studioGroup.add(rim);
      scene.add(studioGroup);

      garagePad = new THREE.Mesh(
        new THREE.CylinderGeometry(3.2, 3.4, 0.24, 24),
        new THREE.MeshBasicMaterial({ color: 0x2b2d33, toneMapped: false }),
      );
      garagePad.position.set(car.x, 0.12, car.z);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(2.9, 0.06, 4, 32),
        new THREE.MeshBasicMaterial({ color: 0xf2eee1, toneMapped: false }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.25;
      garagePad.add(ring);
      scene.add(garagePad);
      tweenView(7.4);
      camYaw = 0.6;
      acc = 0;
      layout();
    } else {
      if (garagePad) {
        garagePad.traverse((o) => {
          const m = o as THREE.Mesh;
          m.geometry?.dispose();
          const mat = m.material as THREE.Material | THREE.Material[] | undefined;
          if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
          else mat?.dispose();
        });
        scene.remove(garagePad);
        garagePad = null;
      }
      scene.background = new THREE.Color(world.sky);
      if (studioGroup) {
        studioGroup.traverse((o) => {
          const m = o as THREE.Mesh;
          m.geometry?.dispose();
          const mat = m.material as THREE.Material | THREE.Material[] | undefined;
          if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
          else mat?.dispose();
        });
        scene.remove(studioGroup);
        studioGroup = null;
      }
      car.x = garageHome.x;
      car.z = garageHome.z;
      car.heading = garageHome.heading;
      car.vx = car.vz = 0;
      car.speed = 0;
      car.steerAngle = 0;
      car.powerTime = 0;
      car.powerCd = 0;
      car.powerCharge = 0;
      car.pitch = 0;
      car.groundY = 0;
      car.tilt.rotation.x = 0;
      car.trackIndex = 0;
      input.forget('KeyF', 'KeyC', 'KeyV', 'KeyX', 'KeyR');
      input.consumeReset();
      car.group.position.set(car.x, 0, car.z);
      car.group.rotation.y = car.heading;
      focus.set(car.x, 0, car.z);
      camYaw = car.heading;   // leave the studio angle: back to behind the car
      acc = 0;
      tweenView(14);
      layout();
    }
  };

  ui.onAction = (a) => {
    if (a === 'solo') { begin(); fullBoardOpen = false; }
    // the title's corner menu is the UI's own state: nothing here to switch
    else if (a === 'menu') ui.toggleMenu();
    else if (a.startsWith('pick-map-')) {
      const i = Math.min(MAPS.length - 1, Math.max(0, Number(a.slice(9)) || 0));
      if (i !== mapIndex) gotoMapAbs(i);
    }
    else if (a === 'prev-car') cycleCar(-1);
    else if (a === 'next-car') cycleCar(1);
    else if (a === 'power-info') { powerInfo = !powerInfo; if (powerInfo) fullBoardOpen = false; }
    else if (a === 'board-all') openFullBoard();
    else if (a === 'fullboard-close') fullBoardOpen = false;
    else if (a.startsWith('fb-map-')) {
      fullPage = Math.min(MAPS.length - 1, Math.max(0, Number(a.slice(7)) || 0));
      fullScroll = 0;
    }
    else if (a === 'settings') {
      settings = !settings;
      if (settings) { powerInfo = false; fullBoardOpen = false; }
    }
    else if (a === 'setting-sound') sound.toggleMute();
    else if (a === 'setting-ghost') {
      playerGhost = !playerGhost;
      ghostEventsSeen = 0;
      try { localStorage.setItem(GHOST_KEY, playerGhost ? '1' : '0'); } catch { /* private mode */ }
    }
    else if (a === 'setting-board') {
      boardOn = !boardOn;
      try { localStorage.setItem(BOARD_KEY, boardOn ? '1' : '0'); } catch { /* private mode */ }
    }
    else if (a === 'setting-car') {
      // point at the next real car and take it out for a spin on the spot
      defaultCar = (defaultCar + 1) % CAR_NAMES.length;
      car.setVariant(defaultCar);
      try { localStorage.setItem('pixel-drift:car', String(defaultCar)); } catch { /* private mode */ }
    }
    else if (a === 'setting-reset') {
      // wipes every map's local best, the current one included
      for (const m of MAPS) {
        try {
          localStorage.removeItem(`pixel-drift:best:${m.id}`);
          localStorage.removeItem(`sprite-drift:best:${m.id}`);
        } catch { /* private mode */ }
      }
      bestTime = 0;
      note('BESTS CLEARED');
    }
    else if (a === 'garage') setGarage(true);
    else if (a === 'garage-back') setGarage(false);
    else if (a === 'login') loginForm.open();
    else if (a === 'logout') void account.logout();
    else if (a === 'admin') {
      adminPanel = true;
      adminConfirmUntil = 0;
      void account.refresh(mapId);
    }
    else if (a === 'admin-close') {
      adminPanel = false;
      adminConfirmUntil = 0;
    }
    else if (a === 'admin-dashboard') {
      window.open('/dashboard.html', '_blank', 'noopener');
    }
    else if (a === 'admin-upload') {
      const started = performance.now() / 1000;
      adminUploadMsg = 'UPLOADING…';
      adminUploadUntil = started + 20;
      void recorder.upload()
        .then((r) => {
          adminUploadMsg = `SENT ${r.episodes} EPISODES`;
          adminUploadUntil = performance.now() / 1000 + 5;
        })
        .catch(() => {
          adminUploadMsg = 'UPLOAD FAILED';
          adminUploadUntil = performance.now() / 1000 + 5;
        });
    }
    else if (a === 'admin-clear') {
      const now = performance.now() / 1000;
      if (now < adminConfirmUntil) {
        adminConfirmUntil = 0;
        void account.adminClearMap(mapId).then((r) => {
          if (!r.ok) warn(r.error ?? 'CLEAR FAILED');
        });
      } else {
        adminConfirmUntil = now + 3;
      }
    }
    else if (a.startsWith('admin-del-')) {
      const i = Number(a.slice('admin-del-'.length));
      const name = account.times[i]?.username;
      if (name) {
        void account.adminDeleteTime(mapId, name).then((r) => {
          if (!r.ok) warn(r.error ?? 'DELETE FAILED');
        });
      }
    }
  };

  const input = new Input();
  if (params.has('skip') || params.has('demo')) begin();

  // keep the title board fresh (and recover from a transient API restart)
  const refreshBoard = () => {
    if (!running && !loginForm.isOpen()) void account.refresh(mapId);
  };
  addEventListener('focus', refreshBoard);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshBoard();
  });

  addEventListener('pointerdown', (e) => {
    if (loginForm.isOpen()) return;
    const hit = ui.hit(e.clientX, e.clientY);
    if (!hit) return;
    if (running) {                 // mid-race the only wired chip is the menu
      if (hit === 'menu') backToTitle();
      return;
    }
    ui.onAction?.(hit);   // only the PLAY button starts a race
  });
  addEventListener('keydown', (e) => {
    if (loginForm.isOpen()) return;   // the form handles its own keys
    /* session keys are single-shot: key auto-repeat would storm them */
    const fresh = !e.repeat;
    /* pause is handled here rather than in Input so a held key cannot toggle it on
       every repeat and the wrap is checked before the state flips: Esc closes the
       wrap, P pauses it, and a pause already on outranks the wrap either way */
    if (fresh && (e.code === 'Escape' || e.code === 'KeyP')) {
      if (e.code === 'Escape' && car.aiming && !input.paused) { car.cancelAim(); return; }
      if (running || input.paused) { input.paused = !input.paused; return; }
    }
    if (car.aiming && fresh) {
      if (e.code === 'Enter') { placeWormhole(); return; }
      return;   // while the wrap is open, other session keys wait
    }
    if (fresh && e.code === 'KeyM') { backToTitle(); return; }
    if (fresh && e.code === 'KeyC' && !started && !input.paused) { switchCarAtLine(); return; }
    if (fresh && e.code === 'KeyT' && running && !garage && !input.paused) {
      // T is the camera switch both ways: free the view, or lock it back behind
      // the car on the spot (a re-lock that swings in over a second reads broken)
      chase = !chase;
      if (chase) camYaw = car.heading;
      return;
    }
    if (!running && garage) {
      if (e.code === 'Enter') { setGarage(false); return; }
      if (e.code === 'ArrowUp') { cycleCar(1); return; }
      if (e.code === 'ArrowDown') { cycleCar(-1); return; }
      return;
    }
    if (!running && (e.code === 'Space' || e.code === 'Enter')) { begin(); return; }
    if (!running) {
      if (e.code === 'ArrowLeft') { gotoMap(-1); return; }
      if (e.code === 'ArrowRight') { gotoMap(1); return; }
      // number keys jump straight to a circuit, matching the on-screen tabs
      if (e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(5));
        if (n >= 1 && n <= MAPS.length) { gotoMapAbs(n - 1); return; }
      }
      if (e.code === 'ArrowUp') { cycleCar(1); return; }
      if (e.code === 'ArrowDown') { cycleCar(-1); return; }
    }
  });

  /** confirm an aimed TUNNEL placement and stamp the lap trace */
  const placeWormhole = () => {
    if (!car.aiming) return;
    const a = clampedAim();
    if (car.confirmAim(world, a.x, a.z)) {
      recorder.markPower();
      recorder.noteEvent('power');
      lapTrace.push({
        x: +car.x.toFixed(2), z: +car.z.toFixed(2), h: +car.heading.toFixed(2),
        t: Math.round(lapTime * 1000), e: 'blink',
      });
    }
  };

  // drag to orbit (or click to place while the wrap is open)
  let dragging = false, lastX = 0;
  gameCanvas.addEventListener('pointerdown', (e) => {
    if (car.aiming) {
      if (ui.hit(e.clientX, e.clientY) === 'menu') { car.cancelAim(); backToTitle(); return; }
      aimAt(e.clientX, e.clientY);
      placeWormhole();
      e.stopPropagation();
      return;
    }
    dragging = true; lastX = e.clientX;
    gameCanvas.setPointerCapture(e.pointerId);
  });
  gameCanvas.addEventListener('pointerup', () => { dragging = false; });
  gameCanvas.addEventListener('pointermove', (e) => {
    if (car.aiming) { aimAt(e.clientX, e.clientY); return; }
    if (!dragging) return;
    chase = false;   // a drag is manual orbit
    camYaw -= (e.clientX - lastX) * 0.008;
    lastX = e.clientX;
  });
  const puffCanvas = document.createElement('canvas');
  puffCanvas.width = puffCanvas.height = 16;
  {
    const g = puffCanvas.getContext('2d')!;
    const grd = g.createRadialGradient(8, 8, 1, 8, 8, 8);
    grd.addColorStop(0, 'rgba(255,255,255,0.85)');
    grd.addColorStop(0.65, 'rgba(255,255,255,0.3)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 16, 16);
  }
  const puffTex = new THREE.CanvasTexture(puffCanvas);
  puffTex.magFilter = THREE.NearestFilter;
  const puffs: { sprite: THREE.Sprite; life: number; max: number; vx: number; vz: number; vy: number }[] = [];
  for (let i = 0; i < 56; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: puffTex, transparent: true, depthWrite: false, toneMapped: false, opacity: 0,
    }));
    sprite.visible = false;
    scene.add(sprite);
    puffs.push({ sprite, life: 0, max: 1, vx: 0, vz: 0, vy: 0 });
  }
  let puffCursor = 0;
  const puff = (x: number, z: number, vx: number, vz: number, dirt: boolean) => {
    const p = puffs[puffCursor++ % puffs.length];
    p.life = p.max = 0.45 + Math.random() * 0.4;
    p.vx = vx + (Math.random() - 0.5) * 1.3;
    p.vz = vz + (Math.random() - 0.5) * 1.3;
    p.vy = 0.3 + Math.random() * 0.8;
    p.sprite.position.set(x, 0.15, z);
    p.sprite.visible = true;
    p.sprite.scale.setScalar(0.45 + Math.random() * 0.35);
    const m = p.sprite.material as THREE.SpriteMaterial;
    m.color.set(dirt ? '#c8b98f' : '#b9b3a6');
    m.opacity = 0.6;
  };
  const track = world.track;
  let nearest = 0, progress = 0, lapTime = 0, started = false;
  let prevU = 0;
  const bestKey = `pixel-drift:best:${mapId}`;
  let bestTime = Number(
    localStorage.getItem(bestKey) ?? localStorage.getItem(`sprite-drift:best:${mapId}`) ?? 0,
  ) || 0;

  /* ---- lap trace -----------------------------------------------------------
     Samples are kept for the on-screen replay and the local trace API; the
     server validates the trace (server/anticheat.mjs) before the board takes
     the lap. */
  let lapTrace: LapTracePoint[] = [];
  let lastTrace: LapTracePoint[] = [];
  let traceIn = 0;
  let warning = '';
  let warningUntil = 0;
  let notice = '';
  let noticeUntil = 0;
  const warn = (text: string, sec = 2.8) => {
    warning = text;
    warningUntil = performance.now() / 1000 + sec;
  };
  const note = (text: string, sec = 2.6) => {
    notice = text;
    noticeUntil = performance.now() / 1000 + sec;
  };
  // the lap bar at the bottom of the HUD: armed the instant a lap completes,
  // independent of whether the server later accepts the trace
  let lapBar: { ms: number; pb: boolean; delta: number | null } | null = null;
  let lapBarUntil = 0;
  // laps that never reached the board (offline, redeploy, expired session)
  // are kept client-side and sent again here
  const flushLaps = () => {
    void account.flushPending().then((late) => {
      if (late > 0) note(`${late} LAP${late === 1 ? '' : 'S'} SAVED LATE`);
    });
  };
  const resetTrace = () => {
    lapTrace = [];
    traceIn = 0;
  };

  let startIdx = 0;
  const nearestIndex = (x: number, z: number) => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < track.length; i++) {
      const d = (track[i].x - x) ** 2 + (track[i].z - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };
  /** Local search keeps a figure-eight from flipping to the other lobe. */
  const nearestIndexNear = (x: number, z: number, guess: number) => {
    const n = track.length;
    let best = guess, bd = Infinity;
    for (let k = -60; k <= 60; k++) {
      const i = ((guess + k) % n + n) % n;
      const d = (track[i].x - x) ** 2 + (track[i].z - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return bd > 30 * 30 ? nearestIndex(x, z) : best;
  };
  startIdx = nearestIndex(world.start.x, world.start.z);
  nearest = startIdx;
  prevU = ((nearestIndex(car.x, car.z) - startIdx + track.length) % track.length) / track.length;

  const resetRaceLocal = () => {
    car.reset(world);
    world.clearSkid();
    progress = 0;
    lapTime = 0;
    started = false;
    laps = 0;
    resetTrace();
    warning = '';
    warningUntil = 0;
    notice = '';
    noticeUntil = 0;
    nearest = nearestIndex(car.x, car.z);
    prevU = ((nearest - startIdx + track.length) % track.length) / track.length;
  };

  /* C before the lap timer starts: swap cars without leaving the map. The
     open launch episode is closed and reopened so a recording never labels
     one car as another. */
  const switchCarAtLine = () => {
    if (running && !started) {
      recorder.noteEvent('car', { x: car.x, z: car.z });
      recorder.endLap(0, false);
    }
    cycleCar(1);
    if (running && !started) recorder.beginLap({ ...lapInfo(), launch: true });
  };

  /* M at any time: abandon the run mid-lap or not and go back to the title. */
  const backToTitle = () => {
    if (garage) setGarage(false);
    if (!running && !started) return;   // already parked on the title
    recorder.noteEvent('menu');
    recorder.endLap(0, false);           // the lap in progress is a partial
    resetRaceLocal();
    running = false;
    setGantryBanner(false);             // the title lockup owns the gantry again
    adminPanel = false;
    input.paused = false;
    input.look = 0;                     // a held look key would drag the title view
    chase = false;
    acc = 0;
    input.forget('KeyF', 'KeyC', 'KeyV', 'KeyX', 'KeyR');
    tweenView(overview ? 96 : 14);
    void account.refresh(mapId);        // fresh board, like boot
  };

  const autopilot = () => {
    const n = track.length;
    const ahead = 40 + Math.round(Math.abs(car.speed) * 2.2);
    const target = track[(nearest + ahead) % n];
    const dx = target.x - car.x, dz = target.z - car.z;
    const want = Math.atan2(-dx, -dz);
    let err = want - car.heading;
    err = Math.atan2(Math.sin(err), Math.cos(err));
    const sharp = Math.abs(err) > 0.55;
    return {
      steer: THREE.MathUtils.clamp(err * 2.4, -1, 1),
      throttle: sharp ? 0.55 : 1,
      handbrake: Math.abs(err) > 0.85 && Math.abs(car.speed) > 14,
    };
  };

  // dev hook: fast-forward the autopilot so screenshots show a real driving state
  const fast = Number(params.get('fast') || 0);
  if (fast > 0) {
    let ft = 0;
    for (let i = 0; i < fast * 120; i++) {
      nearest = nearestIndex(car.x, car.z);
      car.update(1 / 120, params.has('demo') ? autopilot() : { throttle: 1, steer: 0, handbrake: false }, world);
      const at = nearestIndex(car.x, car.z);
      let d = at - nearest;
      if (d > track.length / 2) d -= track.length;
      if (d < -track.length / 2) d += track.length;
      progress += d / track.length;
      nearest = at;
      ft += 1 / 120;
      if (progress >= 1) {
        progress -= 1;
        laps++;
        console.log(`SIM lap ${laps}: ${ft.toFixed(2)}s best ${Math.min(bestTime || 1e9, ft).toFixed(2)}`);
        ft = 0;
      }
    }
    lapTime = ft;
  }
  let last = performance.now() / 1000;
  const STEP = 1 / 120;
  let dustTimer = 0;

  const frame = () => {
    requestAnimationFrame(frame);
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, now - last);
    last = now;

    const controls = !running ? { throttle: 0, steer: 0, handbrake: false }
      : params.has('demo') ? autopilot() : input.read();
    /* chase lock: settle camYaw behind the car (car forward is
       (-sin h, -cos h), so the camera yaw matches the heading), shortest way
       round; Q/E takes over as manual look and drops the lock */
    if (chase && input.look !== 0) chase = false;
    if (chase && running && !garage && !overview) {
      let d = car.heading - camYaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      // soft when parked, tighter the faster the car goes
      const rate = 1.7 + 3.1 * Math.min(1, Math.abs(car.speed) / 24);
      camYaw += d * (1 - Math.exp(-dt * rate));
    }
    camYaw += input.look * dt * 1.8;
    if (input.zoom !== 0) {
      if (fullBoardOpen) {
        // the wheel belongs to the full board: scroll the page's rows only
        const rows = fullBoardData?.[MAPS[fullPage]?.id]?.length ?? 0;
        fullScroll = Math.max(0, Math.min(fullScroll + Math.round(input.zoom / 0.0015) * 2, Math.max(0, rows - 22)));
      } else {
        viewTween = null;   // the wheel wins over the garage transition
        viewHeight = THREE.MathUtils.clamp(viewHeight * (1 + input.zoom), 13, 40);
        layout();
      }
      input.zoom = 0;
    }
    if (viewTween) {
      viewTween.t = Math.min(1, viewTween.t + dt / 0.45);
      const k = 1 - Math.pow(1 - viewTween.t, 3);
      viewHeight = viewTween.from + (viewTween.to - viewTween.from) * k;
      layout();
      if (viewTween.t >= 1) viewTween = null;
    }

    if (!input.paused) {
      if (garage) {
        car.group.rotation.y += dt * 0.65;
        car.group.position.set(car.x, 0.24, car.z);
      } else if (car.aiming) {
        /* the wrap is open: the sim freezes while the aim disc tracks the pointer */
        input.forget('KeyF', 'KeyV', 'KeyX', 'KeyR');
        aimUI.place(car.x, car.z, car.heading);
        aimUI.marker(aimPoint.x, aimPoint.z);
        aimUI.show(true);
      } else {
        aimUI.show(false);
        acc += dt;
        let steps = 0;
        while (acc >= STEP && steps++ < 6) {
          car.update(STEP, controls, world);
          acc -= STEP;
          const ti = car.trackIndex;
          const tp = track[ti] ?? track[0];
          recorder.tick(STEP, car, controls, {
            progress: ((ti - startIdx + track.length) % track.length) / track.length,
            trackDist: Math.hypot(car.x - tp.x, car.z - tp.z),
          });
        }
        if (input.consumeKey('KeyF') && running) {
          const fired = car.activatePower(world);
          if (fired && !car.power.aim) {
            recorder.markPower();
            recorder.noteEvent('power');
            if (started) {
              // WORMHOLE lands the car instantly: mark the placement frame so
              // the server can tell an aimed placement from a forged teleport
              const mark = car.power.blink ? 'blink' : 'power';
              lapTrace.push({ x: +car.x.toFixed(2), z: +car.z.toFixed(2), h: +car.heading.toFixed(2), t: Math.round(lapTime * 1000), e: mark });
              if (lapTrace.length > 600) lapTrace.splice(1, 1);
            }
          }
        }
        if (input.consumeKey('KeyV')) {
          // silent by design: nothing on screen mentions the recorder
          recorder.setEnabled(!recorder.on);
        }
        if (input.consumeKey('KeyL') && !running && !garage) openFullBoard();
        if (fullBoardOpen && !running) {
          // A/D flip the full board's pages while it's up on the title screen
          if (input.consumeKey('KeyA')) { fullPage = (fullPage - 1 + MAPS.length) % MAPS.length; fullScroll = 0; }
          if (input.consumeKey('KeyD')) { fullPage = (fullPage + 1) % MAPS.length; fullScroll = 0; }
        }
        if (input.consumeKey('KeyX')) {
          void recorder.download()
            .then((n) => console.log(`runs exported: ${n} laps`))
            .catch(() => console.warn('run export failed'));
        }
        if (input.consumeReset()) {
          recorder.noteEvent('reset');
          recorder.endLap(0, false);
          resetRaceLocal();
          recorder.beginLap({ ...lapInfo(), launch: true });
        }
      }
    }

    if (!account.user || account.user.role !== 'admin') adminPanel = false;
    const idx = nearestIndexNear(car.x, car.z, nearest);
    const np = track[idx];
    const trackDist = Math.hypot(car.x - np.x, car.z - np.z);
    car.onKerb = car.onRoad && trackDist > world.roadHalf - 1.0;
    const u = ((idx - startIdx + track.length) % track.length) / track.length;
    // signed forward travel along the circuit: a legit lap accrues ~1.0 by
    // the time it crosses the line; a WORMHOLE aimed backwards past the line
    // takes out what it wants to hand back, and the 0.85 below refuses it
    let dIdx = idx - nearest;
    if (dIdx > track.length / 2) dIdx -= track.length;
    if (dIdx < -(track.length / 2)) dIdx += track.length;
    progress += dIdx / track.length;
    // a lap is one full forward circuit: the server always rejected a
    // backwards-placement "lap", and now the client does not hand it a PB,
    // the lap bar or the lifetime stats either
    const crossed = started && prevU > 0.8 && u < 0.2 && progress > 0.85;
    prevU = u;
    nearest = idx;
    car.trackIndex = idx;
    if (!started && Math.hypot(car.x - world.start.x, car.z - world.start.z) > 5) {
      started = true;
      resetTrace();
      lapTrace.push({ x: car.x, z: car.z, t: 0, h: car.heading });
    }
    if (started && !car.aiming && !input.paused) {
      lapTime += dt;
      recorder.beginLap(lapInfo());
    }

    // samples the replay trace; the server validates it on submit
    if (started && !input.paused) {
      traceIn -= dt;
      if (traceIn <= 0) {
        traceIn = 0.2;
        lapTrace.push({ x: +car.x.toFixed(2), z: +car.z.toFixed(2), h: +car.heading.toFixed(2), t: Math.round(lapTime * 1000) });
        if (lapTrace.length > 600) lapTrace.splice(1, 1);
      }
    }

    if (crossed) {
      const ms = Math.round(lapTime * 1000);
      lapTrace.push({ x: car.x, z: car.z, t: ms, h: car.heading });
      lastTrace = lapTrace.slice();
      const prevBest = bestTime;
      lapBar = {
        ms,
        pb: prevBest === 0 || lapTime < prevBest,
        delta: prevBest > 0 ? Math.round((lapTime - prevBest) * 1000) : null,
      };
      lapBarUntil = performance.now() / 1000 + 4;
      if (bestTime === 0 || lapTime < bestTime) {
        bestTime = lapTime;
        try { localStorage.setItem(bestKey, String(bestTime)); } catch { /* private mode */ }
      }
      const trace = lapTrace.slice();
      const info = lapInfo();
      // the lap's input activity rides along for the server's bot gate: a lap
      // driven with no steering at all is not a human lap
      const proof = recorder.lapProof();
      void account.submitLap(ms, trace, mapId, { car: info.carName, variant: info.variant, proof }).then((r) => {
        if (!account.user) warn('SIGN IN TO SAVE LAPS', 2.2);
        else if (!r.ok) warn(r.error ?? 'LAP NOT SAVED');
        else if (r.rank) note(`LAP SAVED · RANK ${r.rank}`);
        else if (r.improved) note('LAP SAVED');
        else note('LAP SAVED · BEST KEPT');
        if (r.ok) flushLaps();   // an older lap may still be waiting
      });
      laps++;
      console.log(`lap ${laps} ${(ms / 1000).toFixed(2)}s`);
      lapTime = 0;
      progress -= 1;
      resetTrace();
      recorder.endLap(ms, true);
      recorder.beginLap(lapInfo());
      // lifetime stats: one lap, its clock, one tick for the car that drove it
      statsLaps++; statsMs += ms;
      const carName = CAR_NAMES[car.variant] ?? 'PEARL GT';
      carLaps[carName] = (carLaps[carName] ?? 0) + 1;
      try { localStorage.setItem(STATS_KEY, JSON.stringify({ laps: statsLaps, ms: statsMs, cars: carLaps })); }
      catch { /* private mode */ }
    }
    world.update();

    dustTimer -= dt;
    if (dustTimer <= 0 && Math.abs(car.speed) > 4) {
      if (car.drifting || (!car.onRoad && Math.abs(car.speed) > 7)) {
        dustTimer = car.drifting ? 0.035 : 0.07;
        const fx = -Math.sin(car.heading), fz = -Math.cos(car.heading);
        const rx = Math.cos(car.heading), rz = -Math.sin(car.heading);
        puff(car.x - fx * 1.1 + rx * 0.6, car.z - fz * 1.1 + rz * 0.6, -car.vx * 0.1, -car.vz * 0.1, !car.onRoad);
        puff(car.x - fx * 1.1 - rx * 0.6, car.z - fz * 1.1 - rz * 0.6, -car.vx * 0.1, -car.vz * 0.1, !car.onRoad);
      }
    }
    for (const p of puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.sprite.visible = false; continue; }
      p.sprite.position.x += p.vx * dt;
      p.sprite.position.z += p.vz * dt;
      p.sprite.position.y += p.vy * dt;
      p.sprite.scale.multiplyScalar(1 + dt * 1.5);
      (p.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, (p.life / p.max) * 0.5);
    }

    const wantZoom = 1 + Math.min(0.14, Math.abs(car.speed) * 0.0048);
    speedZoom += (wantZoom - speedZoom) * (1 - Math.exp(-dt * 2.5));
    layout();

    desired.set(
      overview ? 0 : car.x + car.vx * 0.3,
      overview ? 0 : car.groundY * 0.7,
      overview ? 0 : car.z + car.vz * 0.3,
    );
    focus.lerp(desired, 1 - Math.exp(-dt * 7));
    const cx = Math.sin(camYaw) * Math.cos(PITCH) * CAM_DIST;
    const cz = Math.cos(camYaw) * Math.cos(PITCH) * CAM_DIST;
    camera.position.set(focus.x + cx, Math.sin(PITCH) * CAM_DIST, focus.z + cz);
    camera.lookAt(focus.x, focus.y, focus.z);

    shadowDummy.position.set(car.x + 0.22, car.groundY + 0.016, car.z + 0.26);
    shadowDummy.rotation.set(0, car.heading, 0);
    shadowDummy.scale.set(1, 1, 1.3);
    shadowDummy.updateMatrix();
    carShadow.setMatrixAt(0, shadowDummy.matrix);
    carShadow.instanceMatrix.needsUpdate = true;

    /* the ghost rides the same lap clock: no clock, no ghost */
    const ghostLap = account.map === mapId ? account.ghost : null;
    const ghostShown = !!ghostLap && ghostAllowed()
      && running && started && !input.paused && !garage && !car.aiming;
    /* lines recorded before traces carried headings still need a true nose:
       the circuit's tangent where the ghost sits, never a hairpin chord */
    const ghostTangent = (x: number, z: number): number | null => {
      const i = nearestIndexNear(x, z, nearest);
      const a = track[i], b = track[(i + 1) % track.length];
      if (!a || !b) return null;
      return Math.atan2(-(b.x - a.x), -(b.z - a.z));
    };
    const ghostPowers = ghostShown ? ghostEvents(ghostLap!.trace) : [];
    let ghostPowerName: string | undefined;
    if (ghostShown) {
      const g = ghostLap!;
      const gv = typeof g.variant === 'number' ? g.variant : 0;
      if (!ghostModel) {
        ghostModel = buildGhostModel(gv);
        ghostFx = new GhostFx(ghostModel, gv);
        scene.add(ghostModel);
      }
      const s = sampleGhost(g.trace, lapTime * 1000, ghostTangent);
      ghostModel.visible = s !== null;
      if (s) {
        ghostModel.position.set(s.x, 0, s.z);
        ghostModel.rotation.y = s.heading;
      }
      // the record's powers replay on the ghost body itself: the clock inside
      // a mark's window lights the rig up, a freshly crossed mark flashes it
      const tMs = lapTime * 1000;
      const hold = (CAR_POWERS[gv]?.duration ?? 0) * 1000;
      const on = ghostPowers.some((ev) =>
        tMs >= ev.t && tMs < ev.t + (ev.e === 'blink' ? 500 : hold));
      ghostPowerName = on ? (CAR_POWERS[gv]?.name ?? 'POWER') : undefined;
      const passed = ghostPowers.filter((ev) => ev.t <= tMs).length;
      if (passed > ghostEventsSeen) ghostBurst = 0.38;
      ghostEventsSeen = passed;
      ghostFx?.update(dt, on, ghostBurst);
    } else if (ghostModel) {
      ghostModel.visible = false;
    }
    ghostBurst = Math.max(0, ghostBurst - dt);

    renderer.render(scene, camera);
    ui.draw({
      car, lapTime: started ? lapTime : 0, bestTime, started: running,
      paused: input.paused, laps,
      atLine: running && !started,
      camLocked: chase,
      aiming: car.aiming,
      maps: MAPS.map((m) => ({ id: m.id, name: m.name })),
      carNames: CAR_NAMES,
      carStatRows: carStatRows(car.variant),
      power: {
        name: car.power.name,
        active: car.powerActive,
        ready: car.powerReady,
        cd: car.powerCd,
        time: car.powerTime,
        duration: car.power.duration,
        cooldown: car.power.cooldown,
        color: powerColour(car.variant),
        charge: car.power.exitBoost ? Math.min(1, car.powerCharge / 40) : undefined,
      },
      warning: warning && now < warningUntil ? warning : undefined,
      notice: notice && now < noticeUntil ? notice : undefined,
      lapBar: devOn('lapbar') && lapBar && now < lapBarUntil && started
        ? { ...lapBar, a: Math.max(0, Math.min(1, (lapBarUntil - now) / 0.5)) }
        : undefined,
      offTrack: started && trackDist > world.roadHalf + 1.2,
      ghostPower: ghostPowerName,
      mapIndex,
      mapName: MAPS[mapIndex]?.name,
      account,
      adminPanel: adminPanel && account.user?.role === 'admin',
      adminConfirm: now / 1000 < adminConfirmUntil,
      adminUpload: now / 1000 < adminUploadUntil ? adminUploadMsg : undefined,
      garage,
      settings,
      settingsRows: [
        { name: 'sound', label: 'SOUND', on: !sound.muted },
        { name: 'ghost', label: 'GHOST CAR', on: ghostAllowed() },
        { name: 'board', label: 'LEADERBOARD', on: boardOn },
        { name: 'car', label: 'DEFAULT CAR', on: true, value: CAR_NAMES[defaultCar] ?? 'PEARL GT' },
      ],
      stats: (() => {
        // the board is the source of truth: a signed-in player's bests are
        // the anticheat-validated times off their account, not whatever the
        // browser still has in local storage. Signed out (or a map they
        // never submitted): fall back to the local lap records.
        const maps = MAPS.map((m) => {
          const server = account.bests?.[m.id];
          const local = Number(
            localStorage.getItem(`pixel-drift:best:${m.id}`)
              ?? localStorage.getItem(`sprite-drift:best:${m.id}`) ?? 0,
          ) || 0;
          return { map: m.id.toUpperCase(), best: server != null ? server / 1000 : local };
        });
        const bests = maps.filter((m) => m.best > 0).map((m) => m.best);
        const fav = Object.entries(carLaps).sort((a, b) => b[1] - a[1])[0];
        return {
          maps,
          pbAvg: bests.length ? bests.reduce((a, b) => a + b) / bests.length : 0,
          laps: statsLaps,
          driveMs: statsMs,
          favCar: fav?.[0] ?? '—',
        };
      })(),
      board: boardOn,
      fullBoard: fullBoardOpen ? {
        maps: MAPS.map((m) => ({
          id: m.id,
          name: m.name,
          rows: fullBoardData?.[m.id] ?? [],
        })),
        scroll: fullScroll,
        page: fullPage,
        offline: account.offline,
        me: (account.user?.username ?? '').toUpperCase(),
      } : undefined,
      powerInfo,
      powerBlurb: car.power.blurb,
      powerEffect: car.power.effect,
      powerDuration: car.power.duration,
      powerCooldown: car.power.cooldown,
    }, now);
    /* the ui just told us where the garage's demo window landed; the clip goes
       exactly there, and steps aside the moment there is no window */
    garageClip.place(ui.demoWindow, car.variant);
    sound.update(car, controls.throttle, input.paused);
  };
  frame();
  void sessionReady.then(() => { if (account.user) flushLaps(); });

  (window as unknown as { game: unknown }).game = {
    car, world, camera, renderer, scene, account, recorder, ui,
    get laps() { return laps; },
    get lapTime() { return lapTime; },
    get started() { return started; },
    get running() { return running; },
    get chase() { return chase; },
    get trace() { return lapTrace; },
    get lastTrace() { return lastTrace; },
    get warning() { return warning; },
    get ghost() { return ghostModel; },
    get ghostOn() { return ghostAllowed(); },
  };
}

boot().catch((e) => {
  console.error(e);
  bootError.textContent = e instanceof Error ? (e.stack ?? String(e)) : String(e);
  bootError.style.display = 'block';
});
