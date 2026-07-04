import { BIOMES } from "./biomes.js";

/**
 * Small, fast PRNG (mulberry32) seeded from a single 32-bit integer.
 * Used both to install the seeded `Math.random` window in `generateWorld`
 * and standalone (e.g. `generateIslandName`) for deterministic-but-isolated streams.
 *
 * @param {number} seed - 32-bit integer seed (world seeds are 16-bit, masked elsewhere)
 * @returns {() => number} generator function producing floats in [0, 1)
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Format a seed as the canonical `0x####` hex string used in the URL and HUD.
 *
 * @param {number} seed - 16-bit world seed
 * @returns {string} zero-padded 4-hex-digit string, e.g. "0x3f2a"
 */
export function formatSeed(seed) {
  return "0x" + (seed >>> 0).toString(16).padStart(4, "0");
}

// Seed space is documented as 16-bit (see formatSeed/newRandomSeed) — mask
// any parsed value down to that range so out-of-range shared links can't
// silently produce a seed outside the space the rest of the app assumes.
const SEED_MASK = 0xffff;

/**
 * Parse a user-supplied seed string (hex with/without `0x` prefix, or decimal)
 * into a masked 16-bit seed.
 *
 * @param {string|null|undefined} str - raw input, e.g. "0x3f2a", "3f2a", "16170"
 * @returns {number|null} seed masked to 16 bits, or null if empty/unparseable
 */
export function parseSeed(str) {
  if (!str) return null;
  const s = String(str).trim();
  if (/^0x[0-9a-f]+$/i.test(s)) return parseInt(s.slice(2), 16) & SEED_MASK;
  if (/^[0-9a-f]{1,8}$/i.test(s) && /[a-f]/i.test(s))
    return parseInt(s, 16) & SEED_MASK;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? (n >>> 0) & SEED_MASK : null;
}

/**
 * Read and parse the `seed` query parameter from the current URL.
 *
 * @returns {number|null} parsed 16-bit seed, or null if absent/invalid
 */
export function readSeedFromUrl() {
  return parseSeed(new URLSearchParams(window.location.search).get("seed"));
}

/**
 * Read the `biome` query parameter, validated against the known `BIOMES` table.
 *
 * @returns {string|null} the biome id if it exists in `BIOMES`, else null
 */
export function readBiomeFromUrl() {
  const biomeId = new URLSearchParams(window.location.search).get("biome");
  return BIOMES.some((biome) => biome.id === biomeId) ? biomeId : null;
}

/**
 * Write the seed (and optional biome id) back into the URL via
 * `history.replaceState`, so a shared/reloaded link reproduces the same world.
 *
 * @param {number} seed - 16-bit world seed
 * @param {Object} [opts]
 * @param {string|null} [opts.biomeId] - if a valid biome id, written as `biome=`; otherwise the param is removed
 */
export function writeSeedToUrl(seed, { biomeId = null } = {}) {
  const url = new URL(window.location.href);
  url.searchParams.set("seed", formatSeed(seed));
  if (biomeId && BIOMES.some((biome) => biome.id === biomeId)) {
    url.searchParams.set("biome", biomeId);
  } else {
    url.searchParams.delete("biome");
  }
  history.replaceState(null, "", url.toString());
}

/**
 * Roll a fresh random 16-bit seed, optionally constrained by biome filters.
 * Rerolls up to 64 times to satisfy both `allowedBiomeIds` and the no-repeat
 * rule (`excludeBiomeId`); if that fails, falls back to 32 more attempts that
 * keep the filter but drop the no-repeat rule; finally gives up with an
 * unconstrained random seed. Uses the ambient (unseeded) `Math.random`, so
 * safe to call outside the deterministic world-gen window.
 *
 * @param {Object|string} [opts] - options object, or (back-compat) a bare biome id to exclude
 * @param {string} [opts.excludeBiomeId] - avoid rerolling into this biome id when possible
 * @param {string[]} [opts.allowedBiomeIds] - if non-empty, only accept seeds whose biome roll is in this set
 * @returns {number} a 16-bit seed (0..0xffff)
 */
export function newRandomSeed(opts = {}) {
  // Back-compat: accept a bare biome id string in addition to the options form.
  const o = typeof opts === "string" ? { excludeBiomeId: opts } : opts;
  const excludeBiomeId = o.excludeBiomeId;
  const allowedBiomeIds = o.allowedBiomeIds; // undefined or empty = no filter
  const filterOn =
    Array.isArray(allowedBiomeIds) && allowedBiomeIds.length > 0;
  // Reroll to satisfy both the filter and the no-repeat rule when possible.
  for (let i = 0; i < 64; i++) {
    const s = Math.floor(Math.random() * 0x10000);
    const peekBiome = BIOMES[Math.floor(mulberry32(s)() * BIOMES.length)];
    if (filterOn && !allowedBiomeIds.includes(peekBiome.id)) continue;
    if (excludeBiomeId && peekBiome.id === excludeBiomeId) continue;
    return s;
  }
  // Couldn't satisfy both — relax the no-repeat rule but keep the filter.
  if (filterOn) {
    for (let i = 0; i < 32; i++) {
      const s = Math.floor(Math.random() * 0x10000);
      const peekBiome = BIOMES[Math.floor(mulberry32(s)() * BIOMES.length)];
      if (allowedBiomeIds.includes(peekBiome.id)) return s;
    }
  }
  return Math.floor(Math.random() * 0x10000);
}
