/**
 * What a kin is trying to do.
 *
 * Every plant in the field advertises what it offers — `registrations
 * .affordances` carries one record per affordance, with a position, a radius
 * and a capacity. Until now only the observatory read them: the field
 * published an ecology and nothing consumed it, while the kin walked a fixed
 * lissajous orbit around their home patch. On a clearing of 34 plants that
 * read as pacing; on an island of 140 it read as ignoring the world.
 *
 * This module supplies the goal. It does not move anything — `stepLivingFauna`
 * still owns steering, obstacle resolution, edge repair and the gait solver.
 * All that changes is where the actor is heading, which is the smallest seam
 * that makes the field matter.
 *
 * Per-frame behaviour runs after `generateWorld` restores the real
 * `Math.random`, so this is outside the seeded window and free to jitter — the
 * same latitude `stepCreature` takes in the donor world.
 *
 * DOM-free.
 */

/**
 * The needs a kin carries, each mapping to the affordance types that answer
 * it. Rates are per second: forage comes back fastest, attending to a
 * landmark is a slow curiosity.
 */
export const WALKER_NEEDS = Object.freeze([
  Object.freeze({
    key: "forage",
    types: Object.freeze(["forage", "nectar"]),
    rate: 0.055,
    dwell: Object.freeze([3.5, 6.5]),
    action: "graze",
  }),
  Object.freeze({
    key: "shelter",
    types: Object.freeze(["shelter", "soft-cover"]),
    rate: 0.034,
    dwell: Object.freeze([4.5, 9]),
    action: "settle",
  }),
  Object.freeze({
    key: "attend",
    types: Object.freeze(["landmark", "pollen", "perch"]),
    rate: 0.021,
    dwell: Object.freeze([2.5, 5]),
    action: "notice",
  }),
]);

/**
 * Winged kin want different things. Perching is the long one on purpose — a
 * landing only reads if the flier stays put long enough to be seen doing it,
 * and sitting on the crown of a plant is the whole reason perches are
 * advertised.
 */
export const FLIER_NEEDS = Object.freeze([
  Object.freeze({
    key: "perch",
    types: Object.freeze(["perch"]),
    rate: 0.05,
    dwell: Object.freeze([7, 12]),
    action: "settle",
  }),
  Object.freeze({
    key: "forage",
    types: Object.freeze(["nectar", "pollen"]),
    rate: 0.045,
    dwell: Object.freeze([3, 5.5]),
    action: "graze",
  }),
  Object.freeze({
    key: "attend",
    types: Object.freeze(["landmark"]),
    rate: 0.02,
    dwell: Object.freeze([3, 6]),
    action: "notice",
  }),
]);

/** Back-compat alias: the walker set is what an unqualified kin carries. */
export const KIN_NEEDS = WALKER_NEEDS;

const NEED_SETS = { walker: WALKER_NEEDS, flier: FLIER_NEEDS };

/** Below this a need is not worth crossing the island for. */
const NEED_THRESHOLD = 0.28;

/**
 * How far a kin will consider travelling, in world units.
 *
 * A flier ranges much further: it crosses the island over the top of
 * everything, and the perches worth landing on are rare enough that a
 * walker's radius would leave most fields with exactly one in reach.
 */
const MAX_TRAVEL = { walker: 26, flier: 48 };

/**
 * How sharply distance discounts a candidate.
 *
 * A walker pays for every metre and should take the near option. A flier goes
 * over the top of the field, so distance is close to free — weighting it as
 * heavily left it shuttling between one perch and the nearest flower while
 * two other heroes went unvisited for four minutes.
 */
const DISTANCE_WEIGHT = { walker: 0.22, flier: 0.055 };

/**
 * How far a new goal has to be to be worth going to.
 *
 * With 450-odd affordances in a field the nearest match is almost always
 * underfoot, so without a floor a kin picks the thing it is already standing
 * on, satisfies it without moving, and never leaves. Observed as a flier that
 * shuttled between one hero and the flowers at its base for four minutes
 * while two other heroes went unvisited.
 */
const MIN_TRAVEL = { walker: 2.4, flier: 7 };

/** Where the approach stops curving and starts homing. */
const APPROACH_ARC = 6;

/**
 * How often a goalless kin reconsiders, in seconds.
 *
 * Deciding every frame is both wasteful — the scan is over every affordance
 * in the field — and worse behaviour, since a kin with two equally good
 * options would dither between them at frame rate.
 */
const DECIDE_INTERVAL = 0.4;

/**
 * How long a kin will pursue one goal before giving up on it, in seconds.
 *
 * Without this a goal it cannot physically reach is held forever: obstacle
 * resolution holds the kin just outside the arrival radius, so it never
 * arrives, never dwells, never drains and never reconsiders. Observed as one
 * kin of five standing still for three minutes with every need pinned at 1.0.
 */
const PURSUIT_TIMEOUT = 34;

/** A need this low is met; there is no point standing there any longer. */
const SATISFIED = 0.08;

/**
 * Where a kin that has arrived should actually stand.
 *
 * Not the goal itself. A plant's affordances sit at the plant, and a hero also
 * registers a trunk-sized collision circle, so steering at the goal for the
 * whole dwell means walking into the trunk every frame and being pushed back
 * out of it every frame. The kin never travels anywhere, but it never stops
 * either — it presses, dead-on, against the one obstacle in the middle of the
 * field, which is precisely the input that used to make the deflection flip
 * sides frame to frame.
 *
 * So an arrived kin holds the ground it arrived on: the target is its own
 * position, pulled no further out than the arrival radius. Being jostled off
 * by another kin still walks it back to the edge of the radius rather than
 * abandoning the visit, and standing at the trunk to shelter under a tree
 * remains the correct reading.
 *
 * One kind of arrival is exempt: a flier going to a perch. It is not being
 * held off by the plant — the plant it is landing on is explicitly not an
 * obstacle to it (`isGoalHost` in the runtime) — and it takes its *height*
 * from the crown it is sitting on, so holding station short of the trunk
 * would leave it hovering at crown height beside the crown, in mid-air. That
 * one homes all the way in, as it always did.
 */
function holdAt(goal, actor, out) {
  if (actor.flight && goal.type === "perch") {
    out.set(goal.x, 0, goal.z);
    return;
  }
  const dx = actor.position.x - goal.x;
  const dz = actor.position.z - goal.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 1e-4) {
    out.set(goal.x, 0, goal.z);
    return;
  }
  const hold = Math.min(distance, goal.radius);
  out.set(goal.x + (dx / distance) * hold, 0, goal.z + (dz / distance) * hold);
}

/**
 * Per-actor need state. Seeded off the ordinal so two kin created together do
 * not move in lockstep, then advanced purely by time.
 */
export function createKinNeeds(ordinal = 0, locomotion = "walker") {
  const set = NEED_SETS[locomotion] ?? WALKER_NEEDS;
  const levels = {};
  for (const [index, need] of set.entries()) {
    // Staggered starts, so a fresh field does not send every kin foraging on
    // the same frame.
    levels[need.key] = ((ordinal * 0.37 + index * 0.29) % 1) * 0.6;
  }
  return {
    set,
    levels,
    goal: null,
    dwellFrom: 0,
    dwellUntil: 0,
    arc: ordinal * 1.7,
    // Staggered so a field of kin does not all scan on the same frame.
    nextDecisionAt: ordinal * 0.11,
    giveUpAt: 0,
    maxTravel: MAX_TRAVEL[locomotion] ?? MAX_TRAVEL.walker,
    distanceWeight: DISTANCE_WEIGHT[locomotion] ?? DISTANCE_WEIGHT.walker,
    minTravel: MIN_TRAVEL[locomotion] ?? MIN_TRAVEL.walker,
    // The affordance just finished with. Excluded from the next choice: a kin
    // that has just grazed is standing on the nearest forage in the field, so
    // without this it would re-pick the same plant and never leave it.
    lastOrdinal: null,
  };
}

function needByKey(needs, key) {
  return (needs.set ?? WALKER_NEEDS).find((need) => need.key === key) ?? null;
}

/**
 * How many kin may be at one plant at once, whatever it is offering them.
 *
 * Capacity is declared per *affordance*, which stops two kin grazing one
 * bloom but not four kin converging on one plant — a hero advertises shelter,
 * a landmark, pollen and a perch, so four kin can hold four uncontested
 * claims and all walk to the same trunk. They then stand on the same arrival
 * circle, and the separation that keeps them from interpenetrating grinds
 * them against each other for the whole dwell. On screen it is a scrum at the
 * foot of the central plant.
 *
 * Two is a pair at a plant, which reads as company. Four is a scrum.
 */
const PLANT_CAPACITY = 2;

/**
 * Which affordances, and which plants, are already spoken for.
 *
 * Capacity is declared per affordance by the plant that offers it; honouring
 * it is what stops every kin converging on one bloom. The per-plant tally is
 * what stops them converging on one plant by way of four different blooms.
 */
function claimCounts(runtime) {
  const byOrdinal = new Map();
  const byPlant = new Map();
  for (const actor of runtime.fauna) {
    const goal = actor.needs?.goal;
    if (!goal || goal.ordinal === undefined) continue;
    byOrdinal.set(goal.ordinal, (byOrdinal.get(goal.ordinal) ?? 0) + 1);
    if (goal.floraKey) {
      byPlant.set(goal.floraKey, (byPlant.get(goal.floraKey) ?? 0) + 1);
    }
  }
  return { byOrdinal, byPlant };
}

/**
 * How close a kin can actually get to a point.
 *
 * A plant's affordances sit at the plant, and a hero plant also registers a
 * collision obstacle sized from its whole crown footprint — 5.77 units on a
 * canopy. So a `shelter` or `landmark` goal is inside a circle the kin is
 * pushed out of every frame: it would stand at the obstacle's edge forever,
 * never arriving, never satisfying the need that sent it. Measured before this
 * existed: one kin of five pinned at 6.72 from a goal with a 2.17 arrival
 * radius for three simulated minutes.
 *
 * Standing at the trunk to shelter under a tree is the correct reading
 * anyway, so the arrival radius grows to whatever the kin can reach rather
 * than the affordance being skipped.
 */
function reachableRadius(runtime, actor, x, z, base) {
  const obstacles = runtime.worldState?.obstacles ?? [];
  if (obstacles.length === 0) return base;
  // Mirrors the convention in `resolveAgainstObstacles`.
  const body = Math.max(0.32, (actor.agent?.traits?.radius ?? 0.5) * 0.68);
  let needed = base;
  for (const obstacle of obstacles) {
    const gap = Math.hypot(x - (obstacle.x ?? 0), z - (obstacle.z ?? 0));
    const minDistance = (obstacle.r ?? 0) + body;
    if (gap >= minDistance) continue;
    needed = Math.max(needed, minDistance - gap + 0.45);
  }
  return needed;
}

/**
 * Choose an affordance answering the actor's strongest need.
 *
 * Nearer is better, and a roomier affordance breaks ties, but the score keeps
 * a little noise so a field of equivalent options does not send every kin to
 * the same one.
 *
 * "Strongest" is tried in order, not once: a flier whose forage need pins at
 * 1.0 on a world with no nectar-bearing plant would otherwise scan, find
 * nothing, and dither goalless even when a weaker need could be answered.
 * The second-strongest need is a better goal than none.
 */
export function chooseKinGoal(runtime, actor) {
  const needs = actor.needs;
  const pressing = [];
  for (const need of needs.set ?? WALKER_NEEDS) {
    const level = needs.levels[need.key] ?? 0;
    if (level < NEED_THRESHOLD) continue;
    pressing.push(need);
  }
  pressing.sort(
    (a, b) => (needs.levels[b.key] ?? 0) - (needs.levels[a.key] ?? 0),
  );
  if (pressing.length === 0) return null;

  const affordances = runtime.registrations?.affordances ?? [];
  if (affordances.length === 0) return null;

  const claims = claimCounts(runtime);
  for (const strongest of pressing) {
    let best = null;
    for (const affordance of affordances) {
      const type = affordance.type;
      if (!strongest.types.includes(type)) continue;
      if (affordance.ordinal === needs.lastOrdinal) continue;
      const distance = Math.hypot(
        affordance.x - actor.position.x,
        affordance.z - actor.position.z,
      );
      if (distance > (needs.maxTravel ?? MAX_TRAVEL.walker)) continue;
      if (distance < (needs.minTravel ?? MIN_TRAVEL.walker)) continue;
      if (
        (claims.byOrdinal.get(affordance.ordinal) ?? 0) >=
        Math.max(1, affordance.capacity)
      ) {
        continue;
      }
      // Already busy, even if this particular bloom on it is free.
      if (
        affordance.floraKey &&
        (claims.byPlant.get(affordance.floraKey) ?? 0) >= PLANT_CAPACITY
      ) {
        continue;
      }
      const score =
        1 / (1 + distance * (needs.distanceWeight ?? DISTANCE_WEIGHT.walker)) +
        Math.min(affordance.capacity, 6) * 0.012 +
        Math.random() * 0.06;
      if (!best || score > best.score) {
        best = {
          score,
          ordinal: affordance.ordinal,
          need: strongest.key,
          action: strongest.action,
          // A flier needs both: the type to know a perch is a perch, and the
          // height to land on the crown that offered it rather than guessing.
          type,
          // Which plant this came from, so the next kin to choose can see the
          // plant is busy rather than only that this one bloom is taken.
          floraKey: affordance.floraKey,
          x: affordance.x,
          y: affordance.y,
          z: affordance.z,
          // Arrive somewhere on the plant, not inside its stem — and no closer
          // than the plant's own collision envelope actually permits.
          radius: reachableRadius(
            runtime,
            actor,
            affordance.x,
            affordance.z,
            Math.max(0.55, affordance.radius * 0.85),
          ),
        };
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * Advance needs, hold or release a goal, and write the point the actor should
 * steer toward into `out`.
 *
 * @returns {{action: string, arrived: boolean, goal: object|null}}
 */
export function stepKinGoal(runtime, actor, dt, time, out) {
  const needs = actor.needs;
  for (const need of needs.set ?? WALKER_NEEDS) {
    needs.levels[need.key] = Math.min(
      1,
      (needs.levels[need.key] ?? 0) + need.rate * dt,
    );
  }
  needs.arc += dt * 0.55;

  // Dwelling: the need drains while the kin is actually at the thing that
  // answers it, which is what makes a visit read as a visit.
  if (needs.goal && needs.dwellUntil > 0) {
    const need = needByKey(needs, needs.goal.need);
    if (need) {
      needs.levels[need.key] = Math.max(
        0,
        needs.levels[need.key] - dt / Math.max(need.dwell[0], 0.5),
      );
    }
    // A visit has to last long enough to read as one. Without the floor a
    // need that was only just over threshold drains in well under a second,
    // and a flier would touch a perch and leave in the same breath.
    const stayed = time - needs.dwellFrom;
    const met =
      need && needs.levels[need.key] <= SATISFIED && stayed >= need.dwell[0] * 0.6;
    if (time >= needs.dwellUntil || met) {
      needs.lastOrdinal = needs.goal.ordinal;
      needs.goal = null;
      needs.dwellUntil = 0;
    } else {
      holdAt(needs.goal, actor, out);
      return { action: need?.action ?? "arrive", arrived: true, goal: needs.goal };
    }
  }

  if (!needs.goal) {
    if (time < needs.nextDecisionAt) {
      return { action: null, arrived: false, goal: null };
    }
    needs.nextDecisionAt = time + DECIDE_INTERVAL;
    needs.goal = chooseKinGoal(runtime, actor);
    if (!needs.goal) return { action: null, arrived: false, goal: null };
    needs.giveUpAt = time + PURSUIT_TIMEOUT;
    // Only the immediately preceding affordance is off-limits, and only until
    // something else has been chosen — a two-plant field still works.
    needs.lastOrdinal = null;
  }

  const goal = needs.goal;
  if (time >= needs.giveUpAt) {
    // Unreachable, or something got in the way. Drop it and let the next
    // decision pick elsewhere; the abandoned one is skipped once so the kin
    // does not immediately re-commit to it.
    needs.lastOrdinal = goal.ordinal;
    needs.goal = null;
    needs.dwellUntil = 0;
    return { action: null, arrived: false, goal: null };
  }
  const dx = goal.x - actor.position.x;
  const dz = goal.z - actor.position.z;
  const distance = Math.hypot(dx, dz);

  if (distance <= goal.radius) {
    const need = needByKey(needs, goal.need);
    const span = need ? need.dwell : [3, 5];
    needs.dwellFrom = time;
    needs.dwellUntil = time + span[0] + Math.random() * (span[1] - span[0]);
    holdAt(goal, actor, out);
    return { action: need?.action ?? "arrive", arrived: true, goal };
  }

  // Curve in rather than beelining. The arc decays with distance so the last
  // stretch is a straight, unhurried approach instead of a spiral.
  const arc = Math.min(1, distance / APPROACH_ARC);
  out.set(
    goal.x + Math.cos(needs.arc) * 0.95 * arc,
    0,
    goal.z + Math.sin(needs.arc) * 0.95 * arc,
  );
  return { action: "travel", arrived: false, goal };
}

/**
 * Release a goal — used when an actor is removed, so its claim does not hold
 * an affordance's capacity against the kin still in the field.
 */
export function releaseKinGoal(actor) {
  if (!actor?.needs) return;
  actor.needs.goal = null;
  actor.needs.dwellUntil = 0;
}
