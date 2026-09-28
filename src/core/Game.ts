/**
 * Top-level game: owns the renderer and every system, runs a fixed-step
 * simulation (60 Hz) and renders each animation frame.
 */

import {
  ACESFilmicToneMapping,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  PCFShadowMap,
  PMREMGenerator,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { Boat } from '../boat/Boat';
import { DESIGNS } from '../boat/designs';
import { EnemyAI } from '../ai/EnemyAI';
import { Sound } from '../audio/Sound';
import { Effects } from '../fx/effects';
import { FlashLights } from '../fx/FlashLights';
import { FoamMap } from '../fx/FoamMap';
import { ParticleSystem } from '../fx/Particles';
import { Debris } from '../game/Debris';
import { Loot } from '../game/Loot';
import { ENEMY_TYPES, WaveManager } from '../game/WaveManager';
import type { World } from '../game/World';
import { CameraRig } from '../render/CameraRig';
import { PostFX } from '../render/PostFX';
import { Hud } from '../ui/Hud';
import { HarpoonSystem } from '../weapons/Harpoon';
import { ProjectileSystem } from '../weapons/Projectiles';
import { leadTarget } from '../weapons/ballistics';
import { PLAYER_WEAPON_ORDER, WEAPONS, type WeaponId } from '../weapons/weaponDefs';
import { ENV } from '../world/environment';
import { Ocean } from '../world/Ocean';
import { Scenery } from '../world/Scenery';
import { createSky } from '../world/Sky';
import { GRAVITY, sampleHeight } from '../world/waves';
import { Input } from './Input';

const STEP = 1 / 60;
type GameState = 'title' | 'playing' | 'paused' | 'over';

const _v = new Vector3();
const _w = new Vector3();

export class Game {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly rig: CameraRig;
  private readonly post: PostFX;
  private readonly input: Input;
  private readonly hud: Hud;
  private readonly ocean: Ocean;
  private readonly sun: DirectionalLight;
  private readonly world: World;
  private readonly glow = new ParticleSystem(9000, true);
  private readonly smoke = new ParticleSystem(9000, false);
  private readonly flash: FlashLights;
  private readonly raycaster = new Raycaster();

  private state: GameState = 'title';
  private waves = new WaveManager();
  private ais: EnemyAI[] = [];
  private weapon: WeaponId = 'mg_old';
  private wood = 10;
  private metal = 5;
  private score = 0;
  private kills = 0;
  private overTimer = 0;
  private accumulator = 0;
  private last = performance.now();
  private readonly aim = new Vector3();
  private readonly enemyScore = new Map<Boat, number>();
  private readonly enemyLoot = new Map<Boat, (typeof ENEMY_TYPES)[keyof typeof ENEMY_TYPES]['loot']>();
  /** exposed for automated smoke tests */
  debug = { steps: 0, frames: 0 };

  constructor(container: HTMLElement) {
    const renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    container.append(renderer.domElement);
    this.renderer = renderer;

    const scene = this.scene;
    scene.background = ENV.fogColor.clone();
    scene.fog = new FogExp2(ENV.fogColor.getHex(), ENV.fogDensity);

    // Lighting: low warm sun through smoke, cool sky fill.
    this.sun = new DirectionalLight(ENV.sunColor, ENV.sunIntensity);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -38;
    sc.right = sc.top = 38;
    sc.near = 1;
    sc.far = 200;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun, this.sun.target);
    scene.add(new HemisphereLight(0x9fb3c0, 0x223036, 1.1));

    // Image-based lighting from the sky for metal reflections.
    const sky = createSky();
    const skyScene = new Scene();
    skyScene.add(sky.clone());
    const pmrem = new PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(skyScene, 0.04).texture;
    scene.environmentIntensity = 0.55;
    scene.add(sky);

    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
    const foam = new FoamMap();
    this.ocean = new Ocean(foam);
    scene.add(this.ocean.near, this.ocean.far);
    scene.add(this.smoke.mesh, this.glow.mesh);
    this.flash = new FlashLights(scene);

    const sound = new Sound();
    const water = {
      height: (x: number, z: number) => sampleHeight(x, z, this.world.time),
      verticalVelocity: (x: number, z: number) => (sampleHeight(x, z, this.world.time + 0.05) - sampleHeight(x, z, this.world.time - 0.05)) / 0.1,
    };
    const effects = new Effects(this.glow, this.smoke, foam, this.flash, sound, this.rig, water.height);
    const projectiles = new ProjectileSystem(scene);
    const harpoons = new HarpoonSystem(scene);
    projectiles.onHarpoonSpawn = (p) => harpoons.spawn(p);
    const loot = new Loot(scene);

    this.hud = new Hud(document.body);
    this.world = {
      scene,
      time: 0,
      water,
      effects,
      sound,
      foam,
      boats: [],
      player: null,
      projectiles,
      harpoons,
      scenery: new Scenery(scene),
      debris: new Debris(scene),
      loot,
      events: {
        hitMarker: (kill) => this.hud.hit(kill),
        playerHit: (amount) => {
          this.post.damage = Math.min(1, this.post.damage + amount / 40);
        },
        boatWrecked: (boat) => this.onWrecked(boat),
        message: (t) => this.hud.message(t),
      },
    };
    loot.onCollect = (kind, amount, at) => {
      if (kind === 'wood') this.wood += amount;
      else this.metal += amount;
      const s = this.toScreen(at);
      if (s) this.hud.popup(s.x, s.y, `+${amount} ${kind.toUpperCase()}`, kind);
    };

    this.post = new PostFX(renderer, scene, this.rig.camera);
    this.post.setSize(window.innerWidth, window.innerHeight, renderer.getPixelRatio());
    this.input = new Input(renderer.domElement);

    window.addEventListener('resize', () => this.resize());
    this.hud.title.addEventListener('click', () => this.begin());
    this.hud.over.addEventListener('click', () => this.begin());
    this.hud.pause.addEventListener('click', () => this.setPaused(false));

    this.spawnPlayer();
    this.hud.setVisible(false);
    requestAnimationFrame((t) => this.loop(t));
  }

  // ---------------------------------------------------------------- setup

  private spawnPlayer(): void {
    const boat = new Boat(DESIGNS.dinghy(), 'player', this.world);
    boat.placeAt(0, 0, Math.PI, this.world.water);
    this.world.scene.add(boat.group);
    this.world.boats.push(boat);
    this.world.player = boat;
    this.weapon = 'mg_old';
    this.rig.snap(boat.body.origin);
  }

  private begin(): void {
    this.world.sound.start();
    if (this.state === 'over' || this.world.player?.state !== 'afloat') this.reset();
    this.state = 'playing';
    this.hud.title.classList.add('hidden');
    this.hud.over.classList.add('hidden');
    this.hud.setVisible(true);
    this.hud.message('SET SAIL', 'Raiders incoming — sink them before they sink you', 3.5);
  }

  private reset(): void {
    const w = this.world;
    for (const b of w.boats) b.dispose(w);
    w.boats.length = 0;
    w.projectiles.clear();
    w.harpoons.clear();
    w.debris.clear();
    w.loot.clear();
    this.ais = [];
    this.enemyScore.clear();
    this.enemyLoot.clear();
    this.waves = new WaveManager();
    this.wood = 10;
    this.metal = 5;
    this.score = 0;
    this.kills = 0;
    this.spawnPlayer();
  }

  private spawnWave(keys: (keyof typeof ENEMY_TYPES)[]): void {
    const player = this.world.player!;
    player.centerWorld(_v);
    const base = Math.random() * Math.PI * 2;
    keys.forEach((key, i) => {
      const type = ENEMY_TYPES[key];
      const boat = new Boat(DESIGNS[type.design](), 'enemy', this.world);
      let x = 0;
      let z = 0;
      for (let tries = 0; tries < 40; tries++) {
        const a = base + (i - keys.length / 2) * 0.5 + (Math.random() - 0.5) * 0.4 + (tries > 10 ? Math.random() * 6 : 0);
        const d = 80 + Math.random() * 25;
        x = _v.x + Math.cos(a) * d;
        z = _v.z + Math.sin(a) * d;
        if (this.world.scenery.isClear(x, z, boat.stats.radius + 6)) break;
      }
      boat.placeAt(x, z, Math.atan2(_v.x - x, _v.z - z), this.world.water);
      this.world.scene.add(boat.group);
      this.world.boats.push(boat);
      boat.damageScale = Math.min(1, 0.55 + this.waves.wave * 0.05);
      this.ais.push(new EnemyAI(boat, type.profile));
      this.enemyScore.set(boat, type.score);
      this.enemyLoot.set(boat, type.loot);
    });
    this.hud.message(`WAVE ${this.waves.wave}`, `${keys.length} hostile boat${keys.length > 1 ? 's' : ''} closing in`, 3);
  }

  private onWrecked(boat: Boat): void {
    if (boat.isPlayer) {
      this.hud.message('ABANDON SHIP', 'She’s going down…', 4);
      this.overTimer = 4;
      return;
    }
    this.kills++;
    const pts = this.enemyScore.get(boat) ?? 100;
    this.score += pts * Math.max(1, this.waves.wave);
    boat.centerWorld(_v);
    const s = this.toScreen(_v);
    if (s) this.hud.popup(s.x, s.y - 30, `+${pts * Math.max(1, this.waves.wave)}`, 'score');
    for (const [kind, amount] of this.enemyLoot.get(boat) ?? []) this.world.loot.drop(_v.x, _v.z, kind, amount);
  }

  // ---------------------------------------------------------------- repair

  /** Between waves the crew patches everything they can afford (hull first). */
  private repair(): void {
    const player = this.world.player;
    if (!player || !player.alive) return;
    const order = { hull: 0, engine: 1, mount: 2, armor: 3, cabin: 4 } as const;
    const parts = [...player.parts].sort((a, b) => order[a.def.kind] - order[b.def.kind]);
    let fixed = 0;
    for (const p of parts) {
      const missing = p.alive ? 1 - p.hp / p.def.hp : 1;
      if (missing <= 0.001) continue;
      const wood = Math.ceil(p.def.cost.wood * missing);
      const metal = Math.ceil(p.def.cost.metal * missing);
      if (wood > this.wood || metal > this.metal) continue;
      this.wood -= wood;
      this.metal -= metal;
      player.restorePart(p);
      fixed++;
    }
    if (fixed) {
      player.recomputeStats();
      player.setAllWeapons(WEAPONS[this.weapon]);
      this.hud.message('PATCHED UP', `${fixed} part${fixed > 1 ? 's' : ''} repaired`, 2);
      this.world.sound.play('pickup');
    } else {
      this.hud.message('NOTHING TO FIX', 'or not enough wood / metal', 2);
    }
  }

  // ---------------------------------------------------------------- loop

  private setPaused(p: boolean): void {
    if (p && this.state === 'playing') {
      this.state = 'paused';
      this.hud.pause.classList.remove('hidden');
    } else if (!p && this.state === 'paused') {
      this.state = 'playing';
      this.hud.pause.classList.add('hidden');
      this.last = performance.now();
    }
  }

  private loop(now: number): void {
    requestAnimationFrame((t) => this.loop(t));
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.handleInput();

    if (this.state !== 'paused') {
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= STEP && steps < 5) {
        this.fixedStep(STEP);
        this.accumulator -= STEP;
        steps++;
      }
      if (steps === 5) this.accumulator = 0;
      this.frame(dt);
    }
    this.render(dt);
    this.input.endFrame();
    this.debug.frames++;
  }

  private handleInput(): void {
    const input = this.input;
    if (input.wasPressed('Escape')) this.setPaused(this.state === 'playing');
    if (input.wasPressed('KeyM')) this.world.sound.setMuted(!this.world.sound.muted);
    if (input.wheel) this.rig.zoom(input.wheel * 0.1);
    if (this.state === 'title' && (input.wasPressed('Enter') || input.wasPressed('Space'))) this.begin();
    if (this.state !== 'playing') return;

    const player = this.world.player;
    if (!player) return;
    for (let i = 0; i < PLAYER_WEAPON_ORDER.length; i++) {
      if (input.wasPressed(`Digit${i + 1}`)) {
        this.weapon = PLAYER_WEAPON_ORDER[i];
        this.world.harpoons.release(player);
        player.setAllWeapons(WEAPONS[this.weapon]);
      }
    }
    if (input.rightPressed) this.world.harpoons.release(player);
    if (input.wasPressed('KeyR')) {
      if (this.waves.phase === 'intermission') this.repair();
      else this.hud.message('UNDER FIRE', 'Repairs only between waves', 1.5);
    }
    if (input.wasPressed('Enter') && this.waves.phase === 'intermission' && this.waves.wave > 0) this.waves.timer = 0;
  }

  private fixedStep(dt: number): void {
    const w = this.world;
    w.time += dt;
    this.debug.steps++;
    const player = w.player;

    if (player && this.state === 'playing' && player.alive) {
      const i = this.input;
      player.helm.throttle = (i.isDown('KeyW') || i.isDown('ArrowUp') ? 1 : 0) - (i.isDown('KeyS') || i.isDown('ArrowDown') ? 1 : 0);
      player.helm.rudder = (i.isDown('KeyD') || i.isDown('ArrowRight') ? 1 : 0) - (i.isDown('KeyA') || i.isDown('ArrowLeft') ? 1 : 0);
      player.aim.copy(this.aim);
      player.trigger = i.leftDown;
    } else if (player) {
      player.trigger = false;
      player.helm.throttle = 0;
      player.helm.rudder = 0;
    }

    if (this.state === 'playing') for (const ai of this.ais) ai.update(dt, w);
    for (const b of w.boats) b.step(dt, w);
    this.collisions();
    w.harpoons.step(dt, w);
    w.projectiles.step(dt, w);

    // Waves.
    if (this.state === 'playing' && player?.alive) {
      const alive = w.boats.filter((b) => b.team === 'enemy' && b.alive).length;
      const prevPhase = this.waves.phase;
      const spawn = this.waves.update(dt, alive, false);
      if (spawn) this.spawnWave(spawn);
      if (prevPhase === 'combat' && this.waves.phase === 'intermission') {
        this.hud.message(`WAVE ${this.waves.wave} CLEARED`, 'Collect the salvage · <kbd>R</kbd> patch the boat · <kbd>Enter</kbd> next wave', 6);
      }
    }

    // Clean up boats that have gone under.
    for (let i = w.boats.length - 1; i >= 0; i--) {
      const b = w.boats[i];
      if (b.state === 'gone' && !b.isPlayer) {
        b.dispose(w);
        w.boats.splice(i, 1);
        this.ais = this.ais.filter((a) => a.boat !== b);
        this.enemyScore.delete(b);
        this.enemyLoot.delete(b);
      }
    }
  }

  /** Boats bump into islands and each other; hard hits damage the parts involved. */
  private collisions(): void {
    const w = this.world;
    for (const b of w.boats) {
      if (b.state === 'gone') continue;
      b.centerWorld(_v);
      const hit = w.scenery.resolve(_v.x, _v.z, b.stats.radius * 0.75);
      if (hit) {
        b.body.origin.x += hit.nx * hit.depth;
        b.body.origin.z += hit.nz * hit.depth;
        const vn = b.body.vel.x * hit.nx + b.body.vel.z * hit.nz;
        if (vn < 0) {
          b.body.vel.x -= hit.nx * vn * 1.3;
          b.body.vel.z -= hit.nz * vn * 1.3;
          if (vn < -2.5) this.ram(b, _w.set(_v.x - hit.nx * b.stats.radius * 0.75, 0, _v.z - hit.nz * b.stats.radius * 0.75), -vn * 7, null);
        }
      }
    }
    for (let i = 0; i < w.boats.length; i++) {
      const a = w.boats[i];
      if (a.state === 'gone') continue;
      for (let j = i + 1; j < w.boats.length; j++) {
        const b = w.boats[j];
        if (b.state === 'gone') continue;
        a.centerWorld(_v);
        b.centerWorld(_w);
        const dx = _w.x - _v.x;
        const dz = _w.z - _v.z;
        const d = Math.hypot(dx, dz);
        const min = (a.stats.radius + b.stats.radius) * 0.72;
        if (d >= min || d < 1e-4) continue;
        const nx = dx / d;
        const nz = dz / d;
        const total = a.body.mass + b.body.mass;
        const pen = min - d;
        a.body.origin.x -= nx * pen * (b.body.mass / total);
        a.body.origin.z -= nz * pen * (b.body.mass / total);
        b.body.origin.x += nx * pen * (a.body.mass / total);
        b.body.origin.z += nz * pen * (a.body.mass / total);
        const rv = (b.body.vel.x - a.body.vel.x) * nx + (b.body.vel.z - a.body.vel.z) * nz;
        if (rv < 0) {
          const j = (-(1 + 0.3) * rv) / (1 / a.body.mass + 1 / b.body.mass);
          a.body.vel.x -= (nx * j) / a.body.mass;
          a.body.vel.z -= (nz * j) / a.body.mass;
          b.body.vel.x += (nx * j) / b.body.mass;
          b.body.vel.z += (nz * j) / b.body.mass;
          if (rv < -2) {
            const contact = _v.clone().add(_w).multiplyScalar(0.5);
            this.ram(a, contact, -rv * 6 * Math.sqrt(b.body.mass / a.body.mass), b);
            this.ram(b, contact, -rv * 6 * Math.sqrt(a.body.mass / b.body.mass), a);
          }
        }
      }
    }
  }

  private ram(boat: Boat, at: Vector3, damage: number, other: Boat | null): void {
    const local = boat.body.worldToLocal(at, new Vector3());
    let best = null;
    let bestD = Infinity;
    for (const p of boat.parts) {
      if (!p.alive) continue;
      const d = Math.hypot(p.x - local.x, p.z - local.z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (!best) return;
    boat.damage(best, damage, 0.3, this.world, other, at);
    this.world.effects.hit(at.clone().setY(this.world.water.height(at.x, at.z) + 0.4), best.def.material, 2);
    this.rig.shake(Math.min(0.5, damage / 60), at.x, at.z);
  }

  /** Per-frame work that doesn't need the fixed step. */
  private frame(dt: number): void {
    const w = this.world;
    const player = w.player;
    this.updateAim();

    for (const b of w.boats) b.animate(dt, w);
    w.debris.update(dt, w);
    w.loot.update(dt, w);
    w.scenery.update(dt, w.time, w.effects, this.rig.focus.x, this.rig.focus.z);
    w.foam.update(dt);
    this.glow.update(dt, ENV.fogColor, ENV.fogDensity);
    this.smoke.update(dt, ENV.fogColor, ENV.fogDensity);
    this.flash.update(dt);

    if (player) {
      player.centerWorld(_v);
      this.rig.update(dt, _v, player.body.vel, this.state === 'playing' ? this.aim : null);
      w.sound.setListener(this.rig.focus.x, this.rig.focus.z);
      w.sound.setEngine(Math.abs(player.helm.throttle), player.alive && player.stats.thrust > 0);
      if (!player.alive && this.state === 'playing') {
        this.overTimer -= dt;
        if (this.overTimer <= 0) {
          this.state = 'over';
          this.hud.setVisible(false);
          this.hud.showGameOver(this.waves.wave, this.score, this.kills);
        }
      }
    }

    const intermission = this.waves.phase === 'intermission' && this.waves.wave > 0;
    const enemies = w.boats.filter((b) => b.team === 'enemy');
    const turret = player?.turrets[0];
    this.hud.update(dt, {
      player,
      weapon: this.weapon,
      wood: this.wood,
      metal: this.metal,
      wave: this.waves.wave,
      waveSub: intermission ? `next wave in ${Math.ceil(this.waves.timer)}s` : `${enemies.filter((e) => e.alive).length} hostiles`,
      score: this.score,
      mouseX: this.input.mouseX,
      mouseY: this.input.mouseY,
      canBear: !turret || turret.canBear,
      lead: this.leadMarker(),
      enemies,
      camera: this.rig.camera,
      width: window.innerWidth,
      height: window.innerHeight,
    });
  }

  /** Mouse ray against the actual wave surface. */
  private updateAim(): void {
    if (!this.input.hasMouse) {
      const p = this.world.player;
      if (p) this.aim.copy(p.body.origin).add(_v.set(0, 0, -20));
      return;
    }
    this.raycaster.setFromCamera(new Vector2(this.input.ndcX, this.input.ndcY), this.rig.camera);
    const ray = this.raycaster.ray;
    let h = 0.4;
    for (let i = 0; i < 3; i++) {
      const t = (h - ray.origin.y) / ray.direction.y;
      ray.at(t, this.aim);
      h = this.world.water.height(this.aim.x, this.aim.z) + 0.4;
    }
    // Snap aim height to an enemy hull under the cursor so MGs don't dip into the water.
    for (const b of this.world.boats) {
      if (b.team === 'player' || !b.alive) continue;
      b.centerWorld(_w);
      if (Math.hypot(_w.x - this.aim.x, _w.z - this.aim.z) < b.stats.radius) this.aim.y = _w.y + 0.25;
    }
  }

  private leadMarker(): { x: number; y: number } | null {
    const player = this.world.player;
    const turret = player?.turrets[0];
    if (!player || !turret || this.state !== 'playing') return null;
    let best: Boat | null = null;
    let bestD = 14;
    for (const b of this.world.boats) {
      if (b.team === 'player' || !b.alive) continue;
      b.centerWorld(_w);
      const d = Math.hypot(_w.x - this.aim.x, _w.z - this.aim.z);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    if (!best) return null;
    best.centerWorld(_w);
    turret.pivotWorld(_v);
    const def = turret.def;
    const lead = leadTarget(_v, { x: _w.x, y: _w.y + 0.4, z: _w.z }, best.body.vel, def.muzzleVelocity, GRAVITY * def.gravityScale);
    return this.toScreen(_w.set(lead.x, lead.y, lead.z));
  }

  private toScreen(p: Vector3): { x: number; y: number } | null {
    const v = p.clone().project(this.rig.camera);
    if (v.z > 1) return null;
    return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight };
  }

  private render(dt: number): void {
    const w = this.world;
    const f = this.rig.focus;
    this.ocean.update(w.time, f.x, f.z);
    w.foam.render(this.renderer, f.x, f.z);
    w.projectiles.render();
    w.harpoons.render(w);
    this.sun.position.copy(f).addScaledVector(ENV.sunDir, 80);
    this.sun.target.position.copy(f);
    this.post.render(dt, w.time);
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.rig.camera.aspect = w / h;
    this.rig.camera.updateProjectionMatrix();
    this.post.setSize(w, h, this.renderer.getPixelRatio());
  }
}

