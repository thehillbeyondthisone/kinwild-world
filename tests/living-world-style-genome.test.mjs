import assert from "node:assert/strict";
import * as THREE from "three";

globalThis.__APP_VERSION__ = "test";

const { STYLE_BANDS, deriveStyleGenome, moodFor } = await import(
  "../src/living-world/style-genome.js"
);
const { BIOMES } = await import("../src/biomes.js");
const { createLivingWorldBiome, LIVING_WORLD_GENERATOR_VERSION } = await import(
  "../src/living-world/style.js"
);

const hsl = { h: 0, s: 0, l: 0 };
function readHsl(hex) {
  // Named colour space on both ends: THREE's getHSL defaults to LinearSRGB
  // while setHSL defaults to SRGB, and an unnamed round-trip silently
  // brightens every value.
  new THREE.Color(hex).getHSL(hsl, THREE.SRGBColorSpace);
  return { ...hsl };
}

function assertInBand(hex, band, label) {
  const { s, l } = readHsl(hex);
  // Rounding to 8-bit hex moves s/l slightly, so the bands get a small epsilon.
  assert.ok(
    s >= band.s[0] - 0.03 && s <= band.s[1] + 0.03,
    `${label} saturation ${s.toFixed(3)} outside ${JSON.stringify(band.s)}`,
  );
  assert.ok(
    l >= band.l[0] - 0.03 && l <= band.l[1] + 0.03,
    `${label} lightness ${l.toFixed(3)} outside ${JSON.stringify(band.l)}`,
  );
}

const HEX = /^#[0-9a-f]{6}$/;
const genomes = new Map();

for (const biome of BIOMES) {
  const genome = deriveStyleGenome(biome);
  genomes.set(biome.id, genome);

  // Every colour is a real colour. A NaN in an HSL round-trip renders as
  // black, which reads as an art decision rather than a bug.
  for (const [label, value] of [
    ["terrainDeep", genome.terrain[0]],
    ["terrainMid", genome.terrain[1]],
    ["terrainLift", genome.terrain[2]],
    ["cliff", genome.cliff],
    ["underside", genome.underside],
    ["sky", genome.sky],
    ["fog", genome.fog],
    ["accent", genome.accent],
    ["sun", genome.sun],
  ]) {
    assert.match(value, HEX, `${biome.id}.${label} should be a hex colour`);
  }

  // The art lock: the biome chooses hue, kinwild chooses the range.
  assertInBand(genome.terrain[0], STYLE_BANDS.terrainDeep, `${biome.id} terrainDeep`);
  assertInBand(genome.terrain[1], STYLE_BANDS.terrainMid, `${biome.id} terrainMid`);
  assertInBand(genome.terrain[2], STYLE_BANDS.terrainLift, `${biome.id} terrainLift`);
  assertInBand(genome.sky, STYLE_BANDS.sky, `${biome.id} sky`);
  assertInBand(genome.accent, STYLE_BANDS.accent, `${biome.id} accent`);
  assertInBand(genome.sun, STYLE_BANDS.sun, `${biome.id} sun`);

  // Terrain must stay darker than sky, or hull ink stops reading against it.
  assert.ok(
    readHsl(genome.terrain[2]).l < readHsl(genome.sky).l,
    `${biome.id}: terrain should stay darker than sky`,
  );

  assert.ok(
    genome.fogDensity >= 0.016 && genome.fogDensity <= 0.028,
    `${biome.id} fogDensity ${genome.fogDensity} outside the kinwild band`,
  );
  assert.ok(
    genome.terrainAmplitude >= 1.1 && genome.terrainAmplitude <= 1.9,
    `${biome.id} terrainAmplitude ${genome.terrainAmplitude} outside the kinwild band`,
  );

  // Dusk and night are the same field under lower light, not a second scheme.
  assert.ok(
    readHsl(genome.night.sky).l < readHsl(genome.dusk.sky).l,
    `${biome.id}: night should be darker than dusk`,
  );
  assert.ok(
    readHsl(genome.dusk.sky).l < readHsl(genome.sky).l,
    `${biome.id}: dusk should be darker than day`,
  );

  assert.equal(typeof genome.mood, "string");
  assert.ok(genome.mood.endsWith("everything here shares a pulse."), "kinwild keeps its sentence");
}

// Deterministic, and actually different per biome — the whole point is that
// the biome roll stops being invisible.
for (const biome of BIOMES) {
  assert.deepEqual(
    deriveStyleGenome(biome),
    genomes.get(biome.id),
    `${biome.id} should derive identically every time`,
  );
}
const fingerprints = new Set(
  [...genomes.values()].map((genome) => `${genome.terrain.join("")}${genome.sky}${genome.accent}`),
);
assert.equal(
  fingerprints.size,
  BIOMES.length,
  "every biome should produce a visibly distinct field",
);

// Degenerate input must not throw — a malformed biome should still render.
for (const bad of [undefined, null, {}, { ground: [] }, { ground: ["nonsense"] }]) {
  const genome = deriveStyleGenome(bad);
  assert.match(genome.terrain[0], HEX);
  assert.match(genome.sky, HEX);
}

assert.equal(moodFor({ h: 0.05, s: 1, l: 0.6 }, { h: 0, s: 0, l: 0.34 }).startsWith("warm open"), true);
assert.equal(moodFor({ h: 0.55, s: 1, l: 0.6 }, { h: 0, s: 0, l: 0.2 }).startsWith("cool deep"), true);

// The biome carries the genome through to the runtime, keeps its own ID for
// URL/catalog compatibility, and still suppresses every donor visual.
const source = BIOMES.find((biome) => biome.id === "verdant");
const kinwild = createLivingWorldBiome(source);
assert.equal(kinwild.id, "verdant", "the source ID must survive for URL compatibility");
assert.equal(kinwild.name, "kinwild", "the donor name must not leak");
assert.deepEqual(kinwild.ground, [...genomes.get("verdant").terrain]);
assert.equal(kinwild.dusk.sky, genomes.get("verdant").dusk.sky, "dusk must be derived, not fixed");
assert.equal(kinwild.night.sky, genomes.get("verdant").night.sky, "night must be derived, not fixed");
assert.equal(kinwild.generatorVersion, LIVING_WORLD_GENERATOR_VERSION);
assert.equal(kinwild.sourceStyle, source, "the source stays reachable for roster derivation");
assert.equal(kinwild.flora.length, 0, "donor flora stays suppressed");
assert.deepEqual(kinwild.creatureCount, [0, 0], "donor fauna stays suppressed");
assert.equal(source.ground[0], "#3a5a40", "the source biome must remain untouched");

console.log("living-world-style-genome.test.mjs passed");
