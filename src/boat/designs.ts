import type { BoatDesign, PlacedPart } from './parts';
import type { WeaponId } from '../weapons/weaponDefs';

/** +z is the bow, x is port→starboard, y is up. Hull layer is y = 0. */
function hull(width: number, length: number, part = 'hull_wood', x0 = 0, z0 = 0): PlacedPart[] {
  const out: PlacedPart[] = [];
  for (let x = 0; x < width; x++) for (let z = 0; z < length; z++) out.push({ part, x: x0 + x, y: 0, z: z0 + z });
  return out;
}

const p = (part: string, x: number, y: number, z: number, weapon?: WeaponId): PlacedPart => ({ part, x, y, z, weapon });

export const DESIGNS = {
  dinghy: (): BoatDesign => ({
    name: 'Dinghy',
    paint: 0x2bb3a3,
    trim: 0xf2c14e,
    parts: [...hull(2, 3), p('engine_outboard', 0.5, 1, 0), p('mount_light', 0.5, 1, 2, 'mg_old')],
  }),

  raider: (): BoatDesign => ({
    name: 'Raider Skiff',
    paint: 0xc8453a,
    trim: 0x2d2a26,
    parts: [...hull(2, 3), p('engine_outboard', 0.5, 1, 0), p('mount_light', 0.5, 1, 2, 'mg_old')],
  }),

  harpooner: (): BoatDesign => ({
    name: 'Harpoon Runner',
    paint: 0xd9822b,
    trim: 0x3b3030,
    parts: [
      ...hull(2, 4),
      p('engine_outboard', 0, 1, 0),
      p('engine_outboard', 1, 1, 0),
      p('cabin_wood', 0.5, 1, 1.5),
      p('mount_light', 0.5, 1, 3, 'harpoon'),
    ],
  }),

  gunboat: (): BoatDesign => ({
    name: 'Gunboat',
    paint: 0x6d7f8c,
    trim: 0xb8322a,
    parts: [
      ...hull(3, 4),
      p('hull_wood', 0, 0, 4),
      p('hull_metal', 1, 0, 4),
      p('hull_wood', 2, 0, 4),
      p('engine_diesel', 1, 1, 0),
      p('cabin_wood', 1, 1, 2),
      p('mount_light', 1, 1, 4, 'mg_new'),
      p('mount_light', 0, 1, 1, 'mg_old'),
      p('mount_light', 2, 1, 1, 'mg_old'),
      p('armor_plate', 0, 1, 3),
      p('armor_plate', 2, 1, 3),
    ],
  }),

  barge: (): BoatDesign => ({
    name: 'Armoured Barge',
    paint: 0x4b5a4a,
    trim: 0xd6a33a,
    parts: [
      ...hull(4, 6, 'hull_metal'),
      p('engine_diesel', 1, 1, 0),
      p('engine_diesel', 2, 1, 0),
      p('mount_heavy', 1.5, 1, 5, 'cannon'),
      p('mount_heavy', 1.5, 1, 1.5, 'cannon'),
      p('cabin_wood', 1.5, 1, 3.2),
      p('armor_plate', 0, 1, 1),
      p('armor_plate', 0, 1, 2),
      p('armor_plate', 0, 1, 3),
      p('armor_plate', 0, 1, 4),
      p('armor_plate', 3, 1, 1),
      p('armor_plate', 3, 1, 2),
      p('armor_plate', 3, 1, 3),
      p('armor_plate', 3, 1, 4),
      p('mount_light', 0, 1, 5, 'mg_new'),
      p('mount_light', 3, 1, 5, 'mg_new'),
    ],
  }),
} satisfies Record<string, () => BoatDesign>;

export type DesignId = keyof typeof DESIGNS;
