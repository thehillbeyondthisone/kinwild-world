import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const stateSource = readFileSync(new URL('../src/state.js', import.meta.url), 'utf8');
// Grass-density persistence lives in src/ui/storage.js (ARC-003 / QA-004 ui.js
// split); the GRASS_DENSITY_BASE constant itself is canonicalized in
// src/state.js and imported everywhere else (ARC-007) to avoid hand-duplicated
// baselines drifting apart.
const storageSource = readFileSync(new URL('../src/ui/storage.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const grassSource = readFileSync(new URL('../src/grass.js', import.meta.url), 'utf8');

assert(
  stateSource.includes('export const GRASS_DENSITY_BASE = 25'),
  'GRASS_DENSITY_BASE should be canonically defined once in src/state.js.'
);

assert(
  stateSource.includes('grassDensity: GRASS_DENSITY_BASE'),
  'Default grass density should use the canonical GRASS_DENSITY_BASE constant.'
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
  stateSource.includes('grassDensityBase: GRASS_DENSITY_BASE')
    && storageSource.includes('"grassDensityBase"')
    && storageSource.includes('const savedGrassDensityBase = Number(saved.grassDensityBase ?? 12.5);')
    && storageSource.includes('state.userSettings.grassDensity = saved.grassDensity * (GRASS_DENSITY_BASE / savedGrassDensityBase);')
    && storageSource.includes('state.userSettings.grassDensityBase = GRASS_DENSITY_BASE;'),
  'Saved grass-density settings should migrate from the previous baseline so existing users also get the doubled grass density.'
);

assert(
  grassSource.includes('const MAX_DENSITY_MULTIPLIER = 75'),
  'Grass field preallocation should match the density slider max of 300% × 25 = 75.'
);
