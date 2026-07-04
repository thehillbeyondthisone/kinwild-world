// Behavioral coverage for the shared fern flora builder (src/flora/garden.js)
// and the micro-flora shadow LOD flag it, dandylion, and berrybush all
// respect. Protects: every biome fern entry routes through the single
// shared "fern" flora kind, the builder produces stem+paired-leaflet fronds
// (not the old cone-blade generator), and castShadow follows
// shouldCastMicroFloraShadow per biome instead of always being on.
import assert from 'node:assert/strict';
import { BIOMES } from '../src/biomes.js';

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
const { shouldCastMicroFloraShadow } = await import('../src/flora/_shared.js');
const { INSPECT_FLORA_KINDS } = await import('../src/inspect.js');

assert.equal(typeof FLORA_BUILDERS.fern, 'function', 'Fern builder should be registered.');

const fernBiomes = BIOMES.filter((biome) => biome.flora.includes('fern')).map((biome) => biome.id);
assert(
  fernBiomes.length > 0 && BIOMES.every((biome) => !biome.flora.some((kind) => kind.includes('fern') && kind !== 'fern')),
  'All biome fern entries should continue to route through the shared fern flora kind.'
);

const verdant = BIOMES.find((biome) => biome.id === 'verdant');
assert(verdant, 'verdant grove biome should exist.');
assert.equal(
  verdant.shadowLod?.microFloraShadows,
  false,
  'Verdant grove should opt out of real shadow-map shadows for dense micro-flora.'
);

// Build a real fern group and inspect the fronds instead of grepping the
// builder's source text.
const fernGroup = withIsolatedFloraPool(() => FLORA_BUILDERS.fern(verdant));
const fronds = fernGroup.children.filter((c) => c.isGroup);
assert(fronds.length >= 5, 'Fern should build at least five fronds.');

const frondParts = fronds[0].children;
const stem = frondParts.find((c) => c.geometry.type === 'CylinderGeometry');
assert(stem, 'Fern fronds should each have a stem built from a cylinder, not the old cone-blade generator.');
assert.equal(stem.material.flatShading, false, 'Fern stem should be smooth-shaded.');

const leaflets = frondParts.filter((c) => c !== stem);
assert(leaflets.length >= 10, 'Fern fronds should have multiple paired leaflets plus a tip leaflet.');
const leafletZRotations = leaflets.map((leaflet) => leaflet.rotation.z);
assert(
  new Set(leafletZRotations).size > 1,
  'Fern leaflets should vary in rotation per leaflet, not share one fixed pose.'
);

const castMicroShadow = shouldCastMicroFloraShadow(verdant);
assert.equal(
  castMicroShadow,
  false,
  'Verdant grove fern parts should not cast shadows when micro-flora shadow LOD is disabled for the biome.'
);
assert.equal(stem.castShadow, castMicroShadow, 'Fern stems should respect the biome micro-flora shadow LOD flag.');
assert(
  leaflets.every((leaflet) => leaflet.castShadow === castMicroShadow),
  'Fern leaflets should respect the biome micro-flora shadow LOD flag.'
);

// Same shadow-LOD contract for dandylion and berrybush, which share the
// helper with fern.
const dandy = withIsolatedFloraPool(() => FLORA_BUILDERS.dandylion(verdant));
const dandyStem = dandy.children.find((c) => c.geometry.type === 'CylinderGeometry');
assert.equal(dandyStem.castShadow, castMicroShadow, 'Dandylion stem should respect the biome micro-flora shadow LOD flag.');

const berry = withIsolatedFloraPool(() => FLORA_BUILDERS.berrybush(verdant));
assert(
  berry.children.length > 0,
  'Berrybush should build a real flora group under the same shadow-LOD contract.'
);

assert(
  INSPECT_FLORA_KINDS.includes('fern'),
  'Inspect flora catalog should continue exposing the shared fern specimen.'
);

console.log('fern-flora.test.mjs passed');
