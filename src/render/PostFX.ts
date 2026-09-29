/**
 * Post-processing: bloom for flashes and tracers, then a war-torn grade —
 * slightly desaturated, warm highlights / cool shadows, vignette, film grain,
 * and a red chromatic pulse when the player is hit.
 */

import { HalfFloatType, Vector2, WebGLRenderTarget, type Camera, type Scene, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uDamage: { value: 0 },
    uRes: { value: new Vector2(1, 1) },
    uExposure: { value: 1.05 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uDamage;
    uniform vec2 uRes;
    uniform float uExposure;
    varying vec2 vUv;

    // Tone mapping and sRGB encoding live here too, saving a full-screen pass.
    // (Same ACES fit three.js uses.)
    vec3 gradeRRT(vec3 v) {
      vec3 a = v * (v + 0.0245786) - 0.000090537;
      vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
      return a / b;
    }
    vec3 gradeAces(vec3 color) {
      const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
      const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
      color *= uExposure / 0.6;
      return clamp(outM * gradeRRT(inM * color), 0.0, 1.0);
    }
    vec3 gradeSRGB(vec3 c) {
      return mix(pow(c, vec3(1.0 / 2.4)) * 1.055 - 0.055, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
    }

    void main() {
      vec2 c = vUv - 0.5;
      float ca = 0.0012 + uDamage * 0.008;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + c * ca).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - c * ca).b;
      col = gradeSRGB(gradeAces(col));
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, 0.9);
      col += mix(vec3(-0.012, 0.0, 0.018), vec3(0.03, 0.012, -0.02), smoothstep(0.15, 0.85, l));
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.22);
      float v = smoothstep(0.9, 0.3, length(c * vec2(1.0, 0.85)));
      col *= mix(0.6, 1.0, v);
      col = mix(col, vec3(0.55, 0.03, 0.0), (1.0 - v) * uDamage * 0.8);
      float n = fract(sin(dot(vUv * uRes + fract(uTime) * 91.7, vec2(12.9898, 78.233))) * 43758.5453);
      col += (n - 0.5) * 0.03;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};

export class PostFX {
  readonly composer: EffectComposer;
  private readonly grade: ShaderPass;
  private readonly bloom: UnrealBloomPass;
  damage = 0;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: Camera) {
    const size = renderer.getDrawingBufferSize(new Vector2());
    const rt = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, samples: 2 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new Vector2(size.x / 2, size.y / 2), 0.45, 0.4, 0.96);
    // Bloom is soft by nature: run its blur chain at a fraction of the screen.
    const bloomSetSize = this.bloom.setSize.bind(this.bloom);
    this.bloom.setSize = (w: number, h: number) => bloomSetSize(Math.max(64, Math.round(w * this.bloomScale * 2)), Math.max(64, Math.round(h * this.bloomScale * 2)));
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }

  private bloomScale = 0.25;
  private size = { w: 1, h: 1, pr: 1 };

  /** Apply a quality tier: MSAA samples, bloom on/off and bloom resolution. */
  setQuality(msaa: number, bloom: boolean, bloomScale: number): void {
    this.bloom.enabled = bloom;
    this.bloomScale = bloomScale;
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (rt.samples !== msaa) {
        rt.samples = msaa;
        rt.dispose();
      }
    }
    this.setSize(this.size.w, this.size.h, this.size.pr);
  }

  /** `pixelRatio` already includes the dynamic render scale. */
  setSize(w: number, h: number, pixelRatio: number): void {
    this.size = { w, h, pr: pixelRatio };
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    (this.grade.uniforms.uRes.value as Vector2).set(w * pixelRatio, h * pixelRatio);
  }

  render(dt: number, time: number): void {
    this.damage = Math.max(0, this.damage - dt * 1.5);
    this.grade.uniforms.uTime.value = time;
    this.grade.uniforms.uDamage.value = this.damage;
    this.composer.render(dt);
  }
}
