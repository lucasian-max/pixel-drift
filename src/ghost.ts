/* src/ghost.ts — the ghost car: one map's rank-1 lap replayed as a body.

   The server stores the best line as compact [x, z, t, heading?, event?]
   points, t in ms from the lap's start. sampleGhost() walks that line against
   the CURRENT lap clock, so the ghost runs at the pace the record was set at
   rather than on its own timer. buildGhostModel() is buildCarModel() dulled
   down to a translucent hull — the variant colours never matter, only the
   silhouette.

   Heading, in priority order: the recorded nose heading (new laps), the
   circuit's tangent where the line sits (legacy laps: a chord between two
   samples swings wildly through hairpins and even flips backwards), then the
   chord as a last resort. ghostPowerTimes() lists the lap's power marks so
   the HUD can say whether the record was power-assisted. */

import * as THREE from 'three';
import { buildCarModel, CAR_VARIANTS } from './carModel';
import type { GhostLap } from './account';

export interface GhostSample { x: number; z: number; heading: number }

interface Point { x: number; z: number; t: number; h: number | null; e?: 'blink' | 'power' }
type TraceLike = GhostLap['trace'] | undefined | null;
type TangentAt = (x: number, z: number) => number | null;

/** Accepts the stored points and (for older payloads) plain objects. */
function readPoints(trace: TraceLike): Point[] {
  if (!Array.isArray(trace)) return [];
  const out: Point[] = [];
  for (const raw of trace) {
    if (Array.isArray(raw)) {
      const [x, z, t, h, e] = raw as [number, number, number, number | null, string?];
      if (Number.isFinite(x) && Number.isFinite(z) && Number.isFinite(t)) {
        out.push({ x, z, t, h: Number.isFinite(h) ? h : null, e: e === 'blink' || e === 'power' ? e : undefined });
      }
      continue;
    }
    const p = raw as { x?: number; z?: number; t?: number; h?: number; e?: 'blink' | 'power' } | null;
    if (p && Number.isFinite(p.x) && Number.isFinite(p.z) && Number.isFinite(p.t)) {
      out.push({ x: p.x!, z: p.z!, t: p.t!, h: Number.isFinite(p.h) ? p.h! : null, e: p.e });
    }
  }
  return out;
}

/** Car forward is (-sin h, -cos h), so a segment's heading is atan2(-dx, -dz). */
const headingOf = (a: Point, b: Point) => Math.atan2(-(b.x - a.x), -(b.z - a.z));

/** Shortest-arc blend between two headings. */
const lerpHeading = (a: number, b: number, k: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
};

const headingFor = (a: Point, b: Point, k: number, at: Point, tangentAt?: TangentAt): number => {
  if (a.h !== null && b.h !== null) return lerpHeading(a.h, b.h, k);
  if (a.h !== null) return a.h;
  if (b.h !== null) return b.h;
  const tangent = tangentAt?.(at.x, at.z);
  if (tangent !== null && tangent !== undefined) return tangent;
  return headingOf(a, b);
};

/** Where the ghost sits at `tMs` into a lap. Null when the line is unusable. */
export function sampleGhost(trace: TraceLike, tMs: number, tangentAt?: TangentAt): GhostSample | null {
  const pts = readPoints(trace);
  if (pts.length === 0) return null;
  if (!Number.isFinite(tMs) || pts.length === 1) {
    return { x: pts[0].x, z: pts[0].z, heading: tangentAt?.(pts[0].x, pts[0].z) ?? 0 };
  }
  const first = pts[0];
  if (tMs <= first.t) {
    return { x: first.x, z: first.z, heading: headingFor(pts[0], pts[1], 0, pts[0], tangentAt) };
  }

  for (let i = 1; i < pts.length; i++) {
    const b = pts[i];
    if (tMs > b.t) continue;
    const a = pts[i - 1];
    const span = b.t - a.t;
    const k = span > 0 ? (tMs - a.t) / span : 1;   // the line is monotone in t
    const x = a.x + (b.x - a.x) * k;
    const z = a.z + (b.z - a.z) * k;
    return { x, z, heading: headingFor(a, b, k, { x, z, t: tMs, h: null }, tangentAt) };
  }

  // past the finish: hold the last sample, facing the way it came in
  const last = pts[pts.length - 1];
  return { x: last.x, z: last.z, heading: headingFor(pts[pts.length - 2], last, 1, last, tangentAt) };
}

/** When the record fired a power: 'blink' is a TUNNEL placement, 'power' any
    other firing. Reads the marks the trace carried from submission. */
export function ghostEvents(trace: TraceLike): { t: number; e: 'blink' | 'power' }[] {
  return readPoints(trace).filter((p) => p.e).map((p) => ({ t: p.t, e: p.e! }));
}

/** A ghost body: the requested car, every material dulled to see-through. */
export function buildGhostModel(variant = 0): THREE.Group {
  const v = Number.isInteger(variant) && variant >= 0 && variant < CAR_VARIANTS ? variant : 0;
  // buildCarModel() builds nose toward +Z; Car flips it π inside its group
  // (src/car.ts). The ghost needs the same flip or it drives in reverse.
  const car = buildCarModel(v);
  car.rotation.y = Math.PI;
  const ghost = new THREE.Group();
  ghost.name = 'ghost';
  ghost.add(car);
  const materials = new Set<THREE.Material>();
  ghost.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of list) if (m) materials.add(m);
  });
  for (const m of materials) {
    m.transparent = true;
    m.opacity = 0.4;
    m.depthWrite = false;
  }
  return ghost;
}
