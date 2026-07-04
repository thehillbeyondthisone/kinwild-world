// QA-009: the async loading-state contract (isGeneratingWorld / setLoading
// toggling around the actual async generateWorld run) is exercised
// behaviorally by running generateWorld and recording context.setLoading
// calls, instead of grepping for the literal call sites. The loading-screen
// markup/CSS (index.html/style.css) is presentation-only with no behavior to
// invoke; main.js's render-loop pause and URL-biome-preserving boot sequence
// only exist inside a module that touches the DOM/WebGL at import time (see
// CLAUDE.md) — those stay as source-text assertions.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

const htmlSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const styleSource = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const stateSource = readFileSync(new URL('../src/state.js', import.meta.url), 'utf8');

assert(
  htmlSource.includes('id="world-loading"')
    && htmlSource.includes('aria-live="polite"')
    && htmlSource.includes('Crafting new world'),
  'The page should include an accessible loading screen with the requested copy.'
);

assert(
  styleSource.includes('.world-loading')
    && styleSource.includes('.world-loading.is-visible')
    && styleSource.includes('z-index: 40'),
  'The loading screen should cover the viewport while world generation is active.'
);

assert(
  stateSource.includes('isGeneratingWorld: false'),
  'Shared state should expose whether async world generation is in progress.'
);

installHeadlessGlobals();
const worldMod = await import('../src/world.js');
const { state: freshState } = await import(`../src/state.js?loading=${Date.now()}`);

const loadingCalls = [];
const scene = new THREE.Scene();
const context = worldMod.createWorldBuildContext({
  state: freshState,
  scene,
  controls: {},
  releaseFollow() {},
  setLoading: (on) => loadingCalls.push(on),
  dispatchWorldReady() {},
  writeSeed() {},
});

assert.equal(freshState.isGeneratingWorld, false, 'isGeneratingWorld should start false');
const runPromise = worldMod.generateWorld(0x1234, context);
// generateWorld sets isGeneratingWorld/calls setLoading(true) synchronously
// before its first await, so it should already be true here.
assert.equal(freshState.isGeneratingWorld, true, 'isGeneratingWorld should flip true as soon as generation starts');

await runPromise;

// Protected invariant: loading state is signaled exactly once true→false
// around the async build, and world generation actually completes.
assert.deepEqual(loadingCalls, [true, false], 'context.setLoading should be called true then false exactly once around generation.');
assert.equal(freshState.isGeneratingWorld, false, 'isGeneratingWorld should flip back to false once generation completes');
assert.ok(freshState.world.children.length > 0, 'the world should have actually been generated');

assert(
  mainSource.includes('state.isGeneratingWorld || isSelectingCreature() || isManualPaused()')
    && mainSource.includes('readBiomeFromUrl')
    && mainSource.includes('void generateWorld(initialSeed, undefined, { biomeId: readBiomeFromUrl() }).then'),
  'The animation loop should pause simulation during generation and boot should not block on generation or ignore URL biome overrides.'
);

assert(
  uiSource.includes('setTimeout(async () =>')
    && uiSource.includes('await generateWorld(pickSeed())')
    && uiSource.includes('text.addEventListener("click", async () =>')
    && uiSource.includes('await generateWorld(bm.seed)')
    && uiSource.includes('void generateWorld(s, undefined, { biomeId: readBiomeFromUrl() }).catch'),
  'Regenerate, bookmarks, and browser history should use the async generation API and preserve URL biome overrides.'
);

// ---------------------------------------------------------------------------
// Headless globals — see tests/world-build-context.test.mjs / determinism-
// seed.test.mjs for the same pattern; duplicated locally so this test has no
// dependency on another test file's internals.
// ---------------------------------------------------------------------------
function installHeadlessGlobals() {
  if (globalThis.__headlessInstalled) return;
  globalThis.__headlessInstalled = true;
  globalThis.__APP_VERSION__ = 'test';
  globalThis.window = {
    location: { search: '', hash: '' },
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
    dispatchEvent() {},
    CustomEvent: function () {},
    devicePixelRatio: 1,
    innerWidth: 1280,
    innerHeight: 720,
  };
  function gradient() {
    return { addColorStop() {} };
  }
  const ctx2d = new Proxy(
    {
      createRadialGradient: () => gradient(),
      createLinearGradient: () => gradient(),
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      getContextAttributes: () => ({ alpha: true }),
    },
    { get(target, prop) { return prop in target ? target[prop] : () => null; } }
  );
  function stubEl() {
    return {
      textContent: '',
      style: {},
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      appendChild() {},
      removeChild() {},
      setAttribute() {},
      dataset: {},
      getContext: () => ctx2d,
    };
  }
  globalThis.document = {
    getElementById: () => stubEl(),
    createElement: () => stubEl(),
    body: { classList: { contains() { return false; }, add() {}, remove() {} } },
    documentElement: { style: {} },
  };
  globalThis.performance = { now: () => 0 };
  globalThis.history = { replaceState() {} };
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  globalThis.Audio = function () {
    return {
      play() { return Promise.resolve(); },
      pause() {},
      load() {},
      addEventListener() {},
      removeEventListener() {},
    };
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: { maxTouchPoints: 0, userAgent: 'node' },
    configurable: true,
  });
}
