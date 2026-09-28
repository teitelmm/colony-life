/** Escalating waves of enemy boats with a breather (and repairs) in between. */

import type { DesignId } from '../boat/designs';
import type { AIProfile } from '../ai/EnemyAI';
import type { Resource } from './Loot';

export interface EnemyType {
  design: DesignId;
  cost: number;
  score: number;
  profile: AIProfile;
  loot: [Resource, number][];
}

export const ENEMY_TYPES: Record<Exclude<DesignId, 'dinghy'>, EnemyType> = {
  raider: {
    design: 'raider',
    cost: 2,
    score: 100,
    profile: { accuracy: 0.35, courage: 0.4, burstOn: 1.4, burstOff: 1.6 },
    loot: [
      ['wood', 4],
      ['wood', 3],
    ],
  },
  harpooner: {
    design: 'harpooner',
    cost: 3,
    score: 150,
    profile: { accuracy: 0.55, courage: 0.7, burstOn: 1, burstOff: 1 },
    loot: [
      ['wood', 4],
      ['metal', 3],
    ],
  },
  gunboat: {
    design: 'gunboat',
    cost: 5,
    score: 300,
    profile: { accuracy: 0.5, courage: 0.6, burstOn: 1.8, burstOff: 1.2 },
    loot: [
      ['wood', 6],
      ['metal', 4],
      ['metal', 3],
    ],
  },
  barge: {
    design: 'barge',
    cost: 9,
    score: 600,
    profile: { accuracy: 0.6, courage: 0.9, burstOn: 3, burstOff: 1 },
    loot: [
      ['metal', 6],
      ['metal', 6],
      ['wood', 5],
      ['metal', 5],
    ],
  },
};

type Key = keyof typeof ENEMY_TYPES;

const SCRIPTED: Key[][] = [
  ['raider', 'raider'],
  ['raider', 'raider', 'raider'],
  ['raider', 'harpooner', 'raider'],
  ['gunboat', 'raider'],
  ['gunboat', 'harpooner', 'raider', 'raider'],
  ['barge', 'raider'],
];

/** Composition of wave `n` (1-based). */
export function waveComposition(n: number, rand: () => number = Math.random): Key[] {
  if (n <= SCRIPTED.length) return SCRIPTED[n - 1];
  let budget = 8 + (n - SCRIPTED.length) * 3;
  const out: Key[] = [];
  const keys = Object.keys(ENEMY_TYPES) as Key[];
  while (budget >= 2 && out.length < 7) {
    const affordable = keys.filter((k) => ENEMY_TYPES[k].cost <= budget);
    const pick = affordable[(rand() * affordable.length) | 0];
    out.push(pick);
    budget -= ENEMY_TYPES[pick].cost;
  }
  return out;
}

export type WavePhase = 'intermission' | 'combat';

export class WaveManager {
  wave = 0;
  phase: WavePhase = 'intermission';
  /** time to fish, build and get ready before the first raiders */
  timer = 45;

  /** Returns the composition to spawn when a new wave starts. */
  update(dt: number, enemiesAlive: number, skip: boolean): Key[] | null {
    if (this.phase === 'combat') {
      if (enemiesAlive === 0) {
        this.phase = 'intermission';
        this.timer = 40;
      }
      return null;
    }
    this.timer -= dt;
    if (this.timer <= 0 || skip) {
      this.wave++;
      this.phase = 'combat';
      return waveComposition(this.wave);
    }
    return null;
  }
}
