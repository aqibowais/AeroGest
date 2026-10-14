import { RULES } from "./levels";

export const POINTS = {
  gate: 100,
  ring: 150,
  delivery: 400,
  /** Extra for a crate landed dead center, less the further off it is. */
  accuracy: 200,
  /** Per second under the bronze time, added at the finish. */
  second: 40,
};

export function deliveryPoints(error: number): number {
  return POINTS.delivery + Math.round(POINTS.accuracy * Math.max(0, 1 - error / RULES.releaseRadius));
}

export function timePoints(time: number, bronze: number): number {
  return Math.max(0, Math.round((bronze - time) * POINTS.second));
}
