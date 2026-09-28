import { describe, expect, it } from 'vitest';
import { buildWeapon, recipeCost, autoName, BASES, type GunRecipe } from '../src/weapons/workshop';
import { getWeapon, registerWeapon, unregisterWeapon } from '../src/weapons/weaponDefs';

const base: GunRecipe = { name: '', base: 'mg', barrel: 'standard', receiver: 'standard', ammo: 'ball', cooling: 'jacket' };

describe('gun workshop', () => {
  it('a long barrel is more accurate and reaches further', () => {
    const std = buildWeapon(base, 'a');
    const long = buildWeapon({ ...base, barrel: 'long' }, 'b');
    expect(long.spread).toBeLessThan(std.spread);
    expect(long.range).toBeGreaterThan(std.range);
    expect(long.traverseSpeed).toBeLessThan(std.traverseSpeed);
  });

  it('heavy receivers trade rate of fire for damage', () => {
    const heavy = buildWeapon({ ...base, receiver: 'heavy' }, 'c');
    expect(heavy.damage).toBeGreaterThan(BASES.mg.def.damage);
    expect(heavy.fireInterval).toBeGreaterThan(BASES.mg.def.fireInterval);
  });

  it('ammo types change penetration, fire and splash', () => {
    expect(buildWeapon({ ...base, ammo: 'ap' }, 'd').penetration).toBeGreaterThan(BASES.mg.def.penetration);
    expect(buildWeapon({ ...base, ammo: 'incendiary' }, 'e').incendiary).toBeGreaterThan(0);
    expect(buildWeapon({ ...base, ammo: 'explosive' }, 'f').splashRadius).toBeGreaterThan(0);
    const heShell = buildWeapon({ ...base, base: 'cannon', ammo: 'explosive' }, 'g');
    expect(heShell.splashRadius).toBeGreaterThan(BASES.cannon.def.splashRadius);
  });

  it('cooling only matters on machine guns', () => {
    const a = buildWeapon({ ...base, base: 'cannon', cooling: 'none' }, 'h');
    const b = buildWeapon({ ...base, base: 'cannon', cooling: 'finned' }, 'i');
    expect(a.coolRate).toBe(b.coolRate);
    expect(recipeCost({ ...base, base: 'cannon', cooling: 'none' })).toEqual(recipeCost({ ...base, base: 'cannon', cooling: 'finned' }));
  });

  it('names and registers designs', () => {
    expect(autoName({ ...base, barrel: 'long', receiver: 'heavy', ammo: 'ap' })).toBe('Long Heavy MG (AP)');
    const w = buildWeapon({ ...base, name: 'Rust Buster' }, 'custom_test');
    expect(w.name).toBe('Rust Buster');
    registerWeapon(w);
    expect(getWeapon('custom_test')).toBe(w);
    unregisterWeapon('custom_test');
    expect(getWeapon('custom_test').id).toBe('mg_old');
  });
});
