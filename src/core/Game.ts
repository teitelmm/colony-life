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
import { ENV } from '../world/environment';
import { Ocean } from '../world/Ocean';
import { Scenery } from '../world/Scenery';
import { createSky } from '../world/Sky';
import { GRAVITY, sampleHeight, sampleSurface, type SurfaceSample } from '../world/waves';
import { Input } from './Input';
import type { BoatDesign } from '../boat/parts';
import type { PartInstance } from '../boat/BoatStats';
import { BuildMode } from '../build/BuildMode';
import { BuildHud } from '../ui/BuildHud';
import { Workshop, loadSavedGuns } from '../ui/Workshop';
import { Crew, assignCrew, type Assignment } from '../game/Crew';
import { Repairs } from '../game/Repairs';
import { Fishing, MAX_FISHING_SPEED } from '../game/Fishing';
import type { Prompt } from '../ui/Hud';
import { QualityGovernor, TIERS, type QualityChange, type QualityMode, type Tier } from '../render/Quality';
import { PerfOverlay } from '../ui/PerfOverlay';

const QUALITY_KEY = 'salt-scrap-quality';
function readQualityMode(): QualityMode {
  try {
    const v = localStorage.getItem(QUALITY_KEY);
    if (v === 'auto' || v === 'low' || v === 'medium' || v === 'high') return v;
  } catch {
    /* storage blocked */
  }
  return 'auto';
}
function writeQualityMode(mode: QualityMode): void {
  try {
    localStorage.setItem(QUALITY_KEY, mode);
  } catch {
    /* storage blocked: the choice lasts this session */
  }
}

const START = { wood: 24, metal: 14, food: 12, crew: 2 };

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
  private readonly res = { wood: START.wood, metal: START.metal };
  private crew = new Crew(START.crew, START.food);
  private assignment: Assignment = { repairers: 0, gunners: 0, fisher: false, idle: 0 };
  private readonly repairs = new Repairs();
  private readonly fishing: Fishing;
  private readonly build: BuildMode;
  private readonly buildHud: BuildHud;
  private readonly workshop: Workshop;
  private score = 0;
  private kills = 0;
  private rescued = 0;
  private overTimer = 0;
  private accumulator = 0;
  private last = performance.now();
  private readonly aim = new Vector3();
  private readonly enemyScore = new Map<Boat, number>();
  private readonly enemyLoot = new Map<Boat, (typeof ENEMY_TYPES)[keyof typeof ENEMY_TYPES]['loot']>();
  /** exposed for automated smoke tests */
  debug = { steps: 0, frames: 0, simMs: 0, frameMs: 0 };
  readonly quality = new QualityGovernor(readQualityMode());
  private readonly perf = new PerfOverlay(document.body);
  private appliedTier: Tier | null = null;

  constructor(container: HTMLElement) {
    const renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
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
    // Tight shadow frustum around the view: fewer casters, sharper shadows.
    sc.left = sc.bottom = -30;
    sc.right = sc.top = 30;
    sc.near = 20;
    sc.far = 140;
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
      surface: (x: number, z: number, out: SurfaceSample) => sampleSurface(x, z, this.world.time, out),
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
      const s = this.toScreen(at);
      if (kind === 'survivor') {
        const player = this.world.player!;
        if (!this.crew.join(player.stats.berths)) {
          if (s) this.hud.popup(s.x, s.y, 'NO FREE BUNK', 'bad');
          return false;
        }
        this.rescued++;
        if (s) this.hud.popup(s.x, s.y, '+1 CREW', 'survivor');
        return true;
      }
      this.res[kind] += amount;
      if (s) this.hud.popup(s.x, s.y, `+${amount} ${kind.toUpperCase()}`, kind);
      return true;
    };
    this.hud.onSchematicClick = (part) => this.orderRepair(part);
    this.hud.onQualityMode = (mode) => this.setQualityMode(mode);
    this.hud.setQualityMode(this.quality.mode);

    this.fishing = new Fishing(scene);
    loadSavedGuns();

    this.post = new PostFX(renderer, scene, this.rig.camera);
    this.applyQuality({ tier: this.quality.tier, scale: this.quality.scale });
    this.input = new Input(renderer.domElement);

    this.build = new BuildMode({
      world: this.world,
      camera: this.rig.camera,
      input: this.input,
      wallet: () => this.res,
      pay: (c) => {
        this.res.wood -= c.wood;
        this.res.metal -= c.metal;
      },
      rebuild: (d) => this.replacePlayer(d),
      onChange: () => this.buildHud.refresh(this.res),
    });
    this.buildHud = new BuildHud(document.body, this.build);
    this.buildHud.onDone = () => this.toggleBuild();
    this.workshop = new Workshop(document.body);
    this.buildHud.onWorkshop = () => this.workshop.open();
    this.workshop.onSaved = (def) => {
      this.build.selectWeapon(def.id);
      this.hud.message('DESIGN SAVED', `${def.name} is ready to fit to a mount`, 2.5);
    };

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
    this.hookPlayer(boat);
    this.rig.snap(boat.body.origin);
  }

  /** Crew at a gun or on a repair die when that block is blown away. */
  private hookPlayer(boat: Boat): void {
    boat.onPartDestroyed = (part: PartInstance) => {
      let lost = 0;
      const gun = boat.turrets.find((t) => t.part === part);
      // The captain at the first gun ducks; a gunner at any other gun is lost with it.
      if (gun?.manned && gun !== boat.turrets[0]) lost++;
      if (this.repairs.onDestroyed(part, this.assignment.repairers)) lost++;
      if (!lost || !boat.alive) return;
      this.crew.lose(lost);
      boat.body.localToWorld(_w.set(part.x, part.y, part.z), _w);
      const s = this.toScreen(_w);
      if (s) this.hud.popup(s.x, s.y - 20, lost > 1 ? `${lost} CREW LOST` : 'CREW LOST', 'bad');
    };
  }

  /** Swap the player's boat for a rebuilt one in the same spot (build mode). */
  private replacePlayer(design: BoatDesign): Boat {
    const w = this.world;
    const old = w.player!;
    const boat = new Boat(design, 'player', w);
    boat.body.origin.copy(old.body.origin);
    boat.body.quat.copy(old.body.quat);
    boat.body.vel.copy(old.body.vel);
    boat.body.angVel.copy(old.body.angVel);
    boat.syncGroup();
    old.dispose(w);
    w.boats[w.boats.indexOf(old)] = boat;
    w.player = boat;
    w.scene.add(boat.group);
    this.hookPlayer(boat);
    this.repairs.clear();
    return boat;
  }

  private toggleBuild(): void {
    const w = this.world;
    const player = w.player;
    if (this.build.active) {
      this.build.exit();
      this.workshop.close();
      this.buildHud.show(false);
      document.body.classList.remove('building');
      this.hud.message('LAUNCHED', `${player?.stats.guns ?? 0} gun${player?.stats.guns === 1 ? '' : 's'} · ${this.crew.count} crew aboard`, 2);
      return;
    }
    if (this.state !== 'playing' || !player?.alive) return;
    if (this.waves.phase !== 'intermission' || w.boats.some((b) => b.team === 'enemy' && b.alive)) {
      this.hud.message('NOT NOW', 'You can only build between waves', 1.5);
      return;
    }
    this.build.enter();
    this.buildHud.show(true);
    this.buildHud.refresh(this.res);
    document.body.classList.add('building');
  }

  private orderRepair(part: PartInstance): void {
    const player = this.world.player;
    if (!player?.alive || this.build.active) return;
    const on = this.repairs.toggle(player, part);
    if (on && this.crew.count === 0) this.hud.message('NO CREW', 'There is nobody aboard to send', 1.5);
  }

  private begin(): void {
    this.world.sound.start();
    if (this.state === 'over' || this.world.player?.state !== 'afloat') this.reset();
    this.state = 'playing';
    this.hud.title.classList.add('hidden');
    this.hud.over.classList.add('hidden');
    this.hud.setVisible(true);
    this.hud.message('SET SAIL', 'Fish, build and patch up. Raiders arrive soon; <kbd>Enter</kbd> to face them now', 5);
  }

  private reset(): void {
    const w = this.world;
    for (const b of w.boats) b.dispose(w);
    w.boats.length = 0;
    w.projectiles.clear();
    w.harpoons.clear();
    w.debris.clear();
    w.loot.clear();
    this.repairs.clear();
    this.fishing.clear();
    if (this.build.active) this.toggleBuild();
    this.crew = new Crew(START.crew, START.food);
    this.rescued = 0;
    this.ais = [];
    this.enemyScore.clear();
    this.enemyLoot.clear();
    this.waves = new WaveManager();
    this.res.wood = START.wood;
    this.res.metal = START.metal;
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
    // Some of her crew make it into the water.
    const survivors = Math.max(1, Math.round(boat.turrets.length * 0.6 + Math.random()));
    for (let i = 0; i < survivors; i++) this.world.loot.survivor(_v.x + (Math.random() - 0.5) * 4, _v.z + (Math.random() - 0.5) * 4);
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
    const realDt = Math.max(0, (now - this.last) / 1000);
    const dt = Math.min(0.1, realDt);
    this.last = now;
    this.handleInput();

    if (this.input.wasPressed('Backquote')) this.perf.toggle();
    const t0 = performance.now();
    if (this.state !== 'paused') {
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= STEP && steps < 5) {
        this.fixedStep(STEP);
        this.accumulator -= STEP;
        steps++;
      }
      if (steps === 5) this.accumulator = 0;
      const t1 = performance.now();
      this.frame(dt);
      this.debug.simMs += (t1 - t0 - this.debug.simMs) * 0.1;
      this.debug.frameMs += (performance.now() - t1 - this.debug.frameMs) * 0.1;
    }
    this.render(dt);
    this.input.endFrame();
    this.debug.frames++;

    // Trade resolution and effects for frame rate while the tab is visible.
    if (!document.hidden) {
      const change = this.quality.sample(Math.min(1, realDt));
      if (change) this.applyQuality(change);
    }
    this.perf.update(this.quality, this.debug, this.renderer);
  }

  /** Switch between Auto and a fixed graphics tier (pause menu). */
  setQualityMode(mode: QualityMode): void {
    writeQualityMode(mode);
    this.applyQuality(this.quality.setMode(mode));
    this.hud.setQualityMode(mode);
  }

  private applyQuality(c: QualityChange): void {
    const s = TIERS[c.tier];
    const r = this.renderer;
    const pr = Math.min(window.devicePixelRatio, s.maxPixelRatio);
    if (this.appliedTier !== c.tier) {
      this.appliedTier = c.tier;
      const shadows = s.shadowMap > 0;
      if (r.shadowMap.enabled !== shadows) {
        r.shadowMap.enabled = shadows;
        // Materials bake shadow support into their shaders.
        this.scene.traverse((o) => {
          const m = (o as { material?: { needsUpdate: boolean } | { needsUpdate: boolean }[] }).material;
          if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
          else if (m) m.needsUpdate = true;
        });
      }
      this.sun.castShadow = shadows;
      if (shadows && this.sun.shadow.mapSize.x !== s.shadowMap) {
        this.sun.shadow.mapSize.set(s.shadowMap, s.shadowMap);
        this.sun.shadow.map?.dispose();
        this.sun.shadow.map = null;
      }
      this.world.foam.setResolution(s.foamResolution);
      this.ocean.setDetail(s.oceanDetail);
      this.ocean.setSegments(c.tier === 'high' ? 320 : c.tier === 'medium' ? 240 : 180);
      this.glow.density = this.smoke.density = s.particles;
      this.post.setQuality(s.msaa, s.bloom, s.bloomScale);
    }
    r.setPixelRatio(pr);
    r.setSize(window.innerWidth, window.innerHeight);
    this.post.setSize(window.innerWidth, window.innerHeight, pr * c.scale);
  }

  private handleInput(): void {
    const input = this.input;
    if (input.wasPressed('Escape')) {
      if (this.workshop.isOpen) this.workshop.close();
      else if (this.build.active) this.toggleBuild();
      else this.setPaused(this.state === 'playing');
    }
    if (input.wasPressed('KeyM')) this.world.sound.setMuted(!this.world.sound.muted);
    if (input.wheel && !this.build.active) this.rig.zoom(input.wheel * 0.1);
    if (this.state === 'title' && (input.wasPressed('Enter') || input.wasPressed('Space'))) this.begin();
    if (this.state !== 'playing') return;

    const player = this.world.player;
    if (!player) return;
    if (input.wasPressed('KeyB')) this.toggleBuild();
    if (this.build.active) return;
    if (input.rightPressed) this.world.harpoons.release(player);
    if (input.wasPressed('KeyR') && player.alive) {
      const n = this.repairs.queueAll(player);
      if (n) this.hud.message('ALL HANDS', `${n} repair${n > 1 ? 's' : ''} ordered${player.turrets.length > 1 && this.crew.count <= this.repairs.jobs.length ? ' · gun crews will leave their guns' : ''}`, 1.8);
      else this.hud.message('SHIPSHAPE', 'Nothing needs fixing', 1.2);
    }
    if (input.wasPressed('Enter') && this.waves.phase === 'intermission') this.waves.timer = 0;
  }

  private fixedStep(dt: number): void {
    const w = this.world;
    w.time += dt;
    this.debug.steps++;
    const player = w.player;

    if (player && this.state === 'playing' && player.alive && !this.build.active) {
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

    // Crew: eat, recruit, then take up stations: repair orders, guns, nets.
    if (player && this.state === 'playing' && player.alive) {
      if (!this.build.active) {
        for (const e of this.crew.update(dt, player.stats.berths)) this.crewEvent(e);
      }
      // The captain always works the first gun; crew man the rest.
      this.assignment = assignCrew(this.crew.count, this.repairs.jobs.length, Math.max(0, player.turrets.length - 1));
      player.turrets.forEach((t, i) => t.setManned(i === 0 || i <= this.assignment.gunners));
      this.repairs.update(dt, w, player, this.assignment.repairers, this.crew.efficiency, this.res);
    }
    for (const b of w.boats) b.step(dt, w);
    this.collisions();
    w.harpoons.step(dt, w);
    w.projectiles.step(dt, w);

    // Waves (the clock stops while you're in the shipyard).
    if (this.state === 'playing' && player?.alive && !this.build.active) {
      const alive = w.boats.filter((b) => b.team === 'enemy' && b.alive).length;
      const prevPhase = this.waves.phase;
      const spawn = this.waves.update(dt, alive, false);
      if (spawn) this.spawnWave(spawn);
      if (prevPhase === 'combat' && this.waves.phase === 'intermission') {
        this.hud.message(`WAVE ${this.waves.wave} CLEARED`, 'Pick up salvage and survivors · <kbd>B</kbd> build · <kbd>Enter</kbd> next wave', 6);
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

  private crewEvent(e: string): void {
    const c = this.crew;
    if (e === 'recruited') this.hud.message('NEW HAND', `A drifter signs on for food · ${c.count} crew`, 2.5);
    else if (e === 'hungry') this.hud.message('OUT OF FOOD', 'Fish on a school (hold <kbd>F</kbd>) or the crew will desert', 4);
    else if (e === 'deserted') this.hud.message('DESERTER', `A hungry hand jumped ship · ${c.count} crew left`, 3);
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
    const building = this.build.active;
    if (!building) this.updateAim();

    for (const b of w.boats) b.animate(dt, w);
    w.debris.update(dt, w);
    w.loot.update(dt, w);
    w.scenery.update(dt, w.time, w.effects, this.rig.focus.x, this.rig.focus.z);

    // Fishing: hold F while stopped on a school.
    if (player && this.state === 'playing') {
      const hauling = !building && player.alive && this.input.isDown('KeyF');
      const rate = (1 + player.stats.fishing) * (this.assignment.fisher ? 1 : 0.5) * this.crew.efficiency;
      const haul = this.fishing.update(dt, w, player, hauling, rate);
      if (haul) this.onHaul(haul);
    }

    w.foam.update(dt);
    this.glow.update(dt, ENV.fogColor, ENV.fogDensity);
    this.smoke.update(dt, ENV.fogColor, ENV.fogDensity);
    this.flash.update(dt);

    if (player) {
      player.centerWorld(_v);
      if (building) {
        this.build.update(dt);
        this.rig.snap(_v);
        this.buildHud.updateTip(this.input.mouseX, this.input.mouseY);
      } else {
        this.rig.update(dt, _v, player.body.vel, this.state === 'playing' ? this.aim : null);
      }
      w.sound.setListener(_v.x, _v.z);
      w.sound.setEngine(Math.abs(player.helm.throttle), player.alive && player.stats.thrust > 0);
      if (!player.alive && this.state === 'playing') {
        this.overTimer -= dt;
        if (this.overTimer <= 0) {
          this.state = 'over';
          this.hud.setVisible(false);
          this.hud.showGameOver(this.waves.wave, this.score, this.kills, this.rescued);
        }
      }
    }

    const intermission = this.waves.phase === 'intermission';
    const enemies = w.boats.filter((b) => b.team === 'enemy');
    const turret = player?.turrets[0];
    const berths = player?.stats.berths ?? 2;
    this.hud.update(dt, {
      player,
      crew: {
        count: this.crew.count,
        berths,
        food: this.crew.food,
        starving: this.crew.starving,
        recruitEta: this.crew.recruitEta(berths),
        gunners: this.assignment.gunners,
        repairers: this.assignment.repairers,
      },
      jobStatus: (p) => this.repairs.status(p),
      wood: this.res.wood,
      metal: this.res.metal,
      wave: this.waves.wave,
      waveSub: intermission ? `${this.waves.wave ? 'next' : 'first'} wave in ${Math.ceil(this.waves.timer)}s` : `${enemies.filter((e) => e.alive).length} hostiles`,
      score: this.score,
      mouseX: this.input.mouseX,
      mouseY: this.input.mouseY,
      canBear: !turret || turret.canBear,
      lead: building ? null : this.leadMarker(),
      enemies,
      camera: this.rig.camera,
      width: window.innerWidth,
      height: window.innerHeight,
      prompt: this.prompt(),
      building,
    });
  }

  private onHaul(h: { food: number; wood: number; metal: number }): void {
    this.crew.food += h.food;
    this.res.wood += h.wood;
    this.res.metal += h.metal;
    const player = this.world.player!;
    player.centerWorld(_v);
    _v.y += 1.5;
    const s = this.toScreen(_v);
    if (!s) return;
    this.hud.popup(s.x, s.y, `+${h.food} FOOD`, 'food');
    if (h.wood) this.hud.popup(s.x + 40, s.y + 18, `+${h.wood} WOOD`, 'wood');
    if (h.metal) this.hud.popup(s.x + 40, s.y + 18, `+${h.metal} METAL`, 'metal');
    this.world.sound.play('pickup');
  }

  /** Contextual hint above the gun bar. */
  private prompt(): Prompt | null {
    const player = this.world.player;
    if (!player?.alive || this.state !== 'playing' || this.build.active) return null;
    if (this.fishing.active) return { text: 'Hauling in the net…', progress: this.fishing.progress };
    if (this.fishing.schoolAt(player)) {
      return Math.abs(player.forwardSpeed()) < MAX_FISHING_SPEED
        ? { text: 'Fish below · hold <kbd>F</kbd> to fish', progress: this.fishing.progress }
        : { text: 'Fish below · stop the boat to fish' };
    }
    const damaged = player.parts.some((p) => !p.alive || p.hp < p.def.hp * 0.7);
    if (this.waves.phase === 'intermission') {
      return { text: `<kbd>B</kbd> build · ${damaged ? '<kbd>R</kbd> repair · ' : ''}<kbd>Enter</kbd> next wave · gulls mark fish` };
    }
    if (damaged && !this.repairs.jobs.length) return { text: 'Damaged · <kbd>R</kbd> or click the diagram to send crew' };
    return null;
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
    this.rig.camera.aspect = window.innerWidth / window.innerHeight;
    this.rig.camera.updateProjectionMatrix();
    this.applyQuality({ tier: this.quality.tier, scale: this.quality.scale });
  }
}

