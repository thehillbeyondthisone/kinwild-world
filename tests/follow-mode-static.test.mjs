// QA-009: this file asserts the ABSENCE of a removed feature (transient
// creature-click focus) rather than a positive behavior with a return value
// to assert on, and the code paths it checks live inside ui.js's initUi()
// closures, which require a full browser DOM to invoke. There is no pure
// logic to extract here, so it stays a source-text assertion.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const helpSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert(
  !uiSource.includes('setFollowTarget(creature, { transient: true })'),
  'Direct creature clicks should start persistent follow, not transient focus.'
);
assert(
  !uiSource.includes('TRANSIENT_FOCUS_MS'),
  'Follow mode should not auto-release after a fixed transient timeout.'
);
assert(
  !helpSource.includes('for a few seconds of close camera focus'),
  'Help text should not describe creature clicks as temporary focus.'
);
