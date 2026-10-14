import { describe, expect, it } from "vitest";
import type { Level } from "./levels";
import { POINTS, deliveryPoints } from "./points";
import { createTask, cratePositions, stepTask } from "./task";

const level: Level = {
  id: "t",
  name: "test",
  blurb: "",
  deliveries: [
    { pickup: { x: 0, y: 0.37, z: 5 }, pad: { x: 0, y: 0.02, z: 20 } },
    { pickup: { x: 0, y: 0.37, z: 25 }, pad: { x: 0, y: 0.02, z: 40 } },
  ],
  gates: [{ id: "G", x: 0, y: 3, z: 12, radius: 2, halfWidth: 3.6, crown: 1.4, thickness: 0.4 }],
  wind: [],
  rings: [{ id: "R", x: 0, y: 3, z: 16, radius: 1 }],
  theme: {} as Level["theme"],
};

const at = (x: number, y: number, z: number) => ({ x, y, z, yaw: 0 });
const DT = 1 / 60;

function press(task: ReturnType<typeof createTask>, body: ReturnType<typeof at>) {
  stepTask(task, body, true, DT, level, 0);
  stepTask(task, body, false, DT, level, 0);
}

describe("task", () => {
  it("grab needs to be over the crate", () => {
    const task = createTask(level);
    press(task, at(0, 1.6, 10));
    expect(task.carrying).toBe(false);
    press(task, at(0, 1.6, 5));
    expect(task.carrying).toBe(true);
    expect(task.started).toBe(true);
  });

  it("the same pinch cannot grab and drop", () => {
    const task = createTask(level);
    for (let i = 0; i < 10; i += 1) stepTask(task, at(0, 1.6, 5), true, DT, level, 0);
    expect(task.carrying).toBe(true);
  });

  it("delivers crates in order and scores when the last one lands", () => {
    const task = createTask(level);
    press(task, at(0, 1.6, 5));
    press(task, at(0.5, 1.4, 20));
    expect(task.placed).toEqual([true, false]);
    expect(task.delivery).toBe(1);
    // Crate 2 cannot be grabbed from crate 1's spot.
    press(task, at(0, 1.6, 5));
    expect(task.carrying).toBe(false);
    press(task, at(0, 1.6, 25));
    press(task, at(0, 1.4, 40));
    expect(task.score).not.toBeNull();
    expect(task.score!.delivered).toBe(2);
    expect(task.score!.error).toBeGreaterThan(0);
  });

  it("the carried crate hangs under the drone", () => {
    const task = createTask(level);
    press(task, at(0, 1.6, 5));
    const [carried, waiting] = cratePositions(task, at(3, 4, 9));
    expect(carried.x).toBeCloseTo(3);
    expect(carried.y).toBeCloseTo(3.3);
    expect(waiting.z).toBe(25);
  });

  it("flying into a wall crashes the run and drops the crate", () => {
    const task = createTask(level);
    press(task, at(0, 1.6, 5));
    stepTask(task, at(3, 3, 12), false, DT, level, 0);
    expect(task.crashed).toBe("G");
    expect(task.carrying).toBe(false);
    expect(task.crates[0].z).toBe(12);
    press(task, at(0, 1.4, 20));
    expect(task.placed[0]).toBe(false);
  });

  it("scores gates, rings and deliveries", () => {
    const task = createTask(level);
    press(task, at(0, 1.6, 5));
    stepTask(task, at(0, 3, 11.9), false, DT, level, 0);
    stepTask(task, at(0, 3, 12.3), false, DT, level, 0);
    expect(task.gates).toEqual(["G"]);
    expect(task.points).toBe(POINTS.gate);
    stepTask(task, at(0, 3, 16.1), false, DT, level, 0);
    expect(task.points).toBe(POINTS.gate + POINTS.ring);
    press(task, at(0, 1.4, 20));
    expect(task.points).toBe(POINTS.gate + POINTS.ring + deliveryPoints(task.errors[0]));
    expect(deliveryPoints(0)).toBe(POINTS.delivery + POINTS.accuracy);
  });

  it("flying through a ring is a bonus", () => {
    const task = createTask(level);
    press(task, at(0, 1.6, 5));
    stepTask(task, at(0, 3, 15.9), false, DT, level, 0);
    stepTask(task, at(0, 3, 16.1), false, DT, level, 0);
    expect(task.rings).toEqual(["R"]);
  });

  it("the timer runs from the first pickup", () => {
    const task = createTask(level);
    for (let i = 0; i < 60; i += 1) stepTask(task, at(0, 2, 0), false, DT, level, 0);
    expect(task.elapsed).toBe(0);
    press(task, at(0, 1.6, 5));
    for (let i = 0; i < 60; i += 1) stepTask(task, at(0, 2, 6), false, DT, level, 0);
    expect(task.elapsed).toBeCloseTo(1 + DT, 2);
  });
});
