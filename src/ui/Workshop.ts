/** Gun workshop dialog: pick a base and four parts, compare stats, save a design. */

import { AMMO, BARRELS, BASES, COOLING, RECEIVERS, autoName, buildWeapon, recipeCost, statSheet, type GunRecipe } from '../weapons/workshop';
import { customWeapons, registerWeapon, unregisterWeapon, type WeaponDef } from '../weapons/weaponDefs';

const STORE = 'salt-scrap-guns-v1';

interface Saved {
  id: string;
  recipe: GunRecipe;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

function readSaved(): Saved[] {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '[]') as Saved[];
  } catch {
    return [];
  }
}

function writeSaved(list: Saved[]): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(list));
  } catch {
    /* storage blocked: designs last for this session only */
  }
}

/** Register gun designs saved in earlier sessions. */
export function loadSavedGuns(): void {
  for (const s of readSaved()) {
    try {
      registerWeapon(buildWeapon(s.recipe, s.id));
    } catch {
      /* skip a corrupt entry */
    }
  }
}

type Group = 'base' | 'barrel' | 'receiver' | 'ammo' | 'cooling';

const GROUPS: { key: Group; label: string; options: Record<string, { label: string; blurb: string }> }[] = [
  { key: 'base', label: 'Base', options: BASES },
  { key: 'barrel', label: 'Barrel', options: BARRELS },
  { key: 'receiver', label: 'Receiver', options: RECEIVERS },
  { key: 'ammo', label: 'Ammunition', options: AMMO },
  { key: 'cooling', label: 'Cooling', options: COOLING },
];

export class Workshop {
  readonly root = el('div', 'screen workshop hidden');
  private recipe: GunRecipe = { name: '', base: 'mg', barrel: 'standard', receiver: 'standard', ammo: 'ball', cooling: 'jacket' };
  private readonly body = el('div', 'wcard panel');
  onSaved: ((def: WeaponDef) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root.append(this.body);
    this.root.addEventListener('mousedown', (e) => {
      if (e.target === this.root) this.close();
    });
    parent.append(this.root);
  }

  open(): void {
    this.root.classList.remove('hidden');
    this.render();
  }

  close(): void {
    this.root.classList.add('hidden');
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  private render(): void {
    const r = this.recipe;
    const preview = buildWeapon(r, 'preview');
    const base = BASES[r.base].def;
    const cost = recipeCost(r);
    this.body.innerHTML = '';
    const head = el('div', 'whead', `<div class="big">Gun Workshop</div><div class="label">Designs are free. You pay when you fit one to a mount. White ticks mark the stock gun.</div>`);
    const close = el('button', 'x', '✕');
    close.setAttribute('aria-label', 'Close workshop');
    close.addEventListener('click', () => this.close());
    head.append(close);
    this.body.append(head);

    const cols = el('div', 'wcols');
    const left = el('div', 'wleft');
    for (const g of GROUPS) {
      if (g.key === 'cooling' && r.base !== 'mg') continue;
      const row = el('div', 'wgroup', `<div class="label">${g.label}</div>`);
      const opts = el('div', 'wopts');
      for (const [k, o] of Object.entries(g.options)) {
        const b = el('button', `tile${(r as unknown as Record<string, string>)[g.key] === k ? ' on' : ''}`, `<span class="tname">${o.label}</span><span class="tblurb">${o.blurb}</span>`);
        b.addEventListener('click', () => {
          (this.recipe as unknown as Record<string, string>)[g.key] = k;
          this.render();
        });
        opts.append(b);
      }
      row.append(opts);
      left.append(row);
    }

    const right = el('div', 'wright');
    const name = el('input');
    name.id = 'gun-name';
    name.maxLength = 28;
    name.placeholder = autoName(r);
    name.value = r.name;
    name.addEventListener('input', () => (this.recipe.name = name.value));
    const nameRow = el('label', 'wname', '<span class="label">Name</span>');
    nameRow.append(name);
    right.append(nameRow);
    const sheet = el('div', 'wsheet');
    const baseSheet = statSheet(base);
    statSheet(preview).forEach((s, i) => {
      const b = baseSheet[i];
      const better = s.label === 'Heat per shot' ? s.bar < b.bar - 0.01 : s.bar > b.bar + 0.01;
      const worse = s.label === 'Heat per shot' ? s.bar > b.bar + 0.01 : s.bar < b.bar - 0.01;
      sheet.append(
        el(
          'div',
          'wstat',
          `<div class="stat"><span>${s.label}</span><b class="${better ? 'up' : worse ? 'down' : ''}">${s.value}</b></div>
           <div class="bar dual"><i style="width:${Math.round(s.bar * 100)}%"></i><i class="base" style="left:calc(${Math.round(b.bar * 100)}% - 1px)"></i></div>`,
        ),
      );
    });
    right.append(sheet);
    right.append(el('div', 'wcost', `Fitting cost <span class="res wood">${cost.wood}</span><span class="res metal">${cost.metal}</span>`));
    const save = el('button', 'cta small', 'Save design');
    save.addEventListener('click', () => {
      const id = `custom_${Date.now().toString(36)}`;
      const def = buildWeapon({ ...this.recipe }, id);
      registerWeapon(def);
      writeSaved([...readSaved(), { id, recipe: { ...this.recipe } }]);
      this.recipe = { ...this.recipe, name: '' };
      this.onSaved?.(def);
      this.close();
    });
    right.append(save);

    const mine = customWeapons();
    if (mine.length) {
      const list = el('div', 'wmine', '<div class="label">Your designs</div>');
      for (const w of mine) {
        const item = el('div', 'wmineitem', `<span>${w.name}</span>`);
        const del = el('button', 'x small', 'Delete');
        del.addEventListener('click', () => {
          unregisterWeapon(w.id);
          writeSaved(readSaved().filter((s) => s.id !== w.id));
          this.render();
        });
        item.append(del);
        list.append(item);
      }
      right.append(list);
    }

    cols.append(left, right);
    this.body.append(cols);
  }
}
