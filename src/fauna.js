// Barrel — fauna entity modules live under src/fauna/. This file preserves
// the public import path "./fauna.js" used by main.js, world.js, ui.js, and
// inspect.js so consumers don't need to know about the per-entity split.
/**
 * @module fauna
 * Public re-export surface for every fauna entity module. Consumers should
 * always import from "./fauna.js", never from the per-entity files under
 * "./fauna/" directly (the one documented exception is `src/fauna/shared.js`'s
 * `WATER_AVOID_Y` / `avoidObstacles` / `colorsClose`, imported directly by
 * sibling modules). See each re-exported symbol's own JSDoc, in its home
 * module, for the full factory/step contract.
 */
// Blob-style walkers, fliers, sleepers, and burrowers. See src/fauna/creature.js.
export {
  makeCreature,
  stepCreature,
  lookAtCreature,
  wakeCreature,
  resetCreaturePool,
  withIsolatedCreaturePool,
  creaturePoolResources,
} from "./fauna/creature.js";
// Caterpillars and snails (positional exception: group stays at the origin,
// head + body segment meshes are individually repositioned). See src/fauna/caterpillar.js.
export {
  makeCaterpillar,
  stepCaterpillar,
  makeRingTrail,
  resetCaterpillarPool,
  caterpillarPoolResources,
} from "./fauna/caterpillar.js";
// Velocity-steered fliers that flutter between flowers. See src/fauna/butterfly.js.
export { makeButterfly, stepButterfly } from "./fauna/butterfly.js";
// Velocity-steered swarm fliers that orbit a shared flower target. See src/fauna/bee.js.
export { makeBee, makeSwarm, stepBee } from "./fauna/bee.js";
// Will-o'-wisps, stepped in their own animate() phase. See src/fauna/willowisp.js.
export { makeWillOWisp, stepWillOWisp } from "./fauna/willowisp.js";
// Spatial-grid builder for static obstacle queries, shared by avoidObstacles()
// and pushOutOfObstacles() in src/fauna/shared.js.
export { buildObstacleGrid } from "./fauna/shared.js";
