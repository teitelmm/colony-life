import { BackSide, Mesh, ShaderMaterial, SphereGeometry } from 'three';
import { ENV, SKY_GLSL, skyUniforms } from './environment';

/** Hazy, smoke-stained sky dome. */
export function createSky(): Mesh {
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: { ...skyUniforms(), uFogColor: { value: ENV.fogColor } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uFogColor;
      varying vec3 vDir;
      ${SKY_GLSL}
      float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      float n(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = skyColor(d);
        vec2 uv = d.xz / max(d.y, 0.08) * 2.0;
        float cl = n(uv) * 0.5 + n(uv * 2.1) * 0.3 + n(uv * 4.3) * 0.2;
        c = mix(c, vec3(0.42, 0.4, 0.38), smoothstep(0.45, 0.8, cl) * 0.6 * smoothstep(0.0, 0.25, d.y));
        c = mix(uFogColor, c, smoothstep(-0.02, 0.2, d.y));
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  const mesh = new Mesh(new SphereGeometry(3500, 32, 16), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -2;
  return mesh;
}
