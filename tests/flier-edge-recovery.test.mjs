// Behavioral regression test (audit QA-009) for flier island-edge recovery.
// Protects the invariant that a flier already beyond the island's plane
// bound is allowed to commit an inward step (rather than freezing in place)
// as long as that step reduces its distance to the island center, and that
// this recovery applies across every airborne landState (flying, descending,
// ascending) — not just "flying".

import assert from 'node:assert/strict';

globalThis.__APP_VERSION__ = 'test';
globalThis.window = {
  location: { search: '' },
  matchMedia: () => ({ matches: false }),
};
Object.defineProperty(globalThis, 'navigator', {
  value: { maxTouchPoints: 0 },
  configurable: true,
});

const { BIOMES } = await import('../src/biomes.js');
const { makeCreature, stepCreature } = await import('../src/fauna/creature.js');
const { state } = await import('../src/state.js');

const biome = BIOMES.find((b) => b.creatureKind !== 'fish') ?? BIOMES[0];

const originalRandom = Math.random;
Math.random = () => 0; // forces flies = true (0 < 0.15) deterministically
const flier = makeCreature(biome, {});
Math.random = originalRandom;

assert.equal(flier.flies, true, 'test setup requires a flying creature');
assert.equal(flier.isFish, false, 'test setup requires a non-fish flier (fish take a separate recovery path)');

const planeBound = state.ISLAND_SIZE * 0.46;
const flatHeightFn = () => 0;

for (const landState of ['flying', 'descending', 'ascending']) {
  flier.landState = landState;
  flier.landTimer = 999; // keep stepFlier from transitioning landState mid-test
  flier.sleepiness = 0;
  flier.nextThink = 999; // suppress the random "think" jitter this frame
  flier.pauseUntil = 0;
  flier.perchTarget = null;

  // Place the flier well beyond the island's plane bound, heading straight
  // back toward the center — the forward step is strictly inward.
  const startX = planeBound + 5;
  flier.group.position.set(startX, flier.hoverHeight, 0);
  flier.heading = Math.PI;

  stepCreature(flier, 0.1, 1, flatHeightFn);

  assert.ok(
    flier.group.position.x < startX,
    `a flier already beyond the island edge in landState="${landState}" should commit its inward movement instead of freezing outside`
  );
}
