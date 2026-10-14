import type { RunScore } from "./course/task";

export interface Sample {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  carrying: boolean;
}

export interface Flight {
  level: string;
  pilot: "hand" | "keys" | "touch" | "autopilot";
  score: RunScore;
  samples: Sample[];
}

const HZ = 20;

/** Samples a run at a fixed rate, for the ghost and the debrief charts. */
export class Recorder {
  samples: Sample[] = [];
  private acc = 0;

  reset(): void {
    this.samples = [];
    this.acc = 0;
  }

  push(t: number, s: { x: number; y: number; z: number; yaw: number; vx: number; vy: number; vz: number }, carrying: boolean, dt: number): void {
    this.acc += dt;
    if (this.samples.length && this.acc < 1 / HZ) return;
    this.acc = 0;
    this.samples.push({ t, x: s.x, y: s.y, z: s.z, yaw: s.yaw, speed: Math.hypot(s.vx, s.vy, s.vz), carrying });
  }
}

/** Pose at time t, interpolated between recorded samples. */
export function sampleAt(samples: readonly Sample[], t: number): Sample | null {
  if (!samples.length) return null;
  if (t <= samples[0].t) return samples[0];
  const last = samples[samples.length - 1];
  if (t >= last.t) return last;
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  const k = (t - a.t) / (b.t - a.t || 1);
  return {
    t,
    x: a.x + (b.x - a.x) * k,
    y: a.y + (b.y - a.y) * k,
    z: a.z + (b.z - a.z) * k,
    yaw: a.yaw + (b.yaw - a.yaw) * k,
    speed: a.speed + (b.speed - a.speed) * k,
    carrying: a.carrying,
  };
}

const KEY = "aerogest.best.v4";

/** Lower medal time wins. */
export function better(a: RunScore, b: RunScore): boolean {
  return a.time < b.time;
}

function loadAll(): Record<string, Flight> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, Flight>;
  } catch {
    return {};
  }
}

export function loadBest(level: string): Flight | null {
  return loadAll()[level] ?? null;
}

/** Keeps the run if it beats the stored one. Returns true when it did. */
export function saveIfBest(flight: Flight): boolean {
  try {
    const all = loadAll();
    const prev = all[flight.level];
    if (prev && !better(flight.score, prev.score)) return false;
    all[flight.level] = flight;
    localStorage.setItem(KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}
