import * as THREE from "three";
import { state } from "../state.js";
import { replaceOrWarn } from "../util.js";
import { applyTerrainClip, clipCenter } from "../terrain.js";
import { WATER_SURFACE_Y } from "../world-constants.js";

// ─────────────────────────────────────────────────────────────────────────────
// Water plane — translucent disk for water-adjacent biomes (marsh, ...).
// Animated in `animate()` via a small per-vertex sin displacement.
// ─────────────────────────────────────────────────────────────────────────────
export function makeWaterPlane(biome) {
  const segs = 48;
  const size = state.ISLAND_SIZE * 1.05;
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const base = new THREE.Color(biome.water || biome.fog);
  const mat = new THREE.MeshPhysicalMaterial({
    color: base,
    transparent: true,
    opacity: 0.55,
    roughness: 0.24,
    metalness: 0.0,
    specularIntensity: 0.62,
    clearcoat: 0.32,
    clearcoatRoughness: 0.18,
    // Transparent water should tint underwater glows, not depth-occlude them
    // out of the shared bloom/depth pre-pass.
    depthWrite: false,
  });

  // Reflection patch — only kicks in if state.waterReflection is set later
  // by world.js. Until then, uReflTex stays null and uReflMix is 0 so the
  // mix branch is skipped entirely.
  const reflUniforms = {
    uReflTex: { value: null },
    uInvViewport: {
      value: new THREE.Vector2(
        1 / window.innerWidth,
        1 / window.innerHeight
      ),
    },
    uReflMix: { value: 0.0 },
  };
  const waterTurbulenceUniforms = {
    uWaterTurbulenceTime: { value: 0 },
    uWaterTurbulenceStrength: { value: 1.0 },
  };
  mat.userData.reflectionUniforms = reflUniforms;
  mat.userData.waterTurbulenceUniforms = waterTurbulenceUniforms;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader) => {
    if (prev) prev(shader);
    shader.uniforms.uReflTex = reflUniforms.uReflTex;
    shader.uniforms.uInvViewport = reflUniforms.uInvViewport;
    shader.uniforms.uReflMix = reflUniforms.uReflMix;
    shader.uniforms.uWaterTurbulenceTime = waterTurbulenceUniforms.uWaterTurbulenceTime;
    shader.uniforms.uWaterTurbulenceStrength = waterTurbulenceUniforms.uWaterTurbulenceStrength;
    shader.vertexShader = replaceOrWarn(
      replaceOrWarn(
        shader.vertexShader,
        "#include <common>",
        `#include <common>
         varying vec3 vWaterWorldPosition;`,
        "water.vertex.common"
      ),
      "#include <worldpos_vertex>",
      `#include <worldpos_vertex>
         vWaterWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      "water.vertex.worldpos"
    );
    let fs = replaceOrWarn(
      shader.fragmentShader,
      "#include <common>",
      `#include <common>
         varying vec3 vWaterWorldPosition;
         uniform sampler2D uReflTex;
         uniform vec2 uInvViewport;
         uniform float uReflMix;
         uniform float uWaterTurbulenceTime;
         uniform float uWaterTurbulenceStrength;
         float waterTurbulence(vec2 p) {
           vec2 q = p * 0.18;
           float a = sin(q.x * 6.2 + q.y * 2.7 + uWaterTurbulenceTime * 0.62);
           float b = sin(q.x * -3.9 + q.y * 7.4 - uWaterTurbulenceTime * 0.48);
           float c = sin(length(q * vec2(1.6, 0.85)) * 9.0 - uWaterTurbulenceTime * 0.78);
           return (a * 0.48 + b * 0.34 + c * 0.18);
         }
         vec2 waterTurbulenceSlope(vec2 p) {
           float e = 0.18;
           float hL = waterTurbulence(p - vec2(e, 0.0));
           float hR = waterTurbulence(p + vec2(e, 0.0));
           float hD = waterTurbulence(p - vec2(0.0, e));
           float hU = waterTurbulence(p + vec2(0.0, e));
           return vec2(hR - hL, hU - hD) / (2.0 * e);
         }`,
      "water.fragment.common"
    );
    fs = replaceOrWarn(
      fs,
      "#include <normal_fragment_begin>",
      `#include <normal_fragment_begin>
         vec2 waterSlope = waterTurbulenceSlope(vWaterWorldPosition.xz);
         vec3 waterWorldNormal = inverseTransformDirection(normal, viewMatrix);
         waterWorldNormal = normalize(waterWorldNormal + vec3(-waterSlope.x, 0.0, -waterSlope.y) * 0.18 * uWaterTurbulenceStrength);
         normal = normalize(transformDirection(waterWorldNormal, viewMatrix));`,
      "water.fragment.normal_fragment_begin"
    );
    fs = replaceOrWarn(
      fs,
      "#include <roughnessmap_fragment>",
      `#include <roughnessmap_fragment>
         float waterRoughnessNoise = waterTurbulence(vWaterWorldPosition.xz * 0.72 + vec2(3.4, -1.7)) * 0.5 + 0.5;
         roughnessFactor = clamp(roughnessFactor + waterRoughnessNoise * 0.14 * uWaterTurbulenceStrength, 0.08, 0.62);`,
      "water.fragment.roughnessmap_fragment"
    );
    fs = replaceOrWarn(
      fs,
      "#include <opaque_fragment>",
      `#include <opaque_fragment>
         if (uReflMix > 0.001) {
           vec2 ruv = gl_FragCoord.xy * uInvViewport;
           vec3 refl = texture2D(uReflTex, ruv).rgb;
           // Fresnel-ish: stronger at glancing angles. We keep the math
           // fixed (don't sample vViewPosition) for cross-version stability.
           float f = pow(1.0 - clamp(dot(normalize(vNormal), vec3(0.0, 1.0, 0.0)), 0.0, 1.0), 2.0);
           gl_FragColor.rgb = mix(gl_FragColor.rgb, refl, uReflMix * (0.4 + 0.6 * f));
         }`,
      "water.fragment.opaque_fragment"
    );
    shader.fragmentShader = fs;
  };
  applyTerrainClip(mat, clipCenter());

  const mesh = new THREE.Mesh(geo, mat);
  // sit a touch below sea level so the underside cone meets the water
  mesh.position.y = WATER_SURFACE_Y;
  mesh.receiveShadow = true;
  // cache the base XZ so we can offset Y each frame from a clean reference
  const arr = geo.attributes.position.array;
  mesh.userData.basePositions = new Float32Array(arr);
  mesh.userData.inspect = { category: "flora", variant: "water" };
  return mesh;
}

export function stepWater(water, dt, t) {
  if (!water) return;
  const waterTurbulenceUniforms = water.material.userData.waterTurbulenceUniforms;
  if (waterTurbulenceUniforms) {
    waterTurbulenceUniforms.uWaterTurbulenceTime.value = t;
  }
  const pos = water.geometry.attributes.position;
  const base = water.userData.basePositions;
  const a = pos.array;
  for (let i = 0; i < pos.count; i++) {
    const ix = i * 3;
    const x = base[ix];
    const z = base[ix + 2];
    a[ix + 1] =
      Math.sin(t * 0.9 + x * 0.5 + z * 0.4) * 0.05 +
      Math.sin(t * 1.4 + x * 0.3 - z * 0.6) * 0.03;
  }
  pos.needsUpdate = true;
}
