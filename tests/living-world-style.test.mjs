import assert from "node:assert/strict";

import {
  LIVING_WORLD_STYLE_ID,
  createLivingFaunaDNA,
  createLivingFloraRecipes,
  createLivingWorldBiome,
  resolveLivingWorldFlags,
} from "../src/living-world/style.js";

const source = Object.freeze({
  id: "cloud",
  name: "cloud island",
  ground: ["#111111", "#222222", "#333333"],
  flora: ["mushroom"],
  creatureCount: [10, 15],
  groveDetails: { fairyRing: true },
  cloudlike: true,
  cloudSwirl: true,
});

const flags = resolveLivingWorldFlags({
  livingWorld: true,
  generatedFauna: false,
  generatedFlora: false,
});
assert.deepEqual(flags, {
  livingWorld: true,
  generatedFlora: true,
  generatedFauna: true,
});

const biome = createLivingWorldBiome(source);
assert.equal(biome.id, source.id, "the host biome ID should remain URL-compatible");
assert.equal(biome.styleId, LIVING_WORLD_STYLE_ID);
assert.equal(biome.flora.length, 0, "the exclusive mode should suppress legacy flora");
assert.deepEqual(biome.creatureCount, [0, 0]);
assert.equal(biome.cloudlike, false, "source cloud terrain/PBR treatment must not leak");
assert.equal(biome.cloudSwirl, false, "source cloud-swirl opt-ins must not leak");
assert.equal(biome.presentation.hideLegacyFauna, true);
assert.equal(biome.presentation.hideMountains, true);
assert.equal(biome.presentation.hideAurora, true);
assert.equal(biome.presentation.hideCloudSwirl, true);
assert.equal(source.flora[0], "mushroom", "the source biome must remain untouched");
assert.equal(source.cloudlike, true, "source visual flags must remain untouched");

const floraA = createLivingFloraRecipes(0x1e);
const floraB = createLivingFloraRecipes(0x1e);
assert.deepEqual(floraA, floraB);
assert.deepEqual(
  floraA.map((recipe) => recipe.variant),
  ["veilcrown", "pulsebell", "threadgrass"],
);

const faunaA = createLivingFaunaDNA(0x1e, 0);
const faunaB = createLivingFaunaDNA(0x1e, 0);
const sibling = createLivingFaunaDNA(0x1e, 1);
assert.deepEqual(faunaA, faunaB);
assert.notEqual(faunaA.seed, sibling.seed);
assert.equal(faunaA.speciesId, sibling.speciesId);
assert.notDeepEqual(
  {
    body: faunaA.body,
    head: faunaA.head,
    legs: faunaA.legs,
    palette: faunaA.palette,
  },
  {
    body: sibling.body,
    head: sibling.head,
    legs: sibling.legs,
    palette: sibling.palette,
  },
  "siblings should select visibly different phenotypes within one family",
);

console.log("living-world-style.test.mjs passed");
