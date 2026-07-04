import { BIOMES } from "../biomes.js";
import { createBiomePortal, makeSeededPortalPlacement } from "../portal.js";
import { newRandomSeed } from "../seed.js";

function findNextPortalBiome(sourceBiome, excludedIds) {
  const biomeIndex = BIOMES.findIndex((b) => b.id === sourceBiome.id);
  for (let offset = 1; offset <= BIOMES.length; offset++) {
    const candidate = BIOMES[(biomeIndex + offset + BIOMES.length) % BIOMES.length];
    if (!excludedIds.has(candidate.id)) return candidate;
  }
  return null;
}

function getPortalTargetBiomes(sourceBiome, portalTargetBiomeId, doublePlacement) {
  const targets = [];
  const excludedIds = new Set([sourceBiome.id]);
  const portalTargetBiome = portalTargetBiomeId
    ? BIOMES.find((b) => b.id === portalTargetBiomeId && b.id !== sourceBiome.id)
    : null;
  if (portalTargetBiome) {
    targets.push(portalTargetBiome);
    excludedIds.add(portalTargetBiome.id);
  }
  if (!targets.length) {
    const next = findNextPortalBiome(sourceBiome, excludedIds);
    if (next) {
      targets.push(next);
      excludedIds.add(next.id);
    }
  }
  if (doublePlacement) {
    const next = findNextPortalBiome(sourceBiome, excludedIds);
    if (next) targets.push(next);
  }
  return targets;
}

// Places 1-2 portals (double placement is a user setting) leading to
// neighboring biomes. Extracted verbatim from the head of generateWorld's
// flora phase (QA-008) — purely synchronous (no `Math.random` yield points
// inside), so lifting it out doesn't touch the seeded-PRNG-window mechanics.
// `blocksFloraPlacement` and `flattenTerrainCircle` are the flora-placement
// phase's helpers (defined there since other flora kinds share them too);
// `floraPlacementBlocks` is that phase's shared array, pushed into directly
// so later flora placement sees the portal as a blocker.
export function placePortals({
  worldState,
  biome,
  seed,
  context,
  blocksFloraPlacement,
  flattenTerrainCircle,
  floraPlacementBlocks,
}) {
  if (worldState.userSettings.portalEnabled !== false) {
    const portalPlacementAnchors = [];
    const portalMinDistSq = worldState.ISLAND_RADIUS * worldState.ISLAND_RADIUS;
    const portalTargets = getPortalTargetBiomes(
      biome,
      context.portalTargetBiomeId,
      worldState.userSettings.portalDoublePlacement === true
    );
    for (let portalIndex = 0; portalIndex < portalTargets.length; portalIndex++) {
      const targetBiome = portalTargets[portalIndex];
      const p = makeSeededPortalPlacement({
        seed,
        index: portalIndex,
        layout: worldState.currentLayout,
        heightFn: worldState.heightFn,
        maxRadiusFrac: worldState.userSettings.portalDoublePlacement === true ? 0.72 : 0.54,
        minRadiusFrac: worldState.userSettings.portalDoublePlacement === true ? 0.48 : 0,
        preferredAngle: portalPlacementAnchors.length
          ? Math.atan2(portalPlacementAnchors[0].z, portalPlacementAnchors[0].x) + Math.PI
          : null,
        isBlocked: (x, z) => blocksFloraPlacement(x, z, 2.2) ||
          portalPlacementAnchors.some((anchor) => {
            const dx = x - anchor.x;
            const dz = z - anchor.z;
            return dx * dx + dz * dz < portalMinDistSq;
          }),
      });
      if (portalPlacementAnchors.some((anchor) => {
        const dx = p.x - anchor.x;
        const dz = p.z - anchor.z;
        return dx * dx + dz * dz < portalMinDistSq;
      })) continue;
      const portalGroundY = p.y;
      const targetSeed = newRandomSeed({ allowedBiomeIds: [targetBiome.id], excludeBiomeId: biome.id });
      for (const zone of p.flatZones) flattenTerrainCircle(zone.cx, zone.cz, zone.r, zone.flatY);
      const portal = createBiomePortal({
        sourceBiome: biome,
        targetBiome,
        x: p.x,
        y: portalGroundY,
        z: p.z,
        heading: p.heading,
        seed: targetSeed,
        targetSeed,
        previewSettings: worldState.userSettings,
      });
      worldState.portals.push(portal);
      worldState.world.add(portal.group);
      floraPlacementBlocks.push(portal.blocker);
      worldState.obstacles.push(portal.obstacle);
      portalPlacementAnchors.push({ x: p.x, z: p.z });
    }
  }
}
