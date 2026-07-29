// The editing session, without a browser.
//
// The card is DOM, but almost none of its behaviour is: it applies one change,
// asks the normalizer what happened, and works out which margin the answer
// belongs in. All of that lives in `genome-draft.js` precisely so it can be
// asserted here rather than eyeballed in a browser.
//
// The load-bearing claim is the one about idempotence. If a canonical genome
// re-normalized noisily, every edit would surface a backlog of notes that the
// player did not cause, and the marginalia would be lying about why it
// appeared. So that is checked first, across the whole schema matrix.

import assert from "node:assert/strict";
import { FLORA_ARCHETYPES, normalizeFloraDNA } from "../src/generated-flora/dna.js";
import { CURATED_WALKER_DNA, normalizeWalkerDNA } from "../src/generated-fauna/dna.js";
import { describeGenome, readGenomePath } from "../src/ui/genome-schema.js";
import {
  attributeRepairs,
  createGenomeDraft,
  editGenomeDraft,
  fieldRange,
  genomeDocument,
  genomeFingerprint,
  normalizeGenome,
  repairTarget,
  spellNumber,
  trackFraction,
  writeGenomePath,
} from "../src/ui/genome-draft.js";

const walkerDna = normalizeWalkerDNA(CURATED_WALKER_DNA).dna;
const flierDna = normalizeWalkerDNA({ ...CURATED_WALKER_DNA, locomotion: "flier" }).dna;

function fieldsOf(draft) {
  const map = new Map();
  for (const section of draft.sections) {
    for (const field of section.fields) map.set(field.path, field);
  }
  return map;
}

// --- normalization is idempotent, and the hash agrees with the normalizer ---

for (const archetype of FLORA_ARCHETYPES) {
  const { dna } = normalizeFloraDNA({ archetype });
  const again = normalizeGenome(dna);
  assert.deepEqual(again.dna, dna, `${archetype}: a canonical genome should renormalize to itself`);
  assert.deepEqual(again.repairs, [], `${archetype}: a canonical genome should renormalize in silence`);
  assert.equal(
    again.genomeHash,
    genomeFingerprint(dna),
    `${archetype}: the fingerprint should be a function of the genome alone`,
  );
}

for (const dna of [walkerDna, flierDna]) {
  const again = normalizeGenome(dna);
  assert.deepEqual(again.dna, dna, `${dna.locomotion}: a canonical genome should renormalize to itself`);
  assert.deepEqual(again.repairs, [], `${dna.locomotion}: a canonical genome should renormalize in silence`);
  // The draft mints hashes for both schemas the same way; for fauna that has
  // to agree with the hash the normalizer already returns, or a rebuilt
  // creature would look like a different one to the saved-forms shelf.
  assert.equal(
    genomeFingerprint(dna),
    normalizeWalkerDNA(dna).genomeHash,
    `${dna.locomotion}: fingerprint should match the normalizer's own genome hash`,
  );
}

assert.throws(() => normalizeGenome({}), /not a recognised genome/);
assert.throws(() => createGenomeDraft(null), /not a recognised genome/);

// --- a clean draft has nothing in its margins ------------------------------

const clean = createGenomeDraft(walkerDna);
assert.equal(clean.kind, "fauna");
assert.equal(clean.genomeHash, normalizeWalkerDNA(walkerDna).genomeHash);
assert.equal(clean.marginalia.size, 0, "an untouched genome should carry no marginalia");
assert.deepEqual(clean.notes, [], "an untouched genome should carry no card notes");
assert.deepEqual(clean.moved, [], "nothing has moved before the first edit");
assert.equal(clean.edited.size, 0);
assert.equal(clean.primitiveCount, normalizeWalkerDNA(walkerDna).primitiveCount);

// --- an edit inside the bounds just happens --------------------------------

const nudged = editGenomeDraft(clean, "body.radius", 0.3);
assert.equal(nudged.dna.body.radius, 0.3, "a value inside its bounds should be taken as asked");
assert.equal(nudged.marginalia.size, 0, "an unremarkable edit should not produce marginalia");
assert.notEqual(nudged.genomeHash, clean.genomeHash, "the hash should follow the content");
assert(nudged.edited.has("body.radius"), "the edited path should be marked");
assert.equal(clean.dna.body.radius, walkerDna.body.radius, "editing must not mutate the previous draft");

// Setting a field back to the value it already had is a no-op all the way down.
const restored = editGenomeDraft(nudged, "body.radius", walkerDna.body.radius);
assert.equal(restored.genomeHash, clean.genomeHash, "returning a field should return the hash");
assert.equal(restored.marginalia.size, 0);

// --- an edit past an absolute bound settles, and says so in the margin ------

const bodyField = fieldsOf(clean).get("body.radius");
const overshot = editGenomeDraft(clean, "body.radius", bodyField.hi + 5);
assert.equal(overshot.dna.body.radius, bodyField.hi, "an overshoot should settle at the bound");
const bodyNote = overshot.marginalia.get("body.radius");
assert(bodyNote?.length, "the note should be filed under the field that caused it");
assert.equal(overshot.marginalia.size, 1, "only the edited field should have gained a note");

// --- an edit past a relational bound is filed under the same field ---------

// legs.thickness may be no more than a quarter of legs.length. Shortening the
// legs first makes the ceiling bite whatever the curated numbers happen to be.
const shortLegs = editGenomeDraft(clean, "legs.length", 0.24);
assert.equal(shortLegs.dna.legs.length, 0.24);
assert(
  shortLegs.dna.legs.thickness < walkerDna.legs.thickness,
  "shortening the legs should have slimmed them without being asked",
);
assert.deepEqual(
  shortLegs.moved,
  ["legs.thickness"],
  "a field the player did not touch should be reported as having moved by itself",
);
assert(
  shortLegs.marginalia.get("legs.thickness")?.length,
  "the relational repair belongs beside the field it moved, not the field that was edited",
);
assert(!shortLegs.marginalia.has("legs.length"), "the edited field itself was never repaired");

// --- the notes are prose, never a validation error -------------------------

const everyPhrase = [
  ...[...overshot.marginalia.values()].flat(),
  ...[...shortLegs.marginalia.values()].flat(),
];
assert(everyPhrase.length >= 2);
for (const phrase of everyPhrase) {
  assert(!/[{}[\]]/.test(phrase), `marginalia should not contain braces: ${phrase}`);
  assert(!/\b(error|invalid|failed)\b/i.test(phrase), `marginalia should not read as an error: ${phrase}`);
  // A dotted *path* — not a decimal, which is exactly what a settled value
  // reads as ("the body settled at 0.46").
  assert(
    !/[A-Za-z_]\w*\.[A-Za-z_]/.test(phrase),
    `marginalia should not contain a field path: ${phrase}`,
  );
}

// --- attribution resolves against the schema, not against guesswork --------

const walkerSections = describeGenome(walkerDna).sections;
const floraSections = describeGenome(normalizeFloraDNA({ archetype: "spire" }).dna).sections;

const cases = [
  ["legs.thickness: reduced to fit leg length", walkerSections, "legs.thickness"],
  ["body.radius: clamped to 0.46", walkerSections, "body.radius"],
  ["legs.count: repaired to 4", walkerSections, "legs.count"],
  ["locomotion: repaired to walker", walkerSections, "locomotion"],
  ["palette.body: expected #rrggbb", walkerSections, "palette.body"],
  // A vec3 the schema splits into three rows lands on the first of them.
  ["head.offset: expected [x, y, z]", walkerSections, "head.offset.0"],
  ["shape.height clamped to 8.5", floraSections, "shape.height"],
  ["motion.wind invalid -> 0.16", floraSections, "motion.wind"],
  ["paletteRoles.structure invalid -> stem", floraSections, "paletteRoles.structure"],
  ["variation scale range reordered", floraSections, "variation"],
  // Notes about the genome as a whole have no field to sit beside. These are
  // the ones a naive "first token is the path" rule would file under fields
  // called "unknown", "invalid" and "flora".
  ['unknown flora archetype "shrubbery" -> bell', floraSections, null],
  ["invalid name -> archetype default", floraSections, null],
  ["flora DNA was not an object -> defaults", floraSections, null],
  ["root: expected object; used curated defaults", walkerSections, null],
];

for (const [note, sections, expected] of cases) {
  const { byPath, general } = attributeRepairs([note], sections);
  if (expected === null) {
    assert.equal(byPath.size, 0, `"${note}" should not be filed under a field`);
    assert.equal(general.length, 1, `"${note}" should become a note on the card`);
  } else {
    assert.deepEqual([...byPath.keys()], [expected], `"${note}" should be filed under ${expected}`);
    assert.equal(general.length, 0, `"${note}" should not also be a card note`);
  }
}

// Duplicates collapse — a resized genome repairs the same thing repeatedly and
// the player wants to know what happened, not how many times.
const repeated = attributeRepairs(
  ["body.radius: clamped to 0.46", "body.radius: clamped to 0.46"],
  walkerSections,
);
assert.equal(repeated.byPath.get("body.radius").length, 1);

// --- relational ceilings are computed, not guessed --------------------------

const thickness = fieldsOf(clean).get("legs.thickness");
const openRange = fieldRange(thickness, walkerDna);
assert.equal(openRange.ceiling, Math.min(thickness.hi, walkerDna.legs.length * 0.24));
assert.equal(openRange.bounded, openRange.ceiling < thickness.hi);

const tightRange = fieldRange(thickness, shortLegs.dna);
assert.equal(tightRange.ceiling, 0.24 * 0.24, "the ceiling should track the field it is written against");
assert.equal(tightRange.bounded, true, "a ceiling below the absolute bound is worth drawing");
assert.equal(tightRange.boundedBy, "legs.length");

// A field with no relation reports its own range and nothing else.
const plain = fieldRange(fieldsOf(clean).get("motion.bob"), walkerDna);
assert.equal(plain.bounded, false);
assert.equal(plain.ceiling, plain.hi);

// The ceiling must agree with what the normalizer actually enforces: push the
// field to its ceiling exactly and nothing should be repaired.
const atCeiling = editGenomeDraft(shortLegs, "legs.thickness", tightRange.ceiling);
assert.equal(atCeiling.dna.legs.thickness, tightRange.ceiling);
assert(
  !atCeiling.marginalia.has("legs.thickness"),
  "a value exactly at the computed ceiling should not be repaired",
);
const pastCeiling = editGenomeDraft(shortLegs, "legs.thickness", tightRange.ceiling + 0.01);
assert.equal(pastCeiling.dna.legs.thickness, tightRange.ceiling, "past the ceiling settles at it");
assert(pastCeiling.marginalia.has("legs.thickness"));

assert.equal(trackFraction(0.5, 0, 1), 0.5);
assert.equal(trackFraction(-3, 0, 1), 0, "the fraction is clamped for drawing");
assert.equal(trackFraction(9, 0, 1), 1);
assert.equal(trackFraction(1, 1, 1), 0, "a degenerate range should not divide by zero");

// --- changing a discriminator re-keys the whole schema ---------------------

const spire = createGenomeDraft(normalizeFloraDNA({ archetype: "spire" }).dna);
assert(fieldsOf(spire).has("shape.budRadius"));
const asCover = editGenomeDraft(spire, "archetype", "cover");
assert.equal(asCover.dna.archetype, "cover");
assert(fieldsOf(asCover).has("shape.bladeHeight"), "the new archetype's own fields should appear");
assert(
  !fieldsOf(asCover).has("shape.budRadius"),
  "a groundcover has no buds — the controls must not outlive the archetype that had them",
);

const asFlier = editGenomeDraft(clean, "locomotion", "flier");
assert.equal(asFlier.dna.locomotion, "flier");
assert(fieldsOf(asFlier).has("wings.span"), "growing wings should grow the controls for them");
assert(asFlier.dna.wings, "the normalizer should have supplied a wing block");

// --- the writing face is real JSON -----------------------------------------

for (const dna of [walkerDna, flierDna, normalizeFloraDNA({ archetype: "spire" }).dna]) {
  const document = genomeDocument(dna);
  assert.deepEqual(
    JSON.parse(document.text),
    JSON.parse(JSON.stringify(dna)),
    "the page must be the genome, not a rendering of it",
  );
  assert.equal(document.count, document.lines.length);
  assert.equal(document.text.split("\n").length, document.count, "one line is one line");
  // Real counts are 34 (a groundcover) to 42 (a flier). The design doc used to
  // claim "about twenty", which was a guess and wrong; the caption spells out
  // whatever the number actually is. The bound here is a drift guard — if a
  // genome ever needs sixty lines to write down, the claim the writing face is
  // making has quietly stopped being true and the page needs rethinking.
  assert(document.count <= 48, `a genome should fit on one page, got ${document.count} lines`);
  assert.equal(document.lines[0].text, "{");
  assert.equal(document.lines.at(-1).text, "}");

  // Every numeric token knows its own path, so the writing face can send the
  // reader back to the control that owns it.
  const numbers = document.lines.filter((line) => line.numeric);
  assert(numbers.length > 4, "a genome is mostly numbers");
  for (const line of numbers) {
    assert.equal(
      readGenomePath(dna, line.path),
      line.value,
      `${line.path}: the written value should be the genome's value`,
    );
  }
}

// A vec3 is one fact and gets one line — the line count is the argument this
// page makes, so it must not be inflated by punctuation.
const walkerDocument = genomeDocument(walkerDna);
const offsetLine = walkerDocument.lines.find((line) => line.key === "offset");
assert.equal(offsetLine.text, '"offset": [0, 0.18, 0.34],');

// Keys stay in the order the normalizer wrote them: a document, not a tree.
const topLevel = walkerDocument.lines
  .filter((line) => line.indent === 1 && line.kind !== "close")
  .map((line) => line.key);
assert.equal(topLevel[0], "schemaVersion");
assert.deepEqual(topLevel, Object.keys(walkerDna), "the page should read in the genome's own order");

// --- small numbers are written out -----------------------------------------

assert.equal(spellNumber(0), "zero");
assert.equal(spellNumber(9), "nine");
assert.equal(spellNumber(19), "nineteen");
assert.equal(spellNumber(20), "twenty");
assert.equal(spellNumber(31), "thirty-one");
assert.equal(spellNumber(40), "forty");
assert.equal(spellNumber(99), "ninety-nine");
assert.equal(spellNumber(100), "100", "beyond the notebook's range, fall back to digits");

// --- path writing ----------------------------------------------------------

assert.deepEqual(writeGenomePath({ a: { b: 1 } }, "a.b", 2), { a: { b: 2 } });
assert.deepEqual(writeGenomePath({}, "a.b.c", 3), { a: { b: { c: 3 } } });
assert.deepEqual(writeGenomePath({ v: [1, 2, 3] }, "v.1", 9).v, [1, 9, 3]);

assert.equal(repairTarget("no leading path here", { fields: new Set(), sections: new Set() }), null);

console.log("genome draft tests passed");
