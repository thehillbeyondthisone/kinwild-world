import * as THREE from "three";
import {
  FLORA_FOOTPRINT,
  FLORA_FOOTPRINT_DEFAULT,
  WATER_SURFACE_Y,
  applyFlatZonesToHeightFn,
  sampleFootprintHeights,
  CANOPY_SPACING_KINDS,
  CANOPY_SPACING_PAD,
} from "../world-constants.js";
import { FLORA_BUILDERS } from "../flora.js";
import { makeWillOWisp } from "../fauna.js";
import { makeFlySwarm } from "../environment.js";
import { LOWFX, LOWFX_DENSITY } from "../lowfx.js";
import { pbrDetailPrewarmSteps } from "../pbr.js";
import { placeGroundCover } from "./ground-cover.js";
import { placePortals } from "./portal-placement.js";

// Portal placement, fairy-ring landmark, PBR detail prewarm, the main flora
// placement loop (canopy spacing, giant-flora promotion, obstacle/perch
// registration), reef-coral top-up, and instanced ground cover (grass /
// wildflowers / grove details / cloud puffs / beachcomb / pebbles / ground
// marks). Extracted verbatim from generateWorld (QA-008) — every
// `yieldIfNeeded` call below sits at the exact position it did inside
// generateWorld, since this function is awaited at that same point.
//
// Returns `{ placed, blocksPlacement, GROUND_CREATURE_BLOCK_KINDS, placeFlyerNest }`:
// `placed` feeds the HUD flora count; the other three are reused by the
// fauna-population phase (ground-creature placement and the post-creature
// flyer-nest top-up both need helpers built during flora placement).
export async function placeFloraAndGroundCover({
  worldState,
  biome,
  seed,
  context,
  densityScale,
  pickWorldGroundPoint,
  attachCatalogMetadata,
  yieldIfNeeded,
}) {
  // flora
  let placed = 0;
  let attempts = 0;
  let crystalCount = 0;
  let fissureLightCount = 0;
  let coralPlaced = 0;
  const CRYSTAL_CAP = 4;
  const FISSURE_LIGHT_CAP = LOWFX ? 4 : 9;
  const floraTarget = LOWFX
    ? Math.max(8, Math.round(biome.floraCount * densityScale * LOWFX_DENSITY))
    : Math.round(biome.floraCount * densityScale);
  // FLORA_FOOTPRINT / FLORA_FOOTPRINT_DEFAULT are imported from
  // ../world-constants.js (shared with the portal preview, ARC-002).
  const FLORA_BURY = 0.08; // extra sink so the seam is hidden in soft fog
  // Flora kinds tall/solid enough that walkers should route around them
  // instead of clipping through. Low-profile or soft kinds (rocks, ferns,
  // coral, reeds) are skipped — creatures can step over them visually and
  // adding collision there reads as fussy.
  const OBSTACLE_KINDS = new Set([
    "tree", "leafballtree", "pine", "snowpine", "deadtree", "mushroom", "bigmushroom",
    "fairyring", "cactus", "pillar", "archstone", "balloontree", "crystal",
    "lantern", "obsidianshard", "obsidianglass", "skull", "lavafissure", "berrybush",
    "flyer_nest",
  ]);
  // Per-kind canopy top height (local Y of the highest visible mass at
  // scale=1). Fliers below ground + top * scale must route around the
  // trunk; fliers above that altitude can pass over freely.
  const OBSTACLE_TOP = {
    tree: 2.3, leafballtree: 2.25, pine: 2.2, snowpine: 1.95, deadtree: 1.8, mushroom: 1.1,
    bigmushroom: 2.6, fairyring: 0.9, cactus: 1.2, pillar: 2.8, archstone: 2.6, balloontree: 3.2,
    crystal: 1.6, lantern: 1.7, obsidianshard: 2.2, obsidianglass: 1.6, skull: 1.5,
    lavafissure: 0.16, berrybush: 0.58, flyer_nest: 0.40,
  };
  const OBSTACLE_TOP_DEFAULT = 2.0;
  // Extra pad on top of the slope-plant footprint so creature bodies don't
  // visually nose-clip the trunk. fp itself is already ~1.5× the trunk radius.
  const OBSTACLE_PAD = 1.15;
  // Visual canopy spacing is wider than root/footprint spacing. Trees, bushes,
  // and big mushrooms can have small bases but broad crowns/caps, so they need
  // a separate placement radius to prevent silhouettes from intersecting.
  const NEST_HOST_KINDS = new Set(["tree", "leafballtree", "pine", "snowpine", "balloontree", "bigmushroom", "pillar"]);
  const biomeHasNestHosts = biome.flora.some((kind) => NEST_HOST_KINDS.has(kind));
  const MIN_NEST_HOST_RADIUS = 0.42;
  const FLYER_NEST_BASE_CLEARANCE = 0.04;
  const FLYER_NEST_MAX_TERRAIN_VARIANCE = 0.30;
  const GRASS_SHORTEN_PAD = 2.6;
  const GRASS_SHORTEN_MIN_RADIUS = 0.42;
  const GRASS_SHORTEN_MAX_RADIUS = 1.2;
  const PLACEMENT_BLOCK_KINDS = new Set(["lavafissure", "portal"]);
  const GROUND_CREATURE_BLOCK_KINDS = new Set(["lavafissure", "fairyring", "portal"]);
  const floraPlacementBlocks = [];
  const nestHosts = [];
  // Track terrain flatten zones so heightFn can be patched afterward.
  const terrainFlatZones = []; // { cx, cz, r, flatY }

  placePortals({ worldState, biome, seed, context, blocksFloraPlacement, flattenTerrainCircle, floraPlacementBlocks });

  function flattenTerrainCircle(cx, cz, r, flatY) {
    const mesh = worldState.terrainMesh;
    if (!mesh) return;
    const pos = mesh.geometry.attributes.position;
    const r2 = r * r;
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - cx;
      const dz = pos.getZ(i) - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r2) continue;
      // Smooth blend: full flatten at centre, taper to original at the edge.
      const t = 1 - d2 / r2; // 1 at centre, 0 at edge
      const blend = t * t * (3 - 2 * t); // smoothstep
      pos.setY(i, pos.getY(i) + (flatY - pos.getY(i)) * blend);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    terrainFlatZones.push({ cx, cz, r, flatY });
  }
  function blocksPlacement(x, z, r, kinds = PLACEMENT_BLOCK_KINDS) {
    const kindSet = kinds instanceof Set ? kinds : new Set(kinds);
    for (const obstacle of worldState.obstacles) {
      if (!kindSet.has(obstacle.kind)) continue;
      const minD = obstacle.r + r;
      const dx = x - obstacle.x;
      const dz = z - obstacle.z;
      if (dx * dx + dz * dz < minD * minD) return true;
    }
    return false;
  }
  function blocksFloraPlacement(x, z, r, kinds = null) {
    const kindSet = kinds == null ? null : (kinds instanceof Set ? kinds : new Set(kinds));
    for (const block of floraPlacementBlocks) {
      if (kindSet && !kindSet.has(block.kind)) continue;
      const minD = block.r + r;
      const dx = x - block.x;
      const dz = z - block.z;
      if (dx * dx + dz * dz < minD * minD) return true;
    }
    return false;
  }
  function blocksNestPlacement(x, z, r, allowedHostBlock = null) {
    for (const block of floraPlacementBlocks) {
      if (block === allowedHostBlock) continue;
      const minD = block.r + r;
      const dx = x - block.x;
      const dz = z - block.z;
      if (dx * dx + dz * dz < minD * minD) return true;
    }
    return false;
  }
  function sampleTerrainFootprint(x, z, r) {
    return sampleFootprintHeights(worldState.heightFn, x, z, r);
  }
  function getFlyerNestGroundPose(x, z, r, scale) {
    const heights = sampleTerrainFootprint(x, z, r);
    const minY = Math.min(...heights);
    const maxY = Math.max(...heights);
    if (heights[0] < -0.3 || maxY - minY > FLYER_NEST_MAX_TERRAIN_VARIANCE * scale) return null;
    // QA-L04: reuse the maxY already computed above instead of re-scanning.
    const y = maxY - FLYER_NEST_BASE_CLEARANCE * scale;
    return { groundY: heights[0], y };
  }
  function nestTouchesWater(x, z, r) {
    if (!biome.water) return false;
    const minY = WATER_SURFACE_Y + 0.04;
    return sampleTerrainFootprint(x, z, r).some((height) => height < minY);
  }
  function pickNestHost(r) {
    const choices = [];
    for (const host of nestHosts) {
      if (host.nestOccupied) continue;
      if (blocksNestPlacement(host.x, host.z, r * 1.2, host.block)) continue;
      if (nestTouchesWater(host.x, host.z, r * 1.2)) continue;
      choices.push(host);
    }
    if (!choices.length) return null;
    const host = choices[Math.floor(Math.random() * choices.length)];
    host.nestOccupied = true;
    return host;
  }
  function placeFlyerNest() {
    const kind = "flyer_nest";
    let s = Math.max(1.05, 0.7 + Math.random() * 0.7);
    const fp = FLORA_FOOTPRINT.flyer_nest * s;
    let nestHost = biomeHasNestHosts ? pickNestHost(fp) : null;
    let p = null;
    let y0 = 0;
    let groundPose = null;

    if (nestHost) {
      p = { x: nestHost.x, z: nestHost.z };
      y0 = nestHost.groundY;
    } else {
      if (biomeHasNestHosts) return false;
      for (let tries = 0; tries < 80; tries++) {
        const candidate = pickWorldGroundPoint(0.88);
        const candidatePose = getFlyerNestGroundPose(candidate.x, candidate.z, fp, s);
        if (!candidatePose) continue;
        if (biome.water && candidatePose.groundY < WATER_SURFACE_Y + 0.04) continue;
        if (blocksNestPlacement(candidate.x, candidate.z, fp * 1.2)) continue;
        if (nestTouchesWater(candidate.x, candidate.z, fp * 1.2)) continue;
        p = candidate;
        y0 = candidatePose.groundY;
        groundPose = candidatePose;
        break;
      }
    }
    if (!p) return false;

    const f = FLORA_BUILDERS.flyer_nest(biome);
    f.userData.inspect = { category: "flora", variant: kind };
    attachCatalogMetadata(f);
    let y = groundPose ? groundPose.y : y0 - FLORA_BURY;
    if (kind === "flyer_nest" && nestHost) y = nestHost.y - 0.08 * s;
    f.position.set(p.x, y, p.z);
    f.rotation.y = Math.random() * Math.PI * 2;
    f.scale.setScalar(s);
    worldState.world.add(f);

    const grassShortenRadius = clampGrassShortenRadius(fp);
    const floraBlock = {
      kind,
      x: p.x,
      z: p.z,
      grassRadius: grassShortenRadius,
      r: fp * 1.2,
    };
    floraPlacementBlocks.push(floraBlock);
    const topLocal = f.userData.obstacleTopY ?? OBSTACLE_TOP.flyer_nest;
    const topY = y + topLocal * s;
    worldState.obstacles.push({
      kind,
      x: p.x,
      z: p.z,
      r: fp * OBSTACLE_PAD,
      top: topY,
    });
    const capLocal = f.userData.capTopY ?? f.userData.obstacleTopY ?? OBSTACLE_TOP.flyer_nest;
    worldState.perchSpots.push({
      x: p.x,
      z: p.z,
      y: y + capLocal * s,
      perchKind: "flyer_nest",
      perchRadius: (f.userData.perchRadius ?? 0.4) * s,
      perchWind: null,
    });
    placed++;
    return true;
  }
  function conformSurfaceChildrenToTerrain(group) {
    const c = Math.cos(group.rotation.y);
    const s = Math.sin(group.rotation.y);
    const scale = group.scale.x || 1;
    for (const child of group.children) {
      const lift = child.userData.surfaceLift;
      if (lift === undefined) continue;
      if (child.userData.surfaceConformVertices && child.geometry?.attributes?.position) {
        const pos = child.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const lx = (child.position.x + pos.getX(i)) * scale;
          const lz = (child.position.z + pos.getZ(i)) * scale;
          const wx = group.position.x + c * lx + s * lz;
          const wz = group.position.z - s * lx + c * lz;
          pos.setY(i, (worldState.heightFn(wx, wz) - group.position.y) / scale + lift - child.position.y);
        }
        pos.needsUpdate = true;
        child.geometry.computeVertexNormals();
        continue;
      }
      const lx = child.position.x * scale;
      const lz = child.position.z * scale;
      const wx = group.position.x + c * lx + s * lz;
      const wz = group.position.z - s * lx + c * lz;
      child.position.y = (worldState.heightFn(wx, wz) - group.position.y) / scale + lift;
    }
  }
  function alignGroupUpToTerrainNormal(group, normal, yaw) {
    const align = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      normal
    );
    const spin = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      yaw
    );
    group.quaternion.copy(align.multiply(spin));
  }
  // WATER_SURFACE_Y (ARC-008, imported from world-constants.js) separates
  // underwater coral spawns from above-water flora in water biomes.
  // Local-space top of a coral at scale=1 (base height + tilted branch + tip
  // ball). Used to compute the max scale that still fits beneath the water
  // surface so corals never poke through.
  const REEF_CORAL_TOP_LOCAL = {
    coral: 1.3,
    braincoral: 0.42,
    cupcoral: 0.62,
  };
  const CORAL_SUBMERGE_MARGIN = 0.08;
  const CORAL_MIN_SCALE = 0.55;
  // Reeds want wet roots near the waterline; seaweed belongs farther down on
  // submerged shelves where its height can scale toward the surface.
  const SHALLOW_WATER_FLORA = new Set(["reed"]);
  const MEDIUM_DEEP_WATER_FLORA = new Set(["seaweed"]);
  const WATER_FLORA_MARGIN = 0.02;
  const WATER_FLORA_DEPTH_RANGE = {
    reed: [WATER_FLORA_MARGIN, 0.45],
    seaweed: [2.1, 3.7],
  };
  const WATER_FLORA_SURFACE_CLEARANCE = 0.10;

  if (biome.groveDetails?.fairyRing) {
    let choice = null;
    for (let tries = 0; tries < 36; tries++) {
      const p = pickWorldGroundPoint(0.42);
      const y0 = worldState.heightFn(p.x, p.z);
      const s = 1.05 + Math.random() * 0.22;
      const fp = FLORA_FOOTPRINT.fairyring * s;
      if (blocksFloraPlacement(p.x, p.z, fp * 1.1)) continue;
      if (!choice || y0 > choice.y0) choice = { p, y0, s, fp };
      if (y0 >= -0.2) break;
    }
    if (choice) {
      const { p, y0, s, fp } = choice;
      const landmark = FLORA_BUILDERS.fairyring(biome);
      landmark.userData.inspect = { category: "flora", variant: "fairyring" };
      attachCatalogMetadata(landmark);
      const y = Math.min(
        y0,
        worldState.heightFn(p.x + fp, p.z),
        worldState.heightFn(p.x - fp, p.z),
        worldState.heightFn(p.x, p.z + fp),
        worldState.heightFn(p.x, p.z - fp)
      ) - FLORA_BURY;
      landmark.position.set(p.x, y, p.z);
      landmark.rotation.y = Math.random() * Math.PI * 2;
      landmark.scale.setScalar(s);
      // Flatten terrain vertices inside the ring so mushrooms sit level.
      flattenTerrainCircle(p.x, p.z, fp * 1.66, y);
      conformSurfaceChildrenToTerrain(landmark);
      worldState.world.add(landmark);
      floraPlacementBlocks.push({ kind: "fairyring", x: p.x, z: p.z, r: fp * 1.1 });
      worldState.obstacles.push({
        kind: "fairyring",
        x: p.x,
        z: p.z,
        r: fp * 1.1,
        top: y0 + (OBSTACLE_TOP.fairyring ?? OBSTACLE_TOP_DEFAULT) * s,
      });
      // Spawn will-o-wisps around the fairy ring
      const wispCount = landmark.userData.willowispCount ?? 0;
      for (let wi = 0; wi < wispCount; wi++) {
        const wisp = makeWillOWisp(p.x, y, p.z, fp * 2, biome);
        worldState.world.add(wisp.group);
        worldState.willowisps.push(wisp);
      }
      placed++;
    }
  }

  await yieldIfNeeded();

  // Patch heightFn to reflect flattened terrain pads so all subsequent
  // flora placement and conformSurfaceChildren see the real mesh heights.
  // Shared with the portal preview's identical patch (ARC-003/QA-013).
  worldState.heightFn = applyFlatZonesToHeightFn(worldState.heightFn, terrainFlatZones);

  // Pre-build the PBR detail-texture families this biome's flora needs, one
  // family per frame-budget slice. Each family paints several canvases
  // synchronously (10–20ms on slower devices); built lazily it would hitch
  // the loading animation when the first instance of a kind constructs. The
  // builders consume no Math.random, so the seeded window is unaffected.
  for (const prewarm of pbrDetailPrewarmSteps(biome)) {
    prewarm();
    await yieldIfNeeded(true);
  }

  // QA-014: the grass-shorten-radius clamp is repeated at every flora
  // placement site (flyer nests, normal flora, giant-flora promotion).
  function clampGrassShortenRadius(footprintRadius) {
    return Math.min(
      GRASS_SHORTEN_MAX_RADIUS,
      Math.max(GRASS_SHORTEN_MIN_RADIUS, footprintRadius * GRASS_SHORTEN_PAD)
    );
  }
  // ARC-010/QA-014: a biome may declare one `giantFlora` kind that gets
  // promoted to an oversized landmark instance the first time it's rolled
  // near the island center (grove's bigmushroom, verdant's leafballtree).
  // Replaces the old `biome.id === "grove"` / `biome.id === "verdant"`
  // branches with a single shared promotion check driven by the biome flag.
  function computeGiantFloraPromotion(kind, p, footprintBase, s, placementBlockKinds) {
    const giant = biome.giantFlora;
    if (!giant || kind !== giant.kind) return null;
    const centers = worldState.currentLayout.centers;
    let bestDx = p.x - centers[0].cx, bestDz = p.z - centers[0].cz;
    for (let ci = 1; ci < centers.length; ci++) {
      const ddx = p.x - centers[ci].cx, ddz = p.z - centers[ci].cz;
      if (ddx * ddx + ddz * ddz < bestDx * bestDx + bestDz * bestDz) { bestDx = ddx; bestDz = ddz; }
    }
    const distFromCenter = Math.sqrt(bestDx * bestDx + bestDz * bestDz);
    if (distFromCenter > worldState.ISLAND_RADIUS * giant.maxRadiusFrac) return { tooFar: true };
    const giantS = s * giant.scaleMul;
    const giantFp = footprintBase * giantS;
    if (
      blocksFloraPlacement(p.x, p.z, giantFp * 1.2, placementBlockKinds) ||
      (CANOPY_SPACING_KINDS.has(kind) && blocksFloraPlacement(p.x, p.z, giantFp * CANOPY_SPACING_PAD, CANOPY_SPACING_KINDS))
    ) {
      return { blocked: true };
    }
    return { s: giantS, fp: giantFp, grassShortenRadius: clampGrassShortenRadius(giantFp) };
  }

  let giantFloraPlaced = false;
  while (placed < floraTarget && attempts < floraTarget * 6) {
    attempts++;
    if ((attempts & 7) === 0) await yieldIfNeeded();
    const kind = biome.flora[Math.floor(Math.random() * biome.flora.length)];
    // Reef corals and water-rooted flora sample the wider falloff band where
    // heights dip below sea level, while normal flora stays on dry/near-dry
    // ground.
    const isReefCoral = biome.water && kind in REEF_CORAL_TOP_LOCAL;
    const isShallowWaterFlora = biome.water && SHALLOW_WATER_FLORA.has(kind);
    const isMediumDeepWaterFlora = biome.water && MEDIUM_DEEP_WATER_FLORA.has(kind);
    const waterFloraDepthRange = isShallowWaterFlora || isMediumDeepWaterFlora
      ? WATER_FLORA_DEPTH_RANGE[kind]
      : null;
    const normalFloraRadius = biome.treeFloraRadiusFrac !== undefined && (kind === "tree" || kind === "leafballtree")
      ? biome.treeFloraRadiusFrac
      : 0.88;
    let p = pickWorldGroundPoint(isReefCoral || waterFloraDepthRange ? 1.0 : normalFloraRadius);
    let y0 = worldState.heightFn(p.x, p.z);
    if (isReefCoral) {
      if (y0 > WATER_SURFACE_Y - 0.05) continue; // not submerged enough
      if (y0 < -1.8) continue; // void / extreme depth
    } else if (waterFloraDepthRange) {
      const depth = WATER_SURFACE_Y - y0;
      if (depth < waterFloraDepthRange[0]) continue;
      if (depth > waterFloraDepthRange[1]) continue;
    } else if (biome.water && y0 < WATER_SURFACE_Y + 0.04) {
      continue; // keep beach flora and limestone above the waterline
    } else if (y0 < -0.3) {
      continue; // skip steep cliffs / void
    }
    // Hard cap on crystals — they each spawn a point light, and we want at
    // most 4 in any world to keep the shader cost (and the visual chaos) down.
    if (kind === "crystal" && crystalCount >= CRYSTAL_CAP) continue;
    // Slope-plant: sample heightFn at four offsets around the trunk axis
    // and sink the base to the lowest sample minus FLORA_BURY. On a slope
    // this keeps the downhill side buried instead of floating out of the
    // terrain. Footprint scales with flora kind (and with the random scale
    // applied below so a 1.4× tree gets a wider sample than a 0.7× one).
    let s = 0.7 + Math.random() * 0.7;
    // Double the scale for tree types
    if (kind === "tree" || kind === "leafballtree" || kind === "pine" || kind === "snowpine" || kind === "deadtree" || kind === "balloontree") s *= 2;
    if (kind === "berrybush") s *= 1 + Math.random() * 0.25;
    if (kind === "flyer_nest") s = Math.max(s, 1.05);
    const footprintBase = FLORA_FOOTPRINT[kind] ?? FLORA_FOOTPRINT_DEFAULT;
    let fp = footprintBase * s;
    let nestHost = null;
    let nestGroundPose = null;
    if (kind === "flyer_nest") {
      nestHost = pickNestHost(fp);
      if (nestHost) {
        p = { x: nestHost.x, z: nestHost.z };
        y0 = nestHost.groundY;
      } else {
        nestGroundPose = getFlyerNestGroundPose(p.x, p.z, fp, s);
        if (!nestGroundPose) continue;
        y0 = nestGroundPose.groundY;
      }
    }
    let grassShortenRadius = clampGrassShortenRadius(fp);
    const placementBlockKinds = kind === "lavafissure" ? null : PLACEMENT_BLOCK_KINDS;
    if (kind === "flyer_nest" && !nestHost && blocksNestPlacement(p.x, p.z, fp * 1.2)) continue;
    if (kind !== "flyer_nest" && blocksFloraPlacement(p.x, p.z, fp * 1.2, placementBlockKinds)) continue;
    if (CANOPY_SPACING_KINDS.has(kind) && blocksFloraPlacement(p.x, p.z, fp * CANOPY_SPACING_PAD, CANOPY_SPACING_KINDS)) continue;
    const f = FLORA_BUILDERS[kind](biome);
    f.userData.inspect = { category: "flora", variant: kind };
    attachCatalogMetadata(f);
    const hXp = worldState.heightFn(p.x + fp, p.z);
    const hXm = worldState.heightFn(p.x - fp, p.z);
    const hZp = worldState.heightFn(p.x, p.z + fp);
    const hZm = worldState.heightFn(p.x, p.z - fp);
    let y = nestGroundPose ? nestGroundPose.y : Math.min(y0, hXp, hXm, hZp, hZm) - FLORA_BURY;
    if (kind === "flyer_nest" && nestHost) y = nestHost.y - 0.08 * s;
    if (isReefCoral) {
      // Clamp scale so the tallest tip stays below the water surface.
      const maxScale = (WATER_SURFACE_Y - CORAL_SUBMERGE_MARGIN - y) / REEF_CORAL_TOP_LOCAL[kind];
      if (maxScale < CORAL_MIN_SCALE) continue;
      s = Math.min(s, maxScale);
    } else if (waterFloraDepthRange && f.userData.surfaceReachRange) {
      const depth = WATER_SURFACE_Y - y;
      const surfaceReach = f.userData.surfaceReachRange;
      const targetReach = surfaceReach[0] + Math.random() * (surfaceReach[1] - surfaceReach[0]);
      const maxHeight = Math.max(0, depth - WATER_FLORA_SURFACE_CLEARANCE);
      const targetHeight = Math.min(depth * targetReach, maxHeight);
      const baseHeight = f.userData.baseHeight ?? 1;
      if (targetHeight <= 0) continue;
      s = targetHeight / baseHeight;
    }
    f.position.set(p.x, y, p.z);
    const yaw = Math.random() * Math.PI * 2;
    if (kind === "berrybush") {
      const normal = new THREE.Vector3(hXm - hXp, 2 * fp, hZm - hZp).normalize();
      alignGroupUpToTerrainNormal(f, normal, yaw);
    } else {
      f.rotation.y = yaw;
    }
    f.scale.setScalar(s);
    // Giant-flora promotion (ARC-010/QA-014): a biome's declared `giantFlora`
    // kind gets promoted to one oversized landmark instance near the island
    // center. See computeGiantFloraPromotion above.
    if (!giantFloraPlaced) {
      const promotion = computeGiantFloraPromotion(kind, p, footprintBase, s, placementBlockKinds);
      if (promotion?.tooFar || promotion?.blocked) continue;
      if (promotion) {
        s = promotion.s;
        fp = promotion.fp;
        grassShortenRadius = promotion.grassShortenRadius;
        f.scale.setScalar(s);
        giantFloraPlaced = true;
        if (biome.giantFlora.effect === "muteWind") {
          // Disable wind on the giant mushroom — at 4× scale the sway
          // amplitude looks exaggerated and comical. Clone materials first
          // so other bigmushroom instances (which share pooled materials)
          // are not affected.
          f.traverse((child) => {
            if (child.isMesh && child.material) {
              const prev = child.material.onBeforeCompile;
              child.material = child.material.clone();
              child.material.onBeforeCompile = (shader) => {
                prev(shader);
                if (shader.uniforms.uWindStrength) shader.uniforms.uWindStrength.value = 0;
              };
            }
          });
          // Zero perchWind so creatures perched on the cap don't bob.
          f.userData.perchWind = { strength: 0, localY: f.userData.perchWind?.localY ?? 0 };
        } else if (biome.giantFlora.effect === "willowisp") {
          // Will-o-wisp that orbits and flies above the giant tree.
          // Avoidance sphere keeps it outside the canopy volume.
          // Canopy center: y + 1.46 * s, canopy max radius: 0.88 * s ≈ 2.64 at 3×
          const canopyCenterY = y + 1.46 * s;
          const canopyR = 1.3 * s + 0.5; // full canopy extent + padding
          const wisp = makeWillOWisp(p.x, canopyCenterY, p.z, canopyR + 0.8, biome);
          wisp.innerRadius = canopyR;
          wisp.avoidX = p.x;
          wisp.avoidY = canopyCenterY;
          wisp.avoidZ = p.z;
          wisp.avoidR = canopyR;
          // Start outside the canopy
          const startAngle = Math.random() * Math.PI * 2;
          wisp.group.position.set(
            p.x + Math.cos(startAngle) * (canopyR + 0.5),
            canopyCenterY + canopyR,
            p.z + Math.sin(startAngle) * (canopyR + 0.5)
          );
          worldState.world.add(wisp.group);
          worldState.willowisps.push(wisp);
        }
      }
    }
    if (kind === "lavafissure" || kind === "mushroom" || kind === "bigmushroom") conformSurfaceChildrenToTerrain(f);
    if (kind === "crystal") {
      const glow = new THREE.PointLight(new THREE.Color(biome.accent), 1.4, 6.5, 1.8);
      glow.position.set(0, 0.6, 0); // sits inside the cluster
      f.add(glow);
      crystalCount++;
    }
    if (kind === "lavafissure" && fissureLightCount < FISSURE_LIGHT_CAP) {
      const glow = new THREE.PointLight(new THREE.Color(biome.accent), 1.25, 5.5, 2.0);
      glow.position.set(0, 0.22, 0);
      f.add(glow);
      fissureLightCount++;
    }
    worldState.world.add(f);
    // Berry bushes and dandy lions are nectar targets for bees alongside flowers.
    if (kind === "berrybush" || kind === "dandylion") {
      worldState.flowerSpots.push({ x: p.x, y: y + (f.userData.flowerSpotY ?? 0.3) * s, z: p.z });
    }
    const floraBlock = {
      kind,
      x: p.x,
      z: p.z,
      grassRadius: grassShortenRadius,
      r: fp * (CANOPY_SPACING_KINDS.has(kind) ? CANOPY_SPACING_PAD : 1.2),
    };
    floraPlacementBlocks.push(floraBlock);
    if (NEST_HOST_KINDS.has(kind)) {
      const hostTopLocal = f.userData.capTopY ?? f.userData.obstacleTopY ?? OBSTACLE_TOP[kind] ?? OBSTACLE_TOP_DEFAULT;
      const nestHostRadius = (f.userData.nestHostRadius ?? f.userData.perchRadius ?? 0) * s;
      if (kind !== "pillar" || nestHostRadius >= MIN_NEST_HOST_RADIUS) {
        nestHosts.push({
          hostKind: kind,
          x: p.x,
          z: p.z,
          y: y + hostTopLocal * s,
          groundY: y0,
          hostRadius: nestHostRadius,
          block: floraBlock,
          nestOccupied: false,
        });
      }
    }
    if (OBSTACLE_KINDS.has(kind)) {
      const topLocal = (f.userData.obstacleTopY ?? OBSTACLE_TOP[kind] ?? OBSTACLE_TOP_DEFAULT) * s;
      const fissurePts = kind === "lavafissure" ? f.userData.fissureObstaclePoints : null;
      if (Array.isArray(fissurePts) && fissurePts.length) {
        const c = Math.cos(f.rotation.y);
        const sy = Math.sin(f.rotation.y);
        for (const pt of fissurePts) {
          const lx = pt.x * s;
          const lz = pt.z * s;
          const wx = p.x + c * lx + sy * lz;
          const wz = p.z - sy * lx + c * lz;
          worldState.obstacles.push({
            kind,
            x: wx,
            z: wz,
            r: (pt.r ?? 0.24) * s * OBSTACLE_PAD,
            top: worldState.heightFn(wx, wz) + topLocal,
          });
        }
      } else {
        const topY = kind === "flyer_nest" && nestHost ? y + topLocal : y0 + topLocal;
        worldState.obstacles.push({
          kind,
          x: p.x,
          z: p.z,
          r: fp * OBSTACLE_PAD,
          top: topY,
        });
      }
      // Mushrooms, leafball canopies, and flyer nests double as landing pads for fliers —
      // record the cap top so the perch-aware flier landing code can steer
      // toward it. Use the builder-supplied local cap-top (accurate to the
      // per-instance random stemH on bigmushroom) rather than the coarse
      // OBSTACLE_TOP estimate, so fliers actually touch the cap.
      if (kind === "mushroom" || kind === "bigmushroom" || kind === "leafballtree" || kind === "flyer_nest") {
        const capLocal = f.userData.capTopY ?? f.userData.obstacleTopY ?? OBSTACLE_TOP[kind] ?? OBSTACLE_TOP_DEFAULT;
        worldState.perchSpots.push({
          x: p.x,
          z: p.z,
          y: y + capLocal * s,
          perchKind: kind,
          perchRadius: (f.userData.perchRadius ?? 0.4) * s,
          perchWind: f.userData.perchWind
            ? { ...f.userData.perchWind, scale: s, rotationY: f.rotation.y, baseX: p.x, baseZ: p.z }
            : null,
        });
      }
    }
    // Tight, ominous fly cloud over some skulls — not every skull gets one,
    // so the swarms read as a found detail rather than a uniform decoration.
    // OBSTACLE_TOP for skull (1.5) is a loose obstacle-avoidance estimate, not
    // the actual mesh top — the cranium only reaches ~0.33 locally. Place the
    // swarm at eye-socket level so flies look like they're crawling on the
    // skull rather than hovering somewhere above it.
    if (kind === "skull" && Math.random() < 0.55) {
      const swarm = makeFlySwarm(p.x, y + 0.5 * s, p.z);
      worldState.world.add(swarm);
      worldState.flySwarms.push(swarm);
    }
    if (isReefCoral) coralPlaced++;
    placed++;
    await yieldIfNeeded();
  }

  // Coral top-up — the main loop's attempt budget gets eaten by underwater
  // rejection and scale-clamp skips, so it under-places reef pieces. Run a
  // reef-only pass with an absolute target tied to floraTarget.
  const reefKinds = biome.water
    ? [...new Set(biome.flora.filter((kind) => kind in REEF_CORAL_TOP_LOCAL))]
    : [];
  if (reefKinds.length > 0) {
    const coralTarget = Math.round(floraTarget * 0.5);
    let coralAttempts = 0;
    while (coralPlaced < coralTarget && coralAttempts < coralTarget * 12) {
      coralAttempts++;
      if ((coralAttempts & 7) === 0) await yieldIfNeeded();
      const kind = reefKinds[Math.floor(Math.random() * reefKinds.length)];
      const p = pickWorldGroundPoint(1.0);
      const y0 = worldState.heightFn(p.x, p.z);
      if (y0 > WATER_SURFACE_Y - 0.05) continue;
      if (y0 < -3.0) continue; // void / past the underwater shelf
      let s = 0.7 + Math.random() * 0.7;
      const fp = (FLORA_FOOTPRINT[kind] ?? FLORA_FOOTPRINT_DEFAULT) * s;
      const y = Math.min(
        y0,
        worldState.heightFn(p.x + fp, p.z),
        worldState.heightFn(p.x - fp, p.z),
        worldState.heightFn(p.x, p.z + fp),
        worldState.heightFn(p.x, p.z - fp)
      ) - FLORA_BURY;
      const maxScale = (WATER_SURFACE_Y - CORAL_SUBMERGE_MARGIN - y) / REEF_CORAL_TOP_LOCAL[kind];
      if (maxScale < CORAL_MIN_SCALE) continue;
      s = Math.min(s, maxScale);
      const f = FLORA_BUILDERS[kind](biome);
      f.userData.inspect = { category: "flora", variant: kind };
      attachCatalogMetadata(f);
      f.position.set(p.x, y, p.z);
      f.rotation.y = Math.random() * Math.PI * 2;
      f.scale.setScalar(s);
      worldState.world.add(f);
      coralPlaced++;
      await yieldIfNeeded();
    }
  }

  await yieldIfNeeded(true);

  await placeGroundCover({ worldState, biome, floraPlacementBlocks, attachCatalogMetadata, yieldIfNeeded });

  return { placed, blocksPlacement, GROUND_CREATURE_BLOCK_KINDS, placeFlyerNest };
}
