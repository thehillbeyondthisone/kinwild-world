import * as THREE from "three";
import { state } from "../state.js";
import { BLOOM_LAYER } from "../postfx.js";
import { nearestCenter } from "../terrain.js";

/**
 * Terrain Y below which ground creatures are considered underwater. The water
 * plane sits a touch below 0 and oscillates ~±0.08; clamping walkers to
 * ground above 0 keeps them clear of waves and out of the shallow draft.
 */
export const WATER_AVOID_Y = 0.0;

// ── Terrain helpers ──────────────────────────────────────────────────────
// Shared terrain sampling utilities used by walkers, crawlers, and burrowers.

/**
 * Sample terrain normal at (x, z) via central finite differences.
 * Returns a unit Vector3 — a shared module-scope scratch, overwritten on the
 * next call. Consume (or copy) it before calling again.
 *
 * @param {number} x - world-space X.
 * @param {number} z - world-space Z.
 * @param {(x: number, z: number) => number} heightFn - terrain height sampler.
 * @param {number} [eps=0.1] - finite-difference sample offset.
 * @returns {THREE.Vector3} shared scratch normal — copy before the next call.
 */
const _terrainNormal = new THREE.Vector3();
export function sampleTerrainNormal(x, z, heightFn, eps = 0.1) {
  const yl = heightFn(x - eps, z);
  const yr = heightFn(x + eps, z);
  const yf = heightFn(x, z - eps);
  const yb = heightFn(x, z + eps);
  return _terrainNormal.set(yl - yr, 2 * eps, yf - yb).normalize();
}

const SLOPE_LIMIT = 2;
const clampSlope = (v) => Math.max(-SLOPE_LIMIT, Math.min(SLOPE_LIMIT, v));

/**
 * Convert cached world-space terrain gradients into heading-local pitch/roll.
 * Returns a shared module-scope scratch object, overwritten on the next call
 * (including via sampleSlopes) — consume the fields before calling again.
 *
 * @param {number} gradientX - world-space terrain height gradient along X.
 * @param {number} gradientZ - world-space terrain height gradient along Z.
 * @param {number} heading - facing angle in radians.
 * @returns {{pitchTarget: number, rollTarget: number, slopeFwd: number, slopeRight: number}}
 *   shared scratch object — consume before calling again.
 */
const _slopeTargets = { pitchTarget: 0, rollTarget: 0, slopeFwd: 0, slopeRight: 0 };
export function slopeTargetsFromGradient(gradientX, gradientZ, heading) {
  const ch = Math.cos(heading);
  const sh = Math.sin(heading);
  const slopeFwd = ch * gradientX + sh * gradientZ;
  const slopeRight = sh * gradientX - ch * gradientZ;
  _slopeTargets.pitchTarget = -Math.atan(clampSlope(slopeFwd));
  _slopeTargets.rollTarget = Math.atan(clampSlope(slopeRight));
  _slopeTargets.slopeFwd = slopeFwd;
  _slopeTargets.slopeRight = slopeRight;
  return _slopeTargets;
}

/**
 * Sample terrain slope along heading and perpendicular to it.
 * Returns { pitchTarget, rollTarget, slopeFwd, slopeRight } for use
 * with group.rotation.x (pitch) and group.rotation.z (roll).
 * World-space gradients are included for callers that cache slopes across
 * heading changes.
 *
 * @param {number} x - world-space X.
 * @param {number} z - world-space Z.
 * @param {number} heading - facing angle in radians.
 * @param {number} ds - forward/perpendicular sample offset.
 * @param {(x: number, z: number) => number} heightFn - terrain height sampler.
 * @returns {{pitchTarget: number, rollTarget: number, slopeFwd: number, slopeRight: number, gradientX: number, gradientZ: number}}
 *   shared module-scope scratch — overwritten on the next call (including via
 *   slopeTargetsFromGradient); consume or copy the fields before re-calling.
 */
const _slopeSample = {
  pitchTarget: 0, rollTarget: 0, slopeFwd: 0, slopeRight: 0, gradientX: 0, gradientZ: 0,
};
export function sampleSlopes(x, z, heading, ds, heightFn) {
  const ch = Math.cos(heading);
  const sh = Math.sin(heading);
  const yF = heightFn(x + ch * ds, z + sh * ds);
  const yB = heightFn(x - ch * ds, z - sh * ds);
  const yR = heightFn(x + sh * ds, z - ch * ds);
  const yL = heightFn(x - sh * ds, z + ch * ds);
  const slopeFwd = (yF - yB) / (2 * ds);
  const slopeRight = (yR - yL) / (2 * ds);
  const gradientX = ch * slopeFwd + sh * slopeRight;
  const gradientZ = sh * slopeFwd - ch * slopeRight;
  // Shared module-scope scratch — overwritten on the next call; consume the
  // fields (or copy them, like the walker slope cache does) before re-calling.
  const targets = slopeTargetsFromGradient(gradientX, gradientZ, heading);
  _slopeSample.pitchTarget = targets.pitchTarget;
  _slopeSample.rollTarget = targets.rollTarget;
  _slopeSample.slopeFwd = targets.slopeFwd;
  _slopeSample.slopeRight = targets.slopeRight;
  _slopeSample.gradientX = gradientX;
  _slopeSample.gradientZ = gradientZ;
  return _slopeSample;
}

/**
 * Create a pair of antennae (stalk + emissive tip) parented to `parent`.
 * Used by both blob creatures and caterpillars. Returns the stalk meshes
 * (for sleep/wake scale animation in blob creatures).
 *
 * @param {THREE.Object3D} parent - mesh/group the antennae are added to as children.
 * @param {Object} biome - biome config; `biome.accent` colors the emissive tip.
 * @param {THREE.Color} bodyColor - base color the stalk is darkened from.
 * @param {Object} [opts] - stalk/tip dimension and appearance overrides (radius,
 *   height, offsets, tilt angles, tip color darken amount, emissive strength,
 *   and whether the tip glows at all).
 * @returns {THREE.Mesh[]} the two stalk meshes (one per side), each with the
 *   glow tip attached as a child.
 */
export function addAntennae(parent, biome, bodyColor, opts = {}) {
  const {
    stalkRadius = 0.012,
    stalkHeight = 0.32,
    offsetX = 0.1,
    baseY = 0.36,
    baseZ = 0.1,
    tiltAngle = 0.25,
    forwardTiltAngle = 0,
    tipRadius = 0.04,
    colorDarken = 0.2,
    emissiveStrength = 0.35,
    tipGlow = true,
  } = opts;
  const antMat = new THREE.MeshStandardMaterial({
    color: bodyColor.clone().offsetHSL(0, 0, -colorDarken),
  });
  const stalks = [];
  for (const sign of [-1, 1]) {
    const stalk = new THREE.Mesh(
      new THREE.CylinderGeometry(stalkRadius, stalkRadius, stalkHeight, 4),
      antMat
    );
    stalk.position.set(sign * offsetX, baseY, baseZ);
    stalk.rotation.x = forwardTiltAngle;
    stalk.rotation.z = sign * -tiltAngle;
    parent.add(stalk);
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(tipRadius, 6, 6),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(biome.accent),
        emissive: tipGlow
          ? new THREE.Color(biome.accent).multiplyScalar(emissiveStrength)
          : new THREE.Color(0x000000),
      })
    );
    if (tipGlow) tip.layers.enable(BLOOM_LAYER);
    tip.position.set(0, stalkHeight / 2, 0);
    stalk.add(tip);
    stalks.push(stalk);
  }
  return stalks;
}

// ── Spatial grid for static obstacle queries ──────────────────────────────
// Built once per world-gen via buildObstacleGrid(). avoidObstacles() queries
// the grid instead of scanning the full obstacle list, reducing the inner
// loop from O(all obstacles) to O(nearby obstacles).
const GRID_CELL = 2.0;
let _grid = null;       // Map<string, number[]>  — cell key → obstacle indices
let _gridObs = null;    // reference to the obstacles array the grid was built from

function cellKey(cx, cz) { return cx + ',' + cz; }

/**
 * Build (or rebuild) the module-scope spatial hash of static obstacles used by
 * `avoidObstacles` and `pushOutOfObstacles`. Must be called once per world-gen
 * (typically from `finalizeWorldHud`) after `state.obstacles` is finalized —
 * a stale grid (one built from a different array reference) is detected and
 * ignored via the `_gridObs !== state.obstacles` check in the query helper.
 *
 * @param {Array<{x: number, z: number, r?: number}>} obstacles - `state.obstacles`.
 */
export function buildObstacleGrid(obstacles) {
  _gridObs = obstacles;
  _grid = new Map();
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    const r = o.r || 0.5;
    const minCX = Math.floor((o.x - r) / GRID_CELL);
    const maxCX = Math.floor((o.x + r) / GRID_CELL);
    const minCZ = Math.floor((o.z - r) / GRID_CELL);
    const maxCZ = Math.floor((o.z + r) / GRID_CELL);
    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cz = minCZ; cz <= maxCZ; cz++) {
        const k = cellKey(cx, cz);
        let bucket = _grid.get(k);
        if (!bucket) { bucket = []; _grid.set(k, bucket); }
        bucket.push(i);
      }
    }
  }
}

// Return obstacle indices whose bounding cell overlaps the query disc.
// Results are written into the caller-supplied `out` array (cleared first) so
// the hot path allocates nothing. Callers own a dedicated module-scope scratch
// array each — avoidObstacles' outer candidate list must survive the nested
// wedge-check query, so the two must not share one array. The dedup Set is
// shared: it's only live during a single fill, which never nests.
const _nearbySeen = new Set();
function nearbyObstacleIndices(x, z, radius, out) {
  if (!_grid || _gridObs !== state.obstacles) return null; // fallback — no grid built, or grid is stale
  const minCX = Math.floor((x - radius) / GRID_CELL);
  const maxCX = Math.floor((x + radius) / GRID_CELL);
  const minCZ = Math.floor((z - radius) / GRID_CELL);
  const maxCZ = Math.floor((z + radius) / GRID_CELL);
  out.length = 0;
  _nearbySeen.clear();
  for (let cx = minCX; cx <= maxCX; cx++) {
    for (let cz = minCZ; cz <= maxCZ; cz++) {
      const bucket = _grid.get(cellKey(cx, cz));
      if (!bucket) continue;
      for (let j = 0; j < bucket.length; j++) {
        const idx = bucket[j];
        if (_nearbySeen.has(idx)) continue;
        _nearbySeen.add(idx);
        out.push(idx);
      }
    }
  }
  return out;
}
const _candidateScratch = [];
const _wedgeScratch = [];
const _pushScratch = [];

/**
 * Color similarity test for the herding check. Cheap RGB distance — fine for
 * the small biome palettes used here.
 *
 * @param {{r: number, g: number, b: number}} a
 * @param {{r: number, g: number, b: number}} b
 * @returns {boolean} true when squared RGB distance is below the fixed threshold.
 */
export function colorsClose(a, b) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db < 0.04;
}

const STATIC_AVOID_LOOKAHEAD = 1.25;
const STATIC_AVOID_MAX_TURN = 0.22;

/**
 * Vertical margin above an obstacle's canopy top within which a flier is
 * still considered "passing over" rather than colliding with it. Shared by
 * every obstacle height-filter check below (static + dynamic phases of
 * avoidObstacles, and pushOutOfObstacles).
 */
export const CANOPY_PASS_MARGIN = 0.15;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smoothstep01 = (v) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};
/**
 * Wrap an angle (or angle difference) to [-π, π) for shortest-arc turns.
 *
 * @param {number} a - angle or angle difference in radians.
 * @returns {number} equivalent angle wrapped to [-π, π).
 */
export const wrapAngle = (a) =>
  ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;

/**
 * Combined obstacle avoidance for grounded movers (walkers + caterpillars).
 *
 * Static phase (state.obstacles — trunks, mushrooms): a smooth approach
 * buffer starts bending heading before contact. If the candidate step still
 * penetrates an obstacle, tangent-slide projects motion onto the perimeter
 * tangent that best matches the current heading. If the slid candidate is
 * itself wedged into another obstacle, the mover stays put with a heading
 * pointing outward. Result of this phase becomes the "current candidate"
 * position fed to the dynamic phase.
 *
 * Dynamic phase (state.dynamicObstacles — other movers): soft separation.
 * Any overlap with another mover applies a small radial push to the
 * candidate position, keeping heading intact. This reads as a gentle nudge
 * — far less twitchy than a hard tangent snap, which is important for the
 * project vibe (cute, easeful motion). selfOwner is matched against each
 * dyn entry's `owner` so a caterpillar's segments don't collide with each
 * other and a walker doesn't push itself.
 *
 * @param {number} px - current position X (world/mesh-local, matching heightFn's frame).
 * @param {number} pz - current position Z.
 * @param {number} nx - candidate next-step position X.
 * @param {number} nz - candidate next-step position Z.
 * @param {number} heading - current facing angle in radians.
 * @param {number} step - step length used to re-derive a slid candidate position.
 * @param {number} cr - mover's collision radius.
 * @param {number} [y] - mover's world-space Y; when set, obstacles whose canopy
 *   top (`o.top`) is more than CANOPY_PASS_MARGIN below `y` are skipped, letting
 *   fliers above the canopy pass over freely.
 * @param {number} [skipX] - X of one specific obstacle to ignore (e.g. the perch
 *   a flier is landing on), paired with `skipZ`.
 * @param {number} [skipZ] - Z of the obstacle to ignore, paired with `skipX`.
 * @param {*} [selfOwner] - matched against each dynamic-obstacle entry's `owner`
 *   so a caterpillar's own segments (or a walker itself) aren't avoided.
 * @param {{staticResponse?: "slide"|"turn"}} [opts] - `"slide"` (default) preserves
 *   the walker/flier tangent-slide behavior; `"turn"` only retargets heading and
 *   keeps the current position, for crawlers whose body should follow a
 *   head-led path.
 * @returns {{nx: number, nz: number, heading: number}|null} the corrected
 *   candidate, or null when both phases pass cleanly and the caller should
 *   commit the straight step.
 */
export function avoidObstacles(
  px, pz, nx, nz, heading, step, cr, y, skipX, skipZ, selfOwner, opts
) {
  const staticResponse = opts?.staticResponse ?? "slide";
  let result = null;
  const obs = state.obstacles;
  if (obs && obs.length > 0) {
    const skipping = skipX !== undefined && skipZ !== undefined;
    // Use spatial grid to narrow the candidate set.
    const candidates = nearbyObstacleIndices(nx, nz, cr + 2, _candidateScratch) || obs.map((_, i) => i);
    let proactive = null;
    for (let ci = 0; ci < candidates.length; ci++) {
      const i = candidates[ci];
      const o = obs[i];
      // Skip the specific obstacle we're trying to land on (the perch's
      // mushroom). Without this, a flier descending toward its own perch
      // would get pushed away by the cap's collision disc.
      if (skipping && Math.abs(o.x - skipX) < 0.4 && Math.abs(o.z - skipZ) < 0.4) continue;
      // Height filter — fliers above the canopy can pass over freely.
      if (y !== undefined && o.top !== undefined && y > o.top + CANOPY_PASS_MARGIN) continue;
      const ox = nx - o.x;
      const oz = nz - o.z;
      const minD = o.r + cr;
      const rx = px - o.x;
      const rz = pz - o.z;
      const rlen = Math.sqrt(rx * rx + rz * rz) || 1;
      const nrx = rx / rlen;
      const nrz = rz / rlen;
      let tx = -nrz;
      let tz = nrx;
      if (tx * Math.cos(heading) + tz * Math.sin(heading) < 0) {
        tx = nrz;
        tz = -nrx;
      }
      const tangentHeading = Math.atan2(tz, tx);
      const d2 = ox * ox + oz * oz;
      if (d2 >= minD * minD) {
        const ahead = (o.x - px) * Math.cos(heading) + (o.z - pz) * Math.sin(heading);
        const influenceD = minD + STATIC_AVOID_LOOKAHEAD;
        if (ahead <= 0 || d2 >= influenceD * influenceD) continue;
        const d = Math.sqrt(d2);
        const strength = smoothstep01((influenceD - d) / (influenceD - minD));
        const turn = wrapAngle(tangentHeading - heading);
        const turnLimit = STATIC_AVOID_MAX_TURN * strength;
        const steer = Math.max(-turnLimit, Math.min(turnLimit, turn));
        if (Math.abs(steer) < 0.001) continue;
        const candidate = {
          nx,
          nz,
          heading: heading + steer,
          strength,
        };
        if (!proactive || candidate.strength > proactive.strength) proactive = candidate;
        continue;
      }
      const sx = px + tx * step;
      const sz = pz + tz * step;
      let wedged = false;
      // Use spatial grid for wedge check too.
      const wedgeCandidates = nearbyObstacleIndices(sx, sz, cr + 2, _wedgeScratch) || obs.map((_, j) => j);
      for (let wj = 0; wj < wedgeCandidates.length; wj++) {
        const j = wedgeCandidates[wj];
        if (j === i) continue;
        const o2 = obs[j];
        if (skipping && Math.abs(o2.x - skipX) < 0.4 && Math.abs(o2.z - skipZ) < 0.4) continue;
        if (y !== undefined && o2.top !== undefined && y > o2.top + CANOPY_PASS_MARGIN) continue;
        const dx2 = sx - o2.x;
        const dz2 = sz - o2.z;
        const md = o2.r + cr;
        if (dx2 * dx2 + dz2 * dz2 < md * md) {
          wedged = true;
          break;
        }
      }
      // If the current position is already inside this obstacle's clearance
      // ring, the normal crawler "turn" freeze would trap it forever. Walk it
      // outward until it reaches the ring again.
      const pxInsideClearance = rx * rx + rz * rz < minD * minD;
      result = wedged
        ? { nx: px, nz: pz, heading: Math.atan2(nrz, nrx) + (Math.random() - 0.5) * 0.5 }
        : staticResponse === "turn"
          ? pxInsideClearance
            ? { nx: px + nrx * step, nz: pz + nrz * step, heading: Math.atan2(nrz, nrx) }
            : { nx: px, nz: pz, heading: tangentHeading }
          : { nx: sx, nz: sz, heading: tangentHeading };
      break;
    }
    if (!result && proactive) {
      result = { nx: proactive.nx, nz: proactive.nz, heading: proactive.heading };
    }
  }

  // Dynamic soft separation against other movers. Applies on top of the
  // static result (or the straight candidate when no static collision).
  const dyn = state.dynamicObstacles;
  if (dyn && dyn.length > 0) {
    let cnx = result ? result.nx : nx;
    let cnz = result ? result.nz : nz;
    const curHeading = result ? result.heading : heading;
    let pushed = false;
    // PUSH < 1.0 means each frame only resolves part of the overlap, which
    // smears the correction across a few frames and keeps the motion soft
    // instead of snapping. Multiple overlaps accumulate naturally.
    const PUSH = 0.5;
    for (let i = 0; i < dyn.length; i++) {
      const o = dyn[i];
      if (selfOwner && o.owner === selfOwner) continue;
      if (y !== undefined && o.top !== undefined && y > o.top + CANOPY_PASS_MARGIN) continue;
      const ox = cnx - o.x;
      const oz = cnz - o.z;
      const minD = o.r + cr;
      const d2 = ox * ox + oz * oz;
      if (d2 >= minD * minD) continue;
      const d = Math.sqrt(d2) || 0.001;
      const overlap = minD - d;
      cnx += (ox / d) * overlap * PUSH;
      cnz += (oz / d) * overlap * PUSH;
      pushed = true;
    }
    if (pushed) return { nx: cnx, nz: cnz, heading: curHeading };
  }

  return result;
}

/**
 * Velocity-based obstacle push for fliers that steer via velocity rather
 * than heading (butterflies, bees). Mutates pos + vel in place: nudges the
 * position outside any trunk it has entered, and damps the velocity
 * component pointing into the trunk so it glances off instead of stalling.
 *
 * @param {THREE.Vector3} pos - position (mutated).
 * @param {THREE.Vector3} vel - velocity (mutated).
 * @param {number} bodyR - collision radius used against each obstacle's radius.
 */
export function pushOutOfObstacles(pos, vel, bodyR) {
  const obs = state.obstacles;
  if (!obs || obs.length === 0) return;
  // Resolve the candidate index list once — either the spatial grid's nearby
  // set, or (when no grid is built) every obstacle — then run one shared body
  // over it. Previously the grid and fallback paths duplicated this loop
  // verbatim; index resolution is now the only thing that differs.
  const candidates = nearbyObstacleIndices(pos.x, pos.z, bodyR + 2, _pushScratch);
  const count = candidates ? candidates.length : obs.length;
  for (let ci = 0; ci < count; ci++) {
    const o = candidates ? obs[candidates[ci]] : obs[ci];
    if (o.top !== undefined && pos.y > o.top + CANOPY_PASS_MARGIN) continue;
    const dx = pos.x - o.x;
    const dz = pos.z - o.z;
    const minD = o.r + bodyR;
    const d2 = dx * dx + dz * dz;
    if (d2 >= minD * minD) continue;
    const d = Math.sqrt(d2) || 0.001;
    const nx = dx / d;
    const nz = dz / d;
    pos.x = o.x + nx * minD;
    pos.z = o.z + nz * minD;
    const vn = vel.x * nx + vel.z * nz;
    if (vn < 0) {
      vel.x -= vn * nx * 1.6;
      vel.z -= vn * nz * 1.6;
    }
  }
}

// ── Water floor and steering for flying insects ────────────────────────────
// Butterflies and bees both need: (1) a minimum altitude above ground/water,
// and (2) a drift-correcting steer back toward the nearest island center
// when flying over open water. Centralized here to avoid duplicating the
// same logic in both step functions.

/**
 * Enforce a minimum Y floor for a flying insect and steer toward the
 * nearest island center if over open water. Mutates `pos` and `vel` in place.
 *
 * @param {THREE.Vector3} pos - position (mutated).
 * @param {THREE.Vector3} vel - velocity (mutated).
 * @param {number} ground - heightFn(pos.x, pos.z).
 * @param {Object} [opts]
 * @param {number} [opts.minLandY=0.12] - Y offset above terrain when over land.
 * @param {number} [opts.minWaterY=0.45] - Y offset above terrain when over water.
 * @param {number} [opts.steerStrength=3.2] - acceleration toward island center.
 * @param {number} [opts.bounceVy=0.2] - upward velocity applied when hitting the floor.
 * @param {number} dt - elapsed time in seconds.
 */
export function applyWaterFloorAndSteer(pos, vel, ground, opts, dt) {
  const {
    minLandY = 0.12,
    minWaterY = 0.45,
    steerStrength = 3.2,
    bounceVy = 0.2,
  } = opts;
  const overWater = state.waterMesh && ground < WATER_AVOID_Y;
  const minY = overWater ? minWaterY : ground + minLandY;
  if (pos.y < minY) {
    pos.y = minY;
    if (vel.y < 0) vel.y = bounceVy;
  }
  if (overWater) {
    const near = nearestCenter(pos.x, pos.z);
    const dx = near.cx - pos.x;
    const dz = near.cz - pos.z;
    const d = Math.sqrt(dx * dx + dz * dz) || 1;
    vel.x += (dx / d) * steerStrength * dt;
    vel.z += (dz / d) * steerStrength * dt;
  }
}

// ── Velocity-steered flier boilerplate ────────────────────────────────────
// Butterflies, bees, and birds all steer via an explicit velocity vector
// (unlike walkers/caterpillars/the creature.js flier FSM, which steer via
// heading) and share the same per-frame integrate/damp/cap/orient shape.
// Tuning constants (damp base, speed caps, orientation thresholds) stay at
// each call site — only the repeated math is centralized here.

/**
 * Advance `pos` by `vel * dt`. Mutates pos in place.
 *
 * @param {THREE.Vector3} pos - position (mutated).
 * @param {THREE.Vector3} vel - velocity, units/second.
 * @param {number} dt - elapsed time in seconds.
 */
export function integrateVelocity(pos, vel, dt) {
  pos.x += vel.x * dt;
  pos.y += vel.y * dt;
  pos.z += vel.z * dt;
}

/**
 * Exponential per-axis velocity damping: vel *= dampBase^(dt*60). Mutates vel.
 *
 * @param {THREE.Vector3} vel - velocity (mutated).
 * @param {number} dampBase - per-frame-at-60fps damping factor (0..1; lower damps harder).
 * @param {number} dt - elapsed time in seconds.
 */
export function dampVelocity(vel, dampBase, dt) {
  const damp = Math.pow(dampBase, dt * 60);
  vel.x *= damp;
  vel.y *= damp;
  vel.z *= damp;
}

/**
 * Clamp vel's magnitude to at most maxSpeed, and (when minSpeed > 0) at least
 * minSpeed. Mutates vel in place.
 *
 * @param {THREE.Vector3} vel - velocity (mutated).
 * @param {number} maxSpeed - upper speed bound.
 * @param {number} [minSpeed=0] - lower speed bound; 0 disables the floor.
 */
export function capVelocitySpeed(vel, maxSpeed, minSpeed = 0) {
  const sp = vel.length();
  if (sp > maxSpeed) vel.multiplyScalar(maxSpeed / sp);
  else if (minSpeed > 0 && sp < minSpeed && sp > 1e-4) vel.multiplyScalar(minSpeed / sp);
}

/**
 * Orient `group` to face its direction of travel via lookAt(pos + vel).
 * Skipped when vel.lengthSq() < minLengthSq (pass 0, the default, to always
 * orient). `scratch` is a caller-owned Vector3 — reused every call, never
 * allocated here, so hot per-frame callers stay allocation-free.
 *
 * @param {THREE.Object3D} group - object reoriented via lookAt.
 * @param {THREE.Vector3} pos - current position.
 * @param {THREE.Vector3} vel - current velocity.
 * @param {THREE.Vector3} scratch - caller-owned scratch Vector3, overwritten each call.
 * @param {number} [minLengthSq=0] - skip reorienting when vel.lengthSq() is below this.
 */
export function orientToVelocity(group, pos, vel, scratch, minLengthSq = 0) {
  if (vel.lengthSq() < minLengthSq) return;
  scratch.copy(pos).add(vel);
  group.lookAt(scratch);
}
