// The glyph sprite and src/ui/glyphs.js have to agree in BOTH directions.
// A <use href="#typo"> renders as an invisible nothing — no error, no warning,
// just a missing icon — so a one-directional check would miss half the ways
// this drifts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GLYPHS,
  allGlyphIds,
  conditionGlyphs,
  morphologyGlyphs,
  traitGlyphs,
} from "../src/ui/glyphs.js";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const spriteMatch = html.match(/<svg class="kw-sprite"[\s\S]*?<\/svg>/);
assert.ok(spriteMatch, "index.html should contain the kw-sprite glyph sheet");
const sprite = spriteMatch[0];

const symbolIds = [...sprite.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]);
assert.ok(symbolIds.length > 40, `the sprite should carry the full glyph set, found ${symbolIds.length}`);

const registryIds = allGlyphIds();
assert.equal(
  new Set(registryIds).size,
  registryIds.length,
  "no glyph id should appear twice in the registry",
);
assert.equal(
  new Set(symbolIds).size,
  symbolIds.length,
  "no <symbol> id should be declared twice in the sprite",
);

for (const id of registryIds) {
  assert.ok(symbolIds.includes(id), `registry references #${id} but the sprite has no such <symbol>`);
}
for (const id of symbolIds) {
  assert.ok(registryIds.includes(id), `the sprite declares #${id} but nothing in the registry uses it`);
}

// Every symbol needs a viewBox or <use> renders it at an arbitrary size.
for (const symbol of sprite.matchAll(/<symbol id="([^"]+)"([^>]*)>/g)) {
  assert.ok(
    symbol[2].includes("viewBox="),
    `#${symbol[1]} needs a viewBox to scale inside <use>`,
  );
}

// Drawing constraint from CLAUDE.md's "Vibe" section: nothing in the sprite
// should hardcode a fill or a stroke, or it stops inheriting currentColor and
// breaks on the cream specimen card.
assert.ok(
  !/<symbol[\s\S]*?(fill="(?!none)|stroke="(?!none))/.test(sprite),
  "glyphs must inherit currentColor rather than hardcoding fill or stroke",
);

// --- the DOM-free glyph selectors ------------------------------------------

const dna = {
  legs: { count: 6, length: 0.62 },
  body: { halfLength: 0.31, radius: 0.4 },
  head: { radius: 0.28 },
  motion: { lift: 0.14, bob: 0.01 },
};
const morph = morphologyGlyphs(dna);
assert.equal(morph.length, 6, "the morphology run should always fill six slots");
for (const id of morph) {
  assert.ok(registryIds.includes(id), `morphology run produced unknown glyph ${id}`);
}
assert.deepEqual(morphologyGlyphs(null), [], "a missing genome should produce no morphology run");
assert.equal(
  morphologyGlyphs({}).length,
  6,
  "a genome with no shape fields should still fill the run rather than throw",
);

assert.deepEqual(
  traitGlyphs(["upright", "long-step", "not-a-trait"]),
  [GLYPHS.trait.upright, GLYPHS.trait["long-step"]],
  "unknown trait names should be dropped, not rendered as broken references",
);
assert.deepEqual(traitGlyphs(undefined), [], "missing traits should produce an empty run");

const dial = conditionGlyphs({ night: 0.8, wind: 1.6 });
assert.equal(dial.length, 6, "the conditions dial should always show six glyphs");
for (const entry of dial) {
  assert.ok(registryIds.includes(entry.id), `conditions dial produced unknown glyph ${entry.id}`);
  assert.equal(typeof entry.on, "boolean", "every dial entry needs an on/off state");
}
assert.equal(
  conditionGlyphs({ night: 0.8, wind: 1.6 }).filter((e) => e.id === GLYPHS.condition.moonFull)[0].on,
  true,
  "a deep-night field should light the full-moon glyph",
);
assert.equal(
  conditionGlyphs({ night: 0, wind: 0 }).filter((e) => e.id === GLYPHS.condition.windCalm)[0].on,
  true,
  "still air should light the calm glyph",
);
assert.equal(conditionGlyphs().length, 6, "the dial should tolerate missing conditions");

console.log("observatory-glyph-registry.test.mjs passed");
