/**
 * Harpoon lines: a rope from the launcher to the flying spear, then a
 * spring tether that drags the struck boat in (and the shooter toward it).
 */

import { ConeGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Vector3, type Scene } from 'three';
import { Rope } from '../fx/Rope';
import type { Projectile } from './Projectiles';
import type { Boat } from '../boat/Boat';
import type { Turret } from './Turret';
import type { World } from '../game/World';

type LinkState = 'flying' | 'attached' | 'retract';

interface Link {
  turret: Turret;
  owner: Boat;
  state: LinkState;
  projectile: Projectile | null;
  target: Boat | null;
  local: Vector3;
  end: Vector3;
  length: number;
  age: number;
  rope: Rope;
  spear: Group;
}

const ropeMat = new MeshStandardMaterial({ color: 0xc9b083, roughness: 1 });
const steelMat = new MeshStandardMaterial({ color: 0xb8bec2, roughness: 0.3, metalness: 0.9 });
const _a = new Vector3();
const _b = new Vector3();
const _d = new Vector3();
const _va = new Vector3();
const _vb = new Vector3();

function makeSpear(): Group {
  const g = new Group();
  const shaft = new Mesh(new CylinderGeometry(0.025, 0.025, 1.0, 5), steelMat);
  shaft.rotation.x = Math.PI / 2;
  const tip = new Mesh(new ConeGeometry(0.07, 0.25, 6), steelMat);
  tip.rotation.x = Math.PI / 2;
  tip.position.z = 0.6;
  g.add(shaft, tip);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

export class HarpoonSystem {
  private readonly links: Link[] = [];

  constructor(private readonly scene: Scene) {}

  spawn(p: Projectile): void {
    if (!p.turret) return;
    const rope = new Rope(ropeMat, 15, 0.03, 4);
    rope.castShadow = true;
    const spear = makeSpear();
    this.scene.add(rope, spear);
    this.links.push({
      turret: p.turret,
      owner: p.owner,
      state: 'flying',
      projectile: p,
      target: null,
      local: new Vector3(),
      end: p.pos.clone(),
      length: 0,
      age: 0,
      rope,
      spear,
    });
  }

  attach(p: Projectile, target: Boat, at: Vector3): void {
    const link = this.links.find((l) => l.projectile === p);
    if (!link) return;
    link.state = 'attached';
    link.projectile = null;
    link.target = target;
    target.body.worldToLocal(at, link.local);
    link.turret.rig.muzzle.getWorldPosition(_a);
    link.length = Math.max(6, _a.distanceTo(at) * 0.9);
    link.age = 0;
  }

  miss(p: Projectile): void {
    const link = this.links.find((l) => l.projectile === p);
    if (!link) return;
    link.state = 'retract';
    link.projectile = null;
    link.age = 0;
  }

  /** Release every line fired by this boat (player can cut the rope). */
  release(owner: Boat): void {
    for (const l of this.links) if (l.owner === owner && l.state === 'attached') l.state = 'retract';
  }

  hasLine(owner: Boat): boolean {
    return this.links.some((l) => l.owner === owner && l.state === 'attached');
  }

  step(dt: number, world: World): void {
    for (const l of this.links) {
      l.age += dt;
      const turretAlive = l.turret.part.alive && l.owner.state !== 'gone';
      if (!turretAlive && l.state !== 'retract') l.state = 'retract';
      l.turret.rig.muzzle.getWorldPosition(_a);

      if (l.state === 'flying' && l.projectile) {
        l.end.copy(l.projectile.pos);
        if (!l.projectile.alive) l.state = 'retract';
      } else if (l.state === 'attached' && l.target) {
        if (l.target.state === 'gone' || l.age > 14) {
          l.state = 'retract';
          continue;
        }
        l.target.body.localToWorld(l.local, _b);
        l.end.copy(_b);
        // Winch in.
        l.length = Math.max(5, l.length - dt * 1.6);
        _d.subVectors(_b, _a);
        const dist = _d.length();
        if (dist > 30) {
          l.state = 'retract';
          world.sound.play('ropeHit', _a.x, _a.z);
          continue;
        }
        if (dist > l.length) {
          _d.divideScalar(dist);
          const mMin = Math.min(l.owner.body.mass, l.target.body.mass);
          l.owner.body.pointVelocity(_a, _va);
          l.target.body.pointVelocity(_b, _vb);
          const relSpeed = _vb.sub(_va).dot(_d);
          // Spring-damper tether, capped so it tows rather than yanks.
          const f = Math.min(mMin * 6, Math.max(0, 3.2 * mMin * (dist - l.length) + 1.6 * mMin * relSpeed));
          _d.y = 0;
          _d.normalize();
          // Pull horizontally at each hull's centre-of-mass height so the rope can't roll boats over.
          l.owner.body.comWorld(_va);
          l.target.body.comWorld(_vb);
          _a.y = _va.y;
          _b.y = _vb.y;
          l.target.body.addForceAtPoint(_d.clone().multiplyScalar(-f), _b);
          l.owner.body.addForceAtPoint(_d.clone().multiplyScalar(f), _a);
        }
      } else if (l.state === 'retract') {
        // Reel the spear back to the launcher.
        l.end.lerp(_a, Math.min(1, dt * 3));
      }
    }
    // Drop finished lines.
    for (let i = this.links.length - 1; i >= 0; i--) {
      const l = this.links[i];
      l.turret.rig.muzzle.getWorldPosition(_a);
      if (l.state === 'retract' && (l.end.distanceTo(_a) < 0.6 || l.age > 4)) {
        l.turret.harpoonOut = false;
        this.scene.remove(l.rope, l.spear);
        l.rope.geometry.dispose();
        this.links.splice(i, 1);
      }
    }
  }

  render(world: World): void {
    for (const l of this.links) {
      l.turret.rig.muzzle.getWorldPosition(_a);
      _b.copy(l.end);
      const dist = _a.distanceTo(_b);
      const slack = l.state === 'attached' ? Math.max(0, l.length - dist) : dist * 0.08;
      const pts = l.rope.points;
      const N = pts.length - 1;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const p = pts[i].lerpVectors(_a, _b, t);
        p.y -= Math.sin(t * Math.PI) * (0.15 + slack * 0.5);
        // Rope lying on the water floats on it.
        p.y = Math.max(p.y, world.water.height(p.x, p.z) + 0.03);
      }
      l.rope.refresh();

      // Spear sits at the end pointing along the rope.
      l.spear.position.copy(_b);
      _d.subVectors(_b, _a);
      if (l.state === 'flying' && l.projectile) _d.copy(l.projectile.vel);
      if (_d.lengthSq() > 1e-4) l.spear.lookAt(_d.add(_b));
    }
  }

  clear(): void {
    for (const l of this.links) {
      this.scene.remove(l.rope, l.spear);
      l.turret.harpoonOut = false;
    }
    this.links.length = 0;
  }
}
