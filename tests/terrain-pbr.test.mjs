// Behavioral coverage for the terrain PBR material (src/pbr.js
// makeTerrainPBRMaterial, wired in from src/terrain.js makeTerrain) and its
// disposal (src/state.js disposeGroup). Builds a real terrain mesh and
// checks its actual material instead of grepping source text: it should be
// a MeshPhysicalMaterial with object-space normal/roughness/specular maps
// when PBR details are enabled, fall back to plain MeshStandardMaterial
// under LOWFX/no-pbrDetails, and have its PBR textures disposed when the
// world group is torn down on regen.
import assert from 'node:assert/strict';
import * as THREE from 'three';

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

const { state, disposeGroup } = await import('../src/state.js');
const { makeTerrain } = await import('../src/terrain.js');
const { BIOMES } = await import('../src/biomes.js');

state.userSettings.pbrDetails = true;
const golden = BIOMES.find((biome) => biome.id === 'golden');
assert(golden, 'golden steppe biome should exist.');
const heightFn = () => 0;

const terrainMesh = makeTerrain(golden, heightFn);
assert.equal(
  terrainMesh.material.type,
  'MeshPhysicalMaterial',
  'terrain should build through the PBR material helper (MeshPhysicalMaterial) for non-metal reflectivity and specular intensity maps.'
);
assert.equal(
  terrainMesh.material.normalMapType,
  THREE.ObjectSpaceNormalMap,
  'terrain normal detail should use object-space normals to avoid requiring terrain tangents.'
);
assert(
  terrainMesh.material.normalMap?.isTexture,
  'terrain PBR helper should procedurally generate a normal CanvasTexture.'
);
assert.equal(
  terrainMesh.material.roughnessMap,
  terrainMesh.material.specularIntensityMap,
  'terrain should pack roughness and specular intensity into one shared material texture.'
);
assert.equal(
  terrainMesh.material.normalMap.colorSpace,
  THREE.NoColorSpace,
  'procedural PBR data textures should be sampled as data, not color-managed albedo.'
);

// Fallback path: pbrDetails off should skip canvas work entirely and
// return a plain MeshStandardMaterial.
state.userSettings.pbrDetails = false;
const fallbackMesh = makeTerrain(golden, heightFn);
assert.equal(
  fallbackMesh.material.type,
  'MeshStandardMaterial',
  'terrain PBR details should be skipped for low-FX mode or when the user setting disables them.'
);
state.userSettings.pbrDetails = true;

// Disposal: disposeGroup should dispose the terrain material's PBR
// textures, not just the material itself.
const disposedTextures = [];
const normalMap = terrainMesh.material.normalMap;
const originalDispose = normalMap.dispose.bind(normalMap);
normalMap.dispose = () => {
  disposedTextures.push('normalMap');
  originalDispose();
};
const group = new THREE.Group();
group.add(terrainMesh);
disposeGroup(group);
assert.deepEqual(
  disposedTextures,
  ['normalMap'],
  'disposeGroup should dispose material-owned PBR textures on world regen.'
);

console.log('terrain-pbr.test.mjs passed');
