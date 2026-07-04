// Protected invariant: water uses a physical material with visible
// specular/clearcoat response, and its onBeforeCompile patch wires the
// turbulence time/strength uniforms into the actual compiled shader
// (perturbing the lit normal and roughness), with stepWater advancing the
// time uniform each frame.
import { strict as assert } from "node:assert";

globalThis.__APP_VERSION__ = "test";
globalThis.window = { innerWidth: 800, innerHeight: 600, location: { search: "" } };

const { makeWaterPlane, stepWater } = await import("../src/environment.js");

const water = makeWaterPlane({ water: "#3388aa", fog: "#112233" });

assert.equal(water.material.type, "MeshPhysicalMaterial", "Water should use a physical material for PBR highlights.");
assert.equal(water.material.specularIntensity, 0.62, "Water should have visible specular response.");
assert.equal(water.material.clearcoat, 0.32, "Water should have visible clearcoat response.");

const turbulenceUniforms = water.material.userData.waterTurbulenceUniforms;
assert(turbulenceUniforms, "Water shader turbulence uniforms should be stored on material userData.");
assert.equal(turbulenceUniforms.uWaterTurbulenceTime.value, 0, "Turbulence time should start at 0.");
assert.equal(turbulenceUniforms.uWaterTurbulenceStrength.value, 1.0, "Turbulence strength should default to 1.0.");

stepWater(water, 0.1, 12.5);
assert.equal(
  turbulenceUniforms.uWaterTurbulenceTime.value,
  12.5,
  "stepWater should advance the PBR turbulence time uniform each frame.",
);

// Exercise the actual onBeforeCompile patch against a minimal fake shader
// object, rather than regexing the GLSL template strings, so the test
// verifies real wiring instead of literal source text.
const fakeShader = {
  uniforms: {},
  vertexShader: [
    "#include <common>",
    "#include <worldpos_vertex>",
  ].join("\n"),
  fragmentShader: [
    "#include <common>",
    "#include <normal_fragment_begin>",
    "#include <roughnessmap_fragment>",
    "#include <opaque_fragment>",
  ].join("\n"),
};

water.material.onBeforeCompile(fakeShader);

assert.equal(
  fakeShader.uniforms.uWaterTurbulenceTime,
  turbulenceUniforms.uWaterTurbulenceTime,
  "The compiled shader should share the same turbulence-time uniform object stepWater animates.",
);
assert.equal(
  fakeShader.uniforms.uWaterTurbulenceStrength,
  turbulenceUniforms.uWaterTurbulenceStrength,
  "The compiled shader should share the same turbulence-strength uniform object.",
);
assert(
  fakeShader.vertexShader.includes("varying vec3 vWaterWorldPosition;"),
  "Vertex shader should derive turbulence from a world-space varying.",
);
assert(
  fakeShader.fragmentShader.includes("float waterTurbulence(vec2 p)"),
  "Fragment shader should define a turbulence function.",
);
assert(
  fakeShader.fragmentShader.includes("waterWorldNormal = normalize(waterWorldNormal"),
  "Fragment shader should perturb the lit world normal from turbulence slope, so reflections/highlights break up.",
);
assert(
  fakeShader.fragmentShader.includes("roughnessFactor = clamp(roughnessFactor + waterRoughnessNoise"),
  "Fragment shader should vary roughness from turbulence noise, not only displace vertices.",
);
