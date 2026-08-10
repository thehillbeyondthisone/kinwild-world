import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { replaceOrWarn } from "./shaders/patch.js";
import { state } from "./state.js";

/** Shared brown trunk/wood color used across flora builders. */
export const TRUNK = new THREE.Color("#3a2818");

/**
 * Weld a geometry's coincident vertices, then perturb each welded vertex by a
 * random amount and recompute normals — gives flora/rock geometry its chunky,
 * hand-jittered look instead of a perfect primitive. Disposes the input `geo`.
 *
 * @param {THREE.BufferGeometry} geo - source geometry (disposed by this call)
 * @param {number} [amount=0.05] - max per-axis jitter magnitude (world units)
 * @param {Object} [opts]
 * @param {boolean} [opts.sphericalUvs=false] - recompute UVs from normalized position (for spherical/blob shapes) instead of keeping welded UVs
 * @returns {THREE.BufferGeometry} new welded, jittered, re-normaled geometry
 */
export function jitterGeo(geo, amount = 0.05, { sphericalUvs = false } = {}) {
  // IcosahedronGeometry stores 3 different UVs and normals per face-corner
  // even when positions coincide. mergeVertices hashes all attributes, so
  // those per-face UVs prevent welding. Strip them so the merge is by
  // position alone, then recompute normals after we've perturbed.
  geo.deleteAttribute("uv");
  geo.deleteAttribute("normal");
  const welded = mergeVertices(geo, 1e-4);
  geo.dispose();
  const p = welded.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setX(i, p.getX(i) + (Math.random() - 0.5) * amount);
    p.setY(i, p.getY(i) + (Math.random() - 0.5) * amount);
    p.setZ(i, p.getZ(i) + (Math.random() - 0.5) * amount);
  }
  if (sphericalUvs) {
    const uvs = new Float32Array(p.count * 2);
    const vtx = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      vtx.fromBufferAttribute(p, i).normalize();
      uvs[i * 2] = 0.5 + Math.atan2(vtx.z, vtx.x) / (Math.PI * 2);
      uvs[i * 2 + 1] = 0.5 - Math.asin(Math.max(-1, Math.min(1, vtx.y))) / Math.PI;
    }
    welded.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  }
  welded.computeVertexNormals();
  return welded;
}

/**
 * Patch a `MeshStandardMaterial`'s vertex shader (via `onBeforeCompile`) so
 * geometry sways more the higher its local Y — trunks near y≈0 stay put,
 * leaves/tips bend. Shares `state.windUniforms.uTime` across all instances,
 * so wind stays synced world-wide. Works on both regular meshes and
 * `InstancedMesh` (branches on `USE_INSTANCING`). Chains any previously
 * installed `onBeforeCompile` so multiple patches on one material compose.
 *
 * @param {THREE.Material} material - material to patch in place
 * @param {number} [strength=1.0] - per-material wind sway multiplier
 * @returns {THREE.Material} the same `material`, mutated
 */
/**
 * @param {THREE.Material} material
 * @param {number} [strength]
 * @param {{plantRelative?: boolean}} [options] `plantRelative` drives the sway
 *   from height above `aPlantBase` instead of from local geometry Y. Batched
 *   generated flora needs it: a plant is rows of organ geometry there, each
 *   built around its own origin, so `transformed.y` is the height within a
 *   leaf rather than the height up the tree. Donor flora builds a whole plant
 *   as one mesh and is already plant-relative — do not pass this for those.
 */
export function applyWindSway(material, strength = 1.0, { plantRelative = false } = {}) {
  // Chain any prior onBeforeCompile so multiple patches on the same material
  // compose cleanly. `prev` is the previous handler captured before reassign;
  // it's necessarily a different function than the closure we install below.
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader) => {
    if (prev) prev(shader);
    shader.uniforms.uTime = state.windUniforms.uTime;
    shader.uniforms.uWindStrength = { value: strength };
    shader.uniforms.uFoliageWind = state.windUniforms.uFoliageWind;
    // Both anchors go through replaceOrWarn — see its own note below. A miss
    // here compiles fine and simply stills the wind, which reads as a calm day
    // rather than as a break.
    shader.vertexShader = replaceOrWarn(
      replaceOrWarn(
        shader.vertexShader,
        "#include <common>",
        `#include <common>
uniform float uTime;
uniform float uWindStrength;
uniform float uFoliageWind;${plantRelative ? `
// Guarded because the batched-flora touch patch declares the same attribute,
// and the two patches are installed in either order on the same material.
#ifndef KW_PLANT_BASE_DECLARED
#define KW_PLANT_BASE_DECLARED
attribute vec4 aPlantBase;
#endif` : ""}`,
        "wind-sway/common",
      ),
      "#include <begin_vertex>",
      `#include <begin_vertex>
        {
          ${plantRelative ? "" : `float windY = max(transformed.y, 0.0);
          float windAmp = windY * windY * uWindStrength * uFoliageWind;`}
          // World-space wind: noise is sampled in world coords so neighbouring
          // instances bend coherently. For InstancedMesh with random per-instance
          // Y yaw (wildflowers, etc.) the world-space bend has to be inverse-
          // rotated through the instance's XZ basis before being added to the
          // mesh-local transformed.xz — otherwise each yawed instance bends
          // along its own rotated local-X and the field reads as random
          // motion instead of "wind blowing through." Same trick the grass
          // shader uses.
          #ifdef USE_INSTANCING
            vec4 kwInstance = instanceMatrix * vec4(transformed, 1.0);
            vec4 wp = modelMatrix * kwInstance;
            vec2 axW = vec2(instanceMatrix[0].x, instanceMatrix[0].z);
            vec2 azW = vec2(instanceMatrix[2].x, instanceMatrix[2].z);
            float invXZScaleSq = 1.0 / max(dot(axW, axW), 1e-6);
            ${plantRelative ? `// Height up the *plant*, not up the organ. A batched leaf is
            // built around its own origin, so local Y says how far up the leaf
            // a vertex is — every leaf on a tree would sway identically.
            // Amplitude scales with the plant's span so a tall crown travels
            // further than a groundcover blade, as it should.
            //
            // Calibrated against the donor tree, which is the established
            // look: its crown travels ~2.5% of plant height at strength 0.18.
            // A generated canopy at the hero tier's ~0.25 lands at ~1.5%, and
            // groundcover at ~1.2 lands at ~7% — heroes barely move, grass
            // whips, which is what the roster's motion ranges intend.
            float kwSpan = max(aPlantBase.w, 1e-3);
            float kwT = clamp((kwInstance.y - aPlantBase.y) / kwSpan, 0.0, 1.0);
            float windAmp = kwT * kwT * kwSpan * uWindStrength * uFoliageWind;` : ""}
          #else
            vec4 wp = modelMatrix * vec4(transformed, 1.0);
            vec2 axW = vec2(1.0, 0.0);
            vec2 azW = vec2(0.0, 1.0);
            float invXZScaleSq = 1.0;
            ${plantRelative ? `float windY = max(transformed.y, 0.0);
            float windAmp = windY * windY * uWindStrength * uFoliageWind;` : ""}
          #endif
          float w1 = sin(uTime * 1.4 + wp.x * 0.30 + wp.z * 0.40);
          float w2 = sin(uTime * 0.9 + wp.x * 0.15 - wp.z * 0.25);
          vec2 windWorld = vec2(w1 * windAmp * 0.06, w2 * windAmp * 0.05);
          transformed.x += dot(axW, windWorld) * invXZScaleSq;
          transformed.z += dot(azW, windWorld) * invXZScaleSq;
        }`,
      "wind-sway/begin_vertex",
    );
  };
  material.needsUpdate = true;
  return material;
}

/**
 * Random integer in an inclusive range, drawn from the ambient `Math.random`
 * (seeded when called inside the world-gen determinism window).
 *
 * @param {number} lo - inclusive lower bound
 * @param {number} hi - inclusive upper bound
 * @returns {number} integer in [lo, hi]
 */
export function randInt(lo, hi) {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

// Re-exported (and used above by applyWindSway) from its own dependency-free
// module, so shader-patching code can reach it without pulling `state.js` — and
// Vite's __APP_VERSION__ define — in behind it. See the note at the top of
// `src/shaders/patch.js`.
export { replaceOrWarn };

/**
 * Build a curved leaf BufferGeometry from a parametric grid.
 * Used by leafballtree, berrybush, and any other flora with flat leaf plates.
 *
 * @param {Object} opts
 * @param {number} opts.lengthSegs - Subdivisions along leaf length
 * @param {number} opts.widthSegs - Subdivisions across leaf width
 * @param {number} opts.length - Total leaf length (mapped to Y axis)
 * @param {number} opts.maxWidth - Maximum half-width of the leaf
 * @param {number} opts.minWidth - Minimum half-width before clamping
 * @param {number} opts.profileExp - Exponent for sin-based width profile
 * @param {number} [opts.taperEnd] - Width taper toward tip (0 = none)
 * @param {number} opts.centerLift - Center rises more than edges
 * @param {number} opts.centerLiftFade - How fast center lift fades toward tip
 * @param {number} opts.tipCurlStrength - Amount of forward curl at the tip
 * @param {number} opts.tipCurlExp - Exponent for tip curl falloff
 * @param {number} opts.edgeCurlStrength - Amount of edge curl inward
 * @param {number} [opts.centerRibLift] - Raised central vein height
 * @param {number} [opts.secondaryRibLift] - Raised side-rib height
 * @param {number} [opts.secondaryRibFrequency] - Side-rib count along leaf length
 */
export function buildLeafGeo({
  lengthSegs = 7,
  widthSegs = 4,
  length = 0.42,
  maxWidth = 0.165,
  minWidth = 0.006,
  profileExp = 0.72,
  taperEnd = 0.16,
  centerLift = 0.010,
  centerLiftFade = 0.35,
  tipCurlStrength = 0.060,
  tipCurlExp = 1.45,
  edgeCurlStrength = 0.010,
  centerRibLift = 0,
  secondaryRibLift = 0,
  secondaryRibFrequency = 9.5,
} = {}) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let iy = 0; iy <= lengthSegs; iy++) {
    const v = iy / lengthSegs;
    const profile = Math.sin(Math.PI * v) ** profileExp;
    const taper = taperEnd != null ? (1 - v * taperEnd) : 1;
    const halfWidth = Math.max(minWidth, maxWidth * profile * taper);
    for (let ix = 0; ix <= widthSegs; ix++) {
      const u = ix / widthSegs;
      const side = u * 2 - 1;
      const cl = (1 - Math.abs(side)) * centerLift * (1 - v * centerLiftFade);
      const tc = tipCurlStrength * v ** tipCurlExp;
      const ec = -Math.abs(side) * edgeCurlStrength * Math.sin(Math.PI * v);
      const leafBody = Math.sin(Math.PI * v);
      const centerRib = Math.max(0, 1 - Math.abs(side) * 5.2) * centerRibLift * leafBody;
      const sideRib =
        Math.max(0, Math.sin((v * secondaryRibFrequency + Math.abs(side) * 2.35) * Math.PI)) *
        Math.min(1, Math.abs(side) * 3.4) *
        Math.max(0, 1 - Math.abs(side) * 1.12) *
        secondaryRibLift *
        leafBody;
      positions.push(side * halfWidth, -v * length, tc + cl + ec + centerRib + sideRib);
      uvs.push(u, v);
    }
  }
  for (let iy = 0; iy < lengthSegs; iy++) {
    for (let ix = 0; ix < widthSegs; ix++) {
      const a = iy * (widthSegs + 1) + ix;
      const b = a + 1;
      const c = a + widthSegs + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}
