import assert from "node:assert/strict";

import {
  KIN_NEEDS,
  chooseKinGoal,
  createKinNeeds,
  releaseKinGoal,
  stepKinGoal,
} from "../src/living-world/kin-goals.js";

/** A minimal stand-in for the runtime: the registry and the actor list. */
function makeRuntime(affordances, obstacles = []) {
  return {
    fauna: [],
    registrations: { affordances },
    worldState: { obstacles },
  };
}

function makeActor(runtime, ordinal, x = 0, z = 0) {
  const actor = {
    position: { x, y: 0, z },
    // Mirrors the shape `resolveAgainstObstacles` reads.
    agent: { traits: { radius: 0.5 } },
    needs: createKinNeeds(ordinal),
  };
  runtime.fauna.push(actor);
  return actor;
}

/** A Vector3-shaped sink, so the module can be exercised without three. */
const point = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } };

const affordance = (ordinal, type, x, z, extra = {}) => ({
  ordinal,
  type,
  x,
  y: 0,
  z,
  radius: 1,
  capacity: 1,
  ...extra,
});

// ------------------------------------------------------------------ needs
{
  const runtime = makeRuntime([]);
  const actor = makeActor(runtime, 0);
  const before = { ...actor.needs.levels };
  for (let step = 0; step < 60; step++) stepKinGoal(runtime, actor, 1 / 60, step / 60, point);
  for (const need of KIN_NEEDS) {
    assert.ok(
      actor.needs.levels[need.key] > before[need.key],
      `${need.key} should build over time`,
    );
    assert.ok(actor.needs.levels[need.key] <= 1, `${need.key} should stay bounded`);
  }
}

// Two kin created together must not move in lockstep.
{
  const runtime = makeRuntime([]);
  const a = makeActor(runtime, 0);
  const b = makeActor(runtime, 1);
  assert.notDeepEqual(
    a.needs.levels,
    b.needs.levels,
    "need levels should be staggered by ordinal",
  );
}

// ----------------------------------------------------------- goal choice
{
  const runtime = makeRuntime([
    affordance(0, "forage", 3, 0),
    affordance(1, "forage", 20, 0),
    affordance(2, "shelter", 1, 0),
  ]);
  const actor = makeActor(runtime, 0);
  // Drive one need clearly above the others.
  actor.needs.levels.forage = 0.9;
  actor.needs.levels.shelter = 0.1;
  actor.needs.levels.attend = 0.1;

  const goal = chooseKinGoal(runtime, actor);
  assert.ok(goal, "a strong need with matching affordances should produce a goal");
  assert.equal(goal.need, "forage", "the strongest need should choose");
  assert.equal(goal.ordinal, 0, "the nearer of two equal affordances should win");
}

// A need below the threshold is not worth crossing the island for.
{
  const runtime = makeRuntime([affordance(0, "forage", 3, 0)]);
  const actor = makeActor(runtime, 0);
  for (const need of KIN_NEEDS) actor.needs.levels[need.key] = 0.05;
  assert.equal(chooseKinGoal(runtime, actor), null);
}

// Nothing in range, nothing to do — the caller falls back to its orbit.
{
  const runtime = makeRuntime([affordance(0, "forage", 500, 500)]);
  const actor = makeActor(runtime, 0);
  actor.needs.levels.forage = 0.9;
  assert.equal(chooseKinGoal(runtime, actor), null, "distant affordances are ignored");
}

// An empty field must not strand the kin.
{
  const runtime = makeRuntime([]);
  const actor = makeActor(runtime, 0);
  actor.needs.levels.forage = 0.9;
  assert.equal(chooseKinGoal(runtime, actor), null);
  const pursuit = stepKinGoal(runtime, actor, 1 / 60, 10, point);
  assert.equal(pursuit.goal, null, "no goal means the orbit fallback takes over");
}

// The strongest need gets first refusal, not sole consideration. A flier on a
// world with no nectar-bearing plant pins forage at 1.0 forever; without a
// fallback it dithers goalless while a weaker, answerable need waits.
{
  const runtime = makeRuntime([affordance(0, "shelter", 5, 0)]);
  const actor = makeActor(runtime, 0);
  // forage answers ["forage", "nectar"] — nothing here matches it.
  actor.needs.levels.forage = 0.95;
  actor.needs.levels.shelter = 0.5;
  actor.needs.levels.attend = 0.1;
  const goal = chooseKinGoal(runtime, actor);
  assert.ok(goal, "an answerable weaker need should produce a goal");
  assert.equal(goal.need, "shelter", "the second-strongest need answers when the strongest cannot");
  assert.equal(goal.ordinal, 0);
}

// The fallback keeps its manners: when the strongest need *can* be answered,
// it still chooses first.
{
  const runtime = makeRuntime([
    affordance(0, "forage", 5, 0),
    affordance(1, "shelter", 4, 0),
  ]);
  const actor = makeActor(runtime, 0);
  actor.needs.levels.forage = 0.9;
  actor.needs.levels.shelter = 0.5;
  const goal = chooseKinGoal(runtime, actor);
  assert.equal(goal.need, "forage", "the strongest need still wins when it can be answered");
}

// A goal you are already standing on is not a journey. With hundreds of
// affordances in a field the nearest match is almost always underfoot, and
// without a floor a kin satisfies need after need without ever moving.
{
  const runtime = makeRuntime([
    affordance(0, "forage", 0.3, 0),
    affordance(1, "forage", 9, 0),
  ]);
  const actor = makeActor(runtime, 0);
  actor.needs.levels.forage = 0.95;
  assert.equal(
    chooseKinGoal(runtime, actor).ordinal,
    1,
    "a kin should walk to the far option rather than the one underfoot",
  );
}

// -------------------------------------------------------------- capacity
{
  const runtime = makeRuntime([affordance(0, "forage", 5, 0, { capacity: 1 })]);
  const first = makeActor(runtime, 0);
  const second = makeActor(runtime, 1);
  for (const actor of [first, second]) actor.needs.levels.forage = 0.95;

  first.needs.goal = chooseKinGoal(runtime, first);
  assert.equal(first.needs.goal.ordinal, 0);
  assert.equal(
    chooseKinGoal(runtime, second),
    null,
    "a capacity-1 affordance should not take a second claimant",
  );

  // Releasing the first kin's claim frees it again.
  releaseKinGoal(first);
  assert.ok(chooseKinGoal(runtime, second), "a released claim should be reusable");
}

{
  const runtime = makeRuntime([affordance(0, "forage", 5, 0, { capacity: 3 })]);
  const actors = [0, 1, 2].map((ordinal) => makeActor(runtime, ordinal));
  for (const actor of actors) {
    actor.needs.levels.forage = 0.95;
    actor.needs.goal = chooseKinGoal(runtime, actor);
  }
  assert.ok(
    actors.every((actor) => actor.needs.goal?.ordinal === 0),
    "a roomier affordance should take every claimant up to its capacity",
  );
}

// ------------------------------------------------- reachable arrival radius
//
// A hero plant's affordances sit at the plant, and the same plant registers a
// collision obstacle sized from its whole crown. The kin is pushed out of that
// circle every frame, so a goal inside it can never be reached at the
// affordance's own radius: the kin stands at the edge forever, never
// satisfying the need that sent it. Observed as one kin of five pinned 6.72
// from its goal for three simulated minutes while the others roamed.
{
  const runtime = makeRuntime(
    [affordance(0, "shelter", 10, 0, { radius: 2 })],
    [{ x: 10, z: 0, r: 5.77 }],
  );
  const actor = makeActor(runtime, 0);
  actor.needs.levels.shelter = 0.95;
  const goal = chooseKinGoal(runtime, actor);
  assert.ok(goal, "an affordance inside an obstacle should still be a goal");

  const body = Math.max(0.32, 0.5 * 0.68);
  const standoff = 5.77 + body;
  assert.ok(
    goal.radius >= standoff,
    `the arrival radius (${goal.radius.toFixed(2)}) must reach past the ` +
      `standoff (${standoff.toFixed(2)}) the kin is held at`,
  );

  // Concretely: standing as close as the obstacle allows has to count.
  actor.position.x = 10 - standoff;
  const pursuit = stepKinGoal(runtime, actor, 1 / 60, 5, point);
  assert.equal(
    pursuit.arrived,
    true,
    "standing as close as the obstacle allows should count as arriving",
  );
}

// Without an obstacle the radius stays the affordance's own.
{
  const runtime = makeRuntime([affordance(0, "shelter", 10, 0, { radius: 2 })]);
  const actor = makeActor(runtime, 0);
  actor.needs.levels.shelter = 0.95;
  assert.equal(chooseKinGoal(runtime, actor).radius, 1.7);
}

// ------------------------------------------------------- arrival + dwell
{
  const runtime = makeRuntime([affordance(0, "forage", 8, 0, { radius: 2 })]);
  const actor = makeActor(runtime, 0);
  actor.needs.levels.forage = 0.9;
  // Chosen from across the field, then walked in: the minimum-travel floor
  // governs what is worth going to, not what counts as being there.
  stepKinGoal(runtime, actor, 1 / 60, 99, point);
  assert.equal(actor.needs.goal.ordinal, 0);
  actor.position.x = 7.8;

  const arrival = stepKinGoal(runtime, actor, 1 / 60, 100, point);
  assert.equal(arrival.arrived, true, "standing inside the radius counts as arrival");
  assert.equal(arrival.action, "graze", "the action should name what the kin is doing");
  assert.ok(actor.needs.dwellUntil > 100, "arriving should start a dwell");

  // The need drains while dwelling — that is what makes a visit mean something.
  const onArrival = actor.needs.levels.forage;
  for (let step = 0; step < 30; step++) {
    stepKinGoal(runtime, actor, 1 / 60, 100 + step / 60, point);
  }
  assert.ok(
    actor.needs.levels.forage < onArrival,
    "the need should drain while the kin is at the thing that answers it",
  );

  // Past the dwell the goal is released. With only one affordance in the
  // field there is nothing else to choose, and the kin must not simply
  // re-latch onto the plant it has just finished with.
  stepKinGoal(runtime, actor, 1 / 60, actor.needs.dwellUntil + 1, point);
  assert.equal(actor.needs.goal, null, "a finished affordance should not be re-picked");
  assert.equal(actor.needs.lastOrdinal, 0, "the finished affordance should be remembered");
}

// ------------------------------------------------------------- approach
{
  const runtime = makeRuntime([affordance(0, "forage", 20, 0, { radius: 1 })]);
  const actor = makeActor(runtime, 0);
  actor.needs.levels.forage = 0.9;
  const travelling = stepKinGoal(runtime, actor, 1 / 60, 50, point);
  assert.equal(travelling.arrived, false);
  assert.ok(
    Math.hypot(point.x - 20, point.z - 0) <= 1.0,
    "the steering point should sit near the goal, arced but not wandering off it",
  );
  // The arc decays with distance, so a close approach is nearly straight.
  actor.position.x = 19;
  stepKinGoal(runtime, actor, 1 / 60, 51, point);
  assert.ok(
    Math.hypot(point.x - 20, point.z - 0) < 0.35,
    "the last stretch should be a straight approach, not a spiral",
  );
}

// Deciding is throttled: a goalless kin must not rescan the field every frame.
// Counted by how often the scan reads an affordance's type — the property the
// per-candidate filter touches exactly once per pass. (Counting `length` would
// have measured the array iterator's own bookkeeping instead.)
{
  let reads = 0;
  const watched = {
    ...affordance(0, "forage", 3, 0),
    get type() {
      reads++;
      return "forage";
    },
  };
  const runtime = makeRuntime([watched]);
  const actor = makeActor(runtime, 0);
  actor.needs.levels.forage = 0.9;
  actor.needs.nextDecisionAt = 0;
  // A whole second of frames, with the goal cleared each time so it must
  // re-decide rather than coast on one it already holds.
  for (let step = 0; step < 60; step++) {
    actor.needs.goal = null;
    stepKinGoal(runtime, actor, 1 / 60, step / 60, point);
  }
  assert.ok(
    reads > 0 && reads <= 4,
    `a goalless kin scanned the field ${reads} times in one second`,
  );
}

// With somewhere else to go, a finished kin moves on rather than re-grazing.
{
  const runtime = makeRuntime([
    affordance(0, "forage", 4, 0, { radius: 2 }),
    affordance(1, "forage", 9, 0, { radius: 1 }),
  ]);
  const actor = makeActor(runtime, 0);
  actor.needs.levels.forage = 0.95;
  stepKinGoal(runtime, actor, 1 / 60, 200, point);
  assert.equal(actor.needs.goal.ordinal, 0, "the nearest forage is chosen first");
  actor.needs.dwellUntil = 200.5;
  actor.needs.levels.forage = 0.95;
  actor.needs.nextDecisionAt = 0;
  stepKinGoal(runtime, actor, 1 / 60, 201, point);
  assert.equal(
    actor.needs.goal?.ordinal,
    1,
    "a finished kin should move to a different plant, not re-graze the same one",
  );
}

console.log("living-world-kin-goals.test.mjs passed");
