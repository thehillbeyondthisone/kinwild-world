import * as THREE from "three";
import { MIDFX } from "./lowfx.js";

/**
 * App version — injected by Vite at build time from `package.json`.
 * In dev mode, reads from the env var; in production, inlined by `define`.
 * @type {string}
 */
export const APP_VERSION = __APP_VERSION__;

/** Default island plane size (world units) before any layout stretch. */
export const ISLAND_SIZE_BASE = 100;
/** Default island bounding radius, derived from `ISLAND_SIZE_BASE`. */
export const ISLAND_RADIUS_BASE = ISLAND_SIZE_BASE * 0.462;
/**
 * Density anchor for biome flora/creature counts and ground cover. The biome
 * tables were tuned against this 76-unit base, but the current island radius
 * is intentionally doubled for more breathing room. Keep this doubled too so
 * the absolute spawn counts stay near the old world size instead of doubling.
 * `world.js` scales target counts by `state.ISLAND_SIZE / DENSITY_BASE`.
 */
export const DENSITY_BASE = 76;

/**
 * Canonical baseline for the grass density settings slider (100% on the
 * slider maps to this internal multiplier unit). Single source of truth for
 * `src/state.js`, `src/ui/storage.js`, and `src/ui.js` — see ARC-007 in AUDIT.md.
 */
export const GRASS_DENSITY_BASE = 25;
/** Canonical baseline for the grass height settings slider, same contract as `GRASS_DENSITY_BASE`. */
export const GRASS_HEIGHT_BASE = 0.96;

/**
 * Shared module-scope singleton — the app's one mutable state object. Holds
 * `world` (the THREE.Group disposed/rebuilt every regen), all entity arrays
 * (`creatures`, `caterpillars`, `butterflies`, `bees`, `flocks`, `dirtPuffs`,
 * `dustKicks`, `flowerSpots`, `willowisps`, `portals`), `heightFn`,
 * `currentBiome`/`currentLayout`, `ISLAND_SIZE`/`ISLAND_RADIUS`,
 * `windUniforms`, `userSettings` (persisted via `src/ui/storage.js`), and refs
 * for the visual-polish modules (`shadowDisks`, `waterReflection`,
 * `mountainBasePos`, `postfx`, `renderer`, `depthTexture`). Every module
 * imports from here rather than passing values around; see individual field
 * comments below for narrower per-field contracts.
 * @type {Object}
 */
export const state = {
  ISLAND_SIZE: ISLAND_SIZE_BASE,
  ISLAND_RADIUS: ISLAND_RADIUS_BASE,
  currentLayout: {
    centers: [{ cx: 0, cz: 0, radius: ISLAND_RADIUS_BASE, shape: { kind: "round" } }],
    planeSize: ISLAND_SIZE_BASE,
    boundRadius: ISLAND_RADIUS_BASE,
    kind: "single",
  },
  world: new THREE.Group(),
  creatures: [],
  caterpillars: [],
  butterflies: [],
  bees: [],
  willowisps: [],
  // Tiny dark fly clouds hovering above props (currently desert skulls).
  // Each entry is a THREE.Points parented to state.world, with userData
  // { centerX, centerY, centerZ, seeds, count }. Stepped each frame by
  // stepFlySwarms in environment.js.
  flySwarms: [],
  dirtPuffs: [],
  flowerSpots: [],
  flocks: [],
  particles: null,
  waterMesh: null,
  skyDome: null,
  mountains: null,
  clouds: null,
  starfield: null,
  aurora: null,
  // Cloud-biome only — torus-shaped swirling cloud halo built by makeCloudSwirl.
  // Null on every other biome. Parented to state.world; disposeGroup handles
  // teardown.
  cloudSwirl: null,
  shadowDisks: null,
  waterReflection: null,
  // Biome portals for the current world. Always an array — one entry per
  // placed portal (two in double-placement mode). Rebuilt on every regen.
  portals: [],
  mountainBasePos: null,
  dustKicks: [],
  groundMarks: null,
  // Collision discs for tall/solid flora. Populated in generateWorld during the
  // flora placement loop; consumed by stepCreature / stepCaterpillar for
  // tangent-slide obstacle avoidance. Entries: { x, z, r, top }. Empty array
  // when no obstacle-class flora exists. `top` is the world-Y of the canopy
  // and lets fliers above that altitude pass through freely.
  obstacles: [],
  // Per-frame mover-vs-mover collision discs. Rebuilt at the top of each
  // animate() tick from walker creatures and every caterpillar segment.
  // Entries: { x, z, r, top, owner } where `owner` is the creature/caterpillar
  // struct (so a mover skips its own entries via selfOwner in avoidObstacles)
  // and `top` is the body's top world-Y (lets fliers above pass over). Not
  // persistent state — purely a per-frame scratch buffer to keep alloc churn
  // out of the inner loop.
  dynamicObstacles: [],
  // Pre-allocated pool for dynamicObstacles entries (avoids per-frame GC).
  // Grows on demand, reset on world regen by main.js.
  _dynPool: null,
  // Mushroom-cap landing pads for fliers. Populated alongside obstacles
  // during flora placement. Entries: { x, z, y } where y is the world-Y of
  // the cap top. Cleared at the start of generateWorld.
  perchSpots: [],
  // Color-bucketed creature index for O(1) herding. Built in world.js
  // after creature spawning. Keyed by bodyColor hex string.
  creatureColorBuckets: null,
  // Set by makeGrassField in src/grass.js. Holds { mesh, uniforms } so
  // stepGrass can update uCameraXZ each frame and disposeGroup-style
  // teardown can null it out on regen. Mesh itself is parented to
  // state.world so disposeGroup handles its GPU resources.
  grass: null,
  postfx: null,
  heightFn: () => 0,
  currentBiome: null,
  currentSeed: 0,
  // Exclusive generated-content runtime for ?livingWorld=1 (or the narrower
  // generated flora/fauna proof flags). It owns custom GPU resources and must
  // be disposed before the generic state.world traversal on regeneration.
  livingWorld: null,
  isGeneratingWorld: false,
  maxElev: 0,
  sunLight: null,
  hemiLight: null,
  dayNight: null,
  // Shared uniforms for foliage wind sway. uTime is advanced every frame in
  // main.js (frozen when wind is globally off). uFoliageWind is a 0/1
  // multiplier applied to applyWindSway materials so trees/mushrooms can be
  // stilled independently of grass.
  windUniforms: { uTime: { value: 0 }, uFoliageWind: { value: 1 } },
  revealStart: 0,
  lastSimT: 0,
  // Camera ref, set in main.js on boot. Read by stepCreature for the
  // look-at-camera response when the user hovers a creature.
  camera: null,
  // Renderer ref, set in main.js on boot. Read by makeParticles to pull the
  // current pixel ratio into the particle ShaderMaterial.
  renderer: null,
  // 0 = full day, 1 = full night. Updated each frame in updateDayNight so
  // fauna can react (sleep cycle at night). Personality may shift each
  // creature's effective threshold.
  nightFactor: 0,
  userSettings: {
    fogMultiplier: 0.2,
    autoCycle: false,
    manualDayFactor: 0.75,
    autoRotate: false,
    ambientBoost: 0,
    worldScale: 1,
    autoRegen: false,
    autoRegenMinutes: 2,
    bloom: true,
    tiltShift: false,
    // Depth-driven FX default off on mid-tier mobile (MIDFX) — the combined
    // depth-FX pass is a large share of mobile GPU frame time. These are only
    // defaults: saved user settings loaded by ui.js still override them.
    outline: !MIDFX,
    ao: !MIDFX,
    depthFog: !MIDFX,
    fxPanelOpen: false,
    portalEnabled: false,
    portalDoublePlacement: false,
    portalPreviewGrass: false,
    portalPreviewFlora: true,
    portalPreviewCreatures: false,
    portalPreviewFx: true,
    portalPanelOpen: false,
    showFps: false,
    windEnabled: true,
    windStrength: 1.0,
    windNoiseScale: 1.0,
    windPanelOpen: false,
    grassEnabled: true,
    grassDensity: GRASS_DENSITY_BASE,
    grassDensityBase: GRASS_DENSITY_BASE,
    grassHeight: GRASS_HEIGHT_BASE,
    groundMarkLifeScale: 2.0,
    grassPanelOpen: false,
    foliageWindEnabled: true,
    bloomRadius: 0.5,
    pbrDetails: true,
    musicEnabled: false,
    musicVolume: 0.5,
    musicTrackOverrides: {},
  },
  // Set by world.js after makeTerrain.
  terrainMesh: null,
  // Set by initPostFX. Null under LOWFX (no composer, no depth capture).
  depthTexture: null,
};

/** Night-palette sky color, lerped toward from the biome's day palette by `updateDayNight`. */
export const NIGHT_SKY = new THREE.Color("#0a0d24");
/** Night-palette fog color, see `NIGHT_SKY`. */
export const NIGHT_FOG = new THREE.Color("#070a1f");
/** Night-palette sun light color, see `NIGHT_SKY`. */
export const NIGHT_SUN = new THREE.Color("#7a89b8");
/** Night-palette hemisphere-light ground color, see `NIGHT_SKY`. */
export const NIGHT_HEMI_GROUND = new THREE.Color("#06070d");
/** Full auto day/night cycle duration in seconds, used when `userSettings.autoCycle` is on. */
export const DAY_NIGHT_PERIOD_S = 120;

const MATERIAL_TEXTURE_KEYS = [
  "map",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "specularIntensityMap",
  "specularColorMap",
  "aoMap",
  "emissiveMap",
  "alphaMap",
  "bumpMap",
  "displacementMap",
  "envMap",
  "clearcoatMap",
  "clearcoatNormalMap",
  "clearcoatRoughnessMap",
];

function disposeMaterial(material, disposedMaterials, disposedTextures) {
  if (!material || disposedMaterials.has(material)) return;
  disposedMaterials.add(material);
  for (const key of MATERIAL_TEXTURE_KEYS) {
    const texture = material[key];
    if (texture && texture.dispose && !disposedTextures.has(texture)) {
      disposedTextures.add(texture);
      texture.dispose();
    }
  }
  const extraTextures = material.userData?.pbrDetailTextures ?? [];
  for (const texture of extraTextures) {
    if (texture && texture.dispose && !disposedTextures.has(texture)) {
      disposedTextures.add(texture);
      texture.dispose();
    }
  }
  material.dispose();
}

/**
 * Traverse a THREE.Group and dispose every geometry/material found, dedup'd
 * via internal Sets. Used to tear down `state.world` (and other groups) on
 * every regen.
 *
 * @param {THREE.Object3D} g - group/object subtree to walk and dispose
 * @param {Object} [opts]
 * @param {Set<Object>} [opts.skip] - geometries/materials to leave undisposed (ARC-004).
 *   Individual-reject placement paths (`world.js` `placeOnGround`/`placeCrawler`/etc.)
 *   pass a live snapshot of the relevant pool's cached resources so rejecting one
 *   creature doesn't dispose a geometry/material another already-placed creature
 *   (or the pool map itself) still references. Full-regen teardown (no `skip`) is
 *   unaffected — pools are reset separately every regen, so disposing everything is correct.
 */
export function disposeGroup(g, { skip } = {}) {
  const disposedMaterials = new Set();
  const disposedTextures = new Set();
  g.traverse((o) => {
    if (o.geometry && !(skip && skip.has(o.geometry))) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (skip && skip.has(m)) continue;
        disposeMaterial(m, disposedMaterials, disposedTextures);
      }
    }
  });
}

/**
 * Dispose every geometry/material currently cached in a `src/pool.js` pool
 * instance. Used to tear down an isolated portal-preview pool (QA-001/QA-002)
 * once its preview build finishes — nothing outside that build references
 * the pool's contents, so bulk disposal is safe and needs no scene traversal.
 *
 * @param {{values: () => IterableIterator<any>}} pool - a `makePool()` instance
 */
export function disposePoolResources(pool) {
  const disposedMaterials = new Set();
  const disposedTextures = new Set();
  for (const resource of pool.values()) {
    if (!resource) continue;
    if (resource.isMaterial) {
      disposeMaterial(resource, disposedMaterials, disposedTextures);
    } else if (typeof resource.dispose === "function") {
      resource.dispose();
    }
  }
}
