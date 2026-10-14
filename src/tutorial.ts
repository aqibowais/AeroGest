import type { ControlCommand } from "./control/mapping";
import type { Pose } from "./control/gestures";
import type { TaskState } from "./course/task";

export type InputMode = "hand" | "keys" | "touch";

export interface TutorialContext {
  mode: InputMode;
  command: ControlCommand;
  pose: Pose | null;
  /** Hand mode: a hand has been seen. */
  armed: boolean;
  task: TaskState;
}

interface Step {
  id: string;
  title: string;
  hint: Record<InputMode, string>;
  /** True while the action is being performed; it must hold for `hold` seconds. */
  doing: (c: TutorialContext) => boolean;
  hold: number;
  modes?: InputMode[];
}

const STEPS: Step[] = [
  {
    id: "arm",
    title: "Show your hand",
    hint: {
      hand: "Raise one hand in front of the camera, about an arm's length away.",
      keys: "",
      touch: "",
    },
    doing: (c) => c.armed,
    hold: 0,
    modes: ["hand"],
  },
  {
    id: "right",
    title: "Slide right",
    hint: { hand: "Make a fist and point your thumb to your right.", keys: "Hold D.", touch: "Push the left stick right." },
    doing: (c) => c.command.strafe > 0.4,
    hold: 0.5,
  },
  {
    id: "left",
    title: "Slide left",
    hint: { hand: "Make a fist and point your thumb to your left.", keys: "Hold A.", touch: "Push the left stick left." },
    doing: (c) => c.command.strafe < -0.4,
    hold: 0.5,
  },
  {
    id: "up",
    title: "Climb",
    hint: { hand: "Hold up one finger (or a thumbs-up).", keys: "Hold ↑.", touch: "Push the right stick up." },
    doing: (c) => c.command.altitude > 0.4,
    hold: 0.5,
  },
  {
    id: "down",
    title: "Descend",
    hint: { hand: "Hold up two fingers in a V.", keys: "Hold ↓.", touch: "Pull the right stick down." },
    doing: (c) => c.command.altitude < -0.4,
    hold: 0.5,
  },
  {
    id: "forward",
    title: "Fly forward",
    hint: { hand: "Show an open hand, all five fingers.", keys: "Hold W.", touch: "Push the left stick up." },
    doing: (c) => c.command.forward > 0.4,
    hold: 0.6,
  },
  {
    id: "back",
    title: "Fly backward",
    hint: { hand: "Thumbs down.", keys: "Hold S.", touch: "Pull the left stick down." },
    doing: (c) => c.command.forward < -0.4,
    hold: 0.5,
  },
  {
    id: "brake",
    title: "Stop",
    hint: {
      hand: "Pinch your thumb and index finger together: the drone stops and hovers.",
      keys: "Let go of every key: the drone stops by itself.",
      touch: "Let go of both sticks: the drone stops by itself.",
    },
    doing: (c) =>
      c.mode === "hand"
        ? c.pose === "stop"
        : c.command.forward === 0 && c.command.strafe === 0 && c.command.altitude === 0,
    hold: 0.4,
  },
  {
    id: "grab",
    title: "Pick up the crate",
    hint: {
      hand: "Fly low over crate 1, then make a fist to grab it.",
      keys: "Fly low over crate 1, then press Space.",
      touch: "Fly low over crate 1, then tap Grab.",
    },
    doing: (c) => c.task.carrying || c.task.delivery > 0,
    hold: 0,
  },
  {
    id: "drop",
    title: "Set it on the pad",
    hint: {
      hand: "Fly to pad 1, come down low, and make a fist again to let go.",
      keys: "Fly to pad 1, come down low, and press Space.",
      touch: "Fly to pad 1, come down low, and tap Grab.",
    },
    doing: (c) => c.task.delivery > 0,
    hold: 0,
  },
];

export interface TutorialView {
  steps: { id: string; title: string; state: "done" | "now" | "todo" }[];
  hint: string;
  progress: number;
  finished: boolean;
}

/** Walks the steps in order. Each step completes when its action is held long enough. */
export class Tutorial {
  private index = 0;
  private held = 0;
  private readonly steps: Step[];

  constructor(readonly mode: InputMode) {
    this.steps = STEPS.filter((s) => !s.modes || s.modes.includes(mode));
  }

  update(c: TutorialContext, dt: number): TutorialView {
    // Catch up on steps already satisfied, e.g. the crate grabbed out of order.
    while (this.index < this.steps.length) {
      const step = this.steps[this.index];
      if (step.doing(c)) {
        this.held += dt;
        if (this.held >= step.hold) {
          this.index += 1;
          this.held = 0;
          continue;
        }
      } else this.held = 0;
      break;
    }
    const finished = this.index >= this.steps.length;
    const current = this.steps[Math.min(this.index, this.steps.length - 1)];
    return {
      steps: this.steps.map((s, i) => ({ id: s.id, title: s.title, state: i < this.index ? "done" : i === this.index ? "now" : "todo" })),
      hint: finished ? "Done. You can fly every level now." : current.hint[this.mode],
      progress: finished || !current.hold ? 0 : Math.min(1, this.held / current.hold),
      finished,
    };
  }
}
