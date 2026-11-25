import { CAR_POWERS } from './powers';

/**
 * Per-car handling, and the garage ratings derived from it.
 *
 * car.ts reads these numbers every frame. The garage reads the *ratings*
 * below, which are computed from the same numbers, so the stats screen can
 * never drift away from what the cars actually do. scripts/car-stats.check.mjs
 * guards the ordering in CI.
 */
export interface CarStats {
  /** top speed on tarmac, units/s (30 was the value all three cars shared) */
  top: number;
  /** throttle acceleration, units/s² (21 was shared) */
  accel: number;
  /** road grip multiplier, 1 = the old shared value */
  grip: number;
  /** steering-lock multiplier, 1 = the old shared value */
  steer: number;
  /** power-cooldown multiplier, 1 = exactly what ./powers says */
  power: number;
}

export const CAR_STATS: CarStats[] = [
  // PEARL GT — the tidy one: best grip, quickest lock. The price is its drift
  // power taking the longest to come back, which is the whole point of the car.
  { top: 30, accel: 22, grip: 1.12, steer: 1.06, power: 1.30 },
  // GROUP B — the loud one: nobody else has this top end or this launch, and
  // nobody else slides this much either. Point it before you squeeze it.
  { top: 33, accel: 26, grip: 0.80, steer: 0.90, power: 1.00 },
  // DUNE RUNNER — slower on its own wheels because the tunnel does the
  // travelling; planted grip, and the biggest power in the game.
  { top: 26, accel: 19, grip: 1.04, steer: 0.95, power: 1.00 },
];

/** One-word identity, shown next to the power name in the garage. */
export const CAR_CLASS = ['CONTROL', 'ROCKET', 'TELEPORT'];

/**
 * Rated 1..10 against fixed anchors rather than against each other: a 9 means
 * "9/10 of what this game can do", so the ratings stay stable if a fourth car
 * joins. The anchors are the edges of the tuning space, not the current field.
 * POWER is not derived: what a power does is a design number, so the power
 * table carries it (./powers `rating`).
 */
const AXES = [
  { label: 'SPEED', lo: 24, hi: 34 },
  { label: 'ACCEL', lo: 16, hi: 28 },
  { label: 'GRIP', lo: 0.70, hi: 1.20 },
  { label: 'HANDLING', lo: 0.80, hi: 1.10 },
  // not derived from a value: the power table's own strength rating
  { label: 'POWER', lo: 0, hi: 1 },
];

/** the derived axes: everything before POWER */
const DERIVED = AXES.length - 1;

/** 1..10 for a value between lo and hi. */
function rate(value: number, lo: number, hi: number): number {
  const t = (value - lo) / (hi - lo);
  return Math.max(1, Math.min(10, Math.round(1 + t * 9)));
}

export interface StatRow {
  label: string;
  /** 1..10, drawn as filled segments */
  rating: number;
  /** true when no other car rates higher on this axis: the garage's accent */
  best: boolean;
}

function ratingsFor(variant: number): number[] {
  const s = CAR_STATS[variant] ?? CAR_STATS[0];
  const values = [s.top, s.accel, s.grip, s.steer].slice(0, DERIVED);
  return [
    ...values.map((v, i) => rate(v, AXES[i].lo, AXES[i].hi)),
    CAR_POWERS[variant]?.rating ?? 5,
  ];
}

/** Best rating any car reaches on each axis: the accented "class leader" mark. */
const FIELD_BEST = AXES.map((_, axis) =>
  Math.max(...CAR_STATS.map((__, v) => ratingsFor(v)[axis]))
);

export function carStatRows(variant: number): StatRow[] {
  const mine = ratingsFor(variant);
  return AXES.map((axis, i) => ({
    label: axis.label,
    rating: mine[i],
    best: mine[i] === FIELD_BEST[i],
  }));
}
