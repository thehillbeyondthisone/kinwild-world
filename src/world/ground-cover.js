import {
  makeGrassField,
  makeWildflowerField,
  makeVerdantGroveDetails,
  makeCloudPuffField,
  makeBeachcombField,
  makePebbleField,
  makeGroundMarks,
} from "../environment.js";

const GRASS_SHORTEN_MIN_HEIGHT = 0.14;

/**
 * Build and place instanced ground cover — grass / wildflowers / grove
 * details / cloud puffs / beachcomb / pebbles / ground marks. Extracted
 * verbatim from the tail of `generateWorld`'s flora phase (QA-008);
 * `yieldIfNeeded` calls below sit at the exact positions they did before the
 * split, since this function is awaited at that same point.
 *
 * @param {Object} args
 * @param {Object} args.worldState - shared mutable state (mutated in place)
 * @param {Object} args.biome - resolved BIOMES entry
 * @param {Array<{kind: string, x: number, z: number, r: number, grassRadius?: number}>} args.floraPlacementBlocks -
 *   built during flora placement; supplies the landmark/portal exclusion zones and grass-shorten radii so ground
 *   cover doesn't grow through fairy rings or portal pads
 * @param {(object: THREE.Object3D) => void} args.attachCatalogMetadata - tags a built object with its Field Guide subject
 * @param {(force?: boolean) => Promise<void>} args.yieldIfNeeded - determinism-safe async yield
 * @returns {Promise<void>}
 */
export async function placeGroundCover({
  worldState,
  biome,
  floraPlacementBlocks,
  attachCatalogMetadata,
  yieldIfNeeded,
}) {
  // ground cover — instanced grass / wildflowers / pebbles
  // Keep flower/pebble/detail fields out of landmark clearings and portal pads.
  const coverExclusions = floraPlacementBlocks
    .filter(b => b.kind === "fairyring")
    .map(b => ({ x: b.x, z: b.z, r: b.r }));
  const groundCoverExclusions = floraPlacementBlocks
    .filter(b => b.kind === "fairyring" || b.kind === "portal")
    .map(b => ({ x: b.x, z: b.z, r: b.r }));
  const grassShorteners = floraPlacementBlocks
    .filter(b => b.kind !== "fairyring" && b.grassRadius > 0)
    .map(b => ({ x: b.x, z: b.z, r: b.grassRadius, shortenTo: GRASS_SHORTEN_MIN_HEIGHT }));
  const portalGrassClearances = floraPlacementBlocks
    .filter(b => b.kind === "portal" && b.grassClearance)
    .map(b => b.grassClearance);
  const grass = makeGrassField(biome, worldState.heightFn, coverExclusions, grassShorteners, portalGrassClearances);
  if (grass) worldState.world.add(grass);
  // ARC-005: wind/grass settings are re-applied by ui.js's "world-ready"
  // listener (dispatched at the end of every generateWorld call, see
  // finalizeWorldHud in world-hud.js) instead of world.js reaching directly
  // into ui.js-owned state hooks. dispatchEvent is synchronous, so this
  // still lands within the same tick — no visible flicker on regen.
  if (grass) attachCatalogMetadata(grass);
  await yieldIfNeeded(true);
  for (const m of makeWildflowerField(biome, worldState.heightFn, groundCoverExclusions)) {
    attachCatalogMetadata(m);
    worldState.world.add(m);
    if (m.userData.positions) worldState.flowerSpots.push(...m.userData.positions);
  }
  await yieldIfNeeded(true);
  const groveDetails = makeVerdantGroveDetails(biome, worldState.heightFn, groundCoverExclusions);
  if (groveDetails) {
    attachCatalogMetadata(groveDetails);
    worldState.world.add(groveDetails);
  }
  await yieldIfNeeded();
  const cloudPuffs = makeCloudPuffField(biome, worldState.heightFn, groundCoverExclusions);
  if (cloudPuffs) {
    attachCatalogMetadata(cloudPuffs);
    worldState.world.add(cloudPuffs);
  }
  await yieldIfNeeded();
  const beachcomb = makeBeachcombField(biome, worldState.heightFn, groundCoverExclusions);
  if (beachcomb) {
    attachCatalogMetadata(beachcomb);
    worldState.world.add(beachcomb);
  }
  await yieldIfNeeded();
  const pebbles = makePebbleField(biome, worldState.heightFn, groundCoverExclusions);
  if (pebbles) {
    attachCatalogMetadata(pebbles);
    worldState.world.add(pebbles);
  }
  worldState.groundMarks = makeGroundMarks(biome);
  if (worldState.groundMarks) worldState.world.add(worldState.groundMarks);
}
