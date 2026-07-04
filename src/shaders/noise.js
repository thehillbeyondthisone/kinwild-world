// Shared GLSL chunk strings for the hand-rolled hash/value-noise helpers that
// used to be copy-pasted inline across sky.js (x3), grass.js, and
// flora/volcanic.js. Each shader interpolates the chunk(s) it needs into its
// own template literal via `${GLSL_...}` rather than redefining the function.
//
// Several near-identical variants exist below rather than one unified
// version — the constant used inside `hash()` differs by a few digits of
// precision between call sites (which measurably changes the noise pattern),
// and grass.js prefixes its function names to avoid colliding with anything
// three.js's own generated shader chunks might define when patched in via
// onBeforeCompile. Keeping the variants distinct preserves each shader's
// exact prior output.

// hash(vec2) -> [0,1], as used by makeCloudSwirl and makeIslandEdgeMist.
export const GLSL_HASH2 = `float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}`;

// Same algorithm, higher-precision magic constant — as used by makeAurora.
// Do not merge with GLSL_HASH2: the extra digits change the actual hash
// values, not just formatting.
export const GLSL_HASH2_HI_PRECISION = `float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}`;

// float hash(float) variant used by the lavafissure shader (volcanic.js).
export const GLSL_HASH_FLOAT = `float hash(float n) { return fract(sin(n) * 43758.5453123); }`;

// Bilinear-interpolated value noise built on GLSL_HASH2 (function name
// `hash`). Used by makeCloudSwirl and makeIslandEdgeMist.
export const GLSL_VALUE_NOISE = `float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}`;

// Same value-noise algorithm, multi-line `mix` formatting and paired with
// GLSL_HASH2_HI_PRECISION — used by makeAurora.
export const GLSL_VALUE_NOISE_MULTILINE = `float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}`;

// grass.js patches these into three.js's generated MeshStandardMaterial
// vertex shader via onBeforeCompile, so the names are prefixed with `g` to
// avoid colliding with any function three's own chunks might define.
export const GLSL_HASH2_G = `float gHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}`;

export const GLSL_VALUE_NOISE_G = `float gNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), u.x),
             mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), u.x), u.y);
}`;
