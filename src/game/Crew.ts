/**
 * The crew: how many hands are aboard, food, hunger, new recruits, and who
 * does which job this instant. Pure logic, no rendering.
 */

export const MEAL_INTERVAL = 60;
export const RECRUIT_INTERVAL = 35;
export const RECRUIT_FOOD = 4;
export const STARVE_DESERT = 75;

export type CrewEvent = 'ate' | 'hungry' | 'deserted' | 'recruited';

export interface Assignment {
  /** how many repair jobs get a hand, in queue order */
  repairers: number;
  /** how many guns are manned, in order */
  gunners: number;
  /** someone is free to work the nets */
  fisher: boolean;
  idle: number;
}

/**
 * Hands go to repair orders first (the captain's explicit call), then to the
 * guns, and whoever is left fishes.
 */
export function assignCrew(count: number, repairJobs: number, guns: number): Assignment {
  let left = Math.max(0, count);
  const repairers = Math.min(left, repairJobs);
  left -= repairers;
  const gunners = Math.min(left, guns);
  left -= gunners;
  return { repairers, gunners, fisher: left > 0, idle: left };
}

export class Crew {
  count: number;
  food: number;
  private mealTimer = MEAL_INTERVAL;
  private recruitTimer = RECRUIT_INTERVAL;
  private starveTimer = 0;

  constructor(count = 2, food = 12) {
    this.count = count;
    this.food = food;
  }

  get starving(): boolean {
    return this.food <= 0 && this.count > 0;
  }

  /** Work speed multiplier: hungry crews are slow. */
  get efficiency(): number {
    return this.starving ? 0.6 : 1;
  }

  /** Seconds until the next arrival, or null when no bunk is free. */
  recruitEta(berths: number): number | null {
    return this.count < berths && this.food >= RECRUIT_FOOD ? this.recruitTimer : null;
  }

  update(dt: number, berths: number): CrewEvent[] {
    const events: CrewEvent[] = [];
    this.mealTimer -= dt;
    if (this.mealTimer <= 0) {
      this.mealTimer += MEAL_INTERVAL;
      if (this.count > 0) {
        const wasFed = this.food > 0;
        this.food = Math.max(0, this.food - this.count);
        events.push(this.food > 0 || wasFed ? 'ate' : 'hungry');
        if (this.food <= 0) events.push('hungry');
      }
    }
    if (this.starving) {
      this.starveTimer += dt;
      if (this.starveTimer >= STARVE_DESERT) {
        this.starveTimer = 0;
        this.count--;
        events.push('deserted');
      }
    } else {
      this.starveTimer = 0;
    }
    // Empty bunks attract drifters, if there's food to offer them.
    if (this.count < berths && this.food >= RECRUIT_FOOD) {
      this.recruitTimer -= dt;
      if (this.recruitTimer <= 0) {
        this.recruitTimer = RECRUIT_INTERVAL;
        this.food -= RECRUIT_FOOD;
        this.count++;
        events.push('recruited');
      }
    } else {
      this.recruitTimer = RECRUIT_INTERVAL;
    }
    return [...new Set(events)];
  }

  /** Rescue or recruit someone. Returns false when every bunk is taken. */
  join(berths: number): boolean {
    if (this.count >= berths) return false;
    this.count++;
    return true;
  }

  lose(n = 1): void {
    this.count = Math.max(0, this.count - n);
  }
}
