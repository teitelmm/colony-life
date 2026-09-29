/**
 * Static-geometry batching: bake every mesh under `root` into one mesh per
 * material (transforms applied), so a cluster of props costs one draw call
 * per material instead of one per piece. Only for things that never move
 * relative to `root` again.
 */

import { Mesh, Matrix4, type BufferGeometry, type Material, type Object3D } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _inv = new Matrix4();
const _m = new Matrix4();

export function mergeByMaterial(root: Object3D, opts: { castShadow?: (mat: Material) => boolean } = {}): number {
  root.updateMatrixWorld(true);
  _inv.copy(root.matrixWorld).invert();
  const buckets = new Map<Material, { geos: BufferGeometry[]; meshes: Mesh[] }>();
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || Array.isArray(m.material)) return;
    const mat = m.material as Material;
    const b = buckets.get(mat) ?? { geos: [], meshes: [] };
    _m.multiplyMatrices(_inv, m.matrixWorld);
    const g = m.geometry.clone().applyMatrix4(_m);
    // mergeGeometries needs matching attribute sets.
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    b.geos.push(g);
    b.meshes.push(m);
    buckets.set(mat, b);
  });

  let saved = 0;
  for (const [mat, b] of buckets) {
    if (b.meshes.length < 2) {
      b.geos.forEach((g) => g.dispose());
      continue;
    }
    const merged = mergeGeometries(b.geos, false);
    b.geos.forEach((g) => g.dispose());
    if (!merged) continue;
    for (const m of b.meshes) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    const out = new Mesh(merged, mat);
    out.castShadow = opts.castShadow ? opts.castShadow(mat) : true;
    out.receiveShadow = true;
    root.add(out);
    saved += b.meshes.length - 1;
  }
  // Drop now-empty helper groups.
  const empty: Object3D[] = [];
  root.traverse((o) => {
    if (o !== root && !(o as Mesh).isMesh && o.children.length === 0) empty.push(o);
  });
  empty.forEach((o) => o.removeFromParent());
  return saved;
}

/**
 * Merge only the direct child meshes of `group` that share a material,
 * leaving nested groups (pivots, animated parts) and `skip` untouched.
 */
export function mergeChildren(group: Object3D, skip: Object3D[] = []): void {
  const byMat = new Map<Material, Mesh[]>();
  for (const child of group.children) {
    const m = child as Mesh;
    if (!m.isMesh || skip.includes(m) || m.children.length || Array.isArray(m.material)) continue;
    const list = byMat.get(m.material as Material) ?? [];
    list.push(m);
    byMat.set(m.material as Material, list);
  }
  for (const [mat, list] of byMat) {
    if (list.length < 2) continue;
    const geos = list.map((m) => {
      m.updateMatrix();
      return m.geometry.clone().applyMatrix4(m.matrix);
    });
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const cast = list.some((m) => m.castShadow);
    for (const m of list) {
      group.remove(m);
      m.geometry.dispose();
    }
    const out = new Mesh(merged, mat);
    out.castShadow = cast;
    out.receiveShadow = true;
    group.add(out);
  }
}
