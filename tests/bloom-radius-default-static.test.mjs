// Protected invariant: the default bloom radius is 50% (0.5 internally),
// consistently between persisted state and the settings-panel markup.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.__APP_VERSION__ = 'test';

const { state } = await import('../src/state.js');
// index.html is static markup, not a JS module — there is no import-based
// way to assert its default slider value, so this half stays a text check.
const htmlSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.equal(
  state.userSettings.bloomRadius,
  0.5,
  'Default persisted bloom radius should start at 50%.'
);

assert(
  htmlSource.includes('id="setting-bloom-radius" min="0" max="300" step="1" value="50"')
    && htmlSource.includes('id="setting-bloom-radius-value">50%</span>'),
  'Bloom radius control should present 50% as the default UI value.'
);
