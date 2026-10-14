import { clamp, type ControlCommand } from "../control/mapping";
import { gatePose, windAt, type Gate, type Level, type Vec3 } from "../course/levels";
import type { TaskState } from "../course/task";
import type { DroneLimits, DroneState } from "../physics/drone";

interface Waypoint {
  /** Target at level time t, given the estimated time to arrive. */
  at: (t: number, eta: number) => Vec3;
  tol: number;
  action?: "grab" | "drop";
  /** Moving gates get a slower, tracking pass. */
  moving?: boolean;
}

const CRUISE = 5.4;

/**
 * Waypoint pilot for the attract screen and the reference ghost. It produces
 * the same ControlCommand a hand or the keyboard does, so its run goes through
 * the same physics and the same scoring as a human run.
 */
export class Autopilot {
  private route: Waypoint[] = [];
  private index = 0;
  private settle = 0;
  private pulse = 0;

  constructor(private readonly level: Level) {
    this.plan();
  }

  private plan(): void {
    const L = this.level;
    const route: Waypoint[] = [];
    const fixed = (p: Vec3, tol: number, action?: "grab" | "drop"): Waypoint => ({ at: () => p, tol, action });
    const passes = (from: number, to: number) => {
      const items: { z: number; add: () => void }[] = [];
      for (const g of L.gates) {
        if (g.z <= from || g.z > to) continue;
        items.push({ z: g.z, add: () => route.push(...gatePass(g)) });
      }
      for (const r of L.rings) {
        if (r.z <= from || r.z > to) continue;
        items.push({
          z: r.z,
          add: () => route.push(fixed({ x: r.x, y: r.y, z: r.z - 2.5 }, 0.5), fixed({ x: r.x, y: r.y, z: r.z + 2 }, 1)),
        });
      }
      items.sort((a, b) => a.z - b.z).forEach((i) => i.add());
    };
    let z = -1;
    for (const d of L.deliveries) {
      passes(z, d.pickup.z - 2);
      route.push(fixed({ x: d.pickup.x, y: d.pickup.y + 1.6, z: d.pickup.z - 1.5 }, 1.2));
      route.push(fixed({ x: d.pickup.x, y: d.pickup.y + 1.25, z: d.pickup.z }, 0.25, "grab"));
      passes(d.pickup.z, d.pad.z - 3);
      route.push(fixed({ x: d.pad.x, y: 3, z: d.pad.z - 2 }, 1.2));
      route.push(fixed({ x: d.pad.x, y: 1.25, z: d.pad.z }, 0.2, "drop"));
      z = d.pad.z;
    }
    this.route = route;
    this.index = 0;
  }

  get done(): boolean {
    return this.index >= this.route.length;
  }

  command(drone: DroneState, task: TaskState, limits: DroneLimits, dt: number, t: number): ControlCommand {
    const idle: ControlCommand = { altitude: 0, strafe: 0, forward: 0, yaw: 0, pinch: false };
    // Hold the grab key for a few frames so the task sees a clean rising edge.
    // Checked before `done`: the final drop is scheduled on the last waypoint.
    if (this.pulse > 0) {
      this.pulse -= dt;
      return { ...idle, pinch: this.pulse > 0.06 };
    }
    if (this.done || task.score || task.crashed) return idle;

    const wp = this.route[this.index];
    let target = wp.at(t, 0);
    const eta = Math.min(2, Math.hypot(target.x - drone.x, target.y - drone.y, target.z - drone.z) / CRUISE);
    target = wp.at(t, eta);
    const ex = target.x - drone.x;
    const ey = target.y - drone.y;
    const ez = target.z - drone.z;
    const dist = Math.hypot(ex, ey, ez);

    if (dist < wp.tol) {
      if (wp.action) {
        this.settle += dt;
        const speed = Math.hypot(drone.vx, drone.vy, drone.vz);
        if (this.settle > 0.35 && speed < 0.6) {
          const carrying = task.carrying;
          if ((wp.action === "grab" && !carrying) || (wp.action === "drop" && carrying)) this.pulse = 0.2;
          this.index += 1;
          this.settle = 0;
        }
      } else {
        this.index += 1;
      }
    }

    let vx: number;
    let vz: number;
    const h = Math.hypot(ex, ez) || 1;
    if (wp.action) {
      // Proportional approach so it settles on the crate and the pad.
      const cap = Math.min(2.2, 0.9 + dist * 0.8);
      vx = ex * 1.6;
      vz = ez * 1.6;
      const v = Math.hypot(vx, vz);
      if (v > cap) {
        vx *= cap / v;
        vz *= cap / v;
      }
    } else {
      const cruise = wp.moving ? 4 : CRUISE;
      vx = (ex / h) * cruise;
      vz = (ez / h) * cruise;
      // Close the lateral error harder when threading a moving hole.
      if (wp.moving) vx += ex * 1.5;
    }
    const vy = clamp(ey * 1.8, -limits.maxClimb * 0.8, limits.maxClimb * 0.8);

    // Lean into known wind.
    const wind = windAt(this.level, drone.x, drone.z);
    vx -= wind.x;
    vz -= wind.z;

    const sin = Math.sin(drone.yaw);
    const cos = Math.cos(drone.yaw);
    return {
      forward: clamp((sin * vx + cos * vz) / limits.maxSpeed, -1, 1),
      strafe: clamp((-cos * vx + sin * vz) / limits.maxSpeed, -1, 1),
      altitude: clamp(vy / limits.maxClimb, -1, 1),
      yaw: clamp(-drone.yaw * 1.5, -1, 1),
      pinch: false,
    };
  }
}

function gatePass(g: Gate): Waypoint[] {
  const moving = !!g.motion;
  return [
    {
      at: (t, eta) => {
        const p = gatePose(g, t + eta + 0.8);
        return { x: p.x, y: p.y, z: g.z - 4 };
      },
      tol: moving ? 1.4 : 0.9,
      moving,
    },
    {
      at: (t, eta) => {
        const p = gatePose(g, t + Math.min(eta, 0.4));
        return { x: p.x, y: p.y, z: g.z + 2.5 };
      },
      tol: 1.2,
      moving,
    },
  ];
}
