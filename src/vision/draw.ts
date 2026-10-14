import type { Pose } from "../control/gestures";
import type { Point } from "../control/mapping";

const BONES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17],
  [17, 18], [18, 19], [19, 20],
];

const POSE_COLOR: Partial<Record<Pose, string>> = {
  stop: "#3f94d6",
  grab: "#ec5a26",
};

/**
 * Skeleton over the camera feed, in raw camera coordinates. The canvas is
 * mirrored with CSS together with the video, so it reads like a mirror.
 */
export function drawHand(
  ctx: CanvasRenderingContext2D,
  landmarks: readonly Point[] | null,
  width: number,
  height: number,
  pose: Pose = "none",
): void {
  ctx.clearRect(0, 0, width, height);
  if (!landmarks || landmarks.length < 21) return;
  const color = POSE_COLOR[pose] ?? "#f1f0ec";

  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.strokeStyle = color;
  ctx.beginPath();
  for (const [start, end] of BONES) {
    ctx.moveTo(landmarks[start].x * width, landmarks[start].y * height);
    ctx.lineTo(landmarks[end].x * width, landmarks[end].y * height);
  }
  ctx.stroke();
  ctx.fillStyle = color;
  for (const p of landmarks) {
    ctx.beginPath();
    ctx.arc(p.x * width, p.y * height, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  // Thumb and index tips: the pinch pair.
  ctx.strokeStyle = "#ec5a26";
  ctx.lineWidth = 2;
  for (const i of [4, 8]) {
    ctx.beginPath();
    ctx.arc(landmarks[i].x * width, landmarks[i].y * height, 7, 0, Math.PI * 2);
    ctx.stroke();
  }
}
