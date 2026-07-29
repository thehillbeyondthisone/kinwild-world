// The generated controls must cover the schema exactly.
//
// `describeGenome` exists so an editor never hardcodes a field. The failure
// that would make it useless is silent: a schema grows a field, the editor
// keeps rendering the old set, and the new field is uneditable with nothing
// to signal it. So the assertion here is coverage — every key in every
// limits table produces exactly one control, with the table's own bounds —
// checked across all nine archetypes and both locomotions.

import assert from "node:assert/strict";
import {
  ARCHETYPE_SHAPE_DEFAULTS,
  ARCHETYPE_SHAPE_LIMITS,
} from "../src/generated-flora/archetypes.js";
import {
  FLORA_ARCHETYPES,
  MOTION_LIMITS,
  VARIATION_LIMITS,
  normalizeFloraDNA,
} from "../src/generated-flora/dna.js";
import {
  CURATED_WALKER_DNA,
  WALKER_CLAMPS,
  WALKER_WING_CLAMPS,
  normalizeWalkerDNA,
} from "../src/generated-fauna/dna.js";
import {
  describeGenome,
  genomeKind,
  numericFields,
  readGenomePath,
} from "../src/ui/genome-schema.js";

const CONTROLS = new Set(["slider", "stepper", "swatch", "choice", "text"]);

function fieldsByPath(description) {
  const map = new Map();
  for (const section of description.sections) {
    for (const field of section.fields) {
      assert(!map.has(field.path), `duplicate control for ${field.path}`);
      map.set(field.path, field);
    }
  }
  return map;
}

/** Every control is well-formed, whatever schema it came from. */
function assertWellFormed(description, context) {
  for (const [path, field] of fieldsByPath(description)) {
    assert(CONTROLS.has(field.control), `${context} ${path}: unknown control "${field.control}"`);
    assert(field.label && typeof field.label === "string", `${context} ${path}: missing label`);
    if (field.control === "slider" || field.control === "stepper") {
      assert(Number.isFinite(field.lo), `${context} ${path}: missing lo`);
      assert(Number.isFinite(field.hi), `${context} ${path}: missing hi`);
      assert(field.hi >= field.lo, `${context} ${path}: inverted range`);
      assert(field.step > 0, `${context} ${path}: step must be positive`);
      assert(
        Number.isFinite(field.value),
        `${context} ${path}: a normalized genome should carry a finite value`,
      );
      assert(
        field.value >= field.lo && field.value <= field.hi,
        `${context} ${path}: normalized value ${field.value} outside its own control range`,
      );
    }
    if (field.control === "choice") {
      assert(Array.isArray(field.options) && field.options.length > 0, `${context} ${path}: no options`);
      assert(
        field.options.includes(field.value),
        `${context} ${path}: value "${field.value}" is not among its options`,
      );
    }
  }
}

/** One control per key in a limits table, carrying that table's bounds. */
function assertBlockCoverage(map, blockPath, limits, context) {
  for (const key of Object.keys(limits)) {
    const path = `${blockPath}.${key}`;
    const field = map.get(path);
    assert(field, `${context}: no control for ${path}`);
    const [lo, hi, integer = false] = limits[key];
    assert.equal(field.lo, lo, `${context} ${path}: lo should match the limits table`);
    assert.equal(field.hi, hi, `${context} ${path}: hi should match the limits table`);
    assert.equal(field.integer, integer, `${context} ${path}: integer flag should match`);
  }
}

// --- flora: all nine archetypes ---------------------------------------

assert.equal(FLORA_ARCHETYPES.length, 9, "expected nine archetypes");

for (const archetype of FLORA_ARCHETYPES) {
  const { dna } = normalizeFloraDNA({ archetype });
  assert.equal(genomeKind(dna), "flora");

  const description = describeGenome(dna);
  assert.equal(description.kind, "flora");
  assertWellFormed(description, archetype);

  const map = fieldsByPath(description);
  assertBlockCoverage(map, "shape", ARCHETYPE_SHAPE_LIMITS[archetype], archetype);
  assertBlockCoverage(map, "motion", MOTION_LIMITS, archetype);
  assertBlockCoverage(map, "variation", VARIATION_LIMITS, archetype);

  // Exactly one control per shape key — no extras from another archetype.
  const shapeControls = [...map.keys()].filter((path) => path.startsWith("shape."));
  assert.equal(
    shapeControls.length,
    Object.keys(ARCHETYPE_SHAPE_DEFAULTS[archetype]).length,
    `${archetype}: shape controls should match the archetype's own field set`,
  );

  // The discriminated union is the point: a groundcover has no trunk.
  for (const path of shapeControls) {
    const key = path.slice("shape.".length);
    assert(
      key in ARCHETYPE_SHAPE_DEFAULTS[archetype],
      `${archetype}: offered "${key}", which this archetype does not have`,
    );
  }

  assert(map.has("archetype"), `${archetype}: archetype itself should be selectable`);
  assert(map.has("role"), `${archetype}: role should be selectable`);
}

// A spire has no cap radius and a groundcover has no trunk — the clearest
// statement that shape is keyed per archetype.
const spire = fieldsByPath(describeGenome(normalizeFloraDNA({ archetype: "spire" }).dna));
const cover = fieldsByPath(describeGenome(normalizeFloraDNA({ archetype: "cover" }).dna));
assert(!spire.has("shape.capRadius"), "a spire should not offer a cap radius");
assert(spire.has("shape.budRadius"), "a spire should offer a bud radius");
assert(!cover.has("shape.stemRadius"), "a groundcover should not offer a stem radius");
assert(cover.has("shape.bladeHeight"), "a groundcover should offer a blade height");

// --- fauna: both locomotions ------------------------------------------

for (const locomotion of ["walker", "flier"]) {
  const { dna } = normalizeWalkerDNA({ ...CURATED_WALKER_DNA, locomotion, legs: { count: 2 } });
  assert.equal(genomeKind(dna), "fauna");

  const description = describeGenome(dna);
  assert.equal(description.kind, "fauna");
  assertWellFormed(description, locomotion);

  const map = fieldsByPath(description);
  for (const block of ["body", "head", "legs", "motion"]) {
    assertBlockCoverage(map, block, WALKER_CLAMPS[block], locomotion);
  }

  // head.offset is a vec3, so it becomes three controls rather than one.
  for (const index of [0, 1, 2]) {
    assert(map.has(`head.offset.${index}`), `${locomotion}: missing head.offset.${index}`);
  }

  assert(map.has("legs.count"), `${locomotion}: leg count should be selectable`);
  assert.deepEqual(
    map.get("legs.count").options,
    locomotion === "flier" ? [2, 4] : [2, 4, 6],
    `${locomotion}: leg count options should respect the influence budget`,
  );

  if (locomotion === "flier") {
    assertBlockCoverage(map, "wings", WALKER_WING_CLAMPS, locomotion);
  } else {
    assert(
      ![...map.keys()].some((path) => path.startsWith("wings.")),
      "a walker should not offer wing controls",
    );
  }

  // Relational ceilings must reach the controls that need them.
  assert.equal(map.get("legs.thickness").boundBy?.path, "legs.length");
  assert.equal(map.get("head.eyeRadius").boundBy?.path, "head.radius");
  if (locomotion === "flier") {
    assert.equal(map.get("wings.span").boundBy?.path, "body.radius");
    assert.equal(map.get("wings.chord").boundBy?.path, "wings.span");
  }
}

// --- shared helpers ----------------------------------------------------

const walker = normalizeWalkerDNA(CURATED_WALKER_DNA).dna;
assert.equal(readGenomePath(walker, "legs.thickness"), walker.legs.thickness);
assert.equal(readGenomePath(walker, "head.offset.1"), walker.head.offset[1]);
assert.equal(readGenomePath(walker, "nope.missing"), undefined);

// Every numeric field must be readable at its own path — this is the contract
// the mutation operator relies on to write a field back.
for (const field of numericFields(walker)) {
  assert.equal(
    readGenomePath(walker, field.path),
    field.value,
    `${field.path}: described value should match the genome`,
  );
}
assert(numericFields(walker).length > 12, "a walker should expose a real set of numeric fields");

assert.throws(() => describeGenome({}), /not a recognised genome/);
assert.throws(() => describeGenome(null), /not a recognised genome/);

console.log("genome schema tests passed");
