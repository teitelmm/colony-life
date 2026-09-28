/**
 * Boat part catalogue. A boat is a set of parts on a 1 m grid; every part has
 * its own HP and material so damage, crew repairs and the builder can reason
 * about individual blocks.
 */

import type { WeaponId } from '../weapons/weaponDefs';

export type Material = 'wood' | 'metal';
export type PartKind = 'hull' | 'armor' | 'engine' | 'mount' | 'cabin' | 'quarters' | 'crane';
/** hull blocks sit in the waterline layer (y = 0); everything else goes on deck (y ≥ 1) */
export type BuildLayer = 'hull' | 'deck';

export interface PartDef {
  id: string;
  name: string;
  /** one line for the build palette */
  blurb: string;
  kind: PartKind;
  material: Material;
  layer: BuildLayer;
  hp: number;
  /** kg */
  mass: number;
  /** m³ of water displaced when fully submerged */
  buoyancy: number;
  /** 0..1 incoming damage reduction (scaled by attacker penetration) */
  armor: number;
  /** engine thrust in newtons */
  thrust: number;
  /** crew beds provided */
  berths: number;
  /** fishing catch-rate bonus (0.5 = +50%) */
  fishing: number;
  /** build / rebuild cost */
  cost: { wood: number; metal: number };
}

type Spec = Omit<PartDef, 'buoyancy' | 'armor' | 'thrust' | 'berths' | 'fishing' | 'layer'> & Partial<PartDef>;
const part = (s: Spec): PartDef => ({ buoyancy: 0, armor: 0, thrust: 0, berths: 0, fishing: 0, layer: 'deck', ...s });

export const PARTS: Record<string, PartDef> = {
  hull_wood: part({
    id: 'hull_wood',
    name: 'Wooden Hull',
    blurb: 'Cheap and buoyant. Splinters easily.',
    kind: 'hull',
    layer: 'hull',
    material: 'wood',
    hp: 60,
    mass: 230,
    buoyancy: 1,
    cost: { wood: 6, metal: 0 },
  }),
  hull_metal: part({
    id: 'hull_metal',
    name: 'Steel Hull',
    blurb: 'Heavy plate that shrugs off bullets.',
    kind: 'hull',
    layer: 'hull',
    material: 'metal',
    hp: 150,
    mass: 330,
    buoyancy: 1,
    armor: 0.25,
    cost: { wood: 0, metal: 6 },
  }),
  armor_plate: part({
    id: 'armor_plate',
    name: 'Armour Plate',
    blurb: 'Sloped plate and sandbags. Soaks up fire.',
    kind: 'armor',
    material: 'metal',
    hp: 190,
    mass: 210,
    armor: 0.6,
    cost: { wood: 0, metal: 8 },
  }),
  engine_outboard: part({
    id: 'engine_outboard',
    name: 'Outboard Motor',
    blurb: 'Light, cheap thrust. Put it at the stern.',
    kind: 'engine',
    material: 'metal',
    hp: 55,
    mass: 110,
    armor: 0.1,
    thrust: 4200,
    cost: { wood: 0, metal: 5 },
  }),
  engine_diesel: part({
    id: 'engine_diesel',
    name: 'Diesel Engine',
    blurb: 'Big, smoky and strong. Pushes heavy hulls.',
    kind: 'engine',
    material: 'metal',
    hp: 120,
    mass: 380,
    armor: 0.2,
    thrust: 9500,
    cost: { wood: 2, metal: 10 },
  }),
  mount_light: part({
    id: 'mount_light',
    name: 'Gun Mount',
    blurb: 'Takes any gun. Needs a gunner to fire.',
    kind: 'mount',
    material: 'metal',
    hp: 70,
    mass: 140,
    armor: 0.15,
    cost: { wood: 1, metal: 4 },
  }),
  mount_heavy: part({
    id: 'mount_heavy',
    name: 'Heavy Mount',
    blurb: 'Armoured ring for big guns.',
    kind: 'mount',
    material: 'metal',
    hp: 120,
    mass: 320,
    armor: 0.3,
    cost: { wood: 0, metal: 8 },
  }),
  cabin_wood: part({
    id: 'cabin_wood',
    name: 'Wheelhouse',
    blurb: 'Soaks hits and flies your colours.',
    kind: 'cabin',
    material: 'wood',
    hp: 80,
    mass: 150,
    cost: { wood: 8, metal: 0 },
  }),
  bunk_cabin: part({
    id: 'bunk_cabin',
    name: 'Bunk Cabin',
    blurb: 'Two bunks. Room for more crew to sign on.',
    kind: 'quarters',
    material: 'wood',
    hp: 70,
    mass: 160,
    berths: 2,
    cost: { wood: 10, metal: 1 },
  }),
  net_crane: part({
    id: 'net_crane',
    name: 'Net Crane',
    blurb: 'Boom and net. Hauls in fish 50% faster.',
    kind: 'crane',
    material: 'wood',
    hp: 50,
    mass: 90,
    fishing: 0.5,
    cost: { wood: 5, metal: 2 },
  }),
};

/** Deck surface height inside a hull cell (the cell spans -0.5..0.5). */
export const DECK_TOP = 0.42;

export interface PlacedPart {
  part: string;
  x: number;
  y: number;
  z: number;
  weapon?: WeaponId;
  /** gun facing in quarter turns from the bow (mounts only); omitted = automatic */
  facing?: number;
  /** current hp when carried over from a damaged boat */
  hp?: number;
}

export interface BoatDesign {
  name: string;
  /** hull paint colour */
  paint: number;
  /** trim / accent colour */
  trim: number;
  parts: PlacedPart[];
}
