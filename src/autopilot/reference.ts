import { SPAWN, levelEnd, windAt, type Level } from "../course/levels";
import { createTask, stepTask, type RunScore, type TaskState } from "../course/task";
import { DEFAULT_LIMITS, createDrone, stepDrone, type DroneLimits } from "../physics/drone";
import { Recorder, type Sample } from "../recorder";
import { Autopilot } from "./autopilot";

export function limitsFor(level: Level, speed = 1): DroneLimits {
  return {
    ...DEFAULT_LIMITS,
    maxSpeed: DEFAULT_LIMITS.maxSpeed * speed,
    maxClimb: DEFAULT_LIMITS.maxClimb * speed,
    maxYawRate: DEFAULT_LIMITS.maxYawRate * speed,
    zMax: levelEnd(level),
  };
}

export interface ReferenceRun {
  score: RunScore | null;
  task: TaskState;
  samples: Sample[];
}

/**
 * Fly the autopilot headlessly at 60 Hz. Deterministic, so it doubles as the
 * ghost a new player races and as the bar the medals are set from.
 */
export function flyReference(level: Level, maxSeconds = 180): ReferenceRun {
  const drone = createDrone(SPAWN.x, SPAWN.y, SPAWN.z, SPAWN.yaw);
  const task = createTask(level);
  const pilot = new Autopilot(level);
  const rec = new Recorder();
  const limits = limitsFor(level);
  const dt = 1 / 60;
  for (let i = 0; i < maxSeconds * 60 && !task.score && !task.crashed; i += 1) {
    const t = i * dt;
    const cmd = pilot.command(drone, task, limits, dt, t);
    stepDrone(drone, cmd, dt, limits, windAt(level, drone.x, drone.z));
    stepTask(task, drone, cmd.pinch, dt, level, t);
    rec.push(t, drone, task.carrying, dt);
  }
  return { score: task.score, task, samples: rec.samples };
}

export type Medal = "gold" | "silver" | "bronze" | null;

/** Medal cut-offs from the reference time: gold is within 10% of the autopilot. */
export function medalTargets(refTime: number): { gold: number; silver: number; bronze: number } {
  return { gold: refTime * 1.1, silver: refTime * 1.4, bronze: refTime * 1.9 };
}

export function medalFor(time: number, refTime: number): Medal {
  const m = medalTargets(refTime);
  if (time <= m.gold) return "gold";
  if (time <= m.silver) return "silver";
  if (time <= m.bronze) return "bronze";
  return null;
}
