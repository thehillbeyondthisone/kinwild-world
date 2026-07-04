// Shared world-construction constants (ARC-002).
//
// The portal preview reconstructs a faithful slice of the destination world,
// so it must derive terrain noise and the flora footprint table from the SAME
// source of truth as `generateWorld`. Hand-copying these silently diverges
// the preview from the real destination whenever a flora kind is added or the
// noise seed changes. Both `src/world.js` and `src/portal.js` import from here.

import { createNoise2D } from "simplex-noise";
import { mulberry32 } from "./seed.js";
import { BIOMES } from "./biomes.js";

/** XORed into the world seed before deriving the terrain noise permutation so
 * the terrain noise stream is decorrelated from the placement RNG stream. */
export const TERRAIN_NOISE_SEED_XOR = 0x5eed5eed;

/**
 * Flora kinds whose visual canopy spacing must be wider than their
 * root/footprint spacing (small bases, broad crowns/caps, to prevent
 * silhouettes from intersecting). Lives here (rather than world.js, which
 * re-exports it for back-compat) so `src/world/flora-placement.js` can use it
 * without an import cycle back through world.js.
 * @type {Set<string>}
 */
export const CANOPY_SPACING_KINDS = new Set(["tree", "leafballtree", "pine", "snowpine", "deadtree", "bigmushroom", "fairyring", "portal", "berrybush"]);
/** Extra placement radius padding (world units) applied to `CANOPY_SPACING_KINDS` members. */
export const CANOPY_SPACING_PAD = 2.8;

/**
 * Build the canonical terrain-noise permutation from a world seed. Both the
 * real world and the portal preview must call this with the same seed so the
 * destination terrain matches what the user will actually travel to.
 *
 * @param {number} seed - world seed
 * @returns {(x: number, z: number) => number} simplex-noise 2D sampler
 */
export function terrainNoiseFromSeed(seed) {
  return createNoise2D(mulberry32((seed ^ TERRAIN_NOISE_SEED_XOR) >>> 0));
}

/**
 * Roll the biome and layout together as one atomic RNG-prefix step.
 * ARC-003/QA-013: the RNG-prefix consumed at the very start of world
 * generation is exactly one `Math.random()` call for the biome roll,
 * immediately followed by whatever `pickLayoutFn()` itself consumes. The
 * portal preview (`src/portal.js`) replays this same prefix so a preview
 * built for a given seed reconstructs the identical destination layout
 * `generateWorld` would build for that seed. Inserting any `Math.random()`
 * call between the biome roll and layout pick in `generateWorld` — or
 * reordering them — would silently desync every portal preview from its
 * destination with no failing test; both call sites MUST route through this
 * helper instead of duplicating the sequence.
 *
 * @param {() => Object} pickLayoutFn - injected (rather than imported) to
 *   avoid pulling terrain.js's dependency chain into this low-level constants module
 * @returns {{biome: Object, layout: Object}}
 */
export function rollBiomeAndLayout(pickLayoutFn) {
  const biome = BIOMES[Math.floor(Math.random() * BIOMES.length)];
  const layout = pickLayoutFn();
  return { biome, layout };
}

/**
 * Terrain noise amplitude for a biome. Cloud islands should read as soft
 * puffs rather than rocky mountains — lowering the amplitude keeps the
 * silhouette pillowy while preserving the seeded terrain function for
 * creature placement. Shared by world.js and the portal preview so a
 * preview's terrain silhouette matches the real thing.
 *
 * @param {Object} biome - biome config (reads `cloudlike`)
 * @returns {number} noise amplitude to pass to `makeHeightFn`
 */
export function terrainAmpFor(biome) {
  return biome.cloudlike ? 2.15 : 3.2;
}

/**
 * Water-plane surface Y — matches `makeWaterPlane` in environment.js. Shared
 * by world.js (heightFn wet-depth + flora/creature water gating), main.js
 * (underwater fog), environment.js (water plane placement), and portal.js
 * (preview water plane + terrain wet-depth) so all five never drift apart.
 */
export const WATER_SURFACE_Y = -0.12;

/**
 * Wrap a heightFn so terrain below the water surface softens into a smooth
 * trough rather than a hard step. Shared by world.js and portal.js — both
 * derive a biome's terrain heightFn from the same noise permutation and must
 * apply the same wet-depth softening for the preview to match the real destination.
 *
 * @param {(x: number, z: number) => number} baseHeightFn - unmodified terrain heightFn
 * @param {number} [waterSurfaceY=WATER_SURFACE_Y] - water surface world-Y
 * @returns {(x: number, z: number) => number} heightFn with wet-depth softening applied
 */
export function applyWaterWetDepth(baseHeightFn, waterSurfaceY = WATER_SURFACE_Y) {
  return (x, z) => {
    const h = baseHeightFn(x, z);
    const depth = waterSurfaceY - h;
    if (depth <= 0) return h;
    const wet = Math.min(1, depth / 1.6);
    const smoothWet = wet * wet * (3 - 2 * wet);
    return h - smoothWet * (0.45 + depth * 0.28);
  };
}

/**
 * Wrap a heightFn so it also reflects recorded terrain "flatten" zones
 * (portal pads, fairy rings, ...) via the same smoothstep blend used to
 * physically flatten the real terrain mesh. world.js uses this to patch
 * `worldState.heightFn` after mutating the mesh; portal.js uses it to patch
 * its synthetic preview heightFn, which has no backing mesh to mutate.
 *
 * @param {(x: number, z: number) => number} heightFn - base heightFn to wrap
 * @param {Array<{cx: number, cz: number, r: number, flatY: number}>} flatZones - zones to flatten toward `flatY`
 * @returns {(x: number, z: number) => number} heightFn with flat zones applied
 */
export function applyFlatZonesToHeightFn(heightFn, flatZones) {
  if (!flatZones.length) return heightFn;
  return (x, z) => {
    let out = heightFn(x, z);
    for (const { cx, cz, r, flatY } of flatZones) {
      const dx = x - cx, dz = z - cz;
      const d2 = dx * dx + dz * dz;
      const r2 = r * r;
      if (d2 >= r2) continue;
      const t = 1 - d2 / r2;
      const blend = t * t * (3 - 2 * t);
      out += (flatY - out) * blend;
    }
    return out;
  };
}

/**
 * 9-point footprint sampler — heights around (x, z) at radius r, used to
 * find the lowest ground a flora/portal base needs to reach so slope-planting
 * keeps the downhill side buried. Shared by world.js's slope-plant footprint
 * sampling and portal.js's identical preview-anchor sampling.
 *
 * @param {(x: number, z: number) => number} heightFn - terrain heightFn to sample
 * @param {number} x - center world X
 * @param {number} z - center world Z
 * @param {number} r - sample radius (world units)
 * @returns {number[]} 9 height samples (center + 4 cardinal + 4 diagonal)
 */
export function sampleFootprintHeights(heightFn, x, z, r) {
  const diagonal = r * Math.SQRT1_2;
  const samples = [
    [0, 0],
    [r, 0], [-r, 0], [0, r], [0, -r],
    [diagonal, diagonal], [-diagonal, diagonal],
    [diagonal, -diagonal], [-diagonal, -diagonal],
  ];
  return samples.map(([dx, dz]) => heightFn(x + dx, z + dz));
}

/**
 * Per-kind footprint radius — how far around the trunk axis to sample
 * heightFn to find the lowest ground the base needs to reach. Bigger trunks
 * need a wider sample so the downhill side stays buried on slopes. Anything
 * not listed falls back to `FLORA_FOOTPRINT_DEFAULT`.
 * @type {Record<string, number>}
 */
export const FLORA_FOOTPRINT = {
  // Footprints describe the root/base contact patch for slope planting.
  // Broad crowns are spaced separately by CANOPY_SPACING_KINDS; using the
  // canopy width here samples far downhill and can bury the trunk center.
  tree: 0.28, leafballtree: 0.32, pine: 0.28, snowpine: 0.28, deadtree: 0.22, mushroom: 0.18,
  bigmushroom: 0.45, fairyring: 1.15, lantern: 0.18, pillar: 0.30, archstone: 0.55,
  balloontree: 0.22, crystal: 0.30, obsidianshard: 0.28, obsidianglass: 0.34, skull: 0.22,
  berrybush: 0.30, coral: 0.25, braincoral: 0.26, cupcoral: 0.22,
  fern: 0.18, dandylion: 0.16, flyer_nest: 0.612, rock: 0.30, limestonerock: 0.30, reed: 0.10,
  seaweed: 0.12, beach_succulent: 0.20, lavafissure: 1.45,
};

/** Fallback footprint radius for flora kinds absent from `FLORA_FOOTPRINT`. */
export const FLORA_FOOTPRINT_DEFAULT = 0.20;
