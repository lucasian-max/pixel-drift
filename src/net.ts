import * as THREE from 'three';
import { buildCarModel } from './carModel';

/* Multiplayer room client. The server owns the roster and validates laps; each
   client still simulates its own car at 120 Hz and broadcasts a 20 Hz pose. */

export interface NetSelf {
  x: number; z: number; heading: number;
  speed: number; u: number; lap: number;
}

export interface GridStart { x: number; z: number; heading: number }

interface NetState {
  id: string; name: string; slot: number; place: number;
  x: number; z: number; h: number; sp: number; u: number; lap: number;
}

interface Remote {
  group: THREE.Group;
  laps: number[];
  target: THREE.Vector3;
  targetHeading: number;
  heading: number;
}

const SEND_HZ = 20;

/** Staggered grid behind the line, used until a racer sends a real pose. */
export function gridPoint(start: GridStart, slot: number): { x: number; z: number } {
  const fx = -Math.sin(start.heading), fz = -Math.cos(start.heading);
  const rx = Math.cos(start.heading), rz = -Math.sin(start.heading);
  const row = Math.floor(slot / 2);
  const side = slot % 2 === 0 ? -1 : 1;
  const back = 2.2 + row * 5.4;
  const lateral = side * 2.5;
  return {
    x: start.x - fx * back + rx * lateral,
    z: start.z - fz * back + rz * lateral,
  };
}

function nameTag(name: string): THREE.Sprite {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 24;
  const g = cv.getContext('2d')!;
  g.fillStyle = 'rgba(18,20,24,0.82)';
  g.fillRect(0, 0, 128, 24);
  g.fillStyle = '#f2eee1';
  g.fillRect(0, 21, 128, 2);
  g.font = 'bold 14px monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name.toUpperCase().slice(0, 12), 64, 11);
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, toneMapped: false,
  }));
  sprite.scale.set(3.2, 0.6, 1);
  sprite.position.y = 1.55;
  return sprite;
}

export async function createRoom(): Promise<string | null> {
  try {
    const r = await fetch('/api/rooms', { method: 'POST', credentials: 'same-origin' });
    if (!r.ok) return null;
    const body = (await r.json()) as { room?: string };
    return body.room ?? null;
  } catch {
    return null;
  }
}

export class Net {
  room = '';
  id = '';
  connected = false;
  count = 0;
  place = 0;
  best: { name: string; ms: number } | null = null;
  topLap = 0;   // highest lap count anyone in the room has reached
  /** transient "ACE JOINED" text; draw while `performance.now()/1000 < noticeUntil` */
  notice = '';
  noticeUntil = 0;
  onWelcome?: (slot: number) => void;

  private ws: WebSocket | null = null;
  private scene: THREE.Scene | null = null;
  private start: GridStart = { x: 0, z: 0, heading: 0 };
  private remotes = new Map<string, Remote>();

  /** display name for a racer id */
  nameOf(id: string): string {
    return this.known.get(id) ?? 'RACER';
  }

  /** best lap per other racer, for the shared results board */
  peerLaps(): { id: string; best: number }[] {
    return [...this.remotes.entries()]
      .filter(([, r]) => r && r.laps.length > 0)
      .map(([id, r]) => ({ id, best: Math.min(...r!.laps) }));
  }

  /** world positions of every other racer (for local car-vs-car collision) */
  remoteBodies(): { id: string; x: number; z: number }[] {
    const out: { id: string; x: number; z: number }[] = [];
    for (const [id, r] of this.remotes) out.push({ id, x: r.target.x, z: r.target.z });
    return out;
  }
  private known = new Map<string, string>();   // id -> name, for join/leave notices
  private sendIn = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private closed = true;

  connect(room: string, scene: THREE.Scene, start: GridStart) {
    this.room = room.toUpperCase();
    this.scene = scene;
    this.start = start;
    this.closed = false;
    this.open();
  }

  private open() {
    if (this.closed || !this.room) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/api/ws?room=${encodeURIComponent(this.room)}`;
    let ws: WebSocket;
    try { ws = new WebSocket(url); } catch { this.scheduleRetry(); return; }
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      this.sendIn = 0;
    };
    ws.onmessage = (ev) => {
      let msg: { t?: string } & Record<string, unknown>;
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      this.handle(msg);
    };
    ws.onclose = () => {
      this.connected = false;
      this.id = '';
      this.count = 0;
      this.place = 0;
      this.notice = '';
      this.known.clear();
      this.clearRemotes();
      if (this.ws === ws) this.ws = null;
      this.scheduleRetry();
    };
    ws.onerror = () => { /* close follows */ };
  }

  private scheduleRetry() {
    if (this.closed || this.retry) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      this.open();
    }, 1800);
  }

  private handle(msg: { t?: string } & Record<string, unknown>) {
    if (msg.t === 'welcome') {
      this.id = typeof msg.id === 'string' ? msg.id : '';
      this.count = Number(msg.count) || 1;
      this.best = (msg.best as { name: string; ms: number } | null) ?? null;
      // seed the roster so the first states frame does not announce everyone
      this.known.clear();
      const listed = Array.isArray(msg.racers) ? (msg.racers as NetState[]) : [];
      for (const r of listed) {
        if (r && typeof r.id === 'string' && r.id !== this.id) {
          this.known.set(r.id, String(r.name || 'RACER'));
        }
      }
      this.onWelcome?.(Number(msg.slot) || 0);
      return;
    }
    if (msg.t === 'states') {
      const list = Array.isArray(msg.racers) ? (msg.racers as NetState[]) : [];
      this.count = Number(msg.count) || list.length;
      this.topLap = list.reduce((m, r) => Math.max(m, Math.round(Number(r.lap) || 0)), 0);
      this.best = (msg.best as { name: string; ms: number } | null) ?? null;
      const seen = new Set<string>();
      for (const r of list) {
        if (!r || typeof r.id !== 'string' || !Number.isFinite(r.x) || !Number.isFinite(r.z)) continue;
        seen.add(r.id);
        if (r.id === this.id) {
          this.place = Number(r.place) || 0;
          continue;
        }
        const name = String(r.name || 'RACER');
        if (!this.known.has(r.id)) {
          this.announce(`${name} JOINED`);
        }
        this.known.set(r.id, name);
        this.upsert(r);
      }
      for (const id of [...this.remotes.keys()]) {
        if (!seen.has(id) && this.id) {
          this.known.delete(id);
          this.remove(id);
        }
      }
      return;
    }
    if (msg.t === 'left' && typeof msg.id === 'string') {
      this.count = Number(msg.count) || this.count;
      const name = this.known.get(msg.id)
        ?? (typeof msg.name === 'string' ? msg.name : '');
      if (name) this.announce(`${name} LEFT`);
      this.known.delete(msg.id);
      this.remove(msg.id);
      return;
    }
    if (msg.t === 'lap') {
      const peer = this.remotes.get(String(msg.id));
      if (peer && typeof msg.ms === 'number') peer.laps.push(msg.ms);
      this.best = (msg.best as { name: string; ms: number } | null) ?? null;
    }
  }

  private upsert(s: NetState) {
    if (!this.scene) return;
    let r = this.remotes.get(s.id);
    if (!r) {
      const group = new THREE.Group();
      const model = buildCarModel(s.slot % 4);
      model.rotation.y = Math.PI;   // built nose toward +Z
      group.add(model);
      group.add(nameTag(s.name || 'RACER'));
      this.scene.add(group);
      r = {
        group,
        target: new THREE.Vector3(s.x, 0, s.z),
        targetHeading: s.h,
        heading: s.h,
        laps: [],
      };
      group.position.copy(r.target);
      group.rotation.y = s.h;
      this.remotes.set(s.id, r);
    }
    if (!r) return;
    r.target.set(s.x, 0, s.z);
    r.targetHeading = s.h;
  }

  private remove(id: string) {
    const r = this.remotes.get(id);
    if (!r || !this.scene) return;
    this.scene.remove(r.group);
    this.remotes.delete(id);
  }

  private announce(text: string) {
    this.notice = text;
    this.noticeUntil = performance.now() / 1000 + 3;
  }

  private clearRemotes() {
    for (const id of [...this.remotes.keys()]) this.remove(id);
  }

  sendLap(ms: number, lap: number) {
    if (!this.connected || !this.ws) return;
    try { this.ws.send(JSON.stringify({ t: 'lap', ms, lap })); } catch { /* dropped */ }
  }

  /** Call every frame. `self` is null on the title screen (lobby only). */
  update(dt: number, self: NetSelf | null) {
    for (const r of this.remotes.values()) {
      const k = 1 - Math.exp(-dt * 11);
      r.group.position.x += (r.target.x - r.group.position.x) * k;
      r.group.position.z += (r.target.z - r.group.position.z) * k;
      let dh = r.targetHeading - r.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      r.heading += dh * k;
      r.group.rotation.y = r.heading;
    }

    if (!self || !this.connected || !this.ws) return;
    this.sendIn -= dt;
    if (this.sendIn > 0) return;
    this.sendIn = 1 / SEND_HZ;
    try {
      this.ws.send(JSON.stringify({
        t: 'state',
        x: self.x, z: self.z, h: self.heading,
        sp: self.speed, u: self.u, lap: self.lap,
      }));
    } catch { /* socket closing */ }
  }

  disconnect() {
    this.closed = true;
    if (this.retry) { clearTimeout(this.retry); this.retry = null; }
    this.connected = false;
    this.id = '';
    this.count = 0;
    this.place = 0;
    this.notice = '';
    this.known.clear();
    this.clearRemotes();
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try { ws.close(); } catch { /* already closed */ }
    }
  }
}
