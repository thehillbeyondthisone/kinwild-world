import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FLORA_ARCHETYPES,
  FLORA_DNA_VERSION,
  FLORA_ROLES,
  PALETTE_ROLES,
  normalizeFloraDNA,
} from "../src/generated-flora/dna.js";
import { ARCHETYPE_SHAPE_LIMITS } from "../src/generated-flora/archetypes.js";
import {
  deriveBiomePalette,
  resolveSpeciesColors,
  varyColor,
} from "../src/generated-flora/palette.js";
import {
  createRng,
  hashSeed,
  stableStringify,
} from "../src/generated-flora/rng.js";
import { createTouchEnvelope } from "../src/generated-flora/touch.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const floraSource = path.resolve(here, "../src/generated-flora");

assert.equal(FLORA_DNA_VERSION, 2);
// The tier a plant occupies and the silhouette it wears are separate axes in
// v2. Fusing them is what made every hero a mushroom.
assert.deepEqual(FLORA_ROLES, ["hero", "mid", "ground"]);
assert.deepEqual(FLORA_ARCHETYPES, [
  "canopy",
  "spire",
  "cap",
  "bell",
  "frond",
  "pad",
  "reed",
  "cover",
  "coral",
]);
assert.deepEqual(PALETTE_ROLES, [
  "stem",
  "primary",
  "secondary",
  "accent",
  "highlight",
  "shadow",
]);

const malformed = normalizeFloraDNA({
  role: "MUSHROOM",
  name: `  ${"Crown ".repeat(20)}  `,
  seed: "semantic-seed",
  shape: {
    height: 999,
    stemRadius: "0.3",
    capRadius: -8,
    capDepth: "not-a-number",
    spotCount: 4.6,
    pendantCount: -1,
    // v1 field names are silently dropped: `shape` is keyed per archetype.
    satelliteCount: 3,
  },
  motion: {
    wind: 90,
    touchStrength: 0,
    touchStiffness: 27,
    touchDamping: Infinity,
    maxLean: -4,
  },
  variation: {
    scaleMin: 1.08,
    scaleMax: 0.91,
    lean: 2,
  },
  paletteRoles: {
    structure: "ultraviolet",
    body: "accent",
  },
  ignoredPromptField: "compiler must drop this",
});

assert.equal(malformed.dna.archetype, "cap");
assert.equal(malformed.dna.role, "hero");
assert.equal(malformed.dna.name.length, 64);
assert.equal(malformed.dna.shape.height, 8.5);
assert.equal(malformed.dna.shape.stemRadius, 0.3);
assert.equal(malformed.dna.shape.capRadius, 0.6);
assert.equal(malformed.dna.shape.capDepth, 0.82);
assert.equal(malformed.dna.shape.spotCount, 5);
assert.equal(malformed.dna.shape.pendantCount, 0);
assert.equal("satelliteCount" in malformed.dna.shape, false);
assert.equal(malformed.dna.motion.wind, 2);
assert.equal(malformed.dna.motion.touchStrength, 0.1);
assert.equal(malformed.dna.motion.touchDamping, 7.5);
assert.equal(malformed.dna.motion.maxLean, 0.03);
assert.deepEqual(
  [malformed.dna.variation.scaleMin, malformed.dna.variation.scaleMax],
  [0.91, 1.08]
);
assert.equal(malformed.dna.variation.lean, 0.2);
assert.equal(malformed.dna.paletteRoles.structure, "stem");
assert.equal(malformed.dna.paletteRoles.body, "accent");
assert.equal("ignoredPromptField" in malformed.dna, false);
assert(Object.isFrozen(malformed.dna));
assert(Object.isFrozen(malformed.dna.shape));
assert(malformed.notes.length >= 8);

const defaulted = normalizeFloraDNA("draw me flowers");
assert.equal(defaulted.dna.archetype, "bell");
assert.equal(defaulted.dna.role, "mid");
assert(defaulted.notes.some((note) => note.includes("not an object")));

// The discriminated union is what stops a groundcover asking for a trunk.
const groundcover = normalizeFloraDNA({
  archetype: "cover",
  shape: { patchRadius: 2, height: 40, branchCount: 9 },
});
assert.deepEqual(groundcover.notes, []);
assert.equal("height" in groundcover.dna.shape, false);
assert.equal("branchCount" in groundcover.dna.shape, false);
assert.equal(groundcover.dna.shape.patchRadius, 2);

// Every archetype defaults inside its own limits, so an empty DNA is valid.
for (const archetype of FLORA_ARCHETYPES) {
  const { dna, notes } = normalizeFloraDNA({ archetype });
  assert.deepEqual(notes, [], `${archetype} defaults should need no repair`);
  assert.equal(dna.archetype, archetype);
  const limits = ARCHETYPE_SHAPE_LIMITS[archetype];
  assert.deepEqual(
    Object.keys(dna.shape).sort(),
    Object.keys(limits).sort(),
    `${archetype} shape keys must match its limits exactly`,
  );
  for (const [key, value] of Object.entries(dna.shape)) {
    const [low, high] = limits[key];
    assert.ok(
      value >= low && value <= high,
      `${archetype}.${key} default ${value} is outside [${low}, ${high}]`,
    );
  }
}

// v1 role strings still resolve, so a saved v1 plant keeps compiling.
assert.equal(normalizeFloraDNA({ role: "hero-mushroom" }).dna.archetype, "cap");
assert.equal(normalizeFloraDNA({ role: "hero-mushroom" }).dna.role, "hero");
assert.equal(normalizeFloraDNA({ role: "mid-flower-cluster" }).dna.archetype, "bell");
assert.equal(normalizeFloraDNA({ role: "groundcover" }).dna.archetype, "cover");
assert.equal(normalizeFloraDNA({ role: "groundcover" }).dna.role, "ground");

const sameA = normalizeFloraDNA({
  archetype: "cover",
  name: "Quiet Moss",
  seed: { prompt: "moss", revision: 4 },
}).dna;
const sameB = normalizeFloraDNA({
  seed: { revision: 4, prompt: "moss" },
  name: "Quiet Moss",
  role: "groundcover",
}).dna;
assert.deepEqual(sameA, sameB);

const streamA = createRng("same-seed");
const streamB = createRng("same-seed");
assert.deepEqual(
  Array.from({ length: 12 }, () => streamA.next()),
  Array.from({ length: 12 }, () => streamB.next())
);
const forkBeforeConsumption = createRng("root").fork("petals");
const consumedParent = createRng("root");
for (let i = 0; i < 50; i++) consumedParent.next();
const forkAfterConsumption = consumedParent.fork("petals");
assert.deepEqual(
  Array.from({ length: 8 }, () => forkBeforeConsumption.next()),
  Array.from({ length: 8 }, () => forkAfterConsumption.next())
);
assert.notEqual(hashSeed("plant", 1), hashSeed("plant", 2));
assert.equal(
  stableStringify({ z: 1, a: { y: 2, x: 3 } }),
  stableStringify({ a: { x: 3, y: 2 }, z: 1 })
);

const palette = deriveBiomePalette(
  {
    ground: ["#301f16", "#5d783d", "#a7bb68"],
    accent: "#f58a64",
    sun: "#fff1b0",
    cliff: "#1e2922",
    leafballTreePalette: {
      trunk: "#795038",
      leaves: ["#405b38", "#739752", "#b3c77a"],
    },
  },
  { accent: "#e65d8f" }
);
assert.deepEqual(palette, {
  stem: "#795038",
  primary: "#739752",
  secondary: "#b3c77a",
  accent: "#e65d8f",
  highlight: "#fff1b0",
  shadow: "#1e2922",
});
assert(Object.isFrozen(palette));

const speciesColors = resolveSpeciesColors(sameA, palette);
assert.equal(speciesColors.structure.getHexString(), "795038");
assert.equal(speciesColors.body.getHexString(), "739752");
assert.notEqual(
  varyColor(speciesColors.body, -1).getHex(),
  varyColor(speciesColors.body, 1).getHex()
);

const touchA = createTouchEnvelope({
  strength: 1.2,
  stiffness: 38,
  damping: 7,
  maxValue: 0.6,
  fallbackDirection: { x: 1, z: 0 },
});
const touchB = createTouchEnvelope({
  strength: 1.2,
  stiffness: 38,
  damping: 7,
  maxValue: 0.6,
  fallbackDirection: { x: 1, z: 0 },
});
touchA.trigger(1, [3, 4]);
touchB.trigger(1, [3, 4]);
for (let i = 0; i < 120; i++) {
  assert.deepEqual(touchA.update(1 / 60), touchB.update(1 / 60));
}
assert(Math.abs(touchA.snapshot().direction.x - 0.6) < 1e-12);
assert(Math.abs(touchA.snapshot().direction.z - 0.8) < 1e-12);
assert(Math.abs(touchA.snapshot().value) < 0.001);
assert(Math.abs(touchA.snapshot().velocity) < 0.001);

for (const file of await readdir(floraSource)) {
  if (!file.endsWith(".js")) continue;
  const source = await readFile(path.join(floraSource, file), "utf8");
  assert.doesNotMatch(
    source,
    /Math\s*\.\s*random\s*\(/,
    `${file} must not consume ambient Math.random`
  );
}

console.log("generated flora DNA invariants passed");
