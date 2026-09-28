/**
 * Effect recipes: muzzle flashes, impacts, splashes, explosions, fire and
 * smoke. Combines particles, projected water foam, light flashes, camera
 * shake and sound.
 */

import { Color, Vector3 } from 'three';
import { PType, type ParticleSystem } from './Particles';
import type { FoamMap } from './FoamMap';
import type { FlashLights } from './FlashLights';
import type { Sound } from '../audio/Sound';

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const WIND = new Vector3(1.4, 0, 0.7);

const C = {
  flash: new Color(2.6, 1.8, 0.9),
  fireHot: new Color(3.2, 1.7, 0.5),
  fireCool: new Color(0.9, 0.18, 0.04),
  smokeDark: new Color(0.09, 0.085, 0.08),
  smokeGrey: new Color(0.36, 0.35, 0.34),
  smokeLight: new Color(0.62, 0.6, 0.58),
  spray: new Color(0.86, 0.92, 0.94),
  mist: new Color(0.8, 0.85, 0.87),
  spark: new Color(4, 2.4, 0.9),
  wood: new Color(0.42, 0.28, 0.16),
  metal: new Color(0.2, 0.21, 0.22),
  exhaust: new Color(0.22, 0.22, 0.23),
  bubble: new Color(0.7, 0.85, 0.9),
};

export interface Shaker {
  shake(amount: number, x: number, z: number): void;
}

export class Effects {
  constructor(
    readonly glow: ParticleSystem,
    readonly smoke: ParticleSystem,
    readonly foam: FoamMap,
    readonly lights: FlashLights,
    readonly sound: Sound,
    readonly shaker: Shaker,
    readonly waterHeight: (x: number, z: number) => number,
  ) {}

  muzzleFlash(p: Vector3, dir: Vector3, scale: number): void {
    this.glow.emit({ x: p.x, y: p.y, z: p.z, life: 0.06, size: 0.9 * scale, sizeEnd: 0.4 * scale, color: C.flash, alpha: 1, alphaEnd: 0 });
    for (let i = 0; i < 3; i++) {
      const s = rand(4, 12) * scale;
      this.glow.emit({
        x: p.x,
        y: p.y,
        z: p.z,
        vx: dir.x * s,
        vy: dir.y * s,
        vz: dir.z * s,
        life: 0.07,
        size: 0.35 * scale,
        color: C.fireHot,
        stretch: 0.04,
        type: PType.Flame,
      });
    }
    const puffs = scale > 1.5 ? 10 : 2;
    for (let i = 0; i < puffs; i++) {
      const s = rand(1, 4) * scale;
      this.smoke.emit({
        x: p.x,
        y: p.y,
        z: p.z,
        vx: dir.x * s + rand(-0.5, 0.5),
        vy: dir.y * s + rand(0, 0.6),
        vz: dir.z * s + rand(-0.5, 0.5),
        life: rand(0.8, 1.6) * (scale > 1.5 ? 2.2 : 1),
        size: 0.3 * scale,
        sizeEnd: 1.4 * scale,
        color: C.smokeLight,
        colorEnd: C.smokeGrey,
        alpha: 0.35,
        drag: 2.5,
        gravity: -0.4,
        type: PType.Smoke,
        spin: rand(-1, 1),
      });
    }
    if (scale > 1.5) {
      this.lights.flash(p.x, p.y + 0.5, p.z, 0xffb060, 60, 26, 0.18);
      // Pressure wave flattens the water in front of a cannon.
      this.foam.ring(p.x + dir.x * 2, p.z + dir.z * 2, 3.5, 0.8, 0.6);
    } else {
      this.lights.flash(p.x, p.y + 0.3, p.z, 0xffc070, 6, 8, 0.05);
    }
  }

  bulletWater(x: number, z: number, big = false): void {
    const y = this.waterHeight(x, z);
    const n = big ? 14 : 7;
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const r = rand(0.1, 0.9);
      this.smoke.emit({
        x,
        y,
        z,
        vx: Math.cos(a) * r,
        vy: rand(2.5, big ? 7 : 5),
        vz: Math.sin(a) * r,
        life: rand(0.5, 0.9),
        size: rand(0.12, 0.28),
        sizeEnd: 0.05,
        color: C.spray,
        alpha: 0.9,
        alphaEnd: 0.3,
        gravity: 9.8,
        type: PType.Spray,
        stretch: 0.03,
        killBelow: y - 0.2,
      });
    }
    this.smoke.emit({ x, y: y + 0.3, z, vy: 0.5, life: 0.8, size: 0.4, sizeEnd: 1.4, color: C.mist, alpha: 0.25, type: PType.Smoke, drag: 1 });
    this.foam.ring(x, z, big ? 1.8 : 1.1, 1.3, 0.8);
    this.foam.foam(x, z, 0.6, 2.5, 0.6);
    this.sound.play('splash', x, z, 0.5);
  }

  shellWater(x: number, z: number): void {
    const y = this.waterHeight(x, z);
    for (let i = 0; i < 70; i++) {
      const a = rand(0, Math.PI * 2);
      const r = rand(0, 2.2);
      this.smoke.emit({
        x: x + Math.cos(a) * r * 0.3,
        y,
        z: z + Math.sin(a) * r * 0.3,
        vx: Math.cos(a) * r,
        vy: rand(7, 17) * (1 - r / 4),
        vz: Math.sin(a) * r,
        life: rand(1.3, 2.4),
        size: rand(0.4, 1.0),
        sizeEnd: rand(0.8, 1.6),
        color: C.spray,
        alpha: 0.85,
        alphaEnd: 0.2,
        gravity: 9.8,
        drag: 0.3,
        type: PType.Spray,
        stretch: 0.05,
        killBelow: y - 0.5,
      });
    }
    for (let i = 0; i < 12; i++) {
      this.smoke.emit({
        x: x + rand(-1, 1),
        y: y + rand(1, 6),
        z: z + rand(-1, 1),
        vx: WIND.x * 0.4 + rand(-1, 1),
        vy: rand(0, 1.5),
        vz: WIND.z * 0.4 + rand(-1, 1),
        life: rand(1.5, 2.8),
        size: 1,
        sizeEnd: 3.2,
        color: C.mist,
        alpha: 0.22,
        drag: 0.8,
        type: PType.Smoke,
        fadeIn: 0.15,
      });
    }
    this.foam.ring(x, z, 7, 2.4, 1.1);
    this.foam.ring(x, z, 4, 1.6, 0.8);
    this.foam.foam(x, z, 3.2, 7, 1.2);
    this.sound.play('bigSplash', x, z);
    this.shaker.shake(0.2, x, z);
  }

  hit(p: Vector3, material: 'wood' | 'metal', scale = 1): void {
    if (material === 'metal') {
      for (let i = 0; i < 8 * scale; i++) {
        this.glow.emit({
          x: p.x,
          y: p.y,
          z: p.z,
          vx: rand(-6, 6),
          vy: rand(1, 7),
          vz: rand(-6, 6),
          life: rand(0.15, 0.45),
          size: 0.05,
          color: C.spark,
          alpha: 1,
          gravity: 9.8,
          type: PType.Spark,
          stretch: 0.035,
        });
      }
      this.glow.emit({ x: p.x, y: p.y, z: p.z, life: 0.05, size: 0.5 * scale, color: C.spark });
      this.sound.play('hitMetal', p.x, p.z, 0.6);
    } else {
      for (let i = 0; i < 6 * scale; i++) {
        this.smoke.emit({
          x: p.x,
          y: p.y,
          z: p.z,
          vx: rand(-3, 3),
          vy: rand(1, 5),
          vz: rand(-3, 3),
          life: rand(0.5, 1.1),
          size: rand(0.06, 0.14),
          color: C.wood,
          alpha: 1,
          alphaEnd: 1,
          gravity: 9.8,
          spin: rand(-12, 12),
          type: PType.Chunk,
          killBelow: p.y - 3,
        });
      }
      this.sound.play('hitWood', p.x, p.z, 0.7);
    }
    this.smoke.emit({ x: p.x, y: p.y, z: p.z, vy: 0.6, life: 0.9, size: 0.3, sizeEnd: 1.1, color: material === 'metal' ? C.smokeGrey : C.smokeLight, alpha: 0.4, type: PType.Smoke });
  }

  explosion(p: Vector3, scale = 1, onWater = true): void {
    const s = scale;
    this.glow.emit({ x: p.x, y: p.y + 0.5, z: p.z, life: 0.12, size: 4 * s, sizeEnd: 5.5 * s, color: C.flash, alpha: 0.9 });
    for (let i = 0; i < 14 * s; i++) {
      const v = new Vector3(rand(-1, 1), rand(0.2, 1.2), rand(-1, 1)).normalize().multiplyScalar(rand(2, 6) * s);
      this.glow.emit({
        x: p.x,
        y: p.y + 0.3,
        z: p.z,
        vx: v.x,
        vy: v.y,
        vz: v.z,
        life: rand(0.4, 0.9),
        size: rand(1.0, 1.8) * s,
        sizeEnd: rand(2.5, 4) * s,
        color: C.fireHot,
        colorEnd: C.fireCool,
        alpha: 1,
        drag: 3,
        gravity: -2,
        type: PType.Flame,
        spin: rand(-2, 2),
      });
    }
    for (let i = 0; i < 26 * s; i++) {
      this.smoke.emit({
        x: p.x + rand(-1.2, 1.2) * s,
        y: p.y + rand(0, 1.5) * s,
        z: p.z + rand(-1.2, 1.2) * s,
        vx: rand(-2.5, 2.5) * s + WIND.x * 0.5,
        vy: rand(1.5, 5),
        vz: rand(-2.5, 2.5) * s + WIND.z * 0.5,
        life: rand(2.5, 5),
        size: rand(0.8, 1.5) * s,
        sizeEnd: rand(2.5, 4.5) * s,
        color: C.smokeDark,
        colorEnd: C.smokeGrey,
        alpha: 0.75,
        drag: 0.9,
        gravity: -0.3,
        type: PType.Smoke,
        fadeIn: 0.08,
        spin: rand(-0.5, 0.5),
      });
    }
    for (let i = 0; i < 35 * s; i++) {
      const v = new Vector3(rand(-1, 1), rand(0.1, 1.3), rand(-1, 1)).normalize().multiplyScalar(rand(8, 24));
      this.glow.emit({
        x: p.x,
        y: p.y + 0.3,
        z: p.z,
        vx: v.x,
        vy: v.y,
        vz: v.z,
        life: rand(0.4, 1.3),
        size: 0.07,
        color: C.spark,
        gravity: 9.8,
        drag: 0.6,
        type: PType.Spark,
        stretch: 0.03,
      });
    }
    for (let i = 0; i < 12 * s; i++) {
      const v = new Vector3(rand(-1, 1), rand(0.4, 1.4), rand(-1, 1)).normalize().multiplyScalar(rand(5, 13));
      this.smoke.emit({
        x: p.x,
        y: p.y + 0.3,
        z: p.z,
        vx: v.x,
        vy: v.y,
        vz: v.z,
        life: rand(1.2, 2.2),
        size: rand(0.12, 0.3),
        color: Math.random() < 0.5 ? C.wood : C.metal,
        alpha: 1,
        alphaEnd: 1,
        gravity: 9.8,
        spin: rand(-15, 15),
        type: PType.Chunk,
        killBelow: this.waterHeight(p.x, p.z) - 0.2,
      });
    }
    if (onWater) {
      this.foam.ring(p.x, p.z, 9 * s, 1.8, 1.2);
      this.foam.foam(p.x, p.z, 3 * s, 6, 1);
      for (let i = 0; i < 20 * s; i++) {
        const a = rand(0, Math.PI * 2);
        const r = rand(1, 3) * s;
        this.smoke.emit({
          x: p.x + Math.cos(a) * r,
          y: this.waterHeight(p.x, p.z),
          z: p.z + Math.sin(a) * r,
          vx: Math.cos(a) * rand(2, 5),
          vy: rand(3, 8),
          vz: Math.sin(a) * rand(2, 5),
          life: rand(0.8, 1.4),
          size: rand(0.3, 0.6),
          sizeEnd: 0.9,
          color: C.spray,
          alpha: 0.7,
          alphaEnd: 0.1,
          gravity: 9.8,
          type: PType.Spray,
          stretch: 0.04,
        });
      }
    }
    this.lights.flash(p.x, p.y + 2, p.z, 0xff8a3a, 55 * s, 26 * s, 0.45);
    this.shaker.shake(0.55 * s, p.x, p.z);
    this.sound.play(s > 1.3 ? 'bigExplosion' : 'explosion', p.x, p.z);
  }

  /** Continuous fire on a burning part; call every frame. */
  fire(p: Vector3, intensity: number, dt: number): void {
    const flames = 26 * intensity * dt;
    for (let i = 0; i < flames + Math.random(); i++) {
      this.glow.emit({
        x: p.x + rand(-0.3, 0.3),
        y: p.y + rand(0, 0.2),
        z: p.z + rand(-0.3, 0.3),
        vx: WIND.x * 0.3 + rand(-0.3, 0.3),
        vy: rand(1.2, 2.6),
        vz: WIND.z * 0.3 + rand(-0.3, 0.3),
        life: rand(0.35, 0.7),
        size: rand(0.4, 0.8) * (0.6 + intensity * 0.5),
        sizeEnd: 0.15,
        color: C.fireHot,
        colorEnd: C.fireCool,
        alpha: 0.9,
        type: PType.Flame,
        spin: rand(-2, 2),
        fadeIn: 0.1,
      });
    }
    const puffs = 7 * intensity * dt;
    for (let i = 0; i < puffs + Math.random() * 0.5; i++) {
      this.smoke.emit({
        x: p.x + rand(-0.2, 0.2),
        y: p.y + 0.7,
        z: p.z + rand(-0.2, 0.2),
        vx: WIND.x * rand(0.6, 1.2),
        vy: rand(1.2, 2.4),
        vz: WIND.z * rand(0.6, 1.2),
        life: rand(3.5, 6),
        size: rand(0.5, 0.9),
        sizeEnd: rand(2.5, 4.5),
        color: C.smokeDark,
        colorEnd: C.smokeGrey,
        alpha: 0.6,
        drag: 0.3,
        type: PType.Smoke,
        fadeIn: 0.12,
        spin: rand(-0.4, 0.4),
      });
    }
  }

  /** Thin wisps from a damaged (not yet burning) part. */
  smolder(p: Vector3, dt: number): void {
    if (Math.random() > dt * 4) return;
    this.smoke.emit({
      x: p.x,
      y: p.y + 0.3,
      z: p.z,
      vx: WIND.x * 0.8,
      vy: rand(0.8, 1.5),
      vz: WIND.z * 0.8,
      life: rand(2, 3.5),
      size: 0.3,
      sizeEnd: 2.2,
      color: C.smokeGrey,
      alpha: 0.35,
      type: PType.Smoke,
      fadeIn: 0.15,
    });
  }

  exhaust(p: Vector3, load: number, dt: number, diesel: boolean): void {
    if (Math.random() > dt * (diesel ? 10 : 5) * (0.3 + load)) return;
    this.smoke.emit({
      x: p.x,
      y: p.y,
      z: p.z,
      vx: WIND.x * 0.5 + rand(-0.2, 0.2),
      vy: rand(0.6, 1.4),
      vz: WIND.z * 0.5 + rand(-0.2, 0.2),
      life: rand(1.2, 2.5),
      size: diesel ? 0.25 : 0.15,
      sizeEnd: diesel ? 1.6 : 0.9,
      color: diesel ? C.smokeDark : C.exhaust,
      alpha: diesel ? 0.45 : 0.25,
      type: PType.Smoke,
      drag: 0.5,
    });
  }

  /** Bow spray and prop churn while underway. */
  spray(p: Vector3, side: Vector3, speed: number, dt: number): void {
    const rate = Math.max(0, speed - 2) * 5 * dt;
    for (let i = 0; i < rate + Math.random() * 0.3 * rate; i++) {
      const sgn = Math.random() < 0.5 ? -1 : 1;
      const out = rand(0.5, 1.5) * speed * 0.35;
      this.smoke.emit({
        x: p.x + side.x * sgn * 0.3,
        y: p.y,
        z: p.z + side.z * sgn * 0.3,
        vx: side.x * sgn * out,
        vy: rand(1, 2.5) + speed * 0.15,
        vz: side.z * sgn * out,
        life: rand(0.4, 0.8),
        size: rand(0.12, 0.3),
        sizeEnd: 0.4,
        color: C.spray,
        alpha: 0.7,
        alphaEnd: 0,
        gravity: 9.8,
        type: PType.Spray,
        stretch: 0.03,
        killBelow: p.y - 0.5,
      });
    }
  }

  bubbles(x: number, z: number, dt: number): void {
    if (Math.random() > dt * 10) return;
    const y = this.waterHeight(x, z);
    this.foam.foam(x + rand(-1, 1), z + rand(-1, 1), rand(0.5, 1.4), 2, 0.7);
    this.smoke.emit({ x: x + rand(-1, 1), y, z: z + rand(-1, 1), vy: rand(1, 2.5), life: 0.4, size: 0.2, color: C.bubble, alpha: 0.6, gravity: 9.8, type: PType.Spray });
  }

  /** Big burning column when a boat's magazine goes up. */
  wreck(p: Vector3, scale: number): void {
    this.explosion(p, scale);
    this.foam.oil(p.x + rand(-2, 2), p.z + rand(-2, 2), 5 + scale * 3);
    this.foam.oil(p.x + rand(-4, 4), p.z + rand(-4, 4), 3 + scale * 2);
  }
}
