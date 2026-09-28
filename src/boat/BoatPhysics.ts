/**
 * Rigid-body boat physics: per-hull-cell buoyancy sampled from the wave
 * field, anisotropic hydrodynamic drag, engine thrust and rudder torque.
 */

import { Quaternion, Vector3 } from 'three';
import { effectiveBuoyancy, type BoatStats, type PartInstance } from './BoatStats';
import { GRAVITY } from '../world/waves';

export const WATER_DENSITY = 1000;

export interface WaterSampler {
  height(x: number, z: number): number;
  /** vertical velocity of the surface (m/s); defaults to 0 */
  verticalVelocity?(x: number, z: number): number;
}

export interface HelmControls {
  /** -1 (reverse) .. 1 (full ahead) */
  throttle: number;
  /** -1 (port) .. 1 (starboard) */
  rudder: number;
}

const _v = new Vector3();
const _v2 = new Vector3();
const _q = new Quaternion();

export class BoatBody {
  /** world position of the boat-local origin */
  readonly origin = new Vector3();
  readonly quat = new Quaternion();
  /** linear velocity of the centre of mass */
  readonly vel = new Vector3();
  /** angular velocity (world frame) */
  readonly angVel = new Vector3();
  /** centre of mass in local coordinates */
  readonly com = new Vector3();
  mass = 1;
  readonly inertia = new Vector3(1, 1, 1);
  /** 1 = floats normally, ramps to 0 when the boat is going down */
  buoyancyScale = 1;
  /** average submerged fraction of hull cells last step (0..1) */
  wetness = 0;

  private readonly force = new Vector3();
  private readonly torque = new Vector3();

  setMassProperties(stats: BoatStats): void {
    // Keep the world pose fixed while the centre of mass shifts.
    const oldComWorld = this.comWorld(new Vector3());
    this.com.set(stats.com.x, stats.com.y, stats.com.z);
    const newComWorld = this.comWorld(new Vector3());
    _v.subVectors(newComWorld, oldComWorld);
    this.vel.add(_v2.crossVectors(this.angVel, _v));
    this.mass = stats.mass;
    this.inertia.set(stats.inertia.x, stats.inertia.y, stats.inertia.z);
  }

  localToWorld(local: Vector3, out: Vector3): Vector3 {
    return out.copy(local).applyQuaternion(this.quat).add(this.origin);
  }

  worldToLocal(world: Vector3, out: Vector3): Vector3 {
    _q.copy(this.quat).invert();
    return out.copy(world).sub(this.origin).applyQuaternion(_q);
  }

  localDirToWorld(dir: Vector3, out: Vector3): Vector3 {
    return out.copy(dir).applyQuaternion(this.quat);
  }

  comWorld(out: Vector3): Vector3 {
    return this.localToWorld(this.com, out);
  }

  pointVelocity(world: Vector3, out: Vector3): Vector3 {
    this.comWorld(_v2);
    _v2.subVectors(world, _v2);
    return out.crossVectors(this.angVel, _v2).add(this.vel);
  }

  /** Yaw angle of the bow (+z local) in the world XZ plane. */
  heading(): number {
    _v.set(0, 0, 1).applyQuaternion(this.quat);
    return Math.atan2(_v.x, _v.z);
  }

  addForce(f: Vector3): void {
    this.force.add(f);
  }

  addForceAtPoint(f: Vector3, world: Vector3): void {
    this.force.add(f);
    this.comWorld(_v2);
    _v2.subVectors(world, _v2);
    this.torque.add(_v.crossVectors(_v2, f));
  }

  addTorque(t: Vector3): void {
    this.torque.add(t);
  }

  applyImpulseAtPoint(j: Vector3, world: Vector3): void {
    this.vel.addScaledVector(j, 1 / this.mass);
    this.comWorld(_v2);
    _v2.subVectors(world, _v2);
    const t = _v.crossVectors(_v2, j);
    this.applyInvInertia(t);
    this.angVel.add(t);
  }

  /** Converts a world torque into angular acceleration using the diagonal body inertia. */
  private applyInvInertia(t: Vector3): Vector3 {
    _q.copy(this.quat).invert();
    t.applyQuaternion(_q);
    t.set(t.x / this.inertia.x, t.y / this.inertia.y, t.z / this.inertia.z);
    return t.applyQuaternion(this.quat);
  }

  integrate(dt: number): void {
    const comW = this.comWorld(new Vector3());
    this.vel.addScaledVector(this.force, dt / this.mass);
    this.vel.y -= GRAVITY * dt;
    const alpha = this.applyInvInertia(this.torque.clone());
    this.angVel.addScaledVector(alpha, dt);

    comW.addScaledVector(this.vel, dt);
    const w = this.angVel;
    _q.set(w.x * dt * 0.5, w.y * dt * 0.5, w.z * dt * 0.5, 0).multiply(this.quat);
    this.quat.set(this.quat.x + _q.x, this.quat.y + _q.y, this.quat.z + _q.z, this.quat.w + _q.w).normalize();
    // Re-derive the origin from the integrated centre of mass.
    _v.copy(this.com).applyQuaternion(this.quat);
    this.origin.subVectors(comW, _v);

    this.force.set(0, 0, 0);
    this.torque.set(0, 0, 0);
  }
}

const _p = new Vector3();
const _f = new Vector3();
const _pv = new Vector3();
const _lv = new Vector3();
const _invQ = new Quaternion();
const _up = new Vector3(0, 1, 0);

/** Accumulates hydrostatic + hydrodynamic + propulsion forces for one step. */
export function applyWaterForces(
  body: BoatBody,
  parts: PartInstance[],
  stats: BoatStats,
  helm: HelmControls,
  water: WaterSampler,
): void {
  let submergedSum = 0;
  let cells = 0;

  for (const part of parts) {
    const vol = effectiveBuoyancy(part);
    if (part.def.kind !== 'hull' || !part.alive) continue;
    cells++;
    _p.set(part.x, part.y, part.z);
    body.localToWorld(_p, _p);
    const waterY = water.height(_p.x, _p.z);
    const frac = Math.min(1, Math.max(0, waterY - (_p.y - 0.5)));
    submergedSum += frac;
    if (frac <= 0) continue;

    // Buoyancy acts at the centre of the submerged slice of the cell.
    _p.set(part.x, part.y - 0.5 + frac * 0.5, part.z);
    body.localToWorld(_p, _p);
    _f.set(0, WATER_DENSITY * GRAVITY * vol * frac * body.buoyancyScale, 0);
    body.addForceAtPoint(_f, _p);

    // Heave/roll/pitch damping: water resists motion *relative to the moving surface*,
    // so hulls ride up the face of a swell instead of lagging under it.
    body.pointVelocity(_p, _pv);
    const surfaceVy = water.verticalVelocity?.(_p.x, _p.z) ?? 0;
    _f.set(0, -3200 * frac * (_pv.y - surfaceVy), 0);
    body.addForceAtPoint(_f, _p);
  }

  const wet = cells > 0 ? submergedSum / cells : 0;
  body.wetness = wet;
  const grip = Math.min(1, wet * 3);
  const n = Math.max(1, stats.hullCells);

  // Drag in the boat's frame: long-axis slips, the keel resists sideways motion.
  _invQ.copy(body.quat).invert();
  _lv.copy(body.vel).applyQuaternion(_invQ);
  const fwdLin = 45 * n;
  const fwdQuad = 6 * n;
  const lateral = 900 * n;
  _f.set(
    -lateral * _lv.x * grip,
    0,
    -(fwdLin * _lv.z + fwdQuad * _lv.z * Math.abs(_lv.z)) * grip,
  ).applyQuaternion(body.quat);
  body.addForce(_f);

  // Propulsion (reverse is weaker).
  const throttle = helm.throttle >= 0 ? helm.throttle : helm.throttle * 0.45;
  if (stats.thrust > 0 && throttle !== 0) {
    _f.set(0, 0, stats.thrust * throttle * grip).applyQuaternion(body.quat);
    _f.y = 0;
    body.addForce(_f);
  }

  // Rudder: steering authority grows with speed through the water; heavier boats turn slower.
  const fwdSpeed = _lv.z;
  const dir = fwdSpeed < -0.5 ? -1 : 1;
  const authority = (0.32 + 0.16 * Math.abs(fwdSpeed)) * Math.pow(1600 / stats.mass, 0.2);
  const yawAccel = -helm.rudder * authority * dir * grip;
  // Lean outward in the turn for a bit of arcade feel.
  const rollAccel = helm.rudder * Math.min(1, Math.abs(fwdSpeed) / 8) * 0.9 * grip;
  // Ballast/keel righting moment: rotate the boat's up axis back toward world up.
  // Keeps top-heavy builds and hard hits from turtling the boat (arcade-leaning realism).
  _pv.set(0, 1, 0).applyQuaternion(body.quat);
  _p.crossVectors(_pv, _up);
  const tilt = Math.asin(Math.min(1, _p.length()));
  if (tilt > 1e-4 && body.buoyancyScale > 0.5) {
    _p.normalize().multiplyScalar(tilt * 2.2 * body.mass * (_pv.y < 0 ? 2 : 1));
    body.addTorque(_p);
  }

  const localAngVel = body.angVel.clone().applyQuaternion(_invQ);
  const damp = Math.max(0.35, grip);
  _f.set(
    -body.inertia.x * 1.4 * localAngVel.x * damp,
    body.inertia.y * (yawAccel - 2.2 * localAngVel.y * damp),
    body.inertia.z * (rollAccel - 1.4 * localAngVel.z * damp),
  ).applyQuaternion(body.quat);
  body.addTorque(_f);
}
