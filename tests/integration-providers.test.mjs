import assert from "node:assert/strict";

import {
  adaptLegacyFlora,
  createLegacyCreatureProvider,
  createLegacyFloraProvider,
  defineCreatureProvider,
  defineFloraProvider,
} from "../src/integration/index.js";

const biome = { id: "verdant" };
const world = {
  biome,
  heightFn: (x, z) => x + z,
};

const calls = [];
const legacyCreature = {
  group: {
    position: { x: 1, y: 2, z: 3 },
    rotation: { y: 0.75 },
  },
  segments: [{ position: { x: 4, y: 5, z: 6 } }],
  scale: 2,
  segRadius: 0.3,
  heading: 1.25,
  flies: true,
  isFish: false,
  landState: "flying",
  follow(target) {
    calls.push(["follow", target]);
  },
};

const creatureProvider = createLegacyCreatureProvider({
  makeCreature(actualBiome, options) {
    calls.push(["make", actualBiome, options]);
    return legacyCreature;
  },
  stepCreature(creature, dt, time, heightFn) {
    calls.push(["step", creature, dt, time, heightFn]);
  },
  wakeCreature(creature) {
    calls.push(["wake", creature]);
  },
  lookAtCreature(creature, target) {
    calls.push(["look", creature, target]);
  },
  disposeCreature(creature) {
    calls.push(["dispose-creature", creature]);
  },
});

assert.equal(creatureProvider.kind, "creature");
assert.equal(creatureProvider.capabilities.legacy, true);
assert.equal(Object.isFrozen(creatureProvider), true);

const agent = creatureProvider.create({ options: { role: "parent" } }, world);
assert.deepEqual(calls[0], ["make", biome, { role: "parent" }]);
assert.deepEqual(agent.anchor({}), { x: 4, y: 5, z: 6 });
const boundsCenter = {};
assert.equal(agent.bounds(boundsCenter), 0.6);
assert.deepEqual(boundsCenter, { x: 4, y: 5, z: 6 });
assert.equal(agent.heading(), 1.25);
assert.equal(agent.traits.mode, "flier");
assert.equal(agent.traits.airborne, true);
legacyCreature.landState = "landed";
assert.equal(agent.traits.airborne, false, "legacy traits should remain live");

agent.update(0.016, 10, world);
const stepCall = calls.find((entry) => entry[0] === "step");
assert.equal(stepCall[1], legacyCreature);
assert.equal(stepCall[2], 0.016);
assert.equal(stepCall[3], 10);
assert.equal(stepCall[4], world.heightFn);
assert.equal(agent.setMoveIntent({ x: 9, y: 0, z: 9 }), true);
assert.equal(agent.lookAt({ x: 0, y: 1, z: 0 }), true);
assert.equal(agent.wake(), true);
assert.equal(agent.dispose(), true);
assert.equal(agent.dispose(), false, "agent disposal should be idempotent");
assert.equal(calls.filter((entry) => entry[0] === "dispose-creature").length, 1);
assert.throws(() => agent.anchor({}), /disposed/);

const invalidAsyncProvider = defineCreatureProvider({
  id: "async-is-not-safe",
  async create() {
    return agent;
  },
});
assert.throws(
  () => invalidAsyncProvider.create({}, world),
  /must be synchronous/,
  "providers must not introduce bare async work into the seeded generation window"
);

const floraRoot = {
  position: { x: 7, y: 1, z: -2 },
  scale: { x: 2, y: 3, z: 1.5 },
};
const descriptor = {
  id: "legacy:mushroom",
  kind: "mushroom",
  footprint: 0.4,
  roles: ["perch"],
  affordances: { perch: true },
};
let floraDisposeCount = 0;
const floraProvider = createLegacyFloraProvider({
  builders: {
    mushroom(actualBiome, options) {
      calls.push(["build-flora", actualBiome, options]);
      return floraRoot;
    },
  },
  describeKind(kind, actualBiome) {
    calls.push(["describe-flora", kind, actualBiome]);
    return descriptor;
  },
  disposeFlora(root) {
    assert.equal(root, floraRoot);
    floraDisposeCount++;
  },
});

assert.equal(floraProvider.kind, "flora");
const described = floraProvider.describe({ kind: "mushroom" }, world);
assert.equal(described, descriptor);
const flora = floraProvider.create({
  kind: "mushroom",
  descriptor: described,
  options: { giant: false },
}, world);
assert.equal(flora.root, floraRoot);
assert.equal(flora.descriptor, descriptor);
const floraCenter = {};
assert.equal(flora.bounds(floraCenter), 0.8);
assert.deepEqual(floraCenter, { x: 7, y: 1, z: -2 });
assert.equal(flora.dispose(), true);
assert.equal(flora.dispose(), false);
assert.equal(floraDisposeCount, 1);

let removed = 0;
const fallbackRoot = {
  position: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  removeFromParent() {
    removed++;
  },
};
const fallbackFlora = adaptLegacyFlora(fallbackRoot, { descriptor });
fallbackFlora.dispose();
fallbackFlora.dispose();
assert.equal(removed, 1, "fallback detach should also be idempotent");

assert.throws(
  () => floraProvider.create({ kind: "missing" }, world),
  /No legacy flora builder/
);
assert.throws(
  () => defineFloraProvider({
    id: "invalid-flora",
    describe: () => ({ id: "bad", footprint: -1 }),
    create: () => flora,
  }).describe({}, world),
  /non-negative finite/
);

const originalRandom = Math.random;
Math.random = () => {
  throw new Error("provider foundation must not consume global entropy");
};
try {
  const deterministicProvider = defineCreatureProvider({
    id: "fixed",
    create() {
      return {
        root: {},
        interactionRoot: {},
        traits: {},
        anchor: (out) => out,
        bounds: () => 1,
        update() {},
        dispose() {},
      };
    },
  });
  deterministicProvider.create({ rng: () => 0.5 }, world);
} finally {
  Math.random = originalRandom;
}

console.log("integration-providers.test.mjs passed");
