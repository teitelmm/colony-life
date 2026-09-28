/** High-angle chase camera with aim look-ahead, zoom and trauma-based shake. */

import { PerspectiveCamera, Vector3 } from 'three';

export class CameraRig {
  readonly camera: PerspectiveCamera;
  readonly focus = new Vector3();
  private readonly vel = new Vector3();
  height = 24;
  private targetHeight = 24;
  private trauma = 0;
  private t = 0;

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(42, aspect, 0.5, 5000);
  }

  zoom(delta: number): void {
    this.targetHeight = Math.max(16, Math.min(60, this.targetHeight * (1 + delta)));
  }

  /** Add shake, attenuated by distance from what we're looking at. */
  shake(amount: number, x: number, z: number): void {
    const d = Math.hypot(x - this.focus.x, z - this.focus.z);
    this.trauma = Math.min(1, this.trauma + amount / (1 + d / 25));
  }

  snap(to: Vector3): void {
    this.focus.copy(to);
    this.vel.set(0, 0, 0);
  }

  update(dt: number, boatPos: Vector3, boatVel: Vector3, aim: Vector3 | null): void {
    this.t += dt;
    const goal = boatPos.clone().addScaledVector(boatVel, 0.5);
    if (aim) {
      const off = aim.clone().sub(boatPos);
      off.y = 0;
      const max = this.height * 0.18;
      off.multiplyScalar(0.15);
      if (off.length() > max) off.setLength(max);
      goal.add(off);
    }
    goal.y = 0;
    // Critically damped spring toward the goal.
    const k = 4;
    const accel = goal.sub(this.focus).multiplyScalar(k * k).addScaledVector(this.vel, -2 * k);
    this.vel.addScaledVector(accel, dt);
    this.focus.addScaledVector(this.vel, dt);

    this.height += (this.targetHeight - this.height) * Math.min(1, dt * 5);
    const cam = this.camera;
    cam.position.set(this.focus.x, this.focus.y + this.height, this.focus.z + this.height * 0.5);
    cam.lookAt(this.focus);

    if (this.trauma > 0) {
      const s = this.trauma * this.trauma;
      const n = (o: number) => Math.sin(this.t * 37 + o) * 0.6 + Math.sin(this.t * 71 + o * 2.3) * 0.4;
      cam.position.x += n(1) * s * 1.4;
      cam.position.y += n(2) * s * 0.8;
      cam.position.z += n(3) * s * 1.4;
      cam.rotateZ(n(4) * s * 0.04);
      this.trauma = Math.max(0, this.trauma - dt * 1.6);
    }
  }
}
