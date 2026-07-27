import * as THREE from "three";
import {
  INTEGRATION_CONTRACT_VERSION,
  PRESENTATION_EVENTS,
  createPresentationEventBus,
  createWorldContext,
  defineCreatureProvider,
  defineFloraProvider,
  readIntegrationFeatureFlags,
} from "../integration/index.js";
import {
  buildSpecies,
  createRng,
  hashSeed,
} from "../generated-flora/index.js";
import {
  createGeneratedFaunaWalker,
  seededUnit,
} from "../generated-fauna/index.js";
import { islandFalloff } from "../terrain.js";
import { makeDustKick } from "../environment.js";
import { catalogSubjectFromInspect } from "../catalog.js";
import { LOWFX } from "../lowfx.js";
import {
  LIVING_WORLD_PALETTE,
  LIVING_WORLD_STYLE_ID,
  createLivingFaunaDNA,
  createLivingFloraRecipes,
  createLivingWorldBiome,
  resolveLivingWorldFlags,
} from "./style.js";

export const LIVING_WORLD_OBSTACLE_KIND = "living:veilcrown";

const UP = new THREE.Vector3(0, 1, 0);
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const MIN_SURFACE_Y = -0.45;

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function writeVector(out, source) {
  if (typeof out?.copy === "function") return out.copy(source);
  if (typeof out?.set === "function") return out.set(source.x, source.y, source.z);
  out.x = source.x;
  out.y = source.y;
  out.z = source.z;
  return out;
}

function maxScale(object) {
  return Math.max(
    Math.abs(object.scale?.x ?? 1),
    Math.abs(object.scale?.y ?? 1),
    Math.abs(object.scale?.z ?? 1),
  );
}

function maxIslandFalloff(layout, x, z) {
  let value = 0;
  for (const center of layout?.centers ?? []) {
    value = Math.max(value, islandFalloff(center, x, z));
  }
  return value;
}

function sampleFootprint(worldState, x, z, radius) {
  const d = Math.max(0.15, radius * 0.7);
  const heights = [
    worldState.heightFn(x, z),
    worldState.heightFn(x + d, z),
    worldState.heightFn(x - d, z),
    worldState.heightFn(x, z + d),
    worldState.heightFn(x, z - d),
  ];
  return {
    center: heights[0],
    min: Math.min(...heights),
    max: Math.max(...heights),
    variance: Math.max(...heights) - Math.min(...heights),
  };
}

function obstacleClearance(worldState, x, z, radius) {
  let clearance = Infinity;
  for (const obstacle of worldState.obstacles ?? []) {
    const distance =
      Math.hypot(x - obstacle.x, z - obstacle.z) -
      radius -
      finite(obstacle.r);
    clearance = Math.min(clearance, distance);
  }
  return clearance;
}

/**
 * Choose a focal clearing with deterministic candidates. This stream is
 * namespaced, so adding generated content never shifts legacy world rolls.
 */
export function selectLivingWorldAnchor(worldState, seed, footprint = 2.4) {
  const layout = worldState.currentLayout;
  const centers = layout?.centers ?? [];
  const fallbackCenter = centers[0] ?? { cx: 0, cz: 0, radius: 20 };
  const rng = createRng(hashSeed(seed, LIVING_WORLD_STYLE_ID, "composition/anchor"));
  let best = null;

  for (let index = 0; index < 56; index++) {
    const center = centers[index % Math.max(1, centers.length)] ?? fallbackCenter;
    const angle =
      Math.PI * 0.25 +
      (index - 27.5) * GOLDEN_ANGLE +
      rng.range(-0.18, 0.18);
    const radial =
      center.radius *
      (0.07 + Math.sqrt(rng.next()) * 0.24);
    const x = center.cx + Math.cos(angle) * radial;
    const z = center.cz + Math.sin(angle) * radial;
    const falloff = maxIslandFalloff(layout, x, z);
    if (falloff < 0.72) continue;

    const surface = sampleFootprint(worldState, x, z, footprint);
    if (surface.min < MIN_SURFACE_Y || surface.variance > 0.62) continue;
    const clearance = obstacleClearance(worldState, x, z, footprint);
    if (clearance < 0.35) continue;

    const frontBias =
      ((x - center.cx) + (z - center.cz)) /
      Math.max(center.radius * 2, 1);
    const score =
      falloff * 2.2 -
      surface.variance * 2.8 +
      Math.min(clearance, 5) * 0.08 +
      frontBias * 0.36;
    if (!best || score > best.score) {
      best = { x, y: surface.center, z, score };
    }
  }

  if (best) return Object.freeze({ x: best.x, y: best.y, z: best.z });
  const x = fallbackCenter.cx;
  const z = fallbackCenter.cz;
  return Object.freeze({ x, y: worldState.heightFn(x, z), z });
}

/**
 * Serializable authored-feeling layout around the chosen focal clearing.
 */
export function planLivingComposition(seed, anchor, { lowfx = LOWFX } = {}) {
  const rng = createRng(hashSeed(seed, LIVING_WORLD_STYLE_ID, "composition/layout"));
  const flora = [{ role: "hero", ordinal: 0, x: anchor.x, z: anchor.z, scale: 1 }];
  const midCount = lowfx ? 4 : 9;
  const groundCount = lowfx ? 10 : 24;
  const faunaCount = lowfx ? 2 : 4;
  const facingAngle = Math.atan2(11.7, 10.8);
  const baseAngle = rng.range(-0.24, 0.24);
  const midClumps = [
    { angle: facingAngle - 1.38, radius: 5.05 },
    { angle: facingAngle + 1.25, radius: 4.65 },
    { angle: facingAngle + 2.65, radius: 5.4 },
  ];
  const midRankCenter =
    (Math.ceil(midCount / midClumps.length) - 1) * 0.5;

  for (let index = 0; index < midCount; index++) {
    const clump = midClumps[index % midClumps.length];
    const rank =
      Math.floor(index / midClumps.length) - midRankCenter;
    const angle =
      baseAngle +
      clump.angle +
      rank * 0.16 +
      rng.range(-0.13, 0.13);
    const radius =
      clump.radius +
      rank * 0.32 +
      rng.range(-0.2, 0.24);
    flora.push({
      role: "mid",
      ordinal: index,
      x: anchor.x + Math.cos(angle) * radius,
      z: anchor.z + Math.sin(angle) * radius,
      scale: rng.range(0.88, 1.12),
    });
  }

  const groundClumps = [
    { angle: facingAngle - 1.08, radius: 4.75 },
    { angle: facingAngle + 1.12, radius: 4.45 },
    { angle: facingAngle + 2.35, radius: 5.15 },
    { angle: facingAngle + 3.55, radius: 5.45 },
  ];
  const groundRankCenter =
    (Math.ceil(groundCount / groundClumps.length) - 1) * 0.5;
  for (let index = 0; index < groundCount; index++) {
    const clump = groundClumps[index % groundClumps.length];
    const rank =
      Math.floor(index / groundClumps.length) -
      groundRankCenter;
    const angle =
      baseAngle * 0.65 +
      clump.angle +
      rank * 0.11 +
      rng.range(-0.16, 0.16);
    const radius =
      clump.radius +
      rank * 0.18 +
      rng.range(-0.18, 0.22);
    flora.push({
      role: "ground",
      ordinal: index,
      x: anchor.x + Math.cos(angle) * radius,
      z: anchor.z + Math.sin(angle) * radius,
      scale: rng.range(0.84, 1.14),
    });
  }

  const fauna = [];
  for (let index = 0; index < faunaCount; index++) {
    fauna.push({
      ordinal: index,
      phase:
        -0.68 +
        (index / faunaCount) * Math.PI * 2 +
        (index === 0 ? 0 : baseAngle * 0.35),
      orbitRadius: 5.25 + (index % 2) * 1.15 + rng.range(-0.16, 0.22),
      direction: index % 2 === 0 ? 1 : -1,
      speed: rng.range(0.42, 0.62),
      scale: index === faunaCount - 1 && faunaCount > 2 ? 1.08 : rng.range(1.28, 1.48),
    });
  }

  return Object.freeze({
    styleId: LIVING_WORLD_STYLE_ID,
    anchor: Object.freeze({ ...anchor }),
    flora: Object.freeze(flora.map((record) => Object.freeze(record))),
    fauna: Object.freeze(fauna.map((record) => Object.freeze(record))),
  });
}

function isPlacementUsable(worldState, x, z, footprint, anchor) {
  const falloff = maxIslandFalloff(worldState.currentLayout, x, z);
  if (falloff < 0.58) return false;
  const sample = sampleFootprint(worldState, x, z, footprint);
  if (sample.center < MIN_SURFACE_Y || sample.variance > Math.max(0.74, footprint * 0.24)) {
    return false;
  }
  if (
    Math.hypot(x - anchor.x, z - anchor.z) > 1 &&
    obstacleClearance(worldState, x, z, footprint * 0.42) < 0.05
  ) {
    return false;
  }
  return true;
}

function repairPlacement(worldState, record, footprint, anchor) {
  const dx = record.x - anchor.x;
  const dz = record.z - anchor.z;
  const baseAngle =
    Math.atan2(dz, dx) + record.ordinal * 0.41;
  const stride = Math.min(
    1.15,
    Math.max(0.36, footprint * 0.38),
  );
  for (let attempt = 0; attempt < 19; attempt++) {
    const ring = attempt === 0 ? 0 : Math.ceil(attempt / 6);
    const spoke = attempt === 0 ? 0 : (attempt - 1) % 6;
    const angle =
      baseAngle +
      (spoke / 6) * Math.PI * 2 +
      ring * 0.27;
    const distance = ring * stride;
    const x = record.x + Math.cos(angle) * distance;
    const z = record.z + Math.sin(angle) * distance;
    if (isPlacementUsable(worldState, x, z, footprint, anchor)) {
      return {
        x,
        y: worldState.heightFn(x, z) + 0.012,
        z,
      };
    }
  }
  return null;
}

function makeFloraProvider(species, recipe) {
  const descriptor = Object.freeze({
    id: `kinwild:${recipe.key}`,
    kind: `generated:${recipe.key}`,
    footprint: species.bounds.footprintRadius,
    boundsRadius: species.bounds.radius,
    roles: Object.freeze([recipe.role, species.role]),
    habitat: Object.freeze({ styleId: LIVING_WORLD_STYLE_ID }),
    affordances: Object.freeze({
      types: Object.freeze([...species.affordanceSchema]),
    }),
  });

  return defineFloraProvider({
    id: descriptor.id,
    version: "1",
    capabilities: {
      generated: true,
      sharedResources: true,
      touch: true,
    },
    describe() {
      return descriptor;
    },
    create(request = {}) {
      const source = species.createInstance({
        id: request.id,
        position: request.position,
        rotationY: request.rotationY,
        scale: request.scale,
      });
      let disposed = false;
      const center = new THREE.Vector3();
      const instance = {
        contractVersion: INTEGRATION_CONTRACT_VERSION,
        source,
        root: source.group,
        interactionRoot: source.group,
        descriptor,
        bounds(out) {
          if (disposed) throw new Error("generated flora bridge is disposed");
          source.group.updateMatrix();
          center
            .set(...species.bounds.center)
            .applyMatrix4(source.group.matrix);
          writeVector(out, center);
          return species.bounds.radius * maxScale(source.group);
        },
        update(dt) {
          if (disposed) return source.touchState();
          return source.update(dt);
        },
        react(amount, direction) {
          if (disposed) return source.touchState();
          return source.touch(amount, direction);
        },
        affordances() {
          if (disposed) return [];
          source.group.updateMatrix();
          const radiusScale = maxScale(source.group);
          return source.affordances.map((affordance) => {
            const position = new THREE.Vector3(...affordance.position)
              .applyMatrix4(source.group.matrix);
            return {
              ...affordance,
              position,
              radius: affordance.radius * radiusScale,
              space: "world-parent-local",
            };
          });
        },
        dispose() {
          if (disposed) return false;
          disposed = true;
          source.dispose();
          return true;
        },
      };
      return Object.freeze(instance);
    },
  });
}

function makeCreatureProvider() {
  return defineCreatureProvider({
    id: "living-field:generated-fauna",
    version: "1",
    capabilities: {
      generated: true,
      externallyDriven: true,
      sdfShell: true,
    },
    create(request = {}) {
      return createGeneratedFaunaWalker({
        dna: request.dna,
        surface: request.surface,
        quality: request.quality,
        position: request.position,
        heading: request.heading,
      });
    },
  });
}

function addCatalogMetadata(object, biome, attachCatalogMetadata) {
  if (attachCatalogMetadata) {
    attachCatalogMetadata(object);
    return;
  }
  object.userData.catalog = catalogSubjectFromInspect(
    object.userData.inspect,
    biome,
  );
}

function alignFloraToSurface(instance, worldContext, yaw, alignToSlope) {
  if (!alignToSlope) {
    instance.root.rotation.y = yaw;
    return;
  }
  const normal = worldContext.surfaceNormalAt(
    instance.root.position.x,
    instance.root.position.z,
    new THREE.Vector3(),
  );
  const align = new THREE.Quaternion().setFromUnitVectors(UP, normal);
  const spin = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
  instance.root.quaternion.copy(align.multiply(spin));
}

function registerFloraAffordances(runtime, flora) {
  for (const affordance of flora.instance.affordances()) {
    const record = {
      x: affordance.position.x,
      y: affordance.position.y,
      z: affordance.position.z,
      source: flora,
    };
    if (affordance.type === "nectar") {
      runtime.worldState.flowerSpots.push(record);
      runtime.registrations.flowerSpots.push(record);
    } else if (affordance.type === "perch") {
      const perch = {
        ...record,
        perchKind: flora.recipe.variant,
        perchRadius: affordance.radius,
        perchWind: null,
      };
      runtime.worldState.perchSpots.push(perch);
      runtime.registrations.perches.push(perch);
    }
  }
}

function addLivingFlora(runtime, recipe, species, provider, record) {
  const footprint = species.bounds.footprintRadius * record.scale;
  const pose =
    recipe.role === "hero"
      ? {
          x: runtime.composition.anchor.x,
          y: runtime.worldState.heightFn(
            runtime.composition.anchor.x,
            runtime.composition.anchor.z,
          ) + 0.012,
          z: runtime.composition.anchor.z,
        }
      : repairPlacement(
          runtime.worldState,
          record,
          footprint,
          runtime.composition.anchor,
        );
  if (!pose) return null;
  const yawRng = runtime.rng.fork(`flora/${recipe.key}/${record.ordinal}/yaw`);
  const yaw = yawRng.range(0, Math.PI * 2);
  const instance = provider.create({
    id: `${recipe.key}:${record.ordinal}`,
    position: [pose.x, pose.y, pose.z],
    rotationY: yaw,
    scale: record.scale,
  }, runtime.world);
  alignFloraToSurface(
    instance,
    runtime.world,
    yaw,
    recipe.role !== "hero",
  );
  instance.root.userData.inspect = {
    category: "flora",
    variant: recipe.variant,
  };
  instance.root.userData.livingWorld = {
    styleId: LIVING_WORLD_STYLE_ID,
    speciesId: species.id,
    role: recipe.role,
  };
  addCatalogMetadata(
    instance.root,
    runtime.flags.livingWorld
      ? { id: LIVING_WORLD_STYLE_ID }
      : runtime.biome,
    runtime.attachCatalogMetadata,
  );
  runtime.worldState.world.add(instance.root);

  const flora = {
    recipe,
    species,
    instance,
    footprint,
    lastReactionAt: -Infinity,
  };
  runtime.flora.push(flora);
  registerFloraAffordances(runtime, flora);

  if (recipe.role === "hero") {
    const obstacle = {
      kind: LIVING_WORLD_OBSTACLE_KIND,
      x: pose.x,
      z: pose.z,
      r: Math.max(0.65, footprint * 0.72),
      top: pose.y + species.bounds.height * record.scale,
      source: flora,
    };
    runtime.worldState.obstacles.push(obstacle);
    runtime.registrations.obstacles.push(obstacle);
    runtime.hero = flora;
  }
  return flora;
}

function installLivingFieldLights(runtime) {
  if (!runtime.flags.livingWorld || runtime.lights.length > 0) return;
  const anchor = runtime.composition.anchor;
  const warm = new THREE.PointLight(
    LIVING_WORLD_PALETTE.amber,
    4.8,
    17,
    1.8,
  );
  warm.name = "kinwild-warm-field-light";
  warm.position.set(anchor.x + 1.8, anchor.y + 4.4, anchor.z + 0.8);
  const pulse = new THREE.PointLight(
    LIVING_WORLD_PALETTE.coral,
    2.4,
    11,
    2,
  );
  pulse.name = "kinwild-pulse-field-light";
  pulse.position.set(anchor.x - 3.8, anchor.y + 1.25, anchor.z + 2.6);
  runtime.worldState.world.add(warm, pulse);
  runtime.lights.push(warm, pulse);
}

export function populateLivingFlora(runtime) {
  if (!runtime?.flags.generatedFlora || runtime.disposed) return 0;
  const recipes = createLivingFloraRecipes(runtime.seed);
  const recipeByRole = new Map(recipes.map((recipe) => [recipe.role, recipe]));
  const speciesByRole = new Map();
  const providerByRole = new Map();

  for (const recipe of recipes) {
    const species = buildSpecies(recipe.dna, {
      biome: runtime.biome,
      palette: recipe.palette,
      seed: recipe.dna.seed,
    });
    const provider = makeFloraProvider(species, recipe);
    runtime.species.push(species);
    runtime.floraProviders.push(provider);
    speciesByRole.set(recipe.role, species);
    providerByRole.set(recipe.role, provider);
  }

  const heroSpecies = speciesByRole.get("hero");
  if (!runtime.composition) {
    const anchor = selectLivingWorldAnchor(
      runtime.worldState,
      runtime.seed,
      heroSpecies?.bounds.footprintRadius ?? 2.4,
    );
    runtime.composition = planLivingComposition(runtime.seed, anchor);
  }

  for (const record of runtime.composition.flora) {
    const recipe = recipeByRole.get(record.role);
    const species = speciesByRole.get(record.role);
    const provider = providerByRole.get(record.role);
    if (!recipe || !species || !provider) continue;
    addLivingFlora(runtime, recipe, species, provider, record);
  }
  installLivingFieldLights(runtime);
  return runtime.flora.length;
}

function makeFaunaFacade(runtime, agent, dna, scale, ordinal) {
  const bodyColor = new THREE.Color(dna.palette.body);
  const facade = {
    generated: true,
    generatedAgent: agent,
    group: agent.root,
    interactionRoot: agent.interactionRoot,
    traits: agent.traits,
    name: dna.name,
    speciesId: dna.speciesId,
    genomeHash: agent.genomeHash,
    scale,
    segRadius: agent.traits.radius / Math.max(scale, 1e-6),
    flies: false,
    isFish: false,
    isBee: false,
    landState: "landed",
    currentHover: 0,
    isSleeper: false,
    sleepiness: 0,
    bodyColor,
    colorBucket: bodyColor.getHexString(),
    eyeParts: agent.eyeParts,
    trackingAnchor: agent.anchors.head,
    heading: 0,
    lookTimer: 0,
    age: 0,
    place(position, heading = 0) {
      facade.heading = heading;
      agent.setIntent({
        position,
        velocity: { x: 0, z: 0 },
        heading,
      });
      return facade;
    },
    lookAt(target) {
      agent.setIntent({ lookTarget: target ?? null });
      return facade;
    },
    dispose() {
      return disposeLivingFaunaFacade(runtime, facade);
    },
  };
  agent.root.userData.inspect = {
    category: "fauna",
    variant: dna.speciesId,
  };
  agent.root.userData.livingWorld = {
    styleId: LIVING_WORLD_STYLE_ID,
    speciesId: dna.speciesId,
    genomeHash: agent.genomeHash,
    ordinal,
  };
  addCatalogMetadata(
    agent.root,
    runtime.flags.livingWorld
      ? { id: LIVING_WORLD_STYLE_ID }
      : runtime.biome,
    runtime.attachCatalogMetadata,
  );
  if (agent.root.userData.catalog) {
    agent.root.userData.catalog.label = dna.name;
  }
  if (ordinal === 0) facade.lookTimer = 7;
  return facade;
}

function disposeLivingFaunaFacade(runtime, facade) {
  const index = runtime.fauna.findIndex((actor) => actor.facade === facade);
  if (index < 0) return facade.generatedAgent.dispose();
  const [actor] = runtime.fauna.splice(index, 1);
  const creatureIndex = runtime.worldState.creatures.indexOf(facade);
  if (creatureIndex >= 0) {
    runtime.worldState.creatures.splice(creatureIndex, 1);
  }
  return actor.agent.dispose();
}

function faunaPathPoint(anchor, record, phase, out) {
  const lobe = Math.sin(phase * 2 + record.ordinal * 0.7) * 0.52;
  const radius = record.orbitRadius + lobe;
  return out.set(
    anchor.x + Math.cos(phase) * radius,
    0,
    anchor.z + Math.sin(phase) * radius * 0.78,
  );
}

function faunaPathTangent(record, phase, out) {
  const wave = phase * 2 + record.ordinal * 0.7;
  const radius = record.orbitRadius + Math.sin(wave) * 0.52;
  const radiusDerivative = Math.cos(wave) * 1.04;
  return out.set(
    (-Math.sin(phase) * radius + Math.cos(phase) * radiusDerivative) *
      record.direction,
    0,
    (Math.cos(phase) * radius + Math.sin(phase) * radiusDerivative) *
      0.78 *
      record.direction,
  );
}

export function populateLivingFauna(runtime) {
  if (!runtime?.flags.generatedFauna || runtime.disposed) return 0;
  if (!runtime.composition) {
    const anchor = selectLivingWorldAnchor(runtime.worldState, runtime.seed);
    runtime.composition = planLivingComposition(runtime.seed, anchor);
  }
  const provider = runtime.creatureProvider ?? makeCreatureProvider();
  runtime.creatureProvider = provider;
  for (const record of runtime.composition.fauna) {
    const dna = createLivingFaunaDNA(runtime.seed, record.ordinal);
    addLivingFaunaActor(runtime, provider, dna, record);
  }
  return runtime.fauna.length;
}

function addLivingFaunaActor(runtime, provider, dna, record) {
  const scratch = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const initial = faunaPathPoint(
    runtime.composition.anchor,
    record,
    record.phase,
    scratch,
  ).clone();
  faunaPathTangent(record, record.phase, tangent);
  const heading = Math.atan2(tangent.x, tangent.z);
  const agent = provider.create({
    dna,
    quality: LOWFX ? "low" : "medium",
    position: initial,
    heading,
  }, runtime.world);
  agent.root.scale.setScalar(record.scale);
  const actor = {
    agent,
    facade: null,
    record,
    phase: record.phase,
    position: initial,
    velocity: new THREE.Vector3(),
    nextProximityAt: record.ordinal * 0.07,
    intent: null,
    frame: null,
  };
  // Repair the spawn before the first terrain-planted pose. This keeps
  // obstacle correction from becoming a giant first-frame gait command.
  resolveAgainstObstacles(runtime, actor, initial);
  const facade = makeFaunaFacade(
    runtime,
    agent,
    agent.dna,
    record.scale,
    record.ordinal,
  );
  actor.facade = facade;
  actor.intent = {
    position: actor.position,
    velocity: actor.velocity,
    heading,
    lookTarget: null,
    action: "arrive",
  };
  actor.frame = {
    dt: 0,
    time: 0,
    surface: runtime.surface,
    intent: actor.intent,
  };
  facade.place(initial, heading);
  runtime.worldState.world.add(agent.root);
  agent.update(actor.frame);
  runtime.worldState.creatures.push(facade);
  runtime.fauna.push(actor);
  runtime.events.emit(
    PRESENTATION_EVENTS.CREATURE_SPAWN,
    { creature: facade, position: initial.clone() },
    { time: record.authored ? runtime.worldState.lastSimT ?? 0 : 0 },
  );
  return facade;
}

/**
 * Introduce validated semantic creature DNA into the running field.
 * The generated-fauna provider remains the authority for normalization,
 * budgets, geometry, animation, and terrain contact.
 */
export function introduceLivingFauna(runtime, dna, authoring = {}) {
  if (!runtime?.flags.generatedFauna || runtime.disposed) {
    throw new Error("A living field must be active before introducing a form.");
  }
  if (!runtime.composition) {
    const anchor = selectLivingWorldAnchor(runtime.worldState, runtime.seed);
    runtime.composition = planLivingComposition(runtime.seed, anchor);
  }
  const provider = runtime.creatureProvider ?? makeCreatureProvider();
  runtime.creatureProvider = provider;
  const ordinal = runtime.fauna.length;
  const authoredSeed = Number(dna?.seed) >>> 0;
  const record = Object.freeze({
    ordinal,
    phase:
      -0.68 +
      (ordinal / Math.max(ordinal + 1, 4)) * Math.PI * 2 +
      seededUnit(authoredSeed, "authored/phase") * 0.42,
    orbitRadius: 5.35 + seededUnit(authoredSeed, "authored/orbit") * 1.35,
    direction: seededUnit(authoredSeed, "authored/direction") < 0.5 ? -1 : 1,
    speed: 0.43 + seededUnit(authoredSeed, "authored/speed") * 0.22,
    scale: 1.26 + seededUnit(authoredSeed, "authored/scale") * 0.2,
    authored: true,
  });
  const facade = addLivingFaunaActor(runtime, provider, dna, record);
  const authoringRecord = Object.freeze({
    prompt:
      typeof authoring.prompt === "string"
        ? authoring.prompt.trim().slice(0, 500)
        : "",
    repairs: Object.freeze(
      Array.isArray(authoring.repairs)
        ? authoring.repairs.map((repair) => String(repair))
        : [],
    ),
  });
  facade.authoring = authoringRecord;
  facade.group.userData.authoring = authoringRecord;
  return facade;
}

function removeRegistered(array, registrations) {
  if (!Array.isArray(array) || registrations.length === 0) return;
  const removing = new Set(registrations);
  let write = 0;
  for (const entry of array) {
    if (!removing.has(entry)) array[write++] = entry;
  }
  array.length = write;
}

function touchFloraNear(runtime, point, amount, time, radius = 1.05) {
  let touched = null;
  let bestDistance = Infinity;
  for (const flora of runtime.flora) {
    const root = flora.instance.root;
    const dx = root.position.x - point.x;
    const dz = root.position.z - point.z;
    const distance = Math.hypot(dx, dz);
    const reach = Math.min(flora.footprint, 1.7) + radius;
    if (distance > reach || distance >= bestDistance) continue;
    if (time - flora.lastReactionAt < 0.09) continue;
    touched = flora;
    bestDistance = distance;
  }
  if (!touched) return false;
  touched.lastReactionAt = time;
  const root = touched.instance.root;
  const direction = {
    x: root.position.x - point.x,
    z: root.position.z - point.z,
  };
  touched.instance.react(amount, direction);
  runtime.events.emit(
    PRESENTATION_EVENTS.FLORA_REACT,
    {
      flora: touched,
      point: point.clone ? point.clone() : { ...point },
      amount,
    },
    { time },
  );
  return true;
}

function installPresentationReactions(runtime) {
  const unsubscribe = runtime.events.on(
    PRESENTATION_EVENTS.FOOTFALL,
    (event) => {
      const point = event.detail?.position;
      if (!point) return;
      touchFloraNear(runtime, point, 0.22, event.time ?? 0, 0.72);
      if (runtime.worldState.dustKicks.length >= (LOWFX ? 12 : 28)) return;
      const dust = makeDustKick(
        point.x,
        point.y,
        point.z,
        LIVING_WORLD_PALETTE.amber,
        {
          count: LOWFX ? 3 : 6,
          velocityScale: 0.78,
          size: LOWFX ? 0.07 : 0.095,
          opacity: 0.72,
          life: 0.42,
        },
      );
      runtime.worldState.world.add(dust);
      runtime.worldState.dustKicks.push(dust);
    },
  );
  runtime.unsubscribers.push(unsubscribe);
}

function resolveAgainstObstacles(runtime, actor, candidate) {
  const radius = Math.max(0.32, actor.agent.traits.radius * 0.68);
  for (const obstacle of runtime.worldState.obstacles ?? []) {
    const minDistance = finite(obstacle.r) + radius;
    let dx = candidate.x - obstacle.x;
    let dz = candidate.z - obstacle.z;
    let distance = Math.hypot(dx, dz);
    if (distance >= minDistance) continue;
    if (distance < 1e-5) {
      const angle = actor.phase + actor.record.ordinal;
      dx = Math.cos(angle);
      dz = Math.sin(angle);
      distance = 1;
    }
    candidate.x = obstacle.x + (dx / distance) * minDistance;
    candidate.z = obstacle.z + (dz / distance) * minDistance;
  }
}

function resolveAgainstDynamicObstacles(runtime, actor, candidate, dt) {
  const radius = Math.max(0.32, actor.agent.traits.radius * 0.58);
  const dynamic = runtime.worldState.dynamicObstacles ?? [];
  const separationBlend = 1 - Math.exp(-dt * 14);
  for (let index = 0; index < dynamic.length; index++) {
    const obstacle = dynamic[index];
    if (obstacle.owner === actor.facade) continue;
    const minDistance = finite(obstacle.r) + radius;
    let dx = candidate.x - obstacle.x;
    let dz = candidate.z - obstacle.z;
    let distance = Math.hypot(dx, dz);
    if (distance >= minDistance) continue;
    if (distance < 1e-5) {
      const angle =
        actor.phase +
        actor.record.ordinal * GOLDEN_ANGLE +
        index * 0.37;
      dx = Math.cos(angle);
      dz = Math.sin(angle);
      distance = 1;
    }
    const correction = (minDistance - distance) * separationBlend;
    candidate.x += (dx / distance) * correction;
    candidate.z += (dz / distance) * correction;
  }
}

function cameraTargetInWorldLocal(runtime, camera, out) {
  if (!camera) return null;
  const scale = runtime.worldState.userSettings.worldScale || 1;
  return out.set(
    camera.position.x / scale,
    camera.position.y / scale,
    camera.position.z / scale,
  );
}

function stepLivingFauna(runtime, dt, time, camera) {
  const anchor = runtime.composition.anchor;
  const {
    cameraTarget,
    desired,
    candidate,
    heroLook,
    anchorTarget,
  } = runtime.scratch;
  heroLook.set(anchor.x, anchor.y + 2.1, anchor.z);
  anchorTarget.set(anchor.x, 0, anchor.z);

  for (const actor of runtime.fauna) {
    const { agent, facade, record } = actor;
    facade.age += dt;
    actor.phase +=
      dt *
      record.direction *
      (record.speed / Math.max(record.orbitRadius, 0.1));
    faunaPathPoint(anchor, record, actor.phase, desired);
    const toward = desired.sub(actor.position);
    const maxSpeed = record.speed * 1.35;
    if (toward.lengthSq() > maxSpeed * maxSpeed) toward.setLength(maxSpeed);
    candidate.copy(actor.position).addScaledVector(toward, dt);
    resolveAgainstObstacles(runtime, actor, candidate);
    resolveAgainstDynamicObstacles(runtime, actor, candidate, dt);

    if (maxIslandFalloff(runtime.worldState.currentLayout, candidate.x, candidate.z) < 0.56) {
      candidate.lerp(anchorTarget, Math.min(1, dt * 1.8));
    }

    // Collision and boundary repair are authoritative movement too. Bound the
    // actual displacement, not only the velocity reported to the gait solver,
    // so deep overlaps unwind smoothly and consistently across frame rates.
    const maxActualSpeed = Math.max(maxSpeed * 1.75, 1.1);
    desired.subVectors(candidate, actor.position);
    if (desired.lengthSq() > (maxActualSpeed * dt) ** 2) {
      desired.setLength(maxActualSpeed * dt);
      candidate.copy(actor.position).add(desired);
    }

    if (dt > 1e-6) {
      actor.velocity
        .subVectors(candidate, actor.position)
        .divideScalar(dt);
    } else {
      actor.velocity.set(0, 0, 0);
    }
    const maxIntentSpeed = maxSpeed * 1.5;
    if (actor.velocity.lengthSq() > maxIntentSpeed * maxIntentSpeed) {
      actor.velocity.setLength(maxIntentSpeed);
    }
    actor.position.copy(candidate);
    const heading =
      actor.velocity.lengthSq() > 1e-5
        ? Math.atan2(actor.velocity.x, actor.velocity.z)
        : facade.heading;
    facade.heading = heading;
    facade.lookTimer = Math.max(0, facade.lookTimer - dt);

    let lookTarget = null;
    if (facade.lookTimer > 0) {
      lookTarget = cameraTargetInWorldLocal(runtime, camera, cameraTarget);
    } else if (
      Math.sin(time * 0.48 + record.ordinal * 1.7) > 0.84
    ) {
      lookTarget = heroLook;
    }

    actor.intent.heading = heading;
    actor.intent.lookTarget = lookTarget;
    actor.intent.action = lookTarget
      ? "notice"
      : actor.velocity.lengthSq() > 0.025
        ? "wander"
        : "arrive";
    actor.frame.dt = dt;
    actor.frame.time = time;
    const frame = agent.update(actor.frame);
    for (const footfall of frame.footfalls) {
      runtime.events.emit(
        PRESENTATION_EVENTS.FOOTFALL,
        {
          creature: facade,
          foot: footfall.foot,
          position: footfall.position,
          material: footfall.material,
        },
        { time },
      );
    }

    if (time >= actor.nextProximityAt) {
      actor.nextProximityAt = time + 0.16 + record.ordinal * 0.013;
      touchFloraNear(runtime, actor.position, 0.07, time, 0.48);
    }
  }
}

export function stepLivingWorld(runtime, dt, time, { camera = null } = {}) {
  if (!runtime || runtime.disposed) return;
  const safeDt = Math.max(0, Math.min(finite(dt), 0.05));
  if (safeDt === 0) return;
  const safeTime = finite(time);
  stepLivingFauna(runtime, safeDt, safeTime, camera);
  for (const flora of runtime.flora) flora.instance.update(safeDt);
}

/**
 * Read flags before atmosphere construction so the source biome can be
 * replaced without registering a new BIOMES entry or perturbing seed rolls.
 */
export function resolveLivingWorldPresentation(
  sourceBiome,
  {
    search = globalThis.location?.search ?? "",
    env,
  } = {},
) {
  const rawFlags = readIntegrationFeatureFlags({ search, env });
  const flags = resolveLivingWorldFlags(rawFlags);
  return Object.freeze({
    flags,
    biome: flags.livingWorld
      ? createLivingWorldBiome(sourceBiome)
      : sourceBiome,
  });
}

export function createLivingWorldRuntime({
  worldState,
  biome,
  seed,
  flags,
  attachCatalogMetadata = null,
}) {
  if (!worldState || typeof worldState !== "object") {
    throw new TypeError("createLivingWorldRuntime requires worldState");
  }
  const resolvedFlags = resolveLivingWorldFlags(flags);
  if (!resolvedFlags.generatedFlora && !resolvedFlags.generatedFauna) return null;

  const world = createWorldContext(worldState);
  const surface = Object.freeze({
    coordinateSpace: "root-parent-local",
    heightAt(x, z) {
      return world.surfaceHeightAt(x, z);
    },
    sample(x, z, out) {
      return world.sampleSurface(x, z, out);
    },
  });
  const runtime = {
    styleId: resolvedFlags.livingWorld ? LIVING_WORLD_STYLE_ID : "hybrid-proof",
    flags: resolvedFlags,
    biome,
    seed,
    worldState,
    world,
    surface,
    events: createPresentationEventBus({
      onError(error, event) {
        console.warn(`[living-world] presentation event "${event.type}" failed`, error);
      },
    }),
    rng: createRng(hashSeed(seed, LIVING_WORLD_STYLE_ID)),
    attachCatalogMetadata,
    composition: null,
    hero: null,
    species: [],
    floraProviders: [],
    creatureProvider: null,
    flora: [],
    fauna: [],
    lights: [],
    unsubscribers: [],
    registrations: {
      obstacles: [],
      perches: [],
      flowerSpots: [],
    },
    scratch: {
      cameraTarget: new THREE.Vector3(),
      desired: new THREE.Vector3(),
      candidate: new THREE.Vector3(),
      heroLook: new THREE.Vector3(),
      anchorTarget: new THREE.Vector3(),
    },
    disposed: false,
  };
  installPresentationReactions(runtime);
  return runtime;
}

export function disposeLivingWorld(worldState) {
  const runtime = worldState?.livingWorld;
  if (!runtime || runtime.disposed) {
    if (worldState) worldState.livingWorld = null;
    return false;
  }
  runtime.disposed = true;

  for (const unsubscribe of runtime.unsubscribers.splice(0)) unsubscribe();
  runtime.events.clear();
  const actors = runtime.fauna.splice(0);
  const facades = new Set(actors.map((actor) => actor.facade));
  for (const actor of actors) actor.agent.dispose();
  for (const flora of runtime.flora.splice(0)) flora.instance.dispose();
  for (const species of runtime.species.splice(0)) species.dispose();
  for (const light of runtime.lights.splice(0)) light.removeFromParent();

  if (facades.size > 0) {
    worldState.creatures = worldState.creatures.filter(
      (creature) => !facades.has(creature),
    );
  }
  removeRegistered(
    worldState.obstacles,
    runtime.registrations.obstacles,
  );
  removeRegistered(
    worldState.perchSpots,
    runtime.registrations.perches,
  );
  removeRegistered(
    worldState.flowerSpots,
    runtime.registrations.flowerSpots,
  );
  worldState.livingWorld = null;
  return true;
}

export function livingWorldFloraCount(runtime) {
  return runtime?.flora?.length ?? 0;
}

export function isLivingWorldCreature(creature) {
  return Boolean(creature?.generatedAgent);
}

export function applyLivingWorldCamera(camera, controls, worldState) {
  const runtime = worldState?.livingWorld;
  if (
    !runtime?.flags.livingWorld ||
    !runtime.composition?.anchor ||
    !camera ||
    !controls
  ) {
    return false;
  }
  const anchor = runtime.composition.anchor;
  const scale = worldState.userSettings.worldScale || 1;
  const aspect = Math.max(0.42, finite(camera.aspect, 16 / 9));
  const narrowScale =
    aspect < 1
      ? Math.min(1.5, Math.sqrt(1 / aspect))
      : 1;
  const heightScale = 1 + (narrowScale - 1) * 0.58;
  camera.fov = 44;
  camera.updateProjectionMatrix();
  camera.position.set(
    (anchor.x + 10.8 * narrowScale) * scale,
    (anchor.y + 5.7 * heightScale) * scale,
    (anchor.z + 11.7 * narrowScale) * scale,
  );
  controls.target.set(
    (anchor.x - 1.15) * scale,
    (anchor.y + 1.35) * scale,
    (anchor.z - 0.45) * scale,
  );
  controls.minDistance = 6;
  controls.maxDistance = 38;
  controls.maxPolarAngle = Math.PI / 2.08;
  controls.update();
  return true;
}
