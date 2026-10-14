import "@fontsource-variable/archivo/wdth.css";
import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";
import "./style.css";
import { Autopilot } from "./autopilot/autopilot";
import { flyReference, limitsFor, medalFor, medalTargets, type Medal, type ReferenceRun } from "./autopilot/reference";
import {
  POSES,
  POSE_HOW,
  POSE_LABEL,
  PersonalModel,
  PoseFilter,
  classify,
  commandFor,
  type Features,
  type HandFrame,
  type Pose,
  type Sample as PoseSample,
} from "./control/gestures";
import { ZERO_COMMAND, type ControlCommand } from "./control/mapping";
import { LEVELS, SPAWN, windAt, type Level } from "./course/levels";
import { timePoints } from "./course/points";
import { cratePositions, createTask, restartTask, scoreOf, stepTask } from "./course/task";
import { pathMap, timeChart, type Trace } from "./debrief";
import { formatTime } from "./format";
import { KeyState } from "./input/keyboard";
import { TouchSticks } from "./input/touch";
import { createDrone, resetDrone, stepDrone } from "./physics/drone";
import { Recorder, loadBest, sampleAt, saveIfBest, type Flight, type Sample } from "./recorder";
import { World } from "./scene/world";
import { Tutorial, type InputMode } from "./tutorial";
import { drawHand } from "./vision/draw";
import { HandTracker } from "./vision/tracker";

type Mode = "menu" | InputMode;
type Boot = "idle" | "loading" | "ready" | "camera" | "tracker";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
// Dev-only QA hook: ?selftest lets the autopilot fly keyboard mode so the debrief can be checked end to end.
const SELFTEST = import.meta.env.DEV && new URLSearchParams(location.search).has("selftest");

const view = $<HTMLCanvasElement>("view");
const video = $<HTMLVideoElement>("video");
const overlay = $<HTMLCanvasElement>("overlay");
const ink = overlay.getContext("2d")!;

const world = new World(view);
const keys = new KeyState();
const touch = new TouchSticks($("sticks"));
const tracker = new HandTracker();
const filter = new PoseFilter();
/** A fist has to be held this long before it grabs, so the fist on the way to a thumb pose does not. */
const GRAB_HOLD = 0.35;
let power = 0.6;
let personal: PersonalModel | null = null;
let usePersonal = true;
let pose: Pose = "none";
let lastFeatures: Features | null = null;
let lastSource = "built-in";
let lastGesture = "None";
let handSeen = false;
let handMissing = 0;
let grabHeld = 0;
try {
  const raw = localStorage.getItem("aerogest.personal");
  if (raw) personal = PersonalModel.from(JSON.parse(raw) as PoseSample[]);
} catch {
  personal = null;
}
const recorder = new Recorder();
const drone = createDrone(SPAWN.x, SPAWN.y, SPAWN.z, SPAWN.yaw);

let level: Level = LEVELS[0];
const task = createTask(level);
let autopilot = new Autopilot(level);
let mode: Mode = "menu";
let boot: Boot = "idle";
let tutorial: Tutorial | null = null;
let ghostOn = true;
let ghost: { samples: Sample[]; label: string } | null = null;
let runClock = 0;
let launched = false;
let finished = false;
let demoRestartAt = 0;
let warn = "";
let warnLeft = 0;
let calloutLeft = 0;
let crashAge = 0;


const references = new Map<string, ReferenceRun>();
function referenceFor(l: Level): ReferenceRun {
  let r = references.get(l.id);
  if (!r) {
    r = flyReference(l);
    references.set(l.id, r);
  }
  return r;
}
const refTime = (l: Level) => referenceFor(l).score?.time ?? 60;

function medalOf(l: Level): Medal {
  const best = loadBest(l.id);
  return best ? medalFor(best.score.time, refTime(l)) : null;
}


const textCache = new Map<string, string>();
function text(id: string, value: string): void {
  if (textCache.get(id) === value) return;
  textCache.set(id, value);
  $(id).textContent = value;
}

function callout(msg: string, tone: "good" | "info" = "info", seconds = 1.6): void {
  const node = $("callout");
  node.textContent = msg;
  node.dataset.tone = tone;
  node.classList.add("show");
  calloutLeft = seconds;
}

const MEDAL_LABEL: Record<string, string> = { gold: "Gold", silver: "Silver", bronze: "Bronze" };

function renderLevels(): void {
  $("levels").innerHTML = LEVELS.map((l, i) => {
    const best = loadBest(l.id);
    const medal = medalOf(l);
    const tags = [
      `${l.deliveries.length} crate${l.deliveries.length > 1 ? "s" : ""}`,
      l.gates.some((g) => g.motion) ? "moving gates" : l.gates.length ? `${l.gates.length} gates` : "",
      l.wind.length ? "wind" : "",
    ].filter(Boolean).join(", ");
    const record = best
      ? `<i class="m" data-medal="${medal ?? "none"}"></i>${formatTime(best.score.time)}`
      : `<small>gold ${formatTime(medalTargets(refTime(l)).gold)}</small>`;
    return `<button type="button" class="lvl${l.id === level.id ? " on" : ""}" role="option" aria-selected="${l.id === level.id}" data-level="${l.id}">
      <span class="body"><b>${l.name}</b><span>${l.blurb}</span><em>${tags}</em></span>
      <span class="rec">${record}</span>
    </button>`;
  }).join("");
  text("goLabel", `Fly ${level.name} with`);
}


function selectLevel(id: string): void {
  level = LEVELS.find((l) => l.id === id) ?? LEVELS[0];
  world.applyLevel(level);
  resetRun();
  if (mode === "menu") renderLevels();
}

function resetRun(): void {
  restartTask(task, level);
  resetDrone(drone, SPAWN.x, SPAWN.y, SPAWN.z, SPAWN.yaw);
  autopilot = new Autopilot(level);
  recorder.reset();
  world.clearTrail();
  runClock = 0;
  launched = mode === "menu";
  finished = false;
  demoRestartAt = 0;
  crashAge = 0;
  warn = "";
  warnLeft = 0;
  $("result").hidden = true;
  $("crash").hidden = true;
  $("feedPts").innerHTML = "";
  if (mode === "menu") {
    ghost = null;
    tutorial = null;
  } else {
    const best = loadBest(level.id);
    ghost = best ? { samples: best.samples, label: "Your best" } : { samples: referenceFor(level).samples, label: "Autopilot" };
    tutorial = level.tutorial ? new Tutorial(mode) : null;
    const m = medalTargets(refTime(level));
    $("medals").innerHTML =
      `<i data-medal="gold"></i>${m.gold.toFixed(1)}<i data-medal="silver"></i>${m.silver.toFixed(1)}<i data-medal="bronze"></i>${m.bronze.toFixed(1)}`;
    callout(level.name, "info", 2.2);
  }
  $("tutor").hidden = !tutorial;
}

function setMode(next: Mode): void {
  mode = next;
  document.body.dataset.mode = next;
  $("menu").hidden = next !== "menu";
  $("pilot").hidden = next === "menu" || next === "touch";
  $("feed").hidden = next !== "hand";
  $("gesturebox").hidden = next !== "hand";
  $("posebar").hidden = next !== "hand";
  $("perf").hidden = next !== "hand";
  $("keysLegend").hidden = next !== "keys";
  $("sticks").hidden = next !== "touch";
  if (next === "hand") {
    filter.reset();
    handSeen = false;
    if (boot !== "ready" && boot !== "loading") void bootCamera();
  }
  resetRun();
  if (next === "menu") renderLevels();
}

async function bootCamera(): Promise<void> {
  boot = "loading";
  try {
    await tracker.open(video);
    boot = "ready";
  } catch {
    boot = tracker.cameraOpen ? "tracker" : "camera";
  }
}


$("levels").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-level]");
  if (b?.dataset.level) selectLevel(b.dataset.level);
});
$("startHand").addEventListener("click", () => setMode("hand"));
$("startKeys").addEventListener("click", () => setMode("keys"));
$("startTouch").addEventListener("click", () => setMode("touch"));
$("skipToKeys").addEventListener("click", () => setMode("keys"));
$("retry").addEventListener("click", () => void bootCamera());
$("brand").addEventListener("click", () => setMode("menu"));
$("toLevels").addEventListener("click", () => setMode("menu"));
$("crashLevels").addEventListener("click", () => setMode("menu"));
$("restart").addEventListener("click", () => resetRun());
$("crashRetry").addEventListener("click", () => resetRun());
$("resetBtn").addEventListener("click", () => resetRun());
$("nextLevel").addEventListener("click", () => {
  const i = LEVELS.findIndex((l) => l.id === level.id);
  selectLevel(LEVELS[(i + 1) % LEVELS.length].id);
});
$("ghostBtn").addEventListener("click", () => {
  ghostOn = !ghostOn;
  $("ghostBtn").setAttribute("aria-pressed", String(ghostOn));
});
$<HTMLInputElement>("sens").addEventListener("input", (e) => {
  power = Number((e.target as HTMLInputElement).value);
  try {
    localStorage.setItem("aerogest.power", String(power));
  } catch {
    /* storage blocked */
  }
});
try {
  const saved = Number(localStorage.getItem("aerogest.power"));
  if (saved >= 0.3 && saved <= 1) {
    power = saved;
    $<HTMLInputElement>("sens").value = String(saved);
  }
} catch {
  /* storage blocked */
}
window.addEventListener("keydown", (e) => {
  if (e.code === "Escape" && mode !== "menu") setMode("menu");
});
window.addEventListener("resize", () => world.resize());
if (matchMedia("(pointer: coarse)").matches) document.body.classList.add("coarse");


function finishRun(): void {
  if (finished) return;
  finished = true;
  if (mode === "menu") {
    demoRestartAt = performance.now() + 2500;
    return;
  }
  if (task.crashed) {
    text("crashText", `You flew into gate ${task.crashed.slice(1)}. ${task.points} points before the crash.`);
    $("crash").hidden = false;
    return;
  }
  const ref = referenceFor(level);
  const bonus = timePoints(task.score!.time, medalTargets(refTime(level)).bronze);
  const score = { ...task.score!, points: task.score!.points + bonus };
  const medal = medalFor(score.time, refTime(level));
  const flight: Flight = { level: level.id, pilot: mode, score, samples: recorder.samples.slice() };
  const prev = ghost;
  const isBest = saveIfBest(flight);

  $("resMedal").dataset.medal = medal ?? "none";
  text("resMedalText", medal ? MEDAL_LABEL[medal] : "No medal");
  text("resKicker", level.name);
  text("resTitle", `${score.points.toLocaleString()} points`);
  $("resBadge").hidden = !isBest;
  text("resFlight", formatTime(score.flight));
  text("resPlace", `+${score.penalty.toFixed(1)} s`);
  text("resRings", score.rings ? `−${score.bonus.toFixed(1)} s` : "0");
  text("resTime", formatTime(score.time));
  text("resGates", `${score.gates}/${level.gates.length}`);
  text("resBonus", `+${bonus}`);
  const t = medalTargets(refTime(level));
  $("resTargets").innerHTML =
    (["gold", "silver", "bronze"] as const)
      .map((m) => `<div class="${score.time <= t[m] ? "hit" : ""}"><i data-medal="${m}"></i>${MEDAL_LABEL[m]}<b>${formatTime(t[m])}</b></div>`)
      .join("") + `<p>Autopilot ${formatTime(ref.score?.time ?? 0)}</p>`;
  text("refLabel", prev?.label ?? "Autopilot");
  const traces: Trace[] = [
    { label: "You", cls: "you", samples: flight.samples },
    { label: prev?.label ?? "Autopilot", cls: "ref", samples: prev?.samples ?? [] },
  ];
  $("result").hidden = false;
  requestAnimationFrame(() => {
    pathMap($("mapPlot"), level, traces);
    timeChart($("altPlot"), traces, (s: Sample) => s.y, "m");
    timeChart($("spdPlot"), traces, (s: Sample) => s.speed, "m/s");
  });
}

function pointPop(label: string, points: number): void {
  const node = document.createElement("li");
  node.innerHTML = `<b>+${points}</b> ${label}`;
  const list = $("feedPts");
  list.prepend(node);
  while (list.children.length > 4) list.lastElementChild?.remove();
  setTimeout(() => node.classList.add("gone"), 1800);
  setTimeout(() => node.remove(), 2400);
}


function inputCommand(now: number, dt: number): ControlCommand {
  if (mode === "menu") return autopilot.command(drone, task, limitsFor(level), dt, runClock);
  if (mode === "keys") return SELFTEST ? autopilot.command(drone, task, limitsFor(level), dt, runClock) : keys.command();
  if (mode === "touch") return touch.command();
  if (boot !== "ready") {
    drawHand(ink, null, overlay.width, overlay.height, pose);
    return ZERO_COMMAND;
  }
  if (video.videoWidth && (overlay.width !== video.videoWidth || overlay.height !== video.videoHeight)) {
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
  }
  const hand = tracker.detect(now);
  drawHand(ink, hand?.landmarks ?? null, overlay.width, overlay.height, pose);
  if (teach) teachFrame(hand);
  if (!hand) {
    handMissing += dt;
    // Brief dropouts are common; only give up the pose after a moment.
    if (handMissing > 0.25) {
      pose = filter.push(null);
      lastFeatures = null;
    }
    grabHeld = 0;
    return commandFor(pose === "grab" ? "none" : pose, power);
  }
  handMissing = 0;
  handSeen = true;
  const guess = classify(hand, usePersonal ? personal : null);
  lastFeatures = guess.f;
  lastSource = guess.source === "personal" ? "your model" : guess.source === "model" ? "MediaPipe model" : "joint-angle rules";
  lastGesture = hand.gesture;
  pose = filter.push(guess.pose);
  if (teach) return ZERO_COMMAND;
  if (pose === "grab") {
    grabHeld += dt;
    return { ...ZERO_COMMAND, pinch: grabHeld >= GRAB_HOLD };
  }
  grabHeld = 0;
  return commandFor(pose, power);
}

function renderGesture(): void {
  text("poseNow", POSE_LABEL[pose]);
  $("poseNow").dataset.pose = pose;
  $("poseHold").style.width = `${Math.round((pose === "grab" ? Math.min(1, grabHeld / GRAB_HOLD) : filter.progress) * 100)}%`;
  document.querySelectorAll<HTMLElement>(".posebar .pose").forEach((n) => n.classList.toggle("live", n.dataset.pose === pose));
  const f = lastFeatures;
  document.querySelectorAll<HTMLElement>(".fingers [data-f]").forEach((node) => {
    const key = node.dataset.f;
    node.classList.toggle("on", !!f && (key === "thumb" ? f.thumbOut : f.extended[Number(key)]));
  });
  text("pinchVal", f ? `${f.pinchCm.toFixed(1)} cm` : "--");
  $("pinchFill").style.width = f ? `${Math.min(100, (f.pinchCm / 10) * 100)}%` : "0%";
  $("pinchFill").classList.toggle("held", pose === "stop");
  text("poseSrc", personal?.ready && usePersonal ? `${lastSource} (personal on)` : lastSource);
  text(
    "perf",
    tracker.delegate
      ? `${tracker.latency.toFixed(1)} ms, ${Math.round(tracker.fps)} fps, ${tracker.delegate}. Model: ${lastGesture.replace("_", " ")}`
      : "Loading hand model",
  );
}

function renderPrompt(): void {
  let show = false;
  let title = "";
  let body = "";
  if (mode === "hand" && !handSeen && !teach) {
    show = true;
    if (boot === "loading" || boot === "idle") {
      title = "Starting the camera";
      body = "Downloading the hand model (18 MB, cached after the first visit).";
    } else if (boot === "camera") {
      title = "Camera blocked";
      body = "Allow the camera in the address bar, or fly with the keyboard.";
    } else if (boot === "tracker") {
      title = "Hand model failed";
      body = "Check the connection and retry.";
    } else {
      title = "Show your hand";
      body = "Hold one hand up about an arm's length from the camera.";
    }
  }
  $("prompt").hidden = !show;
  if (!show) return;
  text("promptTitle", title);
  text("promptText", body);
  $("calBar").hidden = boot !== "ready";
  $("retry").hidden = boot !== "camera" && boot !== "tracker";
  $("calBar").hidden = true;
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  const limits = limitsFor(level);
  const command = inputCommand(now, dt);

  if (keys.restart) {
    keys.restart = false;
    if (mode !== "menu") resetRun();
  }
  if (!launched && (command.forward || command.strafe || command.altitude || command.pinch)) launched = true;

  if (task.crashed) {
    // Drop out of the air, then show the crash card.
    crashAge += dt;
    drone.vy = Math.max(-9, drone.vy - 14 * dt);
    drone.y = Math.max(0.25, drone.y + drone.vy * dt);
    drone.vx = drone.vz = drone.yawRate = 0;
    if (crashAge > 1.1) finishRun();
    if (mode === "menu" && demoRestartAt && now > demoRestartAt) resetRun();
  } else if (task.score) {
    drone.vx = drone.vy = drone.vz = drone.yawRate = 0;
    finishRun();
    if (mode === "menu" && demoRestartAt && now > demoRestartAt) resetRun();
  } else {
    stepDrone(drone, command, dt, limits, windAt(level, drone.x, drone.z));
    stepTask(task, drone, command.pinch, dt, level, runClock);
    if (launched) {
      runClock += dt;
      recorder.push(runClock, drone, task.carrying, dt);
      world.pushTrail(drone.x, drone.y, drone.z);
    }
  }

  if (mode !== "menu") {
    for (const e of task.events) pointPop(e.label, e.points);
    task.events = [];
    if (task.dropFlash !== null && !task.score) callout(`Now crate ${task.delivery + 1}`, "good", 2);
  }
  if (warnLeft > 0) {
    warnLeft -= dt;
    if (warnLeft <= 0) warn = "";
  }
  let warnText = warnLeft > 0 ? warn : "";
  if (!warnText && mode === "hand" && handSeen && handMissing > 0.25 && !teach) warnText = "Hand out of view, hovering";
  text("warn", warnText);
  $("warn").classList.toggle("show", !!warnText);
  if (calloutLeft > 0) {
    calloutLeft -= dt;
    if (calloutLeft <= 0) $("callout").classList.remove("show");
  }

  let ghostPose: Sample | null = null;
  let delta: number | null = null;
  if (ghost && ghostOn && launched) {
    ghostPose = sampleAt(ghost.samples, runClock);
    if (ghostPose) delta = drone.z - ghostPose.z;
  }

  world.sync({
    pose: drone,
    ghost: ghostPose,
    crates: cratePositions(task, drone),
    delivery: task.delivery,
    carrying: task.carrying,
    ringsTaken: task.rings,
    crashed: task.crashed,
    crashAge,
    energy: Math.min(1, Math.hypot(command.altitude, command.strafe, command.forward)),
    t: runClock,
  }, dt);
  world.render();

  const live = scoreOf(task);
  text("time", formatTime(live.time));
  text("crates", `${task.delivery}/${level.deliveries.length}`);
  text("points", task.points.toLocaleString());
  text("delta", delta === null ? "--" : `${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)} m`);
  $("delta").dataset.sign = delta === null ? "" : delta >= 0 ? "ahead" : "behind";
  let phase: string;
  if (mode === "menu") phase = level.name;
  else if (task.crashed) phase = "Crashed";
  else if (task.score) phase = "Delivered";
  else if (task.carrying) phase = `Carrying crate ${task.delivery + 1}`;
  else if (launched) phase = `To crate ${task.delivery + 1}`;
  else phase = level.name;
  text("phase", phase);

  if (mode === "hand") renderGesture();
  renderPrompt();

  if (tutorial) {
    const v = tutorial.update({ mode: mode as InputMode, command, pose: mode === "hand" ? pose : null, armed: handSeen, task }, dt);
    text("tutorHint", v.hint);
    $("tutorFill").style.width = `${Math.round(v.progress * 100)}%`;
    const html = v.steps.map((s) => `<li class="${s.state}">${s.title}</li>`).join("");
    if (textCache.get("tutorSteps") !== html) {
      textCache.set("tutorSteps", html);
      $("tutorSteps").innerHTML = html;
    }
  }
  requestAnimationFrame(frame);
}


interface TeachState {
  index: number;
  phase: "ready" | "record";
  until: number;
  count: number;
  last: HandFrame | null;
  model: PersonalModel;
}
const TEACH_FRAMES = 40;
let teach: TeachState | null = null;

function teachFrame(hand: HandFrame | null): void {
  const t = teach;
  if (!t || t.index >= POSES.length) return;
  const target = POSES[t.index];
  if (t.phase === "ready") {
    const left = Math.max(0, t.until - performance.now());
    text("teachText", `Get ready, ${(left / 1000).toFixed(1)} s`);
    $("teachFill").style.width = "0%";
    if (left <= 0) t.phase = "record";
    return;
  }
  // Only count new camera frames with a hand in them.
  if (hand && hand !== t.last) {
    t.model.add(target, hand);
    t.count += 1;
    t.last = hand;
  }
  text("teachText", hand ? "Recording. Move your hand around a little." : "No hand in view.");
  $("teachFill").style.width = `${Math.round((t.count / TEACH_FRAMES) * 100)}%`;
  if (t.count >= TEACH_FRAMES) {
    t.index += 1;
    t.count = 0;
    if (t.index < POSES.length) startTeachPose();
    else finishTeach();
  }
}

function startTeachPose(): void {
  const t = teach!;
  const target = POSES[t.index];
  t.phase = "ready";
  t.until = performance.now() + 1800;
  text("teachTitle", `${POSE_LABEL[target]} (${t.index + 1} of ${POSES.length})`);
  text("teachPose", POSE_LABEL[target]);
  text("teachHow", POSE_HOW[target]);
  $("teachPoseBox").hidden = false;
  $("teachTable").hidden = true;
  $("teachGo").hidden = true;
}

function finishTeach(): void {
  const t = teach!;
  const acc = t.model.accuracy();
  $("teachPoseBox").hidden = true;
  $("teachTable").hidden = false;
  $("teachTable").innerHTML =
    `<tr><th>Pose</th><th>Frames</th><th>Recognised</th></tr>` +
    POSES.map((p) => {
      const n = t.model.samples.filter((s) => s.pose === p).length;
      const a = acc[p] ?? 0;
      return `<tr class="${a < 0.85 ? "weak" : ""}"><td>${POSE_LABEL[p]}</td><td>${n}</td><td>${Math.round(a * 100)}%</td></tr>`;
    }).join("");
  const mean = POSES.reduce((s, p) => s + (acc[p] ?? 0), 0) / POSES.length;
  text("teachTitle", "Your model is ready");
  text("teachText", `${Math.round(mean * 100)}% leave-one-out accuracy. Poses under 85% get confused with another one; redo those with a clearer shape.`);
  personal = t.model;
  usePersonal = true;
  try {
    localStorage.setItem("aerogest.personal", JSON.stringify(personal.toJSON()));
  } catch {
    /* storage blocked: the model still works for this session */
  }
  $("teachGo").hidden = false;
  text("teachGo", "Fly with it");
  teach = null;
}

$("teachBtn").addEventListener("click", () => {
  $("teach").hidden = false;
  $("teachPoseBox").hidden = true;
  $("teachTable").hidden = true;
  $("teachGo").hidden = false;
  text("teachGo", "Start");
  text("teachTitle", "Teach it your hand");
  text("teachText", `Hold each of the ${POSES.length} poses for two seconds. A nearest-neighbour classifier trained on your frames takes over from the built-in one when it is confident.`);
});
$("teachGo").addEventListener("click", () => {
  if ($("teachGo").textContent === "Fly with it") {
    $("teach").hidden = true;
    resetRun();
    return;
  }
  teach = { index: 0, phase: "ready", until: 0, count: 0, last: null, model: new PersonalModel() };
  startTeachPose();
});
$("teachCancel").addEventListener("click", () => {
  teach = null;
  $("teach").hidden = true;
});
$("teachClear").addEventListener("click", () => {
  personal = null;
  try {
    localStorage.removeItem("aerogest.personal");
  } catch {
    /* ignore */
  }
  text("teachText", "Removed. Back to the built-in classifier.");
});

world.applyLevel(level);
setMode("menu");
requestAnimationFrame(frame);
