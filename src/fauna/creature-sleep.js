import * as THREE from "three";
import { sampleSlopes } from "./shared.js";

// Shared single-"z" texture for the night-sleep particles. Built lazily on
// first drowsy creature, then reused across every spawned z for the session.
let _zTexture = null;
function getZTexture() {
  if (_zTexture) return _zTexture;
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = "#fafaf2";
  ctx.font = "italic bold 44px 'Quicksand', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  ctx.fillText("z", 32, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _zTexture = tex;
  return tex;
}

// One rising z particle. Stream is managed per-creature: spawn cadence,
// per-particle life, sideways drift, fade in then fade out as it climbs.
const Z_LIFE = 2.4;
const Z_SPAWN_INTERVAL = 0.9;
const Z_RISE = 0.9;
// Cached template — each sprite still needs its own material instance (opacity
// animates independently per particle over its staggered life), but cloning
// from one pre-built template avoids re-specifying the constant options object
// (map/transparent/depthWrite) on every spawn.
let _zMatTemplate = null;
function getZMaterialTemplate() {
  if (_zMatTemplate) return _zMatTemplate;
  _zMatTemplate = new THREE.SpriteMaterial({
    map: getZTexture(),
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  return _zMatTemplate;
}
function spawnZ(c) {
  const mat = getZMaterialTemplate().clone();
  const s = new THREE.Sprite(mat);
  const scale = 0.26 + Math.random() * 0.16;
  s.scale.set(scale, scale, 1);
  const startX = 0.15 + (Math.random() - 0.5) * 0.12;
  s.position.set(startX, 0.85, 0);
  s.userData.life = 0;
  s.userData.startX = startX;
  s.userData.driftX = (Math.random() - 0.5) * 0.25;
  s.userData.wobblePhase = Math.random() * Math.PI * 2;
  c.group.add(s);
  c.zSprites.push(s);
}

/**
 * Compute the target sleepiness (0..1) for a creature given the current
 * night factor. Sleepy creatures yawn earlier; bold ones tough it out until
 * it's properly dark. Walkers apply a smoothstep on/off so the body curl
 * animates rather than snapping; fliers skip the smoothstep (they only get
 * drowsy + descend toward rest). The alert window after being woken forces
 * the target to 0 so a freshly-woken creature doesn't immediately re-curl.
 * Shared by {@link updateSleepiness} for both walker and flier curves
 * (QA-010: dedupes the previously copy-pasted walker/flier sleepiness curves).
 * @param {object} c - creature state.
 * @param {number} nf - current night factor (0..1, from state.nightFactor).
 * @param {boolean} smoothstep - apply smoothstep easing (walkers) vs linear (fliers).
 * @returns {number} target sleepiness in 0..1.
 */
function sleepinessTarget(c, nf, smoothstep) {
  const a = c.nightThresh - 0.08;
  const b = c.nightThresh + 0.08;
  let target = (nf - a) / Math.max(0.001, b - a);
  if (target < 0) target = 0;
  else if (target > 1) target = 1;
  else if (smoothstep) target = target * target * (3 - 2 * target);
  // Alert window after being woken — keep them out of sleep even at night.
  if (c.alertUntil && c.age < c.alertUntil) target = 0;
  return target;
}

/**
 * Ease a creature's `c.sleepiness` toward the current night-driven target at
 * ~0.6/s so dawn/dusk transitions are smooth. Walkers smoothstep; fliers
 * (except fish) don't; sleepers (already asleep) and fish are untouched.
 * Extracted from stepCreature's per-frame head — call once per creature per frame.
 * @param {object} c - creature state; mutates `c.sleepiness` in place.
 * @param {number} dt - frame delta time in seconds.
 * @param {number} nightFactor - global night factor, 0 (day)..1 (full night).
 */
export function updateSleepiness(c, dt, nightFactor) {
  if (!c.isSleeper && !c.flies) {
    const target = sleepinessTarget(c, nightFactor, true);
    c.sleepiness += (target - c.sleepiness) * Math.min(1, dt * 0.6);
  } else if (c.flies && !c.isFish) {
    const target = sleepinessTarget(c, nightFactor, false);
    c.sleepiness += (target - c.sleepiness) * Math.min(1, dt * 0.6);
  }
}

/**
 * Advance the rising-"z" sprite stream for a sleeping creature. Spawns new
 * z's while actively sleeping (either a spawned-asleep `c.isSleeper` or a
 * walker curled up at night via `c.sleepiness`); existing particles always
 * tick so they finish their fade-out after the creature wakes. Extracted
 * from stepCreature's per-frame head — call once per creature per frame.
 * @param {object} c - creature state; reads/pushes/splices `c.zSprites`.
 * @param {number} dt - frame delta time in seconds.
 */
export function stepZParticles(c, dt) {
  const sleepStrength = c.isSleeper ? 1 : c.sleepiness;
  if (!c.flies && sleepStrength > 0.6) {
    c.zSpawnTimer -= dt;
    if (c.zSpawnTimer <= 0) {
      spawnZ(c);
      c.zSpawnTimer = Z_SPAWN_INTERVAL * (0.7 + Math.random() * 0.6);
    }
  }
  if (c.zSprites.length > 0) {
    for (let i = c.zSprites.length - 1; i >= 0; i--) {
      const s = c.zSprites[i];
      s.userData.life += dt;
      const u = s.userData.life / Z_LIFE;
      if (u >= 1) {
        c.group.remove(s);
        s.material.dispose();
        c.zSprites.splice(i, 1);
        continue;
      }
      const fadeIn = Math.min(1, u / 0.18);
      const fadeOut = u > 0.55 ? 1 - (u - 0.55) / 0.45 : 1;
      s.material.opacity = 0.7125 * fadeIn * fadeOut;
      s.position.y = 0.85 + u * Z_RISE;
      s.position.x =
        s.userData.startX +
        s.userData.driftX * s.userData.life +
        Math.sin(s.userData.wobblePhase + u * Math.PI * 2) * 0.06;
    }
  }
}

/**
 * Rotate a walker/sleeper group to lie flat on the terrain underfoot. Samples
 * the slope along the creature's heading + perpendicular and writes pitch/roll
 * into `rotation.x`/`.z` (relies on the group's YXZ Euler order — see
 * `makeCreature` — so these resolve in the body frame after yaw). Shared by
 * both {@link stepSleeper} and {@link stepNightSleep}'s fully-curled branch
 * (QA-010: dedupes the sleeper + night-sleep slope-pose blocks).
 * @param {object} c - creature state.
 * @param {(x: number, z: number) => number} heightFn - world-space terrain height sampler.
 */
function plantOnSlope(c, heightFn) {
  const p = c.group.position;
  const ds = 0.25 * c.scale;
  const slopes = sampleSlopes(p.x, p.z, c.heading, ds, heightFn);
  c.group.rotation.y = -c.heading + Math.PI / 2;
  c.group.rotation.x = slopes.pitchTarget;
  c.group.rotation.z = slopes.rollTarget;
}

/**
 * ── sleeper mode ──────────────────────────────────────────────────────────
 * Run the full per-frame pose for a creature spawned asleep (`c.isSleeper`).
 * Curled, eyes closed, no motion — owns its whole frame (slow breath + slope
 * pose) and the caller (stepCreature's dispatcher) always early-exits after
 * calling this; no further motion/animation runs that frame.
 * Extracted from stepCreature (QA-001).
 * @param {object} c - creature state (walker only; must not be a flier).
 * @param {number} dt - frame delta time in seconds (unused directly here but
 *   kept for signature symmetry with the other dispatch targets).
 * @param {number} t - simulation time in seconds (frozen while paused).
 * @param {(x: number, z: number) => number} heightFn - world-space terrain height sampler.
 */
export function stepSleeper(c, dt, t, heightFn) {
  // slow "breathing" — body bob on y axis, very small amplitude
  const breath = Math.sin(t * 1.1 + c.flapPhase) * 0.03;
  c.body.scale.y = c.bodyBaseY * 0.55 + breath;
  c.body.scale.x = c.bodyBaseX * (1.18 - breath * 0.3);
  // legs/feet tucked under the body (set in makeCreature) — keep them
  // there in case anything else perturbed them
  for (let i = 0; i < c.legs.length; i++) {
    c.legs[i].scale.y = 0.02;
    c.feet[i].position.y = -0.15;
  }
  // belly hidden — sphere would poke out below the squashed body
  if (c.belly) c.belly.scale.set(0, 0, 0);
  // antennae retracted so they don't float disconnected above the body
  if (c.antennae) for (const a of c.antennae) a.scale.setScalar(0);
  // Fur shells are children of the body and inherit its squash — they stay
  // visible while sleeping (a curled fuzzy creature should still read as
  // fuzzy, just compressed).
  // keep planted at ground height
  const ground = heightFn(c.group.position.x, c.group.position.z);
  c.group.position.y = ground + 0.28 * c.scale;
  // Rotate to match terrain slope so sleepers lie flat on hillsides.
  plantOnSlope(c, heightFn);
}

/**
 * ── night-sleep mode (walkers only) ───────────────────────────────────────
 * High `c.sleepiness` curls a walker down on the spot, easing eyes/body/legs/
 * belly/antennae toward the curled pose as `s` rises past 0 up to the s=0.6
 * full-curl threshold. Extracted from stepCreature (QA-001).
 * @param {object} c - creature state (walker only).
 * @param {number} dt - frame delta time in seconds (unused before full curl;
 *   kept for signature symmetry).
 * @param {number} t - simulation time in seconds (frozen while paused).
 * @param {(x: number, z: number) => number} heightFn - world-space terrain height sampler.
 * @returns {boolean} true once fully curled (`c.sleepiness > 0.6`) — that
 *   state owns the slope pose, and the caller (stepCreature's dispatcher)
 *   must skip the trailing motion/animation for the frame.
 */
export function stepNightSleep(c, dt, t, heightFn) {
  const s = c.sleepiness;
  // Curl reaches full posture at s=0.6 (the same threshold the zZz sprite
  // fades in on) so motion stops the moment the creature reads as sleeping.
  const curl = Math.min(1, s / 0.6);
  const eyeOpen = Math.max(0, 1 - curl * 1.2);
  for (const e of c.eyeParts) e.scale.setScalar(eyeOpen);
  c.body.scale.y = c.bodyBaseY * (1 + (0.55 - 1) * curl);
  c.body.scale.x = c.bodyBaseX * (1 + (1.18 - 1) * curl);
  // Legs and feet retract as the creature curls
  for (let i = 0; i < c.legs.length; i++) {
    c.legs[i].scale.y = 0.22 + (0.02 - 0.22) * curl;
    c.feet[i].position.y = -0.32 + (-0.15 - -0.32) * curl;
  }
  // Belly shrinks toward zero as the body squashes flat over it
  if (c.belly) {
    const bs = c.belly.userData.baseScale;
    const open = 1 - curl;
    c.belly.scale.set(bs.x * open, bs.y * open, bs.z * open);
  }
  // Antennae fold down toward the body
  if (c.antennae) for (const a of c.antennae) a.scale.setScalar(1 - curl);
  if (s > 0.6) {
    // fully curled — slow breath, no motion, planted on the ground
    const breath = Math.sin(t * 1.1 + c.flapPhase) * 0.03;
    c.body.scale.y = c.bodyBaseY * 0.55 + breath;
    c.body.scale.x = c.bodyBaseX * (1.18 - breath * 0.3);
    const ground = heightFn(c.group.position.x, c.group.position.z);
    c.group.position.y = ground + 0.28 * c.scale + c.hopOffset;
    // Rotate to match terrain slope so night-sleepers lie flat on hillsides.
    plantOnSlope(c, heightFn);
    return true;
  }
  return false;
}
