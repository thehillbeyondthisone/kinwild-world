// LocalStorage persistence layer for UI settings, bookmarks, biome filter,
// and first-visit help state.
//
// Extracted from src/ui.js as part of ARC-003 / QA-004 (splitting the ui.js
// God module). This module owns every localStorage read/write and the schema
// constants. It has NO dependency on initUi()'s closures or the mode/panel
// state machine — it only touches localStorage, state.userSettings, and the
// BIOMES table. Callers import { loadSettings, saveSettings, ... } from here.
import { state, GRASS_DENSITY_BASE, GRASS_HEIGHT_BASE } from "../state.js";
import { BIOMES } from "../biomes.js";

// Persisted settings ----------------------------------------------------------
// Only fields explicitly listed here are read/written; unknown keys in
// localStorage are ignored so we can change the schema later without breaking.
const SETTINGS_KEY = "smallworld:settings:v1";
const PERSISTED_KEYS = [
  "fogMultiplier",
  "autoCycle",
  "manualDayFactor",
  "autoRotate",
  "ambientBoost",
  "worldScale",
  "autoRegen",
  "autoRegenMinutes",
  "bloom",
  "bloomRadius",
  "tiltShift",
  "outline",
  "ao",
  "depthFog",
  "pbrDetails",
  "fxPanelOpen",
  "portalEnabled",
  "portalDoublePlacement",
  "portalPreviewGrass",
  "portalPreviewFlora",
  "portalPreviewCreatures",
  "portalPreviewFx",
  "portalPanelOpen",
  "showFps",
  "windEnabled",
  "windStrength",
  "windNoiseScale",
  "windPanelOpen",
  "foliageWindEnabled",
  "grassEnabled",
  "grassDensity",
  "grassDensityBase",
  "grassHeight",
  "groundMarkLifeScale",
  "grassPanelOpen",
  "musicEnabled",
  "musicVolume",
  "musicTrackOverrides",
];
const BOOKMARKS_KEY = "smallworld:bookmarks:v1";
const BIOME_FILTER_KEY = "smallworld:biomefilter:v1";
const HELP_SEEN_KEY = "smallworld:help-seen:v1";

// SEC-004: persisted settings are allowlisted by key but were previously
// trusted as-is. Clamp numeric settings to the range their slider allows
// (see index.html min/max + ui.js's slider->internal-unit conversion) and
// coerce booleans, so a corrupted/hand-edited localStorage value can't push
// out-of-range numbers (e.g. negative fog, NaN scale) into live state.
// Ranges are expressed in the settings' internal units, not raw slider %.
const NUMERIC_SETTING_RANGES = {
  fogMultiplier: [0, 2],
  manualDayFactor: [0, 1],
  ambientBoost: [0, 1],
  worldScale: [0.5, 2],
  autoRegenMinutes: [1, 20],
  bloomRadius: [0, 3],
  windStrength: [0, 2],
  windNoiseScale: [0.2, 3],
  grassDensity: [0, 3 * GRASS_DENSITY_BASE],
  grassHeight: [0.3 * GRASS_HEIGHT_BASE, 2 * GRASS_HEIGHT_BASE],
  groundMarkLifeScale: [0.25, 4],
  musicVolume: [0, 1],
};
const BOOLEAN_SETTING_KEYS = new Set([
  "autoCycle",
  "autoRotate",
  "autoRegen",
  "bloom",
  "tiltShift",
  "outline",
  "ao",
  "depthFog",
  "pbrDetails",
  "fxPanelOpen",
  "portalEnabled",
  "portalDoublePlacement",
  "portalPreviewGrass",
  "portalPreviewFlora",
  "portalPreviewCreatures",
  "portalPreviewFx",
  "portalPanelOpen",
  "showFps",
  "windEnabled",
  "windPanelOpen",
  "foliageWindEnabled",
  "grassEnabled",
  "grassPanelOpen",
  "musicEnabled",
]);

// Coerces a persisted value for `key` to a safe type/range. Returns
// `undefined` when the value can't be salvaged, so the caller can skip
// assignment and keep the existing default.
function coerceSettingValue(key, value) {
  if (BOOLEAN_SETTING_KEYS.has(key)) return Boolean(value);
  const range = NUMERIC_SETTING_RANGES[key];
  if (range) {
    const n = Number(value);
    if (!Number.isFinite(n)) return undefined;
    return Math.min(range[1], Math.max(range[0], n));
  }
  // Keys with no explicit range (grassDensityBase, musicTrackOverrides) pass
  // through unvalidated: grassDensityBase is immediately overwritten below,
  // and musicTrackOverrides is re-validated downstream in music.js.
  return value;
}

/**
 * Decide whether to use the mobile HUD layout: `?mobile=1`/`?mobile=0` override;
 * otherwise true when the device has touch and either the viewport or the
 * physical screen's short side is under 768px.
 *
 * @returns {boolean}
 */
function shouldUseMobileHud() {
  const mobileParam = new URLSearchParams(window.location.search).get("mobile");
  if (mobileParam === "1") return true;
  if (mobileParam === "0") return false;

  const hasTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  const shortViewport = Math.min(window.innerWidth, window.innerHeight);
  const shortScreen = Math.min(screen.width || 9999, screen.height || 9999);
  return hasTouch && (shortViewport < 768 || shortScreen < 768);
}

/**
 * Restore persisted settings from localStorage into `state.userSettings`.
 * SEC-004: coerces/clamps each value via `coerceSettingValue` so a
 * corrupted/hand-edited localStorage entry can't push out-of-range numbers
 * into live state; unrecognized keys are ignored. Also rebases a saved
 * `grassDensity` against the current `GRASS_DENSITY_BASE` if that constant's
 * value has changed since the settings were saved. No-op (falls back to
 * defaults) if localStorage is empty, unavailable, or unparseable.
 */
export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    for (const k of PERSISTED_KEYS) {
      if (!(k in saved)) continue;
      const coerced = coerceSettingValue(k, saved[k]);
      if (coerced !== undefined) state.userSettings[k] = coerced;
    }
    const savedGrassDensityBase = Number(saved.grassDensityBase ?? 12.5);
    if ("grassDensity" in saved && savedGrassDensityBase > 0 && savedGrassDensityBase !== GRASS_DENSITY_BASE) {
      state.userSettings.grassDensity = saved.grassDensity * (GRASS_DENSITY_BASE / savedGrassDensityBase);
    }
    state.userSettings.grassDensityBase = GRASS_DENSITY_BASE;
  } catch {
    // corrupted or unavailable — fall back to defaults
  }
}

/**
 * Persist the allowlisted `PERSISTED_KEYS` subset of `state.userSettings` to
 * localStorage. Silently no-ops if localStorage throws (quota/private mode).
 */
export function saveSettings() {
  try {
    const out = {};
    for (const k of PERSISTED_KEYS) out[k] = state.userSettings[k];
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(out));
  } catch {
    // localStorage may throw in private mode / quota — non-fatal
  }
}

/**
 * Whether the help panel should auto-open because this is the user's first
 * visit. Marks the flag as seen (side effect) so subsequent calls return false.
 *
 * @returns {boolean}
 */
function shouldShowFirstVisitHelp() {
  try {
    if (localStorage.getItem(HELP_SEEN_KEY)) return false;
    localStorage.setItem(HELP_SEEN_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

/**
 * Load the user's saved seed bookmarks list from localStorage.
 *
 * @returns {Array} bookmark entries, or `[]` if empty/unparseable
 */
function loadBookmarks() {
  try {
    const raw = localStorage.getItem(BOOKMARKS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/**
 * Persist the seed bookmarks list to localStorage. Silently ignores quota/private-mode errors.
 *
 * @param {Array} list - bookmark entries to persist
 */
function saveBookmarks(list) {
  try {
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(list));
  } catch {
    // ignore quota / private mode
  }
}

/**
 * Load the user's biome-filter chip selection from localStorage. Default (no
 * saved filter, or an empty/invalid one): all biomes enabled.
 *
 * @returns {Set<string>} enabled biome ids
 */
function loadBiomeFilter() {
  try {
    const raw = localStorage.getItem(BIOME_FILTER_KEY);
    if (!raw) return new Set(BIOMES.map((b) => b.id));
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length === 0)
      return new Set(BIOMES.map((b) => b.id));
    return new Set(arr.filter((id) => BIOMES.some((b) => b.id === id)));
  } catch {
    return new Set(BIOMES.map((b) => b.id));
  }
}

/**
 * Persist the biome-filter chip selection to localStorage. Silently ignores quota/private-mode errors.
 *
 * @param {Set<string>} set - enabled biome ids
 */
function saveBiomeFilter(set) {
  try {
    localStorage.setItem(BIOME_FILTER_KEY, JSON.stringify([...set]));
  } catch {
    // ignore
  }
}

export {
  SETTINGS_KEY,
  PERSISTED_KEYS,
  BOOKMARKS_KEY,
  BIOME_FILTER_KEY,
  HELP_SEEN_KEY,
  shouldUseMobileHud,
  shouldShowFirstVisitHelp,
  loadBookmarks,
  saveBookmarks,
  loadBiomeFilter,
  saveBiomeFilter,
};
