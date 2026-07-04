// Pure, DOM-free constants and helpers factored out of src/ui.js (QA-009 /
// pre-work for the upcoming ui.js split). Nothing here touches `document` or
// `window`, so it can be imported and exercised directly under plain node —
// unlike ui.js itself, whose DOM wiring lives inside initUi().

// Ground-cover flora variants hidden from the locator panel and from the
// current-biome Field Guide catalog (both want to only surface "findable"
// subjects, not the ambient ground cover every biome has).
export const LOCATOR_HIDDEN_FLORA_VARIANTS = new Set([
  "grassfield", "wildflower", "pebble", "grassblade",
  "cloudpuff", "shell", "starfish", "water",
]);

/**
 * Step to the next enabled biome after `currentBiomeId`, wrapping around.
 * Pure function of the already-filtered enabled-biome list; the caller
 * (regen buttons in ui.js) is responsible for filtering BIOMES by the
 * user's biome-filter chips before calling this.
 *
 * @param {Array<{id: string}>} enabledBiomes
 * @param {string|undefined|null} currentBiomeId
 * @returns {string|null} the next biome id, or null if enabledBiomes is empty.
 */
export function nextEnabledBiomeIdFrom(enabledBiomes, currentBiomeId) {
  if (enabledBiomes.length === 0) return null;
  const currentIdx = enabledBiomes.findIndex((biome) => biome.id === currentBiomeId);
  const nextIdx = currentIdx < 0 ? 0 : (currentIdx + 1) % enabledBiomes.length;
  return enabledBiomes[nextIdx].id;
}

// Photo review 3D dim-plane overlay: rendered behind the postcard mesh in the
// review group (not a DOM overlay, which would also darken the postcard
// preview itself — see tests/photo-review-dimming.test.mjs).
export const PHOTO_REVIEW_DIM_RENDER_ORDER = 998;
export const PHOTO_REVIEW_DIM_OPACITY = 0.45;
