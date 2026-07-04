// Barrel — environment builders live under src/environment/. This file
// preserves the public import path "./environment.js" used across the
// codebase (world.js, main.js, ui.js, fauna/*) so consumers don't need to
// know about the per-concern split. Mirrors the src/fauna.js barrel pattern.
export { makeParticles, stepParticles } from "./environment/particles.js";
export {
  makeDirtPuff,
  stepDirtPuffs,
  makeDustKick,
  stepDustKicks,
  makeFlySwarm,
  stepFlySwarms,
} from "./environment/swarms.js";
export {
  makeGroundMarks,
  emitGroundMark,
  stepGroundMarks,
} from "./environment/decals.js";
export {
  placeInstanced,
  makeWildflowerField,
  makeVerdantGroveDetails,
  makeCloudPuffField,
  makePebbleField,
  makeBeachcombField,
} from "./environment/groundcover.js";
export { makeWaterPlane, stepWater } from "./environment/water.js";
export { makeGrassField } from "./grass.js";

// Backdrop primitives (sky dome, mountain rings, clouds, stars, aurora) live
// in src/sky.js — see makeSkyDome / makeMountainBackdrop / etc.
