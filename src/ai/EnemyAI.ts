/**
 * Enemy captain: close to its preferred gun range, circle to bring guns to
 * bear, fire in bursts with led (and imperfect) aim, avoid rocks and each
 * other, and run when badly hurt.
 */

import { Vector3 } from 'three';
import type { Boat } from '../boat/Boat';
import type { World } from '../game/World';
import { leadTarget } from '../weapons/ballistics';
import { GRAVITY } from '../world/waves';

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const _me = new Vector3();
const _them = new Vector3();
const _pivot = new Vector3();
const _v = new Vector3();

export interface AIProfile {
  /** 0..1 — higher = tighter aim */
  accuracy: number;
  /** 0..1 — higher = stays in the fight longer */
  courage: number;
  /** burst on/off seconds */
  burstOn: number;
  burstOff: number;
}

export class EnemyAI {
  private orbitDir: number;
  private burstTimer = 0;
  private bursting = true;
  private readonly wobble = new Vector3();
  private wobbleTarget = new Vector3();
  private wobbleTimer = 0;
  private reaction = 1 + Math.random() * 1.5;
  private fleeTimer = 0;
  private fleeCooldown = 0;

  constructor(
    readonly boat: Boat,
    private readonly profile: AIProfile,
  ) {
    this.orbitDir = Math.random() < 0.5 ? 1 : -1;
  }

  private preferredRange(): number {
    const turrets = this.boat.turrets;
    if (!turrets.length) return 40;
    const hasCannon = turrets.some((t) => t.def.kind === 'shell');
    const hasHarpoon = turrets.some((t) => t.def.kind === 'harpoon');
    if (hasCannon) return 42;
    if (hasHarpoon) return 16;
    return 24;
  }

  update(dt: number, world: World): void {
    const boat = this.boat;
    const target = world.player;
    if (!boat.alive) return;
    if (!target || !target.alive) {
      boat.trigger = false;
      boat.helm.throttle = 0.4;
      boat.helm.rudder = 0.3 * this.orbitDir;
      return;
    }

    boat.centerWorld(_me);
    target.centerWorld(_them);
    const dx = _them.x - _me.x;
    const dz = _them.z - _me.z;
    const dist = Math.hypot(dx, dz);
    const toTarget = Math.atan2(dx, dz);
    const heading = boat.body.heading();
    const pref = this.preferredRange();

    // --- steering ---
    let desired: number;
    let throttle = 1;
    // Badly hurt captains break off for a few seconds, then come back for more.
    this.fleeTimer -= dt;
    this.fleeCooldown -= dt;
    const hurt = boat.stats.hullIntegrity < 0.45 + (1 - this.profile.courage) * 0.2;
    if (hurt && this.fleeCooldown <= 0 && dist < 50) {
      this.fleeTimer = 4 + Math.random() * 3;
      this.fleeCooldown = 25;
    }
    if (this.fleeTimer > 0) {
      desired = toTarget + Math.PI;
    } else if (dist > pref + 14) {
      desired = toTarget + this.orbitDir * 0.25;
    } else {
      // Orbit: tangent plus a correction toward the preferred radius.
      const err = (dist - pref) / pref;
      desired = toTarget + this.orbitDir * (Math.PI / 2 - Math.max(-0.8, Math.min(0.8, err * 1.6)));
      throttle = 0.75;
    }

    // Avoid islands by probing ahead.
    const probe = 10 + Math.abs(boat.forwardSpeed()) * 1.5;
    const ax = _me.x + Math.sin(heading) * probe;
    const az = _me.z + Math.cos(heading) * probe;
    const hit = world.scenery.resolve(ax, az, boat.stats.radius + 3);
    if (hit) {
      const away = Math.atan2(hit.nx, hit.nz);
      desired = away + wrap(desired - away) * 0.3;
      throttle = 0.6;
      if (Math.random() < dt * 0.5) this.orbitDir *= -1;
    }

    // Keep some distance from friends.
    let sx = 0;
    let sz = 0;
    for (const other of world.boats) {
      if (other === boat || other.team !== boat.team || !other.alive) continue;
      other.centerWorld(_v);
      const ox = _me.x - _v.x;
      const oz = _me.z - _v.z;
      const d = Math.hypot(ox, oz);
      const min = boat.stats.radius + other.stats.radius + 6;
      if (d < min && d > 0.01) {
        sx += (ox / d) * (min - d);
        sz += (oz / d) * (min - d);
      }
    }
    if (sx || sz) {
      const sep = Math.atan2(sx, sz);
      desired = sep + wrap(desired - sep) * 0.5;
    }

    const diff = wrap(desired - heading);
    boat.helm.rudder = -Math.max(-1, Math.min(1, diff * 2.2));
    boat.helm.throttle = throttle * (Math.abs(diff) > 1.8 ? 0.5 : 1);

    // --- gunnery ---
    this.reaction -= dt;
    this.burstTimer -= dt;
    if (this.burstTimer <= 0) {
      this.bursting = !this.bursting;
      this.burstTimer = (this.bursting ? this.profile.burstOn : this.profile.burstOff) * (0.6 + Math.random() * 0.8);
    }
    this.wobbleTimer -= dt;
    if (this.wobbleTimer <= 0) {
      this.wobbleTimer = 0.6 + Math.random();
      const miss = (1 - this.profile.accuracy) * (1.2 + dist * 0.05);
      this.wobbleTarget.set((Math.random() - 0.5) * 2 * miss, 0, (Math.random() - 0.5) * 2 * miss);
    }
    this.wobble.lerp(this.wobbleTarget, Math.min(1, dt * 2));

    // Lead using the main gun's ballistics.
    const main = boat.turrets.reduce<(typeof boat.turrets)[number] | null>((best, t) => (!best || t.def.range > best.def.range ? t : best), null);
    if (main) {
      main.pivotWorld(_pivot);
      const tv = target.body.vel;
      const aim = leadTarget(_pivot, { x: _them.x, y: 0.4, z: _them.z }, tv, main.def.muzzleVelocity, GRAVITY * main.def.gravityScale);
      boat.aim.set(aim.x + this.wobble.x, _them.y + 0.25, aim.z + this.wobble.z);
      const inRange = dist < main.def.range * 1.05;
      boat.trigger = this.reaction <= 0 && inRange && this.bursting;
    } else {
      boat.trigger = false;
    }
  }
}
