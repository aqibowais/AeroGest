import { describe, expect, it } from "vitest";
import { ZERO_COMMAND } from "./control/mapping";
import { LEVELS } from "./course/levels";
import { createTask } from "./course/task";
import { Tutorial, type TutorialContext } from "./tutorial";

const task = createTask(LEVELS[0]);
const ctx = (over: Partial<TutorialContext> = {}): TutorialContext => ({
  mode: "keys",
  command: ZERO_COMMAND,
  pose: null,
  armed: true,
  task,
  ...over,
});

function hold(t: Tutorial, c: TutorialContext, seconds: number) {
  let v = t.update(c, 0);
  for (let s = 0; s < seconds; s += 0.05) v = t.update(c, 0.05);
  return v;
}

describe("tutorial", () => {
  it("keyboard skips arming and starts with sliding right", () => {
    const view = new Tutorial("keys").update(ctx(), 0.05);
    expect(view.steps[0].id).toBe("right");
    expect(view.steps[0].state).toBe("now");
  });

  it("a step needs its action held, not tapped", () => {
    const t = new Tutorial("keys");
    hold(t, ctx({ command: { ...ZERO_COMMAND, strafe: 1 } }), 0.2);
    expect(t.update(ctx(), 0.05).steps[0].state).toBe("now");
    const v = hold(t, ctx({ command: { ...ZERO_COMMAND, strafe: 1 } }), 0.6);
    expect(v.steps[0].state).toBe("done");
  });

  it("hand mode starts by arming and uses the clutch for braking", () => {
    const t = new Tutorial("hand");
    let v = t.update(ctx({ mode: "hand", armed: false }), 0.05);
    expect(v.steps[0].id).toBe("arm");
    v = t.update(ctx({ mode: "hand", armed: true }), 0.05);
    expect(v.steps[0].state).toBe("done");
    expect(v.steps.find((s) => s.id === "brake")).toBeDefined();
  });

  it("finishes when the crate is delivered", () => {
    const t = new Tutorial("keys");
    const moves = [{ strafe: 1 }, { strafe: -1 }, { altitude: 1 }, { altitude: -1 }, { forward: 1 }, { forward: -1 }, {}];
    for (const m of moves) hold(t, ctx({ command: { ...ZERO_COMMAND, ...m } }), 0.7);
    const done = { ...createTask(LEVELS[0]), delivery: 1 };
    expect(t.update(ctx({ task: done }), 0.05).finished).toBe(true);
  });
});
