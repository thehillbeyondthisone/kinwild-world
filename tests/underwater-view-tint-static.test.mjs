import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mainSource = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const postfxSource = readFileSync(new URL('../src/postfx.js', import.meta.url), 'utf8');
// ARC-008: WATER_SURFACE_Y is now a single canonical constant in
// world-constants.js, imported here instead of hand-copied.
const constantsSource = readFileSync(new URL('../src/world-constants.js', import.meta.url), 'utf8');

assert(
  mainSource.includes('function updateUnderwaterTint()')
    && constantsSource.includes('export const WATER_SURFACE_Y = -0.12;')
    && mainSource.includes('import { WATER_SURFACE_Y as WATER_SURFACE_Y_BASE } from "./src/world-constants.js";')
    && mainSource.includes('const WATER_SURFACE_Y = WATER_SURFACE_Y_BASE * (state.userSettings.worldScale || 1);')
    && mainSource.includes('camera.position.y < WATER_SURFACE_Y')
    && mainSource.includes('postfx.setUnderwaterTint(waterColor, strength);'),
  'The render loop should tint the camera view with biome water color only when the camera is below the water surface.'
);

assert(
  postfxSource.includes('uUnderwaterColor: { value: new THREE.Color(0x3f9fb5) }')
    && postfxSource.includes('uUnderwaterStrength: { value: 0.0 }')
    && postfxSource.includes('uniform vec3  uUnderwaterColor;')
    && postfxSource.includes('uniform float uUnderwaterStrength;')
    && postfxSource.includes('base.rgb = mix(base.rgb, uUnderwaterColor, uUnderwaterStrength);')
    && postfxSource.includes('setUnderwaterTint: (color, strength) => {'),
  'Post-FX should expose a full-frame underwater tint mixed after depth effects.'
);

assert(
  postfxSource.includes('depthFXPass.uniforms.uUnderwaterStrength.value > 0.001'),
  'Underwater tint should keep the depth-FX pass active even when outline/AO/depth-fog toggles are off.'
);
