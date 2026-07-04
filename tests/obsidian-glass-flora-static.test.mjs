// Behavioral coverage for the volcanic glass biome's flora mix and the
// obsidianglass builder (src/flora/volcanic.js). Protects: obsidian has no
// tree flora or leftover tree palette, obsidianglass is its own flora slot
// (not a tree replacement), and the shard builder uses a real high-shine
// physical material (black, high metalness/clearcoat/reflectivity) rather
// than a flat placeholder or a floating glint strip. The lava fissure's red
// band width lives entirely inside a GLSL fragment shader string, which
// isn't observable without a WebGL context, so that one assertion stays a
// source grep; so do the ui.js/world.js/world-constants.js references,
// since those files are owned by other concurrent agents.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
const { INSPECT_FLORA_KINDS } = await import('../src/inspect.js');

const obsidian = BIOMES.find((biome) => biome.id === 'obsidian');
const floraSource = readFileSync(new URL('../src/flora/volcanic.js', import.meta.url), 'utf8');
const uiSource = ["ui.js","ui/context.js","ui/constants.js","ui/storage.js","ui/settings-panel.js","ui/help-panel.js","ui/catalog-panel.js","ui/locator-panel.js","ui/first-person.js","ui/photo-mode.js","ui/input.js"].map((p) => readFileSync(new URL("../src/" + p, import.meta.url), "utf8")).join("\n");
const worldSource = ["world.js","world/atmosphere.js","world/flora-placement.js","world/fauna-population.js","world/ground-cover.js","world/portal-placement.js"].map((p) => readFileSync(new URL("../src/" + p, import.meta.url), "utf8")).join("\\n");
const worldConstantsSource = readFileSync(new URL('../src/world-constants.js', import.meta.url), 'utf8');
const fissureStart = floraSource.indexOf('lavafissure(biome)');
const fissureEnd = floraSource.indexOf('obsidianglass()', fissureStart);
const fissureBlock = floraSource.slice(fissureStart, fissureEnd);

assert(obsidian, 'volcanic glass biome should exist.');
assert(!obsidian.flora.includes('leafballtree'), 'volcanic glass should not spawn tree flora.');
assert.equal(
  obsidian.leafballTreePalette,
  undefined,
  'volcanic glass should not keep a tree palette when tree flora is removed.'
);
assert(obsidian.flora.includes('obsidianglass'), 'volcanic glass should include shiny obsidian glass flora.');
assert.equal(obsidian.noButterflies, true, 'volcanic glass should not spawn butterflies.');
assert.equal(
  obsidian.sunIntensity,
  8.8,
  'volcanic glass should be 10% brighter than the previous 8.0 sun intensity.'
);
assert(
  obsidian.flora.indexOf('obsidianglass') > obsidian.flora.indexOf('skull'),
  'obsidian glass should be its own volcanic glass flora slot, not a tree replacement in the list.'
);

// Build a real obsidianglass group and inspect the actual mesh/material
// instead of grepping the builder's source text.
const glass = withIsolatedFloraPool(() => FLORA_BUILDERS.obsidianglass());
assert(glass.children.length > 0, 'obsidianglass should build at least one shard mesh.');
const shard = glass.children[0];
assert.equal(shard.geometry.type, 'ConeGeometry', 'obsidian glass shards should be pointed cone shapes.');
const mat = shard.material;
assert.equal(mat.color.getHexString(), '020204', 'obsidian glass shards should be near-black.');
assert.equal(mat.emissive.getHex(), 0, 'obsidian glass shards should not glow.');
assert.equal(mat.roughness, 0.035, 'obsidian glass shards should be very smooth/glossy.');
assert.equal(mat.metalness, 0.88, 'obsidian glass shards should be near-metal.');
assert.equal(mat.clearcoat, 1.0, 'obsidian glass shards should have full clearcoat.');
assert.equal(mat.specularIntensity, 1.0, 'obsidian glass shards should have full specular intensity.');
assert.equal(mat.reflectivity, 1.0, 'obsidian glass shards should have full reflectivity.');
assert(
  glass.children.every((child) => !child.name?.includes('glint')),
  'obsidian glass flora should not have floating glint strips.'
);

assert(
  worldConstantsSource.includes('obsidianglass: 0.34')
    && worldSource.includes('"obsidianglass"')
    && worldSource.includes('obsidianglass: 1.6'),
  'obsidian glass flora should participate in slope planting and obstacle routing.'
);
assert(
  INSPECT_FLORA_KINDS.includes('obsidianglass')
    && uiSource.includes('obsidianglass: "Obsidian Glass"'),
  'shift-click and locator UI should treat obsidian glass as a dedicated inspectable flora variant.'
);

assert(fissureStart >= 0 && fissureEnd > fissureStart, 'Lava fissure builder should live before obsidian glass flora.');
assert(
  fissureBlock.includes('float redBand = smoothstep(0.0084375, 0.285, vAcross);'),
  'Lava fissure bright center should be 25% thinner than the previous 0.01125/0.38 band.'
);

console.log('obsidian-glass-flora-static.test.mjs passed');
