// Behavioral coverage for the ashen wastes biome's dead-tree-only flora mix
// and the shared PBR bark material it builds through. Protects: ashen never
// spawns living trees or wildflowers, deadtree/skull keep their registry
// order, and the deadtree builder wires its trunk/branches through the
// smooth-shaded, dark-bark PBR material helper (not a flat placeholder).
import assert from 'node:assert/strict';

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

const { BIOMES, FLOWER_DENSITY, WILDFLOWER_PALETTES } = await import('../src/biomes.js');
const { FLORA_BUILDERS, withIsolatedFloraPool } = await import('../src/flora.js');

const TREE_KINDS = new Set(['tree', 'leafballtree', 'pine', 'snowpine', 'balloontree']);
const ashen = BIOMES.find((biome) => biome.id === 'ashen');

assert(ashen, 'ashen wastes biome should exist.');
assert(ashen.flora.includes('deadtree'), 'Ashen wastes should use deadtree flora.');
assert(!ashen.flora.includes('dandylion'), 'Ashen wastes should not spawn dandy lion flora.');
assert.equal(FLOWER_DENSITY.ashen, 0, 'Ashen wastes should not spawn wildflower ground cover.');
assert.equal(
  Object.hasOwn(WILDFLOWER_PALETTES, 'ashen'),
  false,
  'Ashen wastes should not keep a wildflower palette when flowers are disabled.'
);
assert.equal(
  ashen.flora.filter((kind) => kind === 'lavafissure').length / ashen.flora.length,
  0.4,
  'Ashen wastes should weight lava fissures at 40% of flora picks, 20% below the old 50% mix.'
);
assert.deepEqual(
  ashen.flora.filter((kind) => TREE_KINDS.has(kind)),
  [],
  'Ashen wastes should not spawn living tree flora; use deadtree instead.'
);

const nonAshenDeadTreeBiomes = BIOMES
  .filter((biome) => biome.id !== 'ashen' && biome.flora.includes('deadtree'))
  .map((biome) => biome.id);
assert.deepEqual(
  nonAshenDeadTreeBiomes,
  [],
  'Only ashen wastes should include deadtree in its biome flora list.'
);

// deadtree and skull used to be adjacent in one flora file; after the
// per-kind split their relative order is a fact about the FLORA_BUILDERS
// registry object, not source text.
const builderKeys = Object.keys(FLORA_BUILDERS);
assert(
  builderKeys.indexOf('deadtree') < builderKeys.indexOf('skull'),
  'Dead tree builder should still be registered before skull flora in the FLORA_BUILDERS registry.'
);

// Build a real deadtree group for the ashen biome and inspect the actual
// meshes/material instead of grepping the builder's source text.
const deadTreeGroup = withIsolatedFloraPool(() => FLORA_BUILDERS.deadtree(ashen));
const deadTreeMeshes = deadTreeGroup.children.filter((child) => child.isMesh);
assert.equal(deadTreeMeshes.length, 5, 'Dead tree should build one trunk plus four branch meshes.');

const trunkMat = deadTreeMeshes[0].material;
assert(
  deadTreeMeshes.every((mesh) => mesh.material === trunkMat),
  'Dead tree trunk and branches should share one pooled material.'
);
assert.equal(
  trunkMat.flatShading,
  false,
  'Dead tree trunk and branches should use smooth-shaded normals/materials.'
);
assert.equal(
  trunkMat.type,
  'MeshPhysicalMaterial',
  'Dead tree flora should build its material through the PBR material helper (MeshPhysicalMaterial), not a plain fallback.'
);
assert.equal(
  trunkMat.specularIntensity,
  0.34,
  'Dead tree bark PBR should have enough subtle specular response to read under inspect lighting.'
);
assert.equal(
  trunkMat.normalScale.x,
  1.18,
  'Dead tree bark PBR should have enough normal strength to read under inspect lighting.'
);
assert(
  trunkMat.normalMap?.isTexture && trunkMat.roughnessMap?.isTexture && trunkMat.specularIntensityMap?.isTexture,
  'Dead tree bark PBR should generate cracked, charred, ashy normal/roughness texture detail.'
);

console.log('ashen-deadtrees.test.mjs passed');
