/**
 * A boat's wake: a ribbon of foam trailing from the stern that widens and
 * fades with age (Kelvin-wake arms at the edges, churned prop wash in the
 * middle). Rendered into the FoamMap, so it follows the waves exactly.
 */

import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Mesh } from 'three';
import type { FoamMap } from './FoamMap';

interface WakePoint {
  x: number;
  z: number;
  px: number;
  pz: number;
  t: number;
  width: number;
  spread: number;
  strength: number;
}

const MAX = 110;
const LIFETIME = 10;

export class Wake {
  private readonly points: WakePoint[] = [];
  private readonly geo = new BufferGeometry();
  private readonly pos = new Float32Array(MAX * 2 * 3);
  private readonly data = new Float32Array(MAX * 2 * 4);
  readonly mesh: Mesh;
  private lastEmit = -1;

  constructor(private readonly foam: FoamMap) {
    const posAttr = new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage);
    const dataAttr = new BufferAttribute(this.data, 4).setUsage(DynamicDrawUsage);
    this.geo.setAttribute('position', posAttr);
    this.geo.setAttribute('aData', dataAttr);
    const idx: number[] = [];
    for (let i = 0; i < MAX - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo.setIndex(idx);
    this.mesh = new Mesh(this.geo, foam.wakeMaterial);
    this.mesh.frustumCulled = false;
    foam.scene.add(this.mesh);
  }

  /**
   * @param x,z stern position
   * @param heading boat yaw
   * @param speed forward speed m/s
   */
  update(now: number, x: number, z: number, heading: number, speed: number, halfWidth: number, active: boolean): void {
    const strength = active ? Math.min(1, Math.max(0, (Math.abs(speed) - 0.4) / 7)) : 0;
    if (now - this.lastEmit > 0.1) {
      this.lastEmit = now;
      if (strength > 0.02) {
        this.points.unshift({
          x,
          z,
          px: Math.cos(heading),
          pz: -Math.sin(heading),
          t: now,
          width: halfWidth * 0.9,
          spread: 0.25 + Math.min(2.2, Math.abs(speed) * 0.22),
          strength,
        });
      } else if (this.points.length && this.points[0].strength > 0) {
        // break the ribbon when the boat stops
        this.points.unshift({ ...this.points[0], x, z, t: now, strength: 0 });
      }
    }
    while (this.points.length > MAX || (this.points.length && now - this.points[this.points.length - 1].t > LIFETIME)) this.points.pop();

    // Pin the newest point to the live stern position so the ribbon doesn't lag.
    if (this.points.length && strength > 0.02) {
      const p = this.points[0];
      p.x = x;
      p.z = z;
    }

    const n = this.points.length;
    for (let i = 0; i < n; i++) {
      const p = this.points[i];
      const age = Math.min(1, (now - p.t) / LIFETIME);
      const w = p.width + (now - p.t) * p.spread;
      const o = i * 6;
      this.pos[o] = p.x - p.px * w;
      this.pos[o + 1] = 0;
      this.pos[o + 2] = p.z - p.pz * w;
      this.pos[o + 3] = p.x + p.px * w;
      this.pos[o + 4] = 0;
      this.pos[o + 5] = p.z + p.pz * w;
      const d = i * 8;
      this.data.set([-1, age, p.strength, 0, 1, age, p.strength, 0], d);
    }
    // Collapse unused vertices.
    for (let i = n; i < MAX; i++) {
      this.pos.fill(0, i * 6, i * 6 + 6);
      this.data.fill(0, i * 8, i * 8 + 8);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aData.needsUpdate = true;
    this.geo.setDrawRange(0, Math.max(0, n - 1) * 6);
  }

  dispose(): void {
    this.foam.scene.remove(this.mesh);
    this.geo.dispose();
  }
}
