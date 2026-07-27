/**
 * Small deterministic utilities for generated flora. These functions never
 * read the ambient `Math.random`, so adding a generated-flora instance cannot
 * shift Small World's order-sensitive world-generation stream.
 */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * Stable JSON-like serialization with sorted object keys.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function stableStringify(value) {
  if (value === null) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(String(value));
}

/**
 * FNV-1a hash over a string.
 *
 * @param {string} value
 * @param {number} [initial]
 * @returns {number}
 */
export function hashString32(value, initial = FNV_OFFSET) {
  let hash = initial >>> 0;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/**
 * Convert numbers, strings, or semantic objects into a uint32 seed.
 *
 * @param {unknown} value
 * @returns {number}
 */
export function seedToUint32(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value >>> 0;
  if (typeof value === "bigint") return Number(value & 0xffffffffn) >>> 0;
  if (typeof value === "string") return hashString32(value);
  return hashString32(stableStringify(value));
}

/**
 * Hash any number of semantic seed parts into one stable uint32.
 *
 * @param {...unknown} parts
 * @returns {number}
 */
export function hashSeed(...parts) {
  let hash = FNV_OFFSET;
  for (const part of parts) {
    hash = hashString32(stableStringify(part), hash);
    hash ^= 0x9e3779b9;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Mulberry32 wrapped with semantic convenience helpers. `fork(label)` is
 * derived from the original seed, not the current cursor, so its stream is
 * stable even if the parent starts consuming additional values.
 *
 * @param {unknown} seed
 * @returns {{
 *   seed: number,
 *   next: () => number,
 *   range: (lo: number, hi: number) => number,
 *   int: (lo: number, hi: number) => number,
 *   pick: <T>(values: T[]) => T,
 *   fork: (label: unknown) => ReturnType<typeof createRng>
 * }}
 */
export function createRng(seed) {
  const baseSeed = seedToUint32(seed);
  let state = baseSeed;

  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    seed: baseSeed,
    next,
    range(lo, hi) {
      return lo + next() * (hi - lo);
    },
    int(lo, hi) {
      const a = Math.ceil(Math.min(lo, hi));
      const b = Math.floor(Math.max(lo, hi));
      return a + Math.floor(next() * (b - a + 1));
    },
    pick(values) {
      if (!Array.isArray(values) || values.length === 0) {
        throw new Error("createRng.pick requires a non-empty array");
      }
      return values[Math.floor(next() * values.length)];
    },
    fork(label) {
      return createRng(hashSeed(baseSeed, label));
    },
  };
}
