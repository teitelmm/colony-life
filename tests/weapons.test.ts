import { describe, expect, it } from 'vitest';
import { ballisticPosition, leadTarget, maxRange, solveLaunchAngle } from '../src/weapons/ballistics';
import { WeaponState } from '../src/weapons/WeaponState';
import { WEAPONS } from '../src/weapons/weaponDefs';
import { waveComposition, ENEMY_TYPES } from '../src/game/WaveManager';

describe('ballistics', () => {
  it('solves a launch angle that lands on the target', () => {
    const v = 72;
    const g = 9.81;
    for (const [dist, dh] of [
      [40, 0],
      [90, -1.5],
      [20, 2],
    ]) {
      const a = solveLaunchAngle(dist, dh, v, g)!;
      expect(a).not.toBeNull();
      const t = dist / (v * Math.cos(a));
      const p = ballisticPosition({ x: 0, y: 0, z: 0 }, { x: v * Math.cos(a), y: v * Math.sin(a), z: 0 }, g, t, { x: 0, y: 0, z: 0 });
      expect(p.x).toBeCloseTo(dist, 3);
      expect(p.y).toBeCloseTo(dh, 3);
    }
  });

  it('returns null beyond max range', () => {
    expect(solveLaunchAngle(maxRange(50, 9.81) + 5, 0, 50, 9.81)).toBeNull();
  });

  it('leads a moving target', () => {
    const aim = leadTarget({ x: 0, y: 0, z: 0 }, { x: 50, y: 0, z: 0 }, { x: 0, y: 0, z: 5 }, 100, 9.81);
    expect(aim.z).toBeGreaterThan(2);
    expect(aim.z).toBeLessThan(4);
  });
});

describe('WeaponState', () => {
  it('respects fire interval', () => {
    const w = new WeaponState(WEAPONS.cannon);
    expect(w.fire()).toBe(true);
    expect(w.fire()).toBe(false);
    w.update(WEAPONS.cannon.fireInterval + 0.01);
    expect(w.fire()).toBe(true);
  });

  it('overheats after sustained fire and recovers when cool', () => {
    const def = WEAPONS.mg_old;
    const w = new WeaponState(def);
    let shots = 0;
    while (!w.overheated && shots < 1000) {
      w.jamTimer = 0;
      if (w.fire(() => 1)) shots++;
      w.update(def.fireInterval);
    }
    expect(w.overheated).toBe(true);
    expect(w.canFire()).toBe(false);
    for (let i = 0; i < 100; i++) w.update(0.1);
    expect(w.overheated).toBe(false);
    expect(w.canFire()).toBe(true);
  });

  it('jams the old MG when unlucky, never the new one', () => {
    const old = new WeaponState(WEAPONS.mg_old);
    old.fire(() => 0);
    expect(old.jammed).toBe(true);
    const mk2 = new WeaponState(WEAPONS.mg_new);
    mk2.fire(() => 0);
    expect(mk2.jammed).toBe(false);
  });

  it('marks tracer rounds', () => {
    const w = new WeaponState(WEAPONS.mg_new);
    const tracers: boolean[] = [];
    for (let i = 0; i < 8; i++) {
      w.fire(() => 1);
      tracers.push(w.isTracer());
      w.update(1);
    }
    expect(tracers.filter(Boolean).length).toBe(2);
  });
});

describe('waves of enemies', () => {
  it('escalates', () => {
    const cost = (n: number) => waveComposition(n, () => 0.5).reduce((s, k) => s + ENEMY_TYPES[k].cost, 0);
    expect(cost(1)).toBeLessThan(cost(5));
    expect(cost(8)).toBeGreaterThanOrEqual(cost(7));
    expect(waveComposition(20).length).toBeLessThanOrEqual(7);
  });
});
