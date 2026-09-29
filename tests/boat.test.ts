import { describe, expect, it } from 'vitest';
import { DESIGNS } from '../src/boat/designs';
import { computeStats, findDetached, isWrecked, touching } from '../src/boat/BoatStats';
import { BoatBody, applyWaterForces, type WaterSampler } from '../src/boat/BoatPhysics';
import { instantiate } from './helpers';
import { DECK_TOP } from '../src/boat/parts';
import { Vector3 } from 'three';

const flat: WaterSampler = { height: () => 0 };

function simulate(parts: ReturnType<typeof instantiate>, seconds: number, throttle = 0) {
  const body = new BoatBody();
  const stats = computeStats(parts);
  body.setMassProperties(stats);
  for (let i = 0; i < seconds * 60; i++) {
    applyWaterForces(body, parts, stats, { throttle, rudder: 0 }, flat);
    body.integrate(1 / 60);
  }
  return body;
}

describe('boat stats', () => {
  it('recomputes mass and thrust when a part is destroyed', () => {
    const parts = instantiate(DESIGNS.dinghy());
    const before = computeStats(parts);
    const engine = parts.find((p) => p.def.kind === 'engine')!;
    engine.alive = false;
    const after = computeStats(parts);
    expect(after.thrust).toBe(0);
    expect(after.mass).toBeCloseTo(before.mass - engine.def.mass);
    expect(after.com.z).toBeGreaterThan(before.com.z);
  });

  it('every design is structurally connected and fully buoyant', () => {
    for (const make of Object.values(DESIGNS)) {
      const parts = instantiate(make());
      expect(findDetached(parts)).toEqual([]);
      const s = computeStats(parts);
      expect(s.buoyancy * 1000).toBeGreaterThan(s.mass * 1.4);
    }
  });

  it('detaches parts that lose their only support', () => {
    const parts = instantiate(DESIGNS.dinghy());
    // Mount sits over the two bow cells; destroy both.
    for (const p of parts) if (p.def.kind === 'hull' && p.z === 2) p.alive = false;
    const detached = findDetached(parts);
    const mount = parts.find((p) => p.def.kind === 'mount')!;
    expect(detached).toContain(mount.index);
  });

  it('treats face contact (including half offsets) as attached', () => {
    expect(touching({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBe(true);
    expect(touching({ x: 0, y: 0, z: 0 }, { x: 0.5, y: 1, z: 0 })).toBe(true);
    expect(touching({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 })).toBe(false);
  });
});

describe('boat physics', () => {
  it('floats upright at a sensible waterline', () => {
    const body = simulate(instantiate(DESIGNS.dinghy()), 8);
    expect(body.origin.y).toBeGreaterThan(-0.4);
    expect(body.origin.y).toBeLessThan(0.4);
    const up = { x: 0, y: 1, z: 0 };
    const q = body.quat;
    // y component of the rotated up vector
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    expect(upY * up.y).toBeGreaterThan(0.98);
  });

  it('rights itself after being knocked on its side', () => {
    const parts = instantiate(DESIGNS.dinghy());
    const body = new BoatBody();
    const stats = computeStats(parts);
    body.setMassProperties(stats);
    body.quat.setFromAxisAngle(new Vector3(0, 0, 1), 1.4);
    for (let i = 0; i < 60 * 8; i++) {
      applyWaterForces(body, parts, stats, { throttle: 0, rudder: 0 }, flat);
      body.integrate(1 / 60);
    }
    const q = body.quat;
    expect(1 - 2 * (q.x * q.x + q.z * q.z)).toBeGreaterThan(0.95);
  });

  it('moves forward under throttle', () => {
    const body = simulate(instantiate(DESIGNS.dinghy()), 10, 1);
    expect(body.vel.z).toBeGreaterThan(5);
    expect(body.vel.z).toBeLessThan(12);
  });

  it('rides lower as the hull floods', () => {
    const intact = simulate(instantiate(DESIGNS.gunboat()), 8);
    const parts = instantiate(DESIGNS.gunboat());
    for (const p of parts) if (p.def.kind === 'hull' && p.z <= 1) p.hp = 1;
    const holed = simulate(parts, 8);
    expect(holed.origin.y).toBeLessThan(intact.origin.y - 0.05);
  });

  it('counts a badly holed boat as wrecked', () => {
    const parts = instantiate(DESIGNS.dinghy());
    expect(isWrecked(computeStats(parts))).toBe(false);
    for (const p of parts) if (p.def.kind === 'hull' && p.z < 2) p.alive = false;
    expect(isWrecked(computeStats(parts))).toBe(true);
  });

  it('sinks when buoyancy is scuttled', () => {
    const parts = instantiate(DESIGNS.gunboat());
    const body = new BoatBody();
    const stats = computeStats(parts);
    body.setMassProperties(stats);
    body.buoyancyScale = 0.2;
    for (let i = 0; i < 360; i++) {
      applyWaterForces(body, parts, stats, { throttle: 0, rudder: 0 }, flat);
      body.integrate(1 / 60);
    }
    expect(body.origin.y).toBeLessThan(-1.5);
  });
});

describe('riding the swell', () => {
  it.each(['dinghy', 'raider', 'harpooner', 'gunboat', 'barge'] as const)('keeps the %s deck above water in the default sea', async (name) => {
    const { sampleHeight, sampleSurface } = await import('../src/world/waves');
    const parts = instantiate(DESIGNS[name]());
    const body = new BoatBody();
    const stats = computeStats(parts);
    body.setMassProperties(stats);
    let t = 0;
    // Same sampler the game uses.
    const water: WaterSampler = {
      height: (x, z) => sampleHeight(x, z, t),
      surface: (x, z, out) => sampleSurface(x, z, t, out),
    };
    let awash = 0;
    let samples = 0;
    for (let i = 0; i < 60 * 40; i++) {
      t = i / 60;
      applyWaterForces(body, parts, stats, { throttle: 0.6, rudder: 0.2 }, water);
      body.integrate(1 / 60);
      if (i > 60 * 5) {
        // Deck height at the middle of the hull footprint.
        const c = body.localToWorld(new Vector3(stats.centerX, DECK_TOP, stats.centerZ), new Vector3());
        samples++;
        if (c.y - water.height(c.x, c.z) < 0) awash++;
      }
    }
    // Long hulls may briefly bury the odd short crest amidships, but never for long.
    expect(awash / samples).toBeLessThan(0.03);
  });
});
