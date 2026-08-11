/**
 * Kin must not shuffle on the spot at the foot of a plant.
 *
 * Two separate faults produced one artifact, and this drives the real
 * simulation to pin both:
 *
 * 1. `deflectAroundObstacles` re-derived which way to walk round a blocker
 *    every frame from the sign of `lateral` — the blocker's offset from the
 *    intended line. Walking straight at a trunk makes that offset exactly 0,
 *    which picks one side; the resulting step puts the kin slightly off-axis,
 *    which picks the other; that step returns it to the axis. A two-frame
 *    limit cycle. Measured over three simulated minutes before the fix: 10% of
 *    all deflections flipped side between consecutive frames, every one of
 *    them at `lateral === 0`.
 *
 * 2. An arrived kin steered at its goal for the whole dwell, and a hero's
 *    affordances sit at its trunk — which is a collision circle. So it walked
 *    into the trunk every frame and was pushed back out every frame, which is
 *    also what kept feeding the dead-on input to (1). Same three minutes: a
 *    settled walker drifted up to 0.9 units and was never once stationary.
 *
 * The two are not independent, and the measurement says which matters more:
 * with the hold in place but the side re-derived, the flips fall from 50 to 1
 * over the same run, because the hold is what stops feeding the dead-on input
 * that the sign rule chokes on. So (2) is the fix for the reported artifact
 * and (1) closes the class — a kin can still meet a trunk head-on while
 * merely travelling past it.
 *
 * The hold is asserted precisely, without three, in
 * `living-world-kin-goals.test.mjs`. This file is the integration half: it
 * exists because neither fault is visible by reading, and only the running
 * field shows them.
 */
import assert from "node:assert/strict";
import * as THREE from "three";

globalThis.__APP_VERSION__ = "test";

const {
  createLivingWorldRuntime,
  disposeLivingWorld,
  planLivingComposition,
  populateLivingFauna,
  populateLivingFlora,
  selectLivingWorldAnchor,
  stepLivingWorld,
} = await import("../src/living-world/runtime.js");
const { createLivingWorldBiome } = await import("../src/living-world/style.js");

const biome = createLivingWorldBiome({
  id: "grove",
  ground: ["#111111", "#222222", "#333333"],
  sky: "#ffffff",
  fog: "#888888",
  sun: "#ffffff",
  accent: "#ff00ff",
});
const worldState = {
  currentBiome: biome,
  currentSeed: 0x1e,
  currentLayout: {
    centers: [{ cx: 0, cz: 0, radius: 28, visualRadius: 32, shape: { kind: "round" } }],
    boundRadius: 32,
  },
  world: new THREE.Group(),
  creatures: [],
  obstacles: [],
  dynamicObstacles: [],
  perchSpots: [],
  flowerSpots: [],
  dustKicks: [],
  heightFn(x, z) {
    return 0.35 + Math.sin(x * 0.08) * 0.08 + Math.cos(z * 0.07) * 0.06;
  },
  terrainMesh: null,
  waterMesh: null,
  windUniforms: { uTime: { value: 0 }, uFoliageWind: { value: 1 } },
  userSettings: {
    worldScale: 1,
    windEnabled: true,
    foliageWindEnabled: true,
    windStrength: 1,
    windNoiseScale: 1,
  },
  lastSimT: 0,
  nightFactor: 0,
  livingWorld: null,
};

const anchor = selectLivingWorldAnchor(worldState, 0x1e);
planLivingComposition(0x1e, anchor, { worldState, lowfx: false });
const runtime = createLivingWorldRuntime({
  worldState,
  biome,
  seed: 0x1e,
  flags: { livingWorld: true },
});
worldState.livingWorld = runtime;
populateLivingFlora(runtime);
populateLivingFauna(runtime);

assert.ok(
  worldState.obstacles.some((entry) => entry.kind === "living:hero"),
  "the scenario needs a hero trunk to walk into",
);

// Per-frame behaviour is deliberately outside the seeded window — goal
// scoring and dwell lengths jitter so a field of kin does not move in
// lockstep. That is right for the game and useless for a gate: run to run,
// whether any kin happens to path near one of three trunks in 90 seconds
// swings between "often" and "never". Seed it for the duration so this
// asserts on one reproducible field.
const realRandom = Math.random;
let rngState = 0x9e3779b9;
Math.random = () => {
  rngState |= 0;
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const tracked = runtime.fauna.map((actor) => ({
  actor,
  flies: Boolean(actor.flight),
  previousDeflect: null,
  sideFlips: 0,
  deflections: 0,
  dwellAnchor: null,
  maxDwellDrift: 0,
}));

const DT = 1 / 60;
const FRAMES = 90 * 60;
for (let frame = 1; frame <= FRAMES; frame++) {
  stepLivingWorld(runtime, DT, frame * DT);
  for (const entry of tracked) {
    const { actor } = entry;
    const deflect = actor.deflect;
    if (deflect) {
      entry.deflections += 1;
      // Same blocker as last frame, so the committed side must be the same
      // answer. This is the property; the limit cycle is what it forbids.
      if (
        entry.previousDeflect &&
        entry.previousDeflect.obstacle === deflect.obstacle &&
        entry.previousDeflect.side !== deflect.side
      ) {
        entry.sideFlips += 1;
      }
    }
    entry.previousDeflect = deflect ? { ...deflect } : null;

    // A settled walker holds the ground it arrived on. A flier is exempt: it
    // homes onto the crown it is landing on, which its host plant does not
    // push it away from.
    if (!entry.flies && (actor.needs?.dwellUntil ?? 0) > 0) {
      if (!entry.dwellAnchor) entry.dwellAnchor = actor.position.clone();
      entry.maxDwellDrift = Math.max(
        entry.maxDwellDrift,
        actor.position.distanceTo(entry.dwellAnchor),
      );
    } else if (!entry.flies) {
      entry.dwellAnchor = null;
    }
  }
}

Math.random = realRandom;

const deflections = tracked.reduce((sum, entry) => sum + entry.deflections, 0);
assert.ok(
  deflections > 50,
  `kin must still steer around what is in their way; only ${deflections} deflections in ` +
    `${FRAMES / 60}s means this test stopped exercising the path it guards`,
);

for (const entry of tracked) {
  assert.equal(
    entry.sideFlips,
    0,
    `a kin must commit to one way round a blocker; it changed its mind ` +
      `${entry.sideFlips} times over ${FRAMES / 60}s, which on screen is a ` +
      `shuffle on the spot`,
  );
}

const walkers = tracked.filter((entry) => !entry.flies);
assert.ok(walkers.length > 0, "the field should carry walkers");
for (const entry of walkers) {
  // Generous next to the 0.61–0.90 measured before the fix, and next to the
  // 0.00 measured after: this is a guard against the judder returning, not a
  // pin on the exact arithmetic of a settled pose.
  assert.ok(
    entry.maxDwellDrift < 0.1,
    `a settled walker drifted ${entry.maxDwellDrift.toFixed(2)} units during one ` +
      `dwell; it should hold the ground it arrived on`,
  );
}

assert.equal(disposeLivingWorld(worldState), true);

console.log("living-world-kin-judder.test.mjs passed");
