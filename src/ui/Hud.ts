/** DOM heads-up display: status, schematic, weapons, helm, markers, banners and screens. */

import './hud.css';
import { Vector3, type Camera } from 'three';
import { PLAYER_WEAPON_ORDER, WEAPONS, type WeaponId } from '../weapons/weaponDefs';
import type { Boat } from '../boat/Boat';
import type { Resource } from '../game/Loot';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

const _v = new Vector3();

export class Hud {
  readonly root = el('div', 'hud');
  private readonly hullFill: HTMLElement;
  private readonly hullBar: HTMLElement;
  private readonly boatName: HTMLElement;
  private readonly schematic: HTMLCanvasElement;
  private readonly wood: HTMLElement;
  private readonly metal: HTMLElement;
  private readonly waveNum: HTMLElement;
  private readonly waveSub: HTMLElement;
  private readonly score: HTMLElement;
  private readonly slots: { root: HTMLElement; fill: HTMLElement; bar: HTMLElement; state: HTMLElement }[] = [];
  private readonly speed: HTMLElement;
  private readonly throttle: HTMLElement;
  private readonly crosshair: HTMLElement;
  private readonly reload: HTMLElement;
  private readonly hitmarker: HTMLElement;
  private readonly lead: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly bars = new Map<Boat, HTMLElement>();
  private readonly layer = el('div');
  readonly title: HTMLElement;
  readonly over: HTMLElement;
  readonly pause: HTMLElement;
  private hitTimer = 0;
  private bannerTimer = 0;

  constructor(parent: HTMLElement) {
    const status = el('div', 'panel', '<div class="label">Your vessel</div>');
    this.boatName = el('div', 'name big', 'Dinghy');
    status.append(this.boatName, el('div', 'label', 'Hull'));
    this.hullBar = el('div', 'bar');
    this.hullFill = el('i');
    this.hullBar.append(this.hullFill);
    this.schematic = el('canvas');
    this.schematic.id = 'schematic';
    this.schematic.width = 160;
    this.schematic.height = 130;
    const res = el('div', 'resources');
    this.wood = el('span', 'res wood', '0');
    this.metal = el('span', 'res metal', '0');
    res.append(this.wood, this.metal);
    status.append(this.hullBar, this.schematic, res);
    status.id = 'status';

    const wave = el('div', 'panel');
    wave.id = 'waveinfo';
    wave.append(el('div', 'label', 'Wave'));
    this.waveNum = el('div', 'big', '—');
    this.waveSub = el('div', 'label', '');
    this.score = el('div', '', '0');
    wave.append(this.waveNum, this.waveSub, el('div', 'label', 'Score'), this.score);

    const weapons = el('div', 'panel');
    weapons.id = 'weapons';
    PLAYER_WEAPON_ORDER.forEach((id, i) => {
      const root = el('div', 'slot');
      root.append(el('span', 'key', String(i + 1)), el('span', 'wname', WEAPONS[id].name));
      const bar = el('div', 'bar');
      const fill = el('i');
      bar.append(fill);
      const state = el('div', 'state');
      root.append(bar, state);
      weapons.append(root);
      this.slots.push({ root, fill, bar, state });
    });

    const helm = el('div', 'panel');
    helm.id = 'helm';
    this.speed = el('span', 'big', '0');
    const line = el('div');
    line.append(this.speed, el('span', 'unit', 'knots'));
    const thr = el('div', 'throttle');
    this.throttle = el('i');
    thr.append(this.throttle);
    helm.append(el('div', 'label', 'Speed'), line, el('div', 'label', 'Throttle'), thr);

    this.crosshair = el('div');
    this.crosshair.id = 'crosshair';
    this.reload = el('div', 'reload');
    this.crosshair.append(this.reload);
    this.hitmarker = el('div');
    this.hitmarker.id = 'hitmarker';
    this.lead = el('div');
    this.lead.id = 'lead';
    this.banner = el('div');
    this.banner.id = 'banner';

    this.title = el(
      'div',
      'screen',
      `<div class="card">
        <h1>SALT &amp; SCRAP</h1>
        <p>The fleets are gone. The sea is full of wrecks and raiders.<br/>You have a leaky dinghy and a rusty machine gun.</p>
        <div class="controls">
          <kbd>W / S</kbd><span>Throttle ahead / astern</span>
          <kbd>A / D</kbd><span>Rudder</span>
          <kbd>Mouse</kbd><span>Aim &mdash; <b>Click</b> to fire</span>
          <kbd>1 – 4</kbd><span>Old MG · MG Mk II · Cannon · Harpoon</span>
          <kbd>Right click</kbd><span>Cut harpoon line</span>
          <kbd>R</kbd><span>Patch the boat between waves</span>
          <kbd>Wheel</kbd><span>Zoom · <kbd>Esc</kbd> pause · <kbd>M</kbd> mute</span>
        </div>
        <div class="cta">Click to set sail</div>
      </div>`,
    );
    this.over = el('div', 'screen hidden');
    this.pause = el('div', 'screen hidden', `<div class="card"><h1>PAUSED</h1><p>Press <kbd>Esc</kbd> or click to resume</p></div>`);

    this.root.append(status, wave, weapons, helm, this.layer, this.lead, this.hitmarker, this.crosshair, this.banner);
    parent.append(this.root, this.title, this.over, this.pause);
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? '' : 'none';
  }

  showGameOver(wave: number, score: number, kills: number): void {
    this.over.innerHTML = `<div class="card">
      <h2>SUNK</h2>
      <p>Your boat went down on wave <b>${wave}</b>.<br/>${kills} enemy boat${kills === 1 ? '' : 's'} sent to the bottom · score <b>${score}</b></p>
      <div class="cta">Click to try again</div>
    </div>`;
    this.over.classList.remove('hidden');
  }

  message(big: string, sub = '', seconds = 3): void {
    this.banner.innerHTML = `<div class="big">${big}</div>${sub ? `<div class="sub">${sub}</div>` : ''}`;
    this.banner.style.opacity = '1';
    this.bannerTimer = seconds;
  }

  hit(kill: boolean): void {
    this.hitmarker.classList.toggle('kill', kill);
    this.hitmarker.style.opacity = '1';
    this.hitTimer = kill ? 0.35 : 0.12;
  }

  popup(x: number, y: number, text: string, kind: Resource | 'score'): void {
    const p = el('div', `popup ${kind}`, text);
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    this.layer.append(p);
    setTimeout(() => p.remove(), 1500);
  }

  update(
    dt: number,
    opts: {
      player: Boat | null;
      weapon: WeaponId;
      wood: number;
      metal: number;
      wave: number;
      waveSub: string;
      score: number;
      mouseX: number;
      mouseY: number;
      canBear: boolean;
      lead: { x: number; y: number } | null;
      enemies: Boat[];
      camera: Camera;
      width: number;
      height: number;
    },
  ): void {
    const { player } = opts;
    this.hitTimer -= dt;
    if (this.hitTimer <= 0) this.hitmarker.style.opacity = '0';
    this.bannerTimer -= dt;
    if (this.bannerTimer <= 0) this.banner.style.opacity = '0';

    this.crosshair.style.left = this.hitmarker.style.left = `${opts.mouseX}px`;
    this.crosshair.style.top = this.hitmarker.style.top = `${opts.mouseY}px`;
    this.crosshair.classList.toggle('blocked', !opts.canBear);

    if (opts.lead) {
      this.lead.style.display = 'block';
      this.lead.style.left = `${opts.lead.x}px`;
      this.lead.style.top = `${opts.lead.y}px`;
    } else this.lead.style.display = 'none';

    this.wood.textContent = String(opts.wood);
    this.metal.textContent = String(opts.metal);
    this.waveNum.textContent = opts.wave > 0 ? String(opts.wave) : '—';
    this.waveSub.textContent = opts.waveSub;
    this.score.textContent = opts.score.toLocaleString();

    if (player) {
      this.boatName.textContent = player.design.name;
      const hull = player.stats.hullIntegrity;
      this.hullFill.style.width = `${Math.round(hull * 100)}%`;
      this.hullBar.classList.toggle('warn', hull < 0.6);
      const kts = Math.abs(player.forwardSpeed()) * 1.944;
      this.speed.textContent = kts.toFixed(0);
      const t = player.helm.throttle;
      this.throttle.style.left = t >= 0 ? '50%' : `${50 + t * 50}%`;
      this.throttle.style.width = `${Math.abs(t) * 50}%`;

      const turret = player.turrets[0];
      PLAYER_WEAPON_ORDER.forEach((id, i) => {
        const s = this.slots[i];
        const active = id === opts.weapon;
        s.root.classList.toggle('active', active);
        if (!active || !turret) {
          s.fill.style.width = '100%';
          s.state.textContent = '';
          s.bar.classList.remove('hot');
          return;
        }
        const w = turret.weapon;
        const hot = w.def.heatPerShot > 0;
        s.bar.classList.toggle('hot', hot);
        s.fill.style.width = `${Math.round((hot ? 1 - w.heat : w.readiness) * 100)}%`;
        s.state.textContent = w.jammed ? 'JAMMED' : w.overheated ? 'OVERHEATED' : turret.harpoonOut ? 'LINE OUT' : '';
      });
      if (!turret) this.slots.forEach((s) => (s.state.textContent = 'GUN LOST'));

      const r = turret && turret.def.fireInterval > 1 ? turret.weapon.readiness : 1;
      this.reload.style.background = r < 1 ? `conic-gradient(rgba(242,193,78,0.8) ${r * 360}deg, transparent 0)` : 'none';
      this.reload.style.mask = 'radial-gradient(circle, transparent 58%, #000 60%)';
      this.drawSchematic(player);
    }

    // Enemy health bars.
    for (const [boat, bar] of this.bars) {
      if (!opts.enemies.includes(boat) || !boat.alive) {
        bar.remove();
        this.bars.delete(boat);
      }
    }
    for (const boat of opts.enemies) {
      if (!boat.alive) continue;
      let bar = this.bars.get(boat);
      if (!bar) {
        bar = el('div', 'enemybar', '<i></i>');
        this.layer.append(bar);
        this.bars.set(boat, bar);
      }
      boat.centerWorld(_v);
      _v.y += 3.2;
      _v.project(opts.camera);
      const onScreen = _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
      bar.style.display = onScreen ? 'block' : 'none';
      bar.style.left = `${((_v.x + 1) / 2) * opts.width}px`;
      bar.style.top = `${((1 - _v.y) / 2) * opts.height}px`;
      (bar.firstChild as HTMLElement).style.width = `${Math.round(boat.stats.hullIntegrity * 100)}%`;
    }
  }

  private drawSchematic(boat: Boat): void {
    const c = this.schematic;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    const xs = boat.parts.map((p) => p.x);
    const zs = boat.parts.map((p) => p.z);
    const minX = Math.min(...xs) - 0.5;
    const maxX = Math.max(...xs) + 0.5;
    const minZ = Math.min(...zs) - 0.5;
    const maxZ = Math.max(...zs) + 0.5;
    const cell = Math.min((c.width - 20) / (maxX - minX), (c.height - 20) / (maxZ - minZ), 28);
    const ox = c.width / 2 - ((minX + maxX) / 2) * cell;
    const oy = c.height / 2 + ((minZ + maxZ) / 2) * cell;
    const sorted = [...boat.parts].sort((a, b) => a.y - b.y);
    for (const p of sorted) {
      const x = ox + p.x * cell;
      const y = oy - p.z * cell;
      const f = p.hp / p.def.hp;
      const upper = p.y > 0;
      const size = upper ? cell * 0.62 : cell - 2;
      if (!p.alive) {
        g.strokeStyle = 'rgba(224,73,58,0.8)';
        g.setLineDash([3, 2]);
        g.strokeRect(x - size / 2, y - size / 2, size, size);
        g.setLineDash([]);
        continue;
      }
      const hue = f * 110;
      g.fillStyle = `hsla(${hue}, 70%, ${upper ? 55 : 42}%, ${upper ? 0.95 : 0.85})`;
      g.fillRect(x - size / 2, y - size / 2, size, size);
      if (boat.fires.has(p.index)) {
        g.fillStyle = 'rgba(255,140,40,0.9)';
        g.beginPath();
        g.arc(x, y, 3, 0, Math.PI * 2);
        g.fill();
      }
      if (upper) {
        g.fillStyle = 'rgba(0,0,0,0.55)';
        g.font = `bold ${Math.max(8, cell * 0.36)}px Chakra Petch, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        const letter = p.def.kind === 'mount' ? 'G' : p.def.kind === 'engine' ? 'E' : p.def.kind === 'armor' ? 'A' : 'C';
        g.fillText(letter, x, y + 1);
      }
    }
  }
}
