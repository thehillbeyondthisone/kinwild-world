// Public UI entry point (ARC-001 / QA-006 god-module split).
//
// This file used to be a 2,764-line module holding every HUD concern in one
// initUi(). It is now a thin orchestrator: it seeds the shared `ctx`
// (src/ui/context.js) with the renderer refs, calls each panel/mode module's
// init in an order that preserves the original event-listener registration
// sequence, and re-exports the same public surface main.js already imports.
//
// The concerns now live under src/ui/:
//   - context.js         shared mutable ctx (refs + mode state + cross-module fns)
//   - constants.js       DOM-free constants/helpers (pre-existing, ARC-003)
//   - storage.js         localStorage persistence (pre-existing, ARC-003)
//   - settings-panel.js  atmosphere / wind / grass / portal / fx / music /
//                        auto-regen / share, + the world-ready wind/grass rebase
//   - help-panel.js      help panel + biome filter chips + bookmarks
//   - catalog-panel.js   Field Guide catalog panel + its IndexedDB store
//   - locator-panel.js   locator panel + follow mode + cinematic tour
//   - first-person.js    makeFirstPersonMode + stroll/fly + stepStroll
//   - photo-mode.js      photo mode + 3D review + reticle catalog capture
//   - input.js           pause / regen / keyboard / canvas-pick / resize glue
import { state, APP_VERSION } from "./state.js";
import { ctx } from "./ui/context.js";
import { loadSettings } from "./ui/storage.js";
import { initSettingsPanel } from "./ui/settings-panel.js";
import { initHelpPanel } from "./ui/help-panel.js";
import { initCatalogPanel } from "./ui/catalog-panel.js";
import { initLocatorPanel } from "./ui/locator-panel.js";
import { initFirstPerson } from "./ui/first-person.js";
import { initPhotoMode } from "./ui/photo-mode.js";
import { initInput } from "./ui/input.js";

// Re-export the public surface main.js (and the tests) import from "./ui.js".
export { loadSettings } from "./ui/storage.js";
export {
  stepStroll,
  setStrollLocalPose,
  enterStrollFromPortal,
  isStrolling,
  isFlyMode,
  isPhotoFP,
  isAnyFP,
} from "./ui/first-person.js";
export { getFollowTarget, setFollowTarget, stepTour, isTouring } from "./ui/locator-panel.js";
export { getPhotoReviewGroup, isPhotoMode } from "./ui/photo-mode.js";

// Pure predicates over shared ctx state — small enough to keep here.
export function isSelectingCreature() {
  return ctx.selectingCreature;
}

export function isManualPaused() {
  return ctx.manualPause;
}

export function initUi({ camera, canvas, controls, renderer }) {
  ctx.camera = camera;
  ctx.canvas = canvas;
  ctx.controls = controls;
  ctx.renderer = renderer;

  // Inject app version into header eyebrow.
  const versionEl = document.getElementById("app-version");
  if (versionEl) versionEl.textContent = APP_VERSION;

  // Restore persisted settings before any panel reads defaults — the panels
  // below sync their inputs from state.userSettings.
  loadSettings();
  controls.autoRotate = state.userSettings.autoRotate;

  // Init order preserves the original registration sequence: settings before
  // input (its "world-ready" wind/grass rebase must precede the mobile header
  // fade listener); the panels that own setSettingsOpen / setLocatorOpen /
  // setCatalogOpen before help-panel (whose first-visit block calls them at
  // init time); first-person before input (its canvas pointer listeners must
  // register before input's click-to-pick).
  initSettingsPanel();
  initCatalogPanel();
  initLocatorPanel();
  initHelpPanel();
  initFirstPerson();
  initPhotoMode();
  initInput();
}
