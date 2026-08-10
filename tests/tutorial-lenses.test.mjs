// What a lens says, without a browser.
//
// The lenses are the tutorial's teaching instruments, and each one is making a
// specific claim about the engine: a planted foot does not move, a body is a
// handful of jointed shapes, a plant advertises its own strings. The claims are
// asserted here; `src/ui/lens-layer.js` only draws what these return.

import assert from "node:assert/strict";
import {
  MARK_KINDS,
  MARK_SPACES,
  affordanceMarks,
  gaitMarks,
  underdrawingMarks,
} from "../src/tutorial/lenses.js";

const kinds = new Set(MARK_KINDS);
const spaces = new Set(MARK_SPACES);

/** Every mark, from every builder, has to be drawable. */
function assertDrawable(marks, label) {
  const keys = new Set();
  for (const mark of marks) {
    assert(kinds.has(mark.kind), `${label}: unknown mark kind ${mark.kind}`);
    assert(spaces.has(mark.space), `${label}: unknown space ${mark.space}`);
    assert(typeof mark.key === "string" && mark.key.length, `${label}: a mark needs a key`);
    assert(!keys.has(mark.key), `${label}: duplicate key ${mark.key}`);
    keys.add(mark.key);
    assert(mark.weight >= 1 && mark.weight <= 3, `${label}: weight out of range`);
    for (const field of ["at", "from", "to"]) {
      if (!(field in mark)) continue;
      assert.equal(mark[field].length, 3, `${label}: ${field} should be a point`);
      for (const n of mark[field]) assert(Number.isFinite(n), `${label}: ${field} is not finite`);
    }
  }
}

// --- the gait ---------------------------------------------------------------

const feet = [
  { planted: [1, 0, 1], target: [1, 0, 1], stepping: false, gaitGroup: 0 },
  { planted: [-1, 0, 1], target: [-1, 0, 2], stepping: true, gaitGroup: 1 },
  { planted: [1, 0, -1], target: [1, 0, -1], stepping: false, gaitGroup: 1 },
  { planted: [-1, 0, -1], target: [-1, 0, -1], stepping: false, gaitGroup: 0 },
];

const gait = gaitMarks(feet);
assertDrawable(gait, "gait");

// One dot per foot, always — the dot is the lesson and it is never conditional.
assert.equal(gait.filter((m) => m.kind === "dot").length, 4);

// A planted foot's target is its own position; ringing that would put a ring
// under every dot and say nothing. Only the swinging foot gets an aim.
assert.deepEqual(
  gait.filter((m) => m.kind === "ring").map((m) => m.key),
  ["aim:1"],
);
assert.deepEqual(
  gait.filter((m) => m.kind === "link").map((m) => m.key),
  ["swing:1"],
);

// Phase groups read as ink weight, not colour.
assert.equal(gait.find((m) => m.key === "foot:0").weight, 1);
assert.equal(gait.find((m) => m.key === "foot:1").weight, 2);

// Feet are already out of the actor, so they are world marks.
assert(gait.every((m) => m.space === "world"));

assert.deepEqual(gaitMarks(undefined), [], "no feet is not a crash");

// --- the underdrawing -------------------------------------------------------

// A body, a head, and two leg segments — the shape walker.js builds.
const primitives = [
  { position: [0, 0.5, 0], scale: [1, 1, 1] },
  { position: [0, 0.7, 0.3], scale: [0.5, 0.5, 0.5] },
  { position: [0.2, 0.3, 0], scale: [0.2, 0.2, 0.2] },
  { position: [0.2, 0.1, 0], scale: [0.2, 0.2, 0.2] },
];
// The lists walker.js writes: symmetric, and never naming the primitive itself.
const influences = [[1, 2], [0], [0, 3], [2]];

const under = underdrawingMarks(primitives, influences);
assertDrawable(under, "underdrawing");

// A carrier per primitive, drawn at its own size rather than as equal pips.
const carriers = under.filter((m) => m.key.startsWith("carrier:"));
assert.equal(carriers.length, 4);
assert(carriers[0].radius > carriers[2].radius, "a bigger carrier draws bigger");

// The blend graph is the point, and each join is drawn exactly once even though
// both ends name each other.
assert.deepEqual(
  under.filter((m) => m.kind === "link").map((m) => m.key),
  ["joint:0-1", "joint:0-2", "joint:2-3"],
);

// Primitives are local to the kin, so the marks ride the body as it walks.
assert(under.every((m) => m.space === "actor"));

// A malformed list must not invent a join to a primitive that isn't there.
assert.deepEqual(
  underdrawingMarks(primitives, [[9], [0], [], []]).filter((m) => m.kind === "link").map((m) => m.key),
  ["joint:0-1"],
);
assert.deepEqual(underdrawingMarks(null, null), []);

// --- affordances ------------------------------------------------------------

const affordances = [
  { type: "nectar", x: 1, y: 0, z: 1, radius: 1.5, ordinal: 0 },
  { type: "perch", x: 2, y: 1, z: 2, radius: 0.8, ordinal: 1 },
  { type: "shelter", x: 3, y: 0, z: 3, radius: 2, ordinal: 2 },
];

const all = affordanceMarks(affordances);
assertDrawable(all, "affordances");
assert.equal(all.length, 3, "with nothing predicted, every offer is one quiet dot");
assert(all.every((m) => m.kind === "dot"));

const filtered = affordanceMarks(affordances, { types: ["nectar", "perch"] });
assert.equal(filtered.length, 2, "the lens draws the strings it was asked for");

// The one being gone to is inked heaviest, ringed at its real reach, and named.
const predicted = affordanceMarks(affordances, { predicted: 1 });
const chosen = predicted.filter((m) => m.key.startsWith("aff:1"));
assert.deepEqual(chosen.map((m) => m.kind), ["dot", "ring", "tag"]);
assert.equal(chosen[0].weight, 3);
assert.equal(chosen[1].radius, 0.8, "the ring is the affordance's own reach");
assert.equal(chosen[2].text, "perch");
// Only the predicted one — there are a couple of hundred of these in a world.
assert.equal(predicted.filter((m) => m.kind === "ring").length, 1);

assert.equal(
  affordanceMarks(affordances, { predicted: 1, named: false }).filter((m) => m.kind === "tag")
    .length,
  0,
);

console.log("tutorial lens tests passed");
