import { FilesetResolver, GestureRecognizer } from "@mediapipe/tasks-vision";
import type { HandFrame } from "../control/gestures";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm";
// Trained gesture model: hand landmarks, 3D world landmarks, and gesture classes in one pass.
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";

export class HandTracker {
  cameraOpen = false;
  /** Milliseconds spent in the last recognizer call, smoothed. */
  latency = 0;
  /** Tracker frames per second, smoothed. */
  fps = 0;
  delegate: "GPU" | "CPU" | null = null;
  private video: HTMLVideoElement | null = null;
  private recognizer: GestureRecognizer | null = null;
  private lastTs = 0;
  private lastFrameAt = 0;
  private lastVideoTime = -1;
  private lastFrame: HandFrame | null = null;
  private switching = false;

  async open(video: HTMLVideoElement): Promise<void> {
    this.video = video;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
    });
    this.cameraOpen = true;
    video.srcObject = stream;
    await video.play();
    try {
      this.recognizer = await this.load("GPU");
      this.delegate = "GPU";
    } catch {
      this.recognizer = await this.load("CPU");
      this.delegate = "CPU";
    }
  }

  /** Latest hand, or null. Only runs the model when the camera has a new frame. */
  detect(now: number): HandFrame | null {
    const video = this.video;
    const recognizer = this.recognizer;
    if (!video || !recognizer || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) return null;
    if (video.currentTime === this.lastVideoTime) return this.lastFrame;
    this.lastVideoTime = video.currentTime;
    const timestamp = Math.max(now, this.lastTs + 1);
    this.lastTs = timestamp;
    try {
      const t0 = performance.now();
      const result = recognizer.recognizeForVideo(video, timestamp);
      const t1 = performance.now();
      this.latency = this.latency ? this.latency * 0.9 + (t1 - t0) * 0.1 : t1 - t0;
      if (this.lastFrameAt) {
        const inst = 1000 / Math.max(1, t1 - this.lastFrameAt);
        this.fps = this.fps ? this.fps * 0.9 + inst * 0.1 : inst;
      }
      this.lastFrameAt = t1;
      const lm = result.landmarks[0];
      if (!lm || lm.length < 21) {
        this.lastFrame = null;
        return null;
      }
      const top = result.gestures[0]?.[0];
      this.lastFrame = {
        landmarks: lm.map((p) => ({ x: p.x, y: p.y, z: p.z })),
        world: result.worldLandmarks[0]?.map((p) => ({ x: p.x, y: p.y, z: p.z })) ?? null,
        gesture: top?.categoryName ?? "None",
        score: top?.score ?? 0,
      };
      return this.lastFrame;
    } catch {
      if (!this.switching) {
        this.switching = true;
        void this.fallBackToCpu();
      }
      return null;
    }
  }

  private async load(delegate: "GPU" | "CPU"): Promise<GestureRecognizer> {
    const vision = await FilesetResolver.forVisionTasks(WASM);
    return GestureRecognizer.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: "VIDEO",
      numHands: 1,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.5,
    });
  }

  private async fallBackToCpu(): Promise<void> {
    const current = this.recognizer;
    this.recognizer = null;
    current?.close();
    try {
      this.recognizer = await this.load("CPU");
      this.delegate = "CPU";
    } catch {
      this.recognizer = null;
    } finally {
      this.switching = false;
    }
  }
}
