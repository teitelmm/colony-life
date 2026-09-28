/**
 * War-torn seascape: rocky islets with ruins and dead trees, a striped
 * lighthouse, half-sunk burning wrecks, floating junk and distant smoke.
 */

import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Scene,
} from 'three';
import { sampleHeight, sampleNormal } from './waves';
import type { Effects } from '../fx/effects';
import { hullSideTexture, rustyMetalTexture } from '../render/textures';

export interface Island {
  x: number;
  z: number;
  /** collision radius at the waterline */
  radius: number;
  height: number;
}

interface Floater {
  obj: Group | Mesh;
  x: number;
  z: number;
  phase: number;
  depth: number;
}

interface Emitter {
  pos: Vector3;
  kind: 'fire' | 'column';
  intensity: number;
}

function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const vnoise = (x: number, y: number, z: number) =>
  Math.sin(x * 1.7 + y * 2.3) * 0.5 + Math.sin(z * 2.1 - x * 1.3) * 0.3 + Math.sin(y * 3.7 + z * 1.9) * 0.2;

function islandGeometry(radius: number, height: number, r: () => number): BufferGeometry {
  const geo = new IcosahedronGeometry(1, 4);
  const pos = geo.attributes.position;
  const colors: number[] = [];
  const sand = new Color(0xc9b27c);
  const grass = new Color(0x6f7a3c);
  const burnt = new Color(0x3b3428);
  const rock = new Color(0x77736b);
  const off = r() * 100;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const n = vnoise(x * 2 + off, y * 2, z * 2 + off);
    const rad = radius * (1 + n * 0.25);
    x *= rad;
    z *= rad;
    y = y > 0 ? y * height * (1 + n * 0.4) : y * 4;
    pos.setXYZ(i, x, y - 0.6, z);
    const h = y / height;
    const c = h < 0.12 ? sand : h > 0.7 ? rock : n > 0.2 ? burnt : grass;
    const tint = 0.85 + r() * 0.2;
    colors.push(c.r * tint, c.g * tint, c.b * tint);
  }
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

export class Scenery {
  readonly islands: Island[] = [];
  readonly group = new Group();
  private readonly floaters: Floater[] = [];
  private readonly emitters: Emitter[] = [];
  private readonly _n = { x: 0, y: 0, z: 0 };
  private readonly _q = new Quaternion();
  private readonly _up = new Vector3(0, 1, 0);

  constructor(scene: Scene, seed = 7) {
    const r = rng(seed);
    const landMat = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });

    // Islands scattered around the arena, leaving the spawn clear.
    const spots: [number, number, number][] = [];
    for (let i = 0; i < 16; i++) {
      for (let tries = 0; tries < 30; tries++) {
        const a = r() * Math.PI * 2;
        const d = 45 + r() * 230;
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        const radius = 5 + r() * 12;
        if (spots.every(([sx, sz, sr]) => Math.hypot(sx - x, sz - z) > sr + radius + 25)) {
          spots.push([x, z, radius]);
          break;
        }
      }
    }
    for (const [x, z, radius] of spots) {
      const height = 2 + r() * radius * 0.5;
      const mesh = new Mesh(islandGeometry(radius, height, r), landMat);
      mesh.position.set(x, 0, z);
      mesh.rotation.y = r() * 6.28;
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
      this.islands.push({ x, z, radius: radius * 0.95, height });
      this.decorate(x, z, radius, height, r);
    }

    // Burning, half-sunk wrecks.
    for (let i = 0; i < 5; i++) {
      const a = r() * Math.PI * 2;
      const d = 35 + r() * 180;
      this.addWreck(Math.cos(a) * d, Math.sin(a) * d, r);
    }

    // Floating junk: barrels, planks, crates.
    const barrelMats = [0xb33a2a, 0x2f6d8c, 0xd1a02f, 0x3d3d3d].map((c) => new MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.3, map: rustyMetalTexture(c) }));
    const plankMat = new MeshStandardMaterial({ color: 0x6b4c2e, roughness: 1 });
    for (let i = 0; i < 70; i++) {
      const a = r() * Math.PI * 2;
      const d = 15 + r() * 220;
      let obj: Mesh;
      if (r() < 0.4) {
        obj = new Mesh(new CylinderGeometry(0.3, 0.3, 0.9, 10), barrelMats[(r() * barrelMats.length) | 0]);
        obj.rotation.z = r() < 0.5 ? Math.PI / 2 : 0;
      } else {
        obj = new Mesh(new BoxGeometry(0.25 + r() * 0.3, 0.08, 1.2 + r() * 1.6), plankMat);
      }
      obj.castShadow = true;
      const g = new Group();
      g.add(obj);
      this.group.add(g);
      this.floaters.push({ obj: g, x: Math.cos(a) * d, z: Math.sin(a) * d, phase: r() * 10, depth: 0.1 });
    }

    // Distant smoke columns from burning coastlines.
    for (let i = 0; i < 6; i++) {
      const a = r() * Math.PI * 2;
      this.emitters.push({ pos: new Vector3(Math.cos(a) * 320, 0, Math.sin(a) * 320), kind: 'column', intensity: 1 });
    }
    scene.add(this.group);
  }

  private decorate(x: number, z: number, radius: number, height: number, r: () => number): void {
    const trunkMat = new MeshStandardMaterial({ color: 0x2a211b, roughness: 1 });
    // Dead, burnt trees.
    const trees = 2 + ((r() * radius) / 3) | 0;
    for (let i = 0; i < trees; i++) {
      const a = r() * 6.28;
      const d = r() * radius * 0.55;
      const h = 2 + r() * 3;
      const t = new Mesh(new CylinderGeometry(0.06, 0.16, h, 5), trunkMat);
      t.position.set(x + Math.cos(a) * d, height * 0.5 + h / 2 - 0.5, z + Math.sin(a) * d);
      t.rotation.set((r() - 0.5) * 0.5, 0, (r() - 0.5) * 0.5);
      t.castShadow = true;
      this.group.add(t);
      for (let b = 0; b < 2; b++) {
        const br = new Mesh(new CylinderGeometry(0.03, 0.06, h * 0.4, 4), trunkMat);
        br.position.set(0, h * (0.1 + r() * 0.3), 0);
        br.rotation.z = (r() < 0.5 ? -1 : 1) * (0.6 + r() * 0.5);
        t.add(br);
      }
    }
    // Ruined bunker or a striped lighthouse.
    if (r() < 0.35) {
      const lh = new Group();
      const stripeA = new MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.8 });
      const stripeB = new MeshStandardMaterial({ color: 0xc23b2e, roughness: 0.8 });
      for (let i = 0; i < 5; i++) {
        const seg = new Mesh(new CylinderGeometry(1.1 - i * 0.1, 1.2 - i * 0.1, 1.6, 10), i % 2 ? stripeB : stripeA);
        seg.position.y = i * 1.6 + 0.8;
        seg.castShadow = true;
        lh.add(seg);
      }
      const cap = new Mesh(new ConeGeometry(0.9, 1.1, 10), new MeshStandardMaterial({ color: 0x2a2a2a }));
      cap.position.y = 8.6;
      lh.add(cap);
      lh.position.set(x, height * 0.55 - 0.5, z);
      lh.rotation.z = 0.12; // shell-shocked lean
      this.group.add(lh);
      this.emitters.push({ pos: new Vector3(x, height * 0.55 + 8, z), kind: 'fire', intensity: 0.5 });
    } else if (r() < 0.6) {
      const concrete = new MeshStandardMaterial({ color: 0x8b8781, roughness: 1, flatShading: true });
      for (let i = 0; i < 3; i++) {
        const b = new Mesh(new BoxGeometry(1.5 + r() * 2, 1 + r() * 1.2, 1.5 + r() * 2), concrete);
        b.position.set(x + (r() - 0.5) * radius * 0.6, height * 0.5, z + (r() - 0.5) * radius * 0.6);
        b.rotation.set((r() - 0.5) * 0.3, r() * 3, (r() - 0.5) * 0.3);
        b.castShadow = b.receiveShadow = true;
        this.group.add(b);
      }
    }
  }

  private addWreck(x: number, z: number, r: () => number): void {
    const g = new Group();
    const paint = [0x2f5f73, 0x8c3b2d, 0x55664d][(r() * 3) | 0];
    const hullMat = new MeshStandardMaterial({ map: hullSideTexture(paint, 0x2b2b2b, true), roughness: 0.8, metalness: 0.3, color: 0x777777 });
    const len = 10 + r() * 8;
    const hull = new Mesh(new BoxGeometry(3.5, 2.5, len), hullMat);
    hull.castShadow = hull.receiveShadow = true;
    g.add(hull);
    const house = new Mesh(new BoxGeometry(2.4, 1.8, 3), new MeshStandardMaterial({ color: 0x3b3834, roughness: 1 }));
    house.position.set(0, 2, -len * 0.15);
    g.add(house);
    const mast = new Mesh(new CylinderGeometry(0.1, 0.12, 5, 6), new MeshStandardMaterial({ color: 0x222222 }));
    mast.position.set(0, 3.5, len * 0.2);
    mast.rotation.x = 0.4;
    g.add(mast);
    g.position.set(x, -0.9, z);
    g.rotation.set(0.25 + r() * 0.2, r() * 6.28, (r() - 0.5) * 0.5);
    this.group.add(g);
    this.islands.push({ x, z, radius: len * 0.35, height: 2 });
    this.emitters.push({ pos: new Vector3(x, 1.5, z), kind: 'fire', intensity: 0.7 + r() * 0.3 });
  }

  update(dt: number, time: number, fx: Effects, focusX: number, focusZ: number): void {
    for (const f of this.floaters) {
      if (Math.abs(f.x - focusX) > 110 || Math.abs(f.z - focusZ) > 110) continue;
      const y = sampleHeight(f.x, f.z, time);
      sampleNormal(f.x, f.z, time, this._n);
      f.obj.position.set(f.x, y - f.depth, f.z);
      this._q.setFromUnitVectors(this._up, this._n as Vector3);
      f.obj.quaternion.copy(this._q);
      f.obj.rotateY(f.phase + time * 0.05);
    }
    for (const e of this.emitters) {
      const d = Math.hypot(e.pos.x - focusX, e.pos.z - focusZ);
      if (e.kind === 'fire') {
        if (d < 120) fx.fire(e.pos, e.intensity, dt);
      } else if (Math.random() < dt * 3) {
        fx.smoke.emit({
          x: e.pos.x + (Math.random() - 0.5) * 6,
          y: 2,
          z: e.pos.z + (Math.random() - 0.5) * 6,
          vx: 1.5,
          vy: 3 + Math.random() * 2,
          vz: 0.8,
          life: 22,
          size: 8,
          sizeEnd: 30,
          color: 0x1b1a19,
          colorEnd: 0x5d5a57,
          alpha: 0.5,
          alphaEnd: 0,
          type: 1,
          fadeIn: 0.1,
          spin: 0.05,
        });
      }
    }
  }

  /** Earliest param t in [0,1] where a segment enters an island, or -1. */
  segmentHit(a: Vector3, b: Vector3): number {
    for (const isl of this.islands) {
      const dx = b.x - isl.x;
      const dz = b.z - isl.z;
      if (dx * dx + dz * dz > (isl.radius + 30) ** 2) continue;
      // March a few samples — islands are big, projectiles are fast but short-stepped.
      for (let i = 1; i <= 4; i++) {
        const t = i / 4;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        const z = a.z + (b.z - a.z) * t;
        const d = Math.hypot(x - isl.x, z - isl.z);
        if (d < isl.radius && y < isl.height * (1 - (d / isl.radius) ** 2) + 0.3) return t;
      }
    }
    return -1;
  }

  /** Push a circle out of any island. Returns the collision normal & depth or null. */
  resolve(x: number, z: number, radius: number): { nx: number; nz: number; depth: number } | null {
    for (const isl of this.islands) {
      const dx = x - isl.x;
      const dz = z - isl.z;
      const d = Math.hypot(dx, dz);
      const min = isl.radius + radius;
      if (d < min && d > 1e-4) return { nx: dx / d, nz: dz / d, depth: min - d };
    }
    return null;
  }

  /** A clear spot of open water for spawning. */
  isClear(x: number, z: number, margin: number): boolean {
    return this.islands.every((i) => Math.hypot(x - i.x, z - i.z) > i.radius + margin);
  }
}
