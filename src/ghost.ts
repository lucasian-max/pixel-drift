/* src/ghost.ts — the ghost car: one map's rank-1 lap replayed as a body.

   The server stores the best line as compact [x, z, t] triples, t in ms from
   the lap's start. sampleGhost() walks that line against the CURRENT lap
   clock, so the ghost runs at the pace the record was set at rather than on
   its own timer. buildGhostModel() is buildCarModel() dulled down to a
   translucent hull — the variant colours never matter, only the silhouette. */

import * as THREE from 'three';
import { buildCarModel, CAR_VARIANTS } from './carModel';
import type { GhostLap } from './account';

export interface GhostSample { x: number; z: number; heading: number }

interface Point { x: number; z: number; t: number }

/** Accepts the stored triples and (for older payloads) plain objects. */
function readPoints(trace: GhostLap['trace'] | undefined | null): Point[] {
  if (!Array.isArray(trace)) return [];
  const out: Point[] = [];
  for (const raw of trace) {
    if (Array.isArray(raw)) {
      const [x, z, t] = raw as [number, number, number];
      if (Number.isFinite(x) && Number.isFinite(z) && Number.isFinite(t)) out.push({ x, z, t });
      continue;
    }
    const p = raw as { x?: number; z?: number; t?: number } | null;
    if (p && Number.isFinite(p.x) && Number.isFinite(p.z) && Number.isFinite(p.t)) {
      out.push({ x: p.x!, z: p.z!, t: p.t! });
    }
  }
  return out;
}

/** Car forward is (-sin h, -cos h), so a segment's heading is atan2(-dx, -dz). */
const headingOf = (a: Point, b: Point) => Math.atan2(-(b.x - a.x), -(b.z - a.z));

/** Where the ghost sits at `tMs` into a lap. Null when the line is unusable. */
export function sampleGhost(trace: GhostLap['trace'] | undefined | null, tMs: number): GhostSample | null {
  const pts = readPoints(trace);
  if (pts.length === 0) return null;
  if (!Number.isFinite(tMs) || pts.length === 1) {
    return { x: pts[0].x, z: pts[0].z, heading: 0 };
  }
  const first = pts[0];
  if (tMs <= first.t) return { x: first.x, z: first.z, heading: headingOf(pts[0], pts[1]) };

  for (let i = 1; i < pts.length; i++) {
    const b = pts[i];
    if (tMs > b.t) continue;
    const a = pts[i - 1];
    const span = b.t - a.t;
    const k = span > 0 ? (tMs - a.t) / span : 1;   // the line is monotone in t
    return {
      x: a.x + (b.x - a.x) * k,
      z: a.z + (b.z - a.z) * k,
      heading: headingOf(a, b),
    };
  }

  // past the finish: hold the last sample, facing the way it came in
  const last = pts[pts.length - 1];
  return { x: last.x, z: last.z, heading: headingOf(pts[pts.length - 2], last) };
}

/** A ghost body: the requested car, every material dulled to see-through. */
export function buildGhostModel(variant = 0): THREE.Group {
  const v = Number.isInteger(variant) && variant >= 0 && variant < CAR_VARIANTS ? variant : 0;
  const ghost = buildCarModel(v);
  ghost.name = 'ghost';
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
