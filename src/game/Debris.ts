/**
 * Pieces knocked off boats: they fly, splash down, bob for a while (wood
 * floats longer than steel) and then slip under.
 */

import { Group, Quaternion, Vector3, type Mesh, type Object3D, type Scene } from 'three';
import type { PartInstance } from '../boat/BoatStats';
import type { Boat } from '../boat/Boat';
import type { World } from './World';

interface Piece {
  obj: Object3D;
  vel: Vector3;
  angVel: Vector3;
  floats: boolean;
  age: number;
  sinkAt: number;
  splashed: boolean;
}

const _q = new Quaternion();
const _axis = new Vector3();

export class Debris {
  private readonly pieces: Piece[] = [];

  constructor(private readonly scene: Scene) {}

  spawnFromPart(group: Group, part: PartInstance, boat: Boat, push: Vector3): void {
    // Re-parent into the world keeping the current transform.
    group.updateMatrixWorld(true);
    const pos = new Vector3();
    const quat = new Quaternion();
    const scale = new Vector3();
    group.matrixWorld.decompose(pos, quat, scale);
    group.removeFromParent();
    group.position.copy(pos);
    group.quaternion.copy(quat);
    this.scene.add(group);
    const vel = boat.body.vel.clone().add(push.clone().multiplyScalar(3 + Math.random() * 3));
    vel.y += 3 + Math.random() * 4;
    this.pieces.push({
      obj: group,
      vel,
      angVel: new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(6),
      floats: part.def.material === 'wood',
      age: 0,
      sinkAt: part.def.material === 'wood' ? 14 + Math.random() * 10 : 1.5 + Math.random() * 2,
      splashed: false,
    });
    if (this.pieces.length > 60) this.remove(0);
  }

  private remove(i: number): void {
    this.scene.remove(this.pieces[i].obj);
    this.pieces[i].obj.traverse((o) => (o as Mesh).geometry?.dispose());
    this.pieces.splice(i, 1);
  }

  update(dt: number, world: World): void {
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i];
      p.age += dt;
      const o = p.obj;
      const waterY = world.water.height(o.position.x, o.position.z);
      const depth = waterY - o.position.y;
      if (depth > 0) {
        if (!p.splashed) {
          p.splashed = true;
          world.effects.bulletWater(o.position.x, o.position.z, true);
        }
        const sinking = !p.floats || p.age > p.sinkAt;
        const lift = sinking ? 7.5 : 9.81 + Math.min(1, depth * 3) * 14;
        p.vel.y += lift * dt;
        p.vel.multiplyScalar(Math.max(0, 1 - dt * 2.5));
        p.angVel.multiplyScalar(Math.max(0, 1 - dt * 3));
        if (sinking && Math.random() < dt * 3) world.effects.bubbles(o.position.x, o.position.z, dt * 3);
      }
      p.vel.y -= 9.81 * dt;
      o.position.addScaledVector(p.vel, dt);
      const w = p.angVel.length();
      if (w > 1e-4) {
        _axis.copy(p.angVel).divideScalar(w);
        _q.setFromAxisAngle(_axis, w * dt);
        o.quaternion.premultiply(_q);
      }
      if (o.position.y < waterY - 6 || p.age > 60) this.remove(i);
    }
  }

  clear(): void {
    while (this.pieces.length) this.remove(0);
  }
}
