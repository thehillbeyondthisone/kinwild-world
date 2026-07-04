import { FLOWER_DENSITY, WILDFLOWER_PALETTES } from "../biomes.js";
import { randInt } from "../util.js";
import {
  makeCreature,
  makeCaterpillar,
  makeButterfly,
  makeBee,
  makeSwarm,
  creaturePoolResources,
  caterpillarPoolResources,
} from "../fauna.js";
import { disposeGroup } from "../state.js";

// Creature/caterpillar/snail/butterfly/bee population. Extracted verbatim
// from generateWorld's fauna section (QA-008) — `yieldIfNeeded` calls below
// sit at the exact positions they did inside generateWorld, since this
// function is awaited at that same point. `blocksPlacement`,
// `GROUND_CREATURE_BLOCK_KINDS`, and `placeFlyerNest` are the flora-placement
// phase's helpers, reused here for ground-creature collision checks and the
// post-creature flyer-nest top-up.
export async function populateFauna({
  worldState,
  biome,
  densityScale,
  pickWorldGroundPoint,
  blocksPlacement,
  GROUND_CREATURE_BLOCK_KINDS,
  placeFlyerNest,
  yieldIfNeeded,
}) {
  // creatures — fish biomes don't get sleepers/burrowers (they float).
  // We treat ncreatures as a budget; family parents consume +1 per kid,
  // so the actual headcount can be slightly higher than the configured range.
  const ncreatures = Math.max(1, Math.round(randInt(...biome.creatureCount) * densityScale));
  const allowGroundVariants = biome.creatureKind !== "fish";
  const shouldGuaranteeBurrower = biome.guaranteeBurrower === true && allowGroundVariants;
  let budget = ncreatures;
  // In water biomes, raise the minimum-Y threshold so ground creatures don't
  // spawn submerged. Fish are the exception: they spawn on underwater shelves
  // and their step logic keeps them swimming below the surface.
  const groundMinY = biome.water ? 0.05 : 0;
  const fishSurfaceY = -0.24;
  const fishMinGroundY = -4.2;
  function fishMaxGroundY(scale) {
    return fishSurfaceY - 0.66 * scale;
  }
  function placeFishUnderwater(c) {
    let p = { x: 0, z: 0 };
    let y = 0;
    let found = false;
    for (let tries = 0; tries < 120; tries++) {
      p = pickWorldGroundPoint(1.0);
      y = worldState.heightFn(p.x, p.z);
      if (y <= fishMaxGroundY(c.scale) && y > fishMinGroundY) {
        found = true;
        break;
      }
    }
    if (!found) return false;
    const halfBodyY = 0.42 * c.bodyBaseY * c.scale;
    const topY = fishSurfaceY + 0.04 - halfBodyY;
    const bottomY = y + halfBodyY + 0.04;
    const swimY = bottomY + (topY - bottomY) * (0.4 + Math.random() * 0.25);
    c.group.position.set(p.x, swimY, p.z);
    worldState.world.add(c.group);
    worldState.creatures.push(c);
    return true;
  }
  function placeOnGround(c, { maxTries = 40 } = {}) {
    if (c.isFish && biome.water) {
      const placedFish = placeFishUnderwater(c);
      // ARC-004: skip the creature pool's currently-cached geometries/
      // materials — c.group may be the only consumer that hasn't been added
      // to worldState.world yet, but the pool map itself (and therefore any
      // other already-placed creature sharing a key) still holds them.
      if (!placedFish) disposeGroup(c.group, { skip: creaturePoolResources() });
      return placedFish;
    }
    let p = { x: 0, z: 0 };
    let y = -10;
    let found = false;
    for (let tries = 0; tries < maxTries; tries++) {
      p = pickWorldGroundPoint(0.65);
      y = worldState.heightFn(p.x, p.z);
      if (y >= groundMinY && !blocksPlacement(p.x, p.z, 0.35, GROUND_CREATURE_BLOCK_KINDS)) {
        found = true;
        break;
      }
    }
    if (!found) {
      disposeGroup(c.group, { skip: creaturePoolResources() });
      return false;
    }
    c.group.position.set(p.x, y + 0.4, p.z);
    worldState.world.add(c.group);
    worldState.creatures.push(c);
    return true;
  }
  if (shouldGuaranteeBurrower && budget > 0) {
    if (placeOnGround(makeCreature(biome, { burrower: true }), { maxTries: 120 })) budget--;
  }
  let creatureAttempts = 0;
  while (budget > 0 && creatureAttempts < ncreatures * 10) {
    creatureAttempts++;
    if ((creatureAttempts & 3) === 0) await yieldIfNeeded();
    const r = Math.random();
    // budget rolls: family (parent + kids), sleeper, burrower, plain
    if (allowGroundVariants && budget >= 2 && r < 0.18) {
      // family group — 1 parent + 1-2 kids
      const parent = makeCreature(biome, { role: "parent" });
      if (!placeOnGround(parent)) continue;
      budget--;
      const kidCount = Math.min(budget, 1 + (Math.random() < 0.5 ? 1 : 0));
      for (let k = 0; k < kidCount; k++) {
        const kid = makeCreature(biome, {
          role: "kid",
          parent,
          sizeMul: 0.6 + Math.random() * 0.1,
        });
        // spawn near the parent so they don't tow from the void
        const pp = parent.group.position;
        let kidPlaced = false;
        for (let tries = 0; tries < 8; tries++) {
          const ang = Math.random() * Math.PI * 2;
          const off = 1.0 + Math.random() * 0.8;
          const nx = pp.x + Math.cos(ang) * off;
          const nz = pp.z + Math.sin(ang) * off;
          if (blocksPlacement(nx, nz, 0.3, GROUND_CREATURE_BLOCK_KINDS)) continue;
          kid.group.position.set(nx, worldState.heightFn(nx, nz) + 0.4, nz);
          worldState.world.add(kid.group);
          worldState.creatures.push(kid);
          budget--;
          kidPlaced = true;
          break;
        }
        if (!kidPlaced) disposeGroup(kid.group, { skip: creaturePoolResources() });
      }
    } else if (allowGroundVariants && r < 0.30) {
      if (placeOnGround(makeCreature(biome, { sleeper: true }))) budget--;
    } else if (allowGroundVariants && r < 0.38) {
      if (placeOnGround(makeCreature(biome, { burrower: true }))) budget--;
    } else {
      const bumbleConfig = biome.flyerVariants?.[0];
      if (bumbleConfig && Math.random() < 0.35) {
        if (placeOnGround(makeCreature(biome, {
          variant: bumbleConfig.kind,
          stripeColors: bumbleConfig.stripeOverride,
        }))) budget--;
      } else {
        if (placeOnGround(makeCreature(biome))) budget--;
      }
    }
  }

  if (biome.anglerFish && biome.water) {
    const nAnglers = 2 + Math.floor(Math.random() * 3);
    let anglersPlaced = 0;
    let anglerAttempts = 0;
    while (anglersPlaced < nAnglers && anglerAttempts < nAnglers * 20) {
      anglerAttempts++;
      if ((anglerAttempts & 3) === 0) await yieldIfNeeded();
      const angler = makeCreature(biome, { angler: true });
      if (placeFishUnderwater(angler)) {
        anglersPlaced++;
      } else {
        disposeGroup(angler.group, { skip: creaturePoolResources() });
      }
    }
  }

  const flyerCount = worldState.creatures.filter((c) => c.flies && !c.isFish && !c.isBee).length;
  const flyerNestTarget = biome.noFlyerNests ? 0 : flyerCount < 4 ? flyerCount : Math.ceil(flyerCount / 2);
  let flyerNestPlaced = 0;
  let flyerNestAttempts = 0;
  while (flyerNestPlaced < flyerNestTarget && flyerNestAttempts < flyerNestTarget * 80) {
    flyerNestAttempts++;
    if (placeFlyerNest()) flyerNestPlaced++;
    if ((flyerNestAttempts & 7) === 0) await yieldIfNeeded();
  }

  // caterpillars — multi-segment crawlers, occasionally swapped for snails
  // Crawlers also avoid spawning inside fairy rings (large obstacle discs
  // that the "turn" avoidance response can't escape from).
  const CRAWLER_BLOCK_KINDS = new Set(["lavafissure", "fairyring", "portal"]);
  function placeCrawler(make) {
    for (let tries = 0; tries < 12; tries++) {
      const crawler = make();
      const head = crawler.segments?.[0];
      if (head && !blocksPlacement(head.position.x, head.position.z, 0.28 * crawler.scale, CRAWLER_BLOCK_KINDS)) {
        worldState.world.add(crawler.group);
        worldState.caterpillars.push(crawler);
        return true;
      }
      // QA-L05/ARC-004: skip the now-pooled eye/pupil geometries/materials —
      // this crawler may be the only consumer that hasn't been added to
      // worldState.world yet, but the pool map (and any other already-placed
      // caterpillar sharing a key) still holds them.
      disposeGroup(crawler.group, { skip: caterpillarPoolResources() });
    }
    return false;
  }

  const ncats = biome.noCaterpillars ? 0 : 1 + Math.floor(Math.random() * 3); // 1–3
  for (let i = 0; i < ncats; i++) {
    placeCrawler(() => makeCaterpillar(biome));
    await yieldIfNeeded();
  }
  // snails — base 0-2 per world (cute, slow), with optional biome multiplier.
  // They live in the caterpillars array so they get stepped and ray-picked alongside their cousins.
  const baseSnails = Math.random() < 0.7 ? (Math.random() < 0.4 ? 2 : 1) : 0;
  const nsnails = Math.round(baseSnails * (biome.snailCountMultiplier ?? 1));
  for (let i = 0; i < nsnails; i++) {
    placeCrawler(() => makeCaterpillar(biome, { kind: "snail" }));
    await yieldIfNeeded();
  }

  // butterflies — drift between flower positions. Skipped in arid biomes
  // where butterflies read as out-of-place (the desert gets fly swarms over
  // skulls instead, set up during flora placement above).
  const flowerDensity = FLOWER_DENSITY[biome.id] ?? 100;
  const bMin = Math.max(2, Math.floor(flowerDensity / 30));
  const bMax = Math.max(bMin + 1, Math.floor(flowerDensity / 14));
  const nbutterflies = biome.noButterflies
    ? 0
    : bMin + Math.floor(Math.random() * (bMax - bMin + 1));
  const palette = WILDFLOWER_PALETTES[biome.id] ?? ["#ffffff"];
  for (let i = 0; i < nbutterflies; i++) {
    const bf = makeButterfly(palette, biome);
    if (worldState.flowerSpots.length) {
      const f = worldState.flowerSpots[Math.floor(Math.random() * worldState.flowerSpots.length)];
      bf.group.position.set(
        f.x + (Math.random() - 0.5) * 1.5,
        f.y + 0.6 + Math.random() * 0.8,
        f.z + (Math.random() - 0.5) * 1.5
      );
    } else {
      const p = pickWorldGroundPoint(0.6);
      bf.group.position.set(p.x, 2, p.z);
    }
    worldState.world.add(bf.group);
    worldState.butterflies.push(bf);
    if ((i & 3) === 3) await yieldIfNeeded();
  }

  // bee swarms — 1-2 swarms of 4-8 bees, only if there are flowers to dance
  // around. Each swarm shares a target flower; bees flock to it together.
  if (worldState.flowerSpots.length > 0) {
    const swarmCount = 1 + (Math.random() < 0.55 ? 1 : 0);
    for (let s = 0; s < swarmCount; s++) {
      const swarm = makeSwarm();
      const beesInSwarm = 4 + Math.floor(Math.random() * 5);
      // seed the first target so all bees converge from frame 1
      const seed = worldState.flowerSpots[
        Math.floor(Math.random() * worldState.flowerSpots.length)
      ];
      swarm.target.set(seed.x, seed.y + 0.35, seed.z);
      swarm.hasTarget = true;
      swarm.retargetIn = 4 + Math.random() * 5;
      for (let i = 0; i < beesInSwarm; i++) {
        const bee = makeBee(swarm, biome);
        // spawn around the swarm seed flower
        bee.group.position.set(
          seed.x + (Math.random() - 0.5) * 1.0,
          seed.y + 0.4 + Math.random() * 0.6,
          seed.z + (Math.random() - 0.5) * 1.0
        );
        worldState.world.add(bee.group);
        worldState.bees.push(bee);
      }
      await yieldIfNeeded();
    }
  }

  await yieldIfNeeded(true);
}
