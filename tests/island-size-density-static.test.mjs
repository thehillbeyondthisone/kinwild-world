// Protected invariant: island size doubled (ISLAND_SIZE_BASE=100) while the
// flora/creature/ground-cover density anchor (DENSITY_BASE=76) stayed fixed,
// so absolute spawn counts don't double along with the bigger island.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.__APP_VERSION__ = 'test';

const { ISLAND_SIZE_BASE, ISLAND_RADIUS_BASE, DENSITY_BASE } = await import('../src/state.js');
const environmentSource = ["environment.js","environment/_shared.js","environment/particles.js","environment/swarms.js","environment/decals.js","environment/groundcover.js","environment/water.js"].map((p) => readFileSync(new URL("../src/" + p, import.meta.url), "utf8")).join("\n");
const grassSource = readFileSync(new URL('../src/grass.js', import.meta.url), 'utf8');
// Flora/creature count scaling itself lives in src/world.js, owned by
// another QA-009 agent — kept as a source check here.
const worldSource = readFileSync(new URL('../src/world.js', import.meta.url), 'utf8');

assert.equal(ISLAND_SIZE_BASE, 100, 'Base island size should be doubled through the shared island-size constant.');
assert.equal(
  ISLAND_RADIUS_BASE,
  ISLAND_SIZE_BASE * 0.462,
  'Base island radius should be derived from ISLAND_SIZE_BASE.'
);
assert.equal(
  DENSITY_BASE,
  76,
  'Density anchor should stay at the pre-doubling 76-unit base so creature/flora counts do not increase.'
);

assert(
  environmentSource.includes('state.ISLAND_SIZE / DENSITY_BASE'),
  'Ground cover should use the same density anchor as flora/creatures.'
);
assert(
  grassSource.includes('state.ISLAND_SIZE / DENSITY_BASE'),
  'Grass placement should use the same density anchor as flora/creatures.'
);

assert(
  worldSource.includes('const densityScale = worldState.ISLAND_SIZE / DENSITY_BASE;')
    && worldSource.includes('Math.round(biome.floraCount * densityScale)')
    && worldSource.includes('Math.round(randInt(...biome.creatureCount) * densityScale)'),
  'World generation should keep flora and creature budgets tied to DENSITY_BASE.'
);
