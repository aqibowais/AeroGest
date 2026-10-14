import { levelEnd, type Level } from "./course/levels";
import type { Sample } from "./recorder";

const NS = "http://www.w3.org/2000/svg";

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

export interface Trace {
  label: string;
  cls: "you" | "ref";
  samples: Sample[];
}

/** Top-down map: course along the long axis, your path against the reference. */
export function pathMap(host: HTMLElement, level: Level, traces: Trace[]): void {
  host.replaceChildren();
  const w = host.clientWidth || 320;
  const h = host.clientHeight || 120;
  const zMin = -2;
  const zMax = levelEnd(level) - 8;
  const xSpan = 10;
  const pad = 10;
  const sx = (z: number) => pad + ((z - zMin) / (zMax - zMin)) * (w - pad * 2);
  // Screen up is the pilot's left, as seen from behind the drone.
  const sy = (x: number) => h / 2 - (x / xSpan) * (h / 2 - pad);
  const svg = el("svg", { width: w, height: h, viewBox: `0 0 ${w} ${h}`, role: "img", "aria-label": "Top-down flight path" });
  for (const zone of level.wind) {
    svg.append(el("rect", {
      x: sx(zone.z - zone.halfZ), y: pad, width: sx(zone.z + zone.halfZ) - sx(zone.z - zone.halfZ), height: h - pad * 2, class: "windzone",
    }));
  }
  svg.append(el("line", { x1: sx(zMin), x2: sx(zMax), y1: sy(0), y2: sy(0), class: "axis" }));
  for (const g of level.gates) {
    const sway = g.motion?.axis === "x" ? g.motion.amp : 0;
    if (sway) svg.append(el("line", { x1: sx(g.z), x2: sx(g.z), y1: sy(g.x - sway - g.radius), y2: sy(g.x + sway + g.radius), class: "sway" }));
    svg.append(el("line", { x1: sx(g.z), x2: sx(g.z), y1: sy(g.x - g.halfWidth), y2: sy(g.x - g.radius), class: "wall" }));
    svg.append(el("line", { x1: sx(g.z), x2: sx(g.z), y1: sy(g.x + g.radius), y2: sy(g.x + g.halfWidth), class: "wall" }));
  }
  for (const r of level.rings) svg.append(el("circle", { cx: sx(r.z), cy: sy(r.x), r: 3, class: "ring" }));
  level.deliveries.forEach((d, i) => {
    svg.append(el("rect", { x: sx(d.pickup.z) - 3.5, y: sy(d.pickup.x) - 3.5, width: 7, height: 7, class: "pickup" }));
    svg.append(el("circle", { cx: sx(d.pad.z), cy: sy(d.pad.x), r: 8, class: "pad" }));
    const label = el("text", { x: sx(d.pad.z), y: sy(d.pad.x) + 3.5, class: "padnum", "text-anchor": "middle" });
    label.textContent = String(i + 1);
    svg.append(label);
  });
  for (const t of traces) {
    if (!t.samples.length) continue;
    svg.append(el("polyline", { points: t.samples.map((s) => `${sx(s.z)},${sy(s.x)}`).join(" "), class: `trace ${t.cls}` }));
  }
  host.append(svg);
}

/** Value over time for each trace, one shared y axis. */
export function timeChart(host: HTMLElement, traces: Trace[], pick: (s: Sample) => number, unit: string): void {
  host.replaceChildren();
  const w = host.clientWidth || 320;
  const h = host.clientHeight || 110;
  const m = { l: 30, r: 8, t: 8, b: 18 };
  const all = traces.flatMap((t) => t.samples);
  if (!all.length) return;
  const tMax = Math.max(...all.map((s) => s.t), 1);
  const vMax = Math.max(...all.map(pick), 1) * 1.1;
  const sx = (t: number) => m.l + (t / tMax) * (w - m.l - m.r);
  const sy = (v: number) => m.t + (1 - v / vMax) * (h - m.t - m.b);
  const svg = el("svg", { width: w, height: h, viewBox: `0 0 ${w} ${h}`, role: "img" });
  for (const frac of [0, 0.5, 1]) {
    const v = vMax * frac;
    svg.append(el("line", { x1: m.l, x2: w - m.r, y1: sy(v), y2: sy(v), class: "grid" }));
    const label = el("text", { x: m.l - 5, y: sy(v), class: "tick", "text-anchor": "end", "dominant-baseline": "middle" });
    label.textContent = v.toFixed(0);
    svg.append(label);
  }
  const unitLabel = el("text", { x: m.l - 5, y: h - 4, class: "tick", "text-anchor": "end" });
  unitLabel.textContent = unit;
  svg.append(unitLabel);
  const tEnd = el("text", { x: w - m.r, y: h - 4, class: "tick", "text-anchor": "end" });
  tEnd.textContent = `${tMax.toFixed(0)} s`;
  svg.append(tEnd);
  for (const t of traces) {
    if (!t.samples.length) continue;
    svg.append(el("polyline", { points: t.samples.map((s) => `${sx(s.t)},${sy(pick(s))}`).join(" "), class: `trace ${t.cls}` }));
  }
  host.append(svg);
}
