/**
 * Graphics quality tiers plus an automatic governor that trades resolution
 * and effects for frame rate. Pure logic: the game applies the settings.
 */

export type Tier = 'low' | 'medium' | 'high';
export type QualityMode = 'auto' | Tier;

export interface TierSettings {
  /** MSAA samples on the main render target */
  msaa: number;
  bloom: boolean;
  /** bloom buffer size relative to the screen */
  bloomScale: number;
  /** 0 = shadows off */
  shadowMap: number;
  foamResolution: number;
  /** ocean micro-detail strength and far fade (0..1) */
  oceanDetail: number;
  /** multiplier on particle emission */
  particles: number;
  /** cap on device pixel ratio */
  maxPixelRatio: number;
}

export const TIERS: Record<Tier, TierSettings> = {
  low: { msaa: 0, bloom: false, bloomScale: 0.25, shadowMap: 0, foamResolution: 512, oceanDetail: 0.5, particles: 0.5, maxPixelRatio: 1 },
  medium: { msaa: 2, bloom: true, bloomScale: 0.25, shadowMap: 1024, foamResolution: 1024, oceanDetail: 0.85, particles: 1, maxPixelRatio: 1 },
  high: { msaa: 4, bloom: true, bloomScale: 0.5, shadowMap: 2048, foamResolution: 1024, oceanDetail: 1, particles: 1, maxPixelRatio: 1.5 },
};

const ORDER: Tier[] = ['low', 'medium', 'high'];

export const MIN_SCALE = 0.6;
/** frame budget above which we shed load (ms) */
export const SLOW_MS = 20;
/** frame time below which we try adding quality back (ms) */
export const FAST_MS = 13;
export const SLOW_WINDOW = 2;
export const FAST_WINDOW = 5;

export interface QualityChange {
  tier: Tier;
  /** internal render resolution multiplier (1 = native) */
  scale: number;
}

export class QualityGovernor {
  mode: QualityMode;
  tier: Tier;
  scale = 1;
  private avg = 16.7;
  private slowFor = 0;
  private fastFor = 0;
  /** ignore the first moments after a change while shaders compile */
  private settle = 3;

  constructor(mode: QualityMode = 'auto') {
    this.mode = mode;
    this.tier = mode === 'auto' ? 'medium' : mode;
  }

  setMode(mode: QualityMode): QualityChange {
    this.mode = mode;
    if (mode !== 'auto') this.tier = mode;
    this.scale = 1;
    this.reset();
    return { tier: this.tier, scale: this.scale };
  }

  get fps(): number {
    return 1000 / this.avg;
  }

  get frameMs(): number {
    return this.avg;
  }

  private reset(): void {
    this.slowFor = 0;
    this.fastFor = 0;
    this.settle = 3;
  }

  /**
   * Feed one frame's duration (seconds). Returns a change when the game
   * should apply new settings, otherwise null.
   */
  sample(dt: number): QualityChange | null {
    // Time-based smoothing (~0.5 s), so slow machines converge as fast as quick ones.
    const ms = Math.min(1000, dt * 1000);
    this.avg += (ms - this.avg) * (1 - Math.exp(-dt / 0.5));
    if (this.settle > 0) {
      this.settle -= dt;
      return null;
    }
    if (this.mode !== 'auto') return null;

    if (this.avg > SLOW_MS) {
      this.slowFor += dt;
      this.fastFor = 0;
    } else if (this.avg < FAST_MS) {
      this.fastFor += dt;
      this.slowFor = 0;
    } else {
      this.slowFor = this.fastFor = 0;
    }

    const i = ORDER.indexOf(this.tier);
    if (this.slowFor >= SLOW_WINDOW) {
      this.reset();
      if (this.scale > MIN_SCALE + 1e-6) this.scale = Math.max(MIN_SCALE, +(this.scale - 0.1).toFixed(2));
      else if (i > 0) {
        this.tier = ORDER[i - 1];
        this.scale = 0.9;
      } else return null;
      return { tier: this.tier, scale: this.scale };
    }
    if (this.fastFor >= FAST_WINDOW) {
      this.reset();
      if (this.scale < 1 - 1e-6) this.scale = Math.min(1, +(this.scale + 0.1).toFixed(2));
      else if (i < ORDER.length - 1) {
        this.tier = ORDER[i + 1];
        this.scale = 1;
      } else return null;
      return { tier: this.tier, scale: this.scale };
    }
    return null;
  }
}
