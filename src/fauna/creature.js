import * as THREE from "three";
import { state, disposePoolResources } from "../state.js";
import { jitterGeo } from "../util.js";
import { nearestCenter } from "../terrain.js";
import { makeDustKick, emitGroundMark } from "../environment.js";
import { buildCatalogSubject } from "../catalog.js";
import { applyShellFur } from "../fur.js";
import { BLOOM_LAYER } from "../postfx.js";
import { makePool } from "../pool.js";
import { WATER_AVOID_Y, avoidObstacles, colorsClose, sampleTerrainNormal, sampleSlopes, slopeTargetsFromGradient, addAntennae, wrapAngle } from "./shared.js";
import { stepBurrower } from "./creature-mound.js";
import {
  fishMaxGroundY,
  currentPerchPoint,
  stepFlier,
  localFootToWorld,
} from "./creature-perch.js";
import { updateSleepiness, stepZParticles, stepSleeper, stepNightSleep } from "./creature-sleep.js";

// Personality presets — picked once per creature at spawn, tweak how it walks,
// thinks, hops, herds, and sleeps. Subtle multipliers; the cute baseline is
// still recognisable.
const PERSONALITIES = {
  shy:    { speedMul: 0.75, bobSpeedMul: 0.9, bobAmpMul: 0.85, pauseChance: 0.4,  hopProb: 0.12, herdStrength: 0.2,  nightThresh: 0.55 },
  bold:   { speedMul: 1.25, bobSpeedMul: 1.0, bobAmpMul: 1.1,  pauseChance: 0.05, hopProb: 0.45, herdStrength: 0.45, nightThresh: 0.85 },
  sleepy: { speedMul: 0.75, bobSpeedMul: 0.7, bobAmpMul: 0.9,  pauseChance: 0.45, hopProb: 0.1,  herdStrength: 0.3,  nightThresh: 0.40 },
  bouncy: { speedMul: 1.05, bobSpeedMul: 1.4, bobAmpMul: 1.5,  pauseChance: 0.1,  hopProb: 0.55, herdStrength: 0.35, nightThresh: 0.75 },
};
const PERSONALITY_NAMES = Object.keys(PERSONALITIES);

const FISH_MIN_GROUND_Y = -4.2;
const FISH_SPEED_MULTIPLIER = 0.5;
const PERCHED_WING_DOWN_Z = -0.42;
const PERCHED_WING_BACK_Y = 0.42;
const PERCHED_WING_RELAX_X = -0.12;

// Per-regen creature resource pool — shared eye/pupil materials and the
// constant geometries used by every creature. `resetCreaturePool()` is
// called at the top of each generateWorld, so disposeGroup correctly tears
// down the previous regen's pooled objects (each lives in state.world via
// the first creature that consumed it). Without pooling, every creature
// would allocate its own copies of identical resources.
const _creaturePool = makePool();
/**
 * Clear the shared per-regen creature resource pool (eye/pupil materials,
 * shared leg/foot geometries). Must be called once at the top of every
 * `generateWorld` — the previous world's pooled resources are disposed when
 * `state.world` is torn down, so a stale `pooled()` lookup after a missed
 * reset would return a disposed geometry/material.
 */
export const resetCreaturePool = _creaturePool.reset;
// Indirection so portal previews (src/portal.js) can redirect every pooled()
// call in this module to an isolated pool instead of this shared one
// (QA-001) — see the matching comment in src/flora/_shared.js for the full
// rationale. _activeCreaturePool defaults to the shared per-regen pool and is
// only ever swapped by withIsolatedCreaturePool below.
let _activeCreaturePool = _creaturePool;
const pooled = (key, factory) => _activeCreaturePool.get(key, factory);

/**
 * Run `fn` against a fresh, isolated creature resource pool instead of the
 * shared per-regen one, then dispose the isolated pool's resources when done.
 * This is what lets a portal preview (`src/portal.js`) build a different
 * biome's creatures without leaking that biome's materials into the live
 * world's shared pool. See `withIsolatedFloraPool` in `src/flora/_shared.js`
 * for the matching contract on the flora side.
 * @param {(pool: object) => any} fn - callback run with the isolated pool active;
 *   any `makeCreature` calls inside it read/write the isolated pool via `pooled()`.
 * @returns {any} whatever `fn` returns.
 */
export function withIsolatedCreaturePool(fn) {
  const isolated = makePool();
  const previous = _activeCreaturePool;
  _activeCreaturePool = isolated;
  try {
    return fn(isolated);
  } finally {
    _activeCreaturePool = previous;
    disposePoolResources(isolated);
  }
}

/**
 * Snapshot of the currently-active creature pool's cached resources (ARC-004).
 * Individual-reject placement paths in `world.js` (placeOnGround/placeCrawler/
 * placeFishUnderwater/family-kid spawn) pass this as `disposeGroup`'s `skip`
 * set so rejecting one creature never disposes a geometry/material the pool
 * — and therefore other already-placed creatures — still holds.
 * @returns {Set<object>} the pool's currently cached geometries/materials.
 */
export function creaturePoolResources() {
  return new Set(_activeCreaturePool.values());
}

/**
 * Build one creature: body/belly/eyes/antennae, walker legs+feet or flier
 * wings (or fish fins, or bumblebee legs+stinger), optional fur shells, and
 * the full per-creature simulation state consumed by {@link stepCreature}.
 * Must be called inside `generateWorld`'s seeded `Math.random` window — the
 * fur roll, personality pick, color pick, and per-variant detail rolls all
 * consume the deterministic RNG stream, so the same seed reproduces the same
 * creature every regen.
 * @param {object} biome - the current biome config (`src/biomes.js`); supplies
 *   `creatureColors`, `creatureKind`, `furProbability`, `glowEyes`, `accent`, `ground`, `id`.
 * @param {object} [opts]
 * @param {"parent"|"kid"} [opts.role] - family-group role, stored on the returned state.
 * @param {object} [opts.parent] - reference to the parent creature (for kids).
 * @param {number} [opts.sizeMul=1] - overall size multiplier.
 * @param {boolean} [opts.sleeper] - spawn already curled/asleep (walkers only;
 *   forces `flies=false`).
 * @param {boolean} [opts.burrower] - spawn as the burrower variant (walkers
 *   only; forces `flies=false`).
 * @param {boolean} [opts.angler] - spawn as an angler fish (glowing lure; implies `isFish`).
 * @param {"bumblebee"} [opts.variant] - special-cased body plan (striped, six-legged, stinger).
 * @param {THREE.Color} [opts.color] - explicit body color (else randomly picked from the biome palette).
 * @param {boolean} [opts.furry] - force the fur roll result (used by inspect mode).
 * @param {object} [opts.patternOverride] - replay an exact fur pattern (inspect mode).
 * @param {string[]} [opts.stripeColors] - bumblebee stripe color pair override.
 * @returns {object} creature state — `{ group: THREE.Group, body, belly, antennae,
 *   feet, legs, wings, tailFin, lureStalk, lureOrb, eyeParts, flies, isFish, isBee,
 *   scale, heading, speed, bob, hoverHeight, landState, perchTarget, isSleeper,
 *   isBurrower, burrowState, personality, sleepiness, ...and further per-frame
 *   simulation fields consumed by stepCreature }`. `group` is the THREE.Group to
 *   add to the scene; every other field is read/mutated by `stepCreature` and
 *   its dispatch targets each frame.
 */
export function makeCreature(biome, opts = {}) {
  const isAngler = !!opts.angler;
  const isBumblebee = opts.variant === "bumblebee";
  const isFish = biome.creatureKind === "fish" || isAngler;
  // sleepers and burrowers must be walkers — sleeping fliers in mid-air look broken
  const forceWalk = !!(opts.sleeper || opts.burrower);
  const flies = isFish ? true : isBumblebee ? true : forceWalk ? false : Math.random() < 0.15;

  const group = new THREE.Group();
  // YXZ order so heading yaw applies first, then pitch/roll resolve in the
  // creature's body frame (heading-local). stepCreature uses pitch + roll
  // to lay walkers flat against sloped terrain.
  group.rotation.order = "YXZ";
  group.userData.inspect = {
    category: "creature",
    variant: opts.sleeper
      ? "sleeper"
      : opts.burrower
        ? "burrower"
        : isAngler
          ? "angler"
          : isFish
            ? "fish"
            : isBumblebee
              ? "bumblebee"
              : flies
                ? "flier"
                : "walker",
  };
  group.userData.catalog = buildCatalogSubject({
    category: group.userData.inspect.category,
    variant: group.userData.inspect.variant,
    biomeId: biome.id,
  });
  const palette = biome.creatureColors;
  const bodyCol = opts.color instanceof THREE.Color
    ? opts.color.clone()
    : new THREE.Color(palette[Math.floor(Math.random() * palette.length)]);
  // Roll fur before geometry jitter consumes a variable number of random
  // values. That keeps a seed's fuzzy/smooth outcome stable when body detail
  // changes, and restores inspect seeds that were fuzzy before smoothing.
  const furProb = biome.furProbability ?? 0;
  const furRoll = furProb > 0 ? Math.random() : 1;
  const wantsFur = isBumblebee || (!isFish && (opts.furry ?? (furProb > 0 && furRoll < furProb)));

  // body — rounder for fliers, more elongated for walkers
  // Furless creatures get +1 detail so the smoother surface reads clearly.
  const bodyDetail = wantsFur ? 1 : 2;
  const bodyGeo = jitterGeo(new THREE.IcosahedronGeometry(0.42, bodyDetail), 0.06);
  const body = new THREE.Mesh(
    bodyGeo,
    new THREE.MeshStandardMaterial({
      name: flies ? "flier.body.mat.smooth" : "walker.body.mat.smooth",
      color: bodyCol,
      roughness: 0.55,
      metalness: 0.02,
    })
  );
  let bodyBaseY = isFish ? 0.72 : flies ? 0.92 : 0.82;
  let bodyBaseX = isFish ? 0.9 : flies ? 1.05 : 1;
  let bodyBaseZ = isFish ? 1.45 : flies ? 1.05 : 1.25;
  body.scale.set(bodyBaseX, bodyBaseY, bodyBaseZ);
  body.castShadow = true;
  group.add(body);

  if (isBumblebee) {
    const stripes = opts.stripeColors || ["#111111", "#ffd13b"];
    bodyCol.set(stripes[0]);
    body.material.color.set(stripes[0]);
    body.material.name = "bumblebee.body.mat";
    bodyBaseZ *= 1.25; // 25% elongation
    body.scale.set(bodyBaseX, bodyBaseY, bodyBaseZ);
    // Don't paint vertex colors — the icosahedron is too coarse for bands.
    // Instead the fur shader will compute stripes analytically from vPos.
  }

  let furShells = null;
  let furOpts = null;
  // Per-creature fur roll. furProbability ∈ [0,1]; biomes without an
  // override fall back to 0 (no fur). Fish never get fur; fliers use the same
  // short body fur as walkers.
  // The roll happens inside generateWorld's seeded Math.random window, so the
  // same seed reproduces the same fuzzy/smooth split.
  if (wantsFur) {
    furOpts = {
      baseColor: bodyCol.clone(),
      tipColor: bodyCol.clone(),
    };

    // When inspecting a specific creature, replay its exact pattern
    const po = opts.patternOverride;
    if (po) {
      if (po.patternType) furOpts.patternType = po.patternType;
      if (po.patternColor) furOpts.patternColor = new THREE.Color(po.patternColor);
      if (po.stripeBandCount != null) furOpts.stripeBandCount = po.stripeBandCount;
      if (po.stripeBandWidth != null) furOpts.stripeBandWidth = po.stripeBandWidth;
      if (po.stripeOffset != null) furOpts.stripeOffset = po.stripeOffset;
      if (po.patternScale != null) furOpts.patternScale = po.patternScale;
    } else if (isBumblebee) {
      furOpts.patternColor = (opts.stripeColors || ["#111111", "#ffd13b"])[1];
      furOpts.patternType = 1; // stripes
      furOpts.stripeBandCount = 3.0;
      furOpts.stripeBandWidth = 0.35;
      furOpts.stripeOffset = 0.12;
    } else {
      // ~40% get a pattern, ~60% stay solid
      const patRoll = Math.random();
      if (patRoll < 0.20) {
        // Stripes
        furOpts.patternType = 1;
        furOpts.stripeBandCount = 2 + Math.floor(Math.random() * 3);
        furOpts.stripeBandWidth = 0.3 + Math.random() * 0.15;
        furOpts.stripeOffset = Math.random() * 0.5;
      } else if (patRoll < 0.40) {
        // Spots
        furOpts.patternType = 2;
        furOpts.patternScale = 4 + Math.random() * 4;
        furOpts.stripeBandWidth = 0.35 + Math.random() * 0.2;
      }

      if (furOpts.patternType) {
        // Pick a contrasting pattern color from the palette
        const patCol = new THREE.Color(
          palette[Math.floor(Math.random() * palette.length)]
        );
        // Make sure it's noticeably different from the base
        if (patCol.getHexString() === bodyCol.getHexString() && palette.length > 1) {
          for (const c of palette) {
            const candidate = new THREE.Color(c);
            if (candidate.getHexString() !== bodyCol.getHexString()) {
              patCol.copy(candidate);
              break;
            }
          }
        }
        furOpts.patternColor = patCol;
      }
    }

    furShells = applyShellFur(body, biome, furOpts);
  }
  group.userData.inspect.fur = furShells ? "1" : "0";
  group.userData.inspect.color = bodyCol.getHexString();
  if (furOpts?.patternType) {
    group.userData.inspect.patternType = String(furOpts.patternType);
    group.userData.inspect.patternColor = new THREE.Color(furOpts.patternColor).getHexString();
    if (furOpts.stripeBandCount != null) group.userData.inspect.stripeBandCount = furOpts.stripeBandCount;
    if (furOpts.stripeBandWidth != null) group.userData.inspect.stripeBandWidth = furOpts.stripeBandWidth;
    if (furOpts.stripeOffset != null) group.userData.inspect.stripeOffset = furOpts.stripeOffset;
    if (furOpts.patternScale != null) group.userData.inspect.patternScale = furOpts.patternScale;
  }

  // belly highlight
  const belly = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 10, 8),
    new THREE.MeshStandardMaterial({
      name: flies ? "flier.belly.mat.smooth" : "walker.belly.mat.smooth",
      color: bodyCol.clone().offsetHSL(0, -0.2, 0.18),
    })
  );
  belly.position.set(0, -0.12, 0.05);
  belly.scale.set(0.85, 0.55, 1);
  belly.userData.baseScale = belly.scale.clone();
  group.add(belly);

  // eyes — material and geometry are uniform across every creature of a
  // single regen, so they're pulled from the per-regen pool.
  const eyeMat = pooled("eye.mat", () => new THREE.MeshStandardMaterial({
    color: 0xfafaf2,
    roughness: 0.15,
  }));
  const pupilMat = biome.glowEyes
    ? pooled("pupil.mat.glow", () => new THREE.MeshStandardMaterial({
        color: new THREE.Color(biome.accent),
        emissive: new THREE.Color(biome.accent),
        emissiveIntensity: 1.4,
        roughness: 0.3,
      }))
    : pooled("pupil.mat", () => new THREE.MeshStandardMaterial({
        color: 0x0a0a0a,
        roughness: 0.05,
      }));
  const eyeGeo = pooled("eye.geo", () => new THREE.SphereGeometry(0.11, 10, 8));
  const pupilGeo = pooled("pupil.geo", () => new THREE.SphereGeometry(0.05, 8, 8));
  const eyeParts = [];
  for (const sign of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(
      sign * (isFish ? 0.25 : 0.16),
      isFish ? 0.12 : 0.17,
      isFish ? 0.24 : 0.4
    );
    if (isBumblebee) eye.scale.setScalar(1.1);
    if (isFish) eye.scale.setScalar(0.92);
    group.add(eye);
    eyeParts.push(eye);
    const pupil = new THREE.Mesh(pupilGeo, pupilMat);
    pupil.position.set(
      sign * (isFish ? 0.32 : 0.16),
      isFish ? 0.12 : 0.17,
      isFish ? 0.27 : 0.48
    );
    if (isBumblebee) pupil.scale.setScalar(1.1);
    if (isFish) pupil.scale.setScalar(0.86);
    if (biome.glowEyes) pupil.layers.enable(BLOOM_LAYER);
    group.add(pupil);
    eyeParts.push(pupil);
  }

  // antennae for some
  let antennae = [];
  if (!isFish && (isBumblebee || Math.random() > 0.55)) {
    antennae = addAntennae(group, biome, bodyCol, {
      stalkHeight: isBumblebee ? 0.4608 : 0.32,
      offsetX: 0.1,
      baseY: 0.36,
      baseZ: isBumblebee ? 0.22 : 0.1,
      tiltAngle: 0.25,
      forwardTiltAngle: isBumblebee ? THREE.MathUtils.degToRad(20) : 0,
      tipRadius: 0.04,
      colorDarken: 0.2,
      emissiveStrength: 0.35,
    });
  }

  const feet = [];
  const legs = [];
  const wings = [];
  let tailFin = null;
  let lureStalk = null;
  let lureOrb = null;

  if (flies) {
    if (isFish) {
      const finMat = new THREE.MeshStandardMaterial({
        color: bodyCol.clone().offsetHSL(0, -0.05, 0.14),
        flatShading: true,
        roughness: 0.5,
        side: THREE.DoubleSide,
      });
      for (const side of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(side * 0.24, -0.02, 0.02);
        pivot.rotation.z = side * -0.45;
        pivot.rotation.x = -0.18;
        group.add(pivot);
        const finGeo = jitterGeo(
          new THREE.IcosahedronGeometry(0.16, 0),
          0.035
        );
        finGeo.scale(1.75, 0.12, 0.85);
        const fin = new THREE.Mesh(finGeo, finMat);
        fin.position.set(side * 0.2, -0.02, -0.02);
        fin.castShadow = true;
        pivot.add(fin);
        wings.push(pivot);
      }
      const tailGeo = jitterGeo(new THREE.IcosahedronGeometry(0.18, 0), 0.04);
      tailGeo.scale(0.38, 1.35, 1.6);
      tailFin = new THREE.Mesh(tailGeo, finMat);
      tailFin.position.set(0, 0.02, -0.58);
      tailFin.castShadow = true;
      group.add(tailFin);

      if (isAngler) {
        const lureMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(biome.accent),
          emissive: new THREE.Color(biome.accent),
          emissiveIntensity: 1.55,
          roughness: 0.25,
        });
        const stalkMat = new THREE.MeshStandardMaterial({
          color: bodyCol.clone().offsetHSL(0, -0.08, -0.08),
          roughness: 0.65,
          flatShading: true,
        });
        lureStalk = new THREE.Mesh(
          new THREE.CylinderGeometry(0.012, 0.018, 0.52, 6),
          stalkMat
        );
        lureStalk.position.set(0, 0.38, 0.2);
        lureStalk.rotation.x = -0.72;
        group.add(lureStalk);

        lureOrb = new THREE.Mesh(
          new THREE.SphereGeometry(0.07, 10, 8),
          lureMat
        );
        lureOrb.position.set(0, 0.27, 0);
        lureOrb.layers.enable(BLOOM_LAYER);
        lureStalk.add(lureOrb);
      }
    } else {
      // wings — flattened ellipsoid icospheres on hinge groups
      const wingMat = new THREE.MeshStandardMaterial({
        color: isBumblebee ? 0xccccdd : bodyCol.clone().offsetHSL(0, -0.15, 0.12),
        flatShading: true,
        roughness: isBumblebee ? 0.3 : 0.45,
        side: THREE.DoubleSide,
      });
      for (const side of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(side * 0.12, 0.18, -0.02);
        group.add(pivot);

        const wingGeo = jitterGeo(
          new THREE.IcosahedronGeometry(0.18, 0),
          0.04
        );
        wingGeo.scale(2.4, 0.18, 1.1);
        const wing = new THREE.Mesh(wingGeo, wingMat);
        wing.position.set(side * 0.38, 0, 0);
        wing.castShadow = true;
        pivot.add(wing);
        wings.push(pivot);
      }

      if (isBumblebee) {
        // Six legs — three pairs along the underside. Larger than the
        // original tiny proportions so they're readable at half scale.
        const legMat = new THREE.MeshStandardMaterial({
          color: 0x111111,
          roughness: 0.6,
        });
        const legGeo = new THREE.CylinderGeometry(0.028, 0.022, 0.38, 4);
        legGeo.translate(0, -0.19, 0);
        const legPositions = [
          [-0.16, 0.10],
          [ 0.16, 0.10],
          [-0.16, 0.00],
          [ 0.16, 0.00],
          [-0.16,-0.10],
          [ 0.16,-0.10],
        ];
        for (const [fx, fz] of legPositions) {
          const leg = new THREE.Mesh(legGeo, legMat);
          leg.position.set(fx, -0.14, fz);
          leg.castShadow = true;
          group.add(leg);
          legs.push(leg);
          const foot = new THREE.Mesh(
            new THREE.SphereGeometry(0.03, 4, 4),
            legMat
          );
          foot.position.set(fx, -0.52, fz);
          group.add(foot);
          feet.push(foot);
        }
      } else {
        // two dangling feet for charm (no legs, just little nubs hanging)
        const dangleMat = new THREE.MeshStandardMaterial({
          color: bodyCol.clone().offsetHSL(0, 0, -0.25),
          flatShading: true,
        });
        for (const sign of [-1, 1]) {
          const dangle = new THREE.Mesh(
            new THREE.CylinderGeometry(0.025, 0.04, 0.16, 5),
            dangleMat
          );
          dangle.position.set(sign * 0.11, -0.36, 0.02);
          dangle.castShadow = true;
          group.add(dangle);
        }
      }
      // Stinger — thin black cone at the rear
      if (isBumblebee) {
        const stingerGeo = new THREE.ConeGeometry(0.045, 0.45, 5);
        stingerGeo.rotateX(-Math.PI / 2);
        stingerGeo.translate(0, 0, -0.55);
        const stinger = new THREE.Mesh(stingerGeo, new THREE.MeshStandardMaterial({
          color: 0x0a0a0a,
          roughness: 0.4,
        }));
        group.add(stinger);
      }
    }
  } else {
    // walkers: visible legs + feet
    const legMat = new THREE.MeshStandardMaterial({
      name: "walker.leg.mat.smooth",
      color: bodyCol.clone().offsetHSL(0, 0, -0.18),
      roughness: 0.75,
    });
    const footMat = new THREE.MeshStandardMaterial({
      name: "walker.foot.mat.smooth",
      color: bodyCol.clone().offsetHSL(0, 0, -0.3),
    });
    // cylinder of length 1 with its origin at the top so scale.y = length.
    // Geometry data is identical for every leg of every creature — pool a
    // single shared instance instead of allocating + disposing per creature.
    const legGeo = pooled("leg.geo", () => {
      const g = new THREE.CylinderGeometry(0.045, 0.06, 1, 6);
      g.translate(0, -0.5, 0);
      return g;
    });
    const footGeo = pooled("foot.geo", () => new THREE.SphereGeometry(0.085, 6, 6));

    const footPositions = [
      [-0.18, 0.18],
      [0.18, 0.18],
      [-0.18, -0.18],
      [0.18, -0.18],
    ];
    for (const [fx, fz] of footPositions) {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(fx, -0.1, fz);
      leg.scale.y = 0.22; // resting length, updated each frame
      leg.castShadow = true;
      group.add(leg);
      legs.push(leg);

      const foot = new THREE.Mesh(footGeo, footMat);
      foot.position.set(fx, -0.32, fz);
      foot.scale.set(1.15, 0.55, 1.3);
      foot.userData.groundMarkOffset = { x: fx, z: fz };
      foot.castShadow = true;
      group.add(foot);
      feet.push(foot);
    }
  }

  const sizeMul = opts.sizeMul ?? 1;
  const baseScale = 0.65 + Math.random() * 0.6;
  // burrowers are notably smaller; kids inherit sizeMul on top
  const burrowScale = opts.burrower ? 0.55 : 1;
  const scale = baseScale * sizeMul * burrowScale * (isFish ? 0.5625 : 1) * (isBumblebee ? 0.5 : 1);
  group.scale.setScalar(scale);

  const hoverHeight = 1.4 + Math.random() * 1.8;

  const isSleeper = !!opts.sleeper && !flies;
  const isBurrower = !!opts.burrower && !flies;

  // Sleepers spawn already curled (eyes scaled to 0, body squashed, legs
  // tucked under the body, belly collapsed, antennae retracted).
  // stepCreature animates the wake-up in reverse.
  let wakeProgress = isSleeper ? 0 : 1;
  if (isSleeper) {
    for (const e of eyeParts) e.scale.setScalar(0);
    body.scale.set(bodyBaseX * 1.18, bodyBaseY * 0.55, bodyBaseZ * 1.05);
    for (let i = 0; i < legs.length; i++) {
      legs[i].scale.y = 0.02;
      feet[i].position.y = -0.15;
    }
    belly.scale.set(0, 0, 0);
    // Uniform scale so the tip (child of stalk at local +Y) collapses with it.
    for (const a of antennae) a.scale.setScalar(0);
  }

  // Personality stamp — pulled from the deterministic RNG during world-gen,
  // applies subtle multipliers to speed/think/bob and biases the sleep,
  // herd, and hop responses below.
  const personalityName =
    PERSONALITY_NAMES[Math.floor(Math.random() * PERSONALITY_NAMES.length)];
  const personality = PERSONALITIES[personalityName];

  const baseSpeed = flies ? 1.1 + Math.random() * 0.9 : 0.6 + Math.random() * 0.7;
  const baseBobSpeed = flies ? 4 + Math.random() * 2 : 6 + Math.random() * 3;

  return {
    group,
    body,
    belly,
    antennae,
    feet,
    legs,
    wings,
    tailFin,
    lureStalk,
    lureOrb,
    isAngler,
    eyeParts,
    flies,
    isFish,
    isBee: isBumblebee,
    scale,
    role: opts.role || null,         // "parent" | "kid" | null
    parent: opts.parent || null,     // reference to parent creature (kids only)
    heading: Math.random() * Math.PI * 2,
    speed: baseSpeed * personality.speedMul * (isFish ? FISH_SPEED_MULTIPLIER : 1),
    bob: Math.random() * Math.PI * 2,
    bobSpeed: baseBobSpeed * personality.bobSpeedMul,
    flapSpeed: 16 + Math.random() * 10,
    flapPhase: Math.random() * Math.PI * 2,
    hoverHeight,
    // landing state — only used when flies===true
    landState: "flying", // "flying" | "descending" | "landed" | "ascending"
    landTimer: 6 + Math.random() * 14, // seconds until first landing attempt
    currentHover: hoverHeight, // animated; lerps between hoverHeight and rest
    // Mushroom cap to land on (or null for an ordinary ground landing).
    // Picked on flying→descending; cleared on ascending→flying.
    perchTarget: null,
    perchOffsetX: 0,
    perchOffsetZ: 0,
    // Smoothed blend factor from terrain ground → perch top. Lerps toward
    // a closeness target each frame so the floor change can never snap,
    // even if the perch was picked at close range or the flier crosses
    // the closeness curve quickly.
    perchFloorWeight: 0,
    bodyBaseY,
    bodyBaseX,
    bodyBaseZ,
    bodyColor: bodyCol.clone(),
    furShells,
    nextThink: Math.random() * 2.5,
    pauseUntil: 0,
    age: Math.random() * 100,
    // sleeper state — when isSleeper, the creature won't think/move until woken.
    isSleeper,
    wakeProgress,             // 0 = fully asleep, 1 = fully awake
    // burrower state — alternating cycles of above-ground/burrowed life
    isBurrower,
    burrowState: isBurrower ? "surface" : null, // "surface" | "descending" | "burrowed" | "sinking" | "moundGone" | "moundRising" | "emerging"
    burrowTimer: isBurrower ? 2 + Math.random() * 4 : 0,
    burrowDepth: 0,           // 0 = on ground, 1 = fully submerged
    dirtColor: new THREE.Color(biome.ground[0]).lerp(new THREE.Color("#8b6914"), 0.45),
    moundMesh: null,
    moundSinkT: -1,          // >= 0 while sinking, set by hideMound
    moundSinkBaseY: 0,
    moundSinkBaseScaleY: 0,
    moundRiseT: -1,           // >= 0 while rising at emerge location
    moundHideTimer: -1,       // countdown to hide mound after emerging
    moundEmergeNormal: null,  // terrain normal at emerge point
    moundEmergeDist: 0,       // full sink distance at emerge point
    moundEmergeX: 0,          // X/Z to pin creature at during emerging
    moundEmergeZ: 0,
    // Personality + behavior knobs read by stepCreature
    personality: personalityName,
    pauseChance: personality.pauseChance,
    bobAmpMul: personality.bobAmpMul,
    hopProb: personality.hopProb,
    herdStrength: personality.herdStrength,
    nightThresh: personality.nightThresh,
    // Color bucket for O(1) herding lookups — hex string matching bodyColor.
    // Populated by the world-gen code in world.js after all creatures are spawned.
    colorBucket: bodyCol.getHexString(),
    // Look-at-camera — set by the UI hover handler to N seconds; stepCreature
    // decrements and overrides the heading-based rotation while > 0.
    lookTimer: 0,
    // Curiosity hop — a vertical pos.y bump added on top of the regular
    // ground+bob math. hopVy is the integrated vertical velocity, hopOffset
    // the current height above resting, hopCooldown the gate.
    hopVy: 0,
    hopOffset: 0,
    hopCooldown: 1.5 + Math.random() * 3,
    // Night-sleep — 0..1 sleepiness target driven by state.nightFactor and
    // personality.nightThresh. zSprites is a per-creature pool of rising "z"
    // particles spawned while sleeping; they finish their fade on wake.
    sleepiness: 0,
    zSprites: [],
    zSpawnTimer: 0,
    // Footstep dust — per-foot last sin sample for rising-edge detection,
    // and a global per-creature cooldown so multiple feet don't all kick
    // at once. Allocated for fliers/fish too (cheap) since the walker
    // animation block is never entered for them.
    lastFootSin: [0, 0, 0, 0],
    lastDustAt: 0,
    // Think counter — incremented each think event so certain expensive
    // checks (nearestBuzzer) can gate on modulo instead of running every
    // single think.
    thinkCount: 0,
    // Terrain slope cache — avoids 4 heightFn calls per walker per frame
    // when the creature hasn't moved enough to change the slope.
    _slopeCache: null,
    _slopeCacheX: NaN,
    _slopeCacheZ: NaN,
  };
}

/**
 * Trigger a brief look-at-camera response (1.5s). Called from the UI
 * hover/tap handler — `stepCreature`'s facing override decays `c.lookTimer`
 * back to 0 each frame. No-op for sleepers.
 * @param {object} c - creature state.
 */
export function lookAtCreature(c) {
  if (c.isSleeper) return;
  // 1.5s of camera-facing — long enough to read, short enough to not feel sticky
  c.lookTimer = 1.5;
}

/**
 * Distance to the nearest butterfly or bee, for the curiosity-hop trigger.
 * Cheap — early-exits as soon as a hit within 1 unit is found, so most calls
 * bail after scanning a handful of entries.
 * @param {{x: number, z: number}} pos - world-space position to measure from (mesh-local under state.world).
 * @returns {number} distance to the nearest buzzer, or Infinity if none are loaded.
 */
function nearestBuzzer(pos) {
  let best = Infinity;
  const list1 = state.butterflies;
  for (let i = 0; i < list1.length; i++) {
    const bp = list1[i].group.position;
    const dx = bp.x - pos.x;
    const dz = bp.z - pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < best) best = d2;
    if (best < 1.0) return Math.sqrt(best);
  }
  const list2 = state.bees;
  for (let i = 0; i < list2.length; i++) {
    const bp = list2[i].group.position;
    const dx = bp.x - pos.x;
    const dz = bp.z - pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < best) best = d2;
    if (best < 1.0) return Math.sqrt(best);
  }
  return Math.sqrt(best);
}

/**
 * Emit one ground mark under a walker's foot at the current rising-edge step,
 * biased to a side based on which foot. No-op for fliers/fish, if ground
 * marks are disabled for the biome, or if the foot is over water.
 * @param {object} c - creature state.
 * @param {number} footIndex - index into `c.feet`/`c.legs`.
 * @param {(x: number, z: number) => number} heightFn - world-space terrain height sampler.
 */
function emitWalkerFootprint(c, footIndex, heightFn) {
  const marks = state.groundMarks;
  const cfg = state.currentBiome?.groundMarks;
  if (!marks || !cfg || c.flies || c.isFish) return;
  const foot = c.feet[footIndex];
  const off = foot?.userData?.groundMarkOffset;
  if (!off) return;
  const p = localFootToWorld(c, off.x, off.z);
  const y = heightFn(p.x, p.z);
  if (state.waterMesh && y < WATER_AVOID_Y) return;
  const side = off.x < 0 ? -1 : 1;
  emitGroundMark(marks, {
    x: p.x,
    z: p.z,
    heading: c.heading + side * 0.16,
    width: Math.max(0.045, 0.08 * c.scale),
    length: Math.max(0.075, 0.15 * c.scale),
    opacity: cfg.opacity,
    life: cfg.life,
  });
}

/**
 * Nudge `c.heading` toward the nearest same-color creature (searched via
 * `state.creatureColorBuckets` when available, else the full creature list)
 * so kin pair up into loose pairs/trios — pulling together in a 1.4–4 unit
 * sweet spot, drifting apart if closer than 1.2 units, ignoring anyone beyond
 * 8 units. Capped by `c.herdStrength` and only called once per think cycle,
 * so it never overpowers the existing random wander.
 * @param {object} c - creature state; mutates `c.heading`.
 */
function herdInfluence(c) {
  const me = c.group.position;
  let best = null;
  let bestD = Infinity;
  // Use color bucket if available — only scan same-colored creatures
  // instead of the full list.
  const bucket = state.creatureColorBuckets?.[c.colorBucket];
  const list = bucket || state.creatures;
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (o === c) continue;
    if (o.isSleeper || o.isBurrower) continue;
    if (!bucket && !colorsClose(o.bodyColor, c.bodyColor)) continue;
    const op = o.group.position;
    const dx = op.x - me.x;
    const dz = op.z - me.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > 64) continue;        // ignore peers more than 8 units away
    if (d2 < bestD) {
      bestD = d2;
      best = o;
    }
  }
  if (!best) return;
  const op = best.group.position;
  const d = Math.sqrt(bestD);
  // Too close → drift apart slightly. Sweet spot 1.4–4 units → pull toward.
  const sign = d < 1.2 ? -1 : 1;
  const targetH = Math.atan2(op.z - me.z, op.x - me.x);
  const diff = wrapAngle(targetH - c.heading);
  c.heading += sign * diff * c.herdStrength * 0.4;
}

/**
 * Wake a sleeping creature. Called from the UI hover handler and from the
 * first-person stroll proximity check. Handles two distinct sleep states:
 *  - `isSleeper`: spawned-asleep flag set at world-gen time.
 *  - `sleepiness > 0.05`: natural night-sleep, eased in by the night cycle
 *    (also covers a drowsy, non-fish flier, which is nudged into "ascending"
 *    if it was landed/descending rather than fully unfurled).
 * Either path (for walkers) triggers the same unfurl animation via
 * `c._waking`/`c.wakeProgress`, and sets `c.alertUntil` so the per-frame
 * sleepiness target is forced to 0 for ~8 seconds — otherwise the creature
 * would re-curl immediately because `state.nightFactor` is still high.
 * No-op if the creature isn't asleep by either measure.
 * @param {object} c - creature state.
 */
export function wakeCreature(c) {
  const naturallyAsleep = !c.flies && c.sleepiness > 0.05;
  const drowsyFlier = c.flies && !c.isFish && c.sleepiness > 0.05;
  if (!c.isSleeper && !naturallyAsleep && !drowsyFlier) return;
  c.isSleeper = false;
  c.sleepiness = 0;
  c.alertUntil = (c.age ?? 0) + 8;
  c.heading = Math.random() * Math.PI * 2;
  c.nextThink = 0.3 + Math.random() * 0.6;
  if (drowsyFlier) {
    if (c.landState === "landed" || c.landState === "descending") {
      c.landState = "ascending";
      c.landTimer = 8 + Math.random() * 6;
    }
    return;
  }
  c._waking = true;
  // Reset wakeProgress so the unfurl actually animates from curled → upright.
  // For natural sleepers wakeProgress was 1 (set at spawn), so without this
  // the eyes/body would snap open instantly on wake.
  c.wakeProgress = 0;
}

/**
 * Advance one creature by one simulation frame. Thin dispatcher over the
 * creature's top-level state: after integrating age/timers/hop-physics and
 * updating sleepiness/z-particles, it hands off in priority order to
 * `stepSleeper` (spawned-asleep, early-exits), `stepNightSleep` (walker
 * curled from night sleepiness, early-exits once fully curled), `stepBurrower`
 * (burrower FSM, early-exits while fully underground), and `stepFlier`
 * (non-fish flier landing FSM) — before falling through to the shared
 * think/move/position/animate pipeline used by plain walkers, landed fliers,
 * and fish.
 * @param {object} c - creature state, as returned by {@link makeCreature}; mutated in place.
 * @param {number} dt - frame delta time in seconds (0 while the sim is paused).
 * @param {number} t - simulation time in seconds (frozen while paused).
 * @param {(x: number, z: number) => number} heightFn - world-space terrain height sampler.
 */
export function stepCreature(c, dt, t, heightFn) {
  c.age += dt;
  c.nextThink -= dt;
  if (c.lookTimer > 0) c.lookTimer -= dt;
  if (c.hopCooldown > 0) c.hopCooldown -= dt;

  updateSleepiness(c, dt, state.nightFactor ?? 0);
  stepZParticles(c, dt);

  // Integrate the hop physics every frame so a hop in flight smoothly settles
  // even if the cooldown is later overwritten.
  if (c.hopVy !== 0 || c.hopOffset !== 0) {
    c.hopOffset += c.hopVy * dt;
    c.hopVy -= 14 * dt;
    if (c.hopOffset <= 0) {
      c.hopOffset = 0;
      c.hopVy = 0;
    }
  }

  // ── sleeping (curled, eyes closed, no motion) ─────────────────────────
  // stepSleeper owns the entire sleeper frame and early-exits the dispatcher
  // (it plants itself on the slope and does no further motion/animation).
  if (c.isSleeper) {
    stepSleeper(c, dt, t, heightFn);
    return;
  }

  // ── waking-up animation (unfurl eyes + body + legs) ───────────────────
  if (c._waking) {
    stepWakeAnimation(c, dt);
  }

  // ── night sleep (walkers only) ────────────────────────────────────────
  // High sleepiness curls a walker down on the spot. stepNightSleep returns
  // true once the creature is fully curled (s > 0.6) — in that state it owns
  // the slope pose and the dispatcher must skip the trailing motion/animation.
  if (!c.flies && c.sleepiness > 0.05 && !c._waking) {
    if (stepNightSleep(c, dt, t, heightFn)) return;
  }

  // ── burrower state machine ────────────────────────────────────────────
  // stepBurrower runs the FSM + mound animations. It returns true while the
  // creature is fully underground (burrowed/sinking/moundRising) — those
  // states skip all motion/animation, so the dispatcher early-exits.
  if (c.isBurrower) {
    if (stepBurrower(c, dt, heightFn)) return;
  }

  // ── flier landing state machine ────────────────────────────────────────
  // Fish never land — they always float.
  if (c.flies && !c.isFish) {
    stepFlier(c, dt, heightFn);
  }

  const grounded = c.flies && c.landState === "landed";

  stepThink(c, dt, t, grounded);

  let moving = t > c.pauseUntil;
  // landed fliers stay put — they perched
  if (grounded) moving = false;

  moveCreature(c, dt, t, heightFn, moving);
  positionCreatureY(c, dt, t, heightFn, moving, grounded);
  animateCreature(c, dt, t, heightFn, moving, grounded);
}

/**
 * ── waking-up animation (unfurl eyes + body + legs) ────────────────────────
 * Ease `c.wakeProgress` from 0→1 over ~0.56s, un-curling eyes/body/legs/
 * belly/antennae in lockstep, and clear `c._waking` once complete. Called
 * from `stepCreature` while `c._waking` is true. Extracted from
 * stepCreature's per-frame head (QA-010).
 * @param {object} c - creature state.
 * @param {number} dt - frame delta time in seconds.
 */
function stepWakeAnimation(c, dt) {
  c.wakeProgress = Math.min(1, c.wakeProgress + dt * 1.8);
  const w = c.wakeProgress;
  for (const e of c.eyeParts) e.scale.setScalar(w);
  // body lerps from curled → resting baseline (the squash anim below
  // takes over once we're fully awake)
  c.body.scale.x = c.bodyBaseX * (1.18 + (1 - 1.18) * w);
  c.body.scale.y = c.bodyBaseY * (0.55 + (1 - 0.55) * w);
  // legs extend back to resting length, feet drop to their normal place
  for (let i = 0; i < c.legs.length; i++) {
    c.legs[i].scale.y = 0.02 + (0.22 - 0.02) * w;
    c.feet[i].position.y = -0.15 + (-0.32 - -0.15) * w;
  }
  // belly inflates back to its base scale
  if (c.belly) {
    const bs = c.belly.userData.baseScale;
    c.belly.scale.set(bs.x * w, bs.y * w, bs.z * w);
  }
  // antennae grow back to full length
  if (c.antennae) for (const a of c.antennae) a.scale.setScalar(w);
  if (w >= 1) c._waking = false;
}

/**
 * ── think + heading bias (perch homing, family kids) ───────────────────────
 * On each `c.nextThink` expiry, roll a pause vs. a random heading jitter
 * (plus herd influence), and gate an occasional curiosity hop near a
 * butterfly/bee. While a flier is homing to a perch (`landState ===
 * "descending"` with a `perchTarget`), skips the random jitter in favor of
 * dedicated perch-seeking steering; family "kid" creatures also get a bias
 * back toward their parent when they've drifted more than 2.2 units away.
 * Extracted from stepCreature's pre-movement head (QA-010).
 * @param {object} c - creature state; mutates `c.heading`, `c.nextThink`,
 *   `c.pauseUntil`, `c.hopVy`/`c.hopCooldown`, `c.thinkCount`.
 * @param {number} dt - frame delta time in seconds.
 * @param {number} t - simulation time in seconds.
 * @param {boolean} grounded - true if a flier is currently landed.
 */
function stepThink(c, dt, t, grounded) {
  // think — fliers never pause while airborne; walkers + landed fliers can
  if (c.nextThink <= 0) {
    const homingToPerch =
      c.flies && c.perchTarget && c.landState === "descending";
    if ((!c.flies || grounded) && Math.random() < c.pauseChance) {
      c.pauseUntil = t + 0.6 + Math.random() * 1.4;
    } else if (!homingToPerch) {
      c.heading += (Math.random() - 0.5) * (c.flies && !grounded ? 1.2 : 1.6);
      // Herding — pull toward the nearest same-color creature (capped). Only
      // applied during the think event so it's cheap (O(creatures) per
      // creature ~once a second) and doesn't fight the natural wander.
      if (!c.flies || grounded) {
        herdInfluence(c);
      }
    }
    // While homing to a perch, intentionally skip the random heading
    // jitter — the dedicated perch-homing steering below takes the wheel,
    // so the flier flies straight at the cap instead of curving around it.
    // Trigger a curiosity hop if a butterfly or bee is buzzing nearby. Walkers
    // and landed fliers only — airborne fliers don't need to hop.
    // Only check every 3rd think cycle — curiosity hops don't need instant
    // response and the scan is O(butterflies + bees).
    c.thinkCount++;
    if (
      (!c.flies || grounded) &&
      c.hopCooldown <= 0 &&
      c.hopOffset === 0 &&
      c.sleepiness < 0.4 &&
      c.thinkCount % 3 === 0
    ) {
      const near = nearestBuzzer(c.group.position);
      if (near < 2.4 && Math.random() < c.hopProb) {
        c.hopVy = 2.0 + Math.random() * 0.6;
        c.hopCooldown = 3 + Math.random() * 3;
      }
    }
    c.nextThink = (c.flies ? 0.7 : 1.2) + Math.random() * (c.flies ? 1.8 : 3.0);
  }

  // Perch homing — while descending toward a mushroom cap, override the
  // random heading jitter so we actually fly to it. Steering rate is
  // bumped (and stronger when close) so the flier resolves heading
  // errors quickly instead of orbiting the cap on its way in.
  if (c.flies && c.perchTarget && c.landState === "descending") {
    const perchPoint = currentPerchPoint(c.perchTarget);
    const dx = perchPoint.x - c.group.position.x;
    const dz = perchPoint.z - c.group.position.z;
    const target = Math.atan2(dz, dx);
    const diff = wrapAngle(target - c.heading);
    const xz2 = dx * dx + dz * dz;
    const turnRate = xz2 < 4 ? 9 : 5;
    c.heading += diff * Math.min(1, dt * turnRate);
  }

  // family kids — if we've drifted too far from the parent, bias heading
  // toward them. Only nudges the heading; the normal think loop still adds jitter.
  if (c.role === "kid" && c.parent && c.parent.group.parent) {
    const pp = c.parent.group.position;
    const me = c.group.position;
    const dx = pp.x - me.x;
    const dz = pp.z - me.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > 2.2) {
      const target = Math.atan2(dz, dx);
      // shortest-arc lerp toward parent heading
      const diff = wrapAngle(target - c.heading);
      c.heading += diff * Math.min(1, dt * 1.2);
    }
  }
}

/**
 * ── movement: heading/obstacle/edge/speed integration ──────────────────────
 * Integrate `c.group.position` XZ by heading × speed × dt (0 if `!moving`),
 * with edge avoidance (fish stay in their swim band; airborne fliers may
 * range past the island edge but never off the base plane; walkers/landed
 * fliers turn back near the island radius or a waterline), obstacle sliding
 * (via `avoidObstacles`, skipping the creature's own claimed perch), and
 * post-commit water-crossing reverts for both fish and ground movers.
 * Extracted from stepCreature (QA-010).
 * @param {object} c - creature state; mutates `c.group.position.x/.z`, `c.heading`, `c.bob`.
 * @param {number} dt - frame delta time in seconds.
 * @param {number} t - simulation time in seconds (unused directly; kept for
 *   signature symmetry with the other dispatch-chain phases).
 * @param {(x: number, z: number) => number} heightFn - world-space terrain height sampler.
 * @param {boolean} moving - false during a think-triggered pause or while landed.
 */
function moveCreature(c, dt, t, heightFn, moving) {
  const pos = c.group.position;
  if (moving) {
    let speedFactor = 1 - c.sleepiness * 0.85;
    // Slow the approach when close to a perch so the flier can settle on
    // the cap rather than zooming past it and lapping around for another
    // pass. Falls from full speed at xzDist 2.5 down to 30% at xzDist 0.
    if (c.flies && c.perchTarget && c.landState === "descending") {
      const perchPoint = currentPerchPoint(c.perchTarget);
      const dxp = perchPoint.x - pos.x;
      const dzp = perchPoint.z - pos.z;
      const xzDist = Math.sqrt(dxp * dxp + dzp * dzp);
      const k = Math.max(0, Math.min(1, xzDist / 2.5));
      speedFactor *= 0.3 + 0.7 * k;
    }
    const step = c.speed * dt * speedFactor;
    const oldPosX = pos.x;
    const oldPosZ = pos.z;
    const nx = pos.x + Math.cos(c.heading) * step;
    const nz = pos.z + Math.sin(c.heading) * step;
    // Edge avoidance:
    //  - walkers stay on the island plateau (turn back near the radius edge,
    //    so they don't wander down the slope onto the flat base plane)
    //  - fliers may range out over the slope but turn back inside the base
    //    plane so they never disappear off-world
    //  - in water biomes, walkers also turn back if their next step would
    //    submerge them below the waterline
    let wouldStray;
    let target;
    if (c.isFish && state.waterMesh) {
      const planeBound = state.ISLAND_SIZE * 0.46;
      const nextGround = heightFn(nx, nz);
      wouldStray =
        Math.sqrt(nx * nx + nz * nz) > planeBound ||
        nextGround > fishMaxGroundY(c.scale) ||
        nextGround < FISH_MIN_GROUND_Y;
      target = nearestCenter(pos.x, pos.z);
    } else if (c.flies && c.landState !== "landed") {
      const planeBound = state.ISLAND_SIZE * 0.46;
      wouldStray = Math.sqrt(nx * nx + nz * nz) > planeBound;
      // Fliers may cruise across water. The Y-position block below raises
      // their floor to water-surface + body clearance; this branch only blocks
      // them from straying off the island plate altogether.
      target = nearestCenter(pos.x, pos.z);
    } else {
      const near = nearestCenter(nx, nz);
      const dx = nx - near.cx;
      const dz = nz - near.cz;
      wouldStray = Math.sqrt(dx * dx + dz * dz) > near.radius * 0.94;
      if (!wouldStray && state.waterMesh && heightFn(nx, nz) < WATER_AVOID_Y) {
        wouldStray = true;
      }
      target = near;
    }

    if (wouldStray) {
      // Squared distances — only the > comparison matters, skip the sqrts.
      const currentDist2 = target
        ? (pos.x - target.cx) * (pos.x - target.cx) + (pos.z - target.cz) * (pos.z - target.cz)
        : 0;
      const nextDist2 = target
        ? (nx - target.cx) * (nx - target.cx) + (nz - target.cz) * (nz - target.cz)
        : currentDist2;
      const recoveringStrayFlier =
        c.flies &&
        c.landState !== "landed" &&
        !c.isFish &&
        currentDist2 > nextDist2;
      if (c.isFish) {
        c.heading += Math.PI + (Math.random() - 0.5) * 0.7;
      } else {
        c.heading =
          Math.atan2(target.cz - pos.z, target.cx - pos.x) +
          (Math.random() - 0.5) * 0.5;
      }
      if (recoveringStrayFlier) {
        pos.x = nx;
        pos.z = nz;
      }
    } else {
      // Obstacle slide — walkers always route around trunks; fliers route
      // around them too, but only while below the canopy (height filter in
      // avoidObstacles short-circuits if the flier is comfortably above).
      // A flier targeting a mushroom passes its perch coords as skipX/skipZ
      // so it doesn't get pushed away from the very cap it's trying to land
      // on.
      const skipPerch = c.perchTarget ? currentPerchPoint(c.perchTarget) : null;
      const slide = avoidObstacles(
        pos.x,
        pos.z,
        nx,
        nz,
        c.heading,
        step,
        0.25 * c.scale,
        c.flies ? pos.y : undefined,
        skipPerch?.x,
        skipPerch?.z,
        c
      );
      if (slide) {
        pos.x = slide.nx;
        pos.z = slide.nz;
        c.heading = slide.heading;
      } else {
        pos.x = nx;
        pos.z = nz;
      }
    }
    // Post-commit water guards. The pre-step water check above only sees the
    // straight-step nx/nz — obstacle slide (slide.nx/.nz) and a herd-influence
    // heading rotation can deflect the committed position across a waterline.
    // Ground movers revert if they enter water; fish revert if they leave a
    // deep-enough swim band.
    if (c.isFish && state.waterMesh) {
      const fishGround = heightFn(pos.x, pos.z);
      if (fishGround > fishMaxGroundY(c.scale) || fishGround < FISH_MIN_GROUND_Y) {
        pos.x = oldPosX;
        pos.z = oldPosZ;
        c.heading += Math.PI + (Math.random() - 0.5) * 0.5;
      }
    }
    if (
      !c.flies &&
      state.waterMesh &&
      heightFn(pos.x, pos.z) < WATER_AVOID_Y
    ) {
      pos.x = oldPosX;
      pos.z = oldPosZ;
      c.heading += Math.PI + (Math.random() - 0.5) * 0.4;
    }
    c.bob += dt * c.bobSpeed;
  } else {
    c.bob += dt * 2;
  }
}

/**
 * ── vertical placement: ground sampling, slope tilt, hover/perch floor ────
 * Set `c.group.position.y` (and pin XZ to the perch point when grounded on
 * one) for the current frame: fish swim within a terrain/waterline band with
 * a bob cycle; fliers blend the floor from terrain ground up to a
 * water-clearance floor and/or the claimed perch's top (smoothstepped +
 * low-pass filtered via `c.perchFloorWeight` so the rise/fall never snaps),
 * plus hover bob; walkers rest on the ground with a bob, and burrowers sink
 * along the terrain normal toward their cached emerge point while
 * `c.burrowDepth > 0`. Extracted from stepCreature (QA-010).
 * @param {object} c - creature state; mutates `c.group.position`.
 * @param {number} dt - frame delta time in seconds.
 * @param {number} t - simulation time in seconds, used for bob/swim phase.
 * @param {(x: number, z: number) => number} heightFn - world-space terrain height sampler.
 * @param {boolean} moving - whether the creature is currently walking (affects walker bob amplitude).
 * @param {boolean} grounded - true if a flier is currently landed.
 */
function positionCreatureY(c, dt, t, heightFn, moving, grounded) {
  const pos = c.group.position;
  if (grounded && c.perchTarget) {
    const perchPoint = currentPerchPoint(c.perchTarget);
    pos.x = perchPoint.x + c.perchOffsetX;
    pos.z = perchPoint.z + c.perchOffsetZ;
  }

  const ground = heightFn(pos.x, pos.z);
  if (c.isFish && state.waterMesh) {
    const halfBodyY = 0.42 * c.bodyBaseY * c.scale;
    const topY = WATER_AVOID_Y - 0.2 - halfBodyY;
    const bottomY = ground + halfBodyY + 0.04;
    if (bottomY > topY) {
      c.heading += Math.PI + (Math.random() - 0.5) * 0.5;
      pos.y += (topY - pos.y) * Math.min(1, dt * 4.0);
    } else {
      const band = topY - bottomY;
      const swimT = THREE.MathUtils.clamp(
        0.5 +
          Math.sin(t * 0.7 + c.flapPhase) * 0.34 +
          Math.sin(t * 0.23 + c.age) * 0.12,
        0.08,
        0.92
      );
      const cruise = bottomY + band * swimT;
      const swimBob = Math.sin(c.bob) * Math.min(0.08, band * 0.08) * c.bobAmpMul;
      const targetY = Math.max(bottomY, Math.min(topY, cruise + swimBob));
      pos.y += (targetY - pos.y) * Math.min(1, dt * 3.5);
      pos.y = Math.max(bottomY, Math.min(topY, pos.y));
    }
  } else if (c.flies) {
    // Floor blends from terrain ground up to (perch top + a tiny lift) as
    // the flier closes in on its perch in XZ. The blend uses smoothstep
    // over a wide ~4-unit window so the rise reads as a gentle glide arc
    // rather than a snap-up at a hard threshold. perchFloorWeight is
    // additionally low-pass filtered so the *rate* of change is capped
    // — guarantees smoothness even if the perch was picked close-by or
    // the flier crosses the curve quickly. Perch lift accounts for the
    // flier body's half-Y (≈0.39·scale) being slightly larger than restH
    // (0.35·scale): without it the body visibly sinks into the cap.
    //
    // Non-fish fliers over water: raise the floor to the water surface plus
    // body clearance so hover-above-terrain can never put their belly below
    // the waterline. This matters more now that water basins are deeper.
    let floorY = ground;
    let waterClearanceY = null;
    if (!c.isFish && state.waterMesh && ground < WATER_AVOID_Y) {
      waterClearanceY = WATER_AVOID_Y + 0.42 * c.bodyBaseY * c.scale + 0.08;
      floorY = waterClearanceY;
    }
    if (c.perchTarget) {
      const perchPoint = currentPerchPoint(c.perchTarget);
      const dxp = perchPoint.x - pos.x;
      const dzp = perchPoint.z - pos.z;
      const xzDist = Math.sqrt(dxp * dxp + dzp * dzp);
      const NEAR = 0.5;
      const FAR = 4.0;
      const xRaw = (FAR - xzDist) / (FAR - NEAR);
      const xc = Math.max(0, Math.min(1, xRaw));
      const closeness = xc * xc * (3 - 2 * xc);
      // Always target the raw closeness — the weight lerp below handles
      // takeoff just as naturally as approach, because as the flier rises
      // and drifts away the closeness drops and the floor unwinds back to
      // ground smoothly.
      c.perchFloorWeight +=
        (closeness - c.perchFloorWeight) * Math.min(1, dt * 1.6);
      const weight = c.perchFloorWeight;
      // Sit slightly into the cap so the body really touches it (negative
      // because the flier body's half-Y is just a hair larger than restH,
      // so a small bias is needed to keep the contact convincing).
      const perchLift = -0.04 * c.scale;
      floorY = ground * (1 - weight) + (perchPoint.y + perchLift) * weight;
    }
    // bob amplitude scales with current hover — perched creatures only quiver
    const bobAmp = grounded
      ? 0.02
      : 0.28 * Math.min(1, c.currentHover / Math.max(0.1, c.hoverHeight));
    pos.y = floorY + c.currentHover + Math.sin(c.bob) * bobAmp * c.bobAmpMul + c.hopOffset;
    if (waterClearanceY !== null && pos.y < waterClearanceY) pos.y = waterClearanceY;
  } else {
    const bobAmp = (moving ? 0.08 : 0.02) * c.bobAmpMul;
    pos.y = ground + 0.35 * c.scale + Math.sin(c.bob) * bobAmp + c.hopOffset;
    // burrowers sink/rise along terrain normal — burrowDepth=0 surface, 1 fully under
    if (c.isBurrower && c.burrowDepth > 0) {
      // Pin X/Z to emerge point so walking code doesn't drift the creature
      pos.x = c.moundEmergeX;
      pos.z = c.moundEmergeZ;
      const sinkDist = c.burrowDepth * (c.moundEmergeDist || (0.8 + 0.4 * c.scale));
      const n = c.moundEmergeNormal;
      if (n) {
        pos.x -= n.x * sinkDist;
        pos.y -= n.y * sinkDist;
        pos.z -= n.z * sinkDist;
      } else {
        // fallback: sample normal on the fly
        const fallbackNormal = sampleTerrainNormal(pos.x, pos.z, heightFn);
        pos.x -= fallbackNormal.x * sinkDist;
        pos.y -= fallbackNormal.y * sinkDist;
        pos.z -= fallbackNormal.z * sinkDist;
      }
    }
  }
}

/**
 * ── animation: facing, slope tilt, squash & stretch, wings/legs/feet ──────
 * Ease `c.group.rotation.y` to face the heading (or the camera, while
 * `c.lookTimer > 0`); for walkers, ease pitch/roll toward the sampled slope
 * (cached and reused while the creature hasn't moved >0.1 units, to avoid
 * redundant heightFn samples — relies on the group's YXZ Euler order so
 * pitch/roll resolve in the body frame after yaw); apply body squash &
 * stretch; and drive per-variant limb animation (fish fin/tail wave, perched
 * or flapping wings, or the diagonal walker foot-trot with rising-edge
 * footstep ground marks/dust kicks). Extracted from stepCreature (QA-010).
 * @param {object} c - creature state; mutates rotation/scale of `c.group` and its parts.
 * @param {number} dt - frame delta time in seconds.
 * @param {number} t - simulation time in seconds, used for animation phases.
 * @param {(x: number, z: number) => number} heightFn - world-space terrain height sampler.
 * @param {boolean} moving - whether the creature is currently walking.
 * @param {boolean} grounded - true if a flier is currently landed.
 */
function animateCreature(c, dt, t, heightFn, moving, grounded) {
  const pos = c.group.position;

  // face heading (smoothed)
  const targetRot = -c.heading + Math.PI / 2;
  const cur = c.group.rotation.y;
  const diff = wrapAngle(targetRot - cur);
  c.group.rotation.y = cur + diff * Math.min(1, dt * 6);

  // Look-at-camera override — when the user hovers/taps a creature, pull its
  // facing toward the camera for ~1.5s. Stronger lerp than the regular
  // heading-follow so the response reads as deliberate.
  if (c.lookTimer > 0 && state.camera) {
    const camDx = state.camera.position.x - c.group.position.x;
    const camDz = state.camera.position.z - c.group.position.z;
    const camHeading = Math.atan2(camDz, camDx);
    const lookRot = -camHeading + Math.PI / 2;
    const lcur = c.group.rotation.y;
    const ldiff = wrapAngle(lookRot - lcur);
    c.group.rotation.y = lcur + ldiff * Math.min(1, dt * 9);
  }

  // Terrain-normal alignment for walkers — sample the slope along heading
  // and perpendicular to it, then ease group pitch (rotation.x) and roll
  // (rotation.z) toward the matching angles. With YXZ Euler order these
  // resolve in the body frame after yaw, so the creature lies flat on the
  // hillside instead of staying world-axis-aligned and clipping into the
  // slope. Fliers, fish, and burrowed creatures stay level.
  //
  // Cache the 4 heightFn samples and re-use them when the creature hasn't
  // moved far enough to change the slope noticeably (< 0.1 units). This
  // avoids 4 noise evaluations per walker per frame.
  if (!c.flies && !(c.isBurrower && (c.burrowState === "burrowed" || c.burrowState === "sinking" || c.burrowState === "moundRising"))) {
    const ds = 0.25 * c.scale;
    const dx = pos.x - c._slopeCacheX;
    const dz = pos.z - c._slopeCacheZ;
    const moved2 = dx * dx + dz * dz;
    let pitchTarget, rollTarget;
    if (c._slopeCache && moved2 < 0.01) {
      // Reuse cached slopes but recompute heading-dependent atan — heading
      // may change even when position doesn't.
      const sc = c._slopeCache;
      const targets = slopeTargetsFromGradient(sc.gradientX, sc.gradientZ, c.heading);
      pitchTarget = targets.pitchTarget;
      rollTarget = targets.rollTarget;
    } else {
      const slopes = sampleSlopes(pos.x, pos.z, c.heading, ds, heightFn);
      pitchTarget = slopes.pitchTarget;
      rollTarget = slopes.rollTarget;
      // Cache world-space gradients (independent of heading so they stay
      // valid as long as position doesn't change much). Mutate the existing
      // cache object in place — moving walkers miss every few frames, so a
      // fresh object per miss adds steady GC churn.
      if (c._slopeCache) {
        c._slopeCache.gradientX = slopes.gradientX;
        c._slopeCache.gradientZ = slopes.gradientZ;
      } else {
        c._slopeCache = {
          gradientX: slopes.gradientX,
          gradientZ: slopes.gradientZ,
        };
      }
      c._slopeCacheX = pos.x;
      c._slopeCacheZ = pos.z;
    }
    const k = Math.min(1, dt * 5);
    c.group.rotation.x += (pitchTarget - c.group.rotation.x) * k;
    c.group.rotation.z += (rollTarget - c.group.rotation.z) * k;
  } else if (c.flies) {
    // Fliers stay level — ease any residual pitch/roll back to zero in case
    // the creature was just woken from a curled walker state.
    const k = Math.min(1, dt * 4);
    c.group.rotation.x += (0 - c.group.rotation.x) * k;
    c.group.rotation.z += (0 - c.group.rotation.z) * k;
  }

  // squash & stretch body (the wake-up unfurl owns body scale until it finishes;
  // night-sleep also owns body scale while drowsy)
  if (!c._waking && !(!c.flies && c.sleepiness > 0.05)) {
    const squash = 1 + Math.sin(c.bob) * 0.05 * (moving ? 1 : 0.4);
    c.body.scale.y = c.bodyBaseY * squash;
    c.body.scale.x = c.bodyBaseX / Math.sqrt(squash);
  }

  if (c.flies) {
    if (c.isFish) {
      const phase = t * 6.0 + c.flapPhase;
      const wave = Math.sin(phase);
      for (let i = 0; i < c.wings.length; i++) {
        const sign = i === 0 ? -1 : 1;
        c.wings[i].rotation.z = sign * (-0.45 + wave * 0.28);
        c.wings[i].rotation.x = -0.18 + Math.cos(phase * 0.8) * 0.12;
        c.wings[i].rotation.y = Math.cos(phase * 0.7) * 0.18;
      }
      if (c.tailFin) c.tailFin.rotation.y = Math.sin(phase * 1.15) * 0.55;
      c.body.rotation.z = wave * 0.04;
      if (c.isAngler && c.lureStalk && c.lureOrb) {
        c.lureStalk.rotation.z = Math.sin(t * 1.9 + c.flapPhase) * 0.12;
        c.lureOrb.scale.setScalar(1 + Math.sin(t * 3.1 + c.flapPhase) * 0.12);
      }
    } else if (grounded) {
      // Perched wings hang down and sweep back, with a tiny idle twitch so the
      // flier still feels alive while settled.
      const k = Math.min(1, dt * 5);
      const twitch = Math.sin(t * 3.0 + c.flapPhase) * 0.06;
      for (let i = 0; i < c.wings.length; i++) {
        const sign = i === 0 ? -1 : 1;
        const restRotZ = sign * PERCHED_WING_DOWN_Z + twitch * 0.45;
        const restRotY = sign * PERCHED_WING_BACK_Y;
        c.wings[i].rotation.z += (restRotZ - c.wings[i].rotation.z) * k;
        c.wings[i].rotation.y += (restRotY - c.wings[i].rotation.y) * k;
        c.wings[i].rotation.x += (PERCHED_WING_RELAX_X - c.wings[i].rotation.x) * k;
      }
      c.body.rotation.z += (0 - c.body.rotation.z) * k;
    } else {
      // amplitude fades as the creature transitions between hover and ground
      const altRatio = Math.min(
        1,
        (c.currentHover - 0.35 * c.scale) / Math.max(0.1, c.hoverHeight - 0.35 * c.scale)
      );
      const flapStrength = 0.55 + 0.45 * altRatio; // weaker flap near the ground
      const phase = t * c.flapSpeed + c.flapPhase;
      const flap = Math.sin(phase);
      for (let i = 0; i < c.wings.length; i++) {
        const sign = i === 0 ? -1 : 1;
        c.wings[i].rotation.z = sign * (0.15 + flap * 1.2 * flapStrength);
        c.wings[i].rotation.x = Math.cos(phase) * 0.18 * flapStrength;
        c.wings[i].rotation.y = 0;
      }
      c.body.rotation.z = -flap * 0.06 * flapStrength;
    }
  } else if (moving) {
    // diagonal trot pattern: FL+BR phase, FR+BL counter-phase
    const phases = [0, Math.PI, Math.PI, 0];
    for (let i = 0; i < c.feet.length; i++) {
      const sVal = Math.sin(c.bob + phases[i]);
      const footY = -0.32 + sVal * 0.09;
      c.feet[i].position.y = footY;
      c.legs[i].scale.y = -0.1 - footY;
      // Rising-edge footstep detection — fires once when sVal crosses 0.85
      // upward. Every rising foot leaves its own soft-ground footprint.
      // Shared cooldown only throttles the optional tiny sand poof.
      const prev = c.lastFootSin[i] ?? 0;
      if (sVal > 0.85 && prev <= 0.85) {
        emitWalkerFootprint(c, i, heightFn);
        if (t - c.lastDustAt > 0.18) {
          const fx = c.group.position.x;
          const fz = c.group.position.z;
          const fy = heightFn(fx, fz);
          if (fy > 0.1 && state.currentBiome?.groundMarks?.poof === "sand") {
            const kick = makeDustKick(fx, fy, fz, c.dirtColor, {
              count: 2,
              size: 0.045,
              opacity: 0.28,
              velocityScale: 0.35,
              life: 0.28,
            });
            state.world.add(kick);
            state.dustKicks.push(kick);
          }
          if (fy > 0.1 && state.currentBiome?.groundMarks?.poof === "snow") {
            const kick = makeDustKick(fx, fy, fz, "#c8d4e0", {
              count: 3,
              size: 0.055,
              opacity: 0.35,
              velocityScale: 0.25,
              life: 0.35,
            });
            state.world.add(kick);
            state.dustKicks.push(kick);
          }
          c.lastDustAt = t;
        }
      }
      c.lastFootSin[i] = sVal;
    }
  }
}
