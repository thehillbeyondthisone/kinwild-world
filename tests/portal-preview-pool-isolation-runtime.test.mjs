// QA-001/QA-002: portal previews build flora/creature resources against an
// isolated pool (src/flora/_shared.js withIsolatedFloraPool, src/fauna/
// creature.js withIsolatedCreaturePool) instead of the shared per-regen pool,
// so a preview built with a different target biome can never leave a
// wrong-palette entry that the live world later renders from. This is a
// behavioral regression test for that isolation, independent of the
// source-grep static tests.
import assert from 'node:assert/strict';

globalThis.__APP_VERSION__ = 'test';
globalThis.window = {
  location: { search: '' },
  devicePixelRatio: 1,
  innerWidth: 1280,
  innerHeight: 720,
  addEventListener() {},
  dispatchEvent() {},
};
globalThis.document = {
  getElementById() {
    return {
      textContent: '',
      style: {},
      classList: { add() {}, remove() {}, toggle() {} },
    };
  },
  createElement() {
    return { getContext() { return null; }, style: {} };
  },
  body: { classList: { contains() { return false; } } },
};
globalThis.performance = { now: () => 0 };

const { withIsolatedFloraPool, resetFloraPool } = await import('../src/flora.js');
const floraShared = await import('../src/flora/_shared.js');
const { withIsolatedCreaturePool, creaturePoolResources, makeCreature, resetCreaturePool } = await import('../src/fauna.js');
const { BIOMES } = await import('../src/biomes.js');

// --- Flora pool isolation ---
resetFloraPool();
const sharedValue = { tag: 'shared-biome-material' };
const sharedResult = floraShared.pooled('shared.key', () => sharedValue);
assert.equal(sharedResult, sharedValue, 'Baseline pooled() call should populate the shared per-regen pool.');

let isolatedSawFreshFactory = false;
withIsolatedFloraPool((isolatedPool) => {
  const isolatedValue = floraShared.pooled('shared.key', () => {
    isolatedSawFreshFactory = true;
    return { tag: 'preview-biome-material' };
  });
  assert.notEqual(
    isolatedValue,
    sharedValue,
    'A preview build must not read the shared pool\'s cached entry for the same key.'
  );
  assert.ok(
    [...isolatedPool.values()].includes(isolatedValue),
    'The isolated pool passed to the callback should contain the preview-built resource.'
  );
});
assert.ok(isolatedSawFreshFactory, 'The isolated pool should invoke its own factory rather than reusing the shared pool\'s cached value.');

const afterPreviewResult = floraShared.pooled('shared.key', () => ({ tag: 'should-not-run' }));
assert.equal(
  afterPreviewResult,
  sharedValue,
  'After the preview build finishes, the shared pool\'s original entry must be untouched (no cross-biome contamination).'
);

// --- Creature pool isolation, end-to-end with the real makeCreature builder ---
// Mirrors the QA-001 scenario: a "real world" creature built with biome A,
// then a "portal preview" creature built with biome B while an isolated pool
// is active, then another "real world" creature built with biome A again —
// the third build must reuse the FIRST build's pooled eye material, not
// anything the preview build cached.
resetCreaturePool();
const biomeA = BIOMES[0];
const biomeB = BIOMES.find((b) => b.id !== biomeA.id) ?? BIOMES[1];

const realCreature1 = makeCreature(biomeA).group;
// Find a pooled material on the built group by cross-referencing the pool's
// own resource snapshot — resilient to unrelated changes in child/material
// ordering (belly, fur shells, etc. also allocate SphereGeometry meshes but
// are NOT pooled).
function findPooledMaterial(group, poolResources) {
  let found = null;
  group.traverse((o) => {
    if (!found && o.material && poolResources.has(o.material)) found = o.material;
  });
  return found;
}
const eyeMat1 = findPooledMaterial(realCreature1, creaturePoolResources());
assert.ok(eyeMat1, 'Real-world creature build should produce a traversable pooled material.');

const beforeSnapshot = creaturePoolResources();
assert.ok(beforeSnapshot.has(eyeMat1), 'The shared creature pool should hold the real-world build\'s eye material.');

withIsolatedCreaturePool((isolatedPool) => {
  const previewCreature = makeCreature(biomeB).group;
  const previewMat = findPooledMaterial(previewCreature, new Set(isolatedPool.values()));
  assert.ok(previewMat, 'Preview creature build should produce a material cached in the isolated pool.');
  assert.notEqual(
    previewMat,
    eyeMat1,
    'A portal preview creature build must not reuse the shared pool\'s cached material.'
  );
});

const realCreature2 = makeCreature(biomeA).group;
const eyeMat2 = findPooledMaterial(realCreature2, creaturePoolResources());
assert.equal(
  eyeMat2,
  eyeMat1,
  'After the preview build finishes, subsequent real-world creatures must keep reusing the original shared pool entry (no contamination, no premature disposal).'
);

console.log('portal-preview-pool-isolation-runtime.test.mjs passed');
