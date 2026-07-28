import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The Form Studio must stay openable with every panel lens hidden.
 *
 * Its only opener used to be `#obs-create-form`, which lives in the field
 * card's tool row. The field card is `data-obs-panel="field"`, so the density
 * toggle could add `obs-lens-hidden` to it — `visibility: hidden` — and
 * `renderPanelVisibility({ persist: true })` saved that. The studio then
 * stayed unreachable across reloads, with nothing to get it back but
 * rediscovering the toggle. Narrow viewports start with the panels collapsed,
 * so this was the default experience there.
 *
 * The fix is a second opener on the instrument rail, which sits outside every
 * lensed panel. This test holds that structure: it is not enough that the
 * button exists, it has to be somewhere the lens machinery cannot reach.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const html = await readFile(path.join(root, "index.html"), "utf8");
const observatory = await readFile(
  path.join(root, "src/ui/observatory.js"),
  "utf8",
);
const css = await readFile(path.join(root, "style.css"), "utf8");

// Comments are stripped before any structural scan: the note explaining why
// the rail button exists mentions `data-obs-panel`, and a scan that read
// comments would find an ancestor that is not there.
const markup = html.replace(/<!--[\s\S]*?-->/g, "");

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/**
 * Walk the markup keeping an element stack, and return the open ancestors at
 * the point the element with `id` starts.
 */
function ancestorsOf(source, id) {
  const tagPattern = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  const stack = [];
  let match;
  while ((match = tagPattern.exec(source)) !== null) {
    const [, closing, tag, attrs, selfClosing] = match;
    const name = tag.toLowerCase();
    if (closing) {
      for (let index = stack.length - 1; index >= 0; index--) {
        if (stack[index].tag === name) {
          stack.length = index;
          break;
        }
      }
      continue;
    }
    if (new RegExp(`\\bid\\s*=\\s*["']${id}["']`).test(attrs)) {
      return stack.map((entry) => entry.attrs);
    }
    if (selfClosing || VOID_TAGS.has(name)) continue;
    stack.push({ tag: name, attrs });
  }
  return null;
}

const railStudioAncestors = ancestorsOf(markup, "obs-rail-studio");
assert.notEqual(
  railStudioAncestors,
  null,
  "#obs-rail-studio should exist — it is the studio's lens-proof opener",
);
for (const attrs of railStudioAncestors) {
  assert.doesNotMatch(
    attrs,
    /\bdata-obs-panel\b/,
    "#obs-rail-studio must not sit inside a lensed panel, or the density toggle can hide it",
  );
}
assert.ok(
  railStudioAncestors.some((attrs) => /\bclass\s*=\s*["'][^"']*\bobs-rail\b/.test(attrs)),
  "#obs-rail-studio belongs on the instrument rail",
);

// The original opener is still expected to exist, and is still expected to be
// inside the field card — the rail button supplements it rather than moving
// it. If it ever leaves, this test should be revisited rather than deleted.
const cardStudioAncestors = ancestorsOf(markup, "obs-create-form");
assert.notEqual(cardStudioAncestors, null, "#obs-create-form should still exist");
assert.ok(
  cardStudioAncestors.some((attrs) => /\bdata-obs-panel\b/.test(attrs)),
  "the field card opener is the one that can be hidden — that is why the rail has one",
);

// The rail button is an action, not a lens. If it carried `data-obs-lens` the
// density toggle would treat it as a panel switch.
const railButton = markup.match(/<button[^>]*id=["']obs-rail-studio["'][^>]*>/);
assert.ok(railButton, "the rail studio button should be a <button>");
assert.doesNotMatch(
  railButton[0],
  /\bdata-obs-lens\b/,
  "the studio opener must not be a lens toggle",
);
assert.match(
  railButton[0],
  /aria-label\s*=\s*["'][^"']+["']/,
  "an icon-only rail button needs an accessible name",
);

// Both openers are wired to the same thing.
assert.match(
  observatory,
  /for \(const id of \["obs-create-form", "obs-rail-studio"\]\)[\s\S]{0,120}setStudioOpen\(true\)/,
  "both openers should be bound to setStudioOpen(true)",
);

// Hiding is scoped to lensed panels, and the "hide everything" toggle only
// ever walks PANEL_LENSES — so neither can reach the rail.
assert.match(
  observatory,
  /querySelectorAll\(`\[data-obs-panel="\$\{lens\}"\]`\)[\s\S]{0,200}classList\.toggle\("obs-lens-hidden", !visible\)/,
  "obs-lens-hidden should only ever be applied to [data-obs-panel] elements",
);
const hiddenApplications = observatory.match(/classList\.toggle\("obs-lens-hidden"/g) ?? [];
assert.equal(
  hiddenApplications.length,
  1,
  "one place should own applying obs-lens-hidden, so this invariant stays checkable",
);
assert.match(
  observatory,
  /element\("obs-density-toggle"\)\.addEventListener\("click", \(\) => \{[\s\S]{0,320}for \(const lens of PANEL_LENSES\)/,
  "the density toggle should only walk PANEL_LENSES",
);
assert.doesNotMatch(
  observatory,
  /obs-rail[^\n]*obs-lens-hidden|obs-lens-hidden[^\n]*obs-rail/,
  "nothing should hide the rail with the lens class",
);

// The rail itself is not a panel, so no lens names it.
const railAncestors = ancestorsOf(markup, "obs-rail-hint");
assert.notEqual(railAncestors, null);
for (const attrs of railAncestors) {
  assert.doesNotMatch(
    attrs,
    /\bdata-obs-panel\b/,
    "the instrument rail must stay outside the lensed panels",
  );
}

// And it is not hidden by CSS in any state the lens machinery produces.
assert.match(css, /\.obs-rail-action\s*\{/, "the rail action needs its own styling");
for (const rule of css.split("}")) {
  const brace = rule.lastIndexOf("{");
  if (brace === -1) continue;
  const selector = rule.slice(0, brace);
  const body = rule.slice(brace + 1);
  // Pseudo-elements are decoration, not the control. The action deliberately
  // suppresses the lens-state dot the six toggles draw in `::before`.
  if (selector.includes("::")) continue;
  // The container, the buttons and the action itself. Not `-hint`, which is a
  // tooltip and is correctly hidden until it is hovered.
  if (!/\.obs-rail(?![\w-])|\.obs-rail-(button|action)(?![\w-])/.test(selector)) {
    continue;
  }
  assert.doesNotMatch(
    body,
    /(visibility:\s*hidden|display:\s*none)/,
    `the rail must never be styled away — "${selector.trim()}" does`,
  );
}

console.log("observatory-studio-reachable-static.test.mjs passed");
