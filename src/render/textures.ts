/**
 * Procedurally painted canvas textures: chipped paint over planks, rusty
 * plate, deck boards. Arcade-bright base colours with war-worn grime.
 */

import { CanvasTexture, Color, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';

const cache = new Map<string, Texture>();

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function css(c: Color, mul = 1): string {
  return `rgb(${Math.min(255, c.r * 255 * mul) | 0},${Math.min(255, c.g * 255 * mul) | 0},${Math.min(255, c.b * 255 * mul) | 0})`;
}

function finish(canvas: HTMLCanvasElement, key: string): Texture {
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 4;
  cache.set(key, t);
  return t;
}

function canvas(size = 128): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

function grime(g: CanvasRenderingContext2D, size: number, r: () => number, amount: number): void {
  for (let i = 0; i < amount; i++) {
    const x = r() * size;
    const y = r() * size;
    const rad = 2 + r() * 10;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, `rgba(30,24,18,${0.12 + r() * 0.2})`);
    grad.addColorStop(1, 'rgba(30,24,18,0)');
    g.fillStyle = grad;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
}

function rustStreaks(g: CanvasRenderingContext2D, size: number, r: () => number, n: number): void {
  for (let i = 0; i < n; i++) {
    const x = r() * size;
    const y0 = r() * size * 0.4;
    const len = size * (0.2 + r() * 0.5);
    const grad = g.createLinearGradient(x, y0, x, y0 + len);
    grad.addColorStop(0, 'rgba(140,60,20,0.55)');
    grad.addColorStop(1, 'rgba(140,60,20,0)');
    g.fillStyle = grad;
    g.fillRect(x, y0, 1.5 + r() * 3, len);
  }
}

/**
 * Hull side: trim stripe along the top, main paint, dark antifouling band at
 * the bottom. `v` runs bottom (0) → top (1).
 */
export function hullSideTexture(paint: number, trim: number, metal: boolean): Texture {
  const key = `hull:${paint}:${trim}:${metal}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const size = 128;
  const [c, g] = canvas(size);
  const r = rng(paint ^ (trim << 3) ^ (metal ? 77 : 13));
  const base = new Color(paint);
  const under = metal ? new Color(0x6b6f72) : new Color(0x8a6a48);

  g.fillStyle = css(base);
  g.fillRect(0, 0, size, size);
  // plank or plate seams
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.lineWidth = 1;
  const rows = metal ? 3 : 6;
  for (let i = 1; i < rows; i++) {
    const y = (i / rows) * size;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(size, y);
    g.stroke();
  }
  if (metal) {
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let i = 0; i < rows; i++)
      for (let x = 6; x < size; x += 16) {
        g.beginPath();
        g.arc(x, (i / rows) * size + 4, 1.4, 0, Math.PI * 2);
        g.fill();
      }
  }
  // chipped paint showing wood/steel beneath
  for (let i = 0; i < 70; i++) {
    g.fillStyle = css(under, 0.8 + r() * 0.4);
    const w = 2 + r() * 9;
    const h = 1 + r() * 4;
    g.fillRect(r() * size, r() * size, w, h);
  }
  // trim band at top, antifouling at bottom (canvas y is flipped vs v)
  g.fillStyle = css(new Color(trim));
  g.fillRect(0, 0, size, size * 0.14);
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(0, size * 0.14, size, 2);
  g.fillStyle = css(new Color(0x7a2a22));
  g.fillRect(0, size * 0.72, size, size * 0.28);
  g.fillStyle = 'rgba(20,40,30,0.35)';
  g.fillRect(0, size * 0.62, size, size * 0.12);
  rustStreaks(g, size, r, metal ? 14 : 5);
  grime(g, size, r, 40);
  return finish(c, key);
}

export function deckTexture(metal: boolean): Texture {
  const key = `deck:${metal}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const size = 128;
  const [c, g] = canvas(size);
  const r = rng(metal ? 991 : 313);
  if (metal) {
    g.fillStyle = '#5d6468';
    g.fillRect(0, 0, size, size);
    // diamond tread plate
    g.fillStyle = 'rgba(255,255,255,0.12)';
    for (let y = 0; y < size; y += 8)
      for (let x = (y / 8) % 2 ? 4 : 0; x < size; x += 8) g.fillRect(x, y, 4, 1.5);
    rustStreaks(g, size, r, 10);
    for (let i = 0; i < 12; i++) {
      g.fillStyle = `rgba(150,70,25,${0.2 + r() * 0.3})`;
      g.beginPath();
      g.arc(r() * size, r() * size, 3 + r() * 10, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    const planks = 6;
    for (let i = 0; i < planks; i++) {
      const tone = 0.8 + r() * 0.35;
      g.fillStyle = css(new Color(0xa57a4c), tone);
      const x = (i / planks) * size;
      g.fillRect(x, 0, size / planks, size);
      g.fillStyle = 'rgba(40,25,10,0.5)';
      g.fillRect(x, 0, 1.5, size);
      // grain
      g.strokeStyle = 'rgba(60,35,15,0.25)';
      for (let k = 0; k < 4; k++) {
        g.beginPath();
        const gx = x + 3 + r() * (size / planks - 6);
        g.moveTo(gx, 0);
        g.bezierCurveTo(gx + 2, size * 0.3, gx - 2, size * 0.6, gx + 1, size);
        g.stroke();
      }
      const joint = r() * size;
      g.fillStyle = 'rgba(40,25,10,0.5)';
      g.fillRect(x, joint, size / planks, 1);
    }
  }
  grime(g, size, r, 50);
  return finish(c, key);
}

export function rustyMetalTexture(tint = 0x55605f): Texture {
  const key = `metal:${tint}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const size = 128;
  const [c, g] = canvas(size);
  const r = rng(tint);
  g.fillStyle = css(new Color(tint));
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 25; i++) {
    g.fillStyle = `rgba(${120 + r() * 40},${50 + r() * 20},20,${0.15 + r() * 0.35})`;
    g.beginPath();
    g.arc(r() * size, r() * size, 2 + r() * 12, 0, Math.PI * 2);
    g.fill();
  }
  rustStreaks(g, size, r, 12);
  grime(g, size, r, 30);
  return finish(c, key);
}

export function tarpTexture(color: number): Texture {
  const key = `tarp:${color}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const size = 64;
  const [c, g] = canvas(size);
  const r = rng(color + 5);
  g.fillStyle = css(new Color(color));
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 30; i++) {
    g.fillStyle = `rgba(0,0,0,${r() * 0.15})`;
    g.fillRect(r() * size, r() * size, 1 + r() * 20, 1 + r() * 3);
  }
  grime(g, size, r, 20);
  return finish(c, key);
}
