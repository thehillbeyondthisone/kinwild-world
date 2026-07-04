// Protected invariant: GRASS_HEIGHT_BASE (0.96) is defined once in state.js
// and reused as the grass-height slider's 100% baseline.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.__APP_VERSION__ = 'test';

const { state, GRASS_HEIGHT_BASE } = await import('../src/state.js');

// The slider wiring lives in src/ui.js, a DOM-touching UI module owned by
// another QA-009 agent — kept as a source check here.
const uiSource = readFileSync(new URL('../src/ui/settings-panel.js', import.meta.url), 'utf8');

assert.equal(
  GRASS_HEIGHT_BASE,
  0.96,
  'GRASS_HEIGHT_BASE should be canonically defined once in src/state.js (20% lower than the previous 1.2 baseline).'
);

assert.equal(
  state.userSettings.grassHeight,
  GRASS_HEIGHT_BASE,
  'Default grass height should use the canonical GRASS_HEIGHT_BASE constant.'
);

assert(
  uiSource.includes('GRASS_HEIGHT_BASE') && uiSource.includes('from "../state.js"'),
  'The grass height slider 100% baseline should import the canonical GRASS_HEIGHT_BASE from state.js instead of redeclaring it.'
);
