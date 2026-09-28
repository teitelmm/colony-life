import { describe, expect, it } from 'vitest';
import { DESIGNS } from '../src/boat/designs';
import { canPlace, canRemove, overlaps, partCost, refund, summarize, topSpeed } from '../src/build/buildRules';

const dinghy = () => DESIGNS.dinghy().parts;

describe('placing blocks', () => {
  it('accepts a hull block alongside the hull', () => {
    expect(canPlace(dinghy(), { part: 'hull_wood', x: 2, y: 0, z: 1 }).ok).toBe(true);
  });

  it('keeps hull blocks on the waterline and deck gear above it', () => {
    expect(canPlace(dinghy(), { part: 'hull_wood', x: 0, y: 1, z: 1 }).reason).toMatch(/waterline/);
    expect(canPlace(dinghy(), { part: 'bunk_cabin', x: 2, y: 0, z: 1 }).reason).toMatch(/top of the hull/);
    expect(canPlace(dinghy(), { part: 'bunk_cabin', x: 0, y: 1, z: 1 }).ok).toBe(true);
  });

  it('rejects overlaps, floating blocks and oversize boats', () => {
    expect(canPlace(dinghy(), { part: 'hull_wood', x: 1, y: 0, z: 1 }).reason).toMatch(/already/);
    expect(canPlace(dinghy(), { part: 'hull_wood', x: 5, y: 0, z: 1 }).reason).toMatch(/attach/);
    const long = Array.from({ length: 14 }, (_, z) => ({ part: 'hull_wood', x: 0, y: 0, z }));
    expect(canPlace(long, { part: 'hull_wood', x: 0, y: 0, z: 14 }).reason).toMatch(/Longer/);
  });

  it('needs a gun on a mount and enough materials', () => {
    expect(canPlace(dinghy(), { part: 'mount_light', x: 0, y: 1, z: 1 }).reason).toMatch(/gun/);
    const cand = { part: 'mount_light', x: 0, y: 1, z: 1, weapon: 'cannon' };
    expect(partCost(cand)).toEqual({ wood: 3, metal: 18 });
    expect(canPlace(dinghy(), cand, { wood: 10, metal: 5 }).reason).toMatch(/metal/);
    expect(canPlace(dinghy(), cand, { wood: 10, metal: 30 }).ok).toBe(true);
  });

  it('detects overlapping half-offset blocks', () => {
    expect(overlaps({ x: 0.5, y: 1, z: 2 }, { x: 1, y: 1, z: 2 })).toBe(true);
    expect(overlaps({ x: 0.5, y: 1, z: 2 }, { x: 1.5, y: 1, z: 2 })).toBe(false);
  });
});

describe('removing blocks', () => {
  it('refuses to cut parts loose or remove the last hull', () => {
    const parts = dinghy();
    // Removing the bow row one by one: the first is fine, the second would drop the gun mount.
    const first = parts.findIndex((p) => p.part === 'hull_wood' && p.x === 0 && p.z === 2);
    expect(canRemove(parts, first).ok).toBe(true);
    const next = parts.filter((_, i) => i !== first);
    const second = next.findIndex((p) => p.part === 'hull_wood' && p.x === 1 && p.z === 2);
    expect(canRemove(next, second).reason).toMatch(/cut loose/);
    expect(canRemove([{ part: 'hull_wood', x: 0, y: 0, z: 0 }], 0).reason).toMatch(/at least one hull/);
  });

  it('refunds half, less when damaged', () => {
    expect(refund({ part: 'hull_wood', x: 0, y: 0, z: 0 })).toEqual({ wood: 3, metal: 0 });
    expect(refund({ part: 'hull_wood', x: 0, y: 0, z: 0, hp: 30 })).toEqual({ wood: 1, metal: 0 });
  });
});

describe('design summary', () => {
  it('matches the dinghy', () => {
    const s = summarize(dinghy());
    expect(s.guns).toBe(1);
    expect(s.berths).toBe(2);
    expect(s.floats).toBe(true);
    expect(s.speed).toBeGreaterThan(10);
    expect(s.speed).toBeLessThan(20);
  });

  it('adds berths and fishing from new parts', () => {
    const s = summarize([...dinghy(), { part: 'bunk_cabin', x: 0, y: 1, z: 1 }, { part: 'net_crane', x: 1, y: 1, z: 1 }]);
    expect(s.berths).toBe(4);
    expect(s.fishing).toBeCloseTo(0.5);
  });

  it('top speed balances thrust and drag', () => {
    const v = topSpeed(4200, 6);
    expect(6 * 6 * v * v + 45 * 6 * v).toBeCloseTo(4200, 3);
  });
});
