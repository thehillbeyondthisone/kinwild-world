// Behavioral coverage for the seaweed flora builder (src/flora/garden.js)
// and its per-biome spawn weighting. Protects: only the coral atoll biome
// spawns seaweed (double-weighted alongside branching/brain/cup coral), and
// the builder produces multi-segment wind-swaying blades with the
// surfaceReachRange/baseHeight metadata world.js needs to clamp seaweed
// height to water depth. world.js's water-depth placement logic stays as a
// source-text grep since that file is owned by another concurrent agent.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BIOMES } from '../src/biomes.js';

globalThis.__APP_VERSION__ = 'test';
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

globalThis.window = { location: { search: '' }, matchMedia: () => ({ matches: false }) };
Object.defineProperty(globalThis, 'navigator', { value: { maxTouchPoints: 0 }, configurable: true });

const { FLORA_BUILDERS, withIsolatedFloraPool } = await import('../src/flora.js');
const { INSPECT_FLORA_KINDS } = await import('../src/inspect.js');

const worldSource = ["world.js","world/atmosphere.js","world/flora-placement.js","world/fauna-population.js","world/ground-cover.js","world/portal-placement.js"].map((p) => readFileSync(new URL("../src/" + p, import.meta.url), "utf8")).join("\\n");

const coral = BIOMES.find((biome) => biome.id === 'coral');
assert(coral, 'coral atoll biome should exist.');
assert(coral.flora.includes('seaweed'), 'coral atoll should include seaweed in its flora mix.');
assert.equal(
  coral.flora.filter((kind) => kind === 'seaweed').length,
  16,
  'coral atoll should double seaweed weighting from 8 to 16 flora slots.'
);
assert.equal(
  coral.flora.filter((kind) => kind === 'coral').length,
  4,
  'coral atoll should double branching coral weighting from 2 to 4 flora slots.'
);
assert.equal(
  coral.flora.filter((kind) => kind === 'braincoral').length,
  2,
  'coral atoll should double brain coral weighting from 1 to 2 flora slots.'
);
assert.equal(
  coral.flora.filter((kind) => kind === 'cupcoral').length,
  2,
  'coral atoll should double cup coral weighting from 1 to 2 flora slots.'
);

for (const biome of BIOMES) {
  if (biome.id === 'coral') continue;
  assert.equal(biome.flora.includes('seaweed'), false, `${biome.id} should not spawn seaweed yet.`);
}

// Build a real seaweed group and inspect the actual blades instead of
// grepping the builder's source text.
const seaweed = withIsolatedFloraPool(() => FLORA_BUILDERS.seaweed(coral));
assert(seaweed.children.length >= 4, 'Seaweed should build at least four blades.');
const blade = seaweed.children[0];
assert.equal(blade.geometry.type, 'PlaneGeometry', 'Seaweed blades should be multi-segment planes.');
assert.equal(
  blade.geometry.parameters.heightSegments,
  6,
  'Seaweed blades should use 6 height segments for a baked curve.'
);
assert.deepEqual(
  seaweed.userData.surfaceReachRange,
  [0.5, 0.95],
  'Seaweed should expose a surface-reach range for water-surface fitting.'
);
assert.equal(seaweed.userData.baseHeight, 0.8, 'Seaweed should expose its base height for water-surface fitting.');

assert(
  worldSource.includes('const MEDIUM_DEEP_WATER_FLORA = new Set(["seaweed"])')
    && worldSource.includes('const WATER_FLORA_DEPTH_RANGE = {')
    && worldSource.includes('seaweed: [2.1, 3.7]')
    && worldSource.includes('const surfaceReach = f.userData.surfaceReachRange')
    && worldSource.includes('const targetReach = surfaceReach[0] + Math.random() * (surfaceReach[1] - surfaceReach[0])')
    && worldSource.includes('const WATER_FLORA_SURFACE_CLEARANCE = 0.10')
    && worldSource.includes('const maxHeight = Math.max(0, depth - WATER_FLORA_SURFACE_CLEARANCE)')
    && worldSource.includes('const targetHeight = Math.min(depth * targetReach, maxHeight)')
    && worldSource.includes('s = targetHeight / baseHeight')
    && !worldSource.includes('s *= targetHeight / baseHeight'),
  'World placement should restrict seaweed to medium/deep water and replace random scale with a surface-clamped height.'
);

assert(
  INSPECT_FLORA_KINDS.includes('seaweed'),
  'Inspect flora catalog should expose the seaweed specimen.'
);

console.log('seaweed-flora-static.test.mjs passed');
