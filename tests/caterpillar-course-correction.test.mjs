// Behavioral regression test (audit QA-009) for caterpillar obstacle course
// correction. Protects the invariant that when the head's obstacle-avoidance
// pass produces a `slide`, stepCaterpillar retargets c.headingTarget and lets
// the normal per-frame turnRate slew catch c.heading up gradually — it must
// never snap c.heading straight to the slide heading, which would jerk the
// head before the trailing body segments could follow.

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
const { state } = await import('../src/state.js');
const { buildObstacleGrid, wrapAngle } = await import('../src/fauna/shared.js');

const biome = BIOMES.find((b) => !b.noCaterpillars && !b.water) ?? BIOMES[0];
const flatHeightFn = () => 0;

const c = makeCaterpillar(biome, {});
c.heading = 0;
c.headingTarget = 0;
c.nextThink = 999; // suppress the random "think" retarget this frame
const head = c.segments[0];
head.position.set(0, 0, 0);

// Place a single static obstacle directly ahead of the head so this frame's
// forward step collides with it, forcing avoidObstacles() to return a slide
// with a heading far from the caterpillar's current heading (0).
const dt = 0.1;
const step = c.speed * dt;
state.obstacles = [{ x: step, z: 0.05, r: 0.5, top: 5 }];
buildObstacleGrid(state.obstacles);

stepCaterpillar(c, dt, 0, flatHeightFn);

const maxTurn = c.turnRate * dt;
const headingDrift = Math.abs(wrapAngle(c.heading - 0));
const targetJump = Math.abs(wrapAngle(c.headingTarget - 0));

assert.ok(
  targetJump > maxTurn * 2,
  `expected the obstacle hit to retarget headingTarget by more than one frame's slew cap (got ${targetJump}, cap ${maxTurn})`
);

assert.ok(
  headingDrift <= maxTurn + 1e-9,
  `expected c.heading to only slew by up to turnRate*dt (${maxTurn}) this frame, got ${headingDrift} — a bigger drift means it snapped instead of slewing`
);

assert.notEqual(
  c.heading,
  c.headingTarget,
  'c.heading should not have been snapped directly to the slide heading on the same frame'
);

console.log('caterpillar-course-correction.test.mjs passed:', {
  maxTurn,
  headingDrift,
  targetJump,
});
