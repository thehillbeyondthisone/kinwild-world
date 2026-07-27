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

const originalRandom = Math.random;
Math.random = () => {
  throw new Error("composition planning must not consume ambient Math.random");
};
let planA;
let planB;
try {
  const anchor = { x: 2, y: 0.4, z: -1 };
  planA = planLivingComposition(0x1e, anchor, { lowfx: false });
  planB = planLivingComposition(0x1e, anchor, { lowfx: false });
} finally {
  Math.random = originalRandom;
}
assert.deepEqual(planA, planB);
assert.equal(planA.flora.filter((entry) => entry.role === "hero").length, 1);
assert.equal(planA.flora.filter((entry) => entry.role === "mid").length, 9);
assert.equal(planA.flora.filter((entry) => entry.role === "ground").length, 24);
assert.equal(planA.fauna.length, 4);
const lowfxPlan = planLivingComposition(0x1e, {
  x: 2,
  y: 0.4,
  z: -1,
}, { lowfx: true });
assert.equal(lowfxPlan.flora.length, 15);
assert.equal(lowfxPlan.fauna.length, 2);

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
    centers: [
      {
        cx: 0,
        cz: 0,
        radius: 28,
        visualRadius: 32,
        shape: { kind: "round" },
      },
    ],
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
  windUniforms: {
    uTime: { value: 0 },
    uFoliageWind: { value: 1 },
  },
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

const anchorA = selectLivingWorldAnchor(worldState, 0x1e);
const anchorB = selectLivingWorldAnchor(worldState, 0x1e);
assert.deepEqual(anchorA, anchorB);

const runtime = createLivingWorldRuntime({
  worldState,
  biome,
  seed: 0x1e,
  flags: { livingWorld: true },
});
worldState.livingWorld = runtime;
const floraCount = populateLivingFlora(runtime);
const faunaCount = populateLivingFauna(runtime);
assert.equal(floraCount, 34);
assert.equal(faunaCount, 4);
assert.equal(worldState.creatures.length, faunaCount);
assert.ok(worldState.obstacles.some((entry) => entry.kind === "living:veilcrown"));
assert.ok(worldState.flowerSpots.length > 0);
assert.ok(worldState.perchSpots.length > 0);
for (const creature of worldState.creatures) {
  assert.ok(Number.isFinite(creature.scale));
  assert.ok(creature.generatedAgent);
}
for (const actor of runtime.fauna) {
  assert.equal(actor.agent.root.scale.x, actor.record.scale);
  for (const foot of actor.agent.debug.feet()) {
    const [x, y, z] = foot.planted;
    assert.ok(
      Math.abs(y - worldState.heightFn(x, z)) < 1e-6,
      "scaled Kinling feet should be planted before the first rendered frame",
    );
  }
}

const overlapActor = runtime.fauna[0];
const overlapPeer = runtime.fauna[1];
const overlapOrigin = overlapPeer.position.clone();
overlapActor.position.copy(overlapOrigin);
worldState.dynamicObstacles.push({
  x: overlapOrigin.x,
  z: overlapOrigin.z,
  r: Math.max(0.32 * overlapPeer.facade.scale, overlapPeer.agent.traits.radius * 0.58),
  top: overlapPeer.agent.root.position.y + 1,
  owner: overlapPeer.facade,
});
const pausedPosition = overlapActor.position.clone();
stepLivingWorld(runtime, 0, 0);
assert.deepEqual(
  overlapActor.position.toArray(),
  pausedPosition.toArray(),
  "paused generated fauna must not resolve against stale obstacles",
);
stepLivingWorld(runtime, 1 / 60, 0);
const separationDistance = overlapActor.position.distanceTo(overlapOrigin);
const separationSpeedCap = Math.max(
  overlapActor.record.speed * 1.35 * 1.75,
  1.1,
);
assert.ok(
  separationDistance > 0 &&
    separationDistance <= separationSpeedCap / 60 + 1e-9,
  `generated fauna should separate smoothly from dynamic creature obstacles; moved ${separationDistance}`,
);
worldState.dynamicObstacles.length = 0;

for (let frame = 1; frame <= 12; frame++) {
  const time = frame / 60;
  stepLivingWorld(runtime, 1 / 60, time);
}
for (const creature of worldState.creatures) {
  assert.ok(Number.isFinite(creature.group.position.x));
  assert.ok(Number.isFinite(creature.group.position.y));
  assert.ok(Number.isFinite(creature.group.position.z));
}
for (const actor of runtime.fauna) {
  const maxIntentSpeed = actor.record.speed * 1.35 * 1.5;
  assert.ok(
    actor.velocity.length() <= maxIntentSpeed + 1e-9,
    "collision repair must not become an extreme gait command",
  );
}
const retiredFacade = worldState.creatures[0];
assert.equal(retiredFacade.dispose(), true);
assert.equal(retiredFacade.dispose(), false);
assert.equal(worldState.creatures.includes(retiredFacade), false);
assert.equal(
  runtime.fauna.some((actor) => actor.facade === retiredFacade),
  false,
);
stepLivingWorld(runtime, 1 / 60, 1);

assert.equal(disposeLivingWorld(worldState), true);
assert.equal(worldState.livingWorld, null);
assert.equal(worldState.creatures.length, 0);
assert.equal(runtime.disposed, true);

console.log("living-world-runtime.test.mjs passed");
