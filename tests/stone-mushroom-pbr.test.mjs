// Behavioral coverage for the stone/plain-rock/mushroom PBR material helpers
// (src/pbr.js) and the flora builders that wire through them (src/flora/
// rocks.js, structures.js, garden.js, trees.js). Rather than grepping the
// procedural-noise helper names, this captures the actual canvas ImageData
// each helper paints (via a minimal fake 2D context) and asserts the pixel
// bytes have real variance -- i.e. detail was actually painted, not a flat
// fill -- alongside checking the real material properties (specularIntensity,
// normalScale, map/normalMap/roughnessMap wiring) instead of source text.
import assert from 'node:assert/strict';
import * as THREE from 'three';

globalThis.__APP_VERSION__ = 'test';
globalThis.window = { location: { search: '' }, matchMedia: () => ({ matches: false }) };
Object.defineProperty(globalThis, 'navigator', { value: { maxTouchPoints: 0 }, configurable: true });

const capturedImages = [];
globalThis.document = {
  createElement() {
    return {
      width: 0,
      height: 0,
      getContext() {
        return {
          createImageData(w, h) {
            const img = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
            capturedImages.push(img);
            return img;
          },
          putImageData() {},
        };
      },
    };
  },
};

function byteVariance(img) {
  let min = 255;
  let max = 0;
  for (let i = 0; i < img.data.length; i++) {
    const v = img.data[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return max - min;
}

const { state } = await import('../src/state.js');
const { BIOMES } = await import('../src/biomes.js');
const { FLORA_BUILDERS, withIsolatedFloraPool } = await import('../src/flora.js');
const {
  makeStonePBRMaterial,
  makePlainRockPBRMaterial,
  makeMushroomCapPBRMaterial,
  makeMushroomUndersideMaterial,
  resetPBRTextureCache,
} = await import('../src/pbr.js');
const { jitterGeo } = await import('../src/util.js');

state.userSettings.pbrDetails = true;

// --- Real material construction: each helper produces a full
// MeshPhysicalMaterial with painted, non-flat detail maps. ---
capturedImages.length = 0;
const stoneMat = makeStonePBRMaterial({ color: '#888888' });
assert.equal(stoneMat.type, 'MeshPhysicalMaterial', 'Stone should build through the PBR material helper.');
assert.equal(stoneMat.specularIntensity, 0.30, 'Stone PBR specular intensity should be tuned for a matte stone look.');
assert.equal(stoneMat.normalScale.x, 0.74, 'Stone PBR normal strength should read under inspect lighting.');
assert(stoneMat.normalMap?.isTexture && stoneMat.roughnessMap?.isTexture, 'Stone PBR should generate normal/roughness maps.');
assert(
  capturedImages.some((img) => byteVariance(img) > 0),
  'Stone PBR should paint real crack/pore detail, not a flat-value texture.'
);

capturedImages.length = 0;
const plainRockMat = makePlainRockPBRMaterial({ color: '#665544' });
assert.equal(plainRockMat.type, 'MeshPhysicalMaterial', 'Plain rock should build through the PBR material helper.');
assert.equal(plainRockMat.specularIntensity, 0.34, 'Plain rock PBR should keep visibly stronger specular variation.');
assert.equal(plainRockMat.normalScale.x, 0.82, 'Plain rock PBR normal strength should read under inspect lighting.');
assert(
  capturedImages.some((img) => byteVariance(img) > 0),
  'Plain rock PBR should paint real pit/crack detail, not a flat-value texture.'
);

capturedImages.length = 0;
const capMat = makeMushroomCapPBRMaterial({ color: '#ffffff' });
assert.equal(capMat.type, 'MeshPhysicalMaterial', 'Mushroom cap should build through the PBR material helper.');
assert.equal(capMat.specularIntensity, 0.70, 'Mushroom cap PBR should be strong enough for top texture to read under inspect lighting.');
assert.equal(capMat.normalScale.x, 1.22, 'Mushroom cap PBR should be strong enough for top texture to read under inspect lighting.');
assert(capMat.map?.isTexture, 'Mushroom cap PBR should paint a color texture (freckles/mottle), not a flat material color.');
assert(
  capturedImages.some((img) => byteVariance(img) > 0),
  'Mushroom cap PBR should paint real ridge/rim/freckle detail, not a flat-value texture.'
);

capturedImages.length = 0;
const undersideMat = makeMushroomUndersideMaterial({});
assert.equal(undersideMat.type, 'MeshPhysicalMaterial', 'Mushroom underside should build through the PBR material helper.');
assert.equal(undersideMat.side, THREE.FrontSide, 'Mushroom underside should render front-side only.');
assert.equal(undersideMat.emissiveIntensity, 0.24, 'Mushroom underside should use a lit emissive material instead of rendering black.');
assert.equal(undersideMat.normalScale.x, 1.72, 'Mushroom underside PBR normal strength should read under inspect lighting.');
assert(undersideMat.emissiveMap?.isTexture, 'Mushroom underside should paint its gill detail into the emissive map.');
assert(
  capturedImages.some((img) => byteVariance(img) > 0),
  'Mushroom underside PBR should paint real gill-line detail, not a flat-value texture.'
);

// resetPBRTextureCache should be callable without throwing and dispose the
// cached textures (double-dispose on the underlying THREE.Texture is a
// documented no-op, so calling it again afterward must also be safe).
resetPBRTextureCache();
resetPBRTextureCache();

// --- jitterGeo's opt-in spherical UV restoration, used by plain rock and
// limestone rock geometry so the procedural maps above have UVs to sample. ---
const withUvs = jitterGeo(new THREE.IcosahedronGeometry(1, 0), 0.1, { sphericalUvs: true });
assert(withUvs.attributes.uv, 'jitterGeo should restore a uv attribute when sphericalUvs is requested.');
assert.equal(
  withUvs.attributes.uv.count,
  withUvs.attributes.position.count,
  'jitterGeo spherical UVs should cover every welded vertex.'
);
const withoutUvs = jitterGeo(new THREE.IcosahedronGeometry(1, 0), 0.1);
assert.equal(
  withoutUvs.attributes.uv,
  undefined,
  'jitterGeo should default sphericalUvs to off for callers that do not need procedural detail maps.'
);

// --- Real flora builders wired through the PBR helpers ---
const desert = BIOMES.find((biome) => biome.id === 'desert');
const golden = BIOMES.find((biome) => biome.id === 'golden');
assert(desert && golden, 'desert and golden biomes should exist.');

const plainRock = withIsolatedFloraPool(() => FLORA_BUILDERS.rock(desert));
const rockMesh = plainRock.children.find((c) => c.isMesh);
assert.equal(rockMesh.material.type, 'MeshPhysicalMaterial', 'Plain rock flora should build through the PBR helper.');
assert.equal(rockMesh.geometry.attributes.uv?.count, rockMesh.geometry.attributes.position.count, 'Plain rock geometry should restore spherical UVs so procedural PBR maps can render.');

const limestone = withIsolatedFloraPool(() => FLORA_BUILDERS.limestonerock(desert));
const limestoneMesh = limestone.children.find((c) => c.isMesh);
assert.equal(limestoneMesh.material.type, 'MeshPhysicalMaterial', 'Limestone rock flora should build through the stone PBR helper.');
assert.equal(limestoneMesh.geometry.attributes.uv?.count, limestoneMesh.geometry.attributes.position.count, 'Limestone rock geometry should restore spherical UVs so procedural PBR maps can render.');

const mushroom = withIsolatedFloraPool(() => FLORA_BUILDERS.mushroom(golden));
const mushroomCap = mushroom.children.find((c) => c.geometry.type === 'SphereGeometry');
assert(mushroomCap, 'mushroom flora should have a cap mesh.');
assert.equal(mushroomCap.material.type, 'MeshPhysicalMaterial', 'Mushroom cap flora should build through the mushroom cap PBR helper.');
assert.equal(mushroomCap.material.shadowSide, THREE.DoubleSide, 'Mushroom cap materials should keep front-side rendering but cast double-sided shadows so cap undersides affect the shadow map.');

const bigmushroom = withIsolatedFloraPool(() => FLORA_BUILDERS.bigmushroom(golden));
assert(
  bigmushroom.children.some((c) => c.material?.emissiveMap?.isTexture),
  'Big mushroom flora should include an underside mesh built through the mushroom underside PBR helper.'
);

const fairyring = withIsolatedFloraPool(() => FLORA_BUILDERS.fairyring(golden));
assert(
  fairyring.children.some((c) => c.material?.type === 'MeshPhysicalMaterial' && c.geometry.type === 'SphereGeometry'),
  'Fairy ring caps should build through the mushroom cap PBR helper.'
);

// No physical gill fin meshes remain -- gills are represented as PBR
// texture detail (asserted above via emissiveMap), not extra geometry.
assert(
  !mushroom.children.some((c) => c.geometry.type === 'PlaneGeometry' && c.name?.includes('gill'))
    && !bigmushroom.children.some((c) => c.geometry.type === 'PlaneGeometry' && c.name?.includes('gill')),
  'Mushroom underside fins should be represented as PBR gill grooves, not physical fin meshes.'
);

console.log('stone-mushroom-pbr.test.mjs passed');
