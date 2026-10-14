/** Shared control types. */

export interface Point {
  x: number;
  y: number;
  z: number;
}

export interface ControlCommand {
  altitude: number;
  strafe: number;
  forward: number;
  yaw: number;
  /** Grab / release. Treated as an edge by the task. */
  pinch: boolean;
}

export const ZERO_COMMAND: ControlCommand = {
  altitude: 0,
  strafe: 0,
  forward: 0,
  yaw: 0,
  pinch: false,
};

export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

export function wrapAngle(delta: number): number {
  let wrapped = delta;
  while (wrapped > Math.PI) wrapped -= Math.PI * 2;
  while (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
}
