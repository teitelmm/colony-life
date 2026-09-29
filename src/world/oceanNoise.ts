/**
 * Bakes the ocean's small-scale noise into one seamless tiling texture at
 * startup, so the water shader samples a texture instead of evaluating ~30
 * procedural noise calls per pixel.
 *
 * Channels (all tile every PERIOD lattice cells):
 *   R, G  gradient (d/du, d/dv) of a 4-octave fbm — ripple normals
 *   B     4-octave fbm value — foam breakup and oil film
 *   A     single-octave value noise — fine foam grain
 */

import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, UnsignedByteType } from 'three';

export const NOISE_SIZE = 256;
/** lattice cells across one texture tile at the base octave */
export const PERIOD = 16;
/** gradient is stored as g * GRAD_SCALE + 0.5 */
export const GRAD_SCALE = 0.12;

function hash(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Value noise that wraps every `period` lattice cells. */
export function tileNoise(x: number, y: number, period: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const w = (i: number) => ((i % period) + period) % period;
  const a = hash(w(ix), w(iy), seed);
  const b = hash(w(ix + 1), w(iy), seed);
  const c = hash(w(ix), w(iy + 1), seed);
  const d = hash(w(ix + 1), w(iy + 1), seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Tiling fbm: each octave doubles frequency and period so the tile still wraps. */
export function tileFbm(x: number, y: number, period: number, seed: number, octaves = 4): number {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    v += amp * tileNoise(x * f, y * f, period * f, seed + o * 17);
    f *= 2;
    amp *= 0.5;
  }
  return v;
}

export function bakeOceanNoise(size = NOISE_SIZE): DataTexture {
  const data = new Uint8Array(size * size * 4);
  const cell = PERIOD / size; // lattice units per texel
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) height[y * size + x] = tileFbm(x * cell, y * cell, PERIOD, 1);
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = (at(x + 1, y) - at(x - 1, y)) / (2 * cell);
      const gy = (at(x, y + 1) - at(x, y - 1)) / (2 * cell);
      const i = (y * size + x) * 4;
      data[i] = Math.max(0, Math.min(255, Math.round((gx * GRAD_SCALE + 0.5) * 255)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round((gy * GRAD_SCALE + 0.5) * 255)));
      data[i + 2] = Math.round(tileFbm(x * cell, y * cell, PERIOD, 7) * 255);
      data[i + 3] = Math.round(tileNoise(x * cell * 4, y * cell * 4, PERIOD * 4, 3) * 255);
    }
  }
  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
