/** Shared lighting / atmosphere settings: a smoky, late-afternoon war sky. */

import { Color, Vector3 } from 'three';

export const ENV = {
  sunDir: new Vector3(-0.35, 0.72, -0.6).normalize(),
  sunColor: new Color(1.0, 0.82, 0.62),
  sunIntensity: 3.2,
  zenith: new Color(0.24, 0.34, 0.44),
  horizon: new Color(0.66, 0.6, 0.53),
  fogColor: new Color(0.5, 0.52, 0.52),
  fogDensity: 0.0075,
  deepWater: new Color(0.012, 0.075, 0.1),
  shallowWater: new Color(0.03, 0.3, 0.32),
  foamColor: new Color(0.92, 0.95, 0.93),
};

export const SKY_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uZenith;
uniform vec3 uHorizon;
vec3 skyColor(vec3 d) {
  float h = max(d.y, 0.0);
  vec3 c = mix(uHorizon, uZenith, pow(h, 0.45));
  float s = max(dot(d, uSunDir), 0.0);
  c += uSunColor * (pow(s, 6.0) * 0.22 + pow(s, 90.0) * 1.4);
  return c;
}
`;

export function skyUniforms() {
  return {
    uSunDir: { value: ENV.sunDir },
    uSunColor: { value: ENV.sunColor },
    uZenith: { value: ENV.zenith },
    uHorizon: { value: ENV.horizon },
  };
}
