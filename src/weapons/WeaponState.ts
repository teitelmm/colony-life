import type { WeaponDef } from './weaponDefs';

/** Pure firing state: cooldown, heat/overheat and jams. No rendering. */
export class WeaponState {
  cooldown = 0;
  heat = 0;
  overheated = false;
  jamTimer = 0;
  shotsFired = 0;

  constructor(public def: WeaponDef) {}

  setDef(def: WeaponDef): void {
    this.def = def;
    this.cooldown = Math.min(this.cooldown, def.fireInterval);
    this.heat = 0;
    this.overheated = false;
    this.jamTimer = 0;
  }

  get jammed(): boolean {
    return this.jamTimer > 0;
  }

  /** 0..1 reload progress (1 = ready). */
  get readiness(): number {
    return 1 - Math.min(1, this.cooldown / this.def.fireInterval);
  }

  update(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.jamTimer = Math.max(0, this.jamTimer - dt);
    this.heat = Math.max(0, this.heat - this.def.coolRate * dt);
    if (this.overheated && this.heat < 0.35) this.overheated = false;
  }

  canFire(): boolean {
    return this.cooldown <= 0 && !this.overheated && !this.jammed;
  }

  /**
   * Consume one shot. Returns false if the weapon could not fire.
   * `rand` is injectable for deterministic tests.
   */
  fire(rand: () => number = Math.random): boolean {
    if (!this.canFire()) return false;
    this.cooldown += this.def.fireInterval;
    this.shotsFired++;
    this.heat += this.def.heatPerShot;
    if (this.heat >= 1) {
      this.heat = 1;
      this.overheated = true;
    }
    // Hot guns jam more often.
    if (this.def.jamChance > 0 && rand() < this.def.jamChance * (1 + this.heat * 2)) {
      this.jamTimer = this.def.jamTime;
    }
    return true;
  }

  isTracer(): boolean {
    const n = this.def.tracerEvery;
    return n <= 0 || this.shotsFired % n === 0;
  }
}
