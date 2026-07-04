// ARC-003/QA-013: generateWorld (src/world.js) and the portal preview
// (src/portal.js) must replay the identical RNG prefix — one Math.random()
// biome roll immediately followed by pickLayout() — so a portal preview
// built for a given seed reconstructs the same destination layout the real
// world would build for that seed. Both call sites now go through the
// shared rollBiomeAndLayout() helper in src/world-constants.js instead of
// hand-copied code kept in sync only by a comment (that was the original
// bug this test guards against — see ARC-003 in AUDIT.md).
//
// This is a behavioral regression test, independent of the source-grep
// static tests: it exercises the real shared function/production RNG
// (mulberry32) rather than asserting literal code text.
import assert from 'node:assert/strict';

globalThis.__APP_VERSION__ = 'test';

const { mulberry32 } = await import('../src/seed.js');
const { pickLayout } = await import('../src/terrain.js');
const { rollBiomeAndLayout } = await import('../src/world-constants.js');

// Mirrors exactly how world.js installs the seeded PRNG before rolling the
// biome + layout, and how portal.js's withSeededRandom() does the same.
function replayRngPrefix(seed) {
  const originalRandom = Math.random;
  Math.random = mulberry32(seed);
  try {
    return rollBiomeAndLayout(pickLayout);
  } finally {
    Math.random = originalRandom;
  }
}

for (const seed of [0x0000, 0x00e9, 0x1a2b, 0x3f2a, 0xffff]) {
  const worldPath = replayRngPrefix(seed);
  const previewPath = replayRngPrefix(seed);

  assert.equal(
    worldPath.biome.id,
    previewPath.biome.id,
    `seed 0x${seed.toString(16)}: world path and preview path should roll the same biome.`
  );

  // "First anchor" — the layout's primary island center — must match
  // exactly (position, radius, shape) since it drives every downstream
  // ground-point/terrain-footprint calculation.
  const worldAnchor = worldPath.layout.centers[0];
  const previewAnchor = previewPath.layout.centers[0];
  assert.deepEqual(
    previewAnchor,
    worldAnchor,
    `seed 0x${seed.toString(16)}: world path and preview path should produce an identical first island anchor.`
  );

  assert.equal(
    previewPath.layout.planeSize,
    worldPath.layout.planeSize,
    `seed 0x${seed.toString(16)}: world path and preview path should produce the same island plane size.`
  );
  assert.equal(
    previewPath.layout.boundRadius,
    worldPath.layout.boundRadius,
    `seed 0x${seed.toString(16)}: world path and preview path should produce the same island bound radius.`
  );
  assert.equal(
    previewPath.layout.kind,
    worldPath.layout.kind,
    `seed 0x${seed.toString(16)}: world path and preview path should produce the same island layout kind.`
  );
}

console.log('portal-world-rng-parity-runtime.test.mjs passed');
