import assert from "node:assert/strict";

globalThis.__APP_VERSION__ = "test";

const {
  FLORA_AUTHORING_LIMIT,
  FLORA_SYSTEM_PROMPT,
  createProceduralFloraStudies,
  extractFloraCandidates,
  loadAuthoredFlora,
  saveAuthoredFlora,
} = await import("../src/flora-authoring.js");
const { ARCHETYPE_SHAPE_LIMITS, FLORA_ARCHETYPES } = await import(
  "../src/generated-flora/archetypes.js"
);

// ------------------------------------------------------------------ prompt
//
// The prompt is generated from the limits table rather than written out, so a
// new archetype or a retuned bound cannot leave the model working from a stale
// schema.
for (const archetype of FLORA_ARCHETYPES) {
  assert.ok(
    FLORA_SYSTEM_PROMPT.includes(`"${archetype}"`),
    `the prompt should offer the ${archetype} archetype`,
  );
  for (const field of Object.keys(ARCHETYPE_SHAPE_LIMITS[archetype])) {
    assert.ok(
      FLORA_SYSTEM_PROMPT.includes(field),
      `the prompt should describe ${archetype}.${field}`,
    );
  }
}
// Colour belongs to the field, so the schema must not invite one.
assert.doesNotMatch(FLORA_SYSTEM_PROMPT, /"palette"/);
assert.match(FLORA_SYSTEM_PROMPT, /Colour is NOT yours to choose/);

// ------------------------------------------------------------------- parse
{
  const reply = JSON.stringify({
    candidates: [
      { name: "Duskbough", archetype: "canopy", seed: 11, shape: { height: 8 } },
      { name: "Nightbell", archetype: "bell", seed: 12, shape: { stemCount: 9 } },
      { name: "Ashmoss", archetype: "cover", seed: 13, shape: { count: 140 } },
    ],
  });
  const candidates = extractFloraCandidates(reply, "dusk plants");
  assert.equal(candidates.length, 3);
  assert.deepEqual(
    candidates.map((entry) => entry.dna.archetype),
    ["canopy", "bell", "cover"],
  );
  assert.ok(
    candidates.every((entry) => entry.repairs.length === 0),
    "well-formed input should need no repair",
  );
  assert.ok(candidates.every((entry) => entry.source === "model"));
}

// Real local-model output: a code fence, prose around it, trailing commas.
{
  const messy = [
    "Sure! Here are three plants:",
    "```json",
    '{"candidates":[{"name":"Reedwhisper","archetype":"reed","shape":{"height":2.0,},},]}',
    "```",
  ].join("\n");
  const candidates = extractFloraCandidates(messy, "reeds");
  assert.equal(candidates[0].dna.archetype, "reed");
  assert.equal(candidates[0].dna.name, "Reedwhisper");
}

// An unparseable reply still yields whatever fragments look like plants.
{
  const truncated =
    'blah {"name":"Halfthing","archetype":"frond","shape":{"height":1.2}} and then the modelll';
  const candidates = extractFloraCandidates(truncated, "ferns");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].dna.archetype, "frond");
}

assert.throws(
  () => extractFloraCandidates("I'm afraid I can't do that.", "x"),
  /No plant DNA found/,
);

// ------------------------------------------------------------ normalization
//
// The whole point of the normalizer: hostile input becomes a valid plant.
{
  const bogus = JSON.stringify({
    candidates: [
      {
        name: "X".repeat(200),
        archetype: "triffid",
        shape: { height: 9999, branchCount: 40, patchRadius: -3 },
        motion: { wind: 500 },
      },
    ],
  });
  const [candidate] = extractFloraCandidates(bogus, "x");
  assert.ok(FLORA_ARCHETYPES.includes(candidate.dna.archetype));
  assert.ok(candidate.repairs.length > 0, "a bogus archetype should be reported");
  assert.ok(candidate.dna.name.length <= 64);
  // `shape` is keyed per archetype, so fields from another one cannot survive.
  const allowed = new Set(Object.keys(ARCHETYPE_SHAPE_LIMITS[candidate.dna.archetype]));
  for (const field of Object.keys(candidate.dna.shape)) {
    assert.ok(allowed.has(field), `${field} leaked from another archetype`);
    const [low, high] = ARCHETYPE_SHAPE_LIMITS[candidate.dna.archetype][field];
    assert.ok(candidate.dna.shape[field] >= low && candidate.dna.shape[field] <= high);
  }
  assert.ok(candidate.dna.motion.wind <= 2);
}

// ----------------------------------------------------------------- grammar
{
  const studies = createProceduralFloraStudies("a windswept ridge");
  assert.equal(studies.length, 3);
  assert.equal(
    new Set(studies.map((entry) => entry.dna.archetype)).size,
    3,
    "the fallback should offer three different plants, not one at three sizes",
  );
  assert.ok(
    studies.every((entry) => entry.repairs.length === 0),
    "the field's own grammar must land inside its own limits",
  );
  assert.ok(studies.every((entry) => entry.source === "grammar"));
  // Deterministic for a given description.
  assert.deepEqual(
    createProceduralFloraStudies("a windswept ridge").map((e) => e.genomeHash),
    studies.map((entry) => entry.genomeHash),
  );
  assert.notDeepEqual(
    createProceduralFloraStudies("a sunken bog").map((e) => e.genomeHash),
    studies.map((entry) => entry.genomeHash),
  );
}

// ------------------------------------------------------------------- shelf
{
  const store = new Map();
  const storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  };
  const [first, second] = createProceduralFloraStudies("shelf test");
  saveAuthoredFlora(first, "shelf test", storage);
  saveAuthoredFlora(second, "shelf test", storage);
  const loaded = loadAuthoredFlora(storage);
  assert.equal(loaded.length, 2);
  assert.equal(loaded[0].genomeHash, second.genomeHash, "newest first");
  assert.equal(loaded[0].prompt, "shelf test");
  assert.ok(FLORA_ARCHETYPES.includes(loaded[0].dna.archetype));

  // Saving the same plant twice keeps one entry.
  saveAuthoredFlora(first, "shelf test", storage);
  assert.equal(loadAuthoredFlora(storage).length, 2);

  // The shelf is bounded.
  for (let index = 0; index < FLORA_AUTHORING_LIMIT + 4; index++) {
    const [study] = createProceduralFloraStudies(`overflow ${index}`);
    saveAuthoredFlora(study, `overflow ${index}`, storage);
  }
  assert.ok(loadAuthoredFlora(storage).length <= FLORA_AUTHORING_LIMIT);

  // A corrupt shelf reads as empty rather than throwing.
  store.set("living-field:authored-flora:v1", "{not json");
  assert.deepEqual(loadAuthoredFlora(storage), []);
  // And no storage at all is fine.
  assert.deepEqual(loadAuthoredFlora(undefined), []);
}

console.log("flora-authoring.test.mjs passed");
