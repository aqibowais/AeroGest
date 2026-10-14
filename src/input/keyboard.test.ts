import { describe, expect, it } from "vitest";
import { commandFromKeys } from "./keyboard";

describe("commandFromKeys", () => {
  it("maps the keyboard stand-in onto the same stick as the hand", () => {
    const command = commandFromKeys(new Set(["KeyW", "KeyA", "ArrowUp", "ArrowLeft", "Space"]));
    expect(command).toEqual({
      forward: 1,
      strafe: -1,
      altitude: 1,
      yaw: 0,
      pinch: true,
    });
  });

  it("cancels opposing keys", () => {
    const command = commandFromKeys(new Set(["KeyW", "KeyS", "KeyD"]));
    expect(command.forward).toBe(0);
    expect(command.strafe).toBe(1);
    expect(command.pinch).toBe(false);
  });
});
