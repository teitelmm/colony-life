import { describe, expect, it } from 'vitest';
import { WAVES, displace, maxAmplitude, sampleHeight, sampleNormal } from '../src/world/waves';

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

  it('produces unit, upward normals', () => {
    const n = sampleNormal(1, 2, 3, { x: 0, y: 0, z: 0 });
    expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 6);
    expect(n.y).toBeGreaterThan(0.5);
  });
});
