import * as THREE from "three";
import { gatePose, levelEnd, type Gate, type Level, type Vec3, type WindZone } from "../course/levels";

export interface WorldFrame {
  pose: { x: number; y: number; z: number; yaw: number };
  ghost?: { x: number; y: number; z: number; yaw: number } | null;
  crates: Vec3[];
  /** Index of the delivery in progress; earlier pads are done. */
  delivery: number;
  carrying: boolean;
  ringsTaken: readonly string[];
  /** Gate the drone crashed into. */
  crashed: string | null;
  /** Seconds since the crash, drives the tumble. */
  crashAge: number;
  energy: number;
  /** Level clock for moving gates and effects. */
  t: number;
}

const INDIGO = 0x243e8a;
const ORANGE = 0xec5a26;
const GHOST = 0x3f94d6;
const RED = 0xef4b3c;
const GOOD = 0x4fb87a;
const GOLD = 0xf2b632;
const TRAIL_MAX = 6000;
const STREAKS = 70;

function numberTexture(n: number, fg: string, bg: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = fg;
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, 112, 112);
  ctx.fillStyle = fg;
  ctx.font = "700 76px 'Archivo Variable', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(n), 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface WindVisual {
  zone: WindZone;
  streaks: THREE.LineSegments;
  seeds: Float32Array;
}

export class World {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(58, 1, 0.1, 300);
  private readonly drone: THREE.Group;
  private readonly rotors: THREE.Object3D[];
  private readonly ghost: THREE.Group;
  private readonly ghostRotors: THREE.Object3D[];
  private readonly camPos = new THREE.Vector3(0, 5.8, -8);
  private readonly look = new THREE.Vector3(0, 2.6, 3);
  private readonly hemi: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private readonly trail: THREE.Line;
  private readonly trailPos = new Float32Array(TRAIL_MAX * 3);
  private trailCount = 0;

  private scenery = new THREE.Group();
  private gates: { gate: Gate; group: THREE.Group; ring: THREE.MeshBasicMaterial; wall: THREE.MeshStandardMaterial; fade: number }[] = [];
  private rings: { id: string; mesh: THREE.Mesh }[] = [];
  private crates: THREE.Mesh[] = [];
  private pads: { ring: THREE.MeshBasicMaterial; beacon: THREE.Mesh; label: THREE.Mesh }[] = [];
  private winds: WindVisual[] = [];
  private ringColor = INDIGO;
  private padColor = ORANGE;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.hemi = new THREE.HemisphereLight(0xf7fbff, 0xe4d7c4, 0.85);
    this.sun = new THREE.DirectionalLight(0xfff6ea, 1.15);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 80 });
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.hemi, this.sun, this.sun.target);

    const built = buildDrone();
    this.drone = built.group;
    this.rotors = built.rotors;
    this.drone.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
    });
    this.scene.add(this.drone);

    const ghost = buildDrone(GHOST, 0.38);
    this.ghost = ghost.group;
    this.ghostRotors = ghost.rotors;
    this.ghost.visible = false;
    this.scene.add(this.ghost);

    const tg = new THREE.BufferGeometry();
    tg.setAttribute("position", new THREE.BufferAttribute(this.trailPos, 3));
    tg.setDrawRange(0, 0);
    this.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: ORANGE, transparent: true, opacity: 0.7 }));
    this.trail.frustumCulled = false;
    this.scene.add(this.trail);

    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.look);
    this.resize();
  }

  resize(): void {
    const parent = this.renderer.domElement.parentElement;
    const width = parent?.clientWidth || window.innerWidth;
    const height = Math.max(parent?.clientHeight || window.innerHeight, 1);
    this.camera.aspect = width / height;
    this.camera.fov = this.camera.aspect < 1 ? 78 : 58;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  applyLevel(level: Level): void {
    const theme = level.theme;
    this.ringColor = theme.ring;
    this.padColor = theme.padRing;
    this.scene.background = new THREE.Color(theme.sky);
    this.scene.fog = new THREE.Fog(theme.sky, theme.fogNear, theme.fogFar);
    this.hemi.color.setHex(theme.hemiSky);
    this.hemi.groundColor.setHex(theme.hemiGround);
    this.sun.color.setHex(theme.sun);
    this.sun.intensity = theme.sunLevel;
    this.dropScenery();
    this.addGround(level);
    for (const g of level.gates) this.addGate(g, theme.wall);
    for (const w of level.wind) this.addWind(w);
    for (const r of level.rings) this.addRing(r.id, r.x, r.y, r.z, r.radius);
    level.deliveries.forEach((d, i) => {
      this.addPad(d.pad, i, theme.pad);
      this.addCrate(i);
    });
    this.scene.add(this.scenery);
    this.clearTrail();
  }

  sync(frame: WorldFrame, dt: number): void {
    const { pose } = frame;
    this.drone.position.set(pose.x, pose.y, pose.z);
    this.drone.rotation.set(frame.crashed ? Math.min(1.2, frame.crashAge * 3) : 0, pose.yaw, frame.crashed ? frame.crashAge * 2.5 : 0, "YXZ");
    const spin = frame.crashed ? 0 : (8 + frame.energy * 28) * dt;
    for (const rotor of this.rotors) rotor.rotation.z += spin;

    this.ghost.visible = !!frame.ghost;
    if (frame.ghost) {
      this.ghost.position.set(frame.ghost.x, frame.ghost.y, frame.ghost.z);
      this.ghost.rotation.y = frame.ghost.yaw;
      for (const rotor of this.ghostRotors) rotor.rotation.z += 20 * dt;
    }

    // Walls the drone has passed fade out so they never hide it from the chase camera.
    const ease = 1 - Math.exp(-8 * dt);
    for (const g of this.gates) {
      const p = gatePose(g.gate, frame.t);
      g.group.position.set(p.x, p.y, g.gate.z);
      const hit = frame.crashed === g.gate.id;
      g.ring.color.setHex(hit ? RED : this.ringColor);
      g.fade += ((pose.z > g.gate.z + 0.4 && !hit ? 0.12 : 1) - g.fade) * ease;
      g.wall.opacity = g.fade;
      g.wall.transparent = g.fade < 0.99;
      g.wall.depthWrite = g.fade >= 0.99;
      g.ring.opacity = 0.3 + 0.7 * g.fade;
      g.ring.transparent = g.fade < 0.99;
    }

    for (const r of this.rings) {
      r.mesh.visible = !frame.ringsTaken.includes(r.id);
      r.mesh.rotation.z = frame.t * 1.6;
    }

    frame.crates.forEach((c, i) => {
      const mesh = this.crates[i];
      if (!mesh) return;
      mesh.position.set(c.x, c.y, c.z);
    });
    this.pads.forEach((p, i) => {
      const done = i < frame.delivery;
      const active = i === frame.delivery;
      p.ring.color.setHex(done ? GOOD : this.padColor);
      p.ring.opacity = done || active ? 1 : 0.35;
      p.beacon.visible = active && frame.carrying;
      p.label.visible = !done;
      if (p.beacon.visible) (p.beacon.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.06 * Math.sin(frame.t * 5);
    });
    // Beacon over the crate to pick up next.
    this.crates.forEach((mesh, i) => {
      const beacon = mesh.userData.beacon as THREE.Mesh;
      beacon.visible = i === frame.delivery && !frame.carrying;
    });

    for (const w of this.winds) this.animateWind(w, frame.t);

    const sin = Math.sin(pose.yaw);
    const cos = Math.cos(pose.yaw);
    const desired = new THREE.Vector3(pose.x - sin * 8, pose.y + 3.6, pose.z - cos * 8);
    const focus = new THREE.Vector3(pose.x + sin * 4, pose.y + 0.5, pose.z + cos * 4);
    const follow = 1 - Math.exp(-4.5 * Math.max(dt, 0));
    this.camPos.lerp(desired, follow);
    this.look.lerp(focus, follow);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.look);
    this.sun.position.set(pose.x - 14, 30, pose.z - 16);
    this.sun.target.position.set(pose.x, 0, pose.z);
  }

  pushTrail(x: number, y: number, z: number): void {
    if (this.trailCount >= TRAIL_MAX) return;
    const i = this.trailCount * 3;
    if (this.trailCount > 0) {
      const dx = x - this.trailPos[i - 3];
      const dy = y - this.trailPos[i - 2];
      const dz = z - this.trailPos[i - 1];
      if (dx * dx + dy * dy + dz * dz < 0.04) return;
    }
    this.trailPos.set([x, y, z], i);
    this.trailCount += 1;
    this.trail.geometry.setDrawRange(0, this.trailCount);
    this.trail.geometry.attributes.position.needsUpdate = true;
  }

  clearTrail(): void {
    this.trailCount = 0;
    this.trail.geometry.setDrawRange(0, 0);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }


  private dropScenery(): void {
    this.scene.remove(this.scenery);
    this.scenery.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    });
    this.scenery = new THREE.Group();
    this.gates = [];
    this.rings = [];
    this.crates = [];
    this.pads = [];
    this.winds = [];
  }

  private addGround(level: Level): void {
    const theme = level.theme;
    const far = levelEnd(level);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(90, far + 30),
      new THREE.MeshStandardMaterial({ color: theme.ground, roughness: 1, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, far / 2 - 2);
    ground.receiveShadow = true;
    this.scenery.add(ground);
    const positions: number[] = [];
    const y = 0.02;
    for (let x = -14; x <= 14; x += 2) positions.push(x, y, -4, x, y, far);
    for (let z = -4; z <= far; z += 2) positions.push(-14, y, z, 14, y, z);
    const grid = new THREE.BufferGeometry();
    grid.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    this.scenery.add(new THREE.LineSegments(grid, new THREE.LineBasicMaterial({ color: theme.grid })));
  }

  private addGate(gate: Gate, wallColor: number): void {
    const group = new THREE.Group();
    const shape = new THREE.Shape();
    // The wall reaches the ground at the gate's highest point; when a bobbing
    // gate drops, the bottom of the wall sinks out of sight below the floor.
    const ground = -(gate.y + (gate.motion?.axis === "y" ? gate.motion.amp : 0));
    const top = gate.radius + gate.crown;
    const half = gate.halfWidth;
    shape.moveTo(-half, ground);
    shape.lineTo(half, ground);
    shape.lineTo(half, top);
    shape.lineTo(-half, top);
    shape.closePath();
    const hole = new THREE.Path();
    hole.absarc(0, 0, gate.radius, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: gate.thickness, bevelEnabled: false, curveSegments: 40 });
    const wallMat = new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.9, side: THREE.DoubleSide });
    const wall = new THREE.Mesh(geo, wallMat);
    wall.position.z = -gate.thickness / 2;
    wall.castShadow = true;
    wall.receiveShadow = true;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18 }));
    edges.position.z = wall.position.z;
    group.add(wall, edges);
    const ringMat = new THREE.MeshBasicMaterial({ color: this.ringColor });
    group.add(new THREE.Mesh(new THREE.TorusGeometry(gate.radius, 0.09, 10, 64), ringMat));
    if (gate.motion) {
      // Chevrons on the wall show which way it moves.
      const arrowMat = new THREE.MeshBasicMaterial({ color: this.ringColor, side: THREE.DoubleSide });
      for (const s of [-1, 1]) {
        const tri = new THREE.Mesh(new THREE.CircleGeometry(0.28, 3), arrowMat);
        if (gate.motion.axis === "x") tri.position.set(s * (gate.radius + 0.75), 0, -gate.thickness / 2 - 0.02);
        else tri.position.set(0, s * (gate.radius + 0.6), -gate.thickness / 2 - 0.02);
        tri.rotation.z = gate.motion.axis === "x" ? (s > 0 ? 0 : Math.PI) : s > 0 ? Math.PI / 2 : -Math.PI / 2;
        group.add(tri);
      }
    }
    group.position.set(gate.x, gate.y, gate.z);
    this.scenery.add(group);
    this.gates.push({ gate, group, ring: ringMat, wall: wallMat, fade: 1 });
  }

  private addRing(id: string, x: number, y: number, z: number, radius: number): void {
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.08, 8, 48, Math.PI * 1.75),
      new THREE.MeshBasicMaterial({ color: GOLD }),
    );
    mesh.position.set(x, y, z);
    this.scenery.add(mesh);
    this.rings.push({ id, mesh });
  }

  private addWind(zone: WindZone): void {
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(zone.halfX * 2, 9, zone.halfZ * 2),
      new THREE.MeshBasicMaterial({ color: 0x9fd3ff, transparent: true, opacity: 0.08, depthWrite: false }),
    );
    slab.position.set(zone.x, 4.5, zone.z);
    this.scenery.add(slab);
    const seeds = new Float32Array(STREAKS * 3);
    for (let i = 0; i < STREAKS; i += 1) {
      seeds[i * 3] = Math.random();
      seeds[i * 3 + 1] = 0.5 + Math.random() * 7.5;
      seeds[i * 3 + 2] = (Math.random() * 2 - 1) * zone.halfZ;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(STREAKS * 6), 3));
    const streaks = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x5aa8e8, transparent: true, opacity: 0.6 }));
    streaks.frustumCulled = false;
    this.scenery.add(streaks);
    this.winds.push({ zone, streaks, seeds });
  }

  private animateWind(w: WindVisual, t: number): void {
    const { zone, seeds } = w;
    const pos = w.streaks.geometry.attributes.position as THREE.BufferAttribute;
    const speed = Math.hypot(zone.vx, zone.vz) || 1;
    const dirX = zone.vx / speed;
    const span = zone.halfX * 2;
    for (let i = 0; i < STREAKS; i += 1) {
      const phase = (seeds[i * 3] + (t * speed) / span) % 1;
      const x = zone.x + (dirX >= 0 ? -zone.halfX + phase * span : zone.halfX - phase * span);
      const y = seeds[i * 3 + 1];
      const z = zone.z + seeds[i * 3 + 2];
      pos.setXYZ(i * 2, x, y, z);
      pos.setXYZ(i * 2 + 1, x + dirX * 0.9, y, z);
    }
    pos.needsUpdate = true;
  }

  private addPad(pad: Vec3, index: number, color: number): void {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(2.8, 48), new THREE.MeshStandardMaterial({ color, roughness: 1 }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(pad.x, 0.015, pad.z);
    disc.receiveShadow = true;
    this.scenery.add(disc);
    const ringMat = new THREE.MeshBasicMaterial({ color: this.padColor, side: THREE.DoubleSide, transparent: true });
    for (const [inner, outer] of [[2.35, 2.55], [1.35, 1.5], [0.35, 0.5]] as const) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 64), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(pad.x, 0.03, pad.z);
      this.scenery.add(ring);
    }
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 1.1),
      new THREE.MeshBasicMaterial({ map: numberTexture(index + 1, "#ec5a26", "#ffffff"), transparent: true }),
    );
    // Lie flat with the top of the digit pointing down the course, so it reads from the chase camera.
    label.rotation.set(-Math.PI / 2, 0, Math.PI);
    label.position.set(pad.x + 1.9, 0.04, pad.z - 1.9);
    this.scenery.add(label);
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(2.5, 2.5, 7, 40, 1, true),
      new THREE.MeshBasicMaterial({ color: this.padColor, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }),
    );
    beacon.position.set(pad.x, 3.5, pad.z);
    beacon.visible = false;
    this.scenery.add(beacon);
    this.pads.push({ ring: ringMat, beacon, label });
  }

  private addCrate(index: number): void {
    const tex = numberTexture(index + 1, "#5b3d1e", "#c9a36b");
    const mats = Array.from({ length: 6 }, () => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 }));
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), mats);
    crate.castShadow = true;
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 3, 8),
      new THREE.MeshBasicMaterial({ color: this.ringColor }),
    );
    beacon.position.y = 1.7;
    crate.add(beacon);
    crate.userData.beacon = beacon;
    this.scenery.add(crate);
    this.crates.push(crate);
  }
}

function buildDrone(tint?: number, alpha = 1): { group: THREE.Group; rotors: THREE.Object3D[] } {
  const group = new THREE.Group();
  const ghosted = tint !== undefined;
  const look = (color: number) => (ghosted ? { color: tint, transparent: true, opacity: alpha, depthWrite: false } : { color });
  const bodyMat = new THREE.MeshStandardMaterial({ ...look(0xe8ecee), metalness: 0.35, roughness: 0.4 });
  const darkMat = new THREE.MeshStandardMaterial({ ...look(0x1d1f22), metalness: 0.2, roughness: 0.55 });
  const accent = new THREE.MeshBasicMaterial(look(ORANGE));
  const rotorMat = new THREE.MeshBasicMaterial({
    color: ghosted ? tint : INDIGO,
    transparent: true,
    opacity: ghosted ? alpha * 0.6 : 0.45,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 14), bodyMat);
  body.scale.set(1.15, 0.72, 1.45);
  group.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 10), accent);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = 0.4;
  group.add(nose);

  const rotors: THREE.Object3D[] = [];
  for (let i = 0; i < 4; i += 1) {
    const angle = Math.PI / 4 + (i * Math.PI) / 2;
    const ax = Math.cos(angle) * 0.52;
    const az = Math.sin(angle) * 0.52;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.035, 0.055), darkMat);
    arm.position.set(Math.cos(angle) * 0.26, 0.05, Math.sin(angle) * 0.26);
    arm.rotation.y = -angle;
    group.add(arm);
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.08, 12), darkMat);
    motor.position.set(ax, 0.09, az);
    group.add(motor);
    const pivot = new THREE.Group();
    pivot.position.set(ax, 0.145, az);
    pivot.rotation.x = -Math.PI / 2;
    const rotor = new THREE.Mesh(new THREE.CircleGeometry(0.24, 28), rotorMat);
    pivot.add(rotor);
    group.add(pivot);
    rotors.push(rotor);
  }
  for (const side of [-1, 1]) {
    const skid = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 0.5), darkMat);
    skid.position.set(side * 0.16, -0.2, 0.02);
    group.add(skid);
    for (const z of [0.16, -0.12]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.02), darkMat);
      strut.position.set(side * 0.16, -0.11, z);
      group.add(strut);
    }
  }
  if (!ghosted) {
    const light = new THREE.PointLight(ORANGE, 0.7, 8, 2);
    light.position.set(0, -0.05, 0.2);
    group.add(light);
  }
  return { group, rotors };
}
