/**
 * Gerstner wave model shared by the CPU (buoyancy, floating objects) and the
 * GPU ocean shader. The shader source is generated from WAVES so both sides
 * always agree on the surface shape.
 */

export const GRAVITY = 9.81;

export interface Wave {
  dirX: number;
  dirZ: number;
  /** wave number 2π / wavelength */
  k: number;
  /** amplitude in metres (steepness / k) */
  a: number;
  /** phase speed sqrt(g / k) */
  c: number;
  /** steepness 0..1 (sum over all waves must stay < 1 to avoid loops) */
  steepness: number;
}

interface WaveSpec {
  angleDeg: number;
  wavelength: number;
  steepness: number;
}

const SPECS: WaveSpec[] = [
  { angleDeg: 18, wavelength: 42, steepness: 0.11 },
  { angleDeg: -32, wavelength: 24, steepness: 0.12 },
  { angleDeg: 64, wavelength: 14, steepness: 0.11 },
  { angleDeg: 148, wavelength: 8.5, steepness: 0.09 },
  { angleDeg: -78, wavelength: 5.2, steepness: 0.07 },
  { angleDeg: 112, wavelength: 3.3, steepness: 0.05 },
];

export function makeWaves(specs: WaveSpec[] = SPECS, seaState = 1): Wave[] {
  return specs.map((s) => {
    const rad = (s.angleDeg * Math.PI) / 180;
    const k = (2 * Math.PI) / s.wavelength;
    const steepness = s.steepness * seaState;
    return {
      dirX: Math.cos(rad),
      dirZ: Math.sin(rad),
      k,
      a: steepness / k,
      c: Math.sqrt(GRAVITY / k),
      steepness,
    };
  });
}

export const WAVES: Wave[] = makeWaves(SPECS, 0.85);

/** Upper bound on vertical displacement (sum of amplitudes). */
export function maxAmplitude(waves: Wave[] = WAVES): number {
  return waves.reduce((s, w) => s + w.a, 0);
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Displaced surface position of the undisplaced grid point (x, z). */
export function displace(x: number, z: number, t: number, out: Vec3Like, waves: Wave[] = WAVES): Vec3Like {
  let dx = 0;
  let dy = 0;
  let dz = 0;
  for (let i = 0; i < waves.length; i++) {
    const w = waves[i];
    const f = w.k * (w.dirX * x + w.dirZ * z - w.c * t);
    const cf = Math.cos(f);
    dx += w.dirX * w.a * cf;
    dz += w.dirZ * w.a * cf;
    dy += w.a * Math.sin(f);
  }
  out.x = x + dx;
  out.y = dy;
  out.z = z + dz;
  return out;
}

const tmp: Vec3Like = { x: 0, y: 0, z: 0 };

/**
 * Water height at world position (x, z). Gerstner waves move points
 * horizontally, so we iteratively find the grid point that lands on (x, z).
 */
export function sampleHeight(x: number, z: number, t: number, waves: Wave[] = WAVES): number {
  let px = x;
  let pz = z;
  for (let i = 0; i < 3; i++) {
    displace(px, pz, t, tmp, waves);
    px -= tmp.x - x;
    pz -= tmp.z - z;
  }
  displace(px, pz, t, tmp, waves);
  return tmp.y;
}

export interface SurfaceSample {
  height: number;
  /** vertical velocity of the water surface (m/s) */
  vy: number;
}

/**
 * Height and vertical velocity in one pass: a single inversion, then the
 * analytic Gerstner vertical velocity (-a·k·c·cos f) at the solved point.
 * Several times cheaper than finite differences over sampleHeight.
 */
export function sampleSurface(x: number, z: number, t: number, out: SurfaceSample, waves: Wave[] = WAVES): SurfaceSample {
  let px = x;
  let pz = z;
  for (let i = 0; i < 3; i++) {
    displace(px, pz, t, tmp, waves);
    px -= tmp.x - x;
    pz -= tmp.z - z;
  }
  let h = 0;
  let vy = 0;
  for (let i = 0; i < waves.length; i++) {
    const w = waves[i];
    const f = w.k * (w.dirX * px + w.dirZ * pz - w.c * t);
    h += w.a * Math.sin(f);
    vy -= w.a * w.k * w.c * Math.cos(f);
  }
  out.height = h;
  out.vy = vy;
  return out;
}

/** Cheap tilt for small floating props: two extra samples instead of four. */
export function sampleTilt(x: number, z: number, t: number, h: number, out: Vec3Like, waves: Wave[] = WAVES): Vec3Like {
  const e = 0.5;
  const nx = h - sampleHeight(x + e, z, t, waves);
  const nz = h - sampleHeight(x, z + e, t, waves);
  const len = Math.hypot(nx, e, nz);
  out.x = nx / len;
  out.y = e / len;
  out.z = nz / len;
  return out;
}

/** Surface normal at world position (x, z) via central differences. */
export function sampleNormal(x: number, z: number, t: number, out: Vec3Like, waves: Wave[] = WAVES): Vec3Like {
  const e = 0.35;
  const hL = sampleHeight(x - e, z, t, waves);
  const hR = sampleHeight(x + e, z, t, waves);
  const hD = sampleHeight(x, z - e, t, waves);
  const hU = sampleHeight(x, z + e, t, waves);
  const nx = hL - hR;
  const nz = hD - hU;
  const ny = 2 * e;
  const len = Math.hypot(nx, ny, nz);
  out.x = nx / len;
  out.y = ny / len;
  out.z = nz / len;
  return out;
}

/** Horizontal surface velocity (orbital motion) — used to drift floating debris. */
export function sampleSurfaceDrift(x: number, z: number, t: number, waves: Wave[] = WAVES): { x: number; z: number } {
  let vx = 0;
  let vz = 0;
  for (const w of waves) {
    const f = w.k * (w.dirX * x + w.dirZ * z - w.c * t);
    const s = Math.sin(f) * w.a * w.k * w.c;
    vx += w.dirX * s;
    vz += w.dirZ * s;
  }
  return { x: vx, z: vz };
}

/** GLSL source for the same wave set, used by the ocean vertex shader. */
export function wavesGLSL(waves: Wave[] = WAVES): string {
  const f = (n: number) => n.toFixed(6);
  const lines = waves
    .map(
      (w) =>
        `  gerstner(p, t, vec2(${f(w.dirX)}, ${f(w.dirZ)}), ${f(w.k)}, ${f(w.a)}, ${f(w.c)}, pos, tangent, binormal);`,
    )
    .join('\n');
  return /* glsl */ `
void gerstner(vec2 p, float t, vec2 d, float k, float a, float c, inout vec3 pos, inout vec3 tangent, inout vec3 binormal) {
  float f = k * (dot(d, p) - c * t);
  float cf = cos(f);
  float sf = sin(f);
  pos += vec3(d.x * a * cf, a * sf, d.y * a * cf);
  float ka = k * a;
  tangent += vec3(-d.x * d.x * ka * sf, d.x * ka * cf, -d.x * d.y * ka * sf);
  binormal += vec3(-d.x * d.y * ka * sf, d.y * ka * cf, -d.y * d.y * ka * sf);
}
vec3 oceanSurface(vec2 p, float t, out vec3 normal) {
  vec3 pos = vec3(p.x, 0.0, p.y);
  vec3 tangent = vec3(1.0, 0.0, 0.0);
  vec3 binormal = vec3(0.0, 0.0, 1.0);
${lines}
  normal = normalize(cross(binormal, tangent));
  return pos;
}
`;
}
