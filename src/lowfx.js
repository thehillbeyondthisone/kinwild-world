// Optional low-effects mode — drops the pixel ratio, particle count, and
// instanced ground-cover density so slow devices stay smooth.
//
// Three ways in:
//   ?lowfx=1   force on
//   ?lowfx=0   force off (overrides auto-detect)
//   neither    auto-detect from genuinely weak signals only
//
// Auto-detect heuristics: low device pixel ratio (< 1.5) combined with
// a small screen (< 768px short side). Modern phones (DPR 2–3) are
// powerful enough for the full pipeline even at small viewport sizes,
// so small screen alone is no longer a reliable weakness signal.
// Read once at import time so every module sees the same flag without
// parsing the URL or re-querying media queries repeatedly.
// Window-safe at module scope — node-based tests bundle this module (via
// state.js) without a DOM.
const _params = new URLSearchParams(
  typeof window === "undefined" ? "" : window.location.search
);
const _forceLowfx = _params.get("lowfx");
function _autoLowfx() {
  if (typeof window === "undefined") return false;
  const dpr = window.devicePixelRatio || 1;
  const shortSide = Math.min(window.innerWidth, window.innerHeight);
  // Low DPR on a small screen = genuinely weak device (budget tablets,
  // old phones, embedded screens). High-DPR devices are assumed capable.
  const weakHardware = dpr < 1.5 && shortSide > 0 && shortSide < 768;
  return weakHardware;
}
/**
 * Low-effects mode flag, resolved once at module load. Drops pixel ratio,
 * particle count, and instanced ground-cover density for slow devices.
 * `?lowfx=1` forces on, `?lowfx=0` forces off, otherwise auto-detected from
 * low DPR (< 1.5) combined with a small screen (< 768px short side).
 * @type {boolean}
 */
export const LOWFX =
  _forceLowfx === "1" ? true :
  _forceLowfx === "0" ? false :
  _autoLowfx();

// Mid-tier mobile profile — touch-first devices with high DPR pass the LOWFX
// weak-hardware check but many (DPR-2 mid-range phones, tablets) still can't
// sustain 60fps under the full pipeline: bloom at physical resolution plus the
// combined depth-FX pass plus the reflection RT. MIDFX keeps bloom (the
// signature look) while defaulting the depth-driven FX off (see userSettings
// in state.js — saved user choices still override), shrinking the water
// reflection RT, and capping the pixel ratio at 1.5.
//   ?midfx=1 force on, ?midfx=0 force off, otherwise auto-detect.
const _forceMidfx = _params.get("midfx");
function _autoMidfx() {
  if (typeof window === "undefined") return false;
  if (LOWFX) return false; // LOWFX already strips the whole pipeline
  const dpr = window.devicePixelRatio || 1;
  const coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
  return coarsePointer && dpr >= 1.5;
}
/**
 * Mid-tier mobile profile flag, resolved once at module load. Never true
 * when `LOWFX` is true. Flips the `outline`/`ao`/`depthFog` FX-panel
 * *defaults* off (saved user settings still override), shrinks the water
 * reflection RT, and caps pixel ratio at 1.5 — bloom stays on.
 * `?midfx=1` forces on, `?midfx=0` forces off, otherwise auto-detected from
 * a coarse pointer plus DPR >= 1.5.
 * @type {boolean}
 */
export const MIDFX =
  _forceMidfx === "1" ? true :
  _forceMidfx === "0" ? false :
  _autoMidfx();

/**
 * Detect a mobile/touch viewport for hard pixel-ratio capping purposes.
 * `?mobile=1`/`?mobile=0` override; otherwise true when the pointer is
 * coarse and the short viewport side is <= 900px.
 *
 * @returns {boolean}
 */
export function isMobileViewport() {
  if (typeof window === "undefined") return false;
  const forced = new URLSearchParams(window.location.search).get("mobile");
  if (forced === "1") return true;
  if (forced === "0") return false;
  const shortSide = Math.min(window.innerWidth, window.innerHeight);
  const coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
  return coarsePointer && shortSide > 0 && shortSide <= 900;
}

/**
 * Resolve the pixel-ratio cap to apply to the renderer, tightest tier wins:
 * mobile viewport (1) > LOWFX (1) > MIDFX (1.5) > default (2).
 *
 * @returns {number} max device pixel ratio to use
 */
export function rendererPixelRatioCap() {
  if (isMobileViewport()) return 1;
  if (LOWFX) return 1;
  if (MIDFX) return 1.5;
  return 2;
}

/**
 * Multiplier applied to particle counts and ground-cover instance counts
 * when `LOWFX` is on. ~40% keeps the world readable while halving most
 * per-frame work.
 * @type {number}
 */
export const LOWFX_DENSITY = 0.4;
