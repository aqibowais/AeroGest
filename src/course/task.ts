import { RULES, hitsGate, throughGate, throughRing, type Level, type Vec3 } from "./levels";
import { POINTS, deliveryPoints } from "./points";

export interface RunScore {
  /** What medals are judged on: flight + penalties − bonus. */
  time: number;
  flight: number;
  penalty: number;
  bonus: number;
  gates: number;
  rings: number;
  /** Mean distance from pad centers, meters. */
  error: number;
  delivered: number;
  /** Points before the time bonus. */
  points: number;
}

export interface PointEvent {
  label: string;
  points: number;
}

export interface TaskBody {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface TaskState {
  /** Index of the delivery in progress. */
  delivery: number;
  carrying: boolean;
  crates: Vec3[];
  placed: boolean[];
  errors: number[];
  gates: string[];
  rings: string[];
  points: number;
  /** Points earned this frame, for the HUD. */
  events: PointEvent[];
  elapsed: number;
  started: boolean;
  score: RunScore | null;
  /** Id of the gate the drone flew into. */
  crashed: string | null;
  pinchLatch: boolean;
  ringFlash: string | null;
  dropFlash: number | null;
  last: Vec3 | null;
}

export function createTask(level: Level): TaskState {
  return {
    delivery: 0,
    carrying: false,
    crates: level.deliveries.map((d) => ({ ...d.pickup })),
    placed: level.deliveries.map(() => false),
    errors: [],
    gates: [],
    rings: [],
    points: 0,
    events: [],
    elapsed: 0,
    started: false,
    score: null,
    crashed: null,
    pinchLatch: false,
    ringFlash: null,
    dropFlash: null,
    last: null,
  };
}

export function restartTask(state: TaskState, level: Level): void {
  Object.assign(state, createTask(level));
}

/** Where the carried crate hangs under the drone. */
export function carriedPosition(body: TaskBody): Vec3 {
  return {
    x: body.x + Math.sin(body.yaw) * 0.2,
    y: Math.max(0.21, body.y - 0.7),
    z: body.z + Math.cos(body.yaw) * 0.2,
  };
}

export function cratePositions(state: TaskState, body: TaskBody): Vec3[] {
  return state.crates.map((c, i) => (state.carrying && i === state.delivery ? carriedPosition(body) : c));
}

const horizontal = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);

export function scoreOf(state: TaskState): RunScore {
  const errSum = state.errors.reduce((s, e) => s + e, 0);
  const penalty = errSum * RULES.placementPenalty;
  const bonus = state.rings.length * RULES.ringBonus;
  return {
    time: Math.max(0, state.elapsed + penalty - bonus),
    flight: state.elapsed,
    penalty,
    bonus,
    gates: state.gates.length,
    rings: state.rings.length,
    error: state.errors.length ? errSum / state.errors.length : 0,
    delivered: state.placed.filter(Boolean).length,
    points: state.points,
  };
}

/**
 * Advance one frame. `pinch` is the grab button; only its rising edge acts,
 * so the pinch that picks a crate up cannot also drop it. `t` is the level
 * clock that moving gates follow.
 */
export function stepTask(state: TaskState, body: TaskBody, pinch: boolean, dt: number, level: Level, t: number): void {
  state.ringFlash = null;
  state.events = [];
  state.dropFlash = null;
  const here: Vec3 = { x: body.x, y: body.y, z: body.z };
  const prev = state.last ?? here;
  state.last = here;
  if (state.score || state.crashed) {
    state.pinchLatch = pinch;
    return;
  }
  const rising = pinch && !state.pinchLatch;
  state.pinchLatch = pinch;
  if (state.started) state.elapsed += dt;

  for (const g of level.gates) {
    if (hitsGate(here, g, t)) {
      state.crashed = g.id;
      if (state.carrying) {
        state.carrying = false;
        state.crates[state.delivery] = { x: body.x, y: 0.21, z: body.z };
      }
      return;
    }
  }

  if (state.started) {
    for (const g of level.gates) {
      if (!state.gates.includes(g.id) && throughGate(prev, here, g, t)) {
        state.gates.push(g.id);
        award(state, `Gate ${g.id.slice(1)}`, POINTS.gate);
      }
    }
    for (const r of level.rings) {
      if (!state.rings.includes(r.id) && throughRing(prev, here, r)) {
        state.rings.push(r.id);
        state.ringFlash = r.id;
        award(state, "Ring", POINTS.ring);
      }
    }
  }

  const d = state.delivery;
  if (rising && !state.carrying) {
    const c = state.crates[d];
    if (horizontal(body, c) <= RULES.grabRadius && Math.abs(body.y - c.y) <= RULES.grabHeight) {
      state.carrying = true;
      state.started = true;
    }
  } else if (rising && state.carrying) {
    const drop = carriedPosition(body);
    const target = level.deliveries[d].pad;
    if (horizontal(drop, target) <= RULES.releaseRadius && drop.y <= target.y + RULES.releaseAltitude) {
      state.crates[d] = { x: drop.x, y: 0.21, z: drop.z };
      state.carrying = false;
      state.placed[d] = true;
      const error = horizontal(state.crates[d], target);
      state.errors.push(error);
      state.dropFlash = d;
      award(state, `Crate ${d + 1}`, deliveryPoints(error));
      state.delivery += 1;
      if (state.delivery >= level.deliveries.length) state.score = scoreOf(state);
    }
  }
}

function award(state: TaskState, label: string, points: number): void {
  state.points += points;
  state.events.push({ label, points });
}
