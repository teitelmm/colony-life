import { describe, expect, it } from 'vitest';
import { WAVES, displace, maxAmplitude, sampleHeight, sampleNormal, sampleSurface, sampleTilt } from '../src/world/waves';

describe('waves', () => {
  it('is deterministic', () => {
    expect(sampleHeight(12.3, -4.5, 7.1)).toBe(sampleHeight(12.3, -4.5, 7.1));
  });

  it('stays within the summed amplitude', () => {
    const bound = maxAmplitude();
    for (let i = 0; i < 500; i++) {
      const h = sampleHeight(Math.sin(i) * 200, Math.cos(i * 1.7) * 200, i * 0.37);
      expect(Math.abs(h)).toBeLessThanOrEqual(bound + 1e-6);
    }
  });

  it('keeps total steepness below 1 so crests never loop', () => {
    expect(WAVES.reduce((s, w) => s + w.steepness, 0)).toBeLessThan(1);
  });

  it('inverts the horizontal Gerstner displacement', () => {
    const out = { x: 0, y: 0, z: 0 };
    // Find the height by brute force: displace a grid point, then sample at where it landed.
    displace(3, 5, 2, out);
    expect(sampleHeight(out.x, out.z, 2)).toBeCloseTo(out.y, 2);
  });

  it('sampleSurface matches sampleHeight and the water particle velocity', () => {
    const s = { height: 0, vy: 0 };
    for (const [x, z, t] of [
      [3, 5, 2],
      [-40, 12, 9.5],
      [77, -31, 21],
    ]) {
      sampleSurface(x, z, t, s);
      expect(s.height).toBeCloseTo(sampleHeight(x, z, t), 6);
      // Vertical velocity of the Gerstner particle that sits at (x, z): finite difference in time.
      const a = { x: 0, y: 0, z: 0 };
      const b = { x: 0, y: 0, z: 0 };
      // find the grid point by inverting once more
      let px = x;
      let pz = z;
      for (let i = 0; i < 6; i++) {
        displace(px, pz, t, a);
        px -= a.x - x;
        pz -= a.z - z;
      }
      displace(px, pz, t - 0.001, a);
      displace(px, pz, t + 0.001, b);
      expect(s.vy).toBeCloseTo((b.y - a.y) / 0.002, 2);
    }
  });

  it('sampleTilt gives an upward unit normal close to sampleNormal', () => {
    const t = { x: 0, y: 0, z: 0 };
    const n = { x: 0, y: 0, z: 0 };
    sampleTilt(10, 4, 3, sampleHeight(10, 4, 3), t);
    sampleNormal(10, 4, 3, n);
    expect(Math.hypot(t.x, t.y, t.z)).toBeCloseTo(1, 6);
    expect(t.x * n.x + t.y * n.y + t.z * n.z).toBeGreaterThan(0.97);
  });

  it('produces unit, upward normals', () => {
    const n = sampleNormal(1, 2, 3, { x: 0, y: 0, z: 0 });
    expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 6);
    expect(n.y).toBeGreaterThan(0.5);
  });
});
