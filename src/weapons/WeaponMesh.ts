/** Low-poly weapon models. Each returns a yaw pivot, pitch pivot and muzzle marker. */

import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  TorusGeometry,
  type Material,
} from 'three';
import type { WeaponDef } from './weaponDefs';
import { rustyMetalTexture } from '../render/textures';
import { mergeChildren } from '../render/merge';

export interface WeaponRig {
  yaw: Group;
  pitch: Group;
  muzzle: Object3D;
  /** harpoon spear shown while loaded */
  loaded?: Object3D;
  /** gunner figure, if any */
  crew?: Group;
}

let mats: Record<string, Material> | null = null;
function M(): Record<string, Material> {
  if (mats) return mats;
  mats = {
    gunmetal: new MeshStandardMaterial({ color: 0x2c3135, roughness: 0.45, metalness: 0.7 }),
    olive: new MeshStandardMaterial({ color: 0x5b6435, roughness: 0.7, metalness: 0.3, map: rustyMetalTexture(0x5b6435) }),
    bronze: new MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.4, metalness: 0.8 }),
    black: new MeshStandardMaterial({ color: 0x151719, roughness: 0.4, metalness: 0.6 }),
    shield: new MeshStandardMaterial({ color: 0x6e7466, roughness: 0.8, metalness: 0.4, map: rustyMetalTexture(0x6e7466) }),
    wood: new MeshStandardMaterial({ color: 0x7a5534, roughness: 0.9 }),
    rope: new MeshStandardMaterial({ color: 0xcdb487, roughness: 1 }),
    steel: new MeshStandardMaterial({ color: 0xb8bec2, roughness: 0.25, metalness: 0.9 }),
    ammo: new MeshStandardMaterial({ color: 0x4d5a2e, roughness: 0.8 }),
    skin: new MeshStandardMaterial({ color: 0xd9a37a, roughness: 0.8 }),
    helmet: new MeshStandardMaterial({ color: 0x4f5a3a, roughness: 0.6, metalness: 0.2 }),
  };
  return mats;
}

function mesh(geo: BoxGeometry | CylinderGeometry | ConeGeometry | SphereGeometry | TorusGeometry, mat: Material, x = 0, y = 0, z = 0): Mesh {
  const m = new Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Cylinder lying along +z. */
function barrel(r0: number, r1: number, len: number, mat: Material, z0: number, y = 0, seg = 10): Mesh {
  const m = mesh(new CylinderGeometry(r1, r0, len, seg), mat, 0, y, z0 + len / 2);
  m.rotation.x = Math.PI / 2;
  return m;
}

export function crewFigure(shirt: number): Group {
  const g = new Group();
  const body = mesh(new CylinderGeometry(0.15, 0.17, 0.55, 8), new MeshStandardMaterial({ color: shirt, roughness: 0.9 }), 0, 0.3, 0);
  const legs = mesh(new BoxGeometry(0.28, 0.35, 0.22), new MeshStandardMaterial({ color: new Color(shirt).multiplyScalar(0.45), roughness: 0.9 }), 0, -0.12, 0.05);
  const head = mesh(new SphereGeometry(0.12, 10, 8), M().skin, 0, 0.7, 0.02);
  const helmet = mesh(new SphereGeometry(0.15, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), M().helmet, 0, 0.73, 0.02);
  g.add(body, legs, head, helmet);
  return g;
}

export function buildWeaponRig(def: WeaponDef, crewShirt?: number): WeaponRig {
  const m = M();
  const id = def.rig;
  const yaw = new Group();
  const pitch = new Group();
  const muzzle = new Object3D();
  yaw.add(pitch);
  pitch.add(muzzle);
  let loaded: Object3D | undefined;

  switch (id) {
    case 'mg_old': {
      pitch.position.y = 0.35;
      yaw.add(mesh(new CylinderGeometry(0.04, 0.05, 0.35, 6), m.gunmetal, 0, 0.17, 0));
      pitch.add(mesh(new BoxGeometry(0.2, 0.2, 0.45), m.olive, 0, 0, -0.05));
      pitch.add(barrel(0.075, 0.075, 0.6, m.olive, 0.15));
      pitch.add(barrel(0.025, 0.025, 0.2, m.black, 0.75));
      pitch.add(mesh(new BoxGeometry(0.16, 0.14, 0.2), m.ammo, 0.2, -0.05, 0));
      const shield = mesh(new BoxGeometry(0.62, 0.42, 0.04), m.shield, 0, 0.12, 0.3);
      shield.rotation.x = -0.15;
      yaw.add(shield);
      shield.position.y = 0.4;
      muzzle.position.set(0, 0, 0.96);
      break;
    }
    case 'mg_new': {
      pitch.position.y = 0.38;
      yaw.add(mesh(new CylinderGeometry(0.035, 0.045, 0.38, 6), m.black, 0, 0.19, 0));
      pitch.add(mesh(new BoxGeometry(0.14, 0.16, 0.48), m.black, 0, 0, -0.02));
      pitch.add(barrel(0.032, 0.028, 0.7, m.gunmetal, 0.2));
      pitch.add(barrel(0.045, 0.045, 0.1, m.black, 0.88));
      pitch.add(mesh(new BoxGeometry(0.05, 0.06, 0.2), m.black, 0, 0.12, 0));
      pitch.add(barrel(0.03, 0.03, 0.2, m.steel, -0.05, 0.13));
      pitch.add(mesh(new BoxGeometry(0.12, 0.2, 0.16), m.ammo, -0.15, -0.08, 0));
      muzzle.position.set(0, 0, 1.0);
      break;
    }
    case 'cannon': {
      pitch.position.y = 0.45;
      yaw.add(mesh(new CylinderGeometry(0.4, 0.45, 0.25, 10), m.gunmetal, 0, 0.12, 0));
      yaw.add(mesh(new BoxGeometry(0.12, 0.45, 0.5), m.gunmetal, -0.28, 0.35, 0));
      yaw.add(mesh(new BoxGeometry(0.12, 0.45, 0.5), m.gunmetal, 0.28, 0.35, 0));
      pitch.add(barrel(0.22, 0.2, 0.5, m.bronze, -0.4));
      pitch.add(barrel(0.15, 0.11, 1.25, m.bronze, 0.1));
      pitch.add(barrel(0.14, 0.14, 0.1, m.black, 1.3));
      const shield = mesh(new BoxGeometry(1.05, 0.62, 0.06), m.shield, 0, 0.55, 0.4);
      shield.rotation.x = -0.25;
      yaw.add(shield);
      muzzle.position.set(0, 0, 1.45);
      break;
    }
    case 'harpoon': {
      pitch.position.y = 0.4;
      yaw.add(mesh(new CylinderGeometry(0.05, 0.07, 0.4, 6), m.gunmetal, 0, 0.2, 0));
      pitch.add(barrel(0.09, 0.08, 0.95, m.olive, -0.25));
      pitch.add(barrel(0.1, 0.1, 0.06, m.black, 0.7));
      const drum = mesh(new CylinderGeometry(0.16, 0.16, 0.14, 12), m.wood, 0.24, -0.02, -0.1);
      drum.rotation.z = Math.PI / 2;
      pitch.add(drum);
      const coil = mesh(new TorusGeometry(0.14, 0.035, 6, 14), m.rope, 0.24, -0.02, -0.1);
      coil.rotation.y = Math.PI / 2;
      pitch.add(coil);
      const spear = new Group();
      spear.add(barrel(0.022, 0.022, 0.6, m.steel, 0));
      const tip = mesh(new ConeGeometry(0.06, 0.22, 6), m.steel, 0, 0, 0.7);
      tip.rotation.x = Math.PI / 2;
      spear.add(tip);
      spear.position.z = 0.55;
      pitch.add(spear);
      loaded = spear;
      muzzle.position.set(0, 0, 0.85);
      break;
    }
  }

  // Workshop barrels: stretch the gun along its bore; mark special ammo with a coloured band.
  if (def.barrelScale !== 1) pitch.scale.z = def.barrelScale;
  if (def.incendiary > 0 || (def.splashDamage > 0 && def.kind === 'bullet')) {
    const tint = def.incendiary > 0 ? 0xd9482b : 0xe0b43a;
    pitch.add(mesh(new BoxGeometry(0.22, 0.06, 0.08), new MeshStandardMaterial({ color: tint, roughness: 0.5 }), 0, 0.13, 0));
  }

  // Batch the static pieces of the mount and the barrel assembly.
  mergeChildren(yaw);
  mergeChildren(pitch, loaded ? [loaded] : []);

  let crew: Group | undefined;
  if (crewShirt !== undefined) {
    crew = crewFigure(crewShirt);
    crew.position.set(id === 'cannon' ? 0.3 : 0, -0.05, id === 'cannon' ? -0.75 : -0.55);
    yaw.add(crew);
  }
  return { yaw, pitch, muzzle, loaded, crew };
}
