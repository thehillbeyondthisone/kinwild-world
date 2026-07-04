// GLSL shader-patch content (balloonWispSoftNoise, spiral bands) inside
// applyBalloonPuffWisps isn't observable without a WebGL context, so those
// assertions stay source-text greps; so do environment.js/world.js/ui.js,
// which are owned by other concurrent agents.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BIOMES, GRASS_DENSITY } from '../src/biomes.js';

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
const { FLORA_BUILDERS, withIsolatedFloraPool } = await import('../src/flora.js');

const cloud = BIOMES.find((biome) => biome.id === 'cloud');
// applyBalloonPuffWisps (the GLSL shader-patch helper) lives in _shared.js;
// the balloontree builder itself lives in volcanic.js.
const floraSource = [
  readFileSync(new URL('../src/flora/_shared.js', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/flora/volcanic.js', import.meta.url), 'utf8'),
].join('\n');
const environmentSource = readFileSync(new URL('../src/environment.js', import.meta.url), 'utf8');
const worldSource = readFileSync(new URL('../src/world.js', import.meta.url), 'utf8');
const uiSource = ["ui.js","ui/context.js","ui/constants.js","ui/storage.js","ui/settings-panel.js","ui/help-panel.js","ui/catalog-panel.js","ui/locator-panel.js","ui/first-person.js","ui/photo-mode.js","ui/input.js"].map((p) => readFileSync(new URL("../src/" + p, import.meta.url), "utf8")).join("\n");

assert(cloud, 'cloud island biome should exist.');
assert.equal(
  cloud.flora.filter((kind) => kind === 'balloontree').length,
  3,
  'cloud island should use the cloud-specific balloontree in its tree slots.'
);
assert.equal(
  cloud.flora.includes('leafballtree'),
  false,
  'cloud island should not use leafballtree canopies, which read as flattened regular trees in this biome.'
);
assert.equal(
  Object.hasOwn(cloud, 'leafballTreePalette'),
  false,
  'cloud island should not keep a leafballTreePalette once it uses only balloontree for tree slots.'
);
assert.equal(cloud.flora.includes('rock'), false, 'cloud island should not spawn rock flora.');
assert.equal(cloud.flora.includes('dandylion'), true, 'cloud island should include dandy lions.');
assert.equal(GRASS_DENSITY.cloud, 0, 'cloud island should disable the instanced grass field.');
assert.equal(cloud.bloom, false, 'cloud island should opt out of bloom post-processing.');
assert.deepEqual(
  cloud.creatureColors,
  ['#fff4b8', '#ffe08a', '#f6c36a', '#ffd0a3'],
  'cloud island creatures should use warm yellow and peach colors with no blue palette entries.'
);
assert(
  cloud.creatureColors.every((hex) => {
    const red = Number.parseInt(hex.slice(1, 3), 16);
    const green = Number.parseInt(hex.slice(3, 5), 16);
    const blue = Number.parseInt(hex.slice(5, 7), 16);
    return red >= green && green >= blue;
  }),
  'cloud island creature colors should stay warm-channel dominant, not blue-dominant.'
);
assert.equal(
  environmentSource.includes('cloud-puff-pads'),
  false,
  'cloud island should not place flattened ground cloud pads that read as crushed trees.'
);
assert.equal(
  environmentSource.includes('variant: "cloudpuff"'),
  false,
  'cloud puff ambiance should not shift-click into unsupported cloudpuff inspect URLs that normalize to tree.'
);
// Build real balloontree groups and count the actual detail-puff/tether
// meshes instead of grepping the builder's source text. Math.random is
// pinned so the detail-puff count (8 + floor(random * 5)) is deterministic.
const originalRandom = Math.random;
Math.random = () => 0;
const cloudTree = withIsolatedFloraPool(() => FLORA_BUILDERS.balloontree(cloud));
const desert = BIOMES.find((biome) => biome.id === 'desert');
const desertTree = withIsolatedFloraPool(() => FLORA_BUILDERS.balloontree(desert));
Math.random = originalRandom;

const isTether = (c) => c.geometry.type === 'CylinderGeometry' && c.geometry.parameters.radiusTop === 0.006 && c.geometry.parameters.radiusBottom === 0.004;
const cloudTethers = cloudTree.children.filter(isTether);
const detailPuffCandidates = cloudTree.children.filter((c) => c.geometry.type === 'IcosahedronGeometry');
assert(
  cloudTethers.length >= 8,
  'cloud balloon trees should add extra small puff detail around the crown, tethered by strands from the trunk.'
);
assert(
  detailPuffCandidates.length > cloudTethers.length,
  'cloud balloon trees should render more puff meshes than tethers (crown + satellite + detail puffs).'
);
assert.equal(
  desertTree.children.filter(isTether).length,
  0,
  'non-cloudlike biomes should not add crown detail puffs or their tether strands.'
);
assert(
  floraSource.includes('function applyBalloonPuffWisps(material') && floraSource.includes('uBalloonWispStrength'),
  'balloon tree puff material should use a custom shader patch for wispy swirling bands.'
);
assert(
  floraSource.includes('float balloonWispSoftNoise(vec3 p)') && floraSource.includes('atan(vBalloonLocalPos.z, vBalloonLocalPos.x)'),
  'balloon tree wisps should be procedural and softly warped around each puff instead of relying on a flat texture.'
);
assert(
  floraSource.includes('applyBalloonPuffWisps(') && floraSource.includes('uTime'),
  'balloon tree wisps should animate through the shared wind time uniform.'
);
assert(
  floraSource.includes('uBalloonWispContrast') && floraSource.includes('uBalloonWispShadow'),
  'balloon tree wisps should include both bright and shadow bands so the animation reads on pale cloud puffs.'
);
assert(
  floraSource.includes('uBalloonWispTime * 0.46'),
  'balloon tree wisps should drift fast enough to be visible during normal viewing.'
);
assert(
  floraSource.includes('spiralPhase') && floraSource.includes('spiralRibbon'),
  'balloon tree wisps should use an explicit spiral phase/ribbon mask rather than mottled noise bands.'
);
assert(
  floraSource.includes('atan(vBalloonLocalPos.z, vBalloonLocalPos.x) * 2.8') && floraSource.includes('vBalloonLocalPos.y * 9.5'),
  'balloon tree spiral bands should wrap around the puff and climb vertically enough to read as swirl.'
);
assert(
  environmentSource.includes('yOffset: 0.16'),
  'cloud puff ambiance should sit partially sunk into the cloud terrain.'
);
assert(
  worldSource.includes('worldState.userSettings.bloom && biome.bloom !== false'),
  'world generation should keep bloom disabled for biomes that opt out.'
);
assert(
  uiSource.includes('bloomEl.checked && state.currentBiome?.bloom !== false'),
  'the FX toggle should not re-enable bloom while the current biome opts out.'
);

console.log('cloud-balloontree-static.test.mjs passed');
