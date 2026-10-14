import { describe, expect, it } from "vitest";
import { LEVELS } from "../course/levels";
import { flyReference, medalFor } from "./reference";

describe("autopilot", () => {
  for (const level of LEVELS) {
    it(`delivers every crate on ${level.name} without clipping a gate`, () => {
      const run = flyReference(level);
      expect(run.task.crashed).toBeNull();
      expect(run.score).not.toBeNull();
      expect(run.score!.delivered).toBe(level.deliveries.length);
      expect(run.score!.gates).toBe(level.gates.length);
      expect(run.score!.error).toBeLessThan(0.6);
      expect(run.score!.rings).toBe(level.rings.length);
    });
  }

  it("is deterministic, so the ghost and the medals are stable", () => {
    const a = flyReference(LEVELS[3]);
    const b = flyReference(LEVELS[3]);
    expect(a.score!.time).toBe(b.score!.time);
  });

  it("awards medals against the reference time", () => {
    expect(medalFor(20, 20)).toBe("gold");
    expect(medalFor(27, 20)).toBe("silver");
    expect(medalFor(37, 20)).toBe("bronze");
    expect(medalFor(60, 20)).toBeNull();
  });
});
