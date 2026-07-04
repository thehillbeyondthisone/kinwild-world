// QA-009: converts the pure biome-stepping invariant from a source grep to a
// real import-and-assert behavioral check. Everything else here is DOM/HTML
// wiring (button ids, help copy, guarded regen flow) that only exists inside
// ui.js's initUi()/wireRegenButton() closures — those require a full browser
// DOM to exercise, so they stay as source-text assertions (kept minimal,
// commented at each assertion) rather than being dropped.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const htmlSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const uiSource = ["ui.js","ui/context.js","ui/constants.js","ui/storage.js","ui/settings-panel.js","ui/help-panel.js","ui/catalog-panel.js","ui/locator-panel.js","ui/first-person.js","ui/photo-mode.js","ui/input.js"].map((p) => readFileSync(new URL("../src/" + p, import.meta.url), "utf8")).join("\n");
const styleSource = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

const { nextEnabledBiomeIdFrom } = await import('../src/ui/constants.js');

// Protected invariant: next-biome regeneration steps through the *enabled*
// biome list in order and wraps around; it never returns a disabled biome or
// falls off the end of the array.
{
  const enabled = [{ id: 'meadow' }, { id: 'desert' }, { id: 'tundra' }];
  assert.equal(nextEnabledBiomeIdFrom(enabled, 'meadow'), 'desert', 'should step to the next enabled biome');
  assert.equal(nextEnabledBiomeIdFrom(enabled, 'tundra'), 'meadow', 'should wrap around after the last enabled biome');
  assert.equal(nextEnabledBiomeIdFrom(enabled, 'not-enabled'), 'meadow', 'an unrecognized current id should fall back to the first enabled biome');
  assert.equal(nextEnabledBiomeIdFrom([], 'meadow'), null, 'no enabled biomes should return null rather than throwing');
}

assert(
  htmlSource.includes('id="regen-same-biome"') && htmlSource.includes('same biome'),
  'HUD should include a same-biome regenerate button.'
);
assert(
  htmlSource.includes('id="regen-random-biome"') && htmlSource.includes('next biome'),
  'HUD should include a next-biome regenerate button.'
);
assert(
  !htmlSource.includes('id="regen"'),
  'The old single regenerate button id should be replaced by explicit split-button ids.'
);
// DOM wiring: pickSameBiomeSeed/pickRandomBiomeSeed live inside initUi() and
// call the shared nextEnabledBiomeIdFrom helper asserted above.
assert(
  uiSource.includes('ctx.pickSameBiomeSeed =')
    && uiSource.includes('allowedBiomeIds: state.currentBiome ? [state.currentBiome.id] : undefined'),
  'Same-biome regeneration should constrain newRandomSeed to the current biome id.'
);
assert(
  uiSource.includes('ctx.pickRandomBiomeSeed =')
    && uiSource.includes('function nextEnabledBiomeId(currentBiomeId)')
    && uiSource.includes('const nextId = nextEnabledBiomeId(state.currentBiome?.id);')
    && uiSource.includes('allowedBiomeIds: nextId ? [nextId] : undefined'),
  'Next-biome regeneration should call the shared biome-stepping helper and thread its result into newRandomSeed.'
);
assert(
  uiSource.includes('wireRegenButton("regen-same-biome", () => ctx.pickSameBiomeSeed())')
    && uiSource.includes('wireRegenButton("regen-random-biome", () => ctx.pickRandomBiomeSeed())'),
  'Both regenerate buttons should be wired through the shared guarded regen flow.'
);
assert(
  uiSource.includes('document.getElementById("regen-random-biome").click()'),
  'Keyboard and auto-regenerate flows should use the ordered next-biome button behavior.'
);
assert(
  htmlSource.includes('next biome steps through enabled biomes; same biome stays current'),
  'Biome filter hint should explain that next-biome regeneration steps through enabled biome filters.'
);
assert(
  htmlSource.includes('stays in the current biome, ignoring biome-filter chips')
    && htmlSource.includes('steps to the next enabled biome')
    && htmlSource.includes('regenerate with the next-biome button behavior'),
  'Help panel should explain how same-biome, next-biome, and keyboard regeneration differ.'
);
assert(
  styleSource.includes('.regen-label { display: none; }'),
  'Very narrow viewports should hide regenerate button labels to avoid overflowing the controls row.'
);
