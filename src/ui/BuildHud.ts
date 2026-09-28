/** Build-mode overlay: parts palette, gun picker, live boat stats and a cursor tooltip. */

import { PARTS } from '../boat/parts';
import { PALETTE, type BuildMode } from '../build/BuildMode';
import { partCost, summarize } from '../build/buildRules';
import { allWeapons } from '../weapons/weaponDefs';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

const costHtml = (c: { wood: number; metal: number }) =>
  [c.wood ? `<span class="res wood">${c.wood}</span>` : '', c.metal ? `<span class="res metal">${c.metal}</span>` : ''].join('') || '<span class="free">free</span>';

const FACING = ['Bow', 'Starboard', 'Stern', 'Port'];

export class BuildHud {
  readonly root = el('div', 'build hidden');
  private readonly palette = el('div', 'palette dockpanel');
  private readonly guns = el('div', 'gunpick dockpanel');
  private readonly stats = el('div', 'bstats panel');
  private readonly tip = el('div', 'btip');
  private readonly info = el('div', 'binfo');
  onDone: (() => void) | null = null;
  onWorkshop: (() => void) | null = null;

  constructor(parent: HTMLElement, private readonly mode: BuildMode) {
    const top = el('div', 'btop panel');
    top.innerHTML = `<div class="big">Shipwright</div>
      <div class="keys"><span><b>Click</b> add block</span><span><b>Right-click</b> remove</span><span><b>Right-drag</b> / <kbd>Q</kbd><kbd>E</kbd> orbit</span><span><kbd>R</kbd> gun facing</span><span><kbd>1</kbd>–<kbd>0</kbd> parts</span></div>`;
    const done = el('button', 'cta small', 'Launch');
    done.addEventListener('click', () => this.onDone?.());
    top.append(done);
    const dock = el('div', 'bdock');
    dock.append(this.guns, this.palette);
    this.root.append(top, dock, this.stats, this.tip);
    parent.append(this.root);
  }

  show(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
    if (v) this.refresh({ wood: 0, metal: 0 });
  }

  /** Rebuild the palette and stats (after any change). */
  refresh(wallet: { wood: number; metal: number }): void {
    const m = this.mode;
    this.palette.innerHTML = '';
    PALETTE.forEach((id, i) => {
      const def = PARTS[id];
      const t = el('button', `tile${m.selected === id ? ' on' : ''}`);
      const c = def.cost;
      const afford = c.wood <= wallet.wood && c.metal <= wallet.metal;
      t.innerHTML = `<span class="key">${(i + 1) % 10}</span><span class="tname">${def.name}</span><span class="tcost${afford ? '' : ' short'}">${costHtml(c)}</span>`;
      t.title = def.blurb;
      t.addEventListener('click', () => m.select(id));
      this.palette.append(t);
    });
    const sel = PARTS[m.selected];
    this.info.innerHTML = `<b>${sel.name}</b> · ${sel.blurb}`;
    this.palette.append(this.info);

    const mount = sel.kind === 'mount';
    this.guns.style.display = mount ? '' : 'none';
    if (mount) {
      this.guns.innerHTML = `<div class="label">Gun for this mount · facing <b>${m.facing === undefined ? 'automatic' : FACING[m.facing]}</b> (R)</div>`;
      const row = el('div', 'gunrow');
      for (const w of allWeapons()) {
        const b = el('button', `tile gun${m.weapon === w.id ? ' on' : ''}${w.custom ? ' custom' : ''}`);
        const afford = w.cost.wood <= wallet.wood && w.cost.metal <= wallet.metal;
        b.innerHTML = `<span class="tname">${w.name}</span><span class="tcost${afford ? '' : ' short'}">${costHtml(w.cost)}</span>`;
        b.addEventListener('click', () => m.selectWeapon(w.id));
        row.append(b);
      }
      const ws = el('button', 'tile gun new', '<span class="tname">+ Design a gun</span><span class="tcost">Workshop</span>');
      ws.addEventListener('click', () => this.onWorkshop?.());
      row.append(ws);
      this.guns.append(row);
    }

    const s = summarize(m.design.parts);
    // The captain mans one gun; every other gun needs a hand.
    const crewNeeded = Math.max(0, s.guns - 1);
    const warn: string[] = [];
    if (!s.floats) warn.push('Riding dangerously low: add hull blocks');
    else if (s.reserve < 0.6) warn.push('Heavy for her hull: she will sit low');
    if (s.thrust <= 0) warn.push('No engine');
    if (crewNeeded > s.berths) warn.push(`${s.guns} guns need ${crewNeeded} gunners but there are only ${s.berths} bunks`);
    const bar = (v: number) => `<div class="bar"><i style="width:${Math.round(Math.max(0, Math.min(1, v)) * 100)}%"></i></div>`;
    this.stats.innerHTML = `
      <div class="label">${m.design.name}</div>
      <div class="stat"><span>Top speed</span><b>${s.speed.toFixed(1)} kn</b></div>${bar(s.speed / 25)}
      <div class="stat"><span>Spare buoyancy</span><b>${Math.round(s.reserve * 100)}%</b></div>${bar(s.reserve / 3)}
      <div class="stat"><span>Displacement</span><b>${(s.mass / 1000).toFixed(1)} t</b></div>
      <div class="stat"><span>Guns</span><b>${s.guns}</b></div>
      <div class="stat"><span>Bunks</span><b>${s.berths}</b></div>
      <div class="stat"><span>Armoured blocks</span><b>${s.armour}</b></div>
      <div class="stat"><span>Fishing bonus</span><b>+${Math.round(s.fishing * 100)}%</b></div>
      <div class="stat"><span>Blocks</span><b>${s.blocks}</b></div>
      ${warn.map((w) => `<div class="warnline">${w}</div>`).join('')}
      <div class="resources">${costHtml({ wood: Math.floor(wallet.wood), metal: Math.floor(wallet.metal) })}</div>`;
  }

  /** Cursor tooltip: cost or why the block can't go there. */
  updateTip(x: number, y: number): void {
    const m = this.mode;
    const h = m.hover;
    let text = m.message;
    let bad = !!m.message;
    if (!text && h?.kind === 'place') {
      bad = !h.check.ok;
      text = h.check.ok ? `Place · ${costHtml(partCost(h.cand))}` : h.check.reason;
    }
    this.tip.style.display = text ? 'block' : 'none';
    this.tip.classList.toggle('bad', bad);
    this.tip.innerHTML = text;
    this.tip.style.left = `${x + 18}px`;
    this.tip.style.top = `${y + 14}px`;
  }
}
