// QA-009: startPerfProbe/beginPerfFrame/measurePerfPhase/endPerfFrame
// (src/perfProbe.js) are exercised behaviorally against a synthetic
// state/scene/renderer and a fake requestAnimationFrame loop — mirroring how
// main.js's real animate() loop drives them — instead of grepping their
// source text. main.js itself touches the DOM/WebGL at import time (see
// CLAUDE.md), so its wiring into the render loop stays as a source-text
// assertion.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mainSource = readFileSync(new URL('../main.js', import.meta.url), 'utf8');

globalThis.__APP_VERSION__ = 'test';

// Protected invariant: the probe is a no-op unless ?perf=1 is set.
{
  globalThis.window = { location: { search: '' } };
  const { startPerfProbe, beginPerfFrame, measurePerfPhase, endPerfFrame } =
    await import(`../src/perfProbe.js?disabled=${Date.now()}`);
  startPerfProbe({ state: {}, scene: {}, renderer: {} });
  assert.equal(globalThis.window.__swPerf, undefined, 'the probe should do nothing without ?perf=1');
  // begin/measure/end should still be safe no-ops with no active probe.
  beginPerfFrame();
  const result = measurePerfPhase('x', () => 42);
  endPerfFrame();
  assert.equal(result, 42, 'measurePerfPhase should still call through and return the function result when no probe is collecting');
}

// Protected invariant: with ?perf=1, the probe waits for the world to settle,
// samples real per-frame CPU phase timings driven through
// beginPerfFrame/measurePerfPhase/endPerfFrame, and publishes a report with a
// shadow-caster/LOD breakdown on window.__swPerf.
{
  globalThis.window = { location: { search: '?perf=1&perfFrames=3&perfSettle=0' } };
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 1);
  globalThis.performance = { now: () => Date.now() };

  const { startPerfProbe, beginPerfFrame, measurePerfPhase, endPerfFrame } =
    await import(`../src/perfProbe.js?enabled=${Date.now()}`);

  const state = {
    isGeneratingWorld: false,
    currentBiome: { id: 'meadow', name: 'Meadow', shadowLod: { microFloraShadows: false, leafballCanopyProxy: true, staticCasterRadiusFrac: 0.5 } },
    creatures: [], caterpillars: [], butterflies: [], bees: [], flocks: [], willowisps: [],
    obstacles: [], dynamicObstacles: [], perchSpots: [],
    currentSeed: 0x1234,
    userSettings: { bloom: true, outline: false, ao: false, depthFog: false, tiltShift: false },
    postfx: { isActive: () => true },
  };
  const casterA = { isMesh: true, castShadow: true, userData: { inspect: { variant: 'oak' } }, parent: null };
  const scene = {
    traverse(visit) {
      visit(casterA);
      visit({ isMesh: true, castShadow: false });
    },
  };
  const renderer = { getPixelRatio: () => 1, domElement: { width: 100, height: 100 } };

  startPerfProbe({ state, scene, renderer });

  let running = true;
  function frameLoop() {
    if (!running) return;
    beginPerfFrame();
    measurePerfPhase('render', () => {});
    endPerfFrame();
    requestAnimationFrame(frameLoop);
  }
  requestAnimationFrame(frameLoop);

  await new Promise((resolve) => setTimeout(resolve, 150));
  running = false;

  const report = globalThis.window.__swPerf?.report;
  assert.ok(report, 'a perf report should be published on window.__swPerf once sampling completes');
  assert.equal(report.biomeId, 'meadow');
  assert.equal(report.shadowLod.leafballCanopyProxy, true, 'the report should surface the current biome shadow-LOD flags');
  assert.ok(report.timing.frames >= 3, 'the report should have sampled at least the requested frame count');
  assert.ok(report.phaseTimings.phases.render, 'phase timings collected via measurePerfPhase should appear in the report');
  assert.ok(report.phaseTimings.frames > 0, 'per-frame CPU phase timings should have been captured, not just scene counts');
  assert.equal(report.scene.shadowCastersByParentVariant.oak, 1, 'shadow casters should be classified by their ancestor inspect variant');
}

assert(
  mainSource.includes('from "./src/perfProbe.js";')
    && mainSource.includes('startPerfProbe')
    && mainSource.includes('startPerfProbe({ state, scene, renderer });'),
  'main.js should wire the perf probe into the existing scene debug surface.'
);

assert(
  mainSource.includes('beginPerfFrame();')
    && mainSource.includes('endPerfFrame();')
    && mainSource.includes('measurePerfPhase("dynamicCollisionObstacles"')
    && mainSource.includes('measurePerfPhase("creatureMovement"')
    && mainSource.includes('measurePerfPhase("caterpillarMovement"')
    && mainSource.includes('measurePerfPhase("airborneMovement"')
    && mainSource.includes('measurePerfPhase("environmentAnimation"')
    && mainSource.includes('measurePerfPhase("render"'),
  'The animation loop should profile collision, movement, environment, and render buckets separately.'
);
