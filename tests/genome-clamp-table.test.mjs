// The walker clamp tables must BE the enforced bounds, not a copy of them.
//
// These numbers were inline arguments to `clamped(...)`. Now that a genome
// editor and a mutation operator will read them to size their controls and
// their drift, a table that merely resembles what the normalizer does is
// worse than no table: the editor would offer a range the normalizer then
// silently takes back. Every assertion here is written against the
// normalizer's observable behaviour, so it fails if the two ever part ways.

import assert from "node:assert/strict";
import {
  CURATED_WALKER_DNA,
  WALKER_CLAMPS,
  WALKER_HEAD_OFFSET_CLAMPS,
  WALKER_RELATIONS,
  WALKER_WING_CLAMPS,
  normalizeWalkerDNA,
} from "../src/generated-fauna/index.js";

const readPath = (target, path) =>
  path.split(".").reduce((cursor, key) => cursor[key], target);

/** A genome that sets one field, leaving everything else curated. */
function withField(path, value, extra = {}) {
  const keys = path.split(".");
  const last = keys.pop();
  const raw = structuredClone({ ...CURATED_WALKER_DNA, ...extra });
  let cursor = raw;
  for (const key of keys) cursor = cursor[key];
  cursor[last] = value;
  return raw;
}

// Fields whose value the relational rules pull below its own scalar ceiling.
// `legs.thickness` tops out at 0.13 alone but at length*0.24 in context, so a
// naive "hi clamps to hi" check would fail for the right reason.
const RELATED = new Set(WALKER_RELATIONS.map((relation) => relation.field));

// --- scalar bounds -----------------------------------------------------

for (const group of Object.keys(WALKER_CLAMPS)) {
  for (const field of Object.keys(WALKER_CLAMPS[group])) {
    const path = `${group}.${field}`;
    const [lo, hi] = WALKER_CLAMPS[path.split(".")[0]][field];

    const under = normalizeWalkerDNA(withField(path, lo - 1));
    assert.equal(readPath(under.dna, path), lo, `${path}: below lo should clamp to lo`);
    assert(
      under.repairs.includes(`${path}: clamped to ${lo}`),
      `${path}: clamping below lo should be reported`,
    );

    if (!RELATED.has(path)) {
      const over = normalizeWalkerDNA(withField(path, hi + 1));
      assert.equal(readPath(over.dna, path), hi, `${path}: above hi should clamp to hi`);
      assert(
        over.repairs.includes(`${path}: clamped to ${hi}`),
        `${path}: clamping above hi should be reported`,
      );

      const at = normalizeWalkerDNA(withField(path, hi));
      assert.equal(readPath(at.dna, path), hi, `${path}: hi is a legal value`);
      assert(
        !at.repairs.some((note) => note.startsWith(`${path}: clamped`)),
        `${path}: hi should not clamp`,
      );
    }

    // Only the field's own clamp is asserted absent. A boundary value can
    // legitimately trip a *relational* repair on a neighbour — a minimal
    // head makes the curated eye too big for it — and that is the schema
    // working, not a bound disagreeing with the table.
    const atLo = normalizeWalkerDNA(withField(path, lo));
    assert.equal(readPath(atLo.dna, path), lo, `${path}: lo is a legal value`);
    assert(
      !atLo.repairs.some((note) => note.startsWith(`${path}: clamped`)),
      `${path}: lo should not clamp`,
    );
  }
}

// --- head offset, per axis --------------------------------------------

WALKER_HEAD_OFFSET_CLAMPS.forEach(([lo, hi], axis) => {
  const under = [...CURATED_WALKER_DNA.head.offset];
  under[axis] = lo - 1;
  assert.equal(
    normalizeWalkerDNA(withField("head.offset", under)).dna.head.offset[axis],
    lo,
    `head.offset[${axis}]: below lo should clamp to lo`,
  );

  const over = [...CURATED_WALKER_DNA.head.offset];
  over[axis] = hi + 1;
  assert.equal(
    normalizeWalkerDNA(withField("head.offset", over)).dna.head.offset[axis],
    hi,
    `head.offset[${axis}]: above hi should clamp to hi`,
  );
});

// --- wing bounds, fliers only -----------------------------------------

// A curated flier body is wide enough that the span relation does not fire
// at the table maximum, so wing scalars can be checked the same way.
const flierBase = { locomotion: "flier", legs: { ...CURATED_WALKER_DNA.legs, count: 2 } };

for (const field of Object.keys(WALKER_WING_CLAMPS)) {
  const path = `wings.${field}`;
  const [lo, hi] = WALKER_WING_CLAMPS[field];

  const under = normalizeWalkerDNA({ ...flierBase, wings: { [field]: lo - 1 } });
  assert.equal(under.dna.wings[field], lo, `${path}: below lo should clamp to lo`);
  assert(
    under.repairs.includes(`${path}: clamped to ${lo}`),
    `${path}: clamping below lo should be reported`,
  );

  if (!RELATED.has(path)) {
    const over = normalizeWalkerDNA({ ...flierBase, wings: { [field]: hi + 1 } });
    assert.equal(over.dna.wings[field], hi, `${path}: above hi should clamp to hi`);
  }
}

assert.equal(
  normalizeWalkerDNA(CURATED_WALKER_DNA).dna.wings,
  undefined,
  "a walker carries no wings block",
);

// --- relational bounds -------------------------------------------------

for (const relation of WALKER_RELATIONS) {
  const base = relation.flierOnly ? { ...flierBase, wings: {} } : structuredClone(CURATED_WALKER_DNA);
  const ceiling = readPath(normalizeWalkerDNA(base).dna, relation.boundedBy) * relation.factor;

  // Ask for well over the ceiling; the scalar clamp may bite first, so assert
  // the result respects the relation rather than equalling a fixed number.
  const keys = relation.field.split(".");
  const last = keys.pop();
  const raw = structuredClone(base);
  let cursor = raw;
  for (const key of keys) {
    cursor[key] = cursor[key] ?? {};
    cursor = cursor[key];
  }
  cursor[last] = ceiling * 4;

  const result = normalizeWalkerDNA(raw);
  const got = readPath(result.dna, relation.field);
  assert(
    got <= ceiling + 1e-9,
    `${relation.field}: should be held at or under ${relation.boundedBy} * ${relation.factor}`,
  );
  assert(
    result.repairs.includes(relation.note),
    `${relation.field}: exceeding its relation should report "${relation.note}"`,
  );
}

// Every relation's note must be reachable, or the table has a dead row.
assert.equal(
  new Set(WALKER_RELATIONS.map((r) => r.note)).size,
  WALKER_RELATIONS.length,
  "relation notes should be distinct",
);

console.log("genome clamp table tests passed");
