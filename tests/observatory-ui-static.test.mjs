import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
const ui = readFileSync(new URL("../src/ui/observatory.js", import.meta.url), "utf8");
const entry = readFileSync(new URL("../src/ui.js", import.meta.url), "utf8");

for (const id of [
  "observatory-shell",
  "obs-field-name",
  "obs-genome",
  "obs-taxonomy-list",
  "obs-field-wave",
  "obs-create-form",
  "form-studio",
  "form-candidates",
  "form-introduce",
]) {
  assert.ok(html.includes(`id="${id}"`), `observatory markup should expose #${id}`);
}

assert.ok(css.includes(".observatory-shell"), "observatory shell needs dedicated styling");
assert.ok(css.includes("@media (max-width: 760px)"), "observatory needs a mobile layout");
assert.ok(css.includes(".form-candidate.selected"), "candidate selection needs a visible state");
assert.ok(ui.includes("requestCreatureCandidates"), "Form Studio should call the authoring client");
assert.ok(ui.includes("introduceLivingFauna"), "accepted forms should enter the live field");
assert.ok(ui.includes("meanHeadingCoherence"), "resonance must derive from live field telemetry");
assert.ok(entry.includes("initObservatory()"), "the public UI entry should initialize the observatory");

console.log("observatory-ui-static.test.mjs passed");
