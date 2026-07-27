import assert from "node:assert/strict";

import {
  createProceduralStudies,
  extractCreatureCandidates,
  loadAuthoredForms,
  saveAuthoredForm,
} from "../src/creature-authoring.js";

const reply = `
Here are the studies:
\`\`\`json
{
  "candidates": [
    {
      "name": "Lantern Grazer",
      "speciesId": "lantern-grazer",
      "seed": 123,
      "palette": {
        "body": "#7755aa",
        "head": "#ef765c",
        "limb": "#49345c",
        "eye": "#fff5d8",
        "pupil": "#15152a"
      },
      "body": { "radius": 0.34, "halfLength": 0.3 },
      "head": { "radius": 0.22, "offset": [0, 0.18, 0.4], "eyeRadius": 0.05 },
      "legs": { "count": 6, "length": 0.52, "thickness": 0.06, "stance": 0.22, "spread": 0.28 },
      "motion": { "stepDuration": 0.27, "stepTrigger": 0.12, "lift": 0.08, "bob": 0.02 },
    }
  ],
}
\`\`\`
`;

const parsed = extractCreatureCandidates(reply, "a lantern grazer");
assert.equal(parsed.length, 1);
assert.equal(parsed[0].dna.name, "Lantern Grazer");
assert.equal(parsed[0].dna.legs.count, 6);
assert.match(parsed[0].genomeHash, /^[0-9a-f]{8}$/);

const truncatedReply = reply
  .replace(/,\s*\]\s*,\s*\}\s*```[\s\S]*$/m, ",")
  .trim();
const recovered = extractCreatureCandidates(truncatedReply, "a lantern grazer");
assert.equal(
  recovered[0].dna.name,
  "Lantern Grazer",
  "a complete candidate should survive a truncated wrapper",
);

const studiesA = createProceduralStudies("a shy mossy crawler");
const studiesB = createProceduralStudies("a shy mossy crawler");
assert.equal(studiesA.length, 3);
assert.deepEqual(studiesA, studiesB);
assert.deepEqual(studiesA.map((entry) => entry.dna.legs.count), [2, 4, 6]);

const values = new Map();
const storage = {
  getItem(key) {
    return values.get(key) ?? null;
  },
  setItem(key, value) {
    values.set(key, value);
  },
};
saveAuthoredForm(studiesA[0], "a shy mossy crawler", storage);
saveAuthoredForm(studiesA[0], "updated prompt", storage);
const saved = loadAuthoredForms(storage);
assert.equal(saved.length, 1, "saving the same genome twice should deduplicate it");
assert.equal(saved[0].prompt, "updated prompt");
assert.equal(saved[0].genomeHash, studiesA[0].genomeHash);

console.log("creature-authoring.test.mjs passed");
