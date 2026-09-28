/** Pure segment-vs-part hit tests in boat-local space. */

import type { PartInstance } from './BoatStats';

export interface Seg {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
}

/**
 * Slab test of segment a→b against an axis-aligned box. Returns the entry
 * parameter t in [0, 1] or -1 when missed.
 */
export function segmentBox(s: Seg, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): number {
  let tmin = 0;
  let tmax = 1;
  const o = [s.ax, s.ay, s.az];
  const d = [s.bx - s.ax, s.by - s.ay, s.bz - s.az];
  const mn = [minX, minY, minZ];
  const mx = [maxX, maxY, maxZ];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mn[i] || o[i] > mx[i]) return -1;
    } else {
      const inv = 1 / d[i];
      let t1 = (mn[i] - o[i]) * inv;
      let t2 = (mx[i] - o[i]) * inv;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

export interface PartHit {
  part: PartInstance;
  t: number;
}

/** First living part hit by the (boat-local) segment, or null. */
export function hitParts(parts: PartInstance[], s: Seg, half = 0.5): PartHit | null {
  let best: PartHit | null = null;
  for (const p of parts) {
    if (!p.alive) continue;
    const t = segmentBox(s, p.x - half, p.y - half, p.z - half, p.x + half, p.y + half, p.z + half);
    if (t >= 0 && (!best || t < best.t)) best = { part: p, t };
  }
  return best;
}
