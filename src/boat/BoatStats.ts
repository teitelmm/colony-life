/**
 * Pure structural bookkeeping for a boat made of parts: mass properties,
 * buoyancy, thrust and structural connectivity. No three.js dependency.
 */

import type { PartDef } from './parts';
import type { WeaponId } from '../weapons/weaponDefs';

export interface PartInstance {
  index: number;
  def: PartDef;
  x: number;
  y: number;
  z: number;
  hp: number;
  alive: boolean;
  weapon?: WeaponId;
}

export interface BoatStats {
  mass: number;
  /** centre of mass in boat-local coordinates */
  com: { x: number; y: number; z: number };
  /** diagonal inertia tensor about the COM (kg·m²) */
  inertia: { x: number; y: number; z: number };
  thrust: number;
  /** effective buoyant volume of intact hull (m³) */
  buoyancy: number;
  hullCells: number;
  /** 0..1 fraction of total hull HP remaining */
  hullIntegrity: number;
  /** half extents of the living parts, for AI / foam / collisions */
  halfWidth: number;
  halfLength: number;
  centerX: number;
  centerZ: number;
  radius: number;
}

/** Hull cells keep some buoyancy while damaged, scaled down as they take on water. */
export function effectiveBuoyancy(p: PartInstance): number {
  if (!p.alive || p.def.buoyancy <= 0) return 0;
  const hpFrac = p.hp / p.def.hp;
  return p.def.buoyancy * (0.45 + 0.55 * hpFrac);
}

export function computeStats(parts: PartInstance[]): BoatStats {
  let mass = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let thrust = 0;
  let buoyancy = 0;
  let hullCells = 0;
  let hullHp = 0;
  let hullHpMax = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const p of parts) {
    if (p.def.kind === 'hull') hullHpMax += p.def.hp;
    if (!p.alive) continue;
    mass += p.def.mass;
    cx += p.x * p.def.mass;
    cy += p.y * p.def.mass;
    cz += p.z * p.def.mass;
    thrust += p.def.thrust;
    buoyancy += effectiveBuoyancy(p);
    if (p.def.kind === 'hull') {
      hullCells++;
      hullHp += p.hp;
    }
    minX = Math.min(minX, p.x - 0.5);
    maxX = Math.max(maxX, p.x + 0.5);
    minZ = Math.min(minZ, p.z - 0.5);
    maxZ = Math.max(maxZ, p.z + 0.5);
  }

  if (mass <= 0) {
    return {
      mass: 1,
      com: { x: 0, y: 0, z: 0 },
      inertia: { x: 1, y: 1, z: 1 },
      thrust: 0,
      buoyancy: 0,
      hullCells: 0,
      hullIntegrity: 0,
      halfWidth: 0.5,
      halfLength: 0.5,
      centerX: 0,
      centerZ: 0,
      radius: 0.5,
    };
  }

  cx /= mass;
  cy /= mass;
  cz /= mass;

  // Each part is treated as a solid 1 m cube (I = m/6 about its own centre) plus the parallel-axis term.
  let ix = 0;
  let iy = 0;
  let iz = 0;
  for (const p of parts) {
    if (!p.alive) continue;
    const m = p.def.mass;
    const dx = p.x - cx;
    const dy = p.y - cy;
    const dz = p.z - cz;
    const self = m / 6;
    ix += self + m * (dy * dy + dz * dz);
    iy += self + m * (dx * dx + dz * dz);
    iz += self + m * (dx * dx + dy * dy);
  }

  const halfWidth = (maxX - minX) / 2;
  const halfLength = (maxZ - minZ) / 2;
  return {
    mass,
    com: { x: cx, y: cy, z: cz },
    inertia: { x: ix, y: iy, z: iz },
    thrust,
    buoyancy,
    hullCells,
    hullIntegrity: hullHpMax > 0 ? hullHp / hullHpMax : 0,
    halfWidth,
    halfLength,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    radius: Math.hypot(halfWidth, halfLength),
  };
}

/** Hull integrity below which a boat is considered wrecked and starts going down. */
export const WRECK_INTEGRITY = 0.4;

export function isWrecked(stats: BoatStats): boolean {
  return stats.hullIntegrity < WRECK_INTEGRITY || stats.buoyancy * 1000 < stats.mass;
}

/** Two unit-cube parts are attached when they share (part of) a face. */
export function touching(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean {
  const d = [Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z)];
  const eps = 1e-3;
  let faceAxes = 0;
  let overlapAxes = 0;
  for (const v of d) {
    if (Math.abs(v - 1) < eps) faceAxes++;
    else if (v < 1 - eps) overlapAxes++;
  }
  return faceAxes === 1 && overlapAxes === 2;
}

/**
 * Returns indices of living parts that are no longer structurally connected
 * to the main body (the connected group holding the most hull cells).
 */
export function findDetached(parts: PartInstance[]): number[] {
  const alive = parts.filter((p) => p.alive);
  const groupOf = new Map<number, number>();
  const groups: PartInstance[][] = [];
  for (const start of alive) {
    if (groupOf.has(start.index)) continue;
    const g: PartInstance[] = [];
    const stack = [start];
    groupOf.set(start.index, groups.length);
    while (stack.length) {
      const cur = stack.pop()!;
      g.push(cur);
      for (const other of alive) {
        if (!groupOf.has(other.index) && touching(cur, other)) {
          groupOf.set(other.index, groups.length);
          stack.push(other);
        }
      }
    }
    groups.push(g);
  }
  if (groups.length <= 1) return [];
  const score = (g: PartInstance[]) => g.reduce((s, p) => s + (p.def.kind === 'hull' ? 1000 : 0) + p.def.mass * 0.01, 0);
  let best = 0;
  for (let i = 1; i < groups.length; i++) if (score(groups[i]) > score(groups[best])) best = i;
  return groups.flatMap((g, i) => (i === best ? [] : g.map((p) => p.index)));
}

export interface DamageResult {
  applied: number;
  destroyed: boolean;
}

/** Apply raw damage to a part, respecting its armour and the attacker's penetration. */
export function damagePart(p: PartInstance, raw: number, penetration: number): DamageResult {
  if (!p.alive) return { applied: 0, destroyed: false };
  const reduction = p.def.armor * (1 - penetration);
  const applied = Math.min(p.hp, raw * (1 - reduction));
  p.hp -= applied;
  if (p.hp <= 0.001) {
    p.hp = 0;
    p.alive = false;
    return { applied, destroyed: true };
  }
  return { applied, destroyed: false };
}
