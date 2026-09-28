/**
 * Boat part catalogue. A boat is a set of parts on a 1 m grid; every part has
 * its own HP and material so damage, repairs (phase 2) and the builder can
 * reason about individual blocks.
 */

import type { WeaponId } from '../weapons/weaponDefs';

export type Material = 'wood' | 'metal';
export type PartKind = 'hull' | 'armor' | 'engine' | 'mount' | 'cabin';

export interface PartDef {
  id: string;
  name: string;
  kind: PartKind;
  material: Material;
  hp: number;
  /** kg */
  mass: number;
  /** m³ of water displaced when fully submerged */
  buoyancy: number;
  /** 0..1 incoming damage reduction (scaled by attacker penetration) */
  armor: number;
  /** engine thrust in newtons */
  thrust: number;
  /** repair/build cost (phase 2) */
  cost: { wood: number; metal: number };
}

export const PARTS: Record<string, PartDef> = {
  hull_wood: {
    id: 'hull_wood',
    name: 'Wooden Hull',
    kind: 'hull',
    material: 'wood',
    hp: 60,
    mass: 230,
    buoyancy: 1,
    armor: 0,
    thrust: 0,
    cost: { wood: 6, metal: 0 },
  },
  hull_metal: {
    id: 'hull_metal',
    name: 'Steel Hull',
    kind: 'hull',
    material: 'metal',
    hp: 150,
    mass: 330,
    buoyancy: 1,
    armor: 0.25,
    thrust: 0,
    cost: { wood: 0, metal: 6 },
  },
  armor_plate: {
    id: 'armor_plate',
    name: 'Armour Plate',
    kind: 'armor',
    material: 'metal',
    hp: 190,
    mass: 210,
    buoyancy: 0,
    armor: 0.6,
    thrust: 0,
    cost: { wood: 0, metal: 8 },
  },
  engine_outboard: {
    id: 'engine_outboard',
    name: 'Outboard Motor',
    kind: 'engine',
    material: 'metal',
    hp: 55,
    mass: 110,
    buoyancy: 0,
    armor: 0.1,
    thrust: 4200,
    cost: { wood: 0, metal: 5 },
  },
  engine_diesel: {
    id: 'engine_diesel',
    name: 'Diesel Engine',
    kind: 'engine',
    material: 'metal',
    hp: 120,
    mass: 380,
    buoyancy: 0,
    armor: 0.2,
    thrust: 9500,
    cost: { wood: 2, metal: 10 },
  },
  mount_light: {
    id: 'mount_light',
    name: 'Gun Mount',
    kind: 'mount',
    material: 'metal',
    hp: 70,
    mass: 140,
    buoyancy: 0,
    armor: 0.15,
    thrust: 0,
    cost: { wood: 1, metal: 4 },
  },
  mount_heavy: {
    id: 'mount_heavy',
    name: 'Heavy Mount',
    kind: 'mount',
    material: 'metal',
    hp: 120,
    mass: 320,
    buoyancy: 0,
    armor: 0.3,
    thrust: 0,
    cost: { wood: 0, metal: 8 },
  },
  cabin_wood: {
    id: 'cabin_wood',
    name: 'Wheelhouse',
    kind: 'cabin',
    material: 'wood',
    hp: 80,
    mass: 150,
    buoyancy: 0,
    armor: 0,
    thrust: 0,
    cost: { wood: 8, metal: 0 },
  },
};

/** Deck surface height inside a hull cell (the cell spans -0.5..0.5). */
export const DECK_TOP = 0.42;

export interface PlacedPart {
  part: string;
  x: number;
  y: number;
  z: number;
  weapon?: WeaponId;
}

export interface BoatDesign {
  name: string;
  /** hull paint colour */
  paint: number;
  /** trim / accent colour */
  trim: number;
  parts: PlacedPart[];
}
