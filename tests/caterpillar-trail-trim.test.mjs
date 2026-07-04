// Behavioral regression test for QA-003 (caterpillar trail ring buffer never
// trims). ringTrimByDistance previously scanned the arc[] array descending
// and returned at the first index exceeding maxDistance — since arc[] is
// monotonically non-decreasing from head (index 0) to tail, that index is
// always the second-to-last one, so tr.len was reassigned to itself every
// call. The audit measured ~3,850 retained points after one simulated minute
// against an intended ~3.4-unit cap.
//
// This test drives stepCaterpillar for a simulated minute on flat ground and
// asserts the underlying ring buffer's live length (c.trail.len) stabilizes
// near the caterpillar's own trailMaxDistance instead of growing unbounded.

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
const { makeCaterpillar, stepCaterpillar } = await import('../src/fauna.js');

const biome = BIOMES.find((b) => !b.noCaterpillars && !b.water) ?? BIOMES[0];

const flatHeightFn = () => 0;

const c = makeCaterpillar(biome, {});

// A caterpillar's ring buffer is seeded with 250 points at construction
// (see makeRingTrail seeding in caterpillar.js), so len starts well above
// trailMaxDistance's expected steady-state count. Step the sim forward one
// simulated minute at a fixed 60fps timestep — long enough that, under the
// pre-fix no-op trim, the ring buffer would have grown into the thousands
// (the audit measured ~3,850).
const dt = 1 / 60;
const totalSeconds = 60;
const steps = Math.round(totalSeconds / dt);

let maxLenAfterWarmup = 0;
const warmupSteps = Math.round(5 / dt); // let the trail reach steady state first
for (let i = 0; i < steps; i++) {
  stepCaterpillar(c, dt, i * dt, flatHeightFn);
  if (i >= warmupSteps) {
    maxLenAfterWarmup = Math.max(maxLenAfterWarmup, c.trail.len);
  }
}

assert.ok(
  c.trailMaxDistance > 0,
  'caterpillar should have a positive trailMaxDistance cap.'
);

// Steady-state point count depends on per-frame travel distance and cannot
// be pinned exactly (segment count and speed are randomized per instance),
// but it must stay small and bounded — nowhere near the ~3,850 unbounded
// growth the audit measured. Generously allow up to a few hundred points.
assert.ok(
  maxLenAfterWarmup < 500,
  `expected trail ring length to stay bounded near trailMaxDistance after warmup, got ${maxLenAfterWarmup} (unbounded growth would reach thousands within a minute).`
);

// The retained arc span (arc[len-1], distance from head to the oldest kept
// point) should be close to trailMaxDistance, not far beyond it — proving
// the trim is actually cutting near the cap rather than merely capping
// buffer growth by coincidence (e.g. via the array's own resize doubling).
const retainedArc = c.trail.arc[c.trail.len - 1];
assert.ok(
  retainedArc <= c.trailMaxDistance * 1.5,
  `expected retained trail arc length (${retainedArc}) to stay close to trailMaxDistance (${c.trailMaxDistance}).`
);

console.log('caterpillar-trail-trim.test.mjs passed:', {
  trailMaxDistance: c.trailMaxDistance,
  maxLenAfterWarmup,
  retainedArc,
});
