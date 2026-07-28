import assert from "node:assert/strict";

globalThis.__APP_VERSION__ = "test";

const { FLORA_FAMILIES, FAUNA_FAMILIES, createFaunaRoster, createFloraRoster, speciesName } =
  await import("../src/living-world/roster.js");
const { createLivingWorldBiome } = await import("../src/living-world/style.js");
const { normalizeFloraDNA } = await import("../src/generated-flora/dna.js");
const { BIOMES } = await import("../src/biomes.js");

const biomes = BIOMES.map((biome) => createLivingWorldBiome(biome));
const SEEDS = [0x0000, 0x0007, 0x0012, 0x1e, 0x4a9b, 0xbeef, 0xffff];

// The families are the finite thing the Field Guide counts, and the taxonomy
// rail has eight slots.
assert.equal(FLORA_FAMILIES.length, 8, "eight flora families fill the taxonomy rail");
assert.equal(
  new Set(FLORA_FAMILIES.map((family) => family.key)).size,
  FLORA_FAMILIES.length,
  "family keys must be unique — they are catalog keys",
);
for (const role of ["hero", "mid", "ground"]) {
  assert.ok(
    FLORA_FAMILIES.filter((family) => family.role === role).length >= 2,
    `${role} needs at least two families for a roster to have a choice`,
  );
}

for (const biome of biomes) {
  for (const seed of SEEDS) {
    const roster = createFloraRoster(biome, seed);
    const label = `${biome.id}/0x${seed.toString(16)}`;

    assert.ok(roster.length >= 5, `${label}: a field should grow a community`);
    assert.equal(
      new Set(roster.map((recipe) => recipe.family)).size,
      roster.length,
      `${label}: no family should be drawn twice`,
    );
    for (const role of ["hero", "mid", "ground"]) {
      assert.ok(
        roster.some((recipe) => recipe.role === role),
        `${label}: the ${role} role must be filled`,
      );
    }

    for (const recipe of roster) {
      // The catalog and the taxonomy medallions key on `variant`. If it ever
      // drifts per seed, the Field Guide grows without bound.
      assert.equal(recipe.variant, recipe.family, `${label}: variant must be the family key`);
      assert.match(recipe.label, /^[A-Z][a-z]+$/, `${label}: ${recipe.label} should be a name`);

      // The generator must land inside the compiler's limits by construction.
      // A roll that needs repairing is a generator bug, not robustness — the
      // repair path exists for AI-authored DNA, not for our own.
      const { dna, notes } = normalizeFloraDNA(recipe.dna);
      assert.deepEqual(
        notes,
        [],
        `${label}: ${recipe.family} needed repairs: ${notes.join("; ")}`,
      );
      assert.equal(dna.role, recipe.dna.role, `${label}: role should survive normalization`);
      for (const value of Object.values(dna.shape)) {
        assert.ok(Number.isFinite(value), `${label}: ${recipe.family} shape carried a non-number`);
      }
      for (const hex of Object.values(recipe.palette)) {
        assert.match(hex, /^#[0-9a-f]{6}$/i, `${label}: palette entry ${hex} is not a colour`);
      }
    }
  }
}

// Determinism, and the two axes moving independently.
const verdant = biomes.find((biome) => biome.id === "verdant");
const ashen = biomes.find((biome) => biome.id === "ashen");
assert.deepEqual(
  createFloraRoster(verdant, 0x1e),
  createFloraRoster(verdant, 0x1e),
  "the same field must draw the same roster every time",
);
assert.deepEqual(
  createFloraRoster(verdant, 0x1e).map((recipe) => recipe.family),
  createFloraRoster(ashen, 0x1e).map((recipe) => recipe.family),
  "the seed picks the families; the biome only colours them",
);
assert.notDeepEqual(
  createFloraRoster(verdant, 0x1e).map((recipe) => recipe.family),
  createFloraRoster(verdant, 0x4a9b).map((recipe) => recipe.family),
  "a different seed should draw a different community",
);

// Shape actually varies — the whole point is that the compiler's ranges stop
// going unused.
const heroHeights = new Set(
  SEEDS.map((seed) => {
    const hero = createFloraRoster(verdant, seed).find((recipe) => recipe.role === "hero");
    return Math.round(hero.dna.shape.height * 100);
  }),
);
assert.ok(heroHeights.size > 1, "hero height should vary between fields, not sit on one constant");

// Fauna.
assert.equal(
  new Set(FAUNA_FAMILIES.map((family) => family.key)).size,
  FAUNA_FAMILIES.length,
  "kin family keys must be unique",
);
for (const biome of biomes.slice(0, 4)) {
  for (const seed of SEEDS) {
    const roster = createFaunaRoster(biome, seed);
    assert.ok(roster.length >= 2, "a field should carry more than one kin species");
    assert.equal(
      new Set(roster.map((species) => species.family)).size,
      roster.length,
      "kin families should not repeat within a field",
    );
    for (const species of roster) {
      assert.ok(species.body.radius > 0 && species.legs.length > 0);
      assert.ok(
        [4, 6].includes(species.legs.count),
        "kin leg counts stay inside the walker rig's supported set",
      );
      assert.match(species.palette.body, /^#[0-9a-f]{6}$/i);
    }
  }
}

// Names are stable per (family, seed) and readable.
assert.equal(speciesName(FLORA_FAMILIES[0], 0x1e), speciesName(FLORA_FAMILIES[0], 0x1e));
assert.notEqual(speciesName(FLORA_FAMILIES[0], 0x1e), speciesName(FLORA_FAMILIES[0], 0x4a9b));

console.log("living-world-roster.test.mjs passed");
