import { describe, expect, it } from 'vitest';
import { MIN_SCALE, QualityGovernor } from '../src/render/Quality';

/** Feed `seconds` of frames at a fixed frame time; collect every change. */
function run(q: QualityGovernor, frameMs: number, seconds: number) {
  const changes = [];
  const dt = frameMs / 1000;
  for (let t = 0; t < seconds; t += dt) {
    const c = q.sample(dt);
    if (c) changes.push(c);
  }
  return changes;
}

describe('quality governor', () => {
  it('holds steady at 60 fps on medium', () => {
    const q = new QualityGovernor();
    expect(run(q, 16.7, 20)).toEqual([]);
    expect(q.tier).toBe('medium');
  });

  it('sheds resolution, then a tier, when frames are slow', () => {
    const q = new QualityGovernor();
    const c = run(q, 40, 30);
    expect(c.length).toBeGreaterThan(3);
    expect(c[0]).toEqual({ tier: 'medium', scale: 0.9 });
    expect(q.tier).toBe('low');
    expect(q.scale).toBeGreaterThanOrEqual(MIN_SCALE);
  });

  it('adds quality back when there is headroom', () => {
    const q = new QualityGovernor();
    run(q, 40, 12);
    const before = q.scale;
    run(q, 8, 60);
    expect(q.scale).toBeGreaterThanOrEqual(before);
    expect(q.tier).toBe('high');
  });

  it('never changes a manually chosen tier', () => {
    const q = new QualityGovernor('high');
    expect(run(q, 50, 20)).toEqual([]);
    expect(q.tier).toBe('high');
    expect(q.scale).toBe(1);
  });
});
