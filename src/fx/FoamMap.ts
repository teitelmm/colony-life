/**
 * World-space foam/oil map. Transient water decals (splash rings, foam
 * patches, oil slicks, hull contact foam, wakes) are rendered top-down into a
 * render target that the ocean shader projects onto the real wave surface.
 *
 * Channels: R = foam, G = oil, B = darkening (shadow under hulls).
 */

import {
  AdditiveBlending,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  HalfFloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';

export const DecalType = { Ring: 0, Foam: 1, Oil: 2, Hull: 3, School: 4 } as const;
export type DecalType = (typeof DecalType)[keyof typeof DecalType];

interface Decal {
  x: number;
  z: number;
  r0: number;
  r1: number;
  aspect: number;
  rot: number;
  life: number;
  age: number;
  type: DecalType;
  intensity: number;
  seed: number;
}

export const FOAM_NOISE_GLSL = /* glsl */ `
float fhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(fhash(i), fhash(i + vec2(1, 0)), u.x), mix(fhash(i + vec2(0, 1)), fhash(i + vec2(1, 1)), u.x), u.y);
}
`;

const decalVert = /* glsl */ `
attribute vec4 iXform; // x, z, radius, rotation
attribute vec4 iParams; // type, intensity, age01, aspect
attribute float iSeed;
varying vec2 vLocal;
varying vec4 vParams;
varying vec2 vWorld;
varying float vSeed;
void main() {
  vLocal = position.xy * 2.0; // -1..1
  vParams = iParams;
  vSeed = iSeed;
  float c = cos(iXform.w), s = sin(iXform.w);
  vec2 p = vec2(position.x * iParams.w, position.y) * 2.0 * iXform.z;
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  vec3 world = vec3(iXform.x + p.x, 0.0, iXform.y - p.y);
  vWorld = world.xz;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const decalFrag = /* glsl */ `
uniform float uTime;
varying vec2 vLocal;
varying vec4 vParams;
varying vec2 vWorld;
varying float vSeed;
${FOAM_NOISE_GLSL}
void main() {
  int type = int(vParams.x + 0.5);
  float I = vParams.y;
  float t = vParams.z;
  float r = length(vLocal);
  float n = fnoise(vWorld * 1.3 + vSeed * 13.0) * 0.6 + fnoise(vWorld * 3.7) * 0.4;
  vec4 o = vec4(0.0);
  if (type == 0) {
    float ringR = 1.0 - pow(1.0 - t, 2.5);
    float w = 0.08 + 0.2 * t;
    float ring = smoothstep(w, 0.0, abs(r - ringR));
    o.r = ring * I * (1.0 - t) * (0.6 + 0.8 * n);
    o.r += smoothstep(ringR, 0.0, r) * I * 0.35 * (1.0 - t) * n;
  } else if (type == 1) {
    float disc = smoothstep(1.0, 0.25, r + (n - 0.5) * 0.6);
    o.r = disc * I * pow(1.0 - t, 1.4);
  } else if (type == 2) {
    float blob = smoothstep(1.0, 0.35, r + (n - 0.5) * 0.9);
    o.g = blob * I * (1.0 - smoothstep(0.65, 1.0, t)) * smoothstep(0.0, 0.05, t);
  } else if (type == 4) {
    // fish school: a dark, restless shoal with nervous ripples on top
    float shoal = smoothstep(1.0, 0.2, r + (fnoise(vWorld * 0.9 + uTime * 0.6) - 0.5) * 0.9);
    float flicker = fnoise(vWorld * 4.0 + vec2(uTime * 1.3, -uTime));
    o.b = shoal * 0.55 * I;
    o.r = shoal * smoothstep(0.72, 0.95, flicker) * 0.6 * I;
  } else {
    // hull contact: foam at the waterline edge, shadow underneath
    float edge = smoothstep(0.22, 0.0, abs(r - 0.92));
    o.r = edge * I * (0.5 + n);
    o.b = smoothstep(1.05, 0.5, r) * 0.45;
  }
  // Additive blending multiplies by source alpha, so alpha must be 1.
  gl_FragColor = vec4(o.rgb, 1.0);
}
`;

const wakeVert = /* glsl */ `
attribute vec4 aData; // across (-1..1), age01, strength, seed
varying vec4 vData;
varying vec2 vWorld;
void main() {
  vData = aData;
  vWorld = position.xz;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

const wakeFrag = /* glsl */ `
varying vec4 vData;
varying vec2 vWorld;
${FOAM_NOISE_GLSL}
void main() {
  float u = abs(vData.x);
  float age = vData.y;
  float n = fnoise(vWorld * 1.1) * 0.55 + fnoise(vWorld * 3.3 + 7.0) * 0.45;
  float edges = smoothstep(0.55, 0.95, u) * smoothstep(1.0, 0.93, u);
  float churn = smoothstep(0.45, 0.0, u) * (1.0 - smoothstep(0.0, 0.55, age)) * 1.3;
  float body = (edges * 0.9 + churn + 0.12) * pow(1.0 - age, 1.8) * vData.z;
  gl_FragColor = vec4(body * (0.35 + n), 0.0, churn * 0.1, 1.0);
}
`;

export class FoamMap {
  readonly target: WebGLRenderTarget;
  readonly scene = new Scene();
  readonly camera: OrthographicCamera;
  readonly center = new Vector2();
  readonly size: number;
  readonly wakeMaterial: ShaderMaterial;
  private readonly prevClear = new Color();
  private readonly time = { value: 0 };

  private readonly decals: Decal[] = [];
  private readonly cap = 1024;
  private readonly geo: InstancedBufferGeometry;
  private readonly aXform: InstancedBufferAttribute;
  private readonly aParams: InstancedBufferAttribute;
  private readonly aSeed: InstancedBufferAttribute;

  constructor(size = 180, resolution = 1024) {
    this.size = size;
    this.target = new WebGLRenderTarget(resolution, resolution, {
      type: HalfFloatType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
    });
    const h = size / 2;
    this.camera = new OrthographicCamera(-h, h, h, -h, 1, 200);
    this.camera.up.set(0, 0, -1);

    const quad = new PlaneGeometry(1, 1);
    const geo = new InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    const mk = (n: number) => {
      const a = new InstancedBufferAttribute(new Float32Array(this.cap * n), n);
      a.setUsage(DynamicDrawUsage);
      return a;
    };
    this.aXform = mk(4);
    this.aParams = mk(4);
    this.aSeed = mk(1);
    geo.setAttribute('iXform', this.aXform);
    geo.setAttribute('iParams', this.aParams);
    geo.setAttribute('iSeed', this.aSeed);
    this.geo = geo;

    const decalMat = new ShaderMaterial({
      uniforms: { uTime: this.time },
      vertexShader: decalVert,
      fragmentShader: decalFrag,
      side: DoubleSide,
      blending: AdditiveBlending,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new Mesh(geo, decalMat);
    mesh.frustumCulled = false;
    this.scene.add(mesh);

    this.wakeMaterial = new ShaderMaterial({
      vertexShader: wakeVert,
      fragmentShader: wakeFrag,
      side: DoubleSide,
      blending: AdditiveBlending,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
  }

  /** Render-target resolution (quality tiers). */
  setResolution(n: number): void {
    if (this.target.width !== n) this.target.setSize(n, n);
  }

  add(type: DecalType, x: number, z: number, r0: number, r1: number, life: number, intensity: number, rot = Math.random() * 6.28, aspect = 1): void {
    if (this.decals.length >= this.cap) this.decals.shift();
    this.decals.push({ x, z, r0, r1, aspect, rot, life, age: 0, type, intensity, seed: Math.random() * 100 });
  }

  ring(x: number, z: number, r: number, life = 1.6, intensity = 1): void {
    this.add(DecalType.Ring, x, z, r, r, life, intensity);
  }

  foam(x: number, z: number, r: number, life = 4, intensity = 1): void {
    this.add(DecalType.Foam, x, z, r * 0.7, r * 1.3, life, intensity);
  }

  oil(x: number, z: number, r: number, life = 45): void {
    this.add(DecalType.Oil, x, z, r * 0.4, r, life, 0.85);
  }

  /** Transient per-frame decal for a hull sitting in the water. */
  hull(x: number, z: number, halfWidth: number, halfLength: number, heading: number, intensity: number): void {
    this.add(DecalType.Hull, x, z, halfLength + 0.25, halfLength + 0.25, 0, intensity, heading, (halfWidth + 0.25) / (halfLength + 0.25));
  }

  /** Per-frame fish-school patch. */
  school(x: number, z: number, radius: number, intensity: number): void {
    this.add(DecalType.School, x, z, radius, radius, 0, intensity, 0);
  }

  update(dt: number): void {
    this.time.value += dt;
    const X = this.aXform.array as Float32Array;
    const P = this.aParams.array as Float32Array;
    const S = this.aSeed.array as Float32Array;
    let n = 0;
    for (let i = 0; i < this.decals.length; i++) {
      const d = this.decals[i];
      const t = d.life > 0 ? d.age / d.life : 0;
      const r = d.r0 + (d.r1 - d.r0) * (1 - (1 - t) * (1 - t));
      X.set([d.x, d.z, r, d.rot], n * 4);
      P.set([d.type, d.intensity, t, d.aspect], n * 4);
      S[n] = d.seed;
      n++;
    }
    this.geo.instanceCount = n;
    this.aXform.needsUpdate = this.aParams.needsUpdate = this.aSeed.needsUpdate = true;
    // Age after upload so zero-life (per-frame) decals render exactly once.
    let w = 0;
    for (let i = 0; i < this.decals.length; i++) {
      const d = this.decals[i];
      d.age += dt;
      if (d.age < d.life) this.decals[w++] = d;
    }
    this.decals.length = w;
  }

  render(renderer: WebGLRenderer, cx: number, cz: number): void {
    // Snap to texels so the projected foam doesn't shimmer as the camera moves.
    const texel = this.size / this.target.width;
    this.center.set(Math.round(cx / texel) * texel, Math.round(cz / texel) * texel);
    this.camera.position.set(this.center.x, 100, this.center.y);
    this.camera.lookAt(this.center.x, 0, this.center.y);
    const prev = renderer.getRenderTarget();
    renderer.getClearColor(this.prevClear);
    const prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prev);
    renderer.setClearColor(this.prevClear, prevAlpha);
  }
}
