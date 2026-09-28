/**
 * Trailmakers-style boat builder: orbit around the boat, point at any face of
 * any block to see a ghost of the next one, click to bolt it on, right-click
 * to take a block off. Every change rebuilds the live boat so it floats (or
 * doesn't) exactly as it will in battle.
 */

import {
  BoxGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Vector3,
  type PerspectiveCamera,
} from 'three';
import { PARTS, type BoatDesign, type PlacedPart } from '../boat/parts';
import type { Boat } from '../boat/Boat';
import { buildPartContext, buildPartVisual } from '../boat/BoatMesh';
import { segmentBox } from '../boat/hitTest';
import { buildWeaponRig } from '../weapons/WeaponMesh';
import { getWeapon } from '../weapons/weaponDefs';
import type { Input } from '../core/Input';
import type { World } from '../game/World';
import { canPlace, canRemove, partCost, refund, toInstances, type Check } from './buildRules';

export interface BuildHost {
  world: World;
  camera: PerspectiveCamera;
  input: Input;
  wallet(): { wood: number; metal: number };
  pay(cost: { wood: number; metal: number }): void;
  /** swap the player's boat for one built from `design`, keeping its position */
  rebuild(design: BoatDesign): Boat;
  onChange(): void;
}

export type Hover =
  | { kind: 'place'; cand: PlacedPart; check: Check; remove: number }
  | { kind: 'remove'; index: number; check: Check }
  | null;

/** Palette order; number keys pick these. */
export const PALETTE = ['hull_wood', 'hull_metal', 'armor_plate', 'engine_outboard', 'engine_diesel', 'mount_light', 'mount_heavy', 'bunk_cabin', 'net_crane', 'cabin_wood'];

const ghostOk = new MeshBasicMaterial({ color: 0x7dffb0, transparent: true, opacity: 0.45, depthWrite: false });
const ghostBad = new MeshBasicMaterial({ color: 0xff5a4a, transparent: true, opacity: 0.45, depthWrite: false });
const _o = new Vector3();
const _d = new Vector3();
const _t = new Vector3();

export class BuildMode {
  active = false;
  design!: BoatDesign;
  selected = 'hull_wood';
  weapon = 'mg_old';
  /** undefined = automatic facing */
  facing: number | undefined = undefined;
  hover: Hover = null;
  message = '';
  private messageTimer = 0;
  private yaw = 0.7;
  private pitch = 0.75;
  private dist = 14;
  private ghost: Group | null = null;
  private ghostKey = '';
  private readonly outline: LineSegments;

  constructor(private readonly host: BuildHost) {
    this.outline = new LineSegments(new EdgesGeometry(new BoxGeometry(1.04, 1.04, 1.04)), new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
    this.outline.visible = false;
  }

  get boat(): Boat {
    return this.host.world.player!;
  }

  enter(): void {
    this.active = true;
    this.design = this.boat.toDesign();
    this.boat.helm.throttle = 0;
    this.boat.helm.rudder = 0;
    this.boat.trigger = false;
    this.yaw = this.boat.body.heading() + Math.PI * 0.8;
  }

  exit(): void {
    this.active = false;
    this.removeGhost();
    this.outline.removeFromParent();
    this.hover = null;
  }

  flash(text: string): void {
    this.message = text;
    this.messageTimer = 2.5;
  }

  select(partId: string): void {
    this.selected = partId;
    this.host.onChange();
  }

  selectWeapon(id: string): void {
    this.weapon = id;
    if (!PARTS[this.selected] || PARTS[this.selected].kind !== 'mount') this.selected = 'mount_light';
    this.host.onChange();
  }

  private removeGhost(): void {
    this.ghost?.removeFromParent();
    this.ghost = null;
    this.ghostKey = '';
  }

  private makeGhost(cand: PlacedPart): Group {
    const inst = toInstances([...this.design.parts, cand]);
    const ctx = buildPartContext(this.design, inst);
    const v = buildPartVisual(inst[inst.length - 1], ctx);
    if (v.pivot && cand.weapon) {
      const rig = buildWeaponRig(getWeapon(cand.weapon));
      rig.yaw.rotation.y = cand.facing !== undefined ? (cand.facing * Math.PI) / 2 : 0;
      v.pivot.add(rig.yaw);
    }
    v.group.traverse((o) => {
      if ((o as Mesh).isMesh) {
        (o as Mesh).castShadow = false;
        (o as Mesh).receiveShadow = false;
      }
    });
    return v.group;
  }

  update(dt: number): void {
    const { input, camera } = this.host;
    const boat = this.boat;
    this.messageTimer -= dt;
    if (this.messageTimer <= 0) this.message = '';

    // --- camera: orbit the boat ---
    if (input.rightDown) {
      this.yaw -= input.dragX * 0.008;
      this.pitch = Math.max(0.12, Math.min(1.45, this.pitch + input.dragY * 0.006));
    }
    if (input.isDown('KeyQ')) this.yaw += dt * 1.8;
    if (input.isDown('KeyE')) this.yaw -= dt * 1.8;
    if (input.isDown('KeyW')) this.pitch = Math.min(1.45, this.pitch + dt);
    if (input.isDown('KeyS')) this.pitch = Math.max(0.12, this.pitch - dt);
    if (input.wheel) this.dist = Math.max(6, Math.min(40, this.dist * (1 + input.wheel * 0.1)));
    boat.centerWorld(_t);
    _t.y += 0.8;
    camera.position.set(
      _t.x + Math.sin(this.yaw) * Math.cos(this.pitch) * this.dist,
      _t.y + Math.sin(this.pitch) * this.dist,
      _t.z + Math.cos(this.yaw) * Math.cos(this.pitch) * this.dist,
    );
    camera.lookAt(_t);

    // --- keys ---
    for (let i = 0; i < PALETTE.length; i++) if (input.wasPressed(`Digit${(i + 1) % 10}`)) this.select(PALETTE[i]);
    if (input.wasPressed('KeyR')) {
      this.facing = this.facing === undefined ? 0 : this.facing >= 3 ? undefined : this.facing + 1;
      this.host.onChange();
    }

    // --- point at a block ---
    this.hover = this.pick();
    this.updateGhost();

    if (input.leftPressed && this.hover?.kind === 'place') this.place(this.hover);
    if (input.rightClicked && this.hover) {
      const idx = this.hover.kind === 'remove' ? this.hover.index : this.hover.remove;
      this.remove(idx);
    }
  }

  private pick(): Hover {
    const { input, camera } = this.host;
    const boat = this.boat;
    if (!input.hasMouse) return null;
    _d.set(input.ndcX, input.ndcY, 0.5).unproject(camera).sub(camera.position).normalize();
    boat.body.worldToLocal(camera.position, _o);
    _t.copy(camera.position).addScaledVector(_d, 200);
    boat.body.worldToLocal(_t, _t);
    const seg = { ax: _o.x, ay: _o.y, az: _o.z, bx: _t.x, by: _t.y, bz: _t.z };
    let best = -1;
    let bestT = Infinity;
    this.design.parts.forEach((p, i) => {
      const t = segmentBox(seg, p.x - 0.5, p.y - 0.5, p.z - 0.5, p.x + 0.5, p.y + 0.5, p.z + 0.5);
      if (t >= 0 && t < bestT) {
        bestT = t;
        best = i;
      }
    });
    if (best < 0) return null;
    const hit = this.design.parts[best];
    // Which face did the ray enter through?
    const hx = seg.ax + (seg.bx - seg.ax) * bestT - hit.x;
    const hy = seg.ay + (seg.by - seg.ay) * bestT - hit.y;
    const hz = seg.az + (seg.bz - seg.az) * bestT - hit.z;
    const ax = Math.abs(hx);
    const ay = Math.abs(hy);
    const az = Math.abs(hz);
    const n = ax >= ay && ax >= az ? [Math.sign(hx), 0, 0] : ay >= az ? [0, Math.sign(hy), 0] : [0, 0, Math.sign(hz)];
    const def = PARTS[this.selected];
    // The new block sits flush against the face we're pointing at.
    const cand: PlacedPart = { part: this.selected, x: hit.x + n[0], y: hit.y + n[1], z: hit.z + n[2] };
    if (def.kind === 'mount') {
      cand.weapon = this.weapon;
      if (this.facing !== undefined) cand.facing = this.facing;
    }
    const check = canPlace(this.design.parts, cand, this.host.wallet());
    return { kind: 'place', cand, check, remove: best };
  }

  private updateGhost(): void {
    const boat = this.boat;
    const h = this.hover;
    if (!h || h.kind !== 'place') {
      this.removeGhost();
      this.outline.visible = false;
      return;
    }
    const key = `${h.cand.part}|${h.cand.weapon}|${h.cand.facing}|${h.cand.x},${h.cand.y},${h.cand.z}|${h.check.ok}`;
    if (key !== this.ghostKey) {
      this.removeGhost();
      this.ghost = this.makeGhost(h.cand);
      const mat = h.check.ok ? ghostOk : ghostBad;
      this.ghost.traverse((o) => {
        if ((o as Mesh).isMesh) (o as Mesh).material = mat;
      });
      this.ghostKey = key;
    }
    if (this.ghost && this.ghost.parent !== boat.group) boat.group.add(this.ghost);
    // Outline the block under the cursor (the one right-click would remove).
    const target = this.design.parts[h.remove];
    this.outline.position.set(target.x, target.y, target.z);
    this.outline.visible = true;
    if (this.outline.parent !== boat.group) boat.group.add(this.outline);
  }

  private place(h: Extract<Hover, { kind: 'place' }>): void {
    if (!h.check.ok) {
      this.flash(h.check.reason);
      return;
    }
    const cost = partCost(h.cand);
    this.host.pay(cost);
    this.design = { ...this.design, parts: [...this.design.parts, h.cand] };
    this.commit();
    this.host.world.sound.play('hitWood', undefined, undefined, 0.6);
  }

  private remove(index: number): void {
    const check = canRemove(this.design.parts, index);
    if (!check.ok) {
      this.flash(check.reason);
      return;
    }
    const back = refund(this.design.parts[index]);
    this.host.pay({ wood: -back.wood, metal: -back.metal });
    this.design = { ...this.design, parts: this.design.parts.filter((_, i) => i !== index) };
    this.commit();
    this.host.world.sound.play('break', undefined, undefined, 0.4);
    if (back.wood || back.metal) this.flash(`Salvaged ${[back.wood && `${back.wood} wood`, back.metal && `${back.metal} metal`].filter(Boolean).join(', ')}`);
  }

  private commit(): void {
    this.removeGhost();
    this.outline.removeFromParent();
    this.host.rebuild(this.design);
    this.host.onChange();
  }
}
