import assert from "node:assert/strict";

import { TUTORIAL_LAYERS } from "../src/tutorial/progress.js";
import { INTRO_COPY, LAYER_COPY } from "../src/tutorial/copy.js";

// The voice rules from TUTORIAL_PLAN.md, held by the suite rather than by
// good intentions — the same way genome-card-static holds the card's vibe.

/** Collect every string a copy object says. */
function stringsOf(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (value && typeof value === "object") {
    for (const item of Object.values(value)) stringsOf(item, out);
  }
  return out;
}

// A notebook margin never says HUD. These words are the wrong register
// anywhere in the walk-through — including the word for the thing itself.
const BANNED = ["lesson", "level", "complete", "tutorial", "task", "objective", "mission", "reward"];
for (const line of [...stringsOf(INTRO_COPY), ...stringsOf(LAYER_COPY)]) {
  for (const word of BANNED) {
    assert.ok(
      !new RegExp(`\\b${word}`, "i").test(line),
      `"${line}" must not say "${word}" — the margin is a naturalist's, not a HUD's`,
    );
  }
}

// One vocabulary word per layer, and a layer never spends another layer's
// word before it is earned. "Notice" may say species but not need; "follow"
// may say need but the word budget still belongs to it alone.
{
  const knownWords = TUTORIAL_LAYERS.map((layer) => layer.vocabulary).filter(Boolean);
  for (const layer of TUTORIAL_LAYERS) {
    const copy = LAYER_COPY[layer.id];
    assert.ok(copy, `layer "${layer.id}" should have copy`);
    const lines = stringsOf(copy).join(" ").toLowerCase();
    for (const word of knownWords) {
      const says = new RegExp(`\\b${word}\\b`).test(lines);
      if (word === layer.vocabulary) {
        assert.ok(says, `layer "${layer.id}" should spend its word "${word}"`);
      } else {
        assert.ok(!says, `layer "${layer.id}" must not spend "${word}" early`);
      }
    }
  }
}

// The layer table and the copy must not drift apart.
for (const id of Object.keys(LAYER_COPY)) {
  assert.ok(
    TUTORIAL_LAYERS.some((layer) => layer.id === id),
    `copy exists for unknown layer "${id}"`,
  );
}

// The cold open states the whole thesis, and nothing else.
{
  assert.match(INTRO_COPY.caption, /this island came from this number\./);
}

console.log("tutorial-copy.test.mjs passed");
