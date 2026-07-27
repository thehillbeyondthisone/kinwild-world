import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
const ui = readFileSync(new URL("../src/ui/observatory.js", import.meta.url), "utf8");
const entry = readFileSync(new URL("../src/ui.js", import.meta.url), "utf8");
const vite = readFileSync(new URL("../vite.config.js", import.meta.url), "utf8");

for (const id of [
  "observatory-shell",
  "obs-field-name",
  "obs-genome",
  "obs-specimen",
  "obs-specimen-close",
  "obs-taxonomy-list",
  "obs-field-wave",
  "obs-create-form",
  "form-studio",
  "form-candidates",
  "form-introduce",
]) {
  assert.ok(html.includes(`id="${id}"`), `observatory markup should expose #${id}`);
}

for (const lens of ["field", "fauna", "flora", "relations", "catalog", "controls"]) {
  assert.ok(
    html.includes(`data-obs-lens="${lens}"`),
    `the instrument rail should expose the ${lens} lens`,
  );
  assert.ok(
    html.includes(`data-obs-panel="${lens}"`),
    `the ${lens} lens should control a real panel`,
  );
}

assert.ok(css.includes(".observatory-shell"), "observatory shell needs dedicated styling");
assert.ok(css.includes("@media (max-width: 760px)"), "observatory needs a mobile layout");
assert.ok(
  css.includes(".obs-specimen.collapsed + .obs-paper-tab"),
  "the collapsed specimen needs a persistent external handle",
);
assert.ok(css.includes(".form-candidate.selected"), "candidate selection needs a visible state");
assert.ok(
  html.includes('aria-controls="obs-specimen"'),
  "the specimen handle should expose its controlled panel",
);
assert.ok(ui.includes("requestCreatureCandidates"), "Form Studio should call the authoring client");
assert.ok(ui.includes("introduceLivingFauna"), "accepted forms should enter the live field");
assert.ok(ui.includes("meanHeadingCoherence"), "resonance must derive from live field telemetry");
assert.ok(
  ui.includes("PANEL_VISIBILITY_KEY"),
  "panel visibility should persist between observations",
);
assert.ok(
  ui.includes('shell.dataset.panelMode = "independent"'),
  "instrument lenses should remain independently selectable",
);
assert.ok(
  ui.includes("panelVisibility[lens] = !panelVisibility[lens]"),
  "each instrument lens should toggle without clearing its siblings",
);
assert.ok(
  ui.includes("fieldZoneName(state.currentSeed)"),
  "the field card should use a deterministic zone identity",
);
assert.ok(
  ui.includes("revealBrand()"),
  "the identity reveal should replay when the world rezones",
);
assert.ok(
  css.includes("@keyframes obs-brand-reveal"),
  "the refresh identity should animate in and out",
);
assert.ok(entry.includes("initObservatory()"), "the public UI entry should initialize the observatory");
assert.ok(
  vite.includes('host: "0.0.0.0"'),
  "the dev and preview servers should be reachable on the local LAN",
);

console.log("observatory-ui-static.test.mjs passed");
