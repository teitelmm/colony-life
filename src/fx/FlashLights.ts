import { Color, PointLight, type Scene } from 'three';

/** Fixed pool of point lights for muzzle flashes and explosions (constant count avoids shader recompiles). */
export class FlashLights {
  private readonly lights: { light: PointLight; life: number; max: number; peak: number }[] = [];

  constructor(scene: Scene, count = 6) {
    for (let i = 0; i < count; i++) {
      const light = new PointLight(0xffaa55, 0, 20, 2);
      light.castShadow = false;
      scene.add(light);
      this.lights.push({ light, life: 0, max: 1, peak: 0 });
    }
  }

  flash(x: number, y: number, z: number, color: number | Color, intensity: number, range: number, duration: number): void {
    // Reuse the dimmest light.
    let best = this.lights[0];
    for (const l of this.lights) if (l.light.intensity < best.light.intensity) best = l;
    best.light.position.set(x, y, z);
    best.light.color.set(color);
    best.light.distance = range;
    best.peak = intensity;
    best.max = duration;
    best.life = duration;
    best.light.intensity = intensity;
  }

  update(dt: number): void {
    for (const l of this.lights) {
      if (l.life <= 0) {
        l.light.intensity = 0;
        continue;
      }
      l.life -= dt;
      const t = Math.max(0, l.life / l.max);
      l.light.intensity = l.peak * t * t;
    }
  }
}
