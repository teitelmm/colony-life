/**
 * The ocean: Gerstner-displaced grid (same maths as the CPU buoyancy) plus a
 * flat far-field ring, shaded with fresnel sky reflection, subsurface tint,
 * sun glitter, crest foam and the projected FoamMap (wakes, splashes, oil).
 */

import { Color, Mesh, PlaneGeometry, RingGeometry, ShaderMaterial, Vector2 } from 'three';
import { maxAmplitude, wavesGLSL } from './waves';
import { ENV, SKY_GLSL, skyUniforms } from './environment';
import type { FoamMap } from '../fx/FoamMap';
import { GRAD_SCALE, PERIOD, bakeOceanNoise } from './oceanNoise';

const SIZE = 200;
const FADE_START = 70;
const FADE_END = 92;

const vert = /* glsl */ `
uniform float uTime;
uniform vec2 uCenter;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vHeight;
${wavesGLSL()}
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float fade = 1.0 - smoothstep(${FADE_START.toFixed(1)}, ${FADE_END.toFixed(1)}, length(wp.xz - uCenter));
  vec3 n;
  vec3 disp = fade > 0.0 ? oceanSurface(wp.xz, uTime, n) : vec3(wp.x, 0.0, wp.z);
  if (fade <= 0.0) n = vec3(0.0, 1.0, 0.0);
  vec3 p = mix(vec3(wp.x, 0.0, wp.z), disp, fade);
  vNormal = normalize(mix(vec3(0.0, 1.0, 0.0), n, fade));
  vHeight = disp.y * fade;
  vWorld = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const frag = /* glsl */ `
uniform float uTime;
uniform sampler2D uFoamMap;
uniform vec2 uFoamCenter;
uniform float uFoamSize;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoamColor;
uniform float uAmp;
uniform sampler2D uNoise;
uniform float uDetail;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vHeight;
${SKY_GLSL}

// Baked tiling noise (see oceanNoise.ts): lattice coords -> texture uv.
const float PERIOD = ${PERIOD.toFixed(1)};
const float GRAD = ${(1 / GRAD_SCALE).toFixed(4)};

void main() {
  vec2 q = vWorld.xz;
  float t = uTime;
  float dist = length(cameraPosition - vWorld);
  float detail = (1.0 - smoothstep(40.0, 140.0, dist)) * uDetail;

  // Small-scale ripples: gradients of two scrolling noise layers (two texture reads).
  vec4 n1 = texture2D(uNoise, (q * 0.75 + vec2(t * 0.35, t * 0.12)) / PERIOD);
  vec4 n2 = texture2D(uNoise, (q * 1.9 - vec2(t * 0.2, -t * 0.4)) / PERIOD);
  vec2 grad = ((n1.rg - 0.5) + (n2.rg - 0.5) * 0.5) * GRAD;
  vec3 N = normalize(vNormal - vec3(grad.x, 0.0, grad.y) * 0.075 * detail);

  vec3 V = normalize(cameraPosition - vWorld);
  vec3 L = uSunDir;
  float NdV = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 refl = skyColor(R);

  // Water body: deeper blue in troughs, glowing teal where crests thin out and catch the sun.
  float h = clamp(vHeight / uAmp * 0.5 + 0.5, 0.0, 1.0);
  vec3 body = mix(uDeep, uShallow, pow(h, 2.2) * 0.9);
  float diffuse = max(dot(N, L), 0.0);
  body *= 0.55 + 0.6 * diffuse;
  float sss = pow(h, 3.0) * pow(max(dot(normalize(vec3(-L.x, 0.2, -L.z)), N), 0.0), 2.0);
  body += uShallow * sss * 0.8;

  vec3 col = mix(body, refl, fres);
  float RdL = max(dot(R, L), 0.0);
  col += uSunColor * (pow(RdL, 900.0) * 1.1 + pow(RdL, 40.0) * 0.1) * (0.4 + 0.6 * detail);

  // Projected foam / oil / hull shadow.
  vec2 fuv = vec2((vWorld.x - uFoamCenter.x) / uFoamSize + 0.5, (uFoamCenter.y - vWorld.z) / uFoamSize + 0.5);
  vec4 fm = vec4(0.0);
  if (fuv.x > 0.0 && fuv.x < 1.0 && fuv.y > 0.0 && fuv.y < 1.0) fm = texture2D(uFoamMap, fuv);

  col *= 1.0 - clamp(fm.b, 0.0, 0.6);

  // Oil slicks: near-black with thin-film iridescence.
  float oil = clamp(fm.g, 0.0, 0.92);
  if (oil > 0.001) {
    float film = texture2D(uNoise, (q * 0.6 + t * 0.05) / PERIOD).b * 6.0 + NdV * 4.0;
    vec3 irid = 0.5 + 0.5 * cos(film + vec3(0.0, 2.1, 4.2));
    vec3 oilCol = vec3(0.01, 0.012, 0.012) + irid * 0.07 + refl * fres * 0.6;
    col = mix(col, oilCol, oil);
  }

  float crest = smoothstep(0.86, 1.0, h) * 0.45;
  float amount = clamp(crest + fm.r, 0.0, 1.6);
  float pattern = texture2D(uNoise, (q * 2.2 + vec2(t * 0.04, 0.0)) / PERIOD).b * 0.6 + texture2D(uNoise, (q * 7.0 - t * 0.1) / (PERIOD * 4.0)).a * 0.4;
  float foam = smoothstep(0.0, 0.2, amount - (1.0 - pattern)) * 0.9 + amount * 0.06;
  foam = clamp(foam, 0.0, 1.0) * (1.0 - oil * 0.8);
  col = mix(col, uFoamColor * (0.55 + 0.5 * diffuse), foam);

  float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, fog);
  gl_FragColor = vec4(col, 1.0);
}
`;

export class Ocean {
  readonly near: Mesh;
  readonly far: Mesh;
  readonly material: ShaderMaterial;
  private spacing = SIZE / 256;
  private segments = 0;

  constructor(foam: FoamMap, segments = 256) {
    this.material = new ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        ...skyUniforms(),
        uTime: { value: 0 },
        uCenter: { value: new Vector2() },
        uFoamMap: { value: foam.target.texture },
        uFoamCenter: { value: foam.center },
        uFoamSize: { value: foam.size },
        uFogColor: { value: ENV.fogColor },
        uFogDensity: { value: ENV.fogDensity },
        uDeep: { value: ENV.deepWater },
        uShallow: { value: ENV.shallowWater },
        uFoamColor: { value: ENV.foamColor },
        uAmp: { value: maxAmplitude() * 0.75 },
        uNoise: { value: bakeOceanNoise() },
        uDetail: { value: 1 },
      },
    });
    this.near = new Mesh(undefined, this.material);
    this.setSegments(segments);
    this.near.frustumCulled = false;
    this.near.renderOrder = -1;

    const farGeo = new RingGeometry(FADE_END, 4000, 96, 6);
    farGeo.rotateX(-Math.PI / 2);
    this.far = new Mesh(farGeo, this.material);
    this.far.frustumCulled = false;
    this.far.renderOrder = -1;
  }

  /** Grid resolution of the displaced near field (quality tiers). */
  setSegments(segments: number): void {
    if (segments === this.segments) return;
    this.segments = segments;
    this.spacing = SIZE / segments;
    const geo = new PlaneGeometry(SIZE, SIZE, segments, segments);
    geo.rotateX(-Math.PI / 2);
    this.near.geometry.dispose();
    this.near.geometry = geo;
  }

  /** Strength of the small ripples (quality tiers). */
  setDetail(detail: number): void {
    this.material.uniforms.uDetail.value = detail;
  }

  update(time: number, cx: number, cz: number): void {
    // Snap the grid to its own spacing so vertices always sample the same world points.
    const sx = Math.round(cx / this.spacing) * this.spacing;
    const sz = Math.round(cz / this.spacing) * this.spacing;
    this.near.position.set(sx, 0, sz);
    this.far.position.set(sx, 0, sz);
    this.material.uniforms.uTime.value = time;
    (this.material.uniforms.uCenter.value as Vector2).set(sx, sz);
  }

  setFog(color: Color, density: number): void {
    (this.material.uniforms.uFogColor.value as Color).copy(color);
    this.material.uniforms.uFogDensity.value = density;
  }
}
