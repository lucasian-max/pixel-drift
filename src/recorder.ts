/* src/recorder.ts — records driving runs as imitation-learning data.
 *
 * One episode = one timed lap. Samples are taken at a fixed 60 Hz from the
 * 120 Hz physics loop, so the data is evenly spaced and deterministic.
 *
 * Raw runs live in IndexedDB and export as JSONL (one header, one line per
 * track, one metadata line per lap, one line per step). tools/dataset/
 * converts that into Parquet + NPZ plus a schema/stats bundle.
 *
 * Nothing here reads the DOM except the optional download helper.
 */

import type { Car, CarControls } from './car';

export interface TrackPoint { x: number; z: number }

export interface RunMap {
  id: string;
  name: string;
  roadHalf: number;
  start: { x: number; z: number; heading: number };
  track: TrackPoint[];
}

export type Driver = 'human' | 'autopilot' | 'sim';

/** Raw observation vector, in this exact order. Keep in sync with the docs. */
export const OBS_FIELDS = [
  'x', 'z', 'heading', 'vx', 'vz', 'speed', 'slip', 'steerAngle',
  'groundY', 'pitch', 'drifting', 'onRoad', 'onKerb', 'trackIndex',
  'progress', 'trackDist', 'powerTime', 'powerCd', 'powerCharge',
] as const;

/** Raw action vector: what the player asked for on this tick. */
export const ACT_FIELDS = ['throttle', 'steer', 'handbrake', 'power'] as const;

export const RUN_SCHEMA = 'pixel-drift/runs@1';
export const RUN_FPS = 60;

const DB_NAME = 'pixel-drift-runs';
const LEGACY_DB_NAME = 'sprite-drift-runs';
const DB_VERSION = 1;
const STORE_RUNS = 'episodes';
const STORE_TRACKS = 'tracks';
const MIN_SAMPLES = 20;        // ignore blips under a third of a second
const MAX_SAMPLES = 60 * 60 * 20; // hard cap: 20 minutes at 60 Hz

export interface LapInfo {
  carName: string;
  variant: number;
  power: string;
  driver?: Driver;
}

interface Episode {
  id: string;
  index: number;
  mapId: string;
  carName: string;
  variant: number;
  power: string;
  driver: Driver;
  createdAt: string;
  lapMs: number | null;
  complete: boolean;
  /** flat obs and act arrays, OBS_FIELDS.length / ACT_FIELDS.length per step */
  obs: number[];
  act: number[];
}

function uid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const q3 = (v: number) => Math.round(v * 1000) / 1000;
const q2 = (v: number) => Math.round(v * 100) / 100;

function openDb(name: string = DB_NAME): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(name, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_RUNS)) db.createObjectStore(STORE_RUNS, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORE_TRACKS)) db.createObjectStore(STORE_TRACKS, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function readAll<T>(db: IDBDatabase | null, store: string): Promise<T[]> {
  return new Promise((resolve) => {
    if (!db) return resolve([]);
    try {
      const req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = () => resolve((req.result ?? []) as T[]);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

function put(db: IDBDatabase | null, store: string, value: unknown): Promise<void> {
  return new Promise((resolve) => {
    if (!db) return resolve();
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

function clearStore(db: IDBDatabase | null, store: string): Promise<void> {
  return new Promise((resolve) => {
    if (!db) return resolve();
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export class Recorder {
  on = true;
  fps = RUN_FPS;

  private map: RunMap;
  private db: IDBDatabase | null = null;
  private ready: Promise<void>;
  private acc = 0;
  private episodeIndex = 0;
  private current: Episode | null = null;
  private completed: Episode[] = [];
  private powerPulse = false;
  private savedTracks = new Set<string>();
  private sessionLaps = 0;
  private sessionSamples = 0;
  private lastLapMs: number | null = null;

  constructor(map: RunMap) {
    this.map = map;
    this.ready = this.initStore();
  }

  private async initStore(): Promise<void> {
    this.db = await openDb();
    await this.migrateLegacy();
    await this.saveTrack();
  }

  /** Move runs recorded under the old Sprite Drift database name once. */
  private async migrateLegacy(): Promise<void> {
    if (!this.db) return;
    try {
      const names = await indexedDB.databases?.();
      if (names && !names.some((d) => d.name === LEGACY_DB_NAME)) return;
    } catch {
      /* databases() unsupported; fall through */
    }
    const old = await openDb(LEGACY_DB_NAME);
    if (!old) return;
    const episodes = await readAll<Episode>(old, STORE_RUNS);
    const tracks = await readAll<Record<string, unknown>>(old, STORE_TRACKS);
    old.close();
    if (episodes.length === 0 && tracks.length === 0) {
      try { indexedDB.deleteDatabase(LEGACY_DB_NAME); } catch { /* ignore */ }
      return;
    }
    for (const ep of episodes) await put(this.db, STORE_RUNS, ep);
    for (const track of tracks) await put(this.db, STORE_TRACKS, track);
    try { indexedDB.deleteDatabase(LEGACY_DB_NAME); } catch { /* ignore */ }
  }

  private async saveTrack(): Promise<void> {
    if (this.savedTracks.has(this.map.id)) return;
    this.savedTracks.add(this.map.id);
    await put(this.db, STORE_TRACKS, {
      id: this.map.id,
      name: this.map.name,
      roadHalf: this.map.roadHalf,
      start: this.map.start,
      points: this.map.track.map((p) => [q2(p.x), q2(p.z)]),
    });
  }

  /** call when the map changes (currently that reloads the page, so only once) */
  setMap(map: RunMap) {
    this.map = map;
    void this.saveTrack();
  }

  /** A press of the power key that actually activated a power. */
  markPower() {
    this.powerPulse = true;
  }

  /** Start an episode if recording, in a lap, and not already inside one. */
  beginLap(info: LapInfo) {
    if (!this.on || this.current) return;
    this.current = {
      id: uid(),
      index: this.episodeIndex++,
      mapId: this.map.id,
      carName: info.carName,
      variant: info.variant,
      power: info.power,
      driver: info.driver ?? 'human',
      createdAt: new Date().toISOString(),
      lapMs: null,
      complete: false,
      obs: [],
      act: [],
    };
  }

  /** Close the open episode. Non-improvements (resets, stops) set complete=false. */
  endLap(lapMs: number | null, complete: boolean) {
    const ep = this.current;
    if (!ep) return;
    const samples = ep.obs.length / OBS_FIELDS.length;
    ep.lapMs = lapMs;
    ep.complete = complete;
    this.current = null;
    if (samples < MIN_SAMPLES) return;
    this.completed.push(ep);
    this.sessionSamples += samples;
    if (complete) this.sessionLaps++;
    if (complete && lapMs) this.lastLapMs = lapMs;
    void put(this.db, STORE_RUNS, ep);
  }

  /** Advance the sampler. Call once per physics step with the applied controls. */
  tick(dt: number, car: Car, controls: CarControls, lap: {
    progress: number; trackDist: number;
  }) {
    if (!this.on) return;
    const step = 1 / this.fps;
    this.acc += dt;
    if (this.acc < step) return;
    this.acc -= step;
    const ep = this.current;
    if (!ep) return;

    const o = ep.obs;
    o.push(
      q3(car.x), q3(car.z), q3(car.heading), q3(car.vx), q3(car.vz),
      q3(car.speed), q3(car.slip), q3(car.steerAngle), q3(car.groundY),
      q3(car.pitch), car.drifting ? 1 : 0, car.onRoad ? 1 : 0, car.onKerb ? 1 : 0,
      car.trackIndex, q3(lap.progress), q3(lap.trackDist),
      q2(car.powerTime), q2(car.powerCd), q2(car.powerCharge),
    );
    ep.act.push(
      q2(controls.throttle), q2(controls.steer),
      controls.handbrake ? 1 : 0, this.powerPulse ? 1 : 0,
    );
    this.powerPulse = false;

    if (o.length / OBS_FIELDS.length >= MAX_SAMPLES) this.endLap(null, false);
  }

  /** Toggle recording; stopping also closes the open lap as incomplete. */
  setEnabled(on: boolean) {
    this.on = on;
    if (!on) this.endLap(this.current?.lapMs ?? null, false);
  }

  stats() {
    const live = this.current ? this.current.obs.length / OBS_FIELDS.length : 0;
    const samples = this.sessionSamples + live;
    return {
      on: this.on,
      laps: this.sessionLaps,
      samples,
      seconds: samples / this.fps,
      lapsStored: this.completed.length,
      lastLapMs: this.lastLapMs,
    };
  }

  /** Everything recorded on this device, as one JSONL string. */
  async exportJsonl(): Promise<string> {
    await this.ready;
    const stored = await readAll<Episode>(this.db, STORE_RUNS);
    const byId = new Map<string, Episode>();
    for (const ep of stored) byId.set(ep.id, ep);
    for (const ep of this.completed) byId.set(ep.id, ep);
    if (this.current) byId.set(this.current.id, { ...this.current, complete: false });
    const episodes = [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const tracks = await readAll<{
      id: string; name: string; roadHalf: number; start: RunMap['start']; points: number[][];
    }>(this.db, STORE_TRACKS);
    const usedMaps = new Set(episodes.map((e) => e.mapId));
    if (usedMaps.has(this.map.id) && !tracks.some((t) => t.id === this.map.id)) {
      tracks.push({
        id: this.map.id,
        name: this.map.name,
        roadHalf: this.map.roadHalf,
        start: this.map.start,
        points: this.map.track.map((p) => [q2(p.x), q2(p.z)]),
      });
    }

    const lines: string[] = [];
    lines.push(JSON.stringify({
      kind: 'header',
      schema: RUN_SCHEMA,
      exportedAt: new Date().toISOString(),
      fps: this.fps,
      physicsHz: 120,
      obs: OBS_FIELDS,
      act: ACT_FIELDS,
      units: {
        x: 'm', z: 'm', heading: 'rad', vx: 'm/s', vz: 'm/s', speed: 'm/s',
        steerAngle: 'rad', trackIndex: 'index', progress: '0..1',
        trackDist: 'm', powerTime: 's', powerCd: 's',
      },
      notes: 'steer +1 = left; power is a one-tick activation pulse; handbrake 0/1.',
    }));
    for (const t of tracks) {
      if (!usedMaps.has(t.id)) continue;
      lines.push(JSON.stringify({ kind: 'track', ...t }));
    }

    const O = OBS_FIELDS.length, A = ACT_FIELDS.length;
    let gi = 0;
    for (const ep of episodes) {
      const n = Math.floor(ep.obs.length / O);
      const index = gi++;
      lines.push(JSON.stringify({
        kind: 'episode',
        id: ep.id,
        index,
        map: ep.mapId,
        car: ep.carName,
        variant: ep.variant,
        power: ep.power,
        driver: ep.driver,
        createdAt: ep.createdAt,
        lapMs: ep.lapMs,
        samples: n,
        complete: ep.complete,
      }));
      for (let s = 0; s < n; s++) {
        const o = ep.obs.slice(s * O, (s + 1) * O);
        const a = ep.act.slice(s * A, (s + 1) * A);
        lines.push(JSON.stringify({ e: index, s, o, a }));
      }
    }
    return lines.join('\n') + '\n';
  }

  /** Export and hand the file to the browser. Returns the number of laps. */
  async download(): Promise<number> {
    const jsonl = await this.exportJsonl();
    const laps = new Set(jsonl.match(/"kind":"episode"/g) ?? []).size;
    const blob = new Blob([jsonl], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.href = url;
    a.download = `pixel-drift-runs-${stamp}.jsonl`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return laps;
  }

  async clear(): Promise<void> {
    await this.ready;
    await clearStore(this.db, STORE_RUNS);
    this.completed = [];
    this.sessionLaps = 0;
    this.sessionSamples = 0;
    this.lastLapMs = null;
  }
}
