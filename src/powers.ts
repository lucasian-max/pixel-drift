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
  /** pearl orbs orbiting the car */
  orbs?: boolean;
  /** grip multiplier while the power is active (drift powers lower it) */
  driftGrip?: number;
  /** drift-score multiplier while active */
  driftScore?: number;
  /** conversion from stored drift charge to an exit boost */
  exitBoost?: number;
}

export const CAR_POWERS: CarPower[] = [
  {
    name: 'PEARL DRIFT', blurb: 'High-angle, high-score sliding with a pearl aura',
    duration: 4.0, cooldown: 9, color: 0x9ff5e8,
    speed: 1.0, accel: 1.08, grip: 1.0, steer: 1.38,
    driftGrip: 0.62, driftScore: 3, exitBoost: 0.85, orbs: true,
  },
  {
    name: 'THUNDERCLAP', blurb: 'Yellow lightning and a hard launch',
    duration: 3.0, cooldown: 8, color: 0xffe14a,
    speed: 1.45, accel: 2.20, grip: 1.15, steer: 1.05,
    zap: true,
  },
];

export const powerColour = (i: number) => `#${(CAR_POWERS[i]?.color ?? 0xffffff).toString(16).padStart(6, '0')}`;
