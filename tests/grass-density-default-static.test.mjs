// Protected invariant: GRASS_DENSITY_BASE (25) is defined once in state.js
// and reused (imported, not re-declared) everywhere a grass-density baseline
// is needed, including the density-slider preallocation headroom in grass.js.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.__APP_VERSION__ = 'test';

const { state, GRASS_DENSITY_BASE } = await import('../src/state.js');
const { MAX_DENSITY_MULTIPLIER } = await import('../src/grass.js');

// Persistence/migration logic and the slider wiring live in src/ui/storage.js
// and src/ui.js, both DOM-touching UI modules owned by another QA-009 agent —
// kept as source-text checks here.
const storageSource = readFileSync(new URL('../src/ui/storage.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');

assert.equal(
  GRASS_DENSITY_BASE,
  25,
  'GRASS_DENSITY_BASE should be canonically defined once in src/state.js.'
);

assert.equal(
  state.userSettings.grassDensity,
  GRASS_DENSITY_BASE,
  'Default grass density should use the canonical GRASS_DENSITY_BASE constant.'
);

assert.equal(
  state.userSettings.grassDensityBase,
  GRASS_DENSITY_BASE,
  'Persisted grassDensityBase should track the canonical constant so a future rebase can be detected.'
);

assert.equal(
  MAX_DENSITY_MULTIPLIER,
  75,
  'Grass field preallocation should match the density slider max of 300% × 25 = 75.'
);

assert(
  storageSource.includes('import { state, GRASS_DENSITY_BASE, GRASS_HEIGHT_BASE } from "../state.js"'),
  'ui/storage.js should import the canonical GRASS_DENSITY_BASE rather than redeclaring it.'
);

assert(
  uiSource.includes('GRASS_DENSITY_BASE') && uiSource.includes('from "./state.js"'),
  'ui.js should import GRASS_DENSITY_BASE from the canonical state.js source.'
);

assert(
  storageSource.includes('"grassDensityBase"')
    && storageSource.includes('const savedGrassDensityBase = Number(saved.grassDensityBase ?? 12.5);')
    && storageSource.includes('state.userSettings.grassDensity = saved.grassDensity * (GRASS_DENSITY_BASE / savedGrassDensityBase);')
    && storageSource.includes('state.userSettings.grassDensityBase = GRASS_DENSITY_BASE;'),
  'Saved grass-density settings should migrate from the previous baseline so existing users also get the doubled grass density.'
);
