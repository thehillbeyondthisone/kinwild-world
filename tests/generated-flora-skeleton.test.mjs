import assert from "node:assert/strict";

import {
  MAX_SKELETON_NODES,
  SKELETON_HABITS,
  compileSkeleton,
} from "../src/generated-flora/skeleton.js";
import { ARCHETYPES, FLORA_ARCHETYPES } from "../src/generated-flora/archetypes.js";
import { normalizeFloraDNA } from "../src/generated-flora/dna.js";
import { createRng } from "../src/generated-flora/rng.js";

const spec = (overrides = {}) => ({
  habit: "upright",
  stems: 2,
  baseSpread: 0.4,
  height: 4,
  baseRadius: 0.3,
  taper: 0.5,
  curve: 0.3,
  branch: { count: 3, angle: 0.7, depth: 2, falloff: 0.7 },
  ...overrides,
});

// Same DNA, same graph — byte for byte. Growth, damage and saves all name
// parts of a plant by id, so a rebuild that renumbers them is a data loss.
const a = compileSkeleton(spec(), createRng("stable"));
const b = compileSkeleton(spec(), createRng("stable"));
assert.deepEqual(a, b, "the same seed must rebuild an identical skeleton");
assert.notDeepEqual(
  a.nodes.map((node) => node.length),
  compileSkeleton(spec(), createRng("different")).nodes.map((node) => node.length),
  "a different seed should grow a different plant",
);

// Ids are path-derived, unique, and every parent reference resolves.
const ids = new Set(a.nodes.map((node) => node.id));
assert.equal(ids.size, a.nodes.length, "node ids must be unique");
for (const node of a.nodes) {
  assert.match(node.id, /^\d+(\/(\d+|b\d+))*$/, `${node.id} is not path-derived`);
  if (node.parent !== null) {
    assert.ok(ids.has(node.parent), `${node.id} references a missing parent`);
    assert.ok(
      node.id.startsWith(`${node.parent}/`),
      `${node.id} should be named for its position under ${node.parent}`,
    );
  }
}
assert.ok(a.terminals.length > 0, "a skeleton must end somewhere");
for (const terminal of a.terminals) {
  assert.equal(
    a.nodes.some((node) => node.parent === terminal.id),
    false,
    "a terminal must have no children",
  );
}

// The budget is enforced before construction, not discovered afterwards.
const greedy = compileSkeleton(
  spec({ stems: 4, branch: { count: 4, angle: 0.8, depth: 3, falloff: 0.7 } }),
  createRng("greedy"),
);
assert.ok(
  greedy.nodes.length <= MAX_SKELETON_NODES,
  `pruning should hold the budget, got ${greedy.nodes.length}`,
);
assert.deepEqual(
  greedy,
  compileSkeleton(
    spec({ stems: 4, branch: { count: 4, angle: 0.8, depth: 3, falloff: 0.7 } }),
    createRng("greedy"),
  ),
  "pruning must be deterministic",
);
// Pruning takes the outermost branching, never a root.
const prunedIds = new Set(greedy.nodes.map((node) => node.id));
for (let stem = 0; stem < 4; stem++) {
  assert.ok(prunedIds.has(`${stem}`), `stem ${stem} should survive pruning`);
}
const survivingDepth = Math.max(...greedy.nodes.map((node) => node.depth));
const unprunedDepth = 3;
assert.ok(
  survivingDepth <= unprunedDepth,
  "pruning should not deepen the graph",
);

// A tight budget still yields a connected, usable plant.
const tiny = compileSkeleton(spec({ maxNodes: 4 }), createRng("tiny"));
assert.ok(tiny.nodes.length <= 4 && tiny.nodes.length > 0);
const tinyIds = new Set(tiny.nodes.map((node) => node.id));
for (const node of tiny.nodes) {
  if (node.parent !== null) assert.ok(tinyIds.has(node.parent));
}

// Every habit produces finite geometry with its feet on the ground.
for (const habit of SKELETON_HABITS) {
  const skeleton = compileSkeleton(spec({ habit }), createRng(habit));
  assert.equal(skeleton.habit, habit);
  assert.ok(skeleton.nodes.length > 0, `${habit} should grow something`);
  for (const node of skeleton.nodes) {
    for (const value of [...node.origin, ...node.direction, ...node.tip]) {
      assert.ok(Number.isFinite(value), `${habit} produced a non-finite node`);
    }
    assert.ok(node.length > 0, `${habit} produced a zero-length segment`);
    assert.ok(node.radiusStart > 0 && node.radiusEnd > 0);
    assert.ok(
      Math.abs(Math.hypot(...node.direction) - 1) < 1e-9,
      `${habit} direction should be a unit vector`,
    );
  }
  assert.ok(skeleton.extent.height > 0, `${habit} should have height`);
  assert.ok(skeleton.extent.radius >= 0);
}

// Habits differ in posture, which is the whole point of naming them.
const upright = compileSkeleton(spec({ habit: "upright", branch: { count: 0 } }), createRng("h"));
const creeping = compileSkeleton(spec({ habit: "creeping", branch: { count: 0 } }), createRng("h"));
assert.ok(
  upright.extent.height > creeping.extent.height,
  "an upright stem should stand taller than a creeping one",
);
assert.ok(
  creeping.extent.radius > upright.extent.radius,
  "a creeping stem should reach further out than an upright one",
);

// Every shipped archetype's own spec compiles inside budget.
for (const key of FLORA_ARCHETYPES) {
  const { dna } = normalizeFloraDNA({ archetype: key });
  const archetypeSpec = ARCHETYPES[key].skeleton(dna.shape);
  if (!archetypeSpec) continue;
  const skeleton = compileSkeleton(archetypeSpec, createRng(key));
  assert.ok(skeleton.nodes.length > 0, `${key} should grow a skeleton`);
  assert.ok(
    skeleton.nodes.length <= MAX_SKELETON_NODES,
    `${key} exceeded the node budget with ${skeleton.nodes.length}`,
  );
}

console.log("generated flora skeleton invariants passed");
