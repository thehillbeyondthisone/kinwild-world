// Behavioral coverage for the dandylion flora builder (src/flora/garden.js)
// and its per-biome spawn rules. Protects: dandy lions spawn on every biome
// with wildflowers enabled (plus cloud island), the builder produces a
// long stem, five leaves, a center head, and a fuzz-ball made of a line
// mesh + two point sprites (not instanced mesh geometry), and stem/leaf
// colors follow the biome flora palette instead of fixed greens. The wind
// shader math (GLSL) and world.js flower-spot wiring stay as source-text
// greps since GLSL content and files owned by other agents aren't
// introspectable this way.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BIOMES, FLOWER_DENSITY } from '../src/biomes.js';

globalThis.__APP_VERSION__ = 'test';
globalThis.window = { location: { search: '' }, matchMedia: () => ({ matches: false }) };
Object.defineProperty(globalThis, 'navigator', { value: { maxTouchPoints: 0 }, configurable: true });
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

const { FLORA_BUILDERS, withIsolatedFloraPool } = await import('../src/flora.js');
const { getDandylionFloraPalette, shouldCastMicroFloraShadow } = await import('../src/flora/_shared.js');

const worldSource = readFileSync(new URL('../src/world.js', import.meta.url), 'utf8');
const garden = readFileSync(new URL('../src/flora/garden.js', import.meta.url), 'utf8');

assert.equal(typeof FLORA_BUILDERS.dandylion, 'function', 'Dandy lion should be registered as a named flora builder.');

for (const biome of BIOMES) {
  const flowerDensity = FLOWER_DENSITY[biome.id] ?? 100;
  if ((flowerDensity > 0 && biome.id !== 'ashen') || biome.id === 'cloud') {
    assert(
      biome.flora.includes('dandylion'),
      `${biome.id} should spawn dandy lions anywhere wildflowers are enabled, plus cloud island's hand-placed puff flowers.`
    );
  } else {
    assert(
      !biome.flora.includes('dandylion'),
      `${biome.id} should not spawn dandy lions where wildflowers are disabled.`
    );
  }
}

// Build a real dandylion group for a wildflower-enabled biome and inspect the
// actual children instead of grepping the builder's source text.
const golden = BIOMES.find((biome) => biome.id === 'golden');
assert(golden, 'golden steppe biome should exist.');
const dandy = withIsolatedFloraPool(() => FLORA_BUILDERS.dandylion(golden));

const stem = dandy.children.find((c) => c.isMesh && c.geometry.type === 'CylinderGeometry');
assert(stem, 'Dandy lion should have a wind-swaying stem mesh.');
assert.equal(stem.geometry.parameters.height, 0.92, 'Dandy lion stem should be 0.92 units tall.');

const core = dandy.children.find((c) => c.isMesh && c.geometry.type === 'SphereGeometry');
assert(core, 'Dandy lion should have a center head/core mesh.');

const leaves = dandy.children.filter((c) => c.isMesh && c !== stem && c !== core);
assert.equal(leaves.length, 5, 'Dandy lion should have exactly five leaves.');
const leafRotations = leaves.map((leaf) => leaf.rotation.x);
assert(
  new Set(leafRotations).size > 1,
  'Dandy lion leaves should vary in pitch rather than all sharing one rotation.'
);

const fuzzLines = dandy.children.find((c) => c.type === 'LineSegments');
assert(fuzzLines, 'Dandy lion fuzz should render loose fibers as line segments, not instanced mesh geometry.');
assert.equal(
  fuzzLines.geometry.attributes.position.count,
  288 * 2,
  'Dandy lion fuzz should have 288 fiber lines (2 endpoints each).'
);

const pointClouds = dandy.children.filter((c) => c.type === 'Points');
assert.equal(pointClouds.length, 2, 'Dandy lion should render its attached and detached spores as two point clouds.');
const sporeCounts = pointClouds.map((p) => p.geometry.attributes.position.count).sort((a, b) => a - b);
assert.deepEqual(
  sporeCounts,
  [6, 288],
  'Dandy lion should have 288 attached spores and a small stream of 6 detached spores.'
);
assert(
  dandy.children.every((c) => c.type !== 'InstancedMesh' && c.geometry?.type !== 'IcosahedronGeometry'),
  'Dandy lion fuzz should not use instanced mesh puff geometry.'
);

const palette = getDandylionFloraPalette(golden);
assert.equal(
  stem.material.color.getHex(),
  palette.stem.getHex(),
  'Dandy lion stem should adopt the biome flora palette instead of a fixed green color.'
);
const leafMat = leaves[0].material;
assert.equal(
  leafMat.color.getHex(),
  palette.leaf.getHex(),
  'Dandy lion leaves should adopt the biome flora palette instead of a fixed green color.'
);

const castMicroShadow = shouldCastMicroFloraShadow(golden);
assert.equal(stem.castShadow, castMicroShadow, 'Dandy lion stem should respect the biome micro-flora shadow LOD flag.');
assert(
  leaves.every((leaf) => leaf.castShadow === castMicroShadow),
  'Dandy lion leaves should respect the biome micro-flora shadow LOD flag.'
);
assert.equal(core.castShadow, castMicroShadow, 'Dandy lion head should respect the biome micro-flora shadow LOD flag.');

assert.equal(
  stem.material.flatShading,
  false,
  'Dandy lion stem should be smooth-shaded.'
);
assert.equal(core.material.flatShading, false, 'Dandy lion center ball should be smooth-shaded.');

// The wind-sway GLSL math (rigid seed-head displacement vs. per-vertex noise)
// lives entirely inside shader source strings, which aren't observable
// without a WebGL context — keep those as targeted source greps.
assert(
  garden.includes('vec4 wp = modelMatrix * vec4(vec3(0.0, uDandylionHeadY, 0.0), 1.0)')
    && garden.includes('float windY = uDandylionHeadY')
    && !garden.includes('float windY = max(p.y, 0.0)'),
  'Dandy lion fuzz shader should use one rigid seed-head wind displacement so the spore sphere does not distort.'
);

assert(
  worldSource.includes('kind === "berrybush" || kind === "dandylion"')
    && worldSource.includes('f.userData.flowerSpotY'),
  'Dandy lion heads should be available as flower spots for fliers.'
);

const { INSPECT_FLORA_KINDS } = await import('../src/inspect.js');
assert(
  INSPECT_FLORA_KINDS.includes('dandylion'),
  'Inspect flora catalog should expose the dandy lion specimen.'
);

console.log('dandylion-flora-static.test.mjs passed');
