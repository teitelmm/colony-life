/**
 * Gun workshop: a custom gun is a base weapon plus four part choices. Pure —
 * the UI and the registry live elsewhere.
 */

import { WEAPONS, type WeaponDef } from './weaponDefs';

export type GunBase = 'mg' | 'cannon' | 'harpoon';
export type Barrel = 'short' | 'standard' | 'long';
export type Receiver = 'light' | 'standard' | 'heavy';
export type Ammo = 'ball' | 'ap' | 'incendiary' | 'explosive';
export type Cooling = 'none' | 'jacket' | 'finned';

export interface GunRecipe {
  name: string;
  base: GunBase;
  barrel: Barrel;
  receiver: Receiver;
  ammo: Ammo;
  cooling: Cooling;
}

interface Option {
  label: string;
  blurb: string;
  cost: { wood: number; metal: number };
  apply(d: WeaponDef): void;
}

const deg = (d: number) => (d * Math.PI) / 180;

/** Workshop MG frame: between the rusty old gun and the Mk II. */
const MG_BASE: WeaponDef = {
  ...WEAPONS.mg_new,
  id: 'mg_base',
  rig: 'mg_new',
  name: 'Workshop MG',
  fireInterval: 0.09,
  muzzleVelocity: 190,
  spread: deg(1.5),
  damage: 8,
  penetration: 0.25,
  heatPerShot: 0.045,
  coolRate: 0.35,
  jamChance: 0.002,
  jamTime: 1.4,
  range: 75,
  cost: { wood: 0, metal: 5 },
};

export const BASES: Record<GunBase, { label: string; blurb: string; def: WeaponDef }> = {
  mg: { label: 'Machine gun', blurb: 'Fast bullets. Shreds wood.', def: MG_BASE },
  cannon: { label: 'Cannon', blurb: 'Lobbed shells with splash damage.', def: { ...WEAPONS.cannon, cost: { wood: 2, metal: 12 } } },
  harpoon: { label: 'Harpoon', blurb: 'Tethers and drags targets in.', def: { ...WEAPONS.harpoon, cost: { wood: 3, metal: 5 } } },
};

export const BARRELS: Record<Barrel, Option> = {
  short: {
    label: 'Short',
    blurb: 'Swings fast, sprays wide, falls short.',
    cost: { wood: 0, metal: -1 },
    apply: (d) => {
      d.muzzleVelocity *= 0.82;
      d.spread *= 1.4;
      d.range *= 0.78;
      d.traverseSpeed *= 1.3;
      d.barrelScale = 0.75;
    },
  },
  standard: { label: 'Standard', blurb: 'No surprises.', cost: { wood: 0, metal: 0 }, apply: () => {} },
  long: {
    label: 'Long',
    blurb: 'Flat, accurate and far-reaching, but slow to turn.',
    cost: { wood: 0, metal: 3 },
    apply: (d) => {
      d.muzzleVelocity *= 1.25;
      d.spread *= 0.6;
      d.range *= 1.3;
      d.traverseSpeed *= 0.78;
      d.barrelScale = 1.35;
    },
  },
};

export const RECEIVERS: Record<Receiver, Option> = {
  light: {
    label: 'Light',
    blurb: 'Fires quicker, hits softer.',
    cost: { wood: 0, metal: 0 },
    apply: (d) => {
      d.fireInterval *= 0.75;
      d.damage *= 0.8;
      d.heatPerShot *= 0.9;
    },
  },
  standard: { label: 'Standard', blurb: 'Balanced action.', cost: { wood: 0, metal: 0 }, apply: () => {} },
  heavy: {
    label: 'Heavy',
    blurb: 'Bigger rounds: more damage and punch, slower and hotter.',
    cost: { wood: 0, metal: 4 },
    apply: (d) => {
      d.fireInterval *= 1.35;
      d.damage *= 1.45;
      d.penetration = Math.min(1, d.penetration + 0.1);
      d.heatPerShot *= 1.25;
      d.recoil *= 1.6;
      d.shake *= 1.4;
    },
  },
};

export const AMMO: Record<Ammo, Option> = {
  ball: { label: 'Ball', blurb: 'Plain rounds.', cost: { wood: 0, metal: 0 }, apply: () => {} },
  ap: {
    label: 'Armour-piercing',
    blurb: 'Punches through steel and armour.',
    cost: { wood: 0, metal: 2 },
    apply: (d) => {
      d.penetration = Math.min(1, d.penetration + 0.35);
      d.damage *= 0.9;
    },
  },
  incendiary: {
    label: 'Incendiary',
    blurb: 'Hits can set parts on fire.',
    cost: { wood: 2, metal: 1 },
    apply: (d) => {
      d.incendiary = d.kind === 'bullet' ? 0.07 : 0.4;
      d.damage *= 0.9;
    },
  },
  explosive: {
    label: 'High-explosive',
    blurb: 'Rounds burst on impact and hurt nearby parts.',
    cost: { wood: 0, metal: 3 },
    apply: (d) => {
      if (d.kind === 'shell') {
        d.splashRadius *= 1.4;
        d.splashDamage *= 1.2;
      } else {
        d.splashRadius = Math.max(d.splashRadius, 1);
        d.splashDamage = Math.max(d.splashDamage, d.damage * 0.4);
      }
      d.damage *= 0.8;
      d.penetration *= 0.7;
    },
  },
};

export const COOLING: Record<Cooling, Option> = {
  none: {
    label: 'None',
    blurb: 'Runs hot.',
    cost: { wood: 0, metal: 0 },
    apply: (d) => {
      d.heatPerShot *= 1.25;
    },
  },
  jacket: {
    label: 'Water jacket',
    blurb: 'Less heat per shot, fewer jams.',
    cost: { wood: 0, metal: 2 },
    apply: (d) => {
      d.heatPerShot *= 0.75;
      d.jamChance *= 0.4;
    },
  },
  finned: {
    label: 'Cooling fins',
    blurb: 'Sheds heat fast between bursts.',
    cost: { wood: 0, metal: 3 },
    apply: (d) => {
      d.coolRate *= 1.7;
    },
  },
};

export function recipeCost(r: GunRecipe): { wood: number; metal: number } {
  const parts = [BASES[r.base].def.cost, BARRELS[r.barrel].cost, RECEIVERS[r.receiver].cost, AMMO[r.ammo].cost];
  if (r.base === 'mg') parts.push(COOLING[r.cooling].cost);
  return {
    wood: Math.max(0, parts.reduce((s, c) => s + c.wood, 0)),
    metal: Math.max(1, parts.reduce((s, c) => s + c.metal, 0)),
  };
}

export function autoName(r: GunRecipe): string {
  const bits: string[] = [];
  if (r.barrel !== 'standard') bits.push(BARRELS[r.barrel].label);
  if (r.receiver !== 'standard') bits.push(RECEIVERS[r.receiver].label);
  bits.push(r.base === 'mg' ? 'MG' : BASES[r.base].label);
  const ammo = { ball: '', ap: 'AP', incendiary: 'Incendiary', explosive: 'HE' }[r.ammo];
  return bits.join(' ') + (ammo ? ` (${ammo})` : '');
}

/** Build a weapon definition from a recipe. */
export function buildWeapon(r: GunRecipe, id: string): WeaponDef {
  const d: WeaponDef = { ...BASES[r.base].def, id, custom: true, barrelScale: 1, incendiary: 0 };
  BARRELS[r.barrel].apply(d);
  RECEIVERS[r.receiver].apply(d);
  AMMO[r.ammo].apply(d);
  if (r.base === 'mg') COOLING[r.cooling].apply(d);
  d.name = r.name.trim() || autoName(r);
  d.cost = recipeCost(r);
  return d;
}

/** Numbers the workshop shows side by side, normalised for bars. */
export function statSheet(d: WeaponDef): { label: string; value: string; bar: number }[] {
  const dps = (d.damage + d.splashDamage * 0.5) / d.fireInterval;
  return [
    { label: 'Damage / shot', value: d.damage.toFixed(0) + (d.splashDamage ? ` +${d.splashDamage.toFixed(0)} splash` : ''), bar: Math.min(1, (d.damage + d.splashDamage) / 90) },
    { label: 'Rate of fire', value: `${(60 / d.fireInterval).toFixed(0)} rpm`, bar: Math.min(1, 1 / d.fireInterval / 16) },
    { label: 'Sustained damage', value: `${dps.toFixed(0)}/s`, bar: Math.min(1, dps / 160) },
    { label: 'Accuracy', value: `±${((d.spread * 180) / Math.PI).toFixed(1)}°`, bar: Math.max(0.05, 1 - d.spread / deg(4)) },
    { label: 'Range', value: `${d.range.toFixed(0)} m`, bar: Math.min(1, d.range / 140) },
    { label: 'Armour piercing', value: `${Math.round(d.penetration * 100)}%`, bar: d.penetration },
    { label: 'Heat per shot', value: d.heatPerShot ? `${(d.heatPerShot * 100).toFixed(1)}%` : '—', bar: Math.min(1, d.heatPerShot * 12) },
  ];
}
