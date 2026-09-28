/**
 * Crew repair orders. Each order sends one crew member to a block: they put
 * out fires, patch damage (costing wood or metal by the block's material) and
 * rebuild blocks that were shot away.
 */

import { Group, Vector3 } from 'three';
import type { Boat } from '../boat/Boat';
import type { PartInstance } from '../boat/BoatStats';
import { touching } from '../boat/BoatStats';
import { DECK_TOP } from '../boat/parts';
import { crewFigure } from '../weapons/WeaponMesh';
import type { World } from './World';

export const PATCH_RATE = 11; // hp per second per crew member
export const REBUILD_TIME = 4.5;

export type JobStatus = 'waiting' | 'working' | 'needs wood' | 'needs metal' | 'no support';

export interface RepairJob {
  part: PartInstance;
  status: JobStatus;
  /** rebuild progress 0..1 for destroyed blocks */
  progress: number;
  paid: boolean;
  figure: Group | null;
  sparkTimer: number;
}

export interface Wallet {
  wood: number;
  metal: number;
}

const _p = new Vector3();

export function needsWork(boat: Boat, p: PartInstance): boolean {
  return !p.alive || p.hp < p.def.hp - 0.5 || boat.fires.has(p.index);
}

/** A destroyed block can only be rebuilt against something still standing. */
export function supported(boat: Boat, p: PartInstance): boolean {
  return boat.parts.some((o) => o !== p && o.alive && touching(o, p));
}

const PRIORITY: Record<string, number> = { hull: 0, engine: 1, mount: 2, armor: 3, quarters: 4, crane: 5, cabin: 6 };

export class Repairs {
  jobs: RepairJob[] = [];
  private boat: Boat | null = null;

  has(p: PartInstance): boolean {
    return this.jobs.some((j) => j.part === p);
  }

  status(p: PartInstance): JobStatus | null {
    return this.jobs.find((j) => j.part === p)?.status ?? null;
  }

  /** Order or cancel a repair on one block. Returns the new state. */
  toggle(boat: Boat, p: PartInstance): boolean {
    this.bind(boat);
    const i = this.jobs.findIndex((j) => j.part === p);
    if (i >= 0) {
      this.finish(i);
      return false;
    }
    if (!needsWork(boat, p)) return false;
    this.jobs.push({ part: p, status: 'waiting', progress: 0, paid: false, figure: null, sparkTimer: 0 });
    return true;
  }

  /** Queue every damaged block, most important first. Returns how many were added. */
  queueAll(boat: Boat): number {
    this.bind(boat);
    const todo = boat.parts
      .filter((p) => needsWork(boat, p) && !this.has(p))
      .sort((a, b) => {
        const burning = Number(boat.fires.has(b.index)) - Number(boat.fires.has(a.index));
        if (burning) return burning;
        const dead = Number(a.alive) - Number(b.alive);
        if (dead) return dead;
        return (PRIORITY[a.def.kind] ?? 9) - (PRIORITY[b.def.kind] ?? 9) || a.hp / a.def.hp - b.hp / b.def.hp;
      });
    for (const p of todo) this.jobs.push({ part: p, status: 'waiting', progress: 0, paid: false, figure: null, sparkTimer: 0 });
    return todo.length;
  }

  private bind(boat: Boat): void {
    if (this.boat !== boat) {
      this.clear();
      this.boat = boat;
    }
  }

  private finish(i: number): void {
    const job = this.jobs[i];
    job.figure?.removeFromParent();
    this.jobs.splice(i, 1);
  }

  clear(): void {
    for (const j of this.jobs) j.figure?.removeFromParent();
    this.jobs = [];
    this.boat = null;
  }

  /**
   * Work the first `hands` jobs. Returns parts whose repairer was on them when
   * they were destroyed (the caller removes those crew).
   */
  update(dt: number, world: World, boat: Boat, hands: number, efficiency: number, wallet: Wallet): void {
    this.bind(boat);
    for (let i = this.jobs.length - 1; i >= 0; i--) {
      const j = this.jobs[i];
      if (j.part.alive && !needsWork(boat, j.part)) this.finish(i);
    }

    this.jobs.forEach((job, i) => {
      const p = job.part;
      const staffed = i < hands;
      if (!staffed) {
        job.status = 'waiting';
        job.figure?.removeFromParent();
        job.figure = null;
        return;
      }
      const cost = p.def.cost;
      let working = true;

      if (!p.alive) {
        if (!supported(boat, p)) {
          job.status = 'no support';
          working = false;
        } else if (!job.paid) {
          if (cost.wood > wallet.wood) job.status = 'needs wood';
          else if (cost.metal > wallet.metal) job.status = 'needs metal';
          else {
            wallet.wood -= cost.wood;
            wallet.metal -= cost.metal;
            job.paid = true;
          }
          working = job.paid;
        }
        if (job.paid) {
          job.status = 'working';
          job.progress += (dt * efficiency) / REBUILD_TIME;
          if (job.progress >= 1) {
            boat.restorePart(p);
            p.hp = p.def.hp * 0.6;
            boat.refreshDamage(p);
            boat.recomputeStats();
            job.progress = 0;
            job.paid = false;
          }
        }
      } else if (boat.fires.has(p.index)) {
        job.status = 'working';
        const f = boat.fires.get(p.index)! - dt * 0.45 * efficiency;
        if (f <= 0) boat.fires.delete(p.index);
        else boat.fires.set(p.index, f);
      } else {
        // Patch: materials are spent in proportion to the hp restored.
        const heal = Math.min(p.def.hp - p.hp, PATCH_RATE * efficiency * dt);
        const needW = (cost.wood / p.def.hp) * heal;
        const needM = (cost.metal / p.def.hp) * heal;
        if (needW > wallet.wood + 1e-9) {
          job.status = 'needs wood';
          working = false;
        } else if (needM > wallet.metal + 1e-9) {
          job.status = 'needs metal';
          working = false;
        } else {
          wallet.wood -= needW;
          wallet.metal -= needM;
          p.hp += heal;
          job.status = 'working';
          boat.refreshDamage(p);
        }
      }

      // Show the crew member at the block, hammering away.
      if (!job.figure) {
        job.figure = crewFigure(boat.isPlayer ? 0x3f6fb5 : 0x5a2320);
        job.figure.scale.setScalar(0.85);
        boat.group.add(job.figure);
      }
      const inward = Math.sign(boat.stats.centerX - p.x) * 0.3;
      job.figure.position.set(p.x + inward, (p.y > 0 ? p.y - 1 : 0) + DECK_TOP + 0.08, p.z - 0.25);
      job.figure.rotation.y = Math.sin(world.time * 3 + i) * 0.4;
      job.figure.rotation.x = working ? Math.max(0, Math.sin(world.time * 9 + i)) * 0.35 : 0;
      if (working) {
        job.sparkTimer -= dt;
        if (job.sparkTimer <= 0) {
          job.sparkTimer = 0.45 + Math.random() * 0.3;
          boat.body.localToWorld(_p.set(p.x, p.y + 0.2, p.z), _p);
          if (boat.fires.has(p.index)) world.effects.bulletWater(_p.x, _p.z);
          else world.effects.hit(_p, p.def.material, 0.35);
        }
      }
    });
  }

  /** The repair order on a block that just got destroyed loses its crew member. */
  onDestroyed(p: PartInstance, hands: number): boolean {
    const i = this.jobs.findIndex((j) => j.part === p);
    if (i < 0) return false;
    const staffed = i < hands && this.jobs[i].figure !== null;
    this.jobs[i].figure?.removeFromParent();
    this.jobs[i].figure = null;
    this.jobs[i].paid = false;
    this.jobs[i].progress = 0;
    return staffed;
  }
}
