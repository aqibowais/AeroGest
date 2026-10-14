import { describe, expect, it } from "vitest";
import { ZERO_COMMAND, type ControlCommand } from "../control/mapping";
import { DEFAULT_LIMITS, createDrone, stepDrone } from "./drone";

function hold(command: ControlCommand, seconds: number, state = createDrone()) {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i += 1) stepDrone(state, command, 1 / 60);
  return state;
}

describe("stepDrone", () => {
  it("hovers in place when the stick is centered", () => {
    const state = hold(ZERO_COMMAND, 2);
    expect(state.x).toBeCloseTo(0, 6);
    expect(state.y).toBeCloseTo(2.2, 6);
    expect(state.z).toBeCloseTo(0, 6);
    expect(state.vx).toBeCloseTo(0, 6);
  });

  it("flies forward, climbs, and strafes in the body frame", () => {
    const forward = hold({ ...ZERO_COMMAND, forward: 1 }, 1.2);
    expect(forward.z).toBeGreaterThan(4);
    expect(Math.abs(forward.x)).toBeLessThan(0.2);

    const climb = hold({ ...ZERO_COMMAND, altitude: 1 }, 1);
    expect(climb.y).toBeGreaterThan(4);

    const strafe = hold({ ...ZERO_COMMAND, strafe: 1 }, 1);
    // Pilot's right is world -x: screen right from the chase camera.
    expect(strafe.x).toBeLessThan(-3);
    expect(Math.abs(strafe.z)).toBeLessThan(0.2);
  });

  it("positive yaw turns the nose toward +x", () => {
    const state = createDrone();
    state.yaw = Math.PI / 2;
    hold({ ...ZERO_COMMAND, forward: 1 }, 1, state);
    expect(state.x).toBeGreaterThan(3);
    expect(Math.abs(state.z)).toBeLessThan(0.5);
  });

  it("bleeds speed back to a hover when the stick is released", () => {
    const state = createDrone();
    state.vx = 6;
    state.vz = -4;
    hold(ZERO_COMMAND, 1.5, state);
    expect(Math.abs(state.vx)).toBeLessThan(0.05);
    expect(Math.abs(state.vz)).toBeLessThan(0.05);
    expect(Math.hypot(state.vx, state.vy, state.vz)).toBeLessThan(0.08);
  });

  it("stops at the altitude floor", () => {
    const state = hold({ ...ZERO_COMMAND, altitude: -1 }, 3);
    expect(state.y).toBe(DEFAULT_LIMITS.minAltitude);
    expect(state.vy).toBe(0);
  });
});
