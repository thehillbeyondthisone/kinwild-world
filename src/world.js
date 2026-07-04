import * as THREE from "three";
import {
  rollBiomeAndLayout,
  CANOPY_SPACING_KINDS,
  CANOPY_SPACING_PAD,
} from "./world-constants.js";
import {
  state,
  DAY_NIGHT_PERIOD_S,
  DENSITY_BASE,
  disposeGroup,
} from "./state.js";
import { BIOMES } from "./biomes.js";
import { mulberry32, writeSeedToUrl } from "./seed.js";
import { pickGroundPoint, pickLayout } from "./terrain.js";
import { resetFloraPool } from "./flora.js";
import { resetCreaturePool, resetCaterpillarPool } from "./fauna.js";
import { makeFlock } from "./birds.js";
import { makeShadowDisks } from "./shadows.js";
import { makeParticles } from "./environment.js";
import { updateSkyColors } from "./sky.js";
import { disposeWaterReflection } from "./reflection.js";
import { disposePortal } from "./portal.js";
import { resetPBRTextureCache } from "./pbr.js";
import { catalogSubjectFromInspect } from "./catalog.js";
import { finalizeWorldHud } from "./world-hud.js";
import { buildAtmosphereAndTerrain } from "./world/atmosphere.js";
import { placeFloraAndGroundCover } from "./world/flora-placement.js";
import { populateFauna } from "./world/fauna-population.js";

let _scene = null;
let _controls = null;
let _releaseFollow = () => {};
let _generationRunId = 0;

const STALE_GENERATION = Symbol("stale-generation");
const GENERATION_FRAME_BUDGET_MS = 8;

// Re-exported for back-compat (QA-009 hoisted these to module scope so tests
// can import-and-assert the data invariant); canonical definition now lives
// in world-constants.js so src/world/flora-placement.js can import it
// without a cycle back through world.js.
export { CANOPY_SPACING_KINDS, CANOPY_SPACING_PAD };

function generationNow() {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}

function nextGenerationFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function setWorldLoading(active) {
  const el = document.getElementById("world-loading");
  if (!el) return;
  el.classList.toggle("is-visible", active);
  el.setAttribute("aria-hidden", active ? "false" : "true");
}

export function setSceneRef(scene) {
  _scene = scene;
}
export function setControlsRef(controls) {
  _controls = controls;
}
export function setFollowReleaseCallback(fn) {
  _releaseFollow = fn;
}

function readPortalTargetBiomeIdFromUrl() {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("portal");
}

function findFloraShadowRoot(object) {
  let cursor = object;
  while (cursor) {
    if (cursor.userData?.inspect?.category === "flora") return cursor;
    cursor = cursor.parent;
  }
  return null;
}

function applyStaticShadowLod(worldState, biome) {
  const staticCasterRadiusFrac = biome.shadowLod?.staticCasterRadiusFrac;
  if (!staticCasterRadiusFrac) return;
  const radius = (worldState.currentLayout?.boundRadius ?? worldState.ISLAND_RADIUS) * staticCasterRadiusFrac;
  const radiusSq = radius * radius;
  worldState.world.traverse((object) => {
    if (!object.castShadow) return;
    const root = findFloraShadowRoot(object);
    if (!root) return;
    const dx = root.position.x;
    const dz = root.position.z;
    if (dx * dx + dz * dz > radiusSq) object.castShadow = false;
  });
}

function disposeWorldPortals(worldState) {
  for (const portal of worldState.portals ?? []) {
    portal.group?.parent?.remove(portal.group);
    disposePortal(portal);
  }
  worldState.portals = [];
}

export function createWorldBuildContext(overrides = {}) {
  return {
    state: overrides.state ?? state,
    scene: overrides.scene ?? _scene,
    controls: overrides.controls ?? _controls,
    releaseFollow: overrides.releaseFollow ?? _releaseFollow,
    setLoading: overrides.setLoading ?? setWorldLoading,
    dispatchWorldReady:
      overrides.dispatchWorldReady ??
      (() => window.dispatchEvent(new CustomEvent("world-ready"))),
    writeSeed: overrides.writeSeed ?? writeSeedToUrl,
    portalTargetBiomeId: overrides.portalTargetBiomeId ?? readPortalTargetBiomeIdFromUrl(),
  };
}

// Slow day/night cycle. Lerps a handful of scene values between the biome's
// day, dusk, and night palettes using a cosine curve. dusk is optional — when
// absent, the blend is a simple day→night two-stop.
const AMBIENT_LIFT = new THREE.Color("#a8b4c8");

// Three-stop color blend: f=1 day, f=0.5 dusk, f=0 night. If dusk is null,
// falls back to a two-stop day→night lerp (linear in f).
function blendPalette(out, day, dusk, night, f) {
  if (!dusk) return out.copy(day).lerp(night, 1 - f);
  if (f >= 0.5) {
    return out.copy(dusk).lerp(day, (f - 0.5) * 2);
  }
  return out.copy(night).lerp(dusk, f * 2);
}

export function updateDayNight(t) {
  if (!state.dayNight || !state.sunLight || !state.hemiLight || !_scene) return;
  let dayFactor;
  let phase;
  if (state.userSettings.autoCycle) {
    phase = (t * 2 * Math.PI) / DAY_NIGHT_PERIOD_S;
    dayFactor = (Math.cos(phase) + 1) * 0.5;
  } else {
    dayFactor = state.userSettings.manualDayFactor;
    phase = Math.acos(2 * dayFactor - 1);
  }
  const ab = state.userSettings.ambientBoost ?? 0;
  // ambient boost reduces night-darkening so dark biomes don't swallow the lift
  const liftedDay = dayFactor + (1 - dayFactor) * ab * 0.7;
  const nightAmt = 1 - liftedDay;
  // expose to fauna step (sleep cycle reads this each frame)
  state.nightFactor = nightAmt;
  const dn = state.dayNight;

  blendPalette(_scene.background, dn.sky, dn.duskSky, dn.nightSky, liftedDay);
  if (ab > 0) _scene.background.lerp(AMBIENT_LIFT, ab * 0.55);
  blendPalette(_scene.fog.color, dn.fog, dn.duskFog, dn.nightFog, liftedDay);
  if (ab > 0) _scene.fog.color.lerp(AMBIENT_LIFT, ab * 0.6);
  // reveal animation — fog starts thick, eases back to biome default over ~1.5s
  let revealMul = 1;
  if (state.revealStart) {
    const k = (performance.now() - state.revealStart) / 1500;
    if (k < 1) {
      const e = (1 - Math.max(0, k)) ** 3; // ease-out cubic
      revealMul = 1 + 5 * e;
    }
  }
  _scene.fog.density =
    state.dayNight.fogDensity *
    (1 + nightAmt * 0.2) *
    state.userSettings.fogMultiplier *
    (1 - ab * 0.5) * // thinner fog at high ambient
    revealMul;

  blendPalette(state.sunLight.color, dn.sun, dn.duskSun, dn.nightSun, liftedDay);
  const sunBase = 0.45 + dayFactor * 0.95 + ab * 1.6;
  const sunMul = state.currentBiome?.sunIntensity ?? 1;
  state.sunLight.intensity = sunBase * sunMul;
  const sunAngle = phase + Math.PI;
  const sunR = 26;
  state.sunLight.position.set(
    Math.cos(sunAngle) * sunR,
    Math.max(6, Math.sin(sunAngle) * 28 + 8),
    Math.sin(sunAngle * 0.5) * 12 + 4
  );

  blendPalette(state.hemiLight.color, dn.skyForHemi, dn.duskSky, dn.nightSky, liftedDay);
  if (ab > 0) state.hemiLight.color.lerp(AMBIENT_LIFT, ab * 0.7);
  blendPalette(
    state.hemiLight.groundColor,
    dn.ground,
    dn.duskGround,
    dn.nightGround,
    liftedDay
  );
  if (ab > 0) state.hemiLight.groundColor.lerp(AMBIENT_LIFT, ab * 0.5);
  // hemi fill scales hard with ambient so dark biomes actually brighten
  state.hemiLight.intensity = 0.32 + dayFactor * 0.45 + ab * 4.5;

  // Sky dome zenith/horizon + mountain layer tint follow the day/night curve
  updateSkyColors(state.skyDome, state.mountains, dn, liftedDay, nightAmt);

  // Stars + aurora fade in at night. Start visible around dusk and ramp to
  // full opacity at deep night so the transition feels like dimming up the
  // sky-noise rather than punching them in suddenly.
  if (state.starfield) {
    const u = state.starfield.material.uniforms;
    u.uTime.value = t;
    u.uAlpha.value = Math.max(0, nightAmt - 0.25) * 1.4;
  }
  if (state.aurora) {
    for (const m of state.aurora.userData.curtains) {
      const u = m.material.uniforms;
      u.uTime.value = t;
      u.uAlpha.value = Math.max(0, nightAmt - 0.2) * 1.3;
    }
  }
}

export async function generateWorld(seed, context = createWorldBuildContext(), options = {}) {
  const worldState = context.state;
  const worldScene = context.scene;
  const worldControls = context.controls;
  const releaseFollow = context.releaseFollow;
  const runId = ++_generationRunId;
  worldState.isGeneratingWorld = true;
  context.setLoading(true);
  await nextGenerationFrame();
  if (runId !== _generationRunId) {
    // Superseded by a newer regen before we even started building. That
    // newer run already owns isGeneratingWorld/loading-state (set at its own
    // entry, mirroring the lines above) and will release them in its own
    // finally block, so this stale call must return without touching either.
    return;
  }

  // Swap Math.random for the seeded PRNG so every Math.random() call
  // during world construction is deterministic. Per-frame animation
  // (stepCreature/stepFlock/stepParticles) runs after we restore, so it
  // keeps its natural variation.
  //
  // Async generation yields restore Math.random first, then reinstall this
  // same PRNG on resume. That lets the loading UI paint without letting
  // unrelated animation frames consume seeded random values.
  const originalRandom = Math.random;
  const seededRandom = mulberry32(seed);
  const installSeededRandom = () => {
    Math.random = seededRandom;
  };
  const restoreRandom = () => {
    Math.random = originalRandom;
  };
  let lastYieldAt = generationNow();
  async function yieldIfNeeded(force = false) {
    if (!force && generationNow() - lastYieldAt < GENERATION_FRAME_BUDGET_MS) return;
    restoreRandom();
    await nextGenerationFrame();
    if (runId !== _generationRunId) throw STALE_GENERATION;
    installSeededRandom();
    lastYieldAt = generationNow();
  }

  installSeededRandom();
  try {

  // Pick biome from the seed itself, so one number reproduces everything.
  // Forced-biome catalog navigation still consumes this roll before swapping
  // the biome, preserving the rest of the seed's layout/random stream.
  // Layout (size + shape + island count) is picked right after the biome so
  // it stays inside the deterministic Math.random window — rollBiomeAndLayout
  // (ARC-003/QA-013, world-constants.js) is the single source of truth for
  // this ordering, shared with the portal preview's RNG replay.
  const { biome: seedBiome, layout } = rollBiomeAndLayout(pickLayout);
  const forcedBiome = options.biomeId ? BIOMES.find((candidate) => candidate.id === options.biomeId) : null;
  const biome = forcedBiome ?? seedBiome;
  function attachCatalogMetadata(object) {
    if (!object?.userData?.inspect) return;
    object.userData.catalog = catalogSubjectFromInspect(object.userData.inspect, biome);
    if (!object.userData.catalog) delete object.userData.catalog;
  }

  worldState.currentLayout = layout;
  worldState.ISLAND_SIZE = layout.planeSize;
  worldState.ISLAND_RADIUS = layout.boundRadius;
  const pickWorldGroundPoint = (maxRadiusFrac = 0.88, opts = {}) =>
    pickGroundPoint(maxRadiusFrac, { ...opts, layout: worldState.currentLayout });

  // clear
  disposeGroup(worldState.world);
  // Dispose previous reflection's WebGL render target + clear its cloned
  // scene — disposeGroup only walks worldState.world, and the reflection lives on
  // worldState.waterReflection. Clearing the scene before nulling the ref ensures
  // a stray updateWaterReflection call between here and the new
  // makeWaterReflection below can't sample disposed materials.
  disposeWaterReflection(worldState.waterReflection);
  worldState.waterReflection = null;
  disposeWorldPortals(worldState);
  worldScene.remove(worldState.world);
  worldState.world = new THREE.Group();
  worldState.world.scale.setScalar(worldState.userSettings.worldScale ?? 1);
  worldScene.add(worldState.world);
  // Burrower mounds are added/removed from the world group dynamically; a
  // mound that's hidden at regen time isn't parented anywhere, so disposeGroup
  // can't reach its per-creature material — dispose it explicitly. The mound
  // geometry is a shared module-scope constant and must not be disposed.
  for (const c of worldState.creatures) {
    if (c.moundMesh) {
      c.moundMesh.parent?.remove(c.moundMesh);
      c.moundMesh.material.dispose();
      c.moundMesh = null;
    }
  }
  worldState.creatures = [];
  worldState.flocks = [];
  worldState.caterpillars = [];
  worldState.butterflies = [];
  worldState.bees = [];
  worldState.flySwarms = [];
  worldState.willowisps = [];
  worldState.dirtPuffs = [];
  worldState.dustKicks = [];
  worldState.groundMarks = null;
  worldState.flowerSpots = [];
  worldState.obstacles = [];
  worldState._dynPool = null;
  worldState.perchSpots = [];
  worldState.creatureColorBuckets = null;
  worldState.particles = null;
  worldState.waterMesh = null;
  worldState.grass = null;
  // release any followed creature — the entity it pointed to no longer exists
  releaseFollow();

  // reset the flora + creature resource pools — previous-world
  // materials/geometries were just disposed via disposeGroup, so we can't
  // reuse them
  resetFloraPool();
  resetCreaturePool();
  resetCaterpillarPool();
  resetPBRTextureCache();

  await buildAtmosphereAndTerrain({ worldState, worldScene, biome, seed, layout, yieldIfNeeded });

  const densityScale = worldState.ISLAND_SIZE / DENSITY_BASE;
  const { placed, blocksPlacement, GROUND_CREATURE_BLOCK_KINDS, placeFlyerNest } = await placeFloraAndGroundCover({
    worldState,
    biome,
    seed,
    context,
    densityScale,
    pickWorldGroundPoint,
    attachCatalogMetadata,
    yieldIfNeeded,
  });


  await populateFauna({
    worldState,
    biome,
    densityScale,
    pickWorldGroundPoint,
    blocksPlacement,
    GROUND_CREATURE_BLOCK_KINDS,
    placeFlyerNest,
    yieldIfNeeded,
  });


  // bird flocks
  const numFlocks = 1;
  let totalBirds = 0;
  for (let f = 0; f < numFlocks; f++) {
    const flock = makeFlock(biome);
    for (const bird of flock.birds) worldState.world.add(bird.group);
    totalBirds += flock.birds.length;
    worldState.flocks.push(flock);
  }

  // particles
  worldState.particles = makeParticles(biome);
  worldState.world.add(worldState.particles);

  // Soft circular ground shadows under creatures + caterpillars.
  applyStaticShadowLod(worldState, biome);
  worldState.shadowDisks = makeShadowDisks(biome);
  worldState.world.add(worldState.shadowDisks);

  // HUD / URL / spatial-index tail (extracted to src/world-hud.js, QA-005).
  // Runs after every deterministic placement and the final yield — no
  // Math.random is consumed here, so it sits outside the seeded PRNG window.
  finalizeWorldHud({
    worldState,
    biome,
    seed,
    forcedBiome,
    worldControls,
    context,
    placed,
    totalBirds,
  });
  } catch (error) {
    if (error !== STALE_GENERATION) throw error;
  } finally {
    restoreRandom();
    if (runId === _generationRunId) {
      worldState.isGeneratingWorld = false;
      context.setLoading(false);
    }
  }
}
