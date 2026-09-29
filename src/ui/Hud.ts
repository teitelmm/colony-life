/** DOM heads-up display: status, clickable schematic, guns, helm, prompts, markers and screens. */

import './hud.css';
import { Vector3, type Camera } from 'three';
import type { Boat } from '../boat/Boat';
import type { PartInstance } from '../boat/BoatStats';
import type { LootKind } from '../game/Loot';
import type { JobStatus } from '../game/Repairs';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

const _v = new Vector3();

/** DOM writes cost layout and style work: skip them when nothing changed. */
function setText(e: HTMLElement, v: string): void {
  if (e.textContent !== v) e.textContent = v;
}
const htmlCache = new WeakMap<HTMLElement, string>();
function setHTML(e: HTMLElement, v: string): void {
  if (htmlCache.get(e) !== v) {
    htmlCache.set(e, v);
    e.innerHTML = v;
  }
}
function setStyle(e: HTMLElement, prop: 'display' | 'width' | 'left' | 'background', v: string): void {
  if (e.style[prop] !== v) e.style[prop] = v;
}

export interface CrewInfo {
  count: number;
  berths: number;
  food: number;
  starving: boolean;
  recruitEta: number | null;
  gunners: number;
  repairers: number;
}

export interface Prompt {
  text: string;
  progress?: number;
}

export interface HudState {
  player: Boat | null;
  crew: CrewInfo;
  jobStatus: (p: PartInstance) => JobStatus | null;
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
  prompt: Prompt | null;
  building: boolean;
}

interface Layout {
  ox: number;
  oy: number;
  cell: number;
}

export class Hud {
  readonly root = el('div', 'hud');
  private readonly hullFill: HTMLElement;
  private readonly hullBar: HTMLElement;
  private readonly boatName: HTMLElement;
  private readonly schematic: HTMLCanvasElement;
  private readonly wood: HTMLElement;
  private readonly metal: HTMLElement;
  private readonly food: HTMLElement;
  private readonly crewLine: HTMLElement;
  private readonly crewNote: HTMLElement;
  private readonly waveNum: HTMLElement;
  private readonly waveSub: HTMLElement;
  private readonly score: HTMLElement;
  private readonly guns: HTMLElement;
  private gunKey = '';
  private gunRows: { fill: HTMLElement; bar: HTMLElement; state: HTMLElement }[] = [];
  private readonly speed: HTMLElement;
  private readonly throttle: HTMLElement;
  private readonly crosshair: HTMLElement;
  private readonly reload: HTMLElement;
  private readonly hitmarker: HTMLElement;
  private readonly lead: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly promptText: HTMLElement;
  private readonly promptFill: HTMLElement;
  private readonly bars = new Map<Boat, HTMLElement>();
  private readonly layer = el('div');
  private readonly combatPanels: HTMLElement[];
  readonly title: HTMLElement;
  readonly over: HTMLElement;
  readonly pause: HTMLElement;
  private hitTimer = 0;
  private bannerTimer = 0;
  private layout: Layout = { ox: 0, oy: 0, cell: 1 };
  private lastPlayer: Boat | null = null;
  /** picked a graphics mode on the pause screen */
  onQualityMode: ((mode: 'auto' | 'low' | 'medium' | 'high') => void) | null = null;

  setQualityMode(mode: string): void {
    this.pause.querySelectorAll<HTMLButtonElement>('.gfxbtn').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  }

  /** clicked a block on the schematic */
  onSchematicClick: ((part: PartInstance) => void) | null = null;

  constructor(parent: HTMLElement) {
    const status = el('div', 'panel', '<div class="label">Your vessel</div>');
    status.id = 'status';
    this.boatName = el('div', 'name big', 'Dinghy');
    status.append(this.boatName, el('div', 'label', 'Hull'));
    this.hullBar = el('div', 'bar');
    this.hullFill = el('i');
    this.hullBar.append(this.hullFill);
    this.schematic = el('canvas');
    this.schematic.id = 'schematic';
    this.schematic.width = 190;
    this.schematic.height = 150;
    this.schematic.title = 'Click a damaged block to send crew to repair it';
    this.schematic.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      const part = this.partAt(e.offsetX, e.offsetY);
      if (part) this.onSchematicClick?.(part);
    });
    const hint = el('div', 'hint', 'Click a block to repair · <kbd>R</kbd> repair all');
    const res = el('div', 'resources');
    this.wood = el('span', 'res wood', '0');
    this.metal = el('span', 'res metal', '0');
    this.food = el('span', 'res food', '0');
    res.append(this.wood, this.metal, this.food);
    this.crewLine = el('div', 'crew');
    this.crewNote = el('div', 'label crewnote');
    status.append(this.hullBar, this.schematic, hint, res, this.crewLine, this.crewNote);

    const wave = el('div', 'panel');
    wave.id = 'waveinfo';
    wave.append(el('div', 'label', 'Wave'));
    this.waveNum = el('div', 'big', '—');
    this.waveSub = el('div', 'label', '');
    this.score = el('div', '', '0');
    wave.append(this.waveNum, this.waveSub, el('div', 'label', 'Score'), this.score);

    this.guns = el('div', 'panel');
    this.guns.id = 'weapons';

    const helm = el('div', 'panel');
    helm.id = 'helm';
    this.speed = el('span', 'big', '0');
    const line = el('div');
    line.append(this.speed, el('span', 'unit', 'knots'));
    const thr = el('div', 'throttle');
    this.throttle = el('i');
    thr.append(this.throttle);
    helm.append(el('div', 'label', 'Speed'), line, el('div', 'label', 'Throttle'), thr);

    this.prompt = el('div', 'panel');
    this.prompt.id = 'prompt';
    this.promptText = el('div');
    const pbar = el('div', 'bar');
    this.promptFill = el('i');
    pbar.append(this.promptFill);
    this.prompt.append(this.promptText, pbar);

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
        <p>The fleets are gone. The sea is full of wrecks and raiders.<br/>You have a leaky dinghy, a rusty machine gun and two deckhands.<br/>You work the first gun yourself; your crew man the rest, fish and make repairs.</p>
        <div class="controls">
          <kbd>W A S D</kbd><span>Throttle and rudder</span>
          <kbd>Mouse</kbd><span>Aim &mdash; <b>click</b> to fire every manned gun</span>
          <kbd>R</kbd><span>Send crew to repair everything (or click the damage diagram)</span>
          <kbd>F</kbd><span>Hold on a fish school to fish for food and scrap</span>
          <kbd>B</kbd><span>Build mode between waves: add hull, guns, engines, bunks</span>
          <kbd>Enter</kbd><span>Start the next wave</span>
          <kbd>Right click</kbd><span>Cut a harpoon line</span>
          <kbd>Wheel</kbd><span>Zoom · <kbd>Esc</kbd> pause · <kbd>M</kbd> mute</span>
        </div>
        <div class="cta">Click to set sail</div>
      </div>`,
    );
    this.over = el('div', 'screen hidden');
    this.pause = el('div', 'screen hidden', `<div class="card"><h1>PAUSED</h1><p>Press <kbd>Esc</kbd> or click to resume</p></div>`);
    const gfx = el('div', 'gfx', '<span class="label">Graphics</span>');
    for (const mode of ['auto', 'low', 'medium', 'high'] as const) {
      const b = el('button', 'gfxbtn', mode === 'auto' ? 'Auto' : mode[0].toUpperCase() + mode.slice(1));
      b.dataset.mode = mode;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onQualityMode?.(mode);
      });
      gfx.append(b);
    }
    gfx.append(el('div', 'label gfxnote', 'Auto lowers resolution and effects to keep the game smooth · <kbd>`</kbd> shows frame rate'));
    this.pause.firstElementChild!.append(gfx);

    this.combatPanels = [helm, this.guns, this.crosshair, this.lead, this.hitmarker];
    this.root.append(status, wave, this.guns, helm, this.prompt, this.layer, this.lead, this.hitmarker, this.crosshair, this.banner);
    parent.append(this.root, this.title, this.over, this.pause);
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? '' : 'none';
  }

  showGameOver(wave: number, score: number, kills: number, rescued: number): void {
    this.over.innerHTML = `<div class="card">
      <h2>SUNK</h2>
      <p>Your boat went down on wave <b>${wave}</b>.<br/>${kills} enemy boat${kills === 1 ? '' : 's'} sent to the bottom · ${rescued} sailor${rescued === 1 ? '' : 's'} rescued · score <b>${score}</b></p>
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

  popup(x: number, y: number, text: string, kind: LootKind | 'score' | 'food' | 'bad'): void {
    const p = el('div', `popup ${kind}`, text);
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    this.layer.append(p);
    setTimeout(() => p.remove(), 1500);
  }

  update(dt: number, s: HudState): void {
    this.hitTimer -= dt;
    if (this.hitTimer <= 0) this.hitmarker.style.opacity = '0';
    this.bannerTimer -= dt;
    if (this.bannerTimer <= 0) this.banner.style.opacity = '0';
    for (const p of this.combatPanels) p.style.visibility = s.building ? 'hidden' : '';

    // Cursor-bound markers move every frame, via transforms (no layout).
    const xy = `translate(${s.mouseX}px, ${s.mouseY}px)`;
    this.crosshair.style.transform = this.hitmarker.style.transform = xy;
    this.crosshair.classList.toggle('blocked', !s.canBear);
    if (s.lead) {
      this.lead.style.display = 'block';
      this.lead.style.transform = `translate(${s.lead.x}px, ${s.lead.y}px) rotate(45deg)`;
    } else this.lead.style.display = 'none';

    // Everything else is read, not tracked: refresh it ten times a second.
    this.slowTimer -= dt;
    if (this.slowTimer <= 0) {
      this.slowTimer = 0.1;
      this.updateText(s);
    }
    this.updateEnemyBars(s);
  }

  private slowTimer = 0;

  private updateText(s: HudState): void {
    const { player } = s;
    setText(this.wood, String(Math.floor(s.wood)));
    setText(this.metal, String(Math.floor(s.metal)));
    setText(this.food, String(Math.floor(s.crew.food)));
    this.food.classList.toggle('warn', s.crew.food <= s.crew.count);
    const c = s.crew;
    setHTML(this.crewLine, `<b>${c.count}</b> crew · <b>${c.berths}</b> bunks`);
    setText(
      this.crewNote,
      c.starving
        ? 'Starving: work is slow, hands will desert'
        : c.recruitEta !== null
          ? `A drifter signs on in ${Math.ceil(c.recruitEta)}s`
          : c.count >= c.berths
            ? 'Bunks full · build a bunk cabin for more crew'
            : 'Need 4 food to take on a drifter',
    );
    this.crewNote.classList.toggle('warn', c.starving);
    setText(this.waveNum, s.wave > 0 ? String(s.wave) : '—');
    setText(this.waveSub, s.waveSub);
    setText(this.score, s.score.toLocaleString());

    if (s.prompt) {
      setStyle(this.prompt, 'display', 'block');
      setHTML(this.promptText, s.prompt.text);
      setStyle(this.promptFill.parentElement!, 'display', s.prompt.progress === undefined ? 'none' : 'block');
      setStyle(this.promptFill, 'width', `${Math.round((s.prompt.progress ?? 0) * 100)}%`);
    } else setStyle(this.prompt, 'display', 'none');

    if (player) {
      this.lastPlayer = player;
      setText(this.boatName, player.design.name);
      const hull = player.stats.hullIntegrity;
      setStyle(this.hullFill, 'width', `${Math.round(hull * 100)}%`);
      this.hullBar.classList.toggle('warn', hull < 0.6);
      setText(this.speed, (Math.abs(player.forwardSpeed()) * 1.944).toFixed(0));
      const t = player.helm.throttle;
      setStyle(this.throttle, 'left', t >= 0 ? '50%' : `${50 + t * 50}%`);
      setStyle(this.throttle, 'width', `${Math.abs(t) * 50}%`);
      this.updateGuns(player);
      const slow = player.turrets.find((tt) => tt.def.fireInterval > 1);
      const r = slow ? Math.round(slow.weapon.readiness * 40) / 40 : 1;
      setStyle(this.reload, 'background', r < 1 ? `conic-gradient(rgba(242,193,78,0.8) ${r * 360}deg, transparent 0)` : 'none');
      this.drawSchematic(player, s.jobStatus);
    }
  }

  private updateEnemyBars(s: HudState): void {

    // Enemy health bars.
    for (const [boat, bar] of this.bars) {
      if (!s.enemies.includes(boat) || !boat.alive) {
        bar.remove();
        this.bars.delete(boat);
      }
    }
    for (const boat of s.enemies) {
      if (!boat.alive) continue;
      let bar = this.bars.get(boat);
      if (!bar) {
        bar = el('div', 'enemybar', '<i></i>');
        this.layer.append(bar);
        this.bars.set(boat, bar);
      }
      boat.centerWorld(_v);
      _v.y += 3.2;
      _v.project(s.camera);
      const onScreen = _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
      setStyle(bar, 'display', onScreen ? 'block' : 'none');
      if (!onScreen) continue;
      bar.style.transform = `translate(${(((_v.x + 1) / 2) * s.width).toFixed(1)}px, ${(((1 - _v.y) / 2) * s.height).toFixed(1)}px)`;
      setStyle(bar.firstChild as HTMLElement, 'width', `${Math.round(boat.stats.hullIntegrity * 100)}%`);
    }
  }

  /** One row per mounted gun: name, heat or reload, and whether anyone is manning it. */
  private updateGuns(player: Boat): void {
    const turrets = player.turrets;
    const key = turrets.map((t) => `${t.part.index}:${t.def.id}`).join('|');
    if (key !== this.gunKey) {
      this.gunKey = key;
      this.guns.innerHTML = '';
      this.gunRows = turrets.slice(0, 8).map((t) => {
        const row = el('div', 'slot');
        row.append(el('span', 'wname', t.def.name));
        const bar = el('div', 'bar');
        const fill = el('i');
        bar.append(fill);
        const state = el('div', 'state');
        row.append(bar, state);
        this.guns.append(row);
        return { fill, bar, state };
      });
      if (!turrets.length) this.guns.append(el('div', 'slot active', '<span class="wname">No guns</span><div class="state">Build a mount (B)</div>'));
    }
    turrets.slice(0, 8).forEach((t, i) => {
      const row = this.gunRows[i];
      const w = t.weapon;
      const hot = w.def.heatPerShot > 0;
      row.bar.classList.toggle('hot', hot);
      setStyle(row.fill, 'width', `${Math.round((hot ? 1 - w.heat : w.readiness) * 100)}%`);
      row.state.textContent = !t.manned ? 'NO GUNNER' : w.jammed ? 'JAMMED' : w.overheated ? 'OVERHEATED' : t.harpoonOut ? 'LINE OUT' : !t.canBear ? 'OUT OF ARC' : '';
      row.state.parentElement!.classList.toggle('active', t.manned);
    });
  }

  private partAt(x: number, y: number): PartInstance | null {
    const boat = this.lastPlayer;
    if (!boat) return null;
    const { ox, oy, cell } = this.layout;
    const hits = boat.parts.filter((p) => Math.abs(ox + p.x * cell - x) <= cell / 2 && Math.abs(oy - p.z * cell - y) <= cell / 2);
    if (!hits.length) return null;
    // Prefer the block that most needs attention, deck gear over hull on a tie.
    return hits.sort((a, b) => a.hp / a.def.hp - b.hp / b.def.hp || b.y - a.y)[0];
  }

  private drawSchematic(boat: Boat, jobStatus: (p: PartInstance) => JobStatus | null): void {
    const c = this.schematic;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    const xs = boat.parts.map((p) => p.x);
    const zs = boat.parts.map((p) => p.z);
    const minX = Math.min(...xs) - 0.5;
    const maxX = Math.max(...xs) + 0.5;
    const minZ = Math.min(...zs) - 0.5;
    const maxZ = Math.max(...zs) + 0.5;
    const cell = Math.min((c.width - 16) / (maxX - minX), (c.height - 16) / (maxZ - minZ), 30);
    const ox = c.width / 2 - ((minX + maxX) / 2) * cell;
    const oy = c.height / 2 + ((minZ + maxZ) / 2) * cell;
    this.layout = { ox, oy, cell };
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 150);
    const sorted = [...boat.parts].sort((a, b) => a.y - b.y);
    for (const p of sorted) {
      const x = ox + p.x * cell;
      const y = oy - p.z * cell;
      const f = p.hp / p.def.hp;
      const upper = p.y > 0;
      const size = upper ? cell * (0.66 - (p.y - 1) * 0.12) : cell - 2;
      if (!p.alive) {
        g.strokeStyle = 'rgba(224,73,58,0.85)';
        g.setLineDash([3, 2]);
        g.strokeRect(x - size / 2, y - size / 2, size, size);
        g.setLineDash([]);
      } else {
        g.fillStyle = `hsla(${f * 110}, 70%, ${upper ? 55 : 42}%, ${upper ? 0.95 : 0.85})`;
        g.fillRect(x - size / 2, y - size / 2, size, size);
        if (upper) {
          g.fillStyle = 'rgba(0,0,0,0.6)';
          g.font = `bold ${Math.max(8, cell * 0.34)}px Chakra Petch, sans-serif`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          const letter = { mount: 'G', engine: 'E', armor: 'A', quarters: 'B', crane: 'N', cabin: 'W', hull: 'H' }[p.def.kind];
          g.fillText(letter, x, y + 1);
        }
        if (boat.fires.has(p.index)) {
          g.fillStyle = `rgba(255,${120 + pulse * 80},40,0.95)`;
          g.beginPath();
          g.arc(x + size / 2 - 3, y - size / 2 + 3, 3, 0, Math.PI * 2);
          g.fill();
        }
      }
      const job = jobStatus(p);
      if (job) {
        g.lineWidth = 2;
        g.strokeStyle = job === 'working' ? `rgba(242,193,78,${0.5 + pulse * 0.5})` : job === 'waiting' ? 'rgba(244,236,216,0.7)' : 'rgba(224,73,58,0.95)';
        g.strokeRect(x - size / 2 - 1, y - size / 2 - 1, size + 2, size + 2);
        g.lineWidth = 1;
      }
    }
  }
}
