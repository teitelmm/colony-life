/**
 * Data-driven weapon stats. Every gun in the game is a WeaponDef, so the
 * phase-2 gun workshop can build new ones by combining a base with parts.
 */

export type ProjectileKind = 'bullet' | 'shell' | 'harpoon';
export type WeaponId = 'mg_old' | 'mg_new' | 'cannon' | 'harpoon';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  kind: ProjectileKind;
  /** seconds between shots */
  fireInterval: number;
  muzzleVelocity: number;
  /** cone half-angle in radians */
  spread: number;
  damage: number;
  /** 0..1, how much armour is ignored */
  penetration: number;
  splashRadius: number;
  splashDamage: number;
  /** gravity multiplier (1 = real 9.81 m/s²) */
  gravityScale: number;
  /** turret yaw speed rad/s */
  traverseSpeed: number;
  /** half-angle of the firing arc around the mount's forward (rad); π = all round */
  arc: number;
  /** heat added per shot, heat ≥ 1 overheats */
  heatPerShot: number;
  /** heat removed per second */
  coolRate: number;
  /** chance per shot to jam */
  jamChance: number;
  jamTime: number;
  /** every Nth round is a visible tracer (0 = all) */
  tracerEvery: number;
  /** effective range the AI and HUD use */
  range: number;
  /** impulse applied to the firing boat (N·s) */
  recoil: number;
  /** camera shake added when the player fires */
  shake: number;
}

const deg = (d: number) => (d * Math.PI) / 180;

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  mg_old: {
    id: 'mg_old',
    name: 'Old Machine Gun',
    kind: 'bullet',
    fireInterval: 0.12,
    muzzleVelocity: 150,
    spread: deg(2.4),
    damage: 10,
    penetration: 0.15,
    splashRadius: 0,
    splashDamage: 0,
    gravityScale: 1,
    traverseSpeed: 2.6,
    arc: deg(130),
    heatPerShot: 0.055,
    coolRate: 0.22,
    jamChance: 0.006,
    jamTime: 1.8,
    tracerEvery: 3,
    range: 65,
    recoil: 25,
    shake: 0.04,
  },
  mg_new: {
    id: 'mg_new',
    name: 'Machine Gun Mk II',
    kind: 'bullet',
    fireInterval: 0.07,
    muzzleVelocity: 240,
    spread: deg(0.9),
    damage: 9,
    penetration: 0.35,
    splashRadius: 0,
    splashDamage: 0,
    gravityScale: 1,
    traverseSpeed: 3.6,
    arc: deg(150),
    heatPerShot: 0.04,
    coolRate: 0.45,
    jamChance: 0,
    jamTime: 0,
    tracerEvery: 4,
    range: 85,
    recoil: 18,
    shake: 0.03,
  },
  cannon: {
    id: 'cannon',
    name: 'Deck Cannon',
    kind: 'shell',
    fireInterval: 2.1,
    muzzleVelocity: 72,
    spread: deg(0.7),
    damage: 55,
    penetration: 0.8,
    splashRadius: 2.6,
    splashDamage: 30,
    gravityScale: 1,
    traverseSpeed: 1.2,
    arc: deg(120),
    heatPerShot: 0,
    coolRate: 1,
    jamChance: 0,
    jamTime: 0,
    tracerEvery: 0,
    range: 110,
    recoil: 900,
    shake: 0.45,
  },
  harpoon: {
    id: 'harpoon',
    name: 'Harpoon Launcher',
    kind: 'harpoon',
    fireInterval: 3,
    muzzleVelocity: 58,
    spread: deg(0.4),
    damage: 30,
    penetration: 0.6,
    splashRadius: 0,
    splashDamage: 0,
    gravityScale: 0.6,
    traverseSpeed: 2,
    arc: deg(140),
    heatPerShot: 0,
    coolRate: 1,
    jamChance: 0,
    jamTime: 0,
    tracerEvery: 0,
    range: 42,
    recoil: 250,
    shake: 0.15,
  },
};

export const PLAYER_WEAPON_ORDER: WeaponId[] = ['mg_old', 'mg_new', 'cannon', 'harpoon'];
