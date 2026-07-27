import assert from "node:assert/strict";
import {
  CURATED_WALKER_DNA,
  normalizeWalkerDNA,
  primitiveCountForLegs,
  seededUnit,
} from "../src/generated-fauna/index.js";

const defaults = normalizeWalkerDNA(undefined);
assert.deepEqual(
  defaults.dna,
  CURATED_WALKER_DNA,
  "unknown input should normalize to the curated walker",
);
assert(defaults.repairs.length > 0);
assert.equal(defaults.primitiveCount, 10);
assert.equal(defaults.genomeHash.length, 8);

const malformed = normalizeWalkerDNA({
  speciesId: "  My WILD !!! Walker  ",
  name: "   ",
  seed: -3.2,
  palette: {
    body: "orange",
    head: "#ABCDEF",
  },
  body: {
    radius: Infinity,
    halfLength: -200,
  },
  head: {
    radius: 200,
    offset: ["bad", 999, null],
    eyeRadius: 2,
  },
  legs: {
    count: 99,
    length: 0.24,
    thickness: 0.13,
  },
  motion: {
    stepDuration: "0.3",
    lift: -1,
  },
  ignoredFutureField: {
    anything: true,
  },
});

assert.equal(malformed.dna.speciesId, "my-wild-walker");
assert.equal(malformed.dna.palette.body, CURATED_WALKER_DNA.palette.body);
assert.equal(malformed.dna.palette.head, "#abcdef");
assert.equal(malformed.dna.legs.count, 6);
assert.equal(malformed.primitiveCount, primitiveCountForLegs(6));
assert(
  malformed.dna.legs.thickness <= malformed.dna.legs.length * 0.24,
  "relational limb budget should be enforced",
);
assert(
  malformed.dna.head.eyeRadius <= malformed.dna.head.radius * 0.34,
  "eyes should be constrained by head radius",
);
assert(Object.isFrozen(malformed.dna));
assert(Object.isFrozen(malformed.dna.palette));
assert(malformed.repairs.length >= 6);

const constrained = normalizeWalkerDNA(
  {
    ...CURATED_WALKER_DNA,
    legs: {
      ...CURATED_WALKER_DNA.legs,
      count: 6,
    },
  },
  {
    maxPrimitives: 10,
    maxInfluences: 6,
  },
);
assert.equal(constrained.dna.legs.count, 4);
assert.equal(constrained.primitiveCount, 10);

assert.throws(
  () =>
    normalizeWalkerDNA(CURATED_WALKER_DNA, {
      maxPrimitives: 5,
      maxInfluences: 3,
    }),
  /budget must allow/,
);

assert.equal(
  normalizeWalkerDNA(malformed.dna).genomeHash,
  malformed.genomeHash,
  "canonical genomes should hash identically",
);
assert.equal(seededUnit(42, "blink"), seededUnit(42, "blink"));
assert.notEqual(seededUnit(42, "blink"), seededUnit(42, "gait"));

console.log("generated fauna normalization tests passed");
