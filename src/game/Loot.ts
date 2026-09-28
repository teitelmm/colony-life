/**
 * Floating salvage crates dropped by wrecks. Sail through them to collect
 * wood and metal (spent on repairs now, building in phase 2).
 */

import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Quaternion, SphereGeometry, TorusGeometry, Vector3, type Scene } from 'three';
import { sampleNormal } from '../world/waves';
import { rustyMetalTexture, deckTexture } from '../render/textures';
import type { World } from './World';

export type Resource = 'wood' | 'metal';
export type LootKind = Resource | 'survivor';

interface Crate {
  obj: Group;
  kind: LootKind;
  /** seconds before a refused survivor will ask again */
  snub: number;
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
const vestMat = new MeshStandardMaterial({ color: 0xff6a1f, roughness: 0.7 });
const skinMat = new MeshStandardMaterial({ color: 0xd9a37a, roughness: 0.8 });
const ringMat = new MeshStandardMaterial({ color: 0xf2f0e8, roughness: 0.6 });
const _n = { x: 0, y: 0, z: 0 };
const _q = new Quaternion();
const _up = new Vector3(0, 1, 0);

export class Loot {
  private readonly crates: Crate[] = [];
  /** return false to leave it in the water (e.g. no free bunk for a survivor) */
  onCollect?: (kind: LootKind, amount: number, at: Vector3) => boolean | void;

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
    this.crates.push({ obj: g, kind, amount, x, z, vx: Math.cos(a) * s, vz: Math.sin(a) * s, age: 0, spin: (Math.random() - 0.5) * 0.6, snub: 0 });
  }

  /** A sailor from a sunk boat, bobbing in a life vest and waving. */
  survivor(x: number, z: number): void {
    const g = new Group();
    const vest = new Mesh(new CylinderGeometry(0.2, 0.22, 0.35, 8), vestMat);
    vest.position.y = 0.05;
    const head = new Mesh(new SphereGeometry(0.12, 8, 6), skinMat);
    head.position.y = 0.35;
    const arm = new Mesh(new BoxGeometry(0.07, 0.45, 0.07), vestMat);
    arm.position.set(0.22, 0.4, 0);
    arm.name = 'arm';
    const ring = new Mesh(new TorusGeometry(0.34, 0.08, 6, 14), ringMat);
    ring.rotation.x = Math.PI / 2;
    for (const m of [vest, head, arm, ring]) m.castShadow = true;
    g.add(vest, head, arm, ring);
    this.scene.add(g);
    const a = Math.random() * Math.PI * 2;
    this.crates.push({ obj: g, kind: 'survivor', amount: 1, x, z, vx: Math.cos(a) * 2, vz: Math.sin(a) * 2, age: 0, spin: 0, snub: 0 });
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
        c.snub -= dt;
        if (d < player.stats.radius + 0.8 && c.snub <= 0) {
          const at = c.obj.position.clone();
          if (this.onCollect?.(c.kind, c.amount, at) === false) {
            c.snub = 4;
            continue;
          }
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
      if (c.kind === 'survivor') {
        const arm = c.obj.getObjectByName('arm');
        if (arm) arm.rotation.z = Math.sin(c.age * 7) * 0.6;
        c.obj.position.y -= 0.15;
      }
      // Blink before despawning.
      c.obj.visible = c.age < 80 || Math.sin(c.age * 12) > 0;
      if (c.age > (c.kind === 'survivor' ? 120 : 90)) {
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
