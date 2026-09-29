/**
 * A thin tube through a list of points, updated in place every frame with no
 * allocations (replaces rebuilding a TubeGeometry per frame).
 */

import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Mesh, Vector3, type Material } from 'three';

const _t = new Vector3();
const _n = new Vector3();
const _b = new Vector3();
const _up = new Vector3(0, 1, 0);
const _side = new Vector3(1, 0, 0);

export class Rope extends Mesh {
  readonly points: Vector3[];
  private readonly sides: number;
  private readonly radius: number;
  private readonly pos: Float32Array;
  private readonly nrm: Float32Array;

  constructor(material: Material, count = 15, radius = 0.03, sides = 4) {
    const geo = new BufferGeometry();
    const pos = new Float32Array(count * sides * 3);
    const nrm = new Float32Array(count * sides * 3);
    geo.setAttribute('position', new BufferAttribute(pos, 3).setUsage(DynamicDrawUsage));
    geo.setAttribute('normal', new BufferAttribute(nrm, 3).setUsage(DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < count - 1; i++) {
      for (let s = 0; s < sides; s++) {
        const a = i * sides + s;
        const b = i * sides + ((s + 1) % sides);
        const c = a + sides;
        const d = b + sides;
        idx.push(a, c, b, b, c, d);
      }
    }
    geo.setIndex(idx);
    super(geo, material);
    this.points = Array.from({ length: count }, () => new Vector3());
    this.sides = sides;
    this.radius = radius;
    this.pos = pos;
    this.nrm = nrm;
    this.frustumCulled = false;
  }

  /** Rebuild the tube around `points` (edit them first). */
  refresh(): void {
    const n = this.points.length;
    for (let i = 0; i < n; i++) {
      const p = this.points[i];
      _t.subVectors(this.points[Math.min(n - 1, i + 1)], this.points[Math.max(0, i - 1)]);
      if (_t.lengthSq() < 1e-8) _t.set(0, 0, 1);
      _t.normalize();
      _n.crossVectors(_t, Math.abs(_t.y) > 0.95 ? _side : _up).normalize();
      _b.crossVectors(_t, _n);
      for (let s = 0; s < this.sides; s++) {
        const a = (s / this.sides) * Math.PI * 2;
        const c = Math.cos(a);
        const sn = Math.sin(a);
        const k = (i * this.sides + s) * 3;
        const nx = _n.x * c + _b.x * sn;
        const ny = _n.y * c + _b.y * sn;
        const nz = _n.z * c + _b.z * sn;
        this.nrm[k] = nx;
        this.nrm[k + 1] = ny;
        this.nrm[k + 2] = nz;
        this.pos[k] = p.x + nx * this.radius;
        this.pos[k + 1] = p.y + ny * this.radius;
        this.pos[k + 2] = p.z + nz * this.radius;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.normal.needsUpdate = true;
  }
}
