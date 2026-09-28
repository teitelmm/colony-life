/**
 * Floating salvage crates dropped by wrecks. Sail through them to collect
 * wood and metal (spent on repairs now, building in phase 2).
 */

import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Quaternion, Vector3, type Scene } from 'three';
import { sampleNormal } from '../world/waves';
import { rustyMetalTexture, deckTexture } from '../render/textures';
import type { World } from './World';

export type Resource = 'wood' | 'metal';

interface Crate {
  obj: Group;
  kind: Resource;
  amount: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  age: number;
  spin: number;
}

const woodMat = new MeshStandardMaterial({ color: 0xd8a868, roughness: 0.9 });
const metalMat = new MeshStandardMaterial({ color: 0x9aa3a8, roughness: 0.5, metalness: 0.6 });
const stripeMat = new MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.6, emissive: 0x3a2a00 });
const _n = { x: 0, y: 0, z: 0 };
const _q = new Quaternion();
const _up = new Vector3(0, 1, 0);

export class Loot {
  private readonly crates: Crate[] = [];
  onCollect?: (kind: Resource, amount: number, at: Vector3) => void;

  constructor(private readonly scene: Scene) {
    woodMat.map = deckTexture(false);
    metalMat.map = rustyMetalTexture(0x9aa3a8);
  }

  drop(x: number, z: number, kind: Resource, amount: number): void {
    const g = new Group();
    const size = kind === 'metal' ? 0.7 : 0.8;
    const box = new Mesh(new BoxGeometry(size, size * 0.8, size), kind === 'metal' ? metalMat : woodMat);
    box.castShadow = true;
    g.add(box);
    const band = new Mesh(new BoxGeometry(size + 0.04, 0.12, size + 0.04), stripeMat);
    g.add(band);
    this.scene.add(g);
    const a = Math.random() * Math.PI * 2;
    const s = 1 + Math.random() * 2;
    this.crates.push({ obj: g, kind, amount, x, z, vx: Math.cos(a) * s, vz: Math.sin(a) * s, age: 0, spin: (Math.random() - 0.5) * 0.6 });
  }

  update(dt: number, world: World): void {
    const player = world.player;
    const pp = new Vector3();
    if (player) player.centerWorld(pp);
    for (let i = this.crates.length - 1; i >= 0; i--) {
      const c = this.crates[i];
      c.age += dt;
      c.vx *= 1 - dt * 0.6;
      c.vz *= 1 - dt * 0.6;
      if (player && player.alive) {
        const dx = pp.x - c.x;
        const dz = pp.z - c.z;
        const d = Math.hypot(dx, dz);
        // Crew with boathooks pull nearby crates in.
        if (d < 7) {
          c.vx += (dx / d) * dt * 12;
          c.vz += (dz / d) * dt * 12;
        }
        if (d < player.stats.radius + 0.8) {
          const at = c.obj.position.clone();
          this.onCollect?.(c.kind, c.amount, at);
          world.sound.play('pickup', c.x, c.z);
          world.foam.ring(c.x, c.z, 1.5, 0.8, 0.6);
          this.scene.remove(c.obj);
          this.crates.splice(i, 1);
          continue;
        }
      }
      c.x += c.vx * dt + 0.25 * dt;
      c.z += c.vz * dt + 0.1 * dt;
      const y = world.water.height(c.x, c.z);
      sampleNormal(c.x, c.z, world.time, _n);
      c.obj.position.set(c.x, y + 0.1, c.z);
      _q.setFromUnitVectors(_up, _n as Vector3);
      c.obj.quaternion.copy(_q);
      c.obj.rotateY(c.age * c.spin);
      // Blink before despawning.
      c.obj.visible = c.age < 80 || Math.sin(c.age * 12) > 0;
      if (c.age > 90) {
        this.scene.remove(c.obj);
        this.crates.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const c of this.crates) this.scene.remove(c.obj);
    this.crates.length = 0;
  }
}
