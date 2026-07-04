// Barrel — environment builders live under src/environment/. This file
// preserves the public import path "./environment.js" used across the
// codebase (world.js, main.js, ui.js, fauna/*) so consumers don't need to
// know about the per-concern split. Mirrors the src/fauna.js barrel pattern.

/** Shader-driven ambient particle system (pollen/dust/snow/embers/etc.) — see `src/environment/particles.js`. */
export { makeParticles, stepParticles } from "./environment/particles.js";
/** Transient burst/trail effects (burrower dirt puffs, footstep dust, hovering fly swarms) — see `src/environment/swarms.js`. */
export {
  makeDirtPuff,
  stepDirtPuffs,
  makeDustKick,
  stepDustKicks,
  makeFlySwarm,
  stepFlySwarms,
} from "./environment/swarms.js";
/** Terrain-shader-painted creature footprint/trail marks — see `src/environment/decals.js`. */
export {
  makeGroundMarks,
  emitGroundMark,
  stepGroundMarks,
} from "./environment/decals.js";
/** Instanced ground-cover fields (wildflowers, dew, cloud puffs, pebbles, beachcombed shells/starfish) — see `src/environment/groundcover.js`. */
export {
  placeInstanced,
  makeWildflowerField,
  makeVerdantGroveDetails,
  makeCloudPuffField,
  makePebbleField,
  makeBeachcombField,
} from "./environment/groundcover.js";
/** Reflective, wind-rippled water plane for water-adjacent biomes — see `src/environment/water.js`. */
export { makeWaterPlane, stepWater } from "./environment/water.js";
/** Re-exported so callers can keep importing grass from `environment.js` — see `src/grass.js` for the implementation. */
export { makeGrassField } from "./grass.js";

// Backdrop primitives (sky dome, mountain rings, clouds, stars, aurora) live
// in src/sky.js — see makeSkyDome / makeMountainBackdrop / etc.
