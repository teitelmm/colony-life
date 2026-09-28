/**
 * A boat entity: parts + physics body + visuals + turrets. Handles damage,
 * parts breaking off, fires, and going down.
 */

import { Group, Vector3, type Mesh } from 'three';
import { PARTS, type BoatDesign } from './parts';
import { computeStats, damagePart, findDetached, isWrecked, type BoatStats, type PartInstance } from './BoatStats';
import { BoatBody, applyWaterForces, type HelmControls } from './BoatPhysics';
import { applyDamageTint, buildPartContext, buildPartVisual, type PartVisual } from './BoatMesh';
import { Turret } from '../weapons/Turret';
import { Wake } from '../fx/Wake';
import type { World } from '../game/World';
import type { WeaponDef } from '../weapons/weaponDefs';

export type Team = 'player' | 'enemy';
export type BoatState = 'afloat' | 'sinking' | 'gone';

const _p = new Vector3();
const _q = new Vector3();
const _side = new Vector3();

export class Boat {
  private static nextId = 1;
  readonly id = Boat.nextId++;
  readonly parts: PartInstance[];
  readonly visuals: (PartVisual | null)[] = [];
  readonly turrets: Turret[] = [];
  readonly body = new BoatBody();
  readonly group = new Group();
  stats: BoatStats;
  readonly helm: HelmControls = { throttle: 0, rudder: 0 };
  readonly aim = new Vector3();
  trigger = false;
  /** multiplier on damage this boat's guns deal (enemy difficulty scaling) */
  damageScale = 1;
  state: BoatState = 'afloat';
  sinkTimer = 0;
  lastHitTime = -100;
  /** part index → fire intensity 0..1 */
  readonly fires = new Map<number, number>();
  lastAttacker: Boat | null = null;
  /** called for every part that is destroyed or knocked off */
  onPartDestroyed: ((part: PartInstance) => void) | null = null;
  wake: Wake | null = null;
  private readonly ctx: ReturnType<typeof buildPartContext>;

  constructor(
    readonly design: BoatDesign,
    readonly team: Team,
    world: Pick<World, 'foam'>,
  ) {
    this.parts = design.parts.map((p, index) => ({
      index,
      def: PARTS[p.part],
      x: p.x,
      y: p.y,
      z: p.z,
      hp: Math.min(PARTS[p.part].hp, p.hp ?? PARTS[p.part].hp),
      alive: true,
      weapon: p.weapon,
      facing: p.facing,
    }));
    this.stats = computeStats(this.parts);
    this.body.setMassProperties(this.stats);
    this.ctx = buildPartContext(design, this.parts);
    for (const part of this.parts) {
      const v = this.buildPart(part);
      if (part.hp < part.def.hp) applyDamageTint(v, part.hp / part.def.hp);
      this.visuals.push(v);
    }
    this.wake = new Wake(world.foam);
  }

  get isPlayer(): boolean {
    return this.team === 'player';
  }

  get alive(): boolean {
    return this.state === 'afloat';
  }

  private buildPart(part: PartInstance): PartVisual {
    const v = buildPartVisual(part, this.ctx);
    this.group.add(v.group);
    if (part.def.kind === 'mount' && part.weapon) {
      this.turrets.push(new Turret(this, part, v, part.weapon, this.isPlayer ? 0x3f6fb5 : 0x5a2320));
    }
    return v;
  }

  placeAt(x: number, z: number, heading: number, water: World['water']): void {
    this.body.quat.setFromAxisAngle(new Vector3(0, 1, 0), heading);
    const com = this.body.com.clone().applyQuaternion(this.body.quat);
    this.body.origin.set(x - com.x, water.height(x, z) - 0.1, z - com.z);
    this.body.vel.set(0, 0, 0);
    this.body.angVel.set(0, 0, 0);
    this.syncGroup();
  }

  comWorld(out: Vector3): Vector3 {
    return this.body.comWorld(out);
  }

  /** Centre of the hull footprint in world space. */
  centerWorld(out: Vector3): Vector3 {
    return this.body.localToWorld(out.set(this.stats.centerX, 0, this.stats.centerZ), out);
  }

  forwardSpeed(): number {
    _p.set(0, 0, 1).applyQuaternion(this.body.quat);
    return this.body.vel.dot(_p);
  }

  recomputeStats(): void {
    this.stats = computeStats(this.parts);
    this.body.setMassProperties(this.stats);
  }

  syncGroup(): void {
    this.group.position.copy(this.body.origin);
    this.group.quaternion.copy(this.body.quat);
    this.group.updateMatrixWorld(true);
  }

  /** Fixed-timestep simulation. */
  step(dt: number, world: World): void {
    if (this.state === 'gone') return;
    if (this.state === 'sinking') {
      this.sinkTimer += dt;
      this.body.buoyancyScale = Math.max(0, 1 - this.sinkTimer / 9);
      this.helm.throttle = 0;
      this.helm.rudder = 0;
      this.trigger = false;
      // Settle bow- or stern-first.
      this.body.addTorque(_p.set(0.35 * this.body.mass, 0, 0).applyQuaternion(this.body.quat));
      if (this.body.origin.y < -9) this.state = 'gone';
    }
    applyWaterForces(this.body, this.parts, this.stats, this.helm, world.water);
    this.body.integrate(dt);
    this.syncGroup();

    for (const t of this.turrets) if (t.part.alive) t.update(dt, world, this.aim, this.trigger && this.alive);

    // Fires slowly eat their part.
    for (const [idx, intensity] of this.fires) {
      const part = this.parts[idx];
      if (!part.alive) {
        this.fires.delete(idx);
        continue;
      }
      if (part.hp > part.def.hp * 0.12) part.hp -= dt * 2.2 * intensity;
    }
  }

  /** Per-frame cosmetic effects. */
  animate(dt: number, world: World): void {
    if (this.state === 'gone') return;
    const fx = world.effects;
    for (const t of this.turrets) if (t.part.alive) t.animate(dt);

    const speed = this.forwardSpeed();
    const heading = this.body.heading();
    const afloat = this.state === 'afloat';

    for (let i = 0; i < this.parts.length; i++) {
      const part = this.parts[i];
      const v = this.visuals[i];
      if (!part.alive || !v) continue;
      const frac = part.hp / part.def.hp;
      if (v.exhaust && afloat) {
        v.exhaust.getWorldPosition(_p);
        fx.exhaust(_p, Math.abs(this.helm.throttle), dt, part.def.id === 'engine_diesel');
      }
      if (v.chimney && afloat && Math.random() < dt * 1.5) {
        v.chimney.getWorldPosition(_p);
        fx.exhaust(_p, 0, 1, false);
      }
      if (v.net) v.net.rotation.y = Math.sin(world.time * 0.6 + this.id) * 0.5;
      if (v.flag) {
        const t = world.time * 6 + this.id;
        v.flag.rotation.y = Math.PI / 2 + Math.sin(t) * 0.25 + 0.4;
        v.flag.scale.x = 0.9 + Math.sin(t * 1.7) * 0.1;
      }
      const fire = this.fires.get(i);
      if (fire) {
        v.group.getWorldPosition(_p);
        fx.fire(_p, fire, dt);
      } else if (frac < 0.6) {
        v.group.getWorldPosition(_p);
        fx.smolder(_p, dt);
      }
    }

    // Wake from the stern and spray from the bow.
    const minZ = this.stats.centerZ - this.stats.halfLength;
    const maxZ = this.stats.centerZ + this.stats.halfLength;
    this.body.localToWorld(_p.set(this.stats.centerX, -0.3, minZ), _p);
    this.wake?.update(world.time, _p.x, _p.z, heading, speed, this.stats.halfWidth, afloat && this.body.wetness > 0.05);
    if (afloat && speed > 2.5) {
      this.body.localToWorld(_q.set(this.stats.centerX, -0.2, maxZ), _q);
      _side.set(1, 0, 0).applyQuaternion(this.body.quat);
      _q.y = world.water.height(_q.x, _q.z);
      fx.spray(_q, _side, speed, dt);
    }
    if (this.body.wetness > 0.02) {
      this.centerWorld(_p);
      world.foam.hull(_p.x, _p.z, this.stats.halfWidth, this.stats.halfLength, heading, 0.35 + Math.min(0.6, Math.abs(speed) * 0.08));
    }
    if (this.state === 'sinking') {
      this.centerWorld(_p);
      fx.bubbles(_p.x, _p.z, dt);
    }
  }

  /** Apply damage to one part. Returns true if it was destroyed. */
  damage(part: PartInstance, amount: number, penetration: number, world: World, attacker: Boat | null, hitPoint?: Vector3): boolean {
    if (!part.alive || this.state === 'gone') return false;
    const res = damagePart(part, amount, penetration);
    this.lastHitTime = world.time;
    if (attacker) this.lastAttacker = attacker;
    if (this.isPlayer) world.events.playerHit(res.applied);

    const v = this.visuals[part.index];
    if (v) applyDamageTint(v, part.hp / part.def.hp);

    // Engines, cabins and ammo near mounts catch fire when badly hit.
    const frac = part.hp / part.def.hp;
    if (!res.destroyed && frac < 0.45 && !this.fires.has(part.index)) {
      const flammable = part.def.kind === 'engine' || part.def.kind === 'cabin' || (part.def.material === 'wood' && Math.random() < 0.35);
      if (flammable) this.fires.set(part.index, part.def.kind === 'engine' ? 1 : 0.6);
    }

    if (res.destroyed) this.destroyPart(part, world, hitPoint);
    else this.checkWreck(world);
    return res.destroyed;
  }

  /** Area damage with linear falloff (shell explosions). */
  splash(center: Vector3, radius: number, damage: number, penetration: number, world: World, attacker: Boat | null): void {
    const local = this.body.worldToLocal(center, new Vector3());
    for (const part of this.parts) {
      if (!part.alive) continue;
      const d = Math.hypot(part.x - local.x, part.y - local.y, part.z - local.z);
      if (d < radius) this.damage(part, damage * (1 - d / radius), penetration, world, attacker);
    }
  }

  private destroyPart(part: PartInstance, world: World, hitPoint?: Vector3): void {
    part.alive = false;
    part.hp = 0;
    this.fires.delete(part.index);
    const v = this.visuals[part.index];
    if (v) {
      v.group.getWorldPosition(_p);
      const impulse = hitPoint ? _q.subVectors(_p, hitPoint).normalize() : _q.set(0, 1, 0);
      world.debris.spawnFromPart(v.group, part, this, impulse);
      this.visuals[part.index] = null;
      if (part.def.kind === 'engine') world.effects.explosion(_p, 0.6, false);
      else world.effects.hit(_p, part.def.material, 2.5);
      world.sound.play('break', _p.x, _p.z);
    }
    this.onPartDestroyed?.(part);
    const turretIdx = this.turrets.findIndex((t) => t.part === part);
    if (turretIdx >= 0) this.turrets.splice(turretIdx, 1);

    // Anything no longer attached to the main hull falls off too.
    for (const idx of findDetached(this.parts)) {
      const p = this.parts[idx];
      p.alive = false;
      this.fires.delete(idx);
      const dv = this.visuals[idx];
      if (dv) {
        world.debris.spawnFromPart(dv.group, p, this, _q.set(0, 1, 0));
        this.visuals[idx] = null;
      }
      this.onPartDestroyed?.(p);
      const ti = this.turrets.findIndex((t) => t.part === p);
      if (ti >= 0) this.turrets.splice(ti, 1);
    }
    this.recomputeStats();
    this.checkWreck(world);
  }

  private checkWreck(world: World): void {
    if (this.state !== 'afloat') return;
    this.stats = computeStats(this.parts);
    if (!isWrecked(this.stats)) return;
    this.state = 'sinking';
    this.sinkTimer = 0;
    this.centerWorld(_p);
    _p.y += 0.6;
    world.effects.wreck(_p, Math.min(2, 0.8 + this.stats.radius * 0.25));
    // Everything that's left burns.
    for (const p of this.parts) if (p.alive && Math.random() < 0.6) this.fires.set(p.index, 0.5 + Math.random() * 0.5);
    world.events.boatWrecked(this);
  }

  /** Rebuild a destroyed part (used by between-wave repairs). */
  restorePart(part: PartInstance): void {
    if (part.alive) {
      part.hp = part.def.hp;
      const v = this.visuals[part.index];
      if (v) applyDamageTint(v, 1);
      this.fires.delete(part.index);
      return;
    }
    part.alive = true;
    part.hp = part.def.hp;
    this.visuals[part.index] = this.buildPart(part);
    this.syncGroup();
  }

  /** Re-tint a part after its hp changed outside of combat (repairs). */
  refreshDamage(part: PartInstance): void {
    const v = this.visuals[part.index];
    if (v) applyDamageTint(v, part.hp / part.def.hp);
  }

  /** Set a part burning (incendiary hits). */
  ignite(part: PartInstance, intensity = 0.7): void {
    if (part.alive && !this.fires.has(part.index)) this.fires.set(part.index, intensity);
  }

  /** The boat as it stands now: surviving parts with their current damage. */
  toDesign(): BoatDesign {
    return {
      ...this.design,
      parts: this.parts
        .filter((p) => p.alive)
        .map((p) => ({ part: p.def.id, x: p.x, y: p.y, z: p.z, weapon: p.weapon, facing: p.facing, hp: p.hp })),
    };
  }

  setAllWeapons(def: WeaponDef): void {
    for (const t of this.turrets) {
      t.setWeapon(def.id);
      t.part.weapon = def.id;
    }
  }

  dispose(world: World): void {
    world.scene.remove(this.group);
    this.wake?.dispose();
    this.wake = null;
    // Geometry is per-part; weapon materials are shared, so only free the part materials we own.
    this.group.traverse((o) => (o as Mesh).geometry?.dispose());
    for (const v of this.visuals) v?.materials.forEach((m) => m.dispose());
  }
}
