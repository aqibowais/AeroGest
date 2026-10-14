import { ZERO_COMMAND, type ControlCommand } from "../control/mapping";

const HELD = ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

export function commandFromKeys(down: ReadonlySet<string>): ControlCommand {
  return {
    forward: (down.has("KeyW") ? 1 : 0) - (down.has("KeyS") ? 1 : 0),
    // Left/right arrows slide too. The drone keeps facing down the course, like the hand stick.
    strafe: (down.has("KeyD") || down.has("ArrowRight") ? 1 : 0) - (down.has("KeyA") || down.has("ArrowLeft") ? 1 : 0),
    altitude: (down.has("ArrowUp") ? 1 : 0) - (down.has("ArrowDown") ? 1 : 0),
    yaw: 0,
    pinch: down.has("Space") || down.has("KeyF"),
  };
}

export class KeyState {
  readonly down = new Set<string>();
  restart = false;

  constructor(private readonly target: Window = window) {
    this.onDown = this.onDown.bind(this);
    this.onUp = this.onUp.bind(this);
    target.addEventListener("keydown", this.onDown);
    target.addEventListener("keyup", this.onUp);
  }

  command(): ControlCommand {
    return commandFromKeys(this.down);
  }

  dispose(): void {
    this.target.removeEventListener("keydown", this.onDown);
    this.target.removeEventListener("keyup", this.onUp);
  }

  private onDown(event: KeyboardEvent): void {
    this.down.add(event.code);
    if (HELD.includes(event.code)) event.preventDefault();
    if (event.code === "KeyR" && !event.repeat) this.restart = true;
  }

  private onUp(event: KeyboardEvent): void {
    this.down.delete(event.code);
  }
}

export { ZERO_COMMAND };
