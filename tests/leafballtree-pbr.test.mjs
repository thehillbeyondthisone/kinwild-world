// Behavioral coverage for the leafball tree's trunk/leaf PBR materials
// (src/pbr.js) and the geometry they're applied to (src/flora/trees.js).
// Protects: the trunk and canopy leaves build MeshPhysicalMaterial through
// dedicated PBR helpers (falling back to plain MeshStandardMaterial only
// under LOWFX/no-pbrDetails), have normal/roughness/specular maps and
// values strong enough to read under inspect lighting, and the leaf
// geometry has enough length/width segments plus rib-lift z displacement
// for veins to read beyond the texture maps.
import assert from 'node:assert/strict';
import * as THREE from 'three';

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

const { state } = await import('../src/state.js');
const { BIOMES } = await import('../src/biomes.js');
const { FLORA_BUILDERS, withIsolatedFloraPool } = await import('../src/flora.js');
const { makeLeafballTreeTrunkPBRMaterial, makeLeafballTreeLeafPBRMaterial } = await import('../src/pbr.js');

state.userSettings.pbrDetails = true;

const golden = BIOMES.find((biome) => biome.id === 'golden');
assert(golden, 'golden steppe biome should exist.');

// Build a real leafball tree and inspect its actual meshes instead of
// grepping the builder's source text.
const tree = withIsolatedFloraPool(() => FLORA_BUILDERS.leafballtree(golden));

const trunk = tree.children.find((c) => c.geometry.type === 'CylinderGeometry');
assert(trunk, 'leafballtree should build a cylindrical trunk mesh.');
assert.equal(
  trunk.material.flatShading,
  false,
  'leafballtree trunk should be smooth-shaded so bark PBR detail is visible instead of faceted.'
);
assert.equal(
  trunk.material.type,
  'MeshPhysicalMaterial',
  'leafballtree trunk should build its material through the PBR helper (MeshPhysicalMaterial), not a plain fallback.'
);
assert.equal(trunk.material.specularIntensity, 0.46, 'leafballtree bark PBR should be strong enough to read under inspect lighting.');
assert.equal(trunk.material.normalScale.x, 0.90, 'leafballtree bark PBR normal strength should read under inspect lighting.');

const leafBatch = tree.children.find((c) => c.isInstancedMesh && c.renderOrder !== -1);
assert(leafBatch, 'leafballtree should build at least one visible (non-outline) leaf batch.');
assert.equal(
  leafBatch.material.type,
  'MeshPhysicalMaterial',
  'leafballtree leaves should build their material through the PBR helper (MeshPhysicalMaterial), not a plain fallback.'
);
assert.equal(leafBatch.material.specularIntensity, 0.58, 'leafballtree leaf PBR should be strong enough for subtle highlights to read.');
assert.equal(leafBatch.material.normalScale.x, 0.72, 'leafballtree leaf PBR normal strength should read under inspect lighting.');

// buildLeafGeo produces (lengthSegs + 1) * (widthSegs + 1) vertices; the
// leafballtree leaf uses lengthSegs: 14, widthSegs: 8 for enough geometry
// resolution, and centerRibLift/secondaryRibLift should visibly displace
// vertices along the leaf's local z-axis so ribs read beyond the texture.
const leafGeo = leafBatch.geometry;
assert.equal(
  leafGeo.attributes.position.count,
  15 * 9,
  'leafballtree leaves should have enough geometry (lengthSegs: 14, widthSegs: 8) for veins to read beyond texture maps.'
);
let minZ = Infinity;
let maxZ = -Infinity;
for (let i = 0; i < leafGeo.attributes.position.count; i++) {
  const z = leafGeo.attributes.position.getZ(i);
  if (z < minZ) minZ = z;
  if (z > maxZ) maxZ = z;
}
assert(
  maxZ - minZ > 0.02,
  'leafballtree leaf geometry should have visible center/secondary rib lift displacing vertices along z.'
);
assert.equal(leafBatch.material.flatShading, false, 'leafballtree leaves should use smooth shading, not flat plates.');

// Direct construction coverage for the two PBR helpers themselves: both
// build a full MeshPhysicalMaterial with normal/roughness/specular maps
// when PBR details are enabled, and fall back to a plain
// MeshStandardMaterial (no canvas work at all) when they're disabled.
const trunkMat = makeLeafballTreeTrunkPBRMaterial({ color: '#7a5230' });
assert(trunkMat.normalMap?.isTexture && trunkMat.roughnessMap?.isTexture && trunkMat.specularIntensityMap?.isTexture,
  'leafballtree bark PBR should generate normal, roughness, and specular intensity maps.');

const leafMat = makeLeafballTreeLeafPBRMaterial({ color: '#4f7d2b' });
assert(leafMat.normalMap?.isTexture && leafMat.roughnessMap?.isTexture && leafMat.specularIntensityMap?.isTexture,
  'leafballtree leaf PBR should generate normal, roughness, and specular intensity maps.');

state.userSettings.pbrDetails = false;
const fallbackTrunk = makeLeafballTreeTrunkPBRMaterial({ color: '#7a5230' });
assert.equal(
  fallbackTrunk.type,
  'MeshStandardMaterial',
  'leafballtree PBR details should be skipped for low-FX mode or when the user setting disables them.'
);
assert(!(fallbackTrunk instanceof THREE.MeshPhysicalMaterial), 'the fallback material should not be a MeshPhysicalMaterial.');
state.userSettings.pbrDetails = true;

console.log('leafballtree-pbr.test.mjs passed');
