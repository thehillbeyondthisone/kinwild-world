// QA-009: ui.js's first-person mode predicates (isFlyMode/isAnyFP/etc.) are
// plain exported functions over module-scope state and can be imported and
// called directly under plain node (ui.js's DOM wiring lives inside
// initUi(), not at module load time — see CLAUDE.md). This test exercises
// their default (uninitialized) behavior for real instead of grepping their
// declarations. enterFlyMode()/exitFlyMode() and the global keydown handler
// are closures created inside initUi() and require a full browser DOM
// (OrbitControls, canvas, keyboard events) to exercise, so those and the
// main.js/index.html wiring stay as source-text assertions.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.__APP_VERSION__ = 'test';
// Minimal window/document stubs so importing ui.js doesn't throw — its DOM
// wiring lives inside initUi(), which this test never calls, but module-load
// side effects (inspect.js's URL-param read, storage.js's localStorage read)
// still need these globals to exist.
globalThis.window = {
  location: { search: '' },
  localStorage: { getItem() { return null; }, setItem() {} },
};
globalThis.document = { getElementById() { return null; } };
globalThis.localStorage = globalThis.window.localStorage;

const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const { isFlyMode, isAnyFP, isStrolling, isPhotoFP } = await import('../src/ui.js');

// Protected invariant: main-view fly mode is tracked as its own first-person
// state, distinct from stroll/photo mode, and starts uninitialized (module
// load happens before initUi() ever runs).
assert.equal(isFlyMode(), false, 'fly mode should be off until enterFlyMode() runs');
assert.equal(isAnyFP(), false, 'no first-person mode should be active before initUi()');
assert.equal(isStrolling(), false, 'stroll should be off until entered');
assert.equal(isPhotoFP(), false, 'photo first-person should be off until entered');

assert(
  uiSource.includes('let _flyFP = null;')
    && uiSource.includes('export function isFlyMode()')
    && uiSource.includes('return _flyFP !== null;')
    && uiSource.includes('return _stroll !== null || _flyFP !== null || _photoFP !== null;'),
  'ui.js should track main-view fly mode as a first-person camera state distinct from stroll and photo mode.'
);

assert(
  uiSource.includes('function enterFlyMode()')
    && uiSource.includes('function exitFlyMode()')
    && uiSource.includes('controls.enabled = false;')
    && uiSource.includes('controls.enabled = true;')
    && uiSource.includes('fly: true,')
    && uiSource.includes('keys: { w: false, a: false, s: false, d: false, shift: false, e: false, q: false }'),
  'Main-view fly mode should disable OrbitControls, use free-flight movement, and restore orbit controls on exit.'
);

assert(
  uiSource.includes('e.key === "v" || e.key === "V"')
    && uiSource.includes('if (_flyFP) exitFlyMode();')
    && uiSource.includes('else enterFlyMode();')
    && uiSource.includes('if (_flyFP) exitFlyMode();'),
  'The global keyboard handler should toggle main-view fly mode with V and let Escape exit it.'
);

assert(
  mainSource.includes('isFlyMode,')
    && mainSource.includes('return state.userSettings.tiltShift && !isStrolling() && !isFlyMode() && !getFollowTarget();'),
  'main.js should treat main-view fly mode as first-person for tilt-shift gating.'
);

assert(
  indexSource.includes('id="setting-fly-mode"')
    && indexSource.includes('fly camera')
    && indexSource.includes('<kbd>v</kbd> toggles fly camera')
    && indexSource.includes('<kbd>e</kbd>/<kbd>q</kbd> rise or descend')
    && indexSource.includes('<dt><kbd>v</kbd></dt><dd>toggle fly camera.</dd>'),
  'Help and camera settings should document the V fly-mode toggle and free-flight controls.'
);
