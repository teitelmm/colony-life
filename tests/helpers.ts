import { PARTS, type BoatDesign } from '../src/boat/parts';
import type { PartInstance } from '../src/boat/BoatStats';

export function instantiate(design: BoatDesign): PartInstance[] {
  return design.parts.map((p, index) => ({
    index,
    def: PARTS[p.part],
    x: p.x,
    y: p.y,
    z: p.z,
    hp: PARTS[p.part].hp,
    alive: true,
    weapon: p.weapon,
  }));
}
