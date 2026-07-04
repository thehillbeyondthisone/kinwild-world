// Procedural island names: generateIslandName(seed) deterministically combines a
// whimsical PREFIX + SUFFIX (e.g. "Mossvale", "Brambrook") via a fresh mulberry32
// stream seeded from the world seed. It uses its own RNG instance rather than the
// shared Math.random so it can be called any time without disturbing the seeded
// determinism window in generateWorld.
import { mulberry32 } from "./seed.js";

const PREFIXES = [
  "Moss", "Vel", "Quill", "Bram", "Fern", "Hazel", "Dew", "Lark",
  "Thorn", "Ash", "Ember", "Willow", "Clover", "Ivy", "Rune",
  "Cedar", "Wren", "Pip", "Briar", "Mist", "Sage", "Reed",
  "Moth", "Vine", "Lupin", "Alder", "Basil", "Tansy", "Fennel",
  "Rowan", "Coral", "Silk", "Bloom", "Gale", "Honey", "Jade", "Opal",
  "Wren", "Sorrel", "Elm", "Yew",
];

const SUFFIXES = [
  "brim", "hollow", "mere", "vale", "haven", "wick", "thorn", "berry",
  "keep", "reach", "glen", "den", "fell", "croft", "leigh", "rest",
  "holt", "drift", "stone", "field", "brook", "shade", "wood", "ward",
  "mead", "peak", "rise", "comb", "bury", "fell",
];

/**
 * Deterministically derive a whimsical island place-name (e.g. "Mossbrim")
 * from the world seed. Spins up its own `mulberry32` stream rather than using
 * the shared `Math.random`, so it's safe to call any time — including outside
 * or after the seeded world-gen determinism window — without perturbing it.
 *
 * @param {number} seed - 16-bit world seed
 * @returns {string} generated island name (prefix + suffix)
 */
export function generateIslandName(seed) {
  const rng = mulberry32(seed);
  const prefix = PREFIXES[Math.floor(rng() * PREFIXES.length)];
  const suffix = SUFFIXES[Math.floor(rng() * SUFFIXES.length)];
  return prefix + suffix;
}
