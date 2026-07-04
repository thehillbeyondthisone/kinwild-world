// Protected invariants:
// - rendererPixelRatioCap() forces DPR 1 on mobile viewports regardless of
//   the LOWFX/MIDFX desktop caps (2 / 1.5).
// - stepShadowDisks culls contact-shadow discs beyond CONTACT_SHADOW_LOD_DISTANCE
//   from the active camera/focus point, but skips culling entirely when no
//   focus is given.
// - Verdant grove opts into static shadow-caster LOD via BIOMES data.
//
// main.js/ui.js (renderer setup, orbit framing) and world.js
// (applyStaticShadowLod) are owned by another QA-009 agent and stay as
// source-text checks.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.__APP_VERSION__ = 'test';

const { BIOMES } = await import('../src/biomes.js');
const { rendererPixelRatioCap, isMobileViewport } = await import('../src/lowfx.js');
const { state } = await import('../src/state.js');
const { CONTACT_SHADOW_LOD_DISTANCE, stepShadowDisks } = await import('../src/shadows.js');

const mainSource = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const uiSource = ["ui.js","ui/context.js","ui/constants.js","ui/storage.js","ui/settings-panel.js","ui/help-panel.js","ui/catalog-panel.js","ui/locator-panel.js","ui/first-person.js","ui/photo-mode.js","ui/input.js"].map((p) => readFileSync(new URL("../src/" + p, import.meta.url), "utf8")).join("\n");
const worldSource = readFileSync(new URL('../src/world.js', import.meta.url), 'utf8');

// --- rendererPixelRatioCap / isMobileViewport -------------------------------

delete globalThis.window;
assert.equal(
  rendererPixelRatioCap(),
  2,
  'Desktop (no window / no mobile signal) should keep the default DPR cap of 2.'
);

globalThis.window = {
  location: { search: '?mobile=1' },
  innerWidth: 400,
  innerHeight: 800,
  matchMedia: () => ({ matches: true }),
};
assert.equal(isMobileViewport(), true, 'A coarse-pointer, forced-mobile viewport should be detected as mobile.');
assert.equal(
  rendererPixelRatioCap(),
  1,
  'A mobile viewport should force the DPR cap to 1, overriding the desktop default.'
);
delete globalThis.window;

// --- stepShadowDisks contact-shadow LOD -------------------------------------

function makeFakeDisks(cap) {
  const matrices = new Array(cap).fill(null);
  return {
    userData: { capacity: cap, prevActive: cap },
    setMatrixAt(i, m) {
      matrices[i] = m.clone();
    },
    instanceMatrix: { needsUpdate: false },
    matrices,
  };
}
function isZeroScale(matrix) {
  return matrix.elements[0] === 0 && matrix.elements[5] === 0 && matrix.elements[10] === 0;
}

const heightFn = () => 0;
state.creatures = [
  { group: { visible: true, position: { x: 0, z: 0 } }, scale: 1, flies: false },
  { group: { visible: true, position: { x: CONTACT_SHADOW_LOD_DISTANCE + 5, z: 0 } }, scale: 1, flies: false },
];
state.caterpillars = [];

const focusedDisks = makeFakeDisks(4);
stepShadowDisks(focusedDisks, heightFn, { x: 0, z: 0 });
assert(
  !isZeroScale(focusedDisks.matrices[0]),
  'A creature within CONTACT_SHADOW_LOD_DISTANCE of the focus should get a real shadow disc.'
);
assert(
  isZeroScale(focusedDisks.matrices[1]),
  'A creature beyond CONTACT_SHADOW_LOD_DISTANCE of the focus should be culled to a zero-scale disc.'
);

const unfocusedDisks = makeFakeDisks(4);
stepShadowDisks(unfocusedDisks, heightFn, null);
assert(
  !isZeroScale(unfocusedDisks.matrices[0]) && !isZeroScale(unfocusedDisks.matrices[1]),
  'With no focus given, contact-shadow LOD culling should be skipped entirely.'
);

// --- Verdant grove static shadow LOD opt-in ---------------------------------

const verdantGrove = BIOMES.find((biome) => biome.id === 'verdant');
assert(verdantGrove, 'Verdant grove biome should exist.');
assert.equal(
  verdantGrove.shadowLod?.staticCasterRadiusFrac,
  0.55,
  'Verdant grove should opt into static shadow caster LOD so larger islands do not shadow-map every far prop.'
);

// --- Remaining checks in files owned by another QA-009 agent ---------------

assert(
  mainSource.includes('rendererPixelRatioCap')
    && mainSource.includes('renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, rendererPixelRatioCap()));')
    && uiSource.includes('rendererPixelRatioCap')
    && uiSource.includes('renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, rendererPixelRatioCap()));'),
  'Initial renderer setup and resize handling should use the same mobile-aware pixel ratio cap.'
);

assert(
  mainSource.includes('function frameDefaultOrbitToIsland()')
    && mainSource.includes('state.currentLayout?.boundRadius')
    && mainSource.includes('const scale = Math.max(1, radius / DEFAULT_ORBIT_RADIUS_ANCHOR) * DEFAULT_ORBIT_CLOSENESS;')
    && mainSource.includes('controls.maxDistance = Math.max(DEFAULT_ORBIT_MAX_DISTANCE, radius * 2.4);')
    && mainSource.includes('frameDefaultOrbitToIsland();')
    && mainSource.indexOf('frameDefaultOrbitToIsland();') < mainSource.indexOf('enterPortalArrivalIfRequested();'),
  'Default orbit should frame the generated island from its actual layout radius before portal arrival overrides can run.'
);

assert(
  mainSource.includes('const contactShadowFocus = isAnyFP() ? camera.position : controls.target;')
    && mainSource.includes('stepShadowDisks(state.shadowDisks, state.heightFn, contactShadowFocus);'),
  'The animation loop should drive contact-shadow culling from the active camera/focus target.'
);

assert(
  worldSource.includes('function applyStaticShadowLod(worldState, biome)')
    && worldSource.includes('staticCasterRadiusFrac')
    && worldSource.includes('object.castShadow = false;')
    && worldSource.includes('applyStaticShadowLod(worldState, biome);'),
  'World generation should apply distance-based shadow-map LOD to static shadow casters.'
);
