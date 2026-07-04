// Shared UI context (ARC-001 / QA-006 god-module split).
//
// The old src/ui.js kept every cross-cutting piece of mutable UI state in
// module-scope `let`s that initUi() assigned into and the exported predicate
// functions read back. Splitting initUi() across src/ui/*.js modules means
// that state — plus the handful of cross-module functions each panel needs to
// call on the others (e.g. entering photo mode must exit stroll, close the
// locator, drop the follow target) — has to live somewhere all the modules can
// reach without importing each other in a cycle.
//
// `ctx` is that place: a single mutable object. Each `initX(ctx)` reads the
// shared refs (camera/canvas/controls/renderer), mutates the mode-state fields
// directly (exactly as the old `let`s were mutated), and attaches its public
// functions onto `ctx` so sibling modules can invoke them as `ctx.fn()`. The
// no-op defaults below keep an accidental early call harmless before the owning
// module's init has run.
/**
 * Shared mutable UI context (ARC-001/QA-006 god-module split). Holds the
 * renderer refs injected once by `initUi()`, cross-cutting mode/selection
 * state (mirrors the old module-scope `let`s from the pre-split `ui.js`),
 * DOM element refs needed by module-scope exported functions, and
 * cross-module functions attached during each panel's init — sibling panel
 * modules call these as `ctx.fn()` rather than importing each other, which
 * would create import cycles. No-op defaults keep an accidental early call
 * harmless before the owning module's init has run.
 * @type {Object}
 */
export const ctx = {
  // Injected once by initUi().
  camera: null,
  canvas: null,
  controls: null,
  renderer: null,

  // Mode / selection state (mirrors the former module-scope `let`s).
  followTarget: null,
  selectingCreature: false,
  stroll: null,
  flyFP: null,
  photoFP: null,
  photoReview: null,
  manualPause: false,
  tour: null,
  catalogOpen: false,
  catalogObjectUrls: [],
  catalogRenderGen: 0,
  locatorOpen: false,
  locatorCycle: null,

  // Element refs needed by module-scope (non-closure) exported functions.
  followButton: null,
  tourButton: null,
  tourBanner: null,

  // Cross-module functions, attached during init (no-op until then).
  setSettingsOpen() {},
  setHelpOpen() {},
  setLocatorOpen() {},
  setCatalogOpen() {},
  toggleCatalogPanel() {},
  async renderCatalogPanel() {},
  catalogStore: null,
  setFollowTarget() {},
  setSelectingCreature() {},
  stopTour() {},
  toggleTour() {},
  enterStroll() {},
  exitStroll() {},
  enterFlyMode() {},
  exitFlyMode() {},
  requestStrollPointerLock() {},
  syncFlyTouchControls() {},
  setPhotoMode() {},
  capturePhoto() {},
  closePhotoReview() {},
  syncPhotoSeed() {},
  setManualPaused() {},
  pickRandomBiomeSeed: null,
  pickSameBiomeSeed: null,
  syncBookmarkButton() {},
  syncBiomeOverrideSettings() {},
  refreshMusicTrackSelect() {},
};
