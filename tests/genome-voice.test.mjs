// Every repair a normalizer can report must have a phrasing.
//
// The notes are the teaching surface: each one is a rule of the world stated
// at the moment it applied to something the player made. A note that falls
// through to the generic phrasing still reads fine, but it has stopped
// teaching — so the drift guard at the bottom fails when either normalizer
// grows a note template that nothing here has been taught to say.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WALKER_RELATIONS, normalizeWalkerDNA } from "../src/generated-fauna/dna.js";
import { normalizeFloraDNA } from "../src/generated-flora/dna.js";
import { GENERIC_PHRASING, phraseRepair, phraseRepairs } from "../src/ui/genome-voice.js";

const source = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

// One real sample per template both normalizers can emit.
const SAMPLES = [
  // fauna
  "root: expected object; used curated defaults",
  "legs.count: repaired to 4",
  "locomotion: repaired to walker",
  "body.radius: clamped to 0.46",
  "head.radius: expected finite number",
  "head.offset: expected [x, y, z]",
  "palette.body: expected #rrggbb",
  "speciesId: expected string",
  "speciesId: empty after normalization",
  'speciesId: normalized to "my-wild-walker"',
  "name: expected non-empty string",
  "name: trimmed to 64 characters",
  ...WALKER_RELATIONS.map((relation) => relation.note),
  // flora
  'unknown flora archetype "shrubbery" -> bell',
  'unknown flora role "topiary" -> bell',
  "invalid name -> archetype default",
  "name truncated to 64 characters",
  "shape.height invalid -> 6.8",
  "shape.height clamped to 10.5",
  "paletteRoles.structure invalid -> stem",
  "flora DNA was not an object -> defaults",
  "variation scale range reordered",
];

for (const note of SAMPLES) {
  const phrase = phraseRepair(note);
  assert.notEqual(
    phrase,
    GENERIC_PHRASING,
    `no phrasing for "${note}" — it would fall through to the generic line`,
  );
  assert(phrase.length > 12, `"${note}": phrasing is too short to say anything`);
  assert(/[.!]$/.test(phrase), `"${note}": phrasing should be a sentence`);
}

// --- the voice constraints ---------------------------------------------

for (const note of SAMPLES) {
  const phrase = phraseRepair(note);
  assert(
    !/[{}[\]]/.test(phrase),
    `"${note}": phrasing should carry no braces or brackets — got ${phrase}`,
  );
  assert(
    !/\b\w+\.\w+\b/.test(phrase.replace(/\d+\.\d+/g, "")),
    `"${note}": phrasing should not leak a field path — got ${phrase}`,
  );
  assert(
    !/\b(error|invalid|expected|clamped|repaired|NaN|undefined|null)\b/i.test(phrase),
    `"${note}": phrasing should not read as validation output — got ${phrase}`,
  );
}

// --- real normalizer output, end to end --------------------------------

const malformed = normalizeWalkerDNA({
  name: "   ",
  body: { radius: 999 },
  head: { eyeRadius: 9, offset: "nope" },
  legs: { count: 5, thickness: 99 },
  palette: { body: "orange" },
});
assert(malformed.repairs.length > 3, "the fixture should trip several repairs");
for (const note of malformed.repairs) {
  assert.notEqual(phraseRepair(note), GENERIC_PHRASING, `unphrased live note: "${note}"`);
}

const floraMalformed = normalizeFloraDNA({
  archetype: "shrubbery",
  name: "x".repeat(200),
  shape: { height: -50 },
  variation: { scaleMin: 1.4, scaleMax: 0.7 },
  paletteRoles: { structure: "chartreuse" },
});
assert(floraMalformed.notes.length > 3, "the flora fixture should trip several notes");
for (const note of floraMalformed.notes) {
  assert.notEqual(phraseRepair(note), GENERIC_PHRASING, `unphrased live note: "${note}"`);
}

// --- batching -----------------------------------------------------------

assert.deepEqual(phraseRepairs([]), []);
assert.deepEqual(phraseRepairs(null), []);
assert.equal(
  phraseRepairs(["name: trimmed to 64 characters", "name truncated to 64 characters"]).length,
  1,
  "two notes that say the same thing should be said once",
);

// Junk is softened rather than surfaced.
assert.equal(phraseRepair(""), GENERIC_PHRASING);
assert.equal(phraseRepair(undefined), GENERIC_PHRASING);
assert.equal(phraseRepair("something nobody has seen before"), GENERIC_PHRASING);

// --- drift guard --------------------------------------------------------

// Counting the push sites is crude, but it is the thing that actually fails
// when someone adds a repair: the count moves, this test breaks, and the fix
// is to add a phrasing. Update the expected numbers in the same commit.
const faunaPushes = source("../src/generated-fauna/dna.js").match(/repairs\.push\(/g) ?? [];
const floraPushes = source("../src/generated-flora/dna.js").match(/notes\.push\(/g) ?? [];

assert.equal(
  faunaPushes.length,
  13,
  "the fauna normalizer grew or lost a repair note — add a phrasing in genome-voice.js and update this count",
);
assert.equal(
  floraPushes.length,
  9,
  "the flora normalizer grew or lost a repair note — add a phrasing in genome-voice.js and update this count",
);
assert.equal(
  WALKER_RELATIONS.length,
  4,
  "a relational constraint was added or removed — give its note a phrasing and update this count",
);

console.log("genome voice tests passed");
