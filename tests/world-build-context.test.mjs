// QA-009: exercises the actual isolation contract behaviorally instead of
// grepping for "worldState.X" vs "state.X" text in generateWorld's body.
// Two independent `state` module instances are loaded (the app's real
// singleton, and a second cache-busted instance standing in for a
// non-global scene's state); generateWorld is run against a context built
// from the SECOND instance, and the test asserts the first instance's world
// graph / height function / obstacle list are untouched while the second is
// fully populated — proving generateWorld only mutates state through the
// context, not the global singleton.
//
// Headless DOM/canvas/audio stubs mirror tests/determinism-seed.test.mjs
// (itself mirroring tests/portal-placement-runtime.test.mjs) — the minimal
// set that lets generateWorld run end-to-end under node.
import assert from 'node:assert/strict';
import * as THREE from 'three';

installHeadlessGlobals();

const worldMod = await import('../src/world.js');
const { state: globalState } = await import('../src/state.js');
const { state: freshState } = await import(`../src/state.js?fresh=${Date.now()}`);

assert.notEqual(globalState, freshState, 'test setup should use two distinct state instances');

assert.equal(
  typeof worldMod.createWorldBuildContext, 'function',
  'world.js should expose a build-context factory so world generation can target non-global scenes.'
);

const before = {
  worldChildren: globalState.world.children.length,
  heightFn: globalState.heightFn,
  obstacleCount: globalState.obstacles.length,
  creatureCount: globalState.creatures.length,
  caterpillarCount: globalState.caterpillars.length,
  flowerSpotCount: globalState.flowerSpots.length,
  currentLayout: globalState.currentLayout,
  islandSize: globalState.ISLAND_SIZE,
};

const scene = new THREE.Scene();
const context = worldMod.createWorldBuildContext({
  state: freshState,
  scene,
  controls: {},
  releaseFollow() {},
  setLoading() {},
  dispatchWorldReady() {},
  writeSeed() {},
});

await worldMod.generateWorld(0x3f2a, context);

// Protected invariant: generateWorld binds state/scene/follow-release
// entirely through the passed context and never falls back to the global
// singleton or module-level scene ref for its own bookkeeping fields.
assert.equal(globalState.world.children.length, before.worldChildren, 'the global state singleton\'s world group should be untouched by a context-scoped generateWorld run.');
assert.equal(globalState.heightFn, before.heightFn, 'the global state singleton\'s heightFn should be untouched by a context-scoped generateWorld run.');
assert.equal(globalState.obstacles.length, before.obstacleCount, 'the global state singleton\'s obstacles should be untouched by a context-scoped generateWorld run.');
assert.equal(globalState.creatures.length, before.creatureCount, 'the global state singleton\'s creatures should be untouched by a context-scoped generateWorld run.');
assert.equal(globalState.caterpillars.length, before.caterpillarCount, 'the global state singleton\'s caterpillars should be untouched by a context-scoped generateWorld run.');
assert.equal(globalState.flowerSpots.length, before.flowerSpotCount, 'the global state singleton\'s flowerSpots should be untouched by a context-scoped generateWorld run.');
assert.equal(globalState.currentLayout, before.currentLayout, 'the global state singleton\'s currentLayout should be untouched by a context-scoped generateWorld run.');
assert.equal(globalState.ISLAND_SIZE, before.islandSize, 'the global state singleton\'s ISLAND_SIZE should be untouched by a context-scoped generateWorld run.');

assert.ok(freshState.world.children.length > 0, 'the context-provided state should receive the generated world graph.');
assert.equal(typeof freshState.heightFn, 'function', 'the context-provided state should receive the generated heightFn.');
assert.ok(freshState.obstacles.length > 0, 'the context-provided state should receive generated obstacles.');
assert.ok(freshState.creatures.length > 0, 'the context-provided state should receive generated creatures.');
assert.ok(freshState.flowerSpots.length > 0, 'the context-provided state should receive generated flower spots.');
assert.ok(freshState.currentLayout, 'the context-provided state should receive the generated layout.');
assert.ok(freshState.ISLAND_SIZE > 0, 'the context-provided state should receive the generated island size.');
assert.ok(scene.children.includes(freshState.world), 'the world group should be added to the context-provided scene, not a global scene ref.');

// ---------------------------------------------------------------------------
// Headless globals — minimal stubs that let the app module graph load and
// generateWorld run without a browser. Mirrors the stub pattern in
// tests/determinism-seed.test.mjs / tests/portal-placement-runtime.test.mjs,
// duplicated locally (rather than imported) so this test has no dependency
// on another test file's internals.
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
