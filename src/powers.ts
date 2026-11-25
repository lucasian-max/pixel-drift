/** One superpower per car. Activated with F, on a cooldown. */
export interface CarPower {
  name: string;
  blurb: string;
  duration: number;
  cooldown: number;
  color: number;
  /** multipliers while active */
  speed: number;
  accel: number;
  grip: number;
  steer: number;
  /** forward impulse on activation */
  burst?: number;
  /** pass through colliders (Night Cloak) */
  ghost?: boolean;
  /** yellow lightning arcs (Group B) */
  zap?: boolean;
  /** forward blink distance in metres, applied on activation (TUNNEL) */
  blink?: number;
  /** freeze the game and aim a placement anywhere inside the blink radius */
  aim?: boolean;
  /** pearl orbs orbiting the car */
  orbs?: boolean;
  /** grip multiplier while the power is active (drift powers lower it) */
  driftGrip?: number;
  /** drift-score multiplier while active */
  driftScore?: number;
  /** conversion from stored drift charge to an exit boost */
  exitBoost?: number;
  /** one-line stat summary shown on the power card */
  effect?: string;
  /** 1..10 strength of what the power does, for the garage POWER bar */
  rating?: number;
}

export const CAR_POWERS: CarPower[] = [
  {
    name: 'PEARL DRIFT',
    blurb: 'Loose the rear, hold a huge slide, then fire out of the corner.',
    effect: 'DRIFT SCORE ×3.5 · EXIT BOOST',
    rating: 4, duration: 4.5, cooldown: 8, color: 0x9ff5e8,
    speed: 1.02, accel: 1.12, grip: 1.0, steer: 1.42,
    driftGrip: 0.58, driftScore: 3.5, exitBoost: 1.0, orbs: true,
  },
  {
    name: 'THUNDERCLAP',
    blurb: 'A hard launch, double acceleration and a much higher top end.',
    effect: 'TOP SPEED ×1.5 · ACCEL ×2.6',
    rating: 8, duration: 3.5, cooldown: 7, color: 0xffe14a,
    speed: 1.5, accel: 2.6, grip: 1.18, steer: 1.05, burst: 2.4,
    zap: true,
  },
  {
    name: 'TUNNEL',
    blurb: 'Tear open the ground: freeze time and re-place the car anywhere within reach.',
    effect: 'PLACE ≤ 22 m · 0.5 s PHASE',
    // earthy amber, not violet: the card fill and the HUD charge bar share this hex, the
    // FX pick their own lighter sand tones (DUST in src/wormFx.ts)
    rating: 9, duration: 0.5, cooldown: 9, color: 0xe8a33d,
    speed: 1.0, accel: 1.0, grip: 1.0, steer: 1.0,
    blink: 22, aim: true, ghost: true,
  },
];

export const powerColour = (i: number) => `#${(CAR_POWERS[i]?.color ?? 0xffffff).toString(16).padStart(6, '0')}`;
