import assert from "node:assert/strict";
import {
  RELATION_CATEGORIES,
  buildRelationGraph,
  relationCategory,
  relationTotals,
} from "../src/ui/observatory-relations.js";

// Every type the runtime can register maps onto the legend's four categories.
const TYPES = [
  "nectar",
  "pollen",
  "forage",
  "shelter",
  "soft-cover",
  "perch",
  "landmark",
];
for (const type of TYPES) {
  assert.ok(
    RELATION_CATEGORIES.includes(relationCategory(type)),
    `${type} should land in a legend category`,
  );
}
assert.equal(relationCategory("something-new"), "unknown");
assert.equal(relationCategory(undefined), "unknown");

const affordances = [];
let ordinal = 0;
for (const type of TYPES) {
  for (let index = 0; index < 4; index++) {
    affordances.push({
      type,
      floraKey: `plant-${index}`,
      speciesId: `kinwild:plant-${index}`,
      capacity: (index + 1) * (type === "nectar" ? 2 : 1),
      radius: 0.4,
      x: index,
      y: 0,
      z: index,
      ordinal: ordinal++,
    });
  }
}

const totals = relationTotals(affordances);
assert.equal(totals.nourish, 12, "nectar, pollen and forage all nourish");
assert.equal(totals.shelter, 8, "shelter and soft-cover both shelter");
assert.equal(totals.attune, 8, "perch and landmark both attune");
assert.equal(totals.unknown, 0);

const graph = buildRelationGraph(affordances, { nodeCount: 7 });
assert.equal(graph.nodes.length, 7, "the node count should clamp to the plot's budget");
assert.equal(graph.count, graph.links.length);
assert.deepEqual(graph.totals, totals, "the legend counts the field, not the plot");

// Deterministic: same input, byte-identical layout. A force solver would fail
// this, which is exactly why there isn't one.
assert.deepEqual(
  buildRelationGraph(affordances, { nodeCount: 7 }),
  graph,
  "identical registrations must produce an identical layout",
);
// ...and independent of the order they arrive in.
assert.deepEqual(
  buildRelationGraph([...affordances].reverse(), { nodeCount: 7 }),
  graph,
  "the selection order must be total, not input-order dependent",
);

// The plot must show the field's mix, not just its most numerous category.
// Ranking on capacity alone handed all seven seats to nectar on a real field:
// one solid colour under a four-colour legend.
const plotted = new Set(graph.nodes.map((node) => node.category));
for (const category of ["nourish", "shelter", "attune"]) {
  assert.ok(plotted.has(category), `${category} should hold a seat on the plot`);
}
// Within a category the largest affordance still leads.
const nourish = graph.nodes.filter((node) => node.category === "nourish");
assert.equal(
  nourish[0].capacity,
  Math.max(
    ...affordances
      .filter((a) => ["nectar", "pollen", "forage"].includes(a.type))
      .map((a) => a.capacity),
  ),
  "the first seat in a category should go to its largest affordance",
);
// A category with nothing in it must not cost the plot a seat.
const lopsided = buildRelationGraph(
  Array.from({ length: 9 }, (_, index) => ({
    type: "nectar",
    floraKey: `bloom-${index}`,
    capacity: index + 1,
    ordinal: index,
  })),
  { nodeCount: 7 },
);
assert.equal(lopsided.nodes.length, 7, "an empty category should not shrink the plot");

// Every node sits inside the viewBox, with its dot fully drawn.
for (const node of graph.nodes) {
  assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
  assert.ok(node.x - node.radius >= 0 && node.x + node.radius <= 180, "node inside width");
  assert.ok(node.y - node.radius >= 0 && node.y + node.radius <= 74, "node inside height");
  assert.ok(RELATION_CATEGORIES.includes(node.category));
}
// No two nodes stacked on top of each other — the spiral's whole job.
for (let a = 0; a < graph.nodes.length; a++) {
  for (let b = a + 1; b < graph.nodes.length; b++) {
    const distance = Math.hypot(
      graph.nodes[a].x - graph.nodes[b].x,
      graph.nodes[a].y - graph.nodes[b].y,
    );
    assert.ok(distance > 4, `nodes ${a} and ${b} overlap at ${distance.toFixed(2)}`);
  }
}

// Links are deduplicated pairs, stored low-high, never self-referential.
const keys = new Set();
for (const link of graph.links) {
  assert.ok(link.from < link.to, "pairs should be stored low-high");
  const key = `${link.from}-${link.to}`;
  assert.ok(!keys.has(key), "a mutual nearest-neighbour choice should be stored once");
  keys.add(key);
}
// Every node is reachable — an isolated dot reads as a rendering bug.
const reached = new Set([0]);
let grew = true;
while (grew) {
  grew = false;
  for (const link of graph.links) {
    if (reached.has(link.from) && !reached.has(link.to)) {
      reached.add(link.to);
      grew = true;
    }
    if (reached.has(link.to) && !reached.has(link.from)) {
      reached.add(link.from);
      grew = true;
    }
  }
}
assert.equal(reached.size, graph.nodes.length, "the web should be connected");

// Degenerate inputs must not throw — an empty field is a real state during
// generation, and the panel renders before the first plant lands.
for (const empty of [[], undefined, null]) {
  const blank = buildRelationGraph(empty);
  assert.deepEqual(blank.nodes, []);
  assert.deepEqual(blank.links, []);
  assert.equal(blank.count, 0);
}
const single = buildRelationGraph([{ type: "perch", capacity: 1, ordinal: 0 }]);
assert.equal(single.nodes.length, 1);
assert.equal(single.links.length, 0, "one node cannot have a neighbour");
const malformed = buildRelationGraph([{}, { type: 42 }, { capacity: "six" }]);
assert.equal(malformed.nodes.length, 3);
for (const node of malformed.nodes) {
  assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
  assert.equal(node.category, "unknown");
}

console.log("observatory-relations.test.mjs passed");
