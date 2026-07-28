import assert from "node:assert/strict";
import * as THREE from "three";

globalThis.__APP_VERSION__ = "test";

const {
  GENERATED_FAUNA_MAX_INFLUENCES,
  GENERATED_FAUNA_MAX_PRIMITIVES,
  influenceCountFor,
  normalizeWalkerDNA,
  primitiveCountFor,
} = await import("../src/generated-fauna/dna.js");
const { createFlatSurfaceSampler, createGeneratedFaunaWalker } = await import(
  "../src/generated-fauna/walker.js"
);
const { FLIER_NEEDS, createKinNeeds } = await import(
  "../src/living-world/kin-goals.js"
);

// ------------------------------------------------------------------ genome
{
  const walker = normalizeWalkerDNA({});
  assert.equal(walker.dna.locomotion, "walker");
  assert.equal(walker.dna.wings, undefined, "a walker carries no wing block");
  assert.deepEqual(walker.repairs, [], "the curated default needs no repair");

  const flier = normalizeWalkerDNA({ locomotion: "flier" });
  assert.equal(flier.dna.locomotion, "flier");
  assert.ok(flier.dna.wings, "a flier carries wings");
  assert.deepEqual(flier.repairs, []);
  assert.equal(
    flier.primitiveCount,
    primitiveCountFor(flier.dna.legs.count, "flier"),
  );
  assert.ok(
    flier.primitiveCount > primitiveCountFor(flier.dna.legs.count, "walker"),
    "wings cost primitives",
  );
}

// An unknown locomotion repairs rather than throwing.
{
  const repaired = normalizeWalkerDNA({ locomotion: "swimmer" });
  assert.equal(repaired.dna.locomotion, "walker");
  assert.ok(repaired.repairs.some((entry) => entry.startsWith("locomotion:")));
}

// The influence budget, not taste, is what caps a flier's legs. Six legs plus
// two wings would need ten entries in the body's influence list against eight.
{
  assert.ok(
    influenceCountFor(6, "flier") + 1 > GENERATED_FAUNA_MAX_INFLUENCES,
    "six legs and wings must not fit, or this cap is meaningless",
  );
  const capped = normalizeWalkerDNA({ locomotion: "flier", legs: { count: 6 } });
  assert.equal(capped.dna.legs.count, 4);
  assert.ok(capped.primitiveCount <= GENERATED_FAUNA_MAX_PRIMITIVES);
  assert.ok(
    influenceCountFor(capped.dna.legs.count, "flier") + 1 <=
      GENERATED_FAUNA_MAX_INFLUENCES,
  );
}

// Wings are held against the body they hang from, not against absolutes.
{
  const stubby = normalizeWalkerDNA({
    locomotion: "flier",
    body: { radius: 0.16 },
    wings: { span: 0.95, chord: 0.34 },
  });
  assert.ok(
    stubby.dna.wings.span <= stubby.dna.body.radius * 2.6 + 1e-9,
    "a wing wider than the body reads as a glider, not a kinling",
  );
  assert.ok(stubby.dna.wings.chord <= stubby.dna.wings.span * 0.42 + 1e-9);
  assert.ok(stubby.repairs.some((entry) => entry.startsWith("wings.")));
}

// -------------------------------------------------------------------- rig
const surface = createFlatSurfaceSampler(0);

function drive(agent, seconds, intent, from = 0) {
  const steps = Math.round(seconds * 60);
  for (let step = 0; step < steps; step++) {
    agent.update({
      dt: 1 / 60,
      time: from + step / 60,
      intent: typeof intent === "function" ? intent(step / 60) : intent,
    });
  }
}

{
  const flier = createGeneratedFaunaWalker({
    dna: { locomotion: "flier", speciesId: "test-flier" },
    surface,
    position: { x: 0, z: 0 },
  });
  assert.equal(flier.traits.airborne, true);
  assert.equal(flier.traits.locomotion, "flier");
  assert.equal(flier.flies, true);
  assert.equal(
    flier.shell.primitives.length,
    primitiveCountFor(flier.dna.legs.count, "flier"),
  );

  // Hover is eased, not snapped — a landing has to be able to read as one.
  drive(flier, 0.05, { position: { x: 0, z: 0 }, hover: 2 });
  const early = flier.root.position.y;
  assert.ok(early > 0 && early < 2, `hover should ease in, got ${early}`);
  drive(flier, 4, { position: { x: 0, z: 0 }, hover: 2 }, 0.05);
  assert.ok(
    Math.abs(flier.root.position.y - 2) < 0.05,
    `hover should settle at its target, got ${flier.root.position.y}`,
  );

  // Airborne, the feet draw in under the body. Height alone proves nothing —
  // the root is at hover height, so anything hanging off it is off the ground
  // whether it tucked or not. The tuck is the horizontal draw-in.
  const spread = () => {
    const feet = flier.debug.feet();
    const centre = flier.root.position;
    return (
      feet.reduce(
        (sum, foot) =>
          sum + Math.hypot(foot.planted[0] - centre.x, foot.planted[2] - centre.z),
        0,
      ) / feet.length
    );
  };
  const airborneSpread = spread();

  // Landing puts it back down.
  drive(flier, 6, { position: { x: 0, z: 0 }, hover: 0 }, 5);
  assert.ok(
    Math.abs(flier.root.position.y) < 0.02,
    `a landed flier should be on the ground, got ${flier.root.position.y}`,
  );
  const landedFeet = flier.debug.feet().map((foot) => foot.planted[1]);
  assert.ok(
    landedFeet.every((y) => Math.abs(y) < 0.12),
    `landed feet should be planted, got ${landedFeet.join(", ")}`,
  );
  assert.ok(
    airborneSpread < spread() * 0.85,
    `feet should draw in under the body in flight — ` +
      `airborne ${airborneSpread.toFixed(3)} vs landed ${spread().toFixed(3)}`,
  );

  // The wings move. Sampling two phases of one beat has to differ.
  const wingBase = 2 + flier.dna.legs.count * 2;
  const beatPeriod = 1 / flier.dna.wings.beat;
  drive(flier, 3, { position: { x: 0, z: 0 }, hover: 2 }, 20);
  const first = flier.shell.primitives[wingBase].position.clone();
  drive(flier, beatPeriod * 0.5, { position: { x: 0, z: 0 }, hover: 2 }, 23);
  const second = flier.shell.primitives[wingBase].position.clone();
  assert.ok(
    first.distanceTo(second) > 0.01,
    "wings should beat while airborne",
  );

  assert.throws(
    () => flier.setIntent({ hover: -1 }),
    /hover/,
    "a negative hover is a caller bug, not something to clamp silently",
  );
  flier.dispose();
}

// A walker is untouched by any of this.
{
  const walker = createGeneratedFaunaWalker({
    dna: { speciesId: "test-walker" },
    surface,
    position: { x: 0, z: 0 },
  });
  assert.equal(walker.traits.airborne, false);
  assert.equal(walker.flies, false);
  // Hover is ignored on something that cannot fly.
  drive(walker, 2, { position: { x: 0, z: 0 }, hover: 3 });
  assert.ok(
    Math.abs(walker.root.position.y) < 1e-6,
    `a walker handed a hover should stay planted, got ${walker.root.position.y}`,
  );
  const feet = walker.debug.feet().map((foot) => foot.planted[1]);
  assert.ok(feet.every((y) => Math.abs(y) < 0.12), "walker feet stay planted");
  walker.dispose();
}

// The shell's local bounds have to contain the upstroke, or the blend field
// is evaluated in a box the wing tip leaves.
{
  const flier = createGeneratedFaunaWalker({
    dna: { locomotion: "flier", speciesId: "bounds-flier", wings: { span: 0.9, dihedral: 0.6 } },
    surface,
    position: { x: 0, z: 0 },
  });
  const wingBase = 2 + flier.dna.legs.count * 2;
  const bounds = new THREE.Box3().copy(flier.shell.mesh.geometry.boundingBox ?? new THREE.Box3());
  let escaped = 0;
  for (let step = 0; step < 240; step++) {
    flier.update({ dt: 1 / 60, time: step / 60, intent: { position: { x: 0, z: 0 }, hover: 2 } });
    for (let wing = 0; wing < 2; wing++) {
      const tip = flier.shell.primitives[wingBase + wing].position;
      if (!bounds.isEmpty() && !bounds.containsPoint(tip)) escaped++;
    }
  }
  assert.equal(escaped, 0, "a beating wing should stay inside the shell's local bounds");
  flier.dispose();
}

// ------------------------------------------------------------------ needs
{
  const flier = createKinNeeds(0, "flier");
  const walker = createKinNeeds(0, "walker");
  assert.notDeepEqual(
    Object.keys(flier.levels).sort(),
    Object.keys(walker.levels).sort(),
    "winged kin should not want the same things a walker wants",
  );
  assert.ok("perch" in flier.levels, "a flier wants somewhere to perch");
  assert.equal("perch" in walker.levels, false, "a walker cannot perch");
  // A perch visit is the long one: the landing only reads if it lasts.
  const perch = FLIER_NEEDS.find((need) => need.key === "perch");
  assert.ok(perch.dwell[0] >= 5, "a perch should be sat on, not touched");
  assert.ok(
    flier.maxTravel > walker.maxTravel,
    "a flier ranges further than a walker",
  );
  assert.ok(
    flier.minTravel > walker.minTravel,
    "a flier's journeys are longer than a walker's",
  );
}

console.log("generated-fauna-flier.test.mjs passed");
