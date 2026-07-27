// Browsers stop firing requestAnimationFrame in a backgrounded or
// non-compositing tab. Every world-gen phase awaits nextGenerationFrame(), so
// a bare rAF promise parks generation forever behind the loading overlay —
// the user sees "growing a living field" until they focus the tab. This test
// runs a full generateWorld with an rAF that never fires and asserts the world
// still builds and the loading state still balances.
import assert from 'node:assert/strict';
import * as THREE from 'three';

installHeadlessGlobals();

let rafRequests = 0;
// The whole point: rAF is registered but never invoked, exactly as it behaves
// in a tab that is not compositing frames.
globalThis.requestAnimationFrame = () => {
  rafRequests += 1;
  return rafRequests;
};
globalThis.cancelAnimationFrame = () => {};

const worldMod = await import('../src/world.js');
const { state: freshState } = await import(`../src/state.js?background=${Date.now()}`);

const loadingCalls = [];
const context = worldMod.createWorldBuildContext({
  state: freshState,
  scene: new THREE.Scene(),
  controls: {},
  releaseFollow() {},
  setLoading: (on) => loadingCalls.push(on),
  dispatchWorldReady() {},
  writeSeed() {},
});

// Fail instead of hanging the suite if the fallback ever regresses. The guard
// timer is unref'd, so with nothing else holding the loop open node's own
// unsettled-top-level-await detection usually fires first (exit 13, pointing
// at the await below); the race is the backstop for when a stray timer keeps
// the process alive.
const generation = worldMod.generateWorld(0x1234, context);
await Promise.race([
  generation,
  new Promise((_, reject) =>
    setTimeout(
      () => reject(new Error('generateWorld never settled without requestAnimationFrame — the timer fallback in nextGenerationFrame is gone')),
      15000,
    ).unref(),
  ),
]);

assert.ok(rafRequests > 0, 'generation should still prefer requestAnimationFrame when it is available');
assert.ok(freshState.world.children.length > 0, 'the world should build even though no animation frame ever fired');
assert.deepEqual(loadingCalls, [true, false], 'the loading overlay should still be raised and lowered exactly once');
assert.equal(freshState.isGeneratingWorld, false, 'generation should release its in-progress flag');

console.log('world-generation-background-tab.test.mjs passed');

// ---------------------------------------------------------------------------
// Headless globals — same pattern as world-loading-async-static.test.mjs /
// world-build-context.test.mjs; duplicated locally so this test has no
// dependency on another test file's internals.
// ---------------------------------------------------------------------------
function installHeadlessGlobals() {
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
