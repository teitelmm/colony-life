/**
 * Pooled projectiles: bullets (tracers), shells and harpoons. Swept-segment
 * collision against boat parts, islands and the wave surface.
 */

import {
  Color,
  InstancedMesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  BoxGeometry,
  SphereGeometry,
  Vector3,
  type Scene,
} from 'three';
import type { WeaponDef } from './weaponDefs';
import type { Boat } from '../boat/Boat';
import type { Turret } from './Turret';
import type { World } from '../game/World';
import { hitParts } from '../boat/hitTest';
import { GRAVITY } from '../world/waves';
import { PType } from '../fx/Particles';
import type { PartInstance } from '../boat/BoatStats';

export interface Projectile {
  def: WeaponDef;
  owner: Boat;
  turret: Turret | null;
  pos: Vector3;
  prev: Vector3;
  vel: Vector3;
  age: number;
  maxAge: number;
  tracer: boolean;
  bounced: boolean;
  alive: boolean;
}

const MAX_BULLETS = 900;
const MAX_SHELLS = 60;
const _a = new Vector3();
const _b = new Vector3();
const _hit = new Vector3();
const _tmp = new Vector3();
const dummy = new Object3D();

export class ProjectileSystem {
  readonly list: Projectile[] = [];
  private readonly tracers: InstancedMesh;
  private readonly shells: InstancedMesh;

  constructor(scene: Scene) {
    const tracerMat = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.tracers = new InstancedMesh(new BoxGeometry(1, 1, 1), tracerMat, MAX_BULLETS);
    this.tracers.frustumCulled = false;
    this.tracers.count = 0;
    scene.add(this.tracers);
    this.shells = new InstancedMesh(new SphereGeometry(0.14, 8, 6), new MeshStandardMaterial({ color: 0x222222, emissive: new Color(0.6, 0.25, 0.05), roughness: 0.5 }), MAX_SHELLS);
    this.shells.frustumCulled = false;
    this.shells.count = 0;
    scene.add(this.shells);
  }

  spawn(def: WeaponDef, owner: Boat, turret: Turret | null, pos: Vector3, vel: Vector3, tracer: boolean): Projectile {
    const p: Projectile = {
      def,
      owner,
      turret,
      pos: pos.clone(),
      prev: pos.clone(),
      vel: vel.clone(),
      age: 0,
      maxAge: Math.max(1.2, ((def.range * 1.8) / def.muzzleVelocity) * (def.kind === 'shell' ? 2 : 1)),
      tracer,
      bounced: false,
      alive: true,
    };
    this.list.push(p);
    if (def.kind === 'harpoon') this.onHarpoonSpawn?.(p);
    return p;
  }

  /** set by the harpoon system so it can draw a rope to flying spears */
  onHarpoonSpawn?: (p: Projectile) => void;

  step(dt: number, world: World): void {
    for (const p of this.list) {
      if (!p.alive) continue;
      p.age += dt;
      p.prev.copy(p.pos);
      p.vel.y -= GRAVITY * p.def.gravityScale * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.def.kind === 'shell' && Math.random() < 0.7) {
        world.effects.smoke.emit({ x: p.pos.x, y: p.pos.y, z: p.pos.z, life: 0.7, size: 0.2, sizeEnd: 0.7, color: 0x9a9690, alpha: 0.35, type: PType.Smoke });
      }
      this.collide(p, world);
      if (p.age > p.maxAge) p.alive = false;
    }
    let w = 0;
    for (const p of this.list) if (p.alive) this.list[w++] = p;
    this.list.length = w;
  }

  private collide(p: Projectile, world: World): void {
    let bestT = Infinity;
    let bestBoat: Boat | null = null;
    let bestPart: PartInstance | null = null;
    const segLen = p.prev.distanceTo(p.pos);

    for (const boat of world.boats) {
      if (boat === p.owner || boat.state === 'gone') continue;
      boat.centerWorld(_tmp);
      const r = boat.stats.radius + 1.5 + segLen;
      if (_tmp.distanceToSquared(p.pos) > r * r) continue;
      boat.body.worldToLocal(p.prev, _a);
      boat.body.worldToLocal(p.pos, _b);
      const hit = hitParts(boat.parts, { ax: _a.x, ay: _a.y, az: _a.z, bx: _b.x, by: _b.y, bz: _b.z });
      if (hit && hit.t < bestT) {
        bestT = hit.t;
        bestBoat = boat;
        bestPart = hit.part;
      }
    }

    const islandT = world.scenery.segmentHit(p.prev, p.pos);
    if (islandT >= 0 && islandT < bestT) {
      _hit.lerpVectors(p.prev, p.pos, islandT);
      this.impactGround(p, world, _hit);
      return;
    }

    if (bestBoat && bestPart) {
      _hit.lerpVectors(p.prev, p.pos, bestT);
      this.impactBoat(p, world, bestBoat, bestPart, _hit);
      return;
    }

    const waterY = world.water.height(p.pos.x, p.pos.z);
    if (p.pos.y < waterY) {
      // Shallow bullets skip off the surface.
      const horiz = Math.hypot(p.vel.x, p.vel.z);
      const angle = Math.atan2(-p.vel.y, horiz);
      if (p.def.kind === 'bullet' && !p.bounced && angle < 0.12 && Math.random() < 0.6) {
        p.bounced = true;
        p.pos.y = waterY + 0.01;
        p.vel.y = Math.abs(p.vel.y) * 0.4;
        p.vel.multiplyScalar(0.55);
        world.effects.bulletWater(p.pos.x, p.pos.z);
        return;
      }
      this.impactWater(p, world);
    }
  }

  private impactBoat(p: Projectile, world: World, boat: Boat, part: PartInstance, at: Vector3): void {
    p.alive = false;
    const def = p.def;
    const wasAlive = boat.alive;
    const destroyed = boat.damage(part, def.damage * p.owner.damageScale, def.penetration, world, p.owner, at);
    if (def.kind === 'shell') {
      world.effects.explosion(at, 0.75);
      for (const b of world.boats) if (b.state !== 'gone') b.splash(at, def.splashRadius, def.splashDamage * p.owner.damageScale, def.penetration * 0.5, world, p.owner);
    } else {
      world.effects.hit(at, part.def.material, def.kind === 'harpoon' ? 2 : 1);
    }
    if (def.kind === 'harpoon') world.harpoons.attach(p, boat, at);
    if (p.owner.isPlayer && boat.team !== 'player') world.events.hitMarker(destroyed || (wasAlive && !boat.alive));
  }

  private impactWater(p: Projectile, world: World): void {
    p.alive = false;
    const def = p.def;
    if (def.kind === 'shell') {
      world.effects.shellWater(p.pos.x, p.pos.z);
      _hit.copy(p.pos);
      // Near misses still rattle hulls.
      for (const b of world.boats) if (b.state !== 'gone') b.splash(_hit, def.splashRadius * 0.8, def.splashDamage * 0.4 * p.owner.damageScale, 0.1, world, p.owner);
    } else {
      world.effects.bulletWater(p.pos.x, p.pos.z, def.kind === 'harpoon');
    }
    if (def.kind === 'harpoon') world.harpoons.miss(p);
  }

  private impactGround(p: Projectile, world: World, at: Vector3): void {
    p.alive = false;
    if (p.def.kind === 'shell') world.effects.explosion(at, 0.6, false);
    else {
      for (let i = 0; i < 6; i++)
        world.effects.smoke.emit({
          x: at.x,
          y: at.y,
          z: at.z,
          vx: (Math.random() - 0.5) * 3,
          vy: Math.random() * 3,
          vz: (Math.random() - 0.5) * 3,
          life: 0.8,
          size: 0.3,
          sizeEnd: 1,
          color: 0x7d6b55,
          alpha: 0.6,
          type: PType.Smoke,
        });
      world.sound.play('hitWood', at.x, at.z, 0.4);
    }
    if (p.def.kind === 'harpoon') world.harpoons.miss(p);
  }

  render(): void {
    let nt = 0;
    let ns = 0;
    const color = new Color();
    for (const p of this.list) {
      if (p.def.kind === 'bullet') {
        if (nt >= MAX_BULLETS) continue;
        const speed = p.vel.length();
        const len = Math.min(3.2, speed * 0.02);
        dummy.position.copy(p.pos).addScaledVector(p.vel, -0.5 * len / Math.max(speed, 1));
        _tmp.copy(dummy.position).add(p.vel);
        dummy.lookAt(_tmp);
        const w = p.tracer ? 0.07 : 0.025;
        dummy.scale.set(w, w, p.tracer ? len : len * 0.5);
        dummy.updateMatrix();
        this.tracers.setMatrixAt(nt, dummy.matrix);
        if (p.tracer) color.setRGB(p.owner.isPlayer ? 7 : 8, p.owner.isPlayer ? 4.2 : 1.8, p.owner.isPlayer ? 1.2 : 0.6);
        else color.setRGB(0.5, 0.45, 0.35);
        this.tracers.setColorAt(nt, color);
        nt++;
      } else if (p.def.kind === 'shell') {
        if (ns >= MAX_SHELLS) continue;
        dummy.position.copy(p.pos);
        dummy.scale.setScalar(1);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        this.shells.setMatrixAt(ns++, dummy.matrix);
      }
    }
    this.tracers.count = nt;
    this.shells.count = ns;
    this.tracers.instanceMatrix.needsUpdate = true;
    if (this.tracers.instanceColor) this.tracers.instanceColor.needsUpdate = true;
    this.shells.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    this.list.length = 0;
  }
}
