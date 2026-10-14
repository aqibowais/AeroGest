import { ZERO_COMMAND, type ControlCommand } from "../control/mapping";

class Stick {
  x = 0;
  y = 0;
  private id: number | null = null;

  constructor(private readonly pad: HTMLElement, private readonly knob: HTMLElement) {
    pad.addEventListener("pointerdown", (e) => {
      this.id = e.pointerId;
      pad.setPointerCapture(e.pointerId);
      this.move(e);
    });
    pad.addEventListener("pointermove", (e) => e.pointerId === this.id && this.move(e));
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.id) return;
      this.id = null;
      this.x = 0;
      this.y = 0;
      this.knob.style.transform = "";
    };
    pad.addEventListener("pointerup", end);
    pad.addEventListener("pointercancel", end);
  }

  private move(e: PointerEvent): void {
    const r = this.pad.getBoundingClientRect();
    const radius = r.width / 2;
    let dx = (e.clientX - (r.left + radius)) / radius;
    let dy = (e.clientY - (r.top + radius)) / radius;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    this.x = Math.abs(dx) < 0.12 ? 0 : dx;
    this.y = Math.abs(dy) < 0.12 ? 0 : dy;
    this.knob.style.transform = `translate(${dx * radius * 0.6}px, ${dy * radius * 0.6}px)`;
  }
}

/** Two on-screen sticks and a grab button, producing the same command as the keyboard. */
export class TouchSticks {
  private readonly move: Stick;
  private readonly lift: Stick;
  private grab = false;
  restart = false;

  constructor(root: HTMLElement) {
    const q = (sel: string) => root.querySelector<HTMLElement>(sel)!;
    this.move = new Stick(q("[data-stick=move]"), q("[data-stick=move] i"));
    this.lift = new Stick(q("[data-stick=lift]"), q("[data-stick=lift] i"));
    const grab = q("[data-grab]");
    grab.addEventListener("pointerdown", () => (this.grab = true));
    grab.addEventListener("pointerup", () => (this.grab = false));
    grab.addEventListener("pointerleave", () => (this.grab = false));
  }

  command(): ControlCommand {
    return {
      ...ZERO_COMMAND,
      forward: -this.move.y,
      strafe: this.move.x,
      altitude: -this.lift.y,
      yaw: this.lift.x * 0.8,
      pinch: this.grab,
    };
  }
}
