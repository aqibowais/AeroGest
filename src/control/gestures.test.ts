import { describe, expect, it } from "vitest";
import { PersonalModel, PoseFilter, POSES, classify, commandFor, features, type HandFrame, type Pose } from "./gestures";
import type { Point } from "./mapping";

/**
 * Synthetic hand in anatomical units (meters). Hand space: fingers along +y,
 * thumb on +x. World and image landmarks follow MediaPipe's camera axes
 * (x right in the raw image, y down), so hand +x is the user's right in the
 * mirrored view.
 */
type Thumb = "open" | "tucked" | "side" | "up" | "down" | "pinch";
interface Spec {
  curl?: [number, number, number, number];
  thumb?: Thumb;
  leftHand?: boolean;
  gesture?: string;
  score?: number;
}

const MCP: Array<[number, number]> = [
  [0.03, 0.085],
  [0.008, 0.09],
  [-0.013, 0.085],
  [-0.032, 0.075],
];
const SEG = [
  [0.04, 0.025, 0.02],
  [0.045, 0.028, 0.02],
  [0.042, 0.026, 0.02],
  [0.032, 0.02, 0.018],
];
const UP = 0.05;
const DOWN = 1.45;

function hand(spec: Spec = {}): HandFrame {
  const curl = spec.curl ?? [UP, UP, UP, UP];
  const h: Point[] = new Array(21);
  h[0] = { x: 0, y: 0, z: 0 };
  MCP.forEach(([mx, my], f) => {
    let pos = { x: mx, y: my, z: 0 };
    h[5 + f * 4] = pos;
    let theta = 0;
    for (let j = 0; j < 3; j += 1) {
      theta += curl[f];
      pos = { x: pos.x, y: pos.y + SEG[f][j] * Math.cos(theta), z: pos.z - SEG[f][j] * Math.sin(theta) };
      h[5 + f * 4 + j + 1] = pos;
    }
  });
  h[1] = { x: 0.02, y: 0.02, z: 0 };
  h[2] = { x: 0.045, y: 0.04, z: 0 };
  const thumb = spec.thumb ?? "open";
  if (thumb === "open") {
    h[3] = { x: 0.065, y: 0.06, z: 0 };
    h[4] = { x: 0.08, y: 0.08, z: 0 };
  } else if (thumb === "tucked") {
    h[3] = { x: 0.035, y: 0.06, z: -0.02 };
    h[4] = { x: 0.012, y: 0.062, z: -0.035 };
  } else if (thumb === "side") {
    h[3] = { x: 0.08, y: 0.045, z: 0 };
    h[4] = { x: 0.11, y: 0.048, z: 0 };
  } else if (thumb === "down") {
    // Thumbs down: the whole fist turned over, so the thumb points along -y.
    h[2] = { x: 0.035, y: 0.017, z: 0 };
    h[3] = { x: 0.038, y: -0.013, z: 0 };
    h[4] = { x: 0.04, y: -0.038, z: 0 };
  } else if (thumb === "up") {
    // Metacarpal 4.5 cm, proximal 3 cm, distal 2.5 cm, pointing up.
    h[2] = { x: 0.035, y: 0.063, z: 0 };
    h[3] = { x: 0.038, y: 0.093, z: 0 };
    h[4] = { x: 0.04, y: 0.118, z: 0 };
  } else {
    const tip = h[8];
    h[3] = { x: tip.x + 0.02, y: tip.y - 0.02, z: tip.z };
    h[4] = { x: tip.x + 0.006, y: tip.y - 0.004, z: tip.z };
  }
  const sx = spec.leftHand ? 1 : -1;
  const world = h.map((p) => ({ x: sx * p.x, y: -p.y, z: p.z }));
  const landmarks = world.map((w) => ({ x: 0.5 + w.x * 1.6, y: 0.7 + w.y * 1.6, z: w.z }));
  return { landmarks, world, gesture: spec.gesture ?? "None", score: spec.score ?? 0 };
}

const FIST: [number, number, number, number] = [DOWN, DOWN, DOWN, DOWN];
const rules = (spec: Spec) => classify(hand(spec)).pose;

describe("features", () => {
  it("reads finger extension from joint angles", () => {
    expect(features(hand()).extended).toEqual([true, true, true, true]);
    expect(features(hand({ curl: FIST, thumb: "tucked" })).curled).toEqual([true, true, true, true]);
    expect(features(hand({ curl: [UP, DOWN, DOWN, DOWN] })).extended).toEqual([true, false, false, false]);
  });

  it("thumb direction is in the mirrored view: hand +x is the user's right", () => {
    expect(features(hand({ curl: FIST, thumb: "side" })).thumbDir).toBe("right");
    expect(features(hand({ curl: FIST, thumb: "side", leftHand: true })).thumbDir).toBe("left");
    expect(features(hand({ curl: FIST, thumb: "up" })).thumbDir).toBe("up");
  });

  it("measures the pinch gap in centimeters", () => {
    expect(features(hand({ thumb: "pinch", curl: [0.3, UP, UP, UP] })).pinchCm).toBeLessThan(1.5);
    expect(features(hand()).pinchCm).toBeGreaterThan(5);
  });
});

describe("classify, rules only (model unsure)", () => {
  it("open hand flies forward", () => expect(rules({})).toBe("forward"));
  it("one finger climbs", () => expect(rules({ curl: [UP, DOWN, DOWN, DOWN], thumb: "tucked" })).toBe("up"));
  it("two fingers descend", () => expect(rules({ curl: [UP, UP, DOWN, DOWN], thumb: "tucked" })).toBe("down"));
  it("thumb to the right slides right", () => expect(rules({ curl: FIST, thumb: "side" })).toBe("right"));
  it("thumb to the left slides left", () => expect(rules({ curl: FIST, thumb: "side", leftHand: true })).toBe("left"));
  it("thumbs up climbs", () => expect(rules({ curl: FIST, thumb: "up" })).toBe("up"));
  it("thumbs down flies backward", () => expect(rules({ curl: FIST, thumb: "down" })).toBe("back"));
  it("fist grabs", () => expect(rules({ curl: FIST, thumb: "tucked" })).toBe("grab"));
  it("pinch stops, with the other fingers up or down", () => {
    expect(rules({ thumb: "pinch", curl: [0.3, UP, UP, UP] })).toBe("stop");
    expect(rules({ thumb: "pinch", curl: [0.3, DOWN, DOWN, DOWN] })).toBe("stop");
  });
});

describe("classify with the gesture model", () => {
  it("the model's Thumb_Down flies backward", () => {
    expect(classify(hand({ curl: FIST, thumb: "down", gesture: "Thumb_Down", score: 0.9 })).pose).toBe("back");
  });

  it("trusts confident model classes", () => {
    expect(classify(hand({ gesture: "Open_Palm", score: 0.9 })).pose).toBe("forward");
    expect(classify(hand({ curl: [UP, DOWN, DOWN, DOWN], gesture: "Pointing_Up", score: 0.9 })).pose).toBe("up");
    expect(classify(hand({ curl: [UP, UP, DOWN, DOWN], gesture: "Victory", score: 0.9 })).pose).toBe("down");
  });

  it("a fist the model calls Closed_Fist still slides when the thumb points sideways", () => {
    expect(classify(hand({ curl: FIST, thumb: "side", gesture: "Closed_Fist", score: 0.8 })).pose).toBe("right");
    expect(classify(hand({ curl: FIST, thumb: "tucked", gesture: "Closed_Fist", score: 0.8 })).pose).toBe("grab");
  });

  it("a sideways thumb the model calls Thumb_Up slides, it does not climb", () => {
    expect(classify(hand({ curl: FIST, thumb: "side", leftHand: true, gesture: "Thumb_Up", score: 0.8 })).pose).toBe("left");
  });

  it("pinch beats the model's guess", () => {
    expect(classify(hand({ thumb: "pinch", curl: [0.3, UP, UP, UP], gesture: "Open_Palm", score: 0.7 })).pose).toBe("stop");
  });
});

describe("PoseFilter", () => {
  it("switches only after most recent frames agree", () => {
    const f = new PoseFilter();
    for (let i = 0; i < 7; i += 1) f.push("forward");
    expect(f.pose).toBe("forward");
    f.push("grab");
    f.push("forward");
    f.push("grab");
    expect(f.pose).toBe("forward");
    for (let i = 0; i < 5; i += 1) f.push("grab");
    expect(f.pose).toBe("grab");
  });

  it("stop takes over faster", () => {
    const f = new PoseFilter();
    for (let i = 0; i < 7; i += 1) f.push("forward");
    for (let i = 0; i < 3; i += 1) f.push("stop");
    expect(f.pose).toBe("stop");
  });

  it("losing the hand hovers", () => {
    const f = new PoseFilter();
    for (let i = 0; i < 7; i += 1) f.push("forward");
    expect(f.push(null)).toBe("none");
  });
});

describe("commands", () => {
  const cases: Array<[Pose, Partial<Record<string, number | boolean>>]> = [
    ["forward", { forward: 0.6 }],
    ["back", { forward: -0.6 }],
    ["up", { altitude: 0.6 }],
    ["down", { altitude: -0.6 }],
    ["left", { strafe: -0.6 }],
    ["right", { strafe: 0.6 }],
    ["grab", { pinch: true }],
    ["stop", { forward: 0, strafe: 0, altitude: 0, pinch: false }],
  ];
  for (const [pose, want] of cases) it(`${pose} maps to the stick`, () => expect(commandFor(pose)).toMatchObject(want));
});

describe("PersonalModel", () => {
  it("learns a player's poses and reports leave-one-out accuracy", () => {
    const m = new PersonalModel();
    const specs: Record<string, Spec> = {
      forward: {},
      up: { curl: [UP, DOWN, DOWN, DOWN], thumb: "tucked" },
      down: { curl: [UP, UP, DOWN, DOWN], thumb: "tucked" },
      grab: { curl: FIST, thumb: "tucked" },
      right: { curl: FIST, thumb: "side" },
    };
    for (const [pose, spec] of Object.entries(specs)) {
      for (let i = 0; i < 8; i += 1) {
        const f = hand(spec);
        // Small per-frame jitter, like a real hand.
        const j = (p: Point) => ({ x: p.x + (Math.random() - 0.5) * 0.004, y: p.y + (Math.random() - 0.5) * 0.004, z: p.z });
        m.add(pose as (typeof POSES)[number], { ...f, world: f.world!.map(j), landmarks: f.landmarks.map(j) });
      }
    }
    expect(m.ready).toBe(true);
    expect(m.predict(hand(specs.down))?.pose).toBe("down");
    expect(m.predict(hand(specs.right))?.pose).toBe("right");
    const acc = m.accuracy();
    for (const p of Object.keys(specs)) expect(acc[p as (typeof POSES)[number]]).toBeGreaterThan(0.9);
    expect(PersonalModel.from(m.toJSON()).predict(hand(specs.grab))?.pose).toBe("grab");
  });
});
