/** A gun on a mount: aims at a world point within its arc and fires projectiles. */

import { Vector3 } from 'three';
import { getWeapon, type WeaponId } from './weaponDefs';
import { WeaponState } from './WeaponState';
import { buildWeaponRig, type WeaponRig } from './WeaponMesh';
import { solveLaunchAngle } from './ballistics';
import { GRAVITY } from '../world/waves';
import type { PartInstance } from '../boat/BoatStats';
import type { PartVisual } from '../boat/BoatMesh';
import type { Boat } from '../boat/Boat';
import type { World } from '../game/World';

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const _pivot = new Vector3();
const _local = new Vector3();
const _muzzle = new Vector3();
const _dir = new Vector3();
const _tmp = new Vector3();

export class Turret {
  readonly weapon: WeaponState;
  rig!: WeaponRig;
  /** yaw relative to the boat, 0 = bow */
  yaw: number;
  pitch = 0;
  readonly restYaw: number;
  /** true once aimed within tolerance this frame */
  onTarget = false;
  /** target is inside the firing arc */
  canBear = false;
  /** active harpoon line (harpoon guns only) */
  harpoonOut = false;
  /** a gunner is at the gun; unmanned guns hold fire */
  manned = true;

  constructor(
    readonly boat: Boat,
    readonly part: PartInstance,
    private readonly visual: PartVisual,
    weaponId: WeaponId,
    private readonly crewShirt: number,
  ) {
    this.weapon = new WeaponState(getWeapon(weaponId));
    this.restYaw = Turret.restYawFor(part, boat);
    this.yaw = this.restYaw;
    this.buildRig(weaponId);
  }

  static restYawFor(part: PartInstance, boat: Boat): number {
    if (part.facing !== undefined) return (part.facing * Math.PI) / 2;
    const s = boat.stats;
    const dx = part.x - s.centerX;
    const dz = part.z - s.centerZ;
    if (Math.abs(dx) >= Math.abs(dz) * 0.8 && Math.abs(dx) > 0.3) return dx > 0 ? Math.PI / 2 : -Math.PI / 2;
    return dz < -0.3 ? Math.PI : 0;
  }

  private buildRig(id: WeaponId): void {
    if (this.rig) this.visual.pivot!.remove(this.rig.yaw);
    this.rig = buildWeaponRig(getWeapon(id), this.crewShirt);
    this.visual.pivot!.add(this.rig.yaw);
    this.rig.yaw.rotation.y = this.yaw;
    this.setManned(this.manned);
  }

  setWeapon(id: WeaponId): void {
    if (this.weapon.def.id === id) return;
    this.weapon.setDef(getWeapon(id));
    this.buildRig(id);
  }

  setManned(m: boolean): void {
    this.manned = m;
    if (this.rig?.crew) this.rig.crew.visible = m;
  }

  get def() {
    return this.weapon.def;
  }

  pivotWorld(out: Vector3): Vector3 {
    return this.visual.pivot!.getWorldPosition(out);
  }

  update(dt: number, world: World, aim: Vector3, trigger: boolean): void {
    const def = this.weapon.def;
    this.weapon.update(dt);
    const body = this.boat.body;

    // Desired yaw in boat space, clamped to the firing arc.
    body.worldToLocal(aim, _local);
    this.visual.pivot!.getWorldPosition(_pivot);
    body.worldToLocal(_pivot, _tmp);
    const desired = Math.atan2(_local.x - _tmp.x, _local.z - _tmp.z);
    const rel = wrap(desired - this.restYaw);
    const clamped = Math.max(-def.arc, Math.min(def.arc, rel));
    this.canBear = Math.abs(rel) <= def.arc + 0.02;
    const cur = wrap(this.yaw - this.restYaw);
    const step = def.traverseSpeed * dt * (this.manned ? 1 : 0.15);
    const next = cur + Math.max(-step, Math.min(step, clamped - cur));
    this.yaw = this.restYaw + next;

    // Ballistic elevation to reach the aim point.
    const g = GRAVITY * def.gravityScale;
    // Flat-shooting guns aim a touch high so rounds don't clip the swell on the way in.
    const lift = def.kind === 'shell' ? 0 : 0.15;
    const dist = Math.hypot(aim.x - _pivot.x, aim.z - _pivot.z);
    const angle = solveLaunchAngle(dist, aim.y + lift - _pivot.y, def.muzzleVelocity, g) ?? Math.PI / 4;
    const maxPitch = def.kind === 'shell' ? 0.8 : 0.35;
    const targetPitch = Math.max(-0.2, Math.min(maxPitch, angle));
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 10);

    // Precise guns wait until they're properly on target; sprayers fire as soon as they're close.
    const tolerance = Math.max(0.025, def.spread * 3);
    this.onTarget = Math.abs(clamped - next) < tolerance && Math.abs(targetPitch - this.pitch) < 0.04;

    this.rig.yaw.rotation.y = this.yaw;
    this.rig.pitch.rotation.x = -this.pitch;
    if (this.rig.loaded) this.rig.loaded.visible = !this.harpoonOut && this.weapon.readiness > 0.95;

    if (trigger && this.manned && this.onTarget && this.canBear && !(def.kind === 'harpoon' && this.harpoonOut)) {
      const wasJammed = this.weapon.jammed;
      if (this.weapon.fire()) this.shoot(world);
      if (this.weapon.jammed && !wasJammed && this.boat.isPlayer) world.sound.play('jam');
    }
  }

  private shoot(world: World): void {
    const def = this.weapon.def;
    const heading = this.boat.body.heading();
    const yawW = heading + this.yaw;
    // Random cone spread; boat motion adds a little extra for old guns.
    const spread = def.spread * (1 + Math.min(1, this.boat.body.angVel.length()) * 0.5);
    const sy = yawW + (Math.random() - 0.5) * 2 * spread;
    const sp = this.pitch + (Math.random() - 0.5) * 2 * spread * 0.6;
    _dir.set(Math.sin(sy) * Math.cos(sp), Math.sin(sp), Math.cos(sy) * Math.cos(sp));
    this.rig.muzzle.getWorldPosition(_muzzle);
    // Inherit the boat's horizontal motion only; the mount is stabilised against heave.
    const bv = this.boat.body.vel;
    const vel = _dir.clone().multiplyScalar(def.muzzleVelocity).add(_tmp.set(bv.x, 0, bv.z));
    world.projectiles.spawn(def, this.boat, this, _muzzle, vel, this.weapon.isTracer());

    const scale = def.kind === 'shell' ? 2.4 : def.kind === 'harpoon' ? 1.1 : def.rig === 'mg_new' ? 0.8 : 1;
    world.effects.muzzleFlash(_muzzle, _dir, scale);
    world.sound.play(def.rig, _muzzle.x, _muzzle.z, def.kind === 'bullet' ? 0.7 : 1);
    this.boat.body.applyImpulseAtPoint(_dir.clone().multiplyScalar(-def.recoil), _muzzle);
    if (this.boat.isPlayer) world.effects.shaker.shake(def.shake, _muzzle.x, _muzzle.z);
    if (def.kind === 'harpoon') this.harpoonOut = true;
    // Recoil kick on the barrel.
    this.rig.pitch.position.z = def.kind === 'shell' ? -0.25 : -0.04;
  }

  animate(dt: number): void {
    this.rig.pitch.position.z += (0 - this.rig.pitch.position.z) * Math.min(1, dt * 10);
  }
}
