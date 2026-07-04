// Flora public entry. This file is a thin registry: each builder lives in a
// per-kind module under src/flora/ (mirroring the src/fauna/ split), and the
// shared helpers + the per-regen resource pool live in src/flora/_shared.js.
//
// Public API (imported by src/world.js, src/inspect.js, src/portal.js):
//   - FLORA_BUILDERS  : { kind: (biome) => THREE.Group }
//   - resetFloraPool  : resets the per-regen pool (called at the top of every
//                       generateWorld). Resets the SAME pool the builders use
//                       (owned by src/flora/_shared.js).
//   - jitterGeo       : re-exported helper (defined in src/util.js).
import { jitterGeo } from "./util.js";
/**
 * Re-exported from src/util.js so flora consumers don't need a second import
 * path. See src/util.js for the full contract (geometry weld + perturb).
 */
export { jitterGeo };

import { resetFloraPool, withIsolatedFloraPool } from "./flora/_shared.js";
/**
 * Re-exported from src/flora/_shared.js, which owns the actual pool instance
 * and implementation. See that module for the full contract.
 */
export { resetFloraPool, withIsolatedFloraPool };

import * as trees from "./flora/trees.js";
import * as garden from "./flora/garden.js";
import * as rocks from "./flora/rocks.js";
import * as structures from "./flora/structures.js";
import * as aquatic from "./flora/aquatic.js";
import * as volcanic from "./flora/volcanic.js";

// Assemble the registry in the original FLORA_BUILDERS key order so that any
// code iterating keys (e.g. inspect-mode flora cycling) keeps a stable order.
/**
 * The open/closed registry of flora builders, keyed by the flora kind string
 * a biome's `flora` array references (see src/biomes.js). Each value is a
 * `(biome) => THREE.Group` factory. To add a new flora kind: implement the
 * builder in the appropriate src/flora/*.js family module, then add one entry
 * here — biomes never reference builders directly, only by this string key.
 * @type {Object<string, (biome: object) => import("three").Group>}
 */
export const FLORA_BUILDERS = {
  tree: trees.tree,
  leafballtree: trees.leafballtree,
  pine: trees.pine,
  snowpine: trees.snowpine,
  dandylion: garden.dandylion,
  cactus: garden.cactus,
  mushroom: garden.mushroom,
  fern: garden.fern,
  rock: rocks.rock,
  limestonerock: rocks.limestonerock,
  reed: garden.reed,
  seaweed: garden.seaweed,
  grass: garden.grass,
  beachsucculent: garden.beachsucculent,
  flyer_nest: structures.flyer_nest,
  deadtree: structures.deadtree,
  skull: rocks.skull,
  pillar: rocks.pillar,
  archstone: rocks.archstone,
  crystal: structures.crystal,
  bigmushroom: structures.bigmushroom,
  fairyring: structures.fairyring,
  berrybush: garden.berrybush,
  lantern: structures.lantern,
  coral: aquatic.coral,
  braincoral: aquatic.braincoral,
  cupcoral: aquatic.cupcoral,
  balloontree: volcanic.balloontree,
  lavafissure: volcanic.lavafissure,
  obsidianglass: volcanic.obsidianglass,
  obsidianshard: volcanic.obsidianshard,
};
