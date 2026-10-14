import { describe, expect, it } from "vitest";
import { LEVELS, gatePose, hitsGate, throughRing, windAt, type Gate } from "./levels";

const moving: Gate = { id: "M", x: 0, y: 3, z: 10, radius: 2, halfWidth: 3.6, crown: 1.4, thickness: 0.4, motion: { axis: "x", amp: 2, period: 4 } };

describe("levels", () => {
  it("every level has deliveries ordered along the course", () => {
    for (const l of LEVELS) {
      expect(l.deliveries.length).toBeGreaterThan(0);
      let z = 0;
      for (const d of l.deliveries) {
        expect(d.pickup.z).toBeGreaterThan(z);
        expect(d.pad.z).toBeGreaterThan(d.pickup.z);
        z = d.pad.z;
      }
    }
  });

  it("no gate wall sits on a crate or a pad", () => {
    for (const l of LEVELS) {
      for (const g of l.gates) {
        for (const d of l.deliveries) {
          expect(Math.abs(g.z - d.pickup.z)).toBeGreaterThan(3);
          expect(Math.abs(g.z - d.pad.z)).toBeGreaterThan(3);
        }
      }
    }
  });

  it("moving gates follow their motion", () => {
    expect(gatePose(moving, 0).x).toBeCloseTo(0);
    expect(gatePose(moving, 1).x).toBeCloseTo(2);
    expect(gatePose(moving, 3).x).toBeCloseTo(-2);
  });

  it("the hit test moves with the gate", () => {
    const center = { x: 0, y: 3, z: 10 };
    expect(hitsGate(center, moving, 0)).toBe(false);
    // A quarter period later the hole is centered at x = 2, so x = -1 is solid wall.
    expect(hitsGate({ x: -1, y: 3, z: 10 }, moving, 1)).toBe(true);
    expect(hitsGate({ x: -1, y: 3, z: 10 }, moving, 0)).toBe(false);
    expect(hitsGate({ x: 2, y: 3, z: 10 }, moving, 1)).toBe(false);
  });

  it("wind applies only inside its zone", () => {
    const wind = LEVELS.find((l) => l.wind.length)!;
    const w = wind.wind[0];
    expect(windAt(wind, w.x, w.z).x).toBe(w.vx);
    expect(windAt(wind, w.x, w.z + w.halfZ + 1).x).toBe(0);
  });

  it("detects flying through a ring between two frames", () => {
    const r = { id: "R", x: 0, y: 4, z: 20, radius: 1 };
    expect(throughRing({ x: 0, y: 4, z: 19.8 }, { x: 0.2, y: 4.1, z: 20.2 }, r)).toBe(true);
    expect(throughRing({ x: 2, y: 4, z: 19.8 }, { x: 2, y: 4, z: 20.2 }, r)).toBe(false);
    expect(throughRing({ x: 0, y: 4, z: 18 }, { x: 0, y: 4, z: 19 }, r)).toBe(false);
  });
});
