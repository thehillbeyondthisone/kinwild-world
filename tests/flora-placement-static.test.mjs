// QA-009: CANOPY_SPACING_KINDS / CANOPY_SPACING_PAD are pure data hoisted to
// module scope and exported from src/world.js (previously local consts
// inside generateWorld), so this test imports and asserts them directly
// instead of extracting a Set literal from the middle of that function's
// source text. The two call-site checks below (that generateWorld actually
// applies the wider spacing before placing flora and reserves the matching
// radius for later canopy checks) are structural facts about a specific
// ~2000-line async generator's body and stay as targeted source-text
// assertions.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.__APP_VERSION__ = 'test';
globalThis.performance = { now: () => 0 };

const worldSource = ["world.js","world/atmosphere.js","world/flora-placement.js","world/fauna-population.js","world/ground-cover.js","world/portal-placement.js"].map((p) => readFileSync(new URL("../src/" + p, import.meta.url), "utf8")).join("\\n");

const { CANOPY_SPACING_KINDS, CANOPY_SPACING_PAD } = await import('../src/world.js');

// Protected invariant: tree-like and berry-bush flora (broad canopies/crowns
// on small bases) reserve a wider placement radius than their footprint so
// silhouettes don't intersect.
assert(
  CANOPY_SPACING_KINDS.has('tree')
    && CANOPY_SPACING_KINDS.has('leafballtree')
    && CANOPY_SPACING_KINDS.has('pine')
    && CANOPY_SPACING_KINDS.has('berrybush'),
  'Tree and berry bush flora should share broad spacing so their visible masses do not overlap.'
);
assert.equal(CANOPY_SPACING_PAD, 2.8, 'Canopy spacing pad should widen the placement radius beyond the root footprint.');

assert(
  worldSource.includes('blocksFloraPlacement(p.x, p.z, fp * CANOPY_SPACING_PAD, CANOPY_SPACING_KINDS)'),
  'Broad visual flora spacing should be checked before building the flora mesh.'
);

assert(
  worldSource.includes('r: fp * (CANOPY_SPACING_KINDS.has(kind) ? CANOPY_SPACING_PAD : 1.2)'),
  'Broad-spaced flora should reserve the same radius that future broad flora checks use.'
);
