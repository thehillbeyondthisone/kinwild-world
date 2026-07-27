import assert from "node:assert/strict";
import {
  createFlatSurfaceSampler,
  createGeneratedFaunaWalker,
} from "../src/generated-fauna/index.js";

const surface = createFlatSurfaceSampler(0.25, "meadow");
const dna = {
  seed: 0x12345678,
  speciesId: "determinism-proof",
};
// Three itself consumes Math.random while assigning Object3D UUIDs. Construct
// first, then guard the generated-fauna simulation path that we own.
const first = createGeneratedFaunaWalker({ dna, surface });
const second = createGeneratedFaunaWalker({ dna, surface });
const differentSeed = createGeneratedFaunaWalker({
  dna: {
    ...dna,
    seed: dna.seed + 1,
  },
  surface,
});
const originalRandom = Math.random;
Math.random = () => {
  throw new Error("generated fauna simulation must not consume Math.random");
};

try {

  assert.deepEqual(first.debug.phases, second.debug.phases);
  assert(Object.isFrozen(first.debug.phases));

  const frames = [
    {
      dt: 0,
      time: 0,
      intent: {
        position: { x: 0, z: 0 },
        velocity: { x: 0, z: 0 },
        heading: 0,
      },
    },
    {
      dt: 0.08,
      time: 0.08,
      intent: {
        position: { x: 0.05, z: 0.02 },
        velocity: { x: 0.625, z: 0.25 },
        heading: 0.2,
      },
    },
    {
      dt: 0.08,
      time: 0.16,
      intent: {
        position: { x: 0.11, z: 0.05 },
        velocity: { x: 0.75, z: 0.375 },
        heading: 0.25,
      },
    },
    {
      dt: 0.12,
      time: 0.28,
      intent: {
        position: { x: 0.2, z: 0.1 },
        velocity: { x: 0.75, z: 0.42 },
        heading: 0.3,
        lookTarget: { x: 2, y: 1, z: 4 },
      },
    },
  ];

  for (const frame of frames) {
    first.update({ ...frame, surface });
    second.update({ ...frame, surface });
    assert.deepEqual(
      first.debug.primitiveSnapshot(),
      second.debug.primitiveSnapshot(),
      `primitive state should be deterministic at t=${frame.time}`,
    );
    assert.deepEqual(
      first.debug.feet(),
      second.debug.feet(),
      `gait state should be deterministic at t=${frame.time}`,
    );
  }

  assert.notDeepEqual(
    first.debug.phases,
    differentSeed.debug.phases,
    "seed should affect idle/gait phase channels",
  );

} finally {
  Math.random = originalRandom;
  first.dispose();
  second.dispose();
  differentSeed.dispose();
}

console.log("generated fauna determinism tests passed");
