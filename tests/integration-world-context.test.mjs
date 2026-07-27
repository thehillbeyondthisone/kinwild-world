import assert from "node:assert/strict";
import { Vector3 } from "three";

import { createWorldContext } from "../src/integration/world-context.js";

const groundMaterial = { name: "ground" };
const waterMaterial = { name: "water" };
const biomeA = { id: "verdant" };
const state = {
  heightFn: (x, z) => x + 2 * z,
  terrainMesh: { material: groundMaterial },
  waterMesh: { material: waterMaterial },
  currentBiome: biomeA,
  currentSeed: 0x2676,
  lastSimT: 12.5,
  nightFactor: 0.25,
  windUniforms: {
    uTime: { value: 8.75 },
    uFoliageWind: { value: 1 },
  },
  userSettings: {
    windEnabled: true,
    foliageWindEnabled: false,
    windStrength: 1.4,
    windNoiseScale: 0.8,
  },
};

const world = createWorldContext(state, {
  waterSurfaceY: 0.5,
  normalSampleDistance: 0.1,
});

assert.equal(world.biome, biomeA);
assert.equal(world.seed, 0x2676);
assert.equal(world.time, 12.5);
assert.equal(world.nightFactor, 0.25);
assert.equal(world.windUniforms, state.windUniforms);
assert.equal(world.windTime, 8.75);
assert.equal(world.groundHeightAt(2, 0), 2);
assert.equal(world.surfaceHeightAt(2, 0), 2);
assert.equal(world.isWaterAt(2, 0), false);
assert.equal(world.surfaceMaterialAt(2, 0), groundMaterial);

const expectedGroundNormal = new Vector3(-1, 1, -2).normalize();
const actualGroundNormal = world.surfaceNormalAt(2, 0);
assert.ok(
  actualGroundNormal.distanceTo(expectedGroundNormal) < 1e-10,
  "terrain normal should use deterministic central differences"
);

const reusableNormal = new Vector3();
const reusableSample = { normal: reusableNormal };
const waterSample = world.sampleSurface(0, 0, reusableSample);
assert.equal(waterSample, reusableSample, "sampleSurface should support allocation-free reuse");
assert.equal(waterSample.normal, reusableNormal);
assert.equal(waterSample.kind, "water");
assert.equal(waterSample.height, 0.5);
assert.equal(waterSample.groundHeight, 0);
assert.equal(waterSample.hasWater, true);
assert.equal(waterSample.waterDepth, 0.5);
assert.equal(waterSample.material, waterMaterial);
assert.deepEqual(waterSample.normal.toArray(), [0, 1, 0]);

const environment = { wind: {} };
assert.equal(world.readEnvironment(environment), environment);
assert.deepEqual(environment, {
  seed: 0x2676,
  time: 12.5,
  nightFactor: 0.25,
  biome: biomeA,
  wind: {
    enabled: true,
    foliageEnabled: false,
    strength: 1.4,
    noiseScale: 0.8,
    time: 8.75,
    uniforms: state.windUniforms,
  },
});

const biomeB = { id: "frozen" };
state.currentBiome = biomeB;
state.lastSimT = 20;
state.windUniforms.uTime.value = 19;
state.heightFn = () => 3;
assert.equal(world.biome, biomeB, "the facade should reflect live state changes");
assert.equal(world.time, 20);
assert.equal(world.windTime, 19);
assert.equal(world.heightFn(50, -20), 3, "the stable callback should resolve the latest heightFn");

assert.throws(
  () => createWorldContext({ heightFn: () => 0 }, { normalSampleDistance: 0 }),
  /greater than zero/
);
state.heightFn = () => Number.NaN;
assert.throws(() => world.groundHeightAt(0, 0), /non-finite height/);

const originalRandom = Math.random;
Math.random = () => {
  throw new Error("surface sampling must not consume global entropy");
};
try {
  state.heightFn = (x, z) => x - z + 2;
  world.sampleSurface(1, 1);
  world.readEnvironment();
} finally {
  Math.random = originalRandom;
}

console.log("integration-world-context.test.mjs passed");
