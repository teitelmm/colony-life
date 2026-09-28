import { describe, expect, it } from 'vitest';
import { hitParts, segmentBox } from '../src/boat/hitTest';
import { damagePart } from '../src/boat/BoatStats';
import { DESIGNS } from '../src/boat/designs';
import { instantiate } from './helpers';

describe('hit tests', () => {
  it('segment vs box', () => {
    const s = { ax: -5, ay: 0, az: 0, bx: 5, by: 0, bz: 0 };
    expect(segmentBox(s, -1, -1, -1, 1, 1, 1)).toBeCloseTo(0.4);
    expect(segmentBox({ ...s, ay: 3, by: 3 }, -1, -1, -1, 1, 1, 1)).toBe(-1);
  });

  it('hits the first part along the ray', () => {
    const parts = instantiate(DESIGNS.gunboat());
    // Shoot from starboard toward port at deck height across the armoured row z = 3.
    const hit = hitParts(parts, { ax: 10, ay: 1, az: 3, bx: -10, by: 1, bz: 3 })!;
    expect(hit).not.toBeNull();
    expect(hit.part.def.id).toBe('armor_plate');
    expect(hit.part.x).toBe(2);
  });

  it('ignores destroyed parts', () => {
    const parts = instantiate(DESIGNS.dinghy());
    const bow = parts.filter((p) => p.z === 2 && p.def.kind === 'hull');
    const seg = { ax: 0, ay: 0, az: 10, bx: 0, by: 0, bz: -10 };
    expect(hitParts(parts, seg)!.part.z).toBe(2);
    bow.forEach((p) => (p.alive = false));
    expect(hitParts(parts, seg)!.part.z).toBe(1);
  });
});

describe('damage', () => {
  it('armour reduces damage unless penetrated', () => {
    const [plate] = instantiate({ name: 't', paint: 0, trim: 0, parts: [{ part: 'armor_plate', x: 0, y: 0, z: 0 }] });
    const low = damagePart(plate, 100, 0).applied;
    plate.hp = plate.def.hp;
    const high = damagePart(plate, 100, 1).applied;
    expect(low).toBeCloseTo(40);
    expect(high).toBeCloseTo(100);
  });

  it('destroys a part at zero hp', () => {
    const [hull] = instantiate(DESIGNS.dinghy());
    const r = damagePart(hull, 1000, 1);
    expect(r.destroyed).toBe(true);
    expect(hull.alive).toBe(false);
    expect(hull.hp).toBe(0);
  });
});
