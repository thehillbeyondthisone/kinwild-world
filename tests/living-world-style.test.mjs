import assert from "node:assert/strict";

import {
  LIVING_WORLD_STYLE_ID,
  createLivingWorldBiome,
  resolveLivingWorldFlags,
} from "../src/living-world/style.js";
import {
  createFaunaRoster,
  createFloraRoster,
} from "../src/living-world/roster.js";
import { BIOMES } from "../src/biomes.js";

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

// Rosters replace the three frozen recipes. Assert the shape — role coverage,
// determinism, distinct species — rather than specific literals, which is what
// pinned this file to Veilcrown/Pulsebells/Threadgrass before.
const floraA = createFloraRoster(biome, 0x1e);
const floraB = createFloraRoster(biome, 0x1e);
assert.deepEqual(floraA, floraB, "the same field must draw the same roster");
assert.ok(floraA.length >= 5, "a field should grow a small community, not three plants");
for (const role of ["hero", "mid", "ground"]) {
  assert.ok(
    floraA.some((recipe) => recipe.role === role),
    `the roster must cover the ${role} role`,
  );
}
assert.ok(
  floraA.filter((recipe) => recipe.role === "mid").length > 1,
  "a role should be able to carry more than one species",
);
assert.equal(
  new Set(floraA.map((recipe) => recipe.family)).size,
  floraA.length,
  "a field should not draw the same family twice",
);
// The catalog and the taxonomy medallions key on `variant`, so it must stay
// the stable family — otherwise the Field Guide grows without bound as seeds
// are explored and every existing entry stops lining up.
for (const recipe of floraA) {
  assert.equal(recipe.variant, recipe.family, "variant must remain the stable family key");
  assert.ok(recipe.label.length > 0, "each specimen needs a name");
}
// Different seeds and different biomes both move the roster.
const otherSeed = createFloraRoster(biome, 0x2f);
// Two real biomes, not a hand-made fixture: species colour follows the
// field's warm end (accent and sun), so a fixture that varies only `ground`
// would assert nothing.
const verdantRoster = createFloraRoster(
  createLivingWorldBiome(BIOMES.find((entry) => entry.id === "verdant")),
  0x1e,
);
const ashenRoster = createFloraRoster(
  createLivingWorldBiome(BIOMES.find((entry) => entry.id === "ashen")),
  0x1e,
);
assert.notDeepEqual(floraA, otherSeed, "a different seed should grow a different field");
assert.notDeepEqual(
  verdantRoster.map((recipe) => recipe.palette.primary),
  ashenRoster.map((recipe) => recipe.palette.primary),
  "a different biome should colour its species differently",
);
// Same families, same seed — only the colour moved. That is the contract:
// biome drives palette, seed drives which species and what shape they take.
assert.deepEqual(
  verdantRoster.map((recipe) => recipe.family),
  ashenRoster.map((recipe) => recipe.family),
  "the same seed should draw the same families whatever the biome",
);

const faunaA = createFaunaRoster(biome, 0x1e);
const faunaB = createFaunaRoster(biome, 0x1e);
assert.deepEqual(faunaA, faunaB);
assert.ok(faunaA.length >= 2, "a field should carry more than one kin species");
assert.notEqual(
  faunaA[0].family,
  faunaA[1].family,
  "kin species should be distinct families, not phenotypes of one",
);
assert.notDeepEqual(
  faunaA[0].body,
  faunaA[1].body,
  "distinct families should have visibly different body plans",
);

console.log("living-world-style.test.mjs passed");
