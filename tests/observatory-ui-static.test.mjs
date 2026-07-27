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
  "obs-brand",
  "obs-conditions",
  "obs-note-phase",
  "obs-note-air",
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

// The shell places panels by named grid area. Reverting to per-panel absolute
// coordinates is what made every breakpoint a hand-tuned pixel exercise.
assert.ok(
  /\.observatory-shell\s*\{[^}]*grid-template-areas:/s.test(css),
  "the observatory shell should place its panels on a named grid",
);
for (const area of ["brand", "rail", "spec", "reso", "dock", "taxo", "rel", "field"]) {
  assert.ok(
    css.includes(`grid-area: ${area}`),
    `a panel should claim the ${area} grid area`,
  );
}
// Every template that redefines the areas must redefine the columns too — a
// block that changes only one inherits a different column count from its
// neighbour and the named areas silently stop lining up.
const areaBlocks = css.match(/grid-template-areas:/g) ?? [];
const columnBlocks = css.match(/grid-template-columns:\s*\n?\s*var\(--obs-gutter-x\)/g) ?? [];
assert.equal(
  areaBlocks.length,
  columnBlocks.length,
  `each grid-template-areas needs a matching grid-template-columns (${areaBlocks.length} areas vs ${columnBlocks.length} column sets)`,
);
assert.ok(
  html.includes('class="obs-specimen-dock"'),
  "the specimen and its pull-tab should share one positioning context",
);
assert.ok(
  css.includes(".obs-specimen.collapsed + .obs-paper-tab"),
  "the collapsed specimen needs a persistent external handle",
);
// The dock cancels the gutter track, the rail track AND both gaps between
// them. Dropping one gap parked the closed handle short of the viewport edge.
assert.ok(
  /\.obs-specimen-dock \{[^}]*var\(--obs-grid-gap\) \* 2/s.test(css),
  "the specimen dock should bleed across both track gaps to the viewport edge",
);
// right ↔ left cannot interpolate: flipping between them teleported the handle
// across the card instead of riding it out.
for (const rule of [
  /\.obs-specimen\.collapsed \+ \.obs-paper-tab \{[^}]*right: calc\(100% - 94px\)/s,
  /\.obs-specimen\.collapsed \+ \.obs-paper-tab \{(?![^}]*left:)[^}]*\}/s,
]) {
  assert.ok(rule.test(css), "the collapsed handle should stay anchored by `right`");
}

// One hint box for the whole rail. Per-button tooltips sat at each button's
// own centre and overlapped as the pointer travelled the column.
assert.ok(html.includes('id="obs-rail-hint"'), "the rail needs a single shared hint box");
assert.ok(
  !/\.obs-rail-button::after \{/.test(css),
  "per-button rail tooltips should be gone, not merely hidden",
);
assert.ok(
  ui.includes('railHint.textContent = button.getAttribute("aria-label")'),
  "the shared hint should take its text from the hovered lens",
);
assert.ok(css.includes(".form-candidate.selected"), "candidate selection needs a visible state");
assert.ok(
  html.includes('aria-controls="obs-specimen"'),
  "the specimen handle should expose its controlled panel",
);
assert.ok(ui.includes("requestCreatureCandidates"), "Form Studio should call the authoring client");
// The studio must never dead-end on a missing local model: the grammar is the
// fallback, not a second feature the reader has to discover.
assert.ok(
  /catch \(error\)[\s\S]{0,600}growFromGrammar\(/.test(ui),
  "an unreachable authoring model should fall back to the field grammar",
);
assert.ok(
  !/>Procedural studies</.test(html),
  "the studio should name its actions by what they do, not by how they are built",
);
for (const id of ["form-progress", "form-progress-fill", "form-progress-stage", "form-progress-note"]) {
  assert.ok(html.includes(`id="${id}"`), `the studio progress bar should expose #${id}`);
}
assert.ok(
  ui.includes("studioProgress(elapsed)") && ui.includes("studioMessage(elapsed)"),
  "the progress bar should be driven by the shared studio-progress module",
);
assert.ok(ui.includes("introduceLivingFauna"), "accepted forms should enter the live field");
assert.ok(ui.includes("meanHeadingCoherence"), "resonance must derive from live field telemetry");
// The relations panel was a hand-drawn triangle and a count of distinct event
// type strings. It reads the runtime's affordances now.
assert.ok(
  ui.includes("buildRelationGraph"),
  "field relations should be built from registered affordances",
);
assert.ok(
  !/<path d="M24 54 88 14/.test(html),
  "the hardcoded relation triangle should be gone",
);
assert.ok(
  html.includes('class="obs-relation-links"') && html.includes('class="obs-relation-nodes"'),
  "the relations plot needs link and node layers to draw into",
);
// Rebuilding this on the 180ms tick would redraw an unchanged graph four times
// a second; the registrations only move when the field is rebuilt.
assert.ok(
  !/window\.setInterval\(update, 180\)[\s\S]*updateRelations/.test(ui),
  "relations must not be rebuilt on the display tick",
);
// Leaders project on rAF; text stays on the slow tick. Moving the specimen
// writes to 60Hz would thrash layout for no gain.
assert.ok(
  ui.includes("window.requestAnimationFrame(layoutCallouts)"),
  "callout projection should run on its own animation frame",
);
assert.ok(
  /function layoutCallouts\(\)[\s\S]*?\n  \}/.test(ui) &&
    !/function layoutCallouts\(\)[\s\S]*?\n  \}/.exec(ui)[0].includes("getComputedStyle"),
  "the per-frame loop must not force style resolution",
);
assert.ok(
  /function layoutCallouts\(\)[\s\S]*?\n  \}/.exec(ui)[0].includes("document.hidden"),
  "the per-frame loop should stand down when the document is hidden",
);
assert.ok(
  ui.includes("refreshCalloutCaches") &&
    /addEventListener\("resize", refreshCalloutCaches\)/.test(ui),
  "cached panel rects must be refreshed when the viewport changes",
);
assert.ok(html.includes('id="obs-leaders"'), "leaders need a viewport-space overlay");
assert.ok(
  !/viewBox/.test(html.match(/<svg class="obs-leaders"[^>]*>/)?.[0] ?? ""),
  "the leader overlay must have no viewBox so its user units are CSS pixels",
);
for (const id of ["obs-callout-ground", "obs-callout-peer"]) {
  assert.ok(html.includes(`id="${id}"`), `the mockup's fourth and fifth callouts need #${id}`);
}

// --obs-violet had zero var() references; `unknown` is what finally uses it.
assert.ok(
  /--obs-rel-unknown:\s*var\(--obs-violet\)/.test(css),
  "an uncategorised affordance should render in the violet token",
);
assert.ok(
  ui.includes("PANEL_VISIBILITY_KEY"),
  "panel visibility should persist between observations",
);
assert.ok(
  ui.includes("panelVisibility[lens] = !panelVisibility[lens]"),
  "each instrument lens should toggle without clearing its siblings",
);
assert.ok(
  ui.includes("generateIslandName(state.currentSeed)"),
  "the field card should name the island with the app-wide generator",
);
assert.ok(
  !ui.includes("ZONE_PREFIXES"),
  "the observatory should not carry a second, disagreeing island-name generator",
);
// Assert the call site, not the bare name — "emphasizeBrand()" also matches
// the declaration `function emphasizeBrand() {`, so a bare-name check passed
// even with the rezone hook deleted.
assert.ok(
  ui.includes("window.setTimeout(emphasizeBrand,"),
  "the identity pulse should replay when the world rezones",
);
assert.ok(
  css.includes("@keyframes obs-brand-refresh"),
  "the refresh identity should have an emphasis animation",
);

// The masthead holds the page's only <h1>. It used to be visibility:hidden
// except for a few seconds after each regen, which also kept the heading out
// of the accessibility tree for almost the entire session.
const brandRule = css.match(/\n\.obs-brand \{([^}]*)\}/);
assert.ok(brandRule, "the masthead needs a base rule");
assert.ok(
  !/visibility:\s*hidden/.test(brandRule[1]) && !/opacity:\s*0\s*;/.test(brandRule[1]),
  "the masthead must stay visible so the page always exposes its heading",
);
// The pulse must not bottom out at zero either: a frozen animation in a
// backgrounded tab would leave the heading invisible all over again.
const pulseFrames = css.match(/@keyframes obs-brand-refresh \{([\s\S]*?)\n\}/);
assert.ok(pulseFrames, "the masthead pulse needs keyframes");
assert.ok(
  !/opacity:\s*0\s*;/.test(pulseFrames[1]),
  "no masthead keyframe may reach full transparency",
);
assert.ok(
  ui.includes("BRAND_PULSE_SETTLE_MS"),
  "the pulse needs a fallback that clears the class when animationend never fires",
);
assert.ok(entry.includes("initObservatory()"), "the public UI entry should initialize the observatory");
assert.ok(
  vite.includes('host: "0.0.0.0"'),
  "the dev and preview servers should be reachable on the local LAN",
);

console.log("observatory-ui-static.test.mjs passed");
