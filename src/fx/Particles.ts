/**
 * CPU-simulated, GPU-billboarded particle system. One draw call per system.
 * Particle "types" select a procedural sprite in the fragment shader.
 */

import {
  AdditiveBlending,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';

export const PType = {
  Glow: 0,
  Smoke: 1,
  Spark: 2,
  Spray: 3,
  Flame: 4,
  Chunk: 5,
} as const;
export type PType = (typeof PType)[keyof typeof PType];

export interface ParticleOpts {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  life: number;
  size: number;
  sizeEnd?: number;
  color: Color | number;
  colorEnd?: Color | number;
  alpha?: number;
  alphaEnd?: number;
  /** linear drag per second */
  drag?: number;
  /** downward acceleration (negative = rises) */
  gravity?: number;
  rotation?: number;
  spin?: number;
  /** >0 stretches the sprite along its velocity (seconds of motion blur) */
  stretch?: number;
  type?: PType;
  /** fraction of life spent fading in */
  fadeIn?: number;
  /** die (and optionally splash) when falling below the water line */
  killBelow?: number;
}

const tmpA = new Color();
const tmpB = new Color();

const vert = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iColor;
attribute vec4 iParams; // size, rotation, type, stretch
varying vec2 vUv;
varying vec4 vColor;
varying float vType;
varying float vSeed;
varying float vFog;
uniform float uFogDensity;
void main() {
  vUv = uv;
  vColor = iColor;
  vType = iParams.z;
  vSeed = fract(iParams.y * 7.13);
  vec4 mv = viewMatrix * vec4(iPos, 1.0);
  vec2 corner = position.xy;
  float size = iParams.x;
  if (iParams.w > 0.0) {
    vec3 vv = (viewMatrix * vec4(iVel, 0.0)).xyz;
    vec2 dir = vv.xy;
    float l = length(dir);
    dir = l > 1e-4 ? dir / l : vec2(0.0, 1.0);
    vec2 perp = vec2(-dir.y, dir.x);
    float len = size + l * iParams.w;
    mv.xy += dir * corner.y * len + perp * corner.x * size;
  } else {
    float c = cos(iParams.y);
    float s = sin(iParams.y);
    mv.xy += mat2(c, s, -s, c) * corner * size;
  }
  float d = length(mv.xyz);
  vFog = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
  gl_Position = projectionMatrix * mv;
}
`;

const frag = /* glsl */ `
uniform vec3 uFogColor;
uniform float uAdditive;
varying vec2 vUv;
varying vec4 vColor;
varying float vType;
varying float vSeed;
varying float vFog;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  float a = 0.0;
  vec3 col = vColor.rgb;
  int t = int(vType + 0.5);
  if (t == 0) {
    a = pow(max(0.0, 1.0 - r), 2.0);
  } else if (t == 1) {
    float n = fbm(vUv * 2.6 + vSeed * 17.0);
    float billow = fbm(vUv * 6.0 - vSeed * 9.0);
    a = smoothstep(0.95, 0.15, r + (n - 0.5) * 1.1) * (0.55 + 0.6 * billow);
    // fake volumetric lighting: lit from the upper side, darker underside and core
    col *= 0.55 + 0.6 * (vUv.y * 0.6 + n * 0.6) - 0.15 * (1.0 - r);
  } else if (t == 2) {
    a = pow(max(0.0, 1.0 - abs(p.x) * 2.0), 2.0) * smoothstep(0.5, 0.2, abs(p.y));
  } else if (t == 3) {
    float n = noise(vUv * 6.0 + vSeed * 31.0);
    a = smoothstep(1.0, 0.3, r + (n - 0.5) * 0.8);
    col *= 0.85 + 0.3 * vUv.y;
  } else if (t == 4) {
    float n = fbm(vUv * 4.0 + vec2(0.0, -vSeed * 5.0));
    a = smoothstep(1.0, 0.0, r + (n - 0.5) * 0.9);
    col *= 0.7 + 0.8 * a;
  } else {
    a = step(r, 0.9);
  }
  a *= vColor.a;
  if (a < 0.003) discard;
  if (uAdditive > 0.5) {
    gl_FragColor = vec4(col * a * (1.0 - vFog), 1.0);
  } else {
    gl_FragColor = vec4(mix(col, uFogColor, vFog), a);
  }
}
`;

export class ParticleSystem {
  readonly mesh: Mesh;
  private readonly cap: number;
  private count = 0;

  // simulation state (struct of arrays)
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly col0: Float32Array;
  private readonly col1: Float32Array;
  private readonly a0: Float32Array;
  private readonly a1: Float32Array;
  private readonly drag: Float32Array;
  private readonly grav: Float32Array;
  private readonly rot: Float32Array;
  private readonly spin: Float32Array;
  private readonly type: Float32Array;
  private readonly stretch: Float32Array;
  private readonly fadeIn: Float32Array;
  private readonly killBelow: Float32Array;

  // GPU attributes
  private readonly aPos: InstancedBufferAttribute;
  private readonly aVel: InstancedBufferAttribute;
  private readonly aColor: InstancedBufferAttribute;
  private readonly aParams: InstancedBufferAttribute;
  private readonly geometry: InstancedBufferGeometry;
  readonly material: ShaderMaterial;

  constructor(capacity: number, additive: boolean) {
    this.cap = capacity;
    const f = (n: number) => new Float32Array(capacity * n);
    this.pos = f(3);
    this.vel = f(3);
    this.age = f(1);
    this.life = f(1);
    this.size0 = f(1);
    this.size1 = f(1);
    this.col0 = f(3);
    this.col1 = f(3);
    this.a0 = f(1);
    this.a1 = f(1);
    this.drag = f(1);
    this.grav = f(1);
    this.rot = f(1);
    this.spin = f(1);
    this.type = f(1);
    this.stretch = f(1);
    this.fadeIn = f(1);
    this.killBelow = f(1);

    const geo = new InstancedBufferGeometry();
    const quad = new PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    geo.setAttribute('uv', quad.attributes.uv);
    const mk = (n: number) => {
      const a = new InstancedBufferAttribute(new Float32Array(capacity * n), n);
      a.setUsage(DynamicDrawUsage);
      return a;
    };
    this.aPos = mk(3);
    this.aVel = mk(3);
    this.aColor = mk(4);
    this.aParams = mk(4);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iVel', this.aVel);
    geo.setAttribute('iColor', this.aColor);
    geo.setAttribute('iParams', this.aParams);
    geo.instanceCount = 0;
    this.geometry = geo;

    this.material = new ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
      uniforms: {
        uFogColor: { value: new Color() },
        uFogDensity: { value: 0 },
        uAdditive: { value: additive ? 1 : 0 },
      },
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 3 : 2;
  }

  get alive(): number {
    return this.count;
  }

  emit(o: ParticleOpts): void {
    let i = this.count;
    if (i >= this.cap) {
      // Overwrite a random old particle rather than dropping the new one.
      i = (Math.random() * this.cap) | 0;
    } else {
      this.count++;
    }
    this.pos[i * 3] = o.x;
    this.pos[i * 3 + 1] = o.y;
    this.pos[i * 3 + 2] = o.z;
    this.vel[i * 3] = o.vx ?? 0;
    this.vel[i * 3 + 1] = o.vy ?? 0;
    this.vel[i * 3 + 2] = o.vz ?? 0;
    this.age[i] = 0;
    this.life[i] = Math.max(0.01, o.life);
    this.size0[i] = o.size;
    this.size1[i] = o.sizeEnd ?? o.size;
    const c0 = typeof o.color === 'number' ? tmpA.setHex(o.color) : tmpA.copy(o.color);
    const c1 = o.colorEnd === undefined ? tmpB.copy(c0) : typeof o.colorEnd === 'number' ? tmpB.setHex(o.colorEnd) : tmpB.copy(o.colorEnd);
    this.col0.set([c0.r, c0.g, c0.b], i * 3);
    this.col1.set([c1.r, c1.g, c1.b], i * 3);
    this.a0[i] = o.alpha ?? 1;
    this.a1[i] = o.alphaEnd ?? 0;
    this.drag[i] = o.drag ?? 0;
    this.grav[i] = o.gravity ?? 0;
    this.rot[i] = o.rotation ?? Math.random() * Math.PI * 2;
    this.spin[i] = o.spin ?? 0;
    this.type[i] = o.type ?? PType.Glow;
    this.stretch[i] = o.stretch ?? 0;
    this.fadeIn[i] = o.fadeIn ?? 0;
    this.killBelow[i] = o.killBelow ?? -1e9;
  }

  private kill(i: number): void {
    const last = --this.count;
    if (i === last) return;
    const copy = (arr: Float32Array, n: number) => arr.copyWithin(i * n, last * n, last * n + n);
    copy(this.pos, 3);
    copy(this.vel, 3);
    copy(this.age, 1);
    copy(this.life, 1);
    copy(this.size0, 1);
    copy(this.size1, 1);
    copy(this.col0, 3);
    copy(this.col1, 3);
    copy(this.a0, 1);
    copy(this.a1, 1);
    copy(this.drag, 1);
    copy(this.grav, 1);
    copy(this.rot, 1);
    copy(this.spin, 1);
    copy(this.type, 1);
    copy(this.stretch, 1);
    copy(this.fadeIn, 1);
    copy(this.killBelow, 1);
  }

  update(dt: number, fogColor: Color, fogDensity: number): void {
    const P = this.aPos.array as Float32Array;
    const V = this.aVel.array as Float32Array;
    const C = this.aColor.array as Float32Array;
    const Q = this.aParams.array as Float32Array;
    let i = 0;
    while (i < this.count) {
      const age = (this.age[i] += dt);
      if (age >= this.life[i]) {
        this.kill(i);
        continue;
      }
      const k = i * 3;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[k] *= d;
      this.vel[k + 1] = this.vel[k + 1] * d - this.grav[i] * dt;
      this.vel[k + 2] *= d;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 1] < this.killBelow[i]) {
        this.kill(i);
        continue;
      }
      this.rot[i] += this.spin[i] * dt;
      const t = age / this.life[i];
      const fi = this.fadeIn[i];
      const fade = fi > 0 ? Math.min(1, t / fi) : 1;
      P[k] = this.pos[k];
      P[k + 1] = this.pos[k + 1];
      P[k + 2] = this.pos[k + 2];
      V[k] = this.vel[k];
      V[k + 1] = this.vel[k + 1];
      V[k + 2] = this.vel[k + 2];
      const c = i * 4;
      C[c] = this.col0[k] + (this.col1[k] - this.col0[k]) * t;
      C[c + 1] = this.col0[k + 1] + (this.col1[k + 1] - this.col0[k + 1]) * t;
      C[c + 2] = this.col0[k + 2] + (this.col1[k + 2] - this.col0[k + 2]) * t;
      C[c + 3] = (this.a0[i] + (this.a1[i] - this.a0[i]) * t) * fade;
      Q[c] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      Q[c + 1] = this.rot[i];
      Q[c + 2] = this.type[i];
      Q[c + 3] = this.stretch[i];
      i++;
    }
    this.geometry.instanceCount = this.count;
    for (const a of [this.aPos, this.aVel, this.aColor, this.aParams]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.count * a.itemSize);
      a.needsUpdate = true;
    }
    (this.material.uniforms.uFogColor.value as Color).copy(fogColor);
    this.material.uniforms.uFogDensity.value = fogDensity;
  }
}
