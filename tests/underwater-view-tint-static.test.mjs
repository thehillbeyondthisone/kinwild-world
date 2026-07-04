// QA-009: WATER_SURFACE_Y is a pure exported constant (src/world-constants.js)
// and is asserted here by importing it directly, instead of grepping its
// literal declaration. The render-loop wiring (main.js touches the DOM/WebGL
// at import time — see CLAUDE.md) and the GLSL underwater-tint mix in
// postfx.js remain source-text assertions.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.__APP_VERSION__ = 'test';

const mainSource = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const postfxSource = readFileSync(new URL('../src/postfx.js', import.meta.url), 'utf8');

const { WATER_SURFACE_Y } = await import('../src/world-constants.js');

// Protected invariant: the water plane sits just below y=0, matching the
// terrain's baked-in surface trough (applyWaterWetDepth).
assert.equal(WATER_SURFACE_Y, -0.12, 'Water surface should sit at the canonical world-constants Y.');

assert(
  mainSource.includes('function updateUnderwaterTint()')
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
