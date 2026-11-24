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
}

export const CAR_POWERS: CarPower[] = [
  {
    name: 'PEARL RUSH', blurb: 'A clean top-end surge',
    duration: 3.0, cooldown: 8, color: 0x6fe6d8,
    speed: 1.18, accel: 1.55, grip: 1.05, steer: 1.0,
  },
  {
    name: 'REDLINE', blurb: 'Extra grip and a sharper nose',
    duration: 3.5, cooldown: 8, color: 0xff5a45,
    speed: 1.02, accel: 1.10, grip: 2.25, steer: 1.18,
  },
  {
    name: 'NIGHT CLOAK', blurb: 'Phase through the barriers',
    duration: 2.5, cooldown: 9, color: 0x5b7cff,
    speed: 1.05, accel: 1.15, grip: 1.15, steer: 1.0,
    ghost: true,
  },
  {
    name: 'WARP', blurb: 'A violent short jump',
    duration: 1.5, cooldown: 8, color: 0xb46cff,
    speed: 1.40, accel: 2.10, grip: 1.30, steer: 1.1,
    burst: 5, ghost: true,
  },
  {
    name: 'THUNDERCLAP', blurb: 'Yellow lightning and a hard launch',
    duration: 3.0, cooldown: 8, color: 0xffe14a,
    speed: 1.45, accel: 2.20, grip: 1.15, steer: 1.05,
    zap: true,
  },
];

export const powerColour = (i: number) => `#${(CAR_POWERS[i]?.color ?? 0xffffff).toString(16).padStart(6, '0')}`;
