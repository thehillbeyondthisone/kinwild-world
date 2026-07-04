// Protected invariant: grass rooted under placed flora is shortened via a
// spatial grid (not a per-blade scan of every flora circle), and the height
// scale fades smoothly from `shortenTo` back to 1 across each circle's edge.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.__APP_VERSION__ = 'test';

const { makeFloraShortGrassIndex, grassHeightScaleAt } = await import('../src/grass.js');

// World generation (grassRadius/GRASS_SHORTEN_MIN_HEIGHT/makeGrassField wiring)
// lives in src/world.js, owned by another QA-009 agent — kept as a source
// check here.
const worldSource = ["world.js","world/atmosphere.js","world/flora-placement.js","world/fauna-population.js","world/ground-cover.js","world/portal-placement.js"].map((p) => readFileSync(new URL("../src/" + p, import.meta.url), "utf8")).join("\\n");

// No circles -> no shortening anywhere.
const emptyIndex = makeFloraShortGrassIndex([]);
assert.equal(grassHeightScaleAt(0, 0, emptyIndex), 1, 'With no shortening circles, grass height should be unaffected.');

const circle = { x: 10, z: 10, r: 2, shortenTo: 0.3 };
const index = makeFloraShortGrassIndex([circle]);

assert.equal(
  grassHeightScaleAt(10, 10, index),
  0.3,
  'Grass at the flora exact center should be cut all the way to shortenTo.'
);

assert.equal(
  grassHeightScaleAt(50, 50, index),
  1,
  'Grass far outside a shortening circle should be unaffected.'
);

const nearEdgeScale = grassHeightScaleAt(10 + 1.9, 10, index); // t = 0.95, close to circle edge
assert(
  nearEdgeScale > 0.3 && nearEdgeScale < 1,
  'Grass near a shortening circle edge should smoothly fade back toward full height rather than snapping.'
);

const midScale = grassHeightScaleAt(10 + 1.0, 10, index); // t = 0.5
assert(
  midScale < nearEdgeScale,
  'Grass closer to the flora center should be shorter than grass closer to the circle edge.'
);

assert.equal(
  grassHeightScaleAt(10 + 2.0, 10, index),
  1,
  'Grass exactly at the circle radius should read as unshortened (strict interior-only comparison).'
);

assert.match(
  worldSource,
  /grassRadius:\s*grassShortenRadius/,
  'Flora placement should store a dedicated grass shortening radius instead of reusing canopy spacing.'
);

assert.match(
  worldSource,
  /const GRASS_SHORTEN_MIN_HEIGHT = 0\.14;/,
  'Grass rooted under placed flora should be cut to half of the previous 0.28 minimum height.'
);

assert.match(
  worldSource,
  /makeGrassField\(biome,\s*worldState\.heightFn,\s*coverExclusions,\s*grassShorteners(?:,\s*\w+)?\)/,
  'World generation should pass flora shortening circles into instanced grass placement.'
);
