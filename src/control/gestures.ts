import type { ControlCommand, Point } from "./mapping";
import { ZERO_COMMAND } from "./mapping";

/**
 * Hand poses to drone commands.
 *
 *   open hand     forward        thumb to your right   slide right
 *   thumbs down   backward       thumb to your left    slide left
 *   one finger    climb          pinch                 stop and hover
 *   two fingers   descend        fist                  grab / release
 *   thumbs up     climb
 *
 * Three layers, each testable on its own:
 *  1. features(): finger bend from 3D joint angles (rotation independent),
 *     thumb extension and direction in the mirrored view, pinch in cm.
 *  2. classify(): MediaPipe's trained gesture classes where they apply and are
 *     confident, geometric rules otherwise; a personal k-NN model, if the
 *     player trained one, takes precedence when it is sure.
 *  3. PoseFilter: a pose has to win most of the recent frames before the
 *     drone follows it, except "stop", which wins faster.
 */

export interface HandFrame {
  /** 21 normalized image landmarks, raw camera orientation (not mirrored). */
  landmarks: readonly Point[];
  /** 21 world landmarks in meters, or null. */
  world: readonly Point[] | null;
  /** Top gesture-model category, e.g. "Closed_Fist", "Open_Palm", "None". */
  gesture: string;
  score: number;
}

export type Pose = "forward" | "back" | "up" | "down" | "left" | "right" | "stop" | "grab" | "none";
export const POSES: Exclude<Pose, "none">[] = ["forward", "back", "up", "down", "left", "right", "stop", "grab"];

export const POSE_LABEL: Record<Pose, string> = {
  forward: "Forward",
  back: "Backward",
  up: "Climb",
  down: "Descend",
  left: "Left",
  right: "Right",
  stop: "Stop",
  grab: "Grab",
  none: "Hover",
};

export const POSE_HOW: Record<Exclude<Pose, "none">, string> = {
  forward: "Open hand, all fingers up",
  back: "Thumbs down",
  up: "One finger up (or thumbs up)",
  down: "Two fingers up, a V",
  left: "Fist, thumb pointing to your left",
  right: "Fist, thumb pointing to your right",
  stop: "Pinch thumb and index together",
  grab: "Closed fist",
};

export interface Features {
  /** Bend at the middle joint of index, middle, ring, pinky, degrees. */
  bend: number[];
  extended: boolean[];
  curled: boolean[];
  thumbOut: boolean;
  /** Thumb direction in the mirrored (selfie) view. */
  thumbDir: "up" | "down" | "left" | "right";
  pinchCm: number;
  /** Index tip distance from the wrist, in palm lengths. */
  indexReach: number;
}

const FINGERS: ReadonlyArray<readonly [number, number, number]> = [
  [5, 6, 8],
  [9, 10, 12],
  [13, 14, 16],
  [17, 18, 20],
];

const sub = (a: Point, b: Point) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (v: Point) => Math.hypot(v.x, v.y, v.z);
const dist = (a: Point, b: Point) => len(sub(a, b));
function angle(a: Point, b: Point): number {
  const d = (a.x * b.x + a.y * b.y + a.z * b.z) / Math.max(1e-9, len(a) * len(b));
  return (Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI;
}

/** Points to measure shape on: world landmarks when present (true 3D), else image. */
function shapePoints(f: HandFrame): readonly Point[] {
  return f.world && f.world.length >= 21 ? f.world : f.landmarks;
}

export function features(frame: HandFrame): Features {
  const p = shapePoints(frame);
  const palm = Math.max(1e-6, dist(p[0], p[9]));
  const bend = FINGERS.map(([mcp, pip, tip]) => angle(sub(p[pip], p[mcp]), sub(p[tip], p[pip])));
  const tipFar = FINGERS.map(([, pip, tip]) => dist(p[tip], p[0]) > dist(p[pip], p[0]));
  const extended = bend.map((b, i) => b < 50 && tipFar[i]);
  const curled = bend.map((b, i) => b > 80 || !tipFar[i]);

  // Thumb: in a fist its tip rests on the curled index and middle fingers;
  // pointing up or sideways it is well clear of them. Distance to the knuckle
  // alone does not separate the two, since a thumbs-up tip sits only ~3.5 cm
  // above the index knuckle.
  const thumbStraight = angle(sub(p[3], p[2]), sub(p[4], p[3])) < 60;
  const clearance = Math.min(dist(p[4], p[6]), dist(p[4], p[10]), dist(p[4], p[7]));
  const thumbOut = thumbStraight && clearance > 0.45 * palm;

  // Direction from thumb base to tip in the mirrored image: user's right is +x.
  const lm = frame.landmarks;
  const dx = -(lm[4].x - lm[2].x);
  const dy = lm[4].y - lm[2].y;
  let thumbDir: Features["thumbDir"];
  if (Math.abs(dx) > Math.abs(dy) * 1.1) thumbDir = dx > 0 ? "right" : "left";
  else thumbDir = dy < 0 ? "up" : "down";

  const pinchCm = frame.world
    ? dist(frame.world[4], frame.world[8]) * 100
    : (Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y) / Math.max(1e-6, Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y))) * 9;
  return { bend, extended, curled, thumbOut, thumbDir, pinchCm, indexReach: dist(p[8], p[0]) / palm };
}

const MODEL_MIN = 0.6;

/** Single-frame pose. `personal` is consulted first when it is confident. */
export function classify(frame: HandFrame, personal?: PersonalModel | null): { pose: Pose; source: "personal" | "model" | "rules"; f: Features } {
  const f = features(frame);
  if (personal?.ready) {
    const guess = personal.predict(frame);
    if (guess && guess.confidence >= 0.8) return { pose: guess.pose, source: "personal", f };
  }

  // Pinch first: thumb and index tips touching with the index reaching out
  // (in a fist the index tip is tucked near the palm instead).
  if (f.pinchCm < 3.2 && f.indexReach > 1.0) return { pose: "stop", source: "rules", f };

  const four = f.curled.every(Boolean);
  const m = frame.score >= MODEL_MIN ? frame.gesture : "None";
  const fistLike = m === "Closed_Fist" || m === "Thumb_Up" || m === "Thumb_Down" || four;
  if (fistLike) {
    if (f.thumbOut && (f.thumbDir === "left" || f.thumbDir === "right")) return { pose: f.thumbDir, source: m === "None" ? "rules" : "model", f };
    if (m === "Thumb_Up" || (f.thumbOut && f.thumbDir === "up")) return { pose: "up", source: m === "None" ? "rules" : "model", f };
    if (m === "Thumb_Down" || (f.thumbOut && f.thumbDir === "down")) return { pose: "back", source: m === "None" ? "rules" : "model", f };
    if (m === "Closed_Fist" || four) return { pose: "grab", source: m === "None" ? "rules" : "model", f };
  }
  if (m === "Open_Palm") return { pose: "forward", source: "model", f };
  if (m === "Pointing_Up") return { pose: "up", source: "model", f };
  if (m === "Victory") return { pose: "down", source: "model", f };

  const [i, mid, ring, pinky] = f.extended;
  const n = f.extended.filter(Boolean).length;
  if (n >= 4 || (n === 3 && i && mid && ring)) return { pose: "forward", source: "rules", f };
  if (i && mid && !ring && !pinky) return { pose: "down", source: "rules", f };
  if (i && !mid && !ring && !pinky) return { pose: "up", source: "rules", f };
  return { pose: "none", source: "rules", f };
}

/**
 * Majority vote over the last frames. A new pose takes over once it holds
 * `need` of the last `window` frames; "stop" needs fewer, so braking is quick.
 */
export class PoseFilter {
  pose: Pose = "none";
  /** 0..1, how close the leading candidate is to taking over. */
  progress = 0;
  candidate: Pose = "none";
  private history: Pose[] = [];

  constructor(private readonly window = 7, private readonly need = 5, private readonly needStop = 3) {}

  reset(): void {
    this.pose = "none";
    this.history = [];
    this.progress = 0;
  }

  push(p: Pose | null): Pose {
    if (p === null) {
      this.reset();
      return this.pose;
    }
    this.history.push(p);
    if (this.history.length > this.window) this.history.shift();
    const counts = new Map<Pose, number>();
    for (const h of this.history) counts.set(h, (counts.get(h) ?? 0) + 1);
    let best: Pose = this.pose;
    let bestN = 0;
    for (const [k, v] of counts) if (v > bestN) [best, bestN] = [k, v];
    // Stop wins on fewer votes than everything else, so check it first.
    const stops = counts.get("stop") ?? 0;
    if (stops >= this.needStop) [best, bestN] = ["stop", stops];
    const need = best === "stop" ? this.needStop : this.need;
    this.candidate = best;
    this.progress = best === this.pose ? 1 : Math.min(1, bestN / need);
    if (best !== this.pose && bestN >= need) this.pose = best;
    return this.pose;
  }
}

/** Pose to stick. `power` scales every axis. */
export function commandFor(pose: Pose, power = 0.6): ControlCommand {
  switch (pose) {
    case "forward":
      return { ...ZERO_COMMAND, forward: power };
    case "back":
      return { ...ZERO_COMMAND, forward: -power };
    case "up":
      return { ...ZERO_COMMAND, altitude: power };
    case "down":
      return { ...ZERO_COMMAND, altitude: -power };
    case "left":
      return { ...ZERO_COMMAND, strafe: -power };
    case "right":
      return { ...ZERO_COMMAND, strafe: power };
    case "grab":
      return { ...ZERO_COMMAND, pinch: true };
    default:
      return ZERO_COMMAND;
  }
}


/**
 * Hand-shape vector: 3D landmarks relative to the wrist, x mirrored to the
 * selfie view, scaled by palm length, plus the image-plane thumb direction
 * (which world landmarks alone do not fix).
 */
export function embed(frame: HandFrame): number[] {
  const p = shapePoints(frame);
  const palm = Math.max(1e-6, dist(p[0], p[9]));
  const out: number[] = [];
  for (const q of p) out.push(-(q.x - p[0].x) / palm, (q.y - p[0].y) / palm, (q.z - p[0].z) / palm);
  const lm = frame.landmarks;
  const tx = -(lm[4].x - lm[2].x);
  const ty = lm[4].y - lm[2].y;
  const tl = Math.max(1e-6, Math.hypot(tx, ty));
  out.push((3 * tx) / tl, (3 * ty) / tl);
  return out;
}

export interface Sample {
  pose: Exclude<Pose, "none">;
  v: number[];
}

/** k-nearest-neighbours on embed() vectors, trained in the browser from a few seconds per pose. */
export class PersonalModel {
  samples: Sample[] = [];
  constructor(private readonly k = 5) {}

  get ready(): boolean {
    return new Set(this.samples.map((s) => s.pose)).size >= 2;
  }

  add(pose: Exclude<Pose, "none">, frame: HandFrame): void {
    this.samples.push({ pose, v: embed(frame) });
  }

  clear(pose?: Exclude<Pose, "none">): void {
    this.samples = pose ? this.samples.filter((s) => s.pose !== pose) : [];
  }

  private vote(v: number[], skip = -1): { pose: Exclude<Pose, "none">; confidence: number } | null {
    const d: { i: number; d: number }[] = [];
    this.samples.forEach((s, i) => {
      if (i === skip) return;
      let acc = 0;
      for (let j = 0; j < v.length; j += 1) acc += (v[j] - s.v[j]) ** 2;
      d.push({ i, d: acc });
    });
    if (!d.length) return null;
    d.sort((a, b) => a.d - b.d);
    const top = d.slice(0, this.k);
    const counts = new Map<Exclude<Pose, "none">, number>();
    for (const t of top) {
      const p = this.samples[t.i].pose;
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    let pose = this.samples[top[0].i].pose;
    let n = 0;
    for (const [k, c] of counts) if (c > n) [pose, n] = [k, c];
    return { pose, confidence: n / top.length };
  }

  predict(frame: HandFrame): { pose: Exclude<Pose, "none">; confidence: number } | null {
    return this.vote(embed(frame));
  }

  /** Leave-one-out accuracy per pose: how often each recorded frame is recognised from the rest. */
  accuracy(): Partial<Record<Exclude<Pose, "none">, number>> {
    const hit = new Map<string, number>();
    const total = new Map<string, number>();
    this.samples.forEach((s, i) => {
      total.set(s.pose, (total.get(s.pose) ?? 0) + 1);
      if (this.vote(s.v, i)?.pose === s.pose) hit.set(s.pose, (hit.get(s.pose) ?? 0) + 1);
    });
    const out: Partial<Record<Exclude<Pose, "none">, number>> = {};
    for (const [p, t] of total) out[p as Exclude<Pose, "none">] = (hit.get(p) ?? 0) / t;
    return out;
  }

  toJSON(): Sample[] {
    return this.samples.map((s) => ({ pose: s.pose, v: s.v.map((x) => Math.round(x * 1000) / 1000) }));
  }

  static from(samples: Sample[]): PersonalModel {
    const m = new PersonalModel();
    m.samples = samples;
    return m;
  }
}
