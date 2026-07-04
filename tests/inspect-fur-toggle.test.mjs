// Regression checks for the inspect-mode fur/color override plumbing
// (QA-023 port of tests/test_inspect_fur_toggle_static.py).
//
// The creature/caterpillar builders' opts.furry / opts.color handling is
// exported production code with an observable result (group.userData.inspect
// fields), so it's exercised behaviorally via makeCreature/makeCaterpillar.
// Everything else this file covers — inspect.js's URL-param parsing/writing,
// its keydown handler, ui.js's shift-click link builder, and main.js's
// INSPECT-gated initUi() call — is DOM/URL wiring evaluated at import time or
// inside a browser event handler that this headless suite has no way to
// drive without a real window/document, so those stay readFileSync greps
// pinning the exact invariant, same as the original Python file.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.__APP_VERSION__ = 'test';
globalThis.window = {
  location: { search: '' },
  matchMedia: () => ({ matches: false }),
};
Object.defineProperty(globalThis, 'navigator', {
  value: { maxTouchPoints: 0 },
  configurable: true,
});

const { BIOMES } = await import('../src/biomes.js');
const { makeCreature } = await import('../src/fauna/creature.js');
const { makeCaterpillar } = await import('../src/fauna/caterpillar.js');
const THREE = await import('three');

const biome = BIOMES.find((b) => (b.furProbability ?? 0) === 0 && b.creatureKind !== 'fish') ?? BIOMES[0];

// test_creature_builders_support_inspect_fur_override
{
  const furredWalker = makeCreature(biome, { furry: true });
  assert.equal(furredWalker.group.userData.inspect.fur, '1', 'opts.furry: true should force fur shells on a walker');

  const bareWalker = makeCreature(biome, { furry: false });
  assert.equal(bareWalker.group.userData.inspect.fur, '0', 'opts.furry: false should force fur shells off a walker');

  const furredCaterpillar = makeCaterpillar(biome, { furry: true });
  assert.equal(furredCaterpillar.group.userData.inspect.fur, '1', 'opts.furry: true should force fur shells on a caterpillar');

  const bareCaterpillar = makeCaterpillar(biome, { furry: false });
  assert.equal(bareCaterpillar.group.userData.inspect.fur, '0', 'opts.furry: false should force fur shells off a caterpillar');
}

// test_shift_click_and_fur_toggle_preserve_creature_color (creature.js/caterpillar.js half)
{
  const color = new THREE.Color(0x336699);
  const walker = makeCreature(biome, { color });
  assert.equal(walker.group.userData.inspect.color, color.getHexString(), 'opts.color should be preserved onto the walker userData for a shift-click round trip');

  const caterpillar = makeCaterpillar(biome, { color });
  assert.equal(caterpillar.group.userData.inspect.color, color.getHexString(), 'opts.color should be preserved onto the caterpillar userData for a shift-click round trip');
}

// The remaining assertions target URL-param parsing/writing and DOM event
// wiring in inspect.js/ui.js/main.js, none of which run outside a browser.
{
  const inspectSrc = readFileSync(new URL('../src/inspect.js', import.meta.url), 'utf8');
  const uiSrc = ["ui.js","ui/context.js","ui/constants.js","ui/storage.js","ui/settings-panel.js","ui/help-panel.js","ui/catalog-panel.js","ui/locator-panel.js","ui/first-person.js","ui/photo-mode.js","ui/input.js"].map((p) => readFileSync(new URL("../src/" + p, import.meta.url), "utf8")).join("\n");
  const mainSrc = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  const styleSrc = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

  // test_inspect_url_accepts_and_writes_fur_param
  assert.match(inspectSrc, /&fur=0\|1/);
  assert.match(inspectSrc, /let _furOverride = _parseBoolParam\(_params\.get\("fur"\)\)/);
  assert.match(inspectSrc, /sp\.set\("fur", _inspectFurEnabled \? "1" : "0"\)/);

  // test_inspect_f_key_toggles_forced_fur_and_respawns_specimen
  assert.match(inspectSrc, /e\.key === "f" \|\| e\.key === "F"/);
  assert.match(inspectSrc, /_inspectFurEnabled = !_inspectFurEnabled/);
  assert.match(inspectSrc, /_furOverride = _inspectFurEnabled/);
  assert.match(inspectSrc, /spawnSpecimen\(scene\)/);

  // test_shift_click_inspect_links_include_existing_fur_state
  assert.match(uiSrc, /if \(n\.userData\.inspect\.fur != null\) sp\.set\("fur", n\.userData\.inspect\.fur\)/);

  // test_shift_click_and_fur_toggle_preserve_creature_color (inspect.js/ui.js half)
  assert.match(inspectSrc, /&color=<rrggbb>/);
  assert.match(inspectSrc, /let _colorOverride = _parseColorParam\(_params\.get\("color"\)\)/);
  assert.match(inspectSrc, /sp\.set\("color", _colorOverride\.getHexString\(\)\)/);
  assert.match(inspectSrc, /color: _colorOverride \?\? undefined/);
  assert.match(uiSrc, /if \(n\.userData\.inspect\.color != null\) sp\.set\("color", n\.userData\.inspect\.color\)/);

  // test_normal_ui_shortcuts_are_disabled_in_inspect_mode
  // QA-L01: initUi()'s keydown handler used to carry a redundant
  // `if (INSPECT) return;` guard, but initUi() (which installs that handler)
  // is only ever called when `!INSPECT` — see the next assertion — so the
  // in-function check was unreachable dead code and was removed. Normal UI
  // shortcuts are disabled in inspect mode because initUi() never runs at
  // all in that mode.
  assert.match(uiSrc, /import \{ INSPECT \} from "\.\.\/inspect\.js"/);
  assert.doesNotMatch(uiSrc, /if \(INSPECT\) return;/);

  // test_normal_ui_is_not_initialized_in_inspect_mode
  assert.match(mainSrc, /if \(!INSPECT\) \{\n {2}initUi\(\{ camera, canvas, controls, renderer \}\);\n\}/);
  assert.ok(mainSrc.indexOf('if (!INSPECT)') < mainSrc.indexOf('if (INSPECT) {\n  setupInspect'));

  // test_inspect_key_handler_preempts_page_level_shortcuts
  assert.match(inspectSrc, /\{ capture: true \}/);
  assert.match(inspectSrc, /e\.stopImmediatePropagation\(\);/);
  const fKeyIdx = inspectSrc.indexOf('e.key === "f"');
  assert.ok(
    inspectSrc.indexOf('e.stopImmediatePropagation();') < inspectSrc.indexOf('spawnSpecimen(scene);', fKeyIdx),
    'stopImmediatePropagation must run before spawnSpecimen so page-level shortcuts never see the keystroke'
  );

  // test_inspect_footer_can_fit_the_fur_hint
  assert.match(inspectSrc, /f fur/);
  assert.match(styleSrc, /max-width: calc\(100vw - 32px\);/);
  assert.match(styleSrc, /flex-wrap: wrap;/);
  assert.match(styleSrc, /justify-content: center;/);
}

console.log('inspect-fur-toggle.test.mjs passed');
