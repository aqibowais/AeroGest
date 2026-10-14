export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Sinusoidal drift of a gate along one axis. */
export interface Motion {
  axis: "x" | "y";
  amp: number;
  period: number;
  phase?: number;
}

export interface Gate {
  id: string;
  x: number;
  y: number;
  z: number;
  radius: number;
  halfWidth: number;
  crown: number;
  thickness: number;
  motion?: Motion;
}

export interface Delivery {
  pickup: Vec3;
  pad: Vec3;
}

/** A column of air that pushes the drone sideways, in m/s. */
export interface WindZone {
  id: string;
  x: number;
  z: number;
  halfX: number;
  halfZ: number;
  vx: number;
  vz: number;
}

/** Fly through for a time bonus. */
export interface BonusRing {
  id: string;
  x: number;
  y: number;
  z: number;
  radius: number;
}

export interface LabTheme {
  sky: number;
  ground: number;
  grid: number;
  spine: number;
  wall: number;
  ring: number;
  pad: number;
  padRing: number;
  hemiSky: number;
  hemiGround: number;
  sun: number;
  sunLevel: number;
  fogNear: number;
  fogFar: number;
}

export interface Level {
  id: string;
  name: string;
  blurb: string;
  tutorial?: boolean;
  deliveries: Delivery[];
  gates: Gate[];
  wind: WindZone[];
  rings: BonusRing[];
  theme: LabTheme;
}

export const SPAWN = { x: 0, y: 2.2, z: 0, yaw: 0 };

export const RULES = {
  grabRadius: 1.6,
  grabHeight: 2.3,
  releaseRadius: 3.4,
  releaseAltitude: 1.8,
  droneRadius: 0.55,
  /** Seconds removed per bonus ring. */
  ringBonus: 1.5,
  /** Seconds added per meter a crate lands off the pad center. */
  placementPenalty: 2,
};

const CRATE_Y = 0.37;
const PAD_Y = 0.02;
// Course distances are authored on a short grid and stretched, so there is
// room to see the drone and line up between walls.
const S = 1.8;

function gate(id: string, x: number, y: number, z: number, radius: number, motion?: Motion): Gate {
  return { id, x, y, z: z * S, radius, halfWidth: 3.6, crown: 1.45, thickness: 0.4, motion };
}

const crate = (x: number, z: number): Vec3 => ({ x, y: CRATE_Y, z: z * S });
const pad = (x: number, z: number): Vec3 => ({ x, y: PAD_Y, z: z * S });
const ring = (id: string, x: number, y: number, z: number, radius = 1.1): BonusRing => ({ id, x, y, z: z * S, radius });
const wind = (id: string, z: number, vx: number): WindZone => ({ id, x: 0, z: z * S, halfX: 9, halfZ: 3, vx, vz: 0 });

const DAY: LabTheme = {
  sky: 0xd7e4f2,
  ground: 0xe4d7c4,
  grid: 0xc9b79a,
  spine: 0xb08968,
  wall: 0xf3efe8,
  ring: 0x243e8a,
  pad: 0xf6efe6,
  padRing: 0xec5a26,
  hemiSky: 0xf7fbff,
  hemiGround: 0xe4d7c4,
  sun: 0xfff6ea,
  sunLevel: 1.15,
  fogNear: 42,
  fogFar: 130,
};

const GREEN: LabTheme = {
  ...DAY,
  sky: 0xd7efc8,
  ground: 0xd5e4b4,
  grid: 0xb7c98a,
  spine: 0x7f9a55,
  wall: 0xf7f4ec,
  ring: 0x2f7d4a,
  hemiSky: 0xf4fff0,
  hemiGround: 0xc5d6a4,
  sunLevel: 1.2,
};

const DUSK: LabTheme = {
  ...DAY,
  sky: 0xf1d6c4,
  ground: 0xd9c2ad,
  grid: 0xc0a283,
  wall: 0xf4ece4,
  ring: 0x7a2e8a,
  hemiSky: 0xffeedd,
  hemiGround: 0xc9ad94,
  sun: 0xffe2c4,
};

const NIGHT: LabTheme = {
  sky: 0x1b2438,
  ground: 0x2c3344,
  grid: 0x3e4a63,
  spine: 0xe0a15a,
  wall: 0x3a4256,
  ring: 0xf0b429,
  pad: 0x241c18,
  padRing: 0xf0b429,
  hemiSky: 0x8ea0c8,
  hemiGround: 0x1a1420,
  sun: 0xffe0b0,
  sunLevel: 0.6,
  fogNear: 30,
  fogFar: 110,
};

export const LEVELS: Level[] = [
  {
    id: "school",
    name: "Flight school",
    blurb: "Learn the controls one at a time. No gates, one crate.",
    tutorial: true,
    deliveries: [{ pickup: crate(0, 10), pad: pad(0, 26) }],
    gates: [],
    wind: [],
    rings: [],
    theme: GREEN,
  },
  {
    id: "courtyard",
    name: "Courtyard",
    blurb: "Three wide gates and a bonus ring.",
    deliveries: [{ pickup: crate(0, 6), pad: pad(0, 42) }],
    gates: [gate("G1", 0, 2.8, 14, 2.3), gate("G2", 3.2, 4.6, 24, 2.15), gate("G3", -2.6, 3.2, 33, 2.2)],
    wind: [],
    rings: [ring("R1", 1.6, 3.8, 19)],
    theme: GREEN,
  },
  {
    id: "range",
    name: "Two drops",
    blurb: "Two crates, two pads. Plan the line between them.",
    deliveries: [
      { pickup: crate(0, 8), pad: pad(-5, 36) },
      { pickup: crate(5, 41), pad: pad(0, 74) },
    ],
    gates: [gate("G1", 0, 3, 18, 2.15), gate("G2", -3.2, 5.4, 28, 1.95), gate("G3", 2.6, 3.4, 52, 2), gate("G4", -1.5, 5.8, 63, 1.9)],
    wind: [],
    rings: [
      ring("R1", -1.6, 4.2, 23),
      ring("R2", 0.6, 4.6, 57.5),
    ],
    theme: DAY,
  },
  {
    id: "shift",
    name: "Shifting gates",
    blurb: "The gates slide and bob. Time the pass.",
    deliveries: [
      { pickup: crate(0, 8), pad: pad(4, 40) },
      { pickup: crate(-4, 45), pad: pad(0, 78) },
    ],
    gates: [
      gate("G1", 0, 3.2, 18, 2.1, { axis: "x", amp: 2.4, period: 7 }),
      gate("G2", 2, 4.4, 29, 2, { axis: "y", amp: 1.4, period: 5, phase: 1.2 }),
      gate("G3", -1, 3.6, 55, 2, { axis: "x", amp: 2.6, period: 6.5, phase: 2 }),
      gate("G4", 1, 4.6, 66, 1.95, { axis: "y", amp: 1.6, period: 5.5 }),
    ],
    wind: [],
    rings: [ring("R1", 0, 4.2, 61)],
    theme: DUSK,
  },
  {
    id: "wind",
    name: "Crosswind",
    blurb: "Gusts push you sideways. Three crates to deliver.",
    deliveries: [
      { pickup: crate(0, 8), pad: pad(-4, 30) },
      { pickup: crate(4, 34), pad: pad(4, 58) },
      { pickup: crate(-3, 62), pad: pad(0, 88) },
    ],
    gates: [
      gate("G1", 0, 3.2, 20, 2.1),
      gate("G2", 3.5, 3.8, 46, 2),
      gate("G3", -1.5, 4.2, 75, 1.95, { axis: "y", amp: 1.2, period: 6 }),
    ],
    wind: [
      wind("W1", 14, 2.2),
      wind("W2", 40, -2.6),
      wind("W3", 69, 2.4),
    ],
    rings: [
      ring("R1", 2, 4, 52),
      ring("R2", -1, 4.2, 81),
    ],
    theme: DAY,
  },
  {
    id: "night",
    name: "Night run",
    blurb: "Tight, moving rings under work lights.",
    deliveries: [
      { pickup: crate(0, 8), pad: pad(3, 32) },
      { pickup: crate(-3, 36), pad: pad(-3, 60) },
      { pickup: crate(3, 64), pad: pad(0, 92) },
    ],
    gates: [
      gate("G1", 0, 3.2, 18, 1.6, { axis: "x", amp: 1.8, period: 6 }),
      gate("G2", 0, 3.6, 46, 1.55, { axis: "y", amp: 1.2, period: 5 }),
      gate("G3", 1.5, 3.6, 74, 1.5, { axis: "x", amp: 2, period: 6.5, phase: 1 }),
      gate("G4", 1, 4.2, 84, 1.55),
    ],
    wind: [wind("W1", 52, 2)],
    rings: [
      ring("R1", 1.5, 4.2, 26, 1),
      ring("R2", 0, 4.4, 79, 1),
    ],
    theme: NIGHT,
  },
];

export function levelById(id: string): Level {
  return LEVELS.find((l) => l.id === id) ?? LEVELS[0];
}

/** Far end of the playable strip. */
export function levelEnd(level: Level): number {
  return Math.max(...level.deliveries.map((d) => d.pad.z)) + 14;
}

/** Gate center at time t (seconds since launch). */
export function gatePose(g: Gate, t: number): { x: number; y: number } {
  if (!g.motion) return { x: g.x, y: g.y };
  const off = g.motion.amp * Math.sin((2 * Math.PI * t) / g.motion.period + (g.motion.phase ?? 0));
  return g.motion.axis === "x" ? { x: g.x + off, y: g.y } : { x: g.x, y: g.y + off };
}

export function gateTop(g: Gate, t = 0): number {
  return gatePose(g, t).y + g.radius + g.crown;
}

/** True when the segment prev -> cur crosses the gate plane inside the hole. */
export function throughGate(prev: Vec3, cur: Vec3, g: Gate, t = 0): boolean {
  if (prev.z >= g.z || cur.z < g.z) return false;
  const k = (g.z - prev.z) / (cur.z - prev.z);
  const c = gatePose(g, t);
  return Math.hypot(prev.x + (cur.x - prev.x) * k - c.x, prev.y + (cur.y - prev.y) * k - c.y) <= g.radius;
}

/** True when the drone body is in the wall around a gate, and not inside the hole. */
export function hitsGate(pos: Vec3, g: Gate, t = 0, droneRadius = RULES.droneRadius): boolean {
  const depth = g.thickness * 0.5 + droneRadius * 0.35;
  if (Math.abs(pos.z - g.z) > depth) return false;
  const c = gatePose(g, t);
  const dx = pos.x - c.x;
  const dy = pos.y - c.y;
  if (Math.hypot(dx, dy) <= g.radius - droneRadius * 0.15) return false;
  if (pos.y > c.y + g.radius + g.crown) return false;
  if (Math.abs(dx) > g.halfWidth) return false;
  if (pos.y < 0) return false;
  return true;
}

export function windAt(level: Level, x: number, z: number): { x: number; z: number } {
  let wx = 0;
  let wz = 0;
  for (const w of level.wind) {
    if (Math.abs(x - w.x) <= w.halfX && Math.abs(z - w.z) <= w.halfZ) {
      wx += w.vx;
      wz += w.vz;
    }
  }
  return { x: wx, z: wz };
}

export function throughRing(prev: Vec3, cur: Vec3, r: BonusRing): boolean {
  if (!((prev.z - r.z) * (cur.z - r.z) <= 0) || prev.z === cur.z) return false;
  const k = (r.z - prev.z) / (cur.z - prev.z);
  const x = prev.x + (cur.x - prev.x) * k;
  const y = prev.y + (cur.y - prev.y) * k;
  return Math.hypot(x - r.x, y - r.y) <= r.radius;
}
