// Behavioral coverage for the leafball tree palette/shadow-proxy helpers
// (src/flora/_shared.js) and golden steppe's biome config. Real values are
// asserted through BIOMES data and by calling the actual palette/shadow-proxy
// helpers rather than grepping their source text. world.js/world-constants.js
// checks (footprint table, canopy spacing, tree radius flag) stay as
// source-text greps since those files are owned by other concurrent agents;
// deep internal geometry-construction constants inside the leafballtree
// builder (leaf ring phase offsets, tuck angles) also stay as greps since
// they aren't exposed on any object a test can introspect.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BIOMES, BALD_THRESHOLD } from '../src/biomes.js';

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

const { getLeafballTreePalette, getLeafballOutlineColor, shouldUseLeafballCanopyShadowProxy } =
  await import('../src/flora/_shared.js');
const { FLORA_BUILDERS, withIsolatedFloraPool } = await import('../src/flora.js');

const floraSource = readFileSync(new URL('../src/flora/trees.js', import.meta.url), 'utf8');
const worldSource = ["world.js","world/atmosphere.js","world/flora-placement.js","world/fauna-population.js","world/ground-cover.js","world/portal-placement.js"].map((p) => readFileSync(new URL("../src/" + p, import.meta.url), "utf8")).join("\\n");
// ARC-002: FLORA_FOOTPRINT lives in the shared constants module now.
const worldConstantsSource = readFileSync(new URL('../src/world-constants.js', import.meta.url), 'utf8');

const golden = BIOMES.find((biome) => biome.id === 'golden');
assert(golden, 'golden steppe biome should exist.');
assert(golden.leafballTreePalette, 'golden steppe should define a specific leafball tree palette.');
assert.deepEqual(
  golden.leafballTreePalette.leaves,
  ['#9a6d24', '#c49a3d', '#f1c86b'],
  'golden steppe leafball palette should use bronze, ochre, and honey leaf colors.'
);

// getLeafballTreePalette passes an override.leaves entry straight through
// (it only falls back to a computed THREE.Color when no override is set),
// so an overridden leaf stays the raw hex string from biomes.js.
const resolvedPalette = getLeafballTreePalette(golden);
assert.deepEqual(
  resolvedPalette.leaves,
  ['#9a6d24', '#c49a3d', '#f1c86b'],
  'leafballtree should resolve colors through the biome-aware palette helper, applying all three overrides.'
);
assert.notEqual(
  resolvedPalette.leaves[1],
  '#6f7f35',
  'golden steppe leafball palette should not leave the lower canopy olive green.'
);
assert.deepEqual(
  getLeafballOutlineColor(resolvedPalette.leaves, resolvedPalette.trunk).getHexString(),
  resolvedPalette.outline.getHexString(),
  'leafballtree palette outline should be derived from the same leaves/trunk resolution used to build the tree.'
);

const forestBiome = BIOMES.find((biome) => biome.id !== 'golden' && !biome.leafballTreePalette);
assert(forestBiome, 'a non-golden biome without a palette override should exist for a fallback-path comparison.');
const fallbackPalette = getLeafballTreePalette(forestBiome);
assert.notDeepEqual(
  fallbackPalette.leaves.map((c) => c.getHexString()),
  resolvedPalette.leaves,
  'a biome without a leafballTreePalette override should resolve different leaf colors than golden steppe.'
);

assert.equal(
  golden.flora.filter((kind) => kind === 'leafballtree').length,
  2,
  'golden steppe should use leafballtree entries instead of regular tree entries.'
);
assert(!golden.flora.includes('tree'), 'golden steppe flora should no longer include regular tree entries.');
// ARC-010: the wider tree-placement radius is now a biome flag
// (treeFloraRadiusFrac) instead of a `biome.id === "golden"` branch.
assert.equal(
  golden.treeFloraRadiusFrac,
  0.98,
  'golden steppe should declare the wider tree placement radius via the treeFloraRadiusFrac biome flag.'
);
assert(
  worldSource.includes('biome.treeFloraRadiusFrac !== undefined && (kind === "tree" || kind === "leafballtree")'),
  'golden steppe leafballtrees should keep the wider tree placement radius used by former regular trees.'
);
assert.equal(
  BALD_THRESHOLD.golden,
  0.00,
  'golden steppe grass blade bald/spot percentage should be 0.'
);
assert.equal(golden.edgeAura?.pattern, 'mist', 'golden steppe should have a mist edge aura.');

assert(
  floraSource.includes('const branchReach = 0.62'),
  'leafballtree internal branches should reach closer to the canopy than the old 0.46 radius.'
);
assert(
  floraSource.includes('const minLeafMotionGap = 0.20') && floraSource.includes('canopyRadius.x - minLeafMotionGap'),
  'leafballtree branch reach should retain a clearance gap for leaf wind motion.'
);

const leafballFootprintMatch = worldConstantsSource.match(/leafballtree:\s*([0-9.]+)/);
assert(leafballFootprintMatch, 'leafballtree should have an explicit slope-plant footprint.');
assert(
  Number.parseFloat(leafballFootprintMatch[1]) <= 0.35,
  'leafballtree slope-plant footprint should describe the trunk base, not the canopy width, so bases stay near the terrain surface.'
);
assert(
  worldConstantsSource.includes('CANOPY_SPACING_KINDS = new Set(["tree", "leafballtree"'),
  'leafballtree broad-canopy spacing should remain handled by canopy spacing, not slope-plant footprint.'
);
assert(
  worldSource.includes('if (kind === "berrybush") s *= 1 + Math.random() * 0.25;'),
  'berry bushes should keep the existing size as the minimum and vary up to 25% larger.'
);
assert(
  floraSource.includes('addLeafRing({ count: 6, phi: 0.07, shell: 0.54, scale: 0.72, matIndex: 2')
    && floraSource.includes('pitchOffset: topMotionTuckAngle')
    && floraSource.includes('const topHighlightRows = 3;')
    && floraSource.includes('const matIndex = row < topHighlightRows ? 2 : row > 6 ? 0 : 1;'),
  'leafballtree top cap and upper rows should use the same highlight leaf palette and tuck angle.'
);
assert(
  floraSource.includes('const topMotionTuckRows = 4;')
    && floraSource.includes('const topMotionTuckAngle = -(0.045 + THREE.MathUtils.degToRad(2));')
    && floraSource.includes('const firstTopRowBackoffAngle = THREE.MathUtils.degToRad(2);')
    && floraSource.includes('pitchOffset: row === 0 ? topMotionTuckAngle + firstTopRowBackoffAngle : row < topMotionTuckRows ? topMotionTuckAngle : 0,'),
  'leafballtree first top row should back off two degrees while the cap and next top rows keep the stronger tuck.'
);
assert(
  floraSource.includes('const earlyRowPhaseOffsets = [0.16, 0.48, -0.08, 0.31];')
    && floraSource.includes('const rowPhase = row < earlyRowPhaseOffsets.length ? earlyRowPhaseOffsets[row] : staggerPhase;')
    && floraSource.includes('phase: rowPhase,')
    && floraSource.includes('if (row >= earlyRowPhaseOffsets.length) staggerPhase += Math.PI / rowCounts[row];'),
  'leafballtree rows 0-3 should use explicit non-cumulative phase offsets so their first leaves do not form a visible seam.'
);

const verdant = BIOMES.find((biome) => biome.id === 'verdant');
assert(verdant, 'verdant grove biome should exist.');
assert.equal(
  verdant.shadowLod?.leafballCanopyProxy,
  true,
  'Verdant grove should opt into a simplified leafball canopy shadow proxy.'
);
assert.equal(
  shouldUseLeafballCanopyShadowProxy(verdant),
  true,
  'Leafball tree shadow proxy usage should be controlled by the biome shadow LOD flag.'
);
assert.equal(
  shouldUseLeafballCanopyShadowProxy(golden),
  false,
  'A biome without the leafballCanopyProxy flag should not use the shadow proxy.'
);

// Build real leafballtree groups for both biomes and inspect the actual
// leaf-batch/shadow-proxy meshes instead of grepping the builder's source.
const proxyTree = withIsolatedFloraPool(() => FLORA_BUILDERS.leafballtree(verdant));
const directTree = withIsolatedFloraPool(() => FLORA_BUILDERS.leafballtree(golden));

// renderOrder -1 marks the always-shadowless outline batches added in their
// own loop before the (shadow-toggling) fill-leaf batches, so exclude them
// to isolate the leaf batches the LOD flag actually affects.
const proxyLeafBatches = proxyTree.children.filter((c) => c.isInstancedMesh && c.renderOrder !== -1);
const proxyShadowProxy = proxyTree.children.find((c) => c.isMesh && !c.isInstancedMesh && c.material.colorWrite === false);
assert(proxyShadowProxy, 'Leafball tree should add a dedicated invisible shadow-proxy mesh when the LOD is enabled.');
assert.equal(
  proxyShadowProxy.castShadow,
  true,
  'The leafball canopy shadow proxy should cast shadows on behalf of the leaf batches.'
);
assert(
  proxyLeafBatches.length > 0 && proxyLeafBatches.every((batch) => batch.castShadow === false),
  'Leafball tree canopies should keep visible leaf batches but turn off their own shadow casting when the proxy is enabled.'
);

const directLeafBatches = directTree.children.filter((c) => c.isInstancedMesh && c.renderOrder !== -1);
const directShadowProxy = directTree.children.find((c) => c.isMesh && !c.isInstancedMesh && c.material.colorWrite === false);
assert.equal(
  directShadowProxy,
  undefined,
  'Leafball tree should not add a shadow-proxy mesh for a biome without the LOD flag.'
);
assert(
  directLeafBatches.length > 0 && directLeafBatches.every((batch) => batch.castShadow === true),
  'Leafball tree leaf batches should cast their own shadows when the proxy LOD is disabled.'
);

console.log('leafballtree-palette-static.test.mjs passed');
