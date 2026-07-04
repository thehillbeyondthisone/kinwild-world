// QA-009: this file checks HTML markup, CSS selectors, and DOM button-sync
// wiring inside ui.js's initUi() closures — no pure logic to extract (the
// stroll/fly-mode predicates themselves are covered behaviorally in
// tests/main-view-fly-mode-static.test.mjs). Stays a source-text assertion.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const uiSource = ["ui.js","ui/context.js","ui/constants.js","ui/storage.js","ui/settings-panel.js","ui/help-panel.js","ui/catalog-panel.js","ui/locator-panel.js","ui/first-person.js","ui/photo-mode.js","ui/input.js"].map((p) => readFileSync(new URL("../src/" + p, import.meta.url), "utf8")).join("\n");

assert(
  indexSource.includes('id="stroll-toggle"')
    && indexSource.includes('aria-label="enter first-person stroll"')
    && indexSource.includes('class="pov-icon"'),
  'The footer controls should expose first-person stroll as an icon button without requiring the help panel.'
);

assert(
  !indexSource.includes('<span class="pov-glyph">POV</span>')
    && !indexSource.includes('<span class="pov-label">stroll</span>'),
  'The first-person stroll toggle should not show POV/stroll text in the HUD.'
);

assert(
  indexSource.includes('id="fly-toggle"')
    && indexSource.includes('aria-label="enter fly camera"')
    && indexSource.includes('<span class="fly-option fly-option-orbit">orbit</span>')
    && indexSource.includes('<span class="fly-option fly-option-fly">fly</span>'),
  'The footer controls should expose orbit/fly mode without requiring the help panel or settings panel.'
);

assert(
  uiSource.includes('const strollToggle = document.getElementById("stroll-toggle");')
    && uiSource.includes('strollToggle.classList.toggle("active", on);')
    && uiSource.includes('strollToggle.setAttribute("aria-pressed", on ? "true" : "false");')
    && uiSource.includes('strollToggle.addEventListener("click", () => {')
    && uiSource.includes('syncStrollButton();'),
  'The visible POV control should share the same stroll state and sync path as the settings button and F key.'
);

assert(
  uiSource.includes('const flyToggle = document.getElementById("fly-toggle");')
    && uiSource.includes('flyToggle.classList.toggle("active", on);')
    && uiSource.includes('flyToggle.setAttribute("aria-pressed", on ? "true" : "false");')
    && uiSource.includes('flyToggle.dataset.mode = on ? "fly" : "orbit";')
    && uiSource.includes('flyToggle.addEventListener("click", () => {')
    && uiSource.includes('syncFlyModeButton();'),
  'The visible fly control should share the same fly-camera state and sync path as the settings button and V key.'
);

assert(
  cssSource.includes('.mode-toggle')
    && cssSource.includes('.pov-toggle')
    && cssSource.includes('.fly-toggle')
    && cssSource.includes('.pov-toggle.active')
    && cssSource.includes('.fly-toggle.active')
    && cssSource.includes('.pov-icon')
    && cssSource.includes('padding: 0 24px;')
    && cssSource.includes('grid-template-columns: repeat(5, 44px) minmax(76px, 1.2fr);')
    && cssSource.includes('#regen-same-biome')
    && cssSource.includes('#regen-random-biome'),
  'The visible mode controls should have desktop padding and collapse into a balanced mobile grid.'
);
