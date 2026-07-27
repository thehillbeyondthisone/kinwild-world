// QA-009: finalizeWorldHud (src/world-hud.js) is import-and-assert tested by
// actually running it against a synthetic worldState and a recording
// document stub, instead of grepping the ground/fly/swim computation and
// DOM writes out of its source text. Markup/CSS shape (element ids, HUD
// readability tokens) and the "field notes" eyebyrow wiring only exist as
// static HTML/CSS or as closures inside ui.js's initUi(), which require a
// full browser DOM to exercise — those stay as source-text assertions.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.__APP_VERSION__ = 'test';
globalThis.performance = { now: () => 0 };

function makeDocumentStub() {
  const elements = new Map();
  function elFor(id) {
    if (!elements.has(id)) elements.set(id, { textContent: '' });
    return elements.get(id);
  }
  globalThis.document = {
    getElementById(id) {
      // Mirror real DOM: elements not present in this synthetic HUD return
      // null (finalizeWorldHud guards those with `if (el) ...`); the core
      // ground/fly/swim/etc ids are always present.
      const alwaysPresent = new Set([
        'biome-name', 'biome-sub', 'ground-creature-count', 'fly-creature-count',
        'swim-creature-count', 'flora-count', 'bird-count', 'seed',
      ]);
      const optional = new Set([
        'island-name', 'help-biome', 'help-island-name', 'help-seed',
        'help-ground-creatures', 'help-fly-creatures', 'help-swim-creatures',
        'help-flora', 'help-birds',
      ]);
      if (alwaysPresent.has(id) || optional.has(id)) return elFor(id);
      return null;
    },
  };
  return elements;
}

const { finalizeWorldHud } = await import('../src/world-hud.js');

const elements = makeDocumentStub();

const worldState = {
  creatures: [
    { flies: false, isFish: false }, // ground walker
    { flies: false, isFish: false }, // ground walker
    { flies: true, isFish: false },  // flier
    { flies: false, isFish: true },  // fish (ground/fly excluded, swim included)
    { flies: true, isFish: true },   // fish that also flies — counts only as swim
  ],
  caterpillars: [{}, {}],
  obstacles: [],
  userSettings: { autoRotate: true },
};
// Give every creature a colorBucket for the herding-bucket pass.
for (const c of worldState.creatures) c.colorBucket ??= 'default';

let dispatched = false;
let writtenSeed = null;
const context = {
  dispatchWorldReady: () => { dispatched = true; },
  writeSeed: (seed, opts) => { writtenSeed = { seed, opts }; },
};

finalizeWorldHud({
  worldState,
  biome: { name: 'Verdant Grove', sub: 'a gentle glade' },
  seed: 0x3f2a,
  forcedBiome: null,
  worldControls: null,
  context,
  placed: 42,
  totalBirds: 7,
});

// Protected invariant: ground = walkers + caterpillars (non-flier, non-fish),
// fly = fliers excluding fish, swim = fish (regardless of flies) — no
// creature is silently double- or un-counted, and stats are zero-padded.
assert.equal(elements.get('ground-creature-count').textContent, '04', 'ground count should be 2 walkers + 2 caterpillars');
assert.equal(elements.get('fly-creature-count').textContent, '01', 'fly count should exclude fish that also fly');
assert.equal(elements.get('swim-creature-count').textContent, '02', 'swim count should include every fish regardless of the flies flag');
assert.equal(elements.get('flora-count').textContent, '42', 'flora count should be zero-padded');
assert.equal(elements.get('bird-count').textContent, '07', 'bird count should be zero-padded');
assert.equal(elements.get('biome-name').textContent, 'Verdant Grove');
assert.equal(elements.get('seed').textContent, elements.get('help-seed').textContent, 'mobile help should mirror the main HUD seed text');
assert.equal(elements.get('help-ground-creatures').textContent, '04', 'mobile help should mirror the split ground count');
assert.equal(elements.get('help-fly-creatures').textContent, '01', 'mobile help should mirror the split fly count');
assert.equal(elements.get('help-swim-creatures').textContent, '02', 'mobile help should mirror the split swim count');
assert.equal(dispatched, true, 'world-ready should be dispatched through the context');
assert.deepEqual(writtenSeed, { seed: 0x3f2a, opts: { biomeId: null } }, 'seed should be written back through the context with no forced-biome override');
assert.equal(worldState.creatureColorBuckets.default.length, worldState.creatures.length, 'creature color buckets should be built for herding lookups');
assert.ok(worldState.revealStart >= 0, 'reveal animation timestamp should be armed');

// The remaining checks are static HTML/CSS/ui.js wiring that cannot run
// without a full browser DOM.
const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const uiSource = ["ui.js","ui/context.js","ui/constants.js","ui/storage.js","ui/settings-panel.js","ui/help-panel.js","ui/catalog-panel.js","ui/locator-panel.js","ui/first-person.js","ui/photo-mode.js","ui/input.js"].map((p) => readFileSync(new URL("../src/" + p, import.meta.url), "utf8")).join("\n");
const cssSource = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

assert(
  indexSource.includes('<span class="label">ground</span>')
    && indexSource.includes('id="ground-creature-count"')
    && indexSource.includes('<span class="label">fly</span>')
    && indexSource.includes('id="fly-creature-count"')
    && indexSource.includes('<span class="label">swim</span>')
    && indexSource.includes('id="swim-creature-count"')
    && !indexSource.includes('id="creature-count"')
    && !indexSource.includes('id="elevation"'),
  'bottom HUD should split the old creature stat into ground, fly, and swim counters without the elevation stat.'
);

assert(
  indexSource.includes('<dt>ground</dt><dd id="help-ground-creatures">00</dd>')
    && indexSource.includes('<dt>fly</dt><dd id="help-fly-creatures">00</dd>')
    && indexSource.includes('<dt>swim</dt><dd id="help-swim-creatures">00</dd>')
    && !indexSource.includes('id="help-creatures"')
    && !indexSource.includes('id="help-elevation"'),
  'mobile help world stats should mirror the split creature counters without elevation.'
);

assert(
  cssSource.includes('.stats .label,')
    && cssSource.includes('.stats .value {')
    && cssSource.includes('color: var(--ink);')
    && cssSource.includes('opacity: 1;')
    && cssSource.includes('text-shadow: var(--hud-text-shadow);'),
  'bottom HUD stats text should be fully opaque with the shared readability shadow.'
);

assert(
  cssSource.includes('.eyebrow,')
    && cssSource.includes('.eyebrow-button,')
    && cssSource.includes('.eyebrow-link {')
    && cssSource.includes('color: var(--ink);')
    && cssSource.includes('opacity: 1;'),
  'top field-notes/version text should be fully opaque.'
);

assert(
  indexSource.includes('<button class="eyebrow-button" id="locator-eyebrow" type="button">life index</button>')
    && uiSource.includes('const locatorEyebrow = document.getElementById("locator-eyebrow")')
    && uiSource.includes('locatorEyebrow?.addEventListener("click", () => setLocatorOpen(!ctx.locatorOpen))'),
  'Kinwild life-index eyebrow text should open the creature/flora locator.'
);
