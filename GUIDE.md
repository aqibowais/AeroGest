# AeroGest: the full story

How the project works, why it was built this way, and how to defend it. Read it once top to bottom; the headings are there for revision.

---

## 1. The project in 30 seconds

> AeroGest is a browser game where you fly a delivery drone with hand signs in front of your webcam. MediaPipe gives 21 hand landmarks per frame. My classifier turns them into eight commands using MediaPipe's trained gesture model where it is confident and 3D joint-angle rules where it isn't, then smooths the decision with a vote over recent frames. A player can also train a personal k-nearest-neighbour model on their own hand in about 20 seconds. Everything runs on the user's machine; no video leaves the browser.

What it shows: a real-time computer-vision pipeline that has to be *reliable*, not just accurate on a test set. That means turning a noisy per-frame prediction into a control signal someone can actually fly with, and measuring it honestly.

---

## 2. Architecture

```
webcam ─► MediaPipe GestureRecognizer ─► HandFrame ─► classify() ─► PoseFilter ─► command ─► drone physics ─► game rules ─► three.js
          (landmarks, 3D world points,     (per frame)   (fusion)       (vote)      (velocity)   (60 Hz)        (crash, points)
           gesture class + score)
```

Every input source (hand, keyboard, touch, autopilot) produces the same `ControlCommand` (forward, strafe, altitude, yaw, grab). So the physics and scoring never need to know who is flying, and the autopilot is a fair reference.

---

## 3. Hand tracking: what MediaPipe gives you

- **Model:** MediaPipe Tasks `GestureRecognizer` (float16), running in WebAssembly. It tries the GPU delegate first and falls back to CPU.
- **Per hand, per frame:**
  - **21 image landmarks:** x and y normalised to the image, plus a relative depth.
  - **21 world landmarks:** in metres, centred on the hand. These are what make the joint angles reliable.
  - **A gesture class with a confidence score:** one of `Open_Palm`, `Closed_Fist`, `Pointing_Up`, `Thumb_Up`, `Thumb_Down`, `Victory`, `ILoveYou`, `None`.
- The model only runs when the camera has a new frame (not on every render frame), which saves work on slow machines.
- **Why MediaPipe:** it is accurate, fast enough for real time in a browser, needs no server, and the landmark model was trained on far more hands than any custom dataset I could collect.

The landmark numbering you need: 0 wrist; thumb 1–4; index 5–8; middle 9–12; ring 13–16; pinky 17–20. In each finger the order runs knuckle → middle joint (PIP) → next joint (DIP) → tip.

---

## 4. The classifier (`src/control/gestures.ts`)

### Layer 1: features
- **Finger bend:**
  - The angle between the knuckle→middle-joint segment and the middle-joint→tip segment, measured on the **3D world landmarks**.
  - An angle is the same however the hand is rotated or how far it is from the camera, unlike 2D pixel distances.
  - **Extended:** bend < 50° *and* the tip is further from the wrist than the middle joint.
  - **Curled:** bend > 80°, or the tip is closer to the wrist than the middle joint.
- **Thumb out:**
  - The thumb is straight (< 60° bend) *and* its tip is clear of the index and middle fingers by more than 0.45 palm lengths.
  - In a fist the thumb tip rests on the curled fingers, which is how the two cases are told apart.
- **Thumb direction:** from thumb base to tip in the **mirrored** image, so "your right" means right on the screen.
- **Pinch gap:** the distance between thumb tip and index tip in centimetres (world landmarks).
- **Index reach:** the distance from the index tip to the wrist, in palm lengths.

### Layer 2: fusion, in priority order
1. **Personal model.** If trained and its vote is ≥ 80% confident, use it.
2. **Pinch → stop.** The gap is < 3.2 cm *and* the index reaches more than one palm length. Without the reach check, a real fist (the thumb touches the index, measured gap about 3 cm) read as stop.
3. **Fist-like hand.** MediaPipe says `Closed_Fist`/`Thumb_Up`/`Thumb_Down` with score ≥ 0.6, or all four fingers are curled. Then:
   - thumb out and pointing left/right → slide left/right;
   - thumbs up → climb;
   - thumbs down → back;
   - otherwise → grab.
4. **MediaPipe classes:** `Open_Palm` → forward, `Pointing_Up` → climb, `Victory` → descend.
5. **Rules for the rest:** 4 fingers extended (or index+middle+ring) → forward; index+middle → descend; index only → climb.

Why fuse instead of using only MediaPipe's classes? It has no class for "thumb pointing sideways" or "pinch", and its classes drop out at odd angles. Why not only rules? The trained model is more robust where it does apply. Using each where it is strong is the point.

### Layer 3: temporal voting (`PoseFilter`)
- A new pose takes over only when it wins **5 of the last 7 frames**. **Stop needs only 3**, so braking is fast. A single noisy frame no longer resets the command.
- **Grab is a toggle**, so it needs the fist **held for 0.35 s**. The sideways-thumb poses start from a fist, and without the hold every slide would briefly grab the crate.
- If the hand leaves the frame for more than 0.25 s, the drone hovers.

### Personal model ("Teach my hand")
- **Recording:** 40 frames per pose for all eight poses, which takes about 20 seconds.
- **Embedding** (one vector per frame):
  - the 21 world landmarks relative to the wrist, scaled by palm length, with x mirrored;
  - plus the thumb's direction in the image, since world landmarks alone don't fix which way the hand faces the camera.
- **Classifier:** k-nearest-neighbours with k = 5. Confidence is the share of the 5 neighbours that agree.
- **Self-check:** leave-one-out accuracy per pose. Each recorded frame is classified using all the others, so the player sees which poses their hand makes ambiguous.
- **Why k-NN:** no training step, works from a few hundred samples, runs instantly in the browser, and is easy to explain. A neural network would need far more data and offers nothing extra here.

---

## 5. Testing the vision part honestly

- **Synthetic hand:**
  - The unit tests build a hand from finger chains in metres with a per-joint curl, then project it to the image. The thumb can be open, tucked, sideways, up, down or pinched, and there is a left-hand variant.
  - This tests every rule and the known confusions (fist vs. sideways thumb, fist vs. pinch) without needing a camera.
- **Real hands:**
  - MediaPipe's own sample photos were turned into a fake webcam stream (Chrome's `--use-file-for-fake-video-capture`) and fed through the running app.
  - Open hand, pointing, victory, thumbs up/down, fist, and both sideways thumbs (thumbs-up rotated 90°) were all recognised correctly.
  - There was no pinch photo, so pinch is covered by the synthetic tests only.
- **The bugs that testing caught**, worth mentioning because they show debugging:
  1. Pinch never fired: the first rule required the index to be *extended*, but a real pinch curls it.
  2. A fist read as "slide left", because the thumb check ran before the fist check.
  3. One noisy frame reset the pose to stop, so control stuttered. Voting fixed it.
  4. Left and right were swapped in the physics. three.js is right-handed, so +x is screen-left for a camera looking down +z.

---

## 6. The drone and the game

- **Physics** (`physics/drone.ts`):
  - **Kinematic hover model:** the command sets a target velocity (up to 7.5 m/s horizontally, 4.2 m/s vertically). The drone eases toward it exponentially with a time constant of about 0.18 s.
  - **Wind** adds a velocity on top.
  - **Why not a real quadrotor model:** with hand control, you want the drone to do what the pose says. Thrust/attitude dynamics would make a gesture interface unflyable, and the project is about the interface.
- **Levels** (`course/levels.ts`): six levels with gates (walls with a hole), moving gates (sinusoidal slide/bob), wind zones, bonus rings and 1–3 crate deliveries. Distances were stretched 1.8× so there is room to see the drone and line up between walls.
- **Rules** (`course/task.ts`):
  - **Crashes:** touching a wall is a crash and ends the run. The hit test is a box around the gate minus the hole, and it follows moving gates.
  - **Gate credit:** a gate counts when the path segment between two frames crosses its plane inside the hole. Testing the segment, not just the end points, means a fast drone can't skip through between frames.
  - **Crates:** must be picked up and dropped in order, and drops only count on the pad.
- **Points** (`course/points.ts`): gate 100, ring 150, crate 400 + up to 200 for landing near the pad centre, and 40 per second under the bronze time.
- **Medal time:** flight time + 2 s per metre a crate lands off-centre − 1.5 s per ring.
- **Camera:** an 8 m chase camera. Walls you've passed fade to 12% opacity, because otherwise the wall you just flew through hides the drone.

### The autopilot (`autopilot/`)
- A waypoint pilot. It flies to points before and after each gate and ring, settles over the crate, grabs, flies to the pad, and drops.
- **Moving gates:** it aims at where the hole will be when it arrives (it predicts with the estimated time of arrival).
- **Wind:** it subtracts the known wind from its velocity command.
- **Medals:** it flies every level headlessly at 60 Hz (deterministic). That time sets the medals: gold within 10%, silver 40%, bronze 90%. It is also the ghost for new players.
- **Test:** a unit test requires it to finish every level, through every gate and ring, with every crate delivered and no crash. If someone edits a level and makes it impossible, the test fails.

---

## 7. Engineering choices you may be asked about

- **Why the browser and not Python + OpenCV:** zero install for the user, free static hosting (Render), and privacy (video never leaves the tab). The cost is that the whole pipeline must fit a frame budget in JavaScript.
- **Why TypeScript + Vite + three.js:** type safety for a project with many interacting parts, fast builds, and three.js is the standard WebGL library.
- **Why tests run before deploy:** `npm ci && npm test && npm run build` on Render, so a broken classifier or impossible level can't ship.
- **Latency:** the pilot panel shows model latency and fps. The vote adds about 5 frames (~80–170 ms depending on camera fps) before a pose change, a deliberate trade of a little lag for no flicker. Stop is faster, at 3 frames.

---

## 8. Questions you should be ready for

**How accurate is it?**
On the sample photos, every tested pose was right. I don't have a user study, so I don't claim a percentage. The personal model reports its own leave-one-out accuracy per user, which is the honest number for that person's hand and camera.

**What happens with a left hand?**
Joint angles don't depend on handedness, and the thumb direction is measured in the mirrored image, so "thumb to your right" means right for either hand. The synthetic tests include a left hand.

**Why majority voting rather than a Kalman filter or an HMM?**
The output is a discrete class, not a continuous quantity, so a Kalman filter doesn't fit. An HMM would work but needs transition probabilities I'd have to guess. Voting has two parameters, a clear meaning, and a measurable delay.

**What breaks it?**
Poor lighting, the hand partly out of frame, and the hand turned edge-on to the camera (fingers overlap in 2D, so the landmarks are less reliable). The personal model and the speed slider are the user-side fixes.

**Is the autopilot "AI"?**
No, and I don't call it that. It's a scripted waypoint controller. Its job is to prove every level is completable and to set fair medal times.

**What would you do next?**
- A small user study (time-to-complete and gesture error rates across people).
- Collect real labelled frames and train a small MLP on the landmark vectors to replace the hand-tuned rules.
- Dynamic gestures (swipes) using a short temporal window.

---

## 9. Words to know

- **Landmarks:** keypoints the model locates on the hand (21 per hand).
- **World landmarks:** the same points in metres in 3D, relative to the hand.
- **Delegate:** where MediaPipe runs inference (GPU or CPU).
- **k-NN:** classify by majority label of the k closest stored examples.
- **Leave-one-out:** evaluate each sample using a model built from all the others.
- **Rising edge:** a signal changing from off to on. The grab acts on that moment only, so holding a fist can't grab and drop at once.
