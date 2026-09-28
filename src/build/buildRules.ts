/**
 * Pure rules for the boat builder: where a block may go, what may be removed,
 * what it costs, and how the finished boat will perform.
 */

import { PARTS, type PlacedPart } from '../boat/parts';
import { computeStats, findDetached, touching, type PartInstance } from '../boat/BoatStats';
import { getWeapon } from '../weapons/weaponDefs';

export const MAX_WIDTH = 8;
export const MAX_LENGTH = 14;
export const MAX_DECK = 3;

export interface Check {
  ok: boolean;
  reason: string;
}

const OK: Check = { ok: true, reason: '' };
const no = (reason: string): Check => ({ ok: false, reason });

export function toInstances(parts: PlacedPart[]): PartInstance[] {
  return parts.map((p, index) => {
    const def = PARTS[p.part];
    return { index, def, x: p.x, y: p.y, z: p.z, hp: p.hp ?? def.hp, alive: true, weapon: p.weapon };
  });
}

/** Two unit blocks occupy some of the same space. */
export function overlaps(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean {
  const e = 1 - 1e-3;
  return Math.abs(a.x - b.x) < e && Math.abs(a.y - b.y) < e && Math.abs(a.z - b.z) < e;
}

export function partCost(p: PlacedPart): { wood: number; metal: number } {
  const def = PARTS[p.part];
  const gun = p.weapon ? getWeapon(p.weapon).cost : { wood: 0, metal: 0 };
  return { wood: def.cost.wood + gun.wood, metal: def.cost.metal + gun.metal };
}

/** Half the materials come back when a block is taken off, less for a damaged one. */
export function refund(p: PlacedPart): { wood: number; metal: number } {
  const def = PARTS[p.part];
  const c = partCost(p);
  const f = 0.5 * ((p.hp ?? def.hp) / def.hp);
  return { wood: Math.floor(c.wood * f), metal: Math.floor(c.metal * f) };
}

export function canPlace(parts: PlacedPart[], cand: PlacedPart, wallet?: { wood: number; metal: number }): Check {
  const def = PARTS[cand.part];
  if (!def) return no('Unknown part');
  if (def.layer === 'hull' && cand.y !== 0) return no('Hull blocks go on the waterline');
  if (def.layer === 'deck' && (cand.y < 1 || cand.y > MAX_DECK)) return no(cand.y < 1 ? 'Deck gear goes on top of the hull' : 'Too high');
  if (def.kind === 'mount' && !cand.weapon) return no('Pick a gun for the mount');
  if (parts.some((p) => overlaps(p, cand))) return no('Something is already there');
  if (!parts.some((p) => touching(p, cand))) return no('Must attach to the boat');
  const xs = [...parts.map((p) => p.x), cand.x];
  const zs = [...parts.map((p) => p.z), cand.z];
  if (Math.max(...xs) - Math.min(...xs) + 1 > MAX_WIDTH) return no(`Wider than ${MAX_WIDTH} m`);
  if (Math.max(...zs) - Math.min(...zs) + 1 > MAX_LENGTH) return no(`Longer than ${MAX_LENGTH} m`);
  if (wallet) {
    const c = partCost(cand);
    if (c.wood > wallet.wood) return no(`Needs ${c.wood} wood`);
    if (c.metal > wallet.metal) return no(`Needs ${c.metal} metal`);
  }
  return OK;
}

export function canRemove(parts: PlacedPart[], index: number): Check {
  const target = parts[index];
  if (!target) return no('Nothing there');
  const rest = parts.filter((_, i) => i !== index);
  if (!rest.some((p) => PARTS[p.part].kind === 'hull')) return no('The boat needs at least one hull block');
  const detached = findDetached(toInstances(rest));
  if (detached.length) return no(`Would cut loose ${detached.length} block${detached.length > 1 ? 's' : ''}`);
  return OK;
}

/** Forward speed where thrust balances drag (same drag model as BoatPhysics). */
export function topSpeed(thrust: number, hullCells: number): number {
  const n = Math.max(1, hullCells);
  const a = 6 * n;
  const b = 45 * n;
  return (-b + Math.sqrt(b * b + 4 * a * thrust)) / (2 * a);
}

export interface DesignSummary {
  mass: number;
  /** spare buoyancy: 0.5 = could carry half its weight again */
  reserve: number;
  floats: boolean;
  thrust: number;
  /** knots */
  speed: number;
  guns: number;
  berths: number;
  fishing: number;
  armour: number;
  blocks: number;
}

export function summarize(parts: PlacedPart[]): DesignSummary {
  const inst = toInstances(parts);
  const s = computeStats(inst);
  const buoy = inst.reduce((acc, p) => acc + p.def.buoyancy, 0) * 1000;
  return {
    mass: s.mass,
    reserve: buoy / s.mass - 1,
    floats: buoy > s.mass * 1.25,
    thrust: s.thrust,
    speed: topSpeed(s.thrust, s.hullCells) * 1.944,
    guns: s.guns,
    berths: s.berths,
    fishing: s.fishing,
    armour: inst.filter((p) => p.def.kind === 'armor' || p.def.id === 'hull_metal').length,
    blocks: parts.length,
  };
}
