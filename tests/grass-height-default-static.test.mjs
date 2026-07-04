import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const stateSource = readFileSync(new URL('../src/state.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');

assert(
  stateSource.includes('export const GRASS_HEIGHT_BASE = 0.96'),
  'GRASS_HEIGHT_BASE should be canonically defined once in src/state.js (20% lower than the previous 1.2 baseline).'
);

assert(
  stateSource.includes('grassHeight: GRASS_HEIGHT_BASE'),
  'Default grass height should use the canonical GRASS_HEIGHT_BASE constant.'
);

assert(
  uiSource.includes('GRASS_HEIGHT_BASE') && uiSource.includes('from "./state.js"'),
  'The grass height slider 100% baseline should import the canonical GRASS_HEIGHT_BASE from state.js instead of redeclaring it.'
);
