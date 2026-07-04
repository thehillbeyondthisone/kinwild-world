// Static rendering invariants for no-build Three.js modules (QA-023 port of
// tests/test_sky_rendering_invariants.py).
//
// makeAurora/makeTerrain are plain, importable THREE.js factories with no
// DOM dependency, so the shader source and material flags they build are
// inspected directly off the real objects instead of grepping sky.js /
// terrain.js text — a ShaderMaterial's fragmentShader/vertexShader are just
// JS template strings on the object, readable without a WebGL context. The
// aurora tint table is real biome data, asserted via the exported
// AURORA_TINTS map rather than pinning biomes.js's exact formatting.

import assert from 'node:assert/strict';

globalThis.__APP_VERSION__ = 'test';
globalThis.window = {
  location: { search: '' },
  matchMedia: () => ({ matches: false }),
};
Object.defineProperty(globalThis, 'navigator', {
  value: { maxTouchPoints: 0 },
  configurable: true,
});
globalThis.document = {
  createElement() {
    return {
      width: 0,
      height: 0,
      getContext() {
        return {
          createImageData(w, h) {
            return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
          },
          putImageData() {},
        };
      },
    };
  },
};

const { BIOMES, AURORA_TINTS } = await import('../src/biomes.js');
const { makeAurora } = await import('../src/sky.js');
const { makeTerrain, makeHeightFn, pickLayout } = await import('../src/terrain.js');
const { createNoise2D } = await import('simplex-noise');
const { state } = await import('../src/state.js');

// test_aurora_respects_scene_depth_without_writing_depth
{
  const frozen = BIOMES.find((b) => b.id === 'frozen');
  const aurora = makeAurora(frozen);
  assert.ok(aurora, 'frozen biome should build aurora curtains');
  const curtains = aurora.userData.curtains;
  assert.ok(curtains.length > 0, 'aurora should have at least one curtain mesh');
  for (const curtain of curtains) {
    assert.notEqual(
      curtain.material.depthTest, false,
      'Aurora is a transparent backdrop effect, but it must still depth-test against foreground trees/grass so it cannot draw over them.'
    );
    assert.equal(
      curtain.material.depthWrite, false,
      'Aurora should remain non-depth-writing so its transparent curtains blend softly.'
    );
  }
}

// test_aurora_has_soft_edges_color_variation_and_shimmer
{
  const frozen = BIOMES.find((b) => b.id === 'frozen');
  const aurora = makeAurora(frozen);
  const frag = aurora.userData.curtains[0].material.fragmentShader;
  assert.match(frag, /uC/, 'Aurora should blend a third tint for richer color.');
  assert.match(frag, /edgeFade/, 'Aurora alpha should feather horizontally to avoid hard panel edges.');
  assert.match(frag, /shimmer/, 'Aurora should include a time-varying shimmer term.');
  assert.match(frag, /hash/i, 'Aurora should use soft noise breakup instead of solid bands.');
}

// test_aurora_biomes_define_three_distinct_tints
{
  for (const id of ['frozen', 'twilight', 'cloud']) {
    const tints = AURORA_TINTS[id];
    assert.ok(Array.isArray(tints) && tints.length === 3, `${id} should define exactly three aurora tints`);
    assert.equal(new Set(tints).size, 3, `${id}'s three aurora tints should be distinct`);
  }
}

// test_terrain_does_not_assign_null_custom_depth_material
{
  const biome = BIOMES.find((b) => b.id === 'verdant');
  const noise2D = createNoise2D(() => 0.5);
  const layout = pickLayout();
  const heightFn = makeHeightFn(noise2D, layout);
  const mesh = makeTerrain(biome, heightFn, state);
  // Three r184 crashes if customDepthMaterial is explicitly set to null; it
  // must either be left unassigned (undefined) or set to a real material.
  assert.notEqual(mesh.customDepthMaterial, null, 'customDepthMaterial must never be explicitly null');
  if (mesh.customDepthMaterial !== undefined) {
    assert.ok(mesh.customDepthMaterial.isMaterial, 'a defined customDepthMaterial must be a real material instance');
  }
}

console.log('sky-rendering-invariants.test.mjs passed');
