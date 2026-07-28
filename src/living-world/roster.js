/**
 * Species rosters.
 *
 * The first cut shipped three frozen recipes — Veilcrown, Pulsebells,
 * Threadgrass — with literal shape numbers and a palette pinned to constants.
 * Only the inner `seed` varied, which drove per-instance jitter and nothing
 * else, so every world in every biome grew the same three plants in the same
 * colours. Meanwhile the flora compiler clamps to ranges nothing exercised:
 * hero height 2.2-8.5 against a fixed 3.75, groundcover blades 12-320 against
 * a fixed 72.
 *
 * This module is the generator that was missing. It writes varied DNA into the
 * existing compiler; it does not add a renderer or a role.
 *
 * Three layers of identity, deliberately separated:
 *
 * - **Family** is stable and finite. It owns the catalog key and the taxonomy
 *   medallion, so the Field Guide stays a completable checklist rather than
 *   growing without bound as seeds are explored.
 * - **Specimen** varies per world. Shape, motion and name are rolled inside
 *   the family's character, so a Veilcrown in one field is recognisably the
 *   same kind of thing as a Veilcrown in another, without being identical.
 * - **Colour** comes from the field's style genome — species follow the biome
 *   they grow in, taking its warm end rather than its terrain.
 *
 * DOM-free and free of `Math.random`.
 */
import * as THREE from "three";
import { mulberry32 } from "../seed.js";
import { createRng, hashSeed } from "../generated-flora/rng.js";
import { deriveBiomePalette } from "../generated-flora/palette.js";

/**
 * The eight families. Fixed set, stable keys — this is what the Field Guide
 * and the eight taxonomy slots are counting.
 *
 * `character` biases the roll inside the role's limits so families stay
 * recognisably distinct: a Lanterncap is always the tall thin one, a Veilcrown
 * always the broad one, however the dice land.
 */
export const FLORA_FAMILIES = Object.freeze([
  Object.freeze({
    key: "veilcrown",
    role: "hero",
    dnaRole: "hero-mushroom",
    stems: ["Veil", "Shroud", "Canopy", "Mantle"],
    character: { height: [3.1, 4.6], cap: [1.7, 2.6], stem: [0.4, 0.62], spots: [10, 22] },
  }),
  Object.freeze({
    key: "lanterncap",
    role: "hero",
    dnaRole: "hero-mushroom",
    stems: ["Lantern", "Beacon", "Tower", "Spire"],
    character: { height: [4.8, 7.2], cap: [0.95, 1.6], stem: [0.26, 0.42], spots: [0, 9] },
  }),
  Object.freeze({
    key: "pulsebell",
    role: "mid",
    dnaRole: "mid-flower-cluster",
    stems: ["Pulse", "Chime", "Peal", "Toll"],
    character: { cluster: [0.62, 0.95], flowers: [4, 7], stem: [1.0, 1.5], bloom: [0.26, 0.38] },
  }),
  Object.freeze({
    key: "emberwort",
    role: "mid",
    dnaRole: "mid-flower-cluster",
    stems: ["Ember", "Cinder", "Kindle", "Smoulder"],
    character: { cluster: [0.9, 1.5], flowers: [8, 14], stem: [0.6, 1.0], bloom: [0.12, 0.22] },
  }),
  Object.freeze({
    key: "glasswort",
    role: "mid",
    dnaRole: "mid-flower-cluster",
    stems: ["Glass", "Prism", "Facet", "Clear"],
    character: { cluster: [0.45, 0.7], flowers: [3, 5], stem: [1.6, 2.4], bloom: [0.3, 0.44] },
  }),
  Object.freeze({
    key: "threadgrass",
    role: "ground",
    dnaRole: "groundcover",
    stems: ["Thread", "Filament", "Strand", "Sedge"],
    character: { patch: [1.4, 2.1], count: [60, 120], blade: [0.55, 0.85], width: [0.05, 0.08] },
  }),
  Object.freeze({
    key: "mossvelvet",
    role: "ground",
    dnaRole: "groundcover",
    stems: ["Velvet", "Nap", "Down", "Plush"],
    character: { patch: [2.2, 3.6], count: [150, 280], blade: [0.14, 0.3], width: [0.09, 0.16] },
  }),
  Object.freeze({
    key: "tidefern",
    role: "ground",
    dnaRole: "groundcover",
    stems: ["Tide", "Frond", "Curl", "Wisp"],
    character: { patch: [0.9, 1.6], count: [22, 55], blade: [0.85, 1.1], width: [0.14, 0.26] },
  }),
]);

/** How many families of each role a single field draws. */
const ROLE_DRAW = Object.freeze({ hero: 1, mid: 2, ground: 2 });

const SPECIES_SUFFIXES = Object.freeze([
  "cap", "bell", "wort", "frond", "bloom", "crown", "veil", "spire",
  "tuft", "shade", "drift", "weave", "plume", "coil",
]);

/** Kinling body plans. The three original silhouettes are the floor. */
export const FAUNA_FAMILIES = Object.freeze([
  Object.freeze({
    key: "kinling",
    stems: ["Kin", "Wren", "Pip", "Tuft"],
    body: { radius: [0.31, 0.38], halfLength: [0.26, 0.34] },
    legs: { count: 4, length: [0.48, 0.6], thickness: [0.066, 0.08] },
  }),
  Object.freeze({
    key: "boulderkin",
    stems: ["Boulder", "Cobble", "Lumb", "Mound"],
    body: { radius: [0.38, 0.46], halfLength: [0.2, 0.27] },
    legs: { count: 4, length: [0.4, 0.5], thickness: [0.078, 0.095] },
  }),
  Object.freeze({
    key: "stiltkin",
    stems: ["Stilt", "Reed", "Lank", "Stride"],
    body: { radius: [0.26, 0.33], halfLength: [0.24, 0.32] },
    legs: { count: 6, length: [0.58, 0.72], thickness: [0.052, 0.068] },
  }),
]);

function rangeInt(rng, [low, high]) {
  return rng.int(low, high);
}

/**
 * A species name in the field-guide register, built the same way island names
 * are (`src/islandname.js`): its own `mulberry32` stream, never the shared
 * `Math.random`, so it is safe to call inside or outside the seeded window.
 */
export function speciesName(family, seed) {
  const rng = mulberry32(hashSeed("kinwild/species-name", family.key, seed));
  const stem = family.stems[Math.floor(rng() * family.stems.length)];
  const suffix = SPECIES_SUFFIXES[Math.floor(rng() * SPECIES_SUFFIXES.length)];
  return `${stem}${suffix}`;
}

function hexOf(color) {
  return `#${color.getHexString()}`;
}

/**
 * Rotate a hue deliberately, holding saturation and lightness in place.
 *
 * `varyColor` nudges hue by a fraction of a percent — right for per-instance
 * variation, far too subtle to tell two species apart.
 */
function rotate(hex, turns, saturationScale = 1, lightnessShift = 0) {
  const hsl = { h: 0, s: 0, l: 0 };
  // Named on both ends: THREE's getHSL defaults to LinearSRGB and setHSL to
  // SRGB, and an unnamed round-trip silently brightens.
  new THREE.Color(hex).getHSL(hsl, THREE.SRGBColorSpace);
  return hexOf(
    new THREE.Color().setHSL(
      (hsl.h + turns + 1) % 1,
      Math.min(0.95, Math.max(0, hsl.s * saturationScale)),
      Math.min(0.95, Math.max(0.05, hsl.l + lightnessShift)),
      THREE.SRGBColorSpace,
    ),
  );
}

/**
 * Species colour.
 *
 * Built from the field's *warm* end — accent and sun — not from its terrain.
 * `deriveBiomePalette` maps a plant's primary onto the donor's ground and leaf
 * colours, which is right for Small World's own flora and wrong here: run
 * through kinwild it grew green mushrooms on green ground, and the whole art
 * lock is warm living forms reading against dark mineral terrain. Terrain
 * colour is kept for the parts that touch the ground — stem and shadow.
 *
 * Each species then rotates the hue a little further round, so two plants
 * sharing a role never read as the same plant twice.
 */
function paletteFor(biome, rng, index, role) {
  const genome = biome?.styleGenome;
  const fallback = deriveBiomePalette(biome);
  const warm = genome?.accent ?? fallback.accent;
  const light = genome?.sun ?? fallback.highlight;
  const ground = genome?.terrain?.[2] ?? fallback.stem;
  const deep = genome?.cliff ?? fallback.shadow;

  // A tenth of a turn is the widest a species may stray from the field's
  // accent: enough to read as a different plant, small enough to stay in the
  // same family of light. A wider spread walked an orange accent round into
  // yellow-green, which put the flora back into the terrain's hue.
  const spread = rng.range(0.03, 0.09) * (index % 2 === 0 ? 1 : -1);
  const primary = rotate(warm, spread, 1, role === "ground" ? -0.08 : 0);

  return Object.freeze({
    // Stems belong to the ground they grow out of.
    stem: rotate(ground, spread * 0.3, 0.8, -0.06),
    primary,
    secondary: rotate(primary, spread * 1.6, 0.92, 0.06),
    accent: rotate(warm, -spread * 0.8, 1, 0.05),
    highlight: light,
    shadow: deep,
  });
}

function heroShape(rng, character) {
  const capRadius = rng.range(...character.cap);
  return {
    height: rng.range(...character.height),
    stemRadius: rng.range(...character.stem),
    capRadius,
    capDepth: capRadius * rng.range(0.3, 0.44),
    spotCount: rangeInt(rng, character.spots),
    satelliteCount: rangeInt(rng, [0, 4]),
  };
}

function flowerShape(rng, character) {
  return {
    clusterRadius: rng.range(...character.cluster),
    flowerCount: rangeInt(rng, character.flowers),
    stemHeight: rng.range(...character.stem),
    bloomRadius: rng.range(...character.bloom),
    petalCount: rangeInt(rng, [4, 8]),
    leafPairs: rangeInt(rng, [0, 3]),
  };
}

function groundShape(rng, character) {
  return {
    patchRadius: rng.range(...character.patch),
    count: rangeInt(rng, character.count),
    bladeHeight: rng.range(...character.blade),
    bladeWidth: rng.range(...character.width),
    clumpiness: rng.range(0.35, 0.95),
    heightVariance: rng.range(0.2, 0.62),
  };
}

function motionFor(rng, role) {
  // Groundcover whips, heroes barely move. Kept inside MOTION_LIMITS so the
  // normalizer never has to repair a roll — a roster that needs repairing is a
  // generator bug, not robustness.
  const wind = role === "ground" ? rng.range(0.95, 1.5) : role === "mid" ? rng.range(0.6, 1.1) : rng.range(0.14, 0.36);
  return {
    wind,
    touchStrength: rng.range(1.0, 1.35),
    touchStiffness: rng.range(24, 52),
    touchDamping: rng.range(5.5, 9),
    maxLean: role === "hero" ? rng.range(0.09, 0.17) : rng.range(0.14, 0.33),
  };
}

/**
 * Draw one world's flora roster.
 *
 * @param {object} biome the kinwild biome (post style genome)
 * @param {number} seed world seed
 * @returns {ReadonlyArray<object>} recipes in the shape populateLivingFlora expects
 */
export function createFloraRoster(biome, seed) {
  const recipes = [];
  for (const role of ["hero", "mid", "ground"]) {
    const pool = FLORA_FAMILIES.filter((family) => family.role === role);
    // Namespaced stream per role: adding a mid variant must not move which
    // hero or groundcover the field grows.
    const chooser = createRng(hashSeed("kinwild/roster", role, seed));
    const chosen = [];
    const remaining = [...pool];
    const draws = Math.min(ROLE_DRAW[role], remaining.length);
    for (let index = 0; index < draws; index++) {
      const take = Math.min(remaining.length - 1, Math.floor(chooser.next() * remaining.length));
      chosen.push(remaining.splice(take, 1)[0]);
    }

    chosen.forEach((family, index) => {
      const rng = createRng(hashSeed("kinwild/species", family.key, seed));
      const name = speciesName(family, seed);
      const shape =
        role === "hero"
          ? heroShape(rng, family.character)
          : role === "mid"
            ? flowerShape(rng, family.character)
            : groundShape(rng, family.character);
      recipes.push(
        Object.freeze({
          key: family.key,
          // The catalog and taxonomy key on `variant`, so it stays the stable
          // family — the specimen inside it is what varies per world.
          variant: family.key,
          family: family.key,
          label: name,
          role,
          dna: Object.freeze({
            role: family.dnaRole,
            name,
            seed: hashSeed("kinwild/flora", family.key, seed),
            shape: Object.freeze(shape),
            motion: Object.freeze(motionFor(rng, role)),
            variation: Object.freeze({
              scaleMin: rng.range(0.82, 0.95),
              scaleMax: rng.range(1.05, 1.25),
              lean: rng.range(0.02, 0.14),
            }),
          }),
          palette: paletteFor(biome, rng, index, role),
        }),
      );
    });
  }
  return Object.freeze(recipes);
}

/**
 * Draw one world's fauna roster: two kin families per field, each a distinct
 * body plan rather than three phenotypes of one species.
 */
export function createFaunaRoster(biome, seed) {
  const chooser = createRng(hashSeed("kinwild/roster", "fauna", seed));
  const remaining = [...FAUNA_FAMILIES];
  const chosen = [];
  for (let index = 0; index < Math.min(2, remaining.length); index++) {
    const take = Math.min(remaining.length - 1, Math.floor(chooser.next() * remaining.length));
    chosen.push(remaining.splice(take, 1)[0]);
  }

  const fallback = deriveBiomePalette(biome);
  const genome = biome?.styleGenome;
  const warm = genome?.accent ?? fallback.accent;
  const deep = genome?.cliff ?? fallback.shadow;
  return Object.freeze(
    chosen.map((family, index) => {
      const rng = createRng(hashSeed("kinwild/fauna-species", family.key, seed));
      const bodyRadius = rng.range(...family.body.radius);
      // Kin are the warmest thing in the field by design — they read against
      // the terrain, never blend into it.
      const spread = rng.range(0.03, 0.08) * (index === 0 ? 1 : -1);
      return Object.freeze({
        family: family.key,
        name: speciesName(family, seed),
        body: Object.freeze({
          radius: bodyRadius,
          halfLength: rng.range(...family.body.halfLength),
        }),
        head: Object.freeze({
          radius: bodyRadius * rng.range(0.6, 0.74),
          offset: Object.freeze([0, bodyRadius * rng.range(0.48, 0.6), bodyRadius * rng.range(1.05, 1.25)]),
          eyeRadius: bodyRadius * rng.range(0.14, 0.19),
        }),
        legs: Object.freeze({
          count: family.legs.count,
          length: rng.range(...family.legs.length),
          thickness: rng.range(...family.legs.thickness),
          stance: rng.range(0.19, 0.27),
          spread: rng.range(0.25, 0.32),
        }),
        motion: Object.freeze({
          stepDuration: rng.range(0.24, 0.34),
          stepTrigger: rng.range(0.11, 0.16),
          lift: rng.range(0.07, 0.11),
          bob: rng.range(0.016, 0.032),
        }),
        palette: Object.freeze({
          body: rotate(warm, spread, 1, 0.02),
          head: rotate(warm, spread * 2.4, 0.9, 0.12),
          limb: rotate(deep, spread * 0.5, 1.1, 0.06),
          eye: "#fff1d2",
          pupil: "#11152a",
        }),
      });
    }),
  );
}
