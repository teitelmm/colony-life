/**
 * Builds the visual for each part of a boat. Parts are separate groups so
 * they can be charred, knocked off and (later) rebuilt individually.
 */

import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
  type BufferGeometry,
} from 'three';
import { mergeChildren } from '../render/merge';
import { DECK_TOP, type BoatDesign } from './parts';
import type { PartInstance } from './BoatStats';
import { deckTexture, hullSideTexture, rustyMetalTexture, tarpTexture } from '../render/textures';

/** For parts sitting on the deck (y = 1 layer), local y of the deck. */
export const DECK_LOCAL = DECK_TOP - 1;

export interface PartVisual {
  group: Group;
  materials: MeshStandardMaterial[];
  baseColors: Color[];
  /** where the turret pivot sits (mounts) */
  pivot?: Object3D;
  /** where exhaust smoke comes out (engines) */
  exhaust?: Object3D;
  /** propeller wash point (engines) */
  prop?: Object3D;
  /** flag cloth to animate */
  flag?: Mesh;
  /** stove chimney (bunk cabins) */
  chimney?: Object3D;
  /** swinging net (cranes) */
  net?: Object3D;
}

interface Ctx {
  design: BoatDesign;
  parts: PartInstance[];
  centerX: number;
  metalHull: boolean;
}

function has(parts: PartInstance[], x: number, y: number, z: number): boolean {
  return parts.some((p) => p.def.kind === 'hull' && Math.abs(p.x - x) < 0.01 && Math.abs(p.y - y) < 0.01 && Math.abs(p.z - z) < 0.01);
}

function add(g: Group, geo: BufferGeometry, mat: MeshStandardMaterial | MeshStandardMaterial[], x = 0, y = 0, z = 0): Mesh {
  const m = new Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}

function std(color: number, opts: Partial<MeshStandardMaterial> = {}): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.1, ...opts });
}

export function buildPartVisual(part: PartInstance, ctx: Ctx): PartVisual {
  const group = new Group();
  group.position.set(part.x, part.y, part.z);
  const materials: MeshStandardMaterial[] = [];
  const track = <T extends MeshStandardMaterial>(m: T): T => {
    materials.push(m);
    return m;
  };
  const visual: PartVisual = { group, materials, baseColors: [] };
  const { design } = ctx;
  const metal = part.def.material === 'metal';

  switch (part.def.kind) {
    case 'hull': {
      const side = track(std(0xffffff, { map: hullSideTexture(design.paint, design.trim, metal), roughness: metal ? 0.6 : 0.85, metalness: metal ? 0.35 : 0.05 }));
      const deck = track(std(0xffffff, { map: deckTexture(metal), roughness: 0.9 }));
      const bottom = track(std(0x3a2420));
      const front = !has(ctx.parts, part.x, part.y, part.z + 1);
      const h = DECK_TOP + 0.5;
      const geo = new BoxGeometry(1, h, 1, 2, 1, 2);
      geo.translate(0, (DECK_TOP - 0.5) / 2, 0);
      if (front) {
        // Taper the bow toward the boat's centreline and rake the stem.
        const pos = geo.attributes.position;
        const cx = ctx.centerX - part.x;
        for (let i = 0; i < pos.count; i++) {
          const z = pos.getZ(i);
          const y = pos.getY(i);
          if (z > 0.1) {
            const t = z > 0.45 ? 0.8 : 0.3;
            pos.setX(i, pos.getX(i) + (cx - pos.getX(i)) * t);
            if (y < 0) pos.setZ(i, z - (z > 0.45 ? 0.45 : 0.1));
            else pos.setY(i, y + (z > 0.45 ? 0.12 : 0.05));
          }
        }
        geo.computeVertexNormals();
      }
      add(group, geo, [side, side, deck, bottom, side, side]);

      if (!front) {
        const trim = track(std(design.trim, { roughness: 0.7 }));
        const rail = (x: number, z: number, w: number, d: number) => add(group, new BoxGeometry(w, 0.16, d), trim, x, DECK_TOP + 0.08, z);
        if (!has(ctx.parts, part.x - 1, part.y, part.z)) rail(-0.46, 0, 0.08, 1);
        if (!has(ctx.parts, part.x + 1, part.y, part.z)) rail(0.46, 0, 0.08, 1);
        if (!has(ctx.parts, part.x, part.y, part.z - 1)) rail(0, -0.46, 1, 0.08);
      }
      break;
    }

    case 'armor': {
      const plate = track(std(0x5a6260, { map: rustyMetalTexture(0x5a6260), roughness: 0.55, metalness: 0.6 }));
      const outward = Math.sign(part.x - ctx.centerX) || 1;
      const m = add(group, new BoxGeometry(0.22, 0.85, 1.0), plate, outward * 0.38, DECK_LOCAL + 0.42, 0);
      m.rotation.z = -outward * 0.18;
      const bags = track(std(0xa89468, { map: tarpTexture(0xa89468), roughness: 1 }));
      for (let i = 0; i < 3; i++) {
        const b = add(group, new SphereGeometry(0.2, 7, 5), bags, outward * 0.12, DECK_LOCAL + 0.13, -0.32 + i * 0.32);
        b.scale.set(1, 0.55, 1.3);
      }
      break;
    }

    case 'engine': {
      if (part.def.id === 'engine_outboard') {
        const body = track(std(design.trim, { roughness: 0.4, metalness: 0.3 }));
        const dark = track(std(0x222426, { roughness: 0.5, metalness: 0.6 }));
        add(group, new BoxGeometry(0.34, 0.45, 0.42), body, 0, DECK_LOCAL + 0.1, -0.62);
        add(group, new BoxGeometry(0.36, 0.1, 0.44), dark, 0, DECK_LOCAL + 0.36, -0.62);
        add(group, new CylinderGeometry(0.05, 0.05, 0.75, 6), dark, 0, DECK_LOCAL - 0.45, -0.66);
        add(group, new BoxGeometry(0.12, 0.12, 0.3), dark, 0, DECK_LOCAL - 0.85, -0.66);
        add(group, new BoxGeometry(0.06, 0.06, 0.55), dark, 0, DECK_LOCAL + 0.1, -0.2);
        visual.exhaust = new Object3D();
        visual.exhaust.position.set(0, DECK_LOCAL + 0.3, -0.85);
        visual.prop = new Object3D();
        visual.prop.position.set(0, DECK_LOCAL - 0.9, -0.75);
      } else {
        const block = track(std(0x3d4447, { map: rustyMetalTexture(0x3d4447), roughness: 0.6, metalness: 0.5 }));
        const accent = track(std(design.trim, { roughness: 0.6 }));
        const pipe = track(std(0x1c1c1c, { roughness: 0.7, metalness: 0.4 }));
        add(group, new BoxGeometry(0.8, 0.5, 0.8), block, 0, DECK_LOCAL + 0.25, 0);
        add(group, new BoxGeometry(0.7, 0.12, 0.6), accent, 0, DECK_LOCAL + 0.56, 0.05);
        for (let i = 0; i < 3; i++) add(group, new BoxGeometry(0.1, 0.08, 0.12), pipe, -0.2 + i * 0.2, DECK_LOCAL + 0.66, 0.05);
        add(group, new CylinderGeometry(0.08, 0.09, 1.1, 8), pipe, 0.28, DECK_LOCAL + 0.9, -0.25);
        visual.exhaust = new Object3D();
        visual.exhaust.position.set(0.28, DECK_LOCAL + 1.5, -0.25);
        visual.prop = new Object3D();
        visual.prop.position.set(0, -1.1, -0.6);
      }
      group.add(visual.exhaust, visual.prop);
      break;
    }

    case 'mount': {
      const heavy = part.def.id === 'mount_heavy';
      const base = track(std(0x3b4043, { map: rustyMetalTexture(0x3b4043), roughness: 0.6, metalness: 0.5 }));
      const ring = track(std(design.trim, { roughness: 0.6 }));
      if (heavy) {
        add(group, new CylinderGeometry(0.62, 0.7, 0.2, 10), base, 0, DECK_LOCAL + 0.1, 0);
        add(group, new CylinderGeometry(0.66, 0.66, 0.05, 10), ring, 0, DECK_LOCAL + 0.22, 0);
      } else {
        add(group, new CylinderGeometry(0.2, 0.28, 0.35, 8), base, 0, DECK_LOCAL + 0.17, 0);
        add(group, new CylinderGeometry(0.24, 0.24, 0.05, 8), ring, 0, DECK_LOCAL + 0.35, 0);
      }
      visual.pivot = new Object3D();
      visual.pivot.position.set(0, DECK_LOCAL + (heavy ? 0.22 : 0.37), 0);
      group.add(visual.pivot);
      break;
    }

    case 'cabin': {
      const walls = track(std(0xffffff, { map: hullSideTexture(design.trim, design.paint, false), roughness: 0.85 }));
      const roof = track(std(0x4a4640, { map: tarpTexture(0x4a4640) }));
      const glass = track(std(0x1a2a33, { roughness: 0.1, metalness: 0.6, emissive: new Color(0x0b1418) }));
      add(group, new BoxGeometry(0.9, 0.85, 0.85), walls, 0, DECK_LOCAL + 0.43, 0);
      add(group, new BoxGeometry(1.05, 0.08, 1.0), roof, 0, DECK_LOCAL + 0.9, 0);
      add(group, new BoxGeometry(0.7, 0.22, 0.02), glass, 0, DECK_LOCAL + 0.62, 0.43);
      add(group, new BoxGeometry(0.02, 0.22, 0.5), glass, 0.46, DECK_LOCAL + 0.62, 0.05);
      add(group, new BoxGeometry(0.02, 0.22, 0.5), glass, -0.46, DECK_LOCAL + 0.62, 0.05);
      const pole = track(std(0x2b2b2b, { metalness: 0.5 }));
      add(group, new CylinderGeometry(0.02, 0.025, 1.3, 5), pole, 0.3, DECK_LOCAL + 1.55, -0.3);
      const cloth = track(std(design.paint, { side: DoubleSide, roughness: 1 }));
      const flagGeo = new PlaneGeometry(0.6, 0.35, 6, 1);
      flagGeo.translate(0.3, 0, 0);
      const flag = add(group, flagGeo, cloth, 0.3, DECK_LOCAL + 2.0, -0.3);
      flag.rotation.y = Math.PI / 2;
      flag.castShadow = false;
      visual.flag = flag;
      break;
    }

    case 'quarters': {
      const walls = track(std(0xffffff, { map: deckTexture(false), roughness: 0.9 }));
      const roof = track(std(design.paint, { map: tarpTexture(design.paint), roughness: 0.95 }));
      const dark = track(std(0x1c2226, { roughness: 0.3, metalness: 0.5 }));
      const brass = track(std(0xb08a3e, { roughness: 0.4, metalness: 0.8 }));
      add(group, new BoxGeometry(0.92, 0.62, 0.9), walls, 0, DECK_LOCAL + 0.31, 0);
      // Pitched tarp roof.
      const r1 = add(group, new BoxGeometry(0.56, 0.05, 0.98), roof, -0.22, DECK_LOCAL + 0.72, 0);
      r1.rotation.z = 0.5;
      const r2 = add(group, new BoxGeometry(0.56, 0.05, 0.98), roof, 0.22, DECK_LOCAL + 0.72, 0);
      r2.rotation.z = -0.5;
      for (const sx of [-0.47, 0.47]) {
        const port = add(group, new CylinderGeometry(0.1, 0.1, 0.04, 10), brass, sx, DECK_LOCAL + 0.38, 0);
        port.rotation.z = Math.PI / 2;
        const glass = add(group, new CylinderGeometry(0.07, 0.07, 0.05, 10), dark, sx, DECK_LOCAL + 0.38, 0);
        glass.rotation.z = Math.PI / 2;
      }
      add(group, new BoxGeometry(0.3, 0.46, 0.03), dark, 0, DECK_LOCAL + 0.23, 0.46);
      add(group, new CylinderGeometry(0.04, 0.05, 0.5, 6), dark, 0.25, DECK_LOCAL + 0.95, -0.25);
      visual.chimney = new Object3D();
      visual.chimney.position.set(0.25, DECK_LOCAL + 1.22, -0.25);
      group.add(visual.chimney);
      break;
    }

    case 'crane': {
      const wood = track(std(0x7a5534, { roughness: 0.9 }));
      const iron = track(std(0x2e3336, { roughness: 0.5, metalness: 0.6 }));
      add(group, new CylinderGeometry(0.07, 0.09, 1.4, 6), wood, 0, DECK_LOCAL + 0.7, 0);
      add(group, new CylinderGeometry(0.16, 0.2, 0.12, 8), iron, 0, DECK_LOCAL + 0.06, 0);
      const boom = new Group();
      boom.position.set(0, DECK_LOCAL + 1.25, 0);
      const arm = add(boom, new BoxGeometry(0.07, 0.07, 1.4), wood, 0, 0, 0.6);
      arm.rotation.x = -0.25;
      const netMat = track(std(0x9a8a62, { roughness: 1, wireframe: true }));
      const net = new Group();
      net.position.set(0, -0.1, 1.25);
      add(net, new CylinderGeometry(0.01, 0.01, 0.8, 3), iron, 0, -0.4, 0);
      const bag = add(net, new SphereGeometry(0.28, 8, 6), netMat, 0, -0.9, 0);
      bag.scale.y = 1.3;
      bag.castShadow = false;
      boom.add(net);
      group.add(boom);
      visual.net = boom;
      break;
    }
  }

  // Batch this block's static pieces (the flag waves, so it stays separate).
  mergeChildren(group, visual.flag ? [visual.flag] : []);
  visual.baseColors = materials.map((m) => m.color.clone());
  return visual;
}

const CHAR = new Color(0x141110);

/** Darken a part's materials as it takes damage. */
export function applyDamageTint(v: PartVisual, hpFrac: number): void {
  const t = Math.pow(1 - hpFrac, 1.6) * 0.8;
  v.materials.forEach((m, i) => m.color.copy(v.baseColors[i]).lerp(CHAR, t));
}

export function buildPartContext(design: BoatDesign, parts: PartInstance[]): Ctx {
  const hullXs = parts.filter((p) => p.def.kind === 'hull').map((p) => p.x);
  const centerX = (Math.min(...hullXs) + Math.max(...hullXs)) / 2;
  return { design, parts, centerX, metalHull: parts.some((p) => p.def.id === 'hull_metal') };
}
