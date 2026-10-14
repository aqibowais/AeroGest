import type { ControlCommand } from "../control/mapping";
import { clamp } from "../control/mapping";

export interface DroneState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vy: number;
  vz: number;
  yawRate: number;
}

export interface DroneLimits {
  maxSpeed: number;
  maxClimb: number;
  maxYawRate: number;
  response: number;
  minAltitude: number;
  maxAltitude: number;
  arena: number;
  zMin: number;
  zMax: number;
}

export const DEFAULT_LIMITS: DroneLimits = {
  maxSpeed: 7.5,
  maxClimb: 4.2,
  maxYawRate: 1.6,
  response: 5.5,
  minAltitude: 0.55,
  maxAltitude: 12,
  arena: 14,
  zMin: -4,
  zMax: 82,
};

export function createDrone(x = 0, y = 2.2, z = 0, yaw = 0): DroneState {
  return { x, y, z, yaw, vx: 0, vy: 0, vz: 0, yawRate: 0 };
}

export function resetDrone(state: DroneState, x = 0, y = 2.2, z = 0, yaw = 0): void {
  Object.assign(state, createDrone(x, y, z, yaw));
}

/**
 * Hover model. Zero stick returns velocity to zero. There is no aerodynamic
 * simulation here: the stick sets a target velocity and the body eases toward it.
 * Yaw 0 faces +z. Positive strafe is to the pilot's right, which is world -x:
 * three.js is right-handed, so a chase camera looking down +z sees +x on the
 * left of the screen. (Earlier versions sent +strafe to +x, so "right" flew
 * the drone left on screen.) Positive yaw rotates the nose toward +x.
 * Wind is an air current in m/s that carries the drone on top of its own velocity.
 */
export function stepDrone(
  state: DroneState,
  command: ControlCommand,
  dt: number,
  limits: DroneLimits = DEFAULT_LIMITS,
  wind: { x: number; z: number } = { x: 0, z: 0 },
): void {
  const step = clamp(dt, 0, 0.05);
  const sin = Math.sin(state.yaw);
  const cos = Math.cos(state.yaw);
  const forward = clamp(command.forward, -1, 1) * limits.maxSpeed;
  const strafe = clamp(command.strafe, -1, 1) * limits.maxSpeed;
  const climb = clamp(command.altitude, -1, 1) * limits.maxClimb;
  const yawTarget = clamp(command.yaw, -1, 1) * limits.maxYawRate;
  // Body right vector is (-cos, 0, sin) for a nose at (sin, 0, cos).
  const targetVx = sin * forward - cos * strafe;
  const targetVz = cos * forward + sin * strafe;
  const blend = 1 - Math.exp(-limits.response * step);

  state.vx += (targetVx - state.vx) * blend;
  state.vy += (climb - state.vy) * blend;
  state.vz += (targetVz - state.vz) * blend;
  state.yawRate += (yawTarget - state.yawRate) * blend;

  state.x += (state.vx + wind.x) * step;
  state.y += state.vy * step;
  state.z += (state.vz + wind.z) * step;
  state.yaw += state.yawRate * step;

  if (state.y < limits.minAltitude) {
    state.y = limits.minAltitude;
    if (state.vy < 0) state.vy = 0;
  } else if (state.y > limits.maxAltitude) {
    state.y = limits.maxAltitude;
    if (state.vy > 0) state.vy = 0;
  }
  if (state.x < -limits.arena) {
    state.x = -limits.arena;
    if (state.vx < 0) state.vx = 0;
  } else if (state.x > limits.arena) {
    state.x = limits.arena;
    if (state.vx > 0) state.vx = 0;
  }
  if (state.z < limits.zMin) {
    state.z = limits.zMin;
    if (state.vz < 0) state.vz = 0;
  } else if (state.z > limits.zMax) {
    state.z = limits.zMax;
    if (state.vz > 0) state.vz = 0;
  }
}
