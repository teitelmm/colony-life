/** Pure ballistic helpers shared by player aiming, AI and tests. */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Low-arc launch angle (radians above horizontal) needed to hit a point at
 * horizontal distance `dist` and height difference `dh` with speed `v`.
 * Returns null when the target is out of range.
 */
export function solveLaunchAngle(dist: number, dh: number, v: number, g: number): number | null {
  if (g <= 1e-6) return Math.atan2(dh, dist);
  if (dist < 1e-4) return dh >= 0 ? Math.PI / 2 : -Math.PI / 2;
  const v2 = v * v;
  const disc = v2 * v2 - g * (g * dist * dist + 2 * dh * v2);
  if (disc < 0) return null;
  return Math.atan((v2 - Math.sqrt(disc)) / (g * dist));
}

/** Maximum horizontal range on flat ground for speed v. */
export function maxRange(v: number, g: number): number {
  return g <= 1e-6 ? Infinity : (v * v) / g;
}

export function flightTime(dist: number, angle: number, v: number): number {
  return dist / Math.max(1e-4, v * Math.cos(angle));
}

/** Position of a projectile after time t (no drag). */
export function ballisticPosition(p0: Vec3, v0: Vec3, g: number, t: number, out: Vec3): Vec3 {
  out.x = p0.x + v0.x * t;
  out.y = p0.y + v0.y * t - 0.5 * g * t * t;
  out.z = p0.z + v0.z * t;
  return out;
}

/**
 * Iteratively estimate where to aim so a projectile of speed `speed` meets a
 * target moving at constant velocity. Horizontal plane only.
 */
export function leadTarget(shooter: Vec3, target: Vec3, targetVel: Vec3, speed: number, g: number, iterations = 4): Vec3 {
  let aim = { x: target.x, y: target.y, z: target.z };
  for (let i = 0; i < iterations; i++) {
    const dx = aim.x - shooter.x;
    const dz = aim.z - shooter.z;
    const dist = Math.hypot(dx, dz);
    const ang = solveLaunchAngle(dist, aim.y - shooter.y, speed, g) ?? Math.PI / 4;
    const t = flightTime(dist, ang, speed);
    aim = {
      x: target.x + targetVel.x * t,
      y: target.y,
      z: target.z + targetVel.z * t,
    };
  }
  return aim;
}
