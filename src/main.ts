import * as THREE from 'three';
import { buildWorld, MAPS } from './world';
import { Car } from './car';
import { Input } from './input';
import { PixelUI } from './pixelui';
import { loadSheet, shadowPatch } from './stack';
import type { StackDef } from './stack';
import { Sound } from './sound';

const gameCanvas = document.getElementById('game') as HTMLCanvasElement;
const uiCanvas = document.getElementById('ui') as HTMLCanvasElement;
const bootError = document.getElementById('boot-error') as HTMLDivElement;

const BASE_HEIGHT = 360;
const CAR_DEF: StackDef = { layers: 17, sheetW: 28, sheetH: 53, worldW: 2.0, lift: 0.072 };

async function boot() {
  const params = new URLSearchParams(location.search);
  const renderer = new THREE.WebGLRenderer({ canvas: gameCanvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#4e7a45');

  const mapId = params.get('map') || MAPS[0].id;
  const world = await buildWorld(scene, mapId);
  const mapIndex = Math.max(0, MAPS.findIndex((m) => m.id === mapId));
  const car = await new Car().init(world);
  scene.add(car.group);

  const shadowTex = await loadSheet('/sprites/shadow.png');
  const carShadow = shadowPatch(shadowTex, [{ x: 0, z: 0, rot: 0, scale: 1 }], 2.7);
  (carShadow.material as THREE.MeshBasicMaterial).opacity = 0.5;
  scene.add(carShadow);
  const shadowDummy = new THREE.Object3D();

  // ---- camera ---------------------------------------------------------------
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 600);
  const PITCH = THREE.MathUtils.degToRad(50);
  const CAM_DIST = 140;
  let viewHeight = 17;
  let speedZoom = 1;
  let camYaw = 0;
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

  // ---- ui + net ------------------------------------------------------------
  const ui = new PixelUI(uiCanvas, world.minimapPath);
  const sound = new Sound();
  let running = false;
  let laps = 0;


  const begin = () => {
    if (running) return;
    running = true;
    sound.start();
  };
  car.setSkin('car-a');

  const gotoMap = (delta: number) => {
    const m = MAPS[(mapIndex + delta + MAPS.length) % MAPS.length];
    const url = new URL(location.href);
    url.searchParams.set('map', m.id);
    location.href = url.toString();
  };

  ui.onAction = (a) => {
    if (a === 'solo') begin();
    else if (a === 'prev-map') gotoMap(-1);
    else if (a === 'next-map') gotoMap(1);
  };

  const input = new Input(() => begin());
  if (params.has('skip') || params.has('demo')) begin();

  addEventListener('pointerdown', (e) => {
    if (running) return;
    const hit = ui.hit(e.clientX, e.clientY);
    if (hit) ui.onAction?.(hit);
    else begin();
  });
  addEventListener('keydown', (e) => {
    if (!running && (e.code === 'Space' || e.code === 'Enter')) begin();
  });

  // drag to orbit
  let dragging = false, lastX = 0;
  gameCanvas.addEventListener('pointerdown', (e) => {
    dragging = true; lastX = e.clientX;
    gameCanvas.setPointerCapture(e.pointerId);
  });
  gameCanvas.addEventListener('pointerup', () => { dragging = false; });
  gameCanvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    camYaw -= (e.clientX - lastX) * 0.008;
    lastX = e.clientX;
  });

  // ---- dust ----------------------------------------------------------------
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

  // ---- lap timing ----------------------------------------------------------
  const track = world.track;
  let nearest = 0, progress = 0, lapTime = 0, started = false;
  const bestKey = `sprite-drift:best:${mapId}`;
  let bestTime = Number(localStorage.getItem(bestKey) || 0) || 0;

  const nearestIndex = (x: number, z: number) => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < track.length; i++) {
      const d = (track[i].x - x) ** 2 + (track[i].z - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };

  const autopilot = () => {
    const n = track.length;
    const ahead = 24 + Math.round(Math.abs(car.speed) * 1.5);
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

  // ---- loop ----------------------------------------------------------------
  let last = performance.now() / 1000;
  let acc = 0;
  const STEP = 1 / 120;
  let dustTimer = 0;
  let netTimer = 0;

  const frame = () => {
    requestAnimationFrame(frame);
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, now - last);
    last = now;

    const controls = params.has('demo') ? autopilot() : input.read();
    camYaw += input.look * dt * 1.8;
    if (input.zoom !== 0) {
      viewHeight = THREE.MathUtils.clamp(viewHeight * (1 + input.zoom), 13, 40);
      input.zoom = 0;
      layout();
    }

    if (!input.paused) {
      acc += dt;
      let steps = 0;
      while (acc >= STEP && steps++ < 6) {
        car.update(STEP, controls, world);
        acc -= STEP;
      }
      if (input.consumeReset()) {
        car.reset(world);
        world.clearSkid();
        progress = 0; lapTime = 0; started = false; laps = 0;
        nearest = nearestIndex(car.x, car.z);
      }
    }

    const idx = nearestIndex(car.x, car.z);
    let d = idx - nearest;
    if (d > track.length / 2) d -= track.length;
    if (d < -track.length / 2) d += track.length;
    progress += d / track.length;
    nearest = idx;
    if (!started && Math.hypot(car.x - world.start.x, car.z - world.start.z) > 5) started = true;
    if (started) lapTime += dt;
    if (progress >= 1) {
      if (lapTime > 8 && (bestTime === 0 || lapTime < bestTime)) {
        bestTime = lapTime;
        try { localStorage.setItem(bestKey, String(bestTime)); } catch { /* private mode */ }
      }
      lapTime = 0;
      progress -= 1;
      laps++;
      console.log(`lap ${laps} ${lapTime.toFixed(2)}s`);
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

    desired.set(car.x + car.vx * 0.3, 0, car.z + car.vz * 0.3);
    focus.lerp(desired, 1 - Math.exp(-dt * 7));
    const cx = Math.sin(camYaw) * Math.cos(PITCH) * CAM_DIST;
    const cz = Math.cos(camYaw) * Math.cos(PITCH) * CAM_DIST;
    camera.position.set(focus.x + cx, Math.sin(PITCH) * CAM_DIST, focus.z + cz);
    camera.lookAt(focus.x, 0, focus.z);

    car.model.quaternion.copy(camera.quaternion);

    shadowDummy.position.set(car.x + 0.22, 0.016, car.z + 0.26);
    shadowDummy.rotation.set(0, car.heading, 0);
    shadowDummy.scale.set(1, 1, 1.3);
    shadowDummy.updateMatrix();
    carShadow.setMatrixAt(0, shadowDummy.matrix);
    carShadow.instanceMatrix.needsUpdate = true;

    renderer.render(scene, camera);
    ui.draw({
      car, lapTime: started ? lapTime : 0, bestTime, started: running,
      paused: input.paused, throttle: controls.throttle, laps,
      maps: MAPS.map((m) => ({ id: m.id, name: m.name })),
      mapIndex,
      mapName: MAPS[mapIndex]?.name,
    }, now);
    sound.update(car, controls.throttle, input.paused);
  };
  frame();

  (window as unknown as { game: unknown }).game = { car, world, camera, renderer, scene };
}

boot().catch((e) => {
  console.error(e);
  bootError.textContent = String(e);
  bootError.style.display = 'block';
});
