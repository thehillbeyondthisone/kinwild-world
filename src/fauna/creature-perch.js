import { state } from "../state.js";
import { WATER_AVOID_Y } from "./shared.js";
import { makeDustKick, emitGroundMark } from "../environment.js";

/**
 * Highest terrain-ground Y a fish of the given scale may swim over. The water
 * plane is around y=-0.12 and can wave downward, so this keeps the fish
 * body's top below the lowest visible surface and requires terrain
 * clearance below.
 * @param {number} scale - creature's overall scale multiplier.
 * @returns {number} maximum ground height (world-space Y) for the fish to stay submerged.
 */
export function fishMaxGroundY(scale) {
  return WATER_AVOID_Y - 0.24 - 0.66 * scale;
}

// Frame-level cache for currentPerchPoint(). All calls within the same
// animate() frame for the same perch object return the same pre-computed
// point, avoiding redundant sin/cos work when multiple code paths query
// the same perch.
let _perchCacheT = -Infinity;
let _perchCachePerch = null;
let _perchCacheResult = null;

/**
 * Resolve a perch spot's current wind-swayed world position, or the perch
 * itself unchanged if it has no `perchWind` data. Mirrors the non-instanced
 * path of `applyWindSway`'s vertex shader so the visual sway a flier lands on
 * matches the flora's actual rendered sway. Results are memoized for the
 * current animation frame (same `perch` + same `state.windUniforms.uTime`
 * value) so repeated calls within one frame skip redundant trig.
 * @param {object} perch - a `state.perchSpots` entry (or any `{x,y,z}`-shaped point).
 * @returns {{x: number, y: number, z: number}} the perch's current world position.
 */
export function currentPerchPoint(perch) {
  if (!perch?.perchWind) return perch;
  const t = state.windUniforms.uTime.value;
  if (perch === _perchCachePerch && t === _perchCacheT) return _perchCacheResult;
  const wind = perch.perchWind;
  const foliageWind = state.windUniforms.uFoliageWind.value;
  const windY = Math.max(wind.localY ?? 0, 0);
  const windAmp = windY * windY * (wind.strength ?? 1) * foliageWind;
  const baseX = wind.baseX ?? perch.x;
  const baseZ = wind.baseZ ?? perch.z;
  // Mirror applyWindSway's non-instanced shader path: it samples
  // modelMatrix * vec4(transformed, 1.0), offsets local X/Z, then lets the
  // flora group's rotation/scale carry that offset into world space.
  const localX = Math.sin(t * 1.4 + baseX * 0.30 + baseZ * 0.40) * windAmp * 0.06;
  const localZ = Math.sin(t * 0.9 + baseX * 0.15 - baseZ * 0.25) * windAmp * 0.05;
  const rot = wind.rotationY ?? 0;
  const scale = wind.scale ?? 1;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const result = {
    x: perch.x + (c * localX + s * localZ) * scale,
    y: perch.y,
    z: perch.z + (-s * localX + c * localZ) * scale,
  };
  _perchCacheT = t;
  _perchCachePerch = perch;
  _perchCacheResult = result;
  return result;
}

/**
 * Release the flier's claim on its current perch, if any, so another flier
 * can claim it. No-op if `c` has no `perchTarget` or is no longer that
 * perch's occupant (e.g. it was already evicted or reassigned).
 * @param {object} c - creature state.
 */
export function releasePerchForFlier(c) {
  if (!c?.perchTarget) return;
  const perch = c.perchTarget;
  if (perch.occupant === c) perch.occupant = null;
}

/**
 * Claim a perch spot for a flier, releasing any previously held perch first.
 * Fails if the perch is already occupied by a different, still-live creature
 * (`occupant.group?.parent` truthy) — a creature whose group has been
 * disposed no longer blocks the claim.
 * @param {object} c - creature state.
 * @param {object|null} perch - a `state.perchSpots` entry to claim.
 * @returns {boolean} true if the perch was claimed (or `perch` was falsy → false).
 */
export function claimPerchForFlier(c, perch) {
  if (!perch) return false;
  if (c.perchTarget && c.perchTarget !== perch) releasePerchForFlier(c);
  if (perch.occupant && perch.occupant !== c && perch.occupant.group?.parent) return false;
  perch.occupant = c;
  c.perchTarget = perch;
  return true;
}

/**
 * Pick and claim a perch target when a flier transitions flying→descending.
 * No-op for fish/bumblebees. Gated by a 55% per-call roll so most descents
 * still land normally on the ground instead of homing to a perch.
 * `flyer_nest` perches are searched with no distance cap and preferred over
 * any other perch kind (mushroom caps, etc.), which are only considered
 * within a 6-unit radius (squared distance < 36). Sets `c.perchTarget` via
 * {@link claimPerchForFlier} on success; leaves it unset otherwise.
 * @param {object} c - creature state.
 */
export function pickPerchForFlier(c) {
  if (c.isFish || c.isBee) return;
  const perches = state.perchSpots;
  if (!perches || perches.length === 0) return;
  if (Math.random() >= 0.55) return;
  const pos = c.group.position;
  let nearestNest = null;
  let nearestNestD2 = Infinity;
  let nearestOther = null;
  let nearestOtherD2 = 36; // non-nest perches stay local
  for (let i = 0; i < perches.length; i++) {
    const p = perches[i];
    if (p.occupant && p.occupant !== c && p.occupant.group?.parent) continue;
    const perchPoint = currentPerchPoint(p);
    const dx = perchPoint.x - pos.x;
    const dz = perchPoint.z - pos.z;
    const d2 = dx * dx + dz * dz;
    if (p.perchKind === "flyer_nest") {
      if (d2 < nearestNestD2) {
        nearestNestD2 = d2;
        nearestNest = p;
      }
    } else if (d2 < nearestOtherD2) {
      nearestOtherD2 = d2;
      nearestOther = p;
    }
  }
  const nearest = nearestNest ?? nearestOther;
  if (nearest) claimPerchForFlier(c, nearest);
}

/**
 * Convert a mesh-local foot/paw offset (from a creature's facing-relative
 * body frame) into a world-space XZ point, using the creature's current
 * heading and scale. Used for footstep/landing ground-mark placement.
 * @param {object} c - creature state.
 * @param {number} localX - local-space X offset (pre-scale), body-relative.
 * @param {number} localZ - local-space Z offset (pre-scale), body-relative.
 * @returns {{x: number, z: number}} world-space XZ position.
 */
export function localFootToWorld(c, localX, localZ) {
  const rot = -c.heading + Math.PI / 2;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const lx = localX * c.scale;
  const lz = localZ * c.scale;
  return {
    x: c.group.position.x + cr * lx + sr * lz,
    z: c.group.position.z - sr * lx + cr * lz,
  };
}

function emitFlierLandingMarks(c, heightFn) {
  const marks = state.groundMarks;
  const cfg = state.currentBiome?.groundMarks;
  if (!marks || !cfg || !c.flies || c.isFish || c.perchTarget) return;
  const y = heightFn(c.group.position.x, c.group.position.z);
  if (state.waterMesh && y < WATER_AVOID_Y) return;
  const offsets = [
    [-0.16, 0.10],
    [0.16, 0.10],
    [-0.12, -0.12],
    [0.12, -0.12],
  ];
  for (const [lx, lz] of offsets) {
    const p = localFootToWorld(c, lx, lz);
    emitGroundMark(marks, {
      x: p.x,
      z: p.z,
      heading: c.heading + (lx < 0 ? -0.12 : 0.12),
      width: Math.max(0.045, 0.075 * c.scale),
      length: Math.max(0.075, 0.14 * c.scale),
      opacity: cfg.opacity * 0.9,
      life: cfg.life,
    });
  }
  if (cfg.poof === "sand") {
    const kick = makeDustKick(c.group.position.x, y, c.group.position.z, cfg.color, {
      count: 3,
      size: 0.045,
      opacity: 0.35,
      velocityScale: 0.45,
      life: 0.32,
      poof: true,
    });
    state.world.add(kick);
    state.dustKicks.push(kick);
  }
  if (cfg.poof === "snow") {
    const kick = makeDustKick(c.group.position.x, y, c.group.position.z, "#c8d4e0", {
      count: 4,
      size: 0.055,
      opacity: 0.40,
      velocityScale: 0.30,
      life: 0.38,
      poof: true,
    });
    state.world.add(kick);
    state.dustKicks.push(kick);
  }
}

/**
 * ── flier landing FSM ─────────────────────────────────────────────────────
 * Advance the 4-state landing state machine (`flying ↔ descending ↔ landed ↔
 * ascending`, held in `c.landState`) for one frame, plus its water/drowsy/
 * perch safeguards:
 *  - Water: if the ground beneath the flier is below `WATER_AVOID_Y`, the FSM
 *    is forced back to "flying" and any held perch is released, so a flier
 *    never lands on/over water.
 *  - Drowsy: sleepiness > 0.6 forces a descent (skipped while over water so a
 *    sleepy flier doesn't try to ditch mid-lake).
 *  - Perch: while descending with a `c.perchTarget`, holds an approach
 *    altitude until roughly over the perch, then commits to "landed" only
 *    once within `perchRadius` (default 0.4) of the perch's current
 *    (wind-swayed) point.
 * Runs every frame for non-fish fliers (fish always float and never call
 * this); the actual movement + animation is handled by the shared walker/
 * flier path in stepCreature after this returns. Extracted from stepCreature
 * (QA-001).
 * @param {object} c - creature state; mutates `c.landState`, `c.landTimer`,
 *   `c.currentHover`, `c.perchTarget`/`perchOffsetX`/`perchOffsetZ`.
 * @param {number} dt - frame delta time in seconds.
 * @param {(x: number, z: number) => number} heightFn - world-space terrain height sampler.
 */
export function stepFlier(c, dt, heightFn) {
  c.landTimer -= dt;
  const restH = 0.35 * c.scale;

  // No landing on water — if the ground beneath us is below the waterline
  // (or we'd already committed to landing there), bail to "flying" so the
  // perch lookup retries somewhere on dry land next cycle. Also snap
  // currentHover up to the cruise ceiling so we don't visibly hover at
  // restH-altitude over the lake while the per-frame lerp slowly climbs.
  const overWater =
    state.waterMesh && heightFn(c.group.position.x, c.group.position.z) < WATER_AVOID_Y;
  if (overWater && c.landState !== "flying") {
    c.landState = "flying";
    c.landTimer = 4 + Math.random() * 8;
    releasePerchForFlier(c);
    c.perchTarget = null;
    c.perchOffsetX = 0;
    c.perchOffsetZ = 0;
    const ceil = c.hoverHeight * (1 - 0.7 * c.sleepiness);
    if (c.currentHover < ceil) c.currentHover = ceil;
  }

  // Drowsy fliers want down — force a descent if they're still flying,
  // and refuse to lift off until they've slept it off. Skip the forced
  // descent while over water so a sleepy flier doesn't try to ditch
  // mid-lake; it'll keep cruising until it finds land.
  if (!overWater && c.sleepiness > 0.6 && c.landState === "flying") {
    c.landState = "descending";
    c.landTimer = 8 + Math.random() * 6;
    pickPerchForFlier(c);
  }
  if (!overWater && c.sleepiness > 0.6 && c.landState === "ascending") {
    c.landState = "descending";
  }

  if (!overWater && c.landState === "flying" && c.landTimer <= 0) {
    c.landState = "descending";
    pickPerchForFlier(c);
  } else if (c.landState === "landed" && c.landTimer <= 0 && c.sleepiness < 0.5) {
    c.landState = "ascending";
  }

  // pull the hover ceiling down with sleepiness so a flier slowly sinks
  // toward the ground at night even before reaching the landed state.
  const hoverCeil = c.hoverHeight * (1 - 0.7 * c.sleepiness);
  let targetH =
    c.landState === "flying" || c.landState === "ascending"
      ? hoverCeil
      : restH;
  // While descending toward a distant perch, hold an approach altitude
  // so the flier has time to fly over to the mushroom before it bottoms
  // out. Once roughly over the cap, the normal restH target kicks in
  // and the actual touchdown onto the cap happens.
  if (c.perchTarget && c.landState === "descending") {
    const perchPoint = currentPerchPoint(c.perchTarget);
    const dxp = perchPoint.x - c.group.position.x;
    const dzp = perchPoint.z - c.group.position.z;
    if (dxp * dxp + dzp * dzp > 1.0) {
      targetH = Math.max(restH, Math.min(hoverCeil, 0.6 * c.hoverHeight));
    }
  }
  // smooth lerp for the descent/ascent
  c.currentHover += (targetH - c.currentHover) * Math.min(1, dt * 1.4);

  if (c.landState === "descending" && c.currentHover - restH < 0.08) {
    // Only commit to "landed" once we're at the perch (or there's no
    // perch). Otherwise the flier would freeze in mid-air partway across.
    let canLand = true;
    if (c.perchTarget) {
      const perchPoint = currentPerchPoint(c.perchTarget);
      const dxp = perchPoint.x - c.group.position.x;
      const dzp = perchPoint.z - c.group.position.z;
      const perchRadius = c.perchTarget.perchRadius ?? 0.4;
      canLand = dxp * dxp + dzp * dzp < perchRadius * perchRadius;
      if (canLand) {
        c.perchOffsetX = c.group.position.x - perchPoint.x;
        c.perchOffsetZ = c.group.position.z - perchPoint.z;
      }
    }
    if (canLand) {
      c.landState = "landed";
      c.landTimer = 4 + Math.random() * 10;
      emitFlierLandingMarks(c, heightFn);
    }
  } else if (
    c.landState === "ascending" &&
    c.hoverHeight - c.currentHover < 0.15
  ) {
    c.landState = "flying";
    c.landTimer = 8 + Math.random() * 16;
    // Keep perchTarget after takeoff — the floor blend uses it to ease
    // back toward ground as the flier drifts away in XZ. Cleared lazily
    // below once the blend has fully unwound, so the pos.y handoff from
    // perch-relative to ground-relative is seamless.
  }

  // Lazy cleanup — once the floor blend has decayed essentially to zero
  // (the flier is well clear of the perch), drop the reference so the
  // next descent is free to pick a fresh perch.
  if (
    c.perchTarget &&
    c.landState === "flying" &&
    c.perchFloorWeight < 0.02
  ) {
    releasePerchForFlier(c);
    c.perchTarget = null;
    c.perchFloorWeight = 0;
    c.perchOffsetX = 0;
    c.perchOffsetZ = 0;
  }
}
