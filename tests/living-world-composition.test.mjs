import assert from "node:assert/strict";
import * as THREE from "three";

globalThis.__APP_VERSION__ = "test";

const { planLivingComposition, selectLivingWorldAnchor } = await import(
  "../src/living-world/runtime.js"
);
const { habitatScore } = await import("../src/generated-flora/archetypes.js");
const { islandFalloff } = await import("../src/terrain.js");

const ISLAND = { cx: 0, cz: 0, radius: 40, visualRadius: 46, shape: { kind: "round" } };

/** A rolling landscape with a low basin and a ridge, so habitat has a shape. */
function heightFn(x, z) {
  return (
    0.6 +
    Math.sin(x * 0.07) * 0.55 +
    Math.cos(z * 0.055) * 0.42 +
    Math.sin((x + z) * 0.021) * 0.7
  );
}

const worldState = {
  currentLayout: { centers: [ISLAND], boundRadius: 46 },
  world: new THREE.Group(),
  obstacles: [],
  heightFn,
};

const anchor = selectLivingWorldAnchor(worldState, 0x1e);
const plan = planLivingComposition(0x1e, anchor, { worldState, lowfx: false });

const distanceFromCentre = (entry) => Math.hypot(entry.x - ISLAND.cx, entry.z - ISLAND.cz);

// ---------------------------------------------------------------- anti-oasis
//
// The complaint this answers: 34 plants in three clumps at radius 4.4-5.5 from
// one anchor, on an island of radius ~46. Under 2% of the surface, which reads
// as a small oasis on an otherwise bare world.

assert.ok(
  plan.flora.length >= 120,
  `a field should populate the island, planned ${plan.flora.length}`,
);

const reach = Math.max(...plan.flora.map(distanceFromCentre));
assert.ok(
  reach > ISLAND.radius * 0.55,
  `growth should reach the island's outer half, furthest plant at ${reach.toFixed(1)}`,
);

// Not just a wider ring: content in every quadrant and at every band.
const quadrants = new Set(
  plan.flora.map(
    (entry) =>
      `${entry.x - ISLAND.cx >= 0 ? "e" : "w"}${entry.z - ISLAND.cz >= 0 ? "s" : "n"}`,
  ),
);
assert.equal(quadrants.size, 4, "every quadrant of the island should carry growth");

const bands = [0.25, 0.5, 0.75].map(
  (limit) =>
    plan.flora.filter((entry) => distanceFromCentre(entry) <= ISLAND.radius * limit)
      .length,
);
assert.ok(bands[0] > 0, "the inner island should carry growth");
assert.ok(bands[2] > bands[0] * 1.5, "growth should keep increasing outward, not ring one radius");

// ------------------------------------------------------------------ patches
//
// Composed, not sprinkled: distinct places with their own mixes.

assert.ok(plan.patches.length >= 4, "the island should be laid out as several places");
for (let a = 0; a < plan.patches.length; a++) {
  for (let b = a + 1; b < plan.patches.length; b++) {
    const gap = Math.hypot(
      plan.patches[a].x - plan.patches[b].x,
      plan.patches[a].z - plan.patches[b].z,
    );
    assert.ok(gap > 1, `patches ${a} and ${b} collapsed onto each other`);
  }
}
const patchesUsed = new Set(
  plan.flora.filter((entry) => entry.patch >= 0).map((entry) => entry.patch),
);
assert.ok(patchesUsed.size >= 3, "growth should be spread across patches, not pooled in one");

// ------------------------------------------------- the arrival clearing lives
//
// The anchor stays the hero's site and keeps its negative space, so the camera
// still has something composed to open on.

const heroes = plan.flora.filter((entry) => entry.role === "hero");
assert.ok(heroes.length >= 1, "the field needs a hero");
assert.equal(heroes[0].ordinal, 0);
assert.equal(heroes[0].x, anchor.x);
assert.equal(heroes[0].z, anchor.z);
for (const entry of plan.flora) {
  if (entry.ordinal === 0 && entry.role === "hero") continue;
  const gap = Math.hypot(entry.x - anchor.x, entry.z - anchor.z);
  assert.ok(gap >= 3.4, `a ${entry.role} landed ${gap.toFixed(2)} from the clearing`);
}

// ------------------------------------------------------------- usable ground
for (const entry of plan.flora) {
  assert.ok(Number.isFinite(entry.x) && Number.isFinite(entry.z));
  assert.ok(
    islandFalloff(ISLAND, entry.x, entry.z) >= 0.6,
    "nothing should be planted off the island's shoulder",
  );
  assert.ok(entry.habitat.min > -0.45, "nothing should be planted underwater");
  assert.ok(
    entry.habitat.slope <= (entry.role === "ground" ? 0.72 : 0.55),
    `a ${entry.role} landed on a ${entry.habitat.slope.toFixed(2)} slope`,
  );
  for (const axis of ["elevation", "slope", "edge"]) {
    assert.ok(
      entry.habitat[axis] >= 0 && entry.habitat[axis] <= 1,
      `habitat.${axis} should be normalized`,
    );
  }
}

// Habitat actually varies across the island — otherwise archetype preferences
// would be scoring against a constant and the placement would be a shuffle.
const elevations = plan.flora.map((entry) => entry.habitat.elevation);
assert.ok(
  Math.max(...elevations) - Math.min(...elevations) > 0.3,
  "placements should span a range of elevations",
);
// A reed and a spire must not want the same ground.
const low = { elevation: 0.05, slope: 0.05, edge: 0.4 };
const high = { elevation: 0.95, slope: 0.3, edge: 0.5 };
assert.ok(habitatScore("reed", low) > habitatScore("spire", low));
assert.ok(habitatScore("spire", high) > habitatScore("reed", high));

// ------------------------------------------------------------- determinism
const replay = planLivingComposition(0x1e, anchor, { worldState, lowfx: false });
assert.deepEqual(replay, plan, "the same seed must compose the same island");

const other = planLivingComposition(0x4a9b, anchor, { worldState, lowfx: false });
assert.notDeepEqual(
  other.patches.map((patch) => [patch.x, patch.z]),
  plan.patches.map((patch) => [patch.x, patch.z]),
  "a different seed should place its patches differently",
);

// Streams are namespaced per patch and role, so a patch's own position must
// not depend on how many plants any role happens to want.
assert.deepEqual(
  planLivingComposition(0x1e, anchor, { worldState, lowfx: true }).patches.slice(0, 3),
  plan.patches.slice(0, 3),
  "thinning the field must not move the patches it is drawn inside",
);

// ------------------------------------------------------------------- fauna
assert.ok(plan.fauna.length >= 2);
const homes = new Set(plan.fauna.map((entry) => `${entry.home.x},${entry.home.z}`));
assert.ok(
  homes.size > 1,
  "kin should be re-homed across the island, not all circling the clearing",
);
for (const entry of plan.fauna) {
  assert.ok(entry.orbitRadius > 0 && entry.orbitRadius <= ISLAND.radius * 0.42);
}

console.log("living-world-composition.test.mjs passed");
