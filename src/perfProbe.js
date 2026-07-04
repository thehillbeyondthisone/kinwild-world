// ?perf=1 performance probe: waits for the world to settle, then samples N frame
// timings (?perfFrames, ?perfSettle) plus optional per-phase breakdowns wired in
// by main.js via beginPerfFrame / measurePerfPhase / endPerfFrame. startPerfProbe
// kicks off the async run and publishes the result on window.__swPerf (and logs
// "[small-world:perf]") for automated capture. No-op unless ?perf=1 is set, so the
// instrumentation hooks stay cheap (early-out on activeProbe) in normal runs.
function getSearchParams() {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search);
}

function isPerfProbeEnabled() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("perf") === "1";
}

function readPositiveIntParam(params, key, fallback) {
  const value = Number.parseInt(params?.get(key) ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function waitForFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

let activeProbe = null;

/** Start a new per-phase CPU timing frame. No-op unless a probe is actively collecting. */
export function beginPerfFrame() {
  if (!activeProbe?.collecting) return;
  activeProbe.currentFrame = {
    startedAt: performance.now(),
    phases: {},
  };
}

/**
 * Time a labeled phase of the current perf-probe frame and accumulate it.
 * NB: accumulates elapsed time by `name`, so two phases sharing a label
 * silently merge — keep labels unique. Transparent passthrough (still calls
 * `fn()` and returns its result) when no probe is collecting.
 *
 * @template T
 * @param {string} name - phase label (must be unique per frame to avoid merging)
 * @param {() => T} fn - work to time
 * @returns {T} `fn()`'s return value
 */
export function measurePerfPhase(name, fn) {
  if (!activeProbe?.collecting || !activeProbe.currentFrame) return fn();
  const startedAt = performance.now();
  try {
    return fn();
  } finally {
    const elapsed = performance.now() - startedAt;
    const phases = activeProbe.currentFrame.phases;
    phases[name] = (phases[name] ?? 0) + elapsed;
  }
}

/** Close out the current perf-probe frame and push it onto the sample list. No-op unless collecting. */
export function endPerfFrame() {
  if (!activeProbe?.collecting || !activeProbe.currentFrame) return;
  activeProbe.currentFrame.totalCpuMs = performance.now() - activeProbe.currentFrame.startedAt;
  activeProbe.phaseFrames.push(activeProbe.currentFrame);
  activeProbe.currentFrame = null;
}

function classifyShadowCaster(object) {
  let current = object;
  while (current) {
    const inspect = current.userData?.inspect;
    if (inspect?.variant) return inspect.variant;
    current = current.parent;
  }
  return object.type || "unknown";
}

function countScene(scene) {
  const counts = {
    objects: 0,
    meshes: 0,
    instancedMeshes: 0,
    points: 0,
    lights: 0,
    shadowCasters: 0,
    shadowCastersByParentVariant: {},
    furShells: 0,
  };

  scene.traverse((object) => {
    counts.objects += 1;
    if (object.isMesh) counts.meshes += 1;
    if (object.isInstancedMesh) counts.instancedMeshes += 1;
    if (object.isPoints) counts.points += 1;
    if (object.isLight) counts.lights += 1;
    if (object.userData?.furShell) counts.furShells += 1;

    if (object.castShadow) {
      counts.shadowCasters += 1;
      const key = classifyShadowCaster(object);
      counts.shadowCastersByParentVariant[key] =
        (counts.shadowCastersByParentVariant[key] ?? 0) + 1;
    }
  });

  return counts;
}

function summarizeTimings(timings) {
  const sorted = [...timings].sort((a, b) => a - b);
  const totalMs = timings.reduce((sum, value) => sum + value, 0);
  const avgMs = totalMs / Math.max(1, timings.length);
  const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
  return {
    frames: timings.length,
    durationMs: Number(totalMs.toFixed(2)),
    msPerFrame: Number(avgMs.toFixed(2)),
    fps: Number((1000 / Math.max(0.001, avgMs)).toFixed(1)),
    minMs: Number((sorted[0] ?? 0).toFixed(2)),
    p95Ms: Number(percentile(0.95).toFixed(2)),
    maxMs: Number((sorted[sorted.length - 1] ?? 0).toFixed(2)),
  };
}

function summarizePhaseTimings(phaseFrames) {
  const phaseNames = new Set();
  for (const frame of phaseFrames) {
    for (const phaseName of Object.keys(frame.phases)) {
      phaseNames.add(phaseName);
    }
  }

  const phases = {};
  for (const phaseName of phaseNames) {
    phases[phaseName] = summarizeTimings(
      phaseFrames.map((frame) => frame.phases[phaseName] ?? 0)
    );
  }

  return {
    frames: phaseFrames.length,
    totalCpu: summarizeTimings(phaseFrames.map((frame) => frame.totalCpuMs ?? 0)),
    phases,
  };
}

async function waitForWorld(state, settleFrames) {
  while (state.isGeneratingWorld || !state.currentBiome) {
    await waitForFrame();
  }
  for (let i = 0; i < settleFrames; i += 1) {
    await waitForFrame();
  }
}

async function sampleFrameTimings(frameCount) {
  const timings = [];
  let previous = await waitForFrame();
  while (timings.length < frameCount) {
    const now = await waitForFrame();
    timings.push(now - previous);
    previous = now;
  }
  return timings;
}

function buildReport({ state, scene, renderer, timings, phaseFrames }) {
  const biome = state.currentBiome;
  return {
    seed: state.currentSeed,
    biomeId: biome?.id ?? null,
    biomeName: biome?.name ?? null,
    shadowLod: {
      microFloraShadows: biome?.shadowLod?.microFloraShadows ?? true,
      leafballCanopyProxy: biome?.shadowLod?.leafballCanopyProxy ?? false,
      staticCasterRadiusFrac: biome?.shadowLod?.staticCasterRadiusFrac ?? null,
    },
    timing: summarizeTimings(timings),
    phaseTimings: summarizePhaseTimings(phaseFrames),
    entityCounts: {
      creatures: state.creatures.length,
      caterpillars: state.caterpillars.length,
      butterflies: state.butterflies.length,
      bees: state.bees.length,
      flocks: state.flocks.length,
      willowisps: state.willowisps.length,
      staticObstacles: state.obstacles.length,
      dynamicObstacles: state.dynamicObstacles.length,
      perchSpots: state.perchSpots.length,
    },
    renderer: {
      pixelRatio: renderer.getPixelRatio(),
      width: renderer.domElement?.width ?? 0,
      height: renderer.domElement?.height ?? 0,
    },
    fx: {
      active: state.postfx?.isActive?.() ?? false,
      bloom: state.userSettings.bloom,
      outline: state.userSettings.outline,
      ao: state.userSettings.ao,
      depthFog: state.userSettings.depthFog,
      tiltShift: state.userSettings.tiltShift,
    },
    grass: state.grass
      ? {
          count: state.grass.mesh?.count ?? 0,
          stockCount: state.grass.stockCount ?? 0,
          maxPlaced: state.grass.maxPlaced ?? 0,
        }
      : null,
    scene: countScene(scene),
  };
}

/**
 * Kick off the `?perf=1` performance probe: waits for the world to settle
 * (`?perfSettle` frames, default 60), samples `?perfFrames` frame timings
 * (default 240) plus per-phase CPU breakdowns wired in by main.js via
 * `beginPerfFrame`/`measurePerfPhase`/`endPerfFrame`, then publishes the
 * result on `window.__swPerf.report` and logs it as `[small-world:perf]`
 * JSON. Entirely a no-op unless `?perf=1` is set.
 *
 * @param {Object} args
 * @param {Object} args.state - shared app state (read for entity/grass/fx counts)
 * @param {THREE.Scene} args.scene - scene to count objects/shadow-casters in
 * @param {THREE.WebGLRenderer} args.renderer - renderer to read pixel ratio/size from
 */
export function startPerfProbe({ state, scene, renderer }) {
  if (!isPerfProbeEnabled()) return;

  const params = getSearchParams();
  const settleFrames = readPositiveIntParam(params, "perfSettle", 60);
  const frameCount = readPositiveIntParam(params, "perfFrames", 240);

  activeProbe = {
    collecting: false,
    currentFrame: null,
    phaseFrames: [],
  };

  window.__swPerf = {
    running: true,
    report: null,
  };

  (async () => {
    await waitForWorld(state, settleFrames);
    activeProbe.phaseFrames = [];
    activeProbe.collecting = true;
    const timings = await sampleFrameTimings(frameCount);
    activeProbe.collecting = false;
    const phaseFrames = activeProbe.phaseFrames;
    const report = buildReport({ state, scene, renderer, timings, phaseFrames });
    window.__swPerf = {
      running: false,
      report,
    };
    console.log("[small-world:perf]", JSON.stringify(report));
  })().catch((error) => {
    if (activeProbe) activeProbe.collecting = false;
    window.__swPerf = {
      running: false,
      error: error instanceof Error ? error.message : String(error),
      report: null,
    };
    console.error("[small-world:perf] failed", error);
  });
}
