/**
 * Fishing: schools of fish show as dark, restless patches with gulls wheeling
 * overhead. Stop on one and hold F to haul in food — and now and then some
 * scrap that came up in the net.
 */

import { BoxGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, Vector3, type Scene } from 'three';
import { Rope } from '../fx/Rope';
import type { Boat } from '../boat/Boat';
import type { World } from './World';
import { PType } from '../fx/Particles';

export interface School {
  x: number;
  z: number;
  radius: number;
  stock: number;
  fade: number;
  gulls: Group[];
  jumpTimer: number;
}

export interface Catch {
  food: number;
  wood: number;
  metal: number;
}

/** Base hauls per second while stopped on a school. */
export const HAUL_RATE = 0.22;
export const MAX_FISHING_SPEED = 1.6;

const gullMat = new MeshStandardMaterial({ color: 0xe9e6de, roughness: 0.8 });
const lineMat = new MeshStandardMaterial({ color: 0xd8cfae, roughness: 1 });
const floatMat = new MeshStandardMaterial({ color: 0xe84a2a, roughness: 0.5 });
const _a = new Vector3();
const _b = new Vector3();

function makeGull(): Group {
  // Three meshes, no shadows: gulls fly high and are tiny from the camera.
  const g = new Group();
  const body = new Mesh(new BoxGeometry(0.12, 0.1, 0.4), gullMat);
  const lw = new Mesh(new BoxGeometry(0.68, 0.02, 0.16), gullMat);
  lw.geometry.translate(-0.34, 0, 0);
  const rw = new Mesh(new BoxGeometry(0.68, 0.02, 0.16), gullMat);
  rw.geometry.translate(0.34, 0, 0);
  lw.name = 'l';
  rw.name = 'r';
  g.add(body, lw, rw);
  return g;
}

export class Fishing {
  readonly schools: School[] = [];
  /** 0..1 progress to the next haul */
  progress = 0;
  active = false;
  private line: Rope;
  private float: Mesh;

  constructor(private readonly scene: Scene) {
    this.line = new Rope(lineMat, 9, 0.015, 3);
    this.line.visible = false;
    this.float = new Mesh(new SphereGeometry(0.12, 8, 6), floatMat);
    this.float.visible = false;
    scene.add(this.line, this.float);
  }

  private spawn(world: World, near: Vector3): void {
    for (let tries = 0; tries < 30; tries++) {
      const a = Math.random() * Math.PI * 2;
      const d = 35 + Math.random() * 110;
      const x = near.x + Math.cos(a) * d;
      const z = near.z + Math.sin(a) * d;
      if (!world.scenery.isClear(x, z, 10)) continue;
      const gulls = Array.from({ length: 2 + ((Math.random() * 3) | 0) }, () => {
        const g = makeGull();
        this.scene.add(g);
        return g;
      });
      this.schools.push({ x, z, radius: 4 + Math.random() * 3, stock: 5 + ((Math.random() * 5) | 0), fade: 0, gulls, jumpTimer: 0 });
      return;
    }
  }

  private remove(i: number): void {
    for (const g of this.schools[i].gulls) this.scene.remove(g);
    this.schools.splice(i, 1);
  }

  /** The school the boat is sitting on, if any. */
  schoolAt(boat: Boat): School | null {
    boat.centerWorld(_a);
    return this.schools.find((s) => s.stock > 0 && Math.hypot(s.x - _a.x, s.z - _a.z) < s.radius + boat.stats.radius + 2) ?? null;
  }

  canFish(boat: Boat): boolean {
    return boat.alive && Math.abs(boat.forwardSpeed()) < MAX_FISHING_SPEED && this.schoolAt(boat) !== null;
  }

  /**
   * @param hauling the player is holding F
   * @param rate multiplier (net cranes, free crew, hunger)
   */
  update(dt: number, world: World, boat: Boat | null, hauling: boolean, rate: number): Catch | null {
    const fx = world.effects;
    const focus = boat ? boat.centerWorld(new Vector3()) : new Vector3();

    // Keep a few schools around the player; let far ones go.
    for (let i = this.schools.length - 1; i >= 0; i--) {
      const s = this.schools[i];
      const far = Math.hypot(s.x - focus.x, s.z - focus.z) > 220;
      s.fade = Math.max(0, Math.min(1, s.fade + (s.stock > 0 && !far ? dt : -dt) * 0.4));
      if ((s.stock <= 0 || far) && s.fade <= 0) this.remove(i);
    }
    while (this.schools.filter((s) => s.stock > 0).length < 4) this.spawn(world, focus);

    for (const s of this.schools) {
      if (s.fade <= 0) continue;
      world.foam.school(s.x, s.z, s.radius, s.fade);
      // Fish breaking the surface.
      s.jumpTimer -= dt;
      if (s.jumpTimer <= 0 && s.stock > 0) {
        s.jumpTimer = 0.4 + Math.random() * 0.9;
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * s.radius * 0.8;
        const x = s.x + Math.cos(a) * r;
        const z = s.z + Math.sin(a) * r;
        const y = world.water.height(x, z);
        for (let k = 0; k < 3; k++) {
          fx.smoke.emit({ x, y, z, vx: Math.cos(a) * 1.5, vy: 3.5 + Math.random(), vz: Math.sin(a) * 1.5, life: 0.7, size: 0.16, color: 0xc9d4da, alpha: 1, alphaEnd: 1, gravity: 9.8, spin: 8, type: PType.Chunk, killBelow: y - 0.1 });
        }
        world.foam.ring(x, z, 0.9, 1, 0.5);
      }
      // Gulls wheel overhead.
      s.gulls.forEach((g, i) => {
        const t = world.time * (0.35 + i * 0.07) + i * 2.1;
        const R = s.radius + 2 + i;
        g.position.set(s.x + Math.cos(t) * R, 6 + i * 0.8 + Math.sin(t * 2) * 0.4, s.z + Math.sin(t) * R);
        g.rotation.set(0, -t, Math.sin(t) * 0.3);
        const flap = Math.sin(world.time * 9 + i) * 0.5;
        g.getObjectByName('l')!.rotation.z = flap;
        g.getObjectByName('r')!.rotation.z = -flap;
        g.visible = s.fade > 0.2;
      });
    }

    // The net or line over the side.
    const school = boat ? this.schoolAt(boat) : null;
    this.active = !!(boat && hauling && school && this.canFish(boat));
    this.line.visible = this.float.visible = this.active;
    if (!this.active || !boat || !school) {
      this.progress = Math.max(0, this.progress - dt * 0.2);
      return null;
    }
    boat.body.localToWorld(_a.set(boat.stats.centerX + boat.stats.halfWidth, 1.2, boat.stats.centerZ), _a);
    boat.body.localToWorld(_b.set(boat.stats.centerX + boat.stats.halfWidth + 3, 0, boat.stats.centerZ + 1), _b);
    _b.y = world.water.height(_b.x, _b.z);
    this.float.position.copy(_b).setY(_b.y + Math.sin(world.time * 5) * 0.05);
    const pts = this.line.points;
    for (let i = 0; i < pts.length; i++) {
      const t = i / (pts.length - 1);
      pts[i].lerpVectors(_a, _b, t).y -= Math.sin(t * Math.PI) * 0.4;
    }
    this.line.refresh();
    if (Math.random() < dt * 1.5) world.foam.ring(_b.x, _b.z, 0.7, 0.8, 0.4);

    this.progress += dt * HAUL_RATE * rate;
    if (this.progress < 1) return null;
    this.progress = 0;
    school.stock--;
    const haul: Catch = { food: 3 + ((Math.random() * 4) | 0), wood: 0, metal: 0 };
    const r = Math.random();
    if (r < 0.15) haul.wood = 2 + ((Math.random() * 3) | 0);
    else if (r < 0.27) haul.metal = 1 + ((Math.random() * 2) | 0);
    // Splashy haul.
    world.foam.foam(_b.x, _b.z, 1.2, 2, 0.8);
    for (let k = 0; k < 8; k++) {
      fx.smoke.emit({ x: _b.x, y: _b.y + 0.3, z: _b.z, vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 3, vz: (Math.random() - 0.5) * 2, life: 0.8, size: 0.15, color: 0xc9d4da, alpha: 1, alphaEnd: 1, gravity: 9.8, spin: 10, type: PType.Chunk });
    }
    world.sound.play('splash', _b.x, _b.z);
    return haul;
  }

  clear(): void {
    while (this.schools.length) this.remove(0);
    this.progress = 0;
    this.active = false;
    this.line.visible = this.float.visible = false;
  }
}
