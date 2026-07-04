// Behavioral regression test (QA-023 port of
// tests/test_sleeping_creature_hover_static.py) for waking sleeping/drowsy
// creatures.
//
// wakeCreature is exported and drives the real waking transitions, so its
// behavior is exercised directly rather than grepped. sleepinessTarget stays
// module-private (creature.js), but its "alert window forces sleepiness back
// to 0 after waking" contract — the one behavior the original test cared
// about — is observable through stepCreature: a freshly-woken creature must
// not re-curl even under a full night factor, for both walkers and fliers
// (the two paths QA-010 deduped onto the shared helper).
//
// The UI hover-wake handler lives inside initUi()'s DOM event wiring in
// ui.js, which isn't callable outside a real DOM; that assertion stays a
// grep with a comment.

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
const { makeCreature, stepCreature, wakeCreature } = await import('../src/fauna/creature.js');
const { state } = await import('../src/state.js');

const walkerBiome = BIOMES.find((b) => b.creatureKind !== 'fish') ?? BIOMES[0];

// test_wake_creature_handles_drowsy_landed_fliers
{
  const originalRandom = Math.random;
  Math.random = () => 0; // forces flies = true deterministically
  const flier = makeCreature(walkerBiome, {});
  Math.random = originalRandom;
  assert.equal(flier.flies, true, 'test setup requires a flying creature');
  assert.equal(flier.isFish, false, 'test setup requires a non-fish flier');

  for (const landState of ['landed', 'descending']) {
    flier.landState = landState;
    flier.sleepiness = 0.5; // drowsy
    flier.isSleeper = false;
    flier.age = 10;

    wakeCreature(flier);

    assert.equal(flier.landState, 'ascending', `a drowsy flier landState="${landState}" should be woken into ascending`);
    assert.equal(flier.sleepiness, 0, 'waking should clear sleepiness');
    assert.ok(flier.alertUntil > flier.age, 'waking should arm an alert window in the future');
  }
}

// test_wake_creature_ignores_non_sleeping_non_drowsy_creatures
{
  const originalRandom = Math.random;
  Math.random = () => 0.5; // forces flies = false
  const walker = makeCreature(walkerBiome, {});
  Math.random = originalRandom;
  assert.equal(walker.flies, false, 'test setup requires a ground-walking creature');

  walker.isSleeper = false;
  walker.sleepiness = 0;
  walker.alertUntil = undefined;
  wakeCreature(walker);
  assert.equal(walker.alertUntil, undefined, 'waking a creature that is neither sleeping, drowsy, nor a spawned sleeper should be a no-op');
}

// test_wake_creature_alert_window_keeps_walkers_and_fliers_from_re_curling
// (behavioral replacement for the sleepinessTarget alert-window assertions,
// exercised for both the walker and flier code paths per QA-010's dedup.)
{
  const flatHeightFn = () => 0;
  state.waterMesh = null;
  state.currentBiome = walkerBiome;
  state.nightFactor = 1; // full night — without the alert window this would drive sleepiness up

  const originalRandom = Math.random;

  Math.random = () => 0.5; // ground walker
  const walker = makeCreature(walkerBiome, {});
  Math.random = originalRandom;
  walker.isSleeper = true;
  wakeCreature(walker);
  for (let i = 0; i < 50; i++) stepCreature(walker, 0.1, i * 0.1, flatHeightFn);
  assert.ok(walker.sleepiness < 0.05, 'a freshly-woken walker should stay alert (not re-curl) under a full night factor');

  Math.random = () => 0; // flier
  const flier = makeCreature(walkerBiome, {});
  Math.random = originalRandom;
  flier.flies && (flier.isFish = false);
  flier.sleepiness = 0.5;
  flier.landState = 'landed';
  wakeCreature(flier);
  for (let i = 0; i < 50; i++) stepCreature(flier, 0.1, i * 0.1, flatHeightFn);
  assert.ok(flier.sleepiness < 0.05, 'a freshly-woken flier should stay alert (not re-curl) under a full night factor');
}

// test_hover_wakes_visible_sleeping_or_drowsy_creatures
// The hover-to-wake handler is DOM event wiring installed inside initUi(),
// which requires a full browser DOM to invoke — not something this headless
// suite can drive. Pinning the "looksAsleep" condition and its wakeCreature
// call site by source is the direct way to protect it.
{
  const uiSrc = ["ui.js","ui/context.js","ui/constants.js","ui/storage.js","ui/settings-panel.js","ui/help-panel.js","ui/catalog-panel.js","ui/locator-panel.js","ui/first-person.js","ui/photo-mode.js","ui/input.js"].map((p) => readFileSync(new URL("../src/" + p, import.meta.url), "utf8")).join("\n");
  assert.match(uiSrc, /const looksAsleep =/);
  assert.match(uiSrc, /c\.isSleeper \|\|/);
  assert.match(uiSrc, /\(!c\.flies && c\.sleepiness > 0\.4\) \|\|/);
  assert.match(uiSrc, /\(c\.flies && !c\.isFish && c\.sleepiness > 0\.4\)/);
  assert.match(uiSrc, /if \(looksAsleep\) \{/);
  assert.match(uiSrc, /if \(!furOnly\) wakeCreature\(c\)/);
}

console.log('sleeping-creature-hover.test.mjs passed');
