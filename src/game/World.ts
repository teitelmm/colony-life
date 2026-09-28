import type { Scene } from 'three';
import type { Effects } from '../fx/effects';
import type { Sound } from '../audio/Sound';
import type { FoamMap } from '../fx/FoamMap';
import type { WaterSampler } from '../boat/BoatPhysics';
import type { Boat } from '../boat/Boat';
import type { ProjectileSystem } from '../weapons/Projectiles';
import type { HarpoonSystem } from '../weapons/Harpoon';
import type { Scenery } from '../world/Scenery';
import type { Debris } from './Debris';
import type { Loot } from './Loot';

export interface GameEvents {
  /** a player projectile hit an enemy boat */
  hitMarker(killingBlow: boolean): void;
  /** player boat took damage */
  playerHit(amount: number): void;
  boatWrecked(boat: Boat): void;
  message(text: string): void;
}

/** Everything gameplay systems need to talk to each other. */
export interface World {
  scene: Scene;
  time: number;
  water: WaterSampler;
  effects: Effects;
  sound: Sound;
  foam: FoamMap;
  boats: Boat[];
  player: Boat | null;
  projectiles: ProjectileSystem;
  harpoons: HarpoonSystem;
  scenery: Scenery;
  debris: Debris;
  loot: Loot;
  events: GameEvents;
}
