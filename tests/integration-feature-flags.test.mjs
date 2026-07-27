import assert from "node:assert/strict";

import {
  parseFeatureFlagValue,
  readIntegrationFeatureFlags,
} from "../src/integration/feature-flags.js";

assert.equal(parseFeatureFlagValue(true), true);
assert.equal(parseFeatureFlagValue("YES"), true);
assert.equal(parseFeatureFlagValue("off"), false);
assert.equal(parseFeatureFlagValue("occasionally"), undefined);
assert.equal(parseFeatureFlagValue(2), undefined);

const defaults = readIntegrationFeatureFlags({ search: "", env: {} });
assert.deepEqual(defaults, {
  livingWorld: false,
  generatedFauna: false,
  generatedFlora: false,
});
assert.equal(Object.isFrozen(defaults), true, "resolved flags should be immutable");

const environmentEnabled = readIntegrationFeatureFlags({
  search: "",
  env: {
    VITE_LIVING_WORLD: "true",
    VITE_SW_GENERATED_FAUNA: "true",
    VITE_SW_GENERATED_FLORA: "1",
  },
});
assert.deepEqual(environmentEnabled, {
  livingWorld: true,
  generatedFauna: true,
  generatedFlora: true,
});

const urlOverrides = readIntegrationFeatureFlags({
  search: "?generatedFauna=0&generatedFlora",
  env: {
    VITE_SW_GENERATED_FAUNA: "true",
    VITE_SW_GENERATED_FLORA: "false",
  },
});
assert.deepEqual(urlOverrides, {
  livingWorld: false,
  generatedFauna: false,
  generatedFlora: true,
}, "explicit URL values should override environment configuration and fail closed");

const paramsInput = new URLSearchParams("generatedFauna=on&generatedFlora=no");
assert.deepEqual(
  readIntegrationFeatureFlags({ search: paramsInput, env: {} }),
  {
    livingWorld: false,
    generatedFauna: true,
    generatedFlora: false,
  }
);

const originalRandom = Math.random;
Math.random = () => {
  throw new Error("feature flag resolution must not consume global entropy");
};
try {
  readIntegrationFeatureFlags({
    search: "?generatedFauna=1",
    env: { VITE_SW_GENERATED_FLORA: "true" },
  });
} finally {
  Math.random = originalRandom;
}

console.log("integration-feature-flags.test.mjs passed");
