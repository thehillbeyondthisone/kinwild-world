import { seedToUint32 } from "./rng.js";

export const FLORA_DNA_VERSION = 1;

/** The proof deliberately supports exactly these three compositional roles. */
export const FLORA_ROLES = Object.freeze([
  "hero-mushroom",
  "mid-flower-cluster",
  "groundcover",
]);

export const PALETTE_ROLES = Object.freeze([
  "stem",
  "primary",
  "secondary",
  "accent",
  "highlight",
  "shadow",
]);

const ROLE_ALIASES = Object.freeze({
  hero: "hero-mushroom",
  landmark: "hero-mushroom",
  mushroom: "hero-mushroom",
  flower: "mid-flower-cluster",
  flowers: "mid-flower-cluster",
  mid: "mid-flower-cluster",
  ground: "groundcover",
  grass: "groundcover",
});

const ROLE_DEFAULTS = Object.freeze({
  "hero-mushroom": {
    name: "Crowncap",
    paletteRoles: {
      structure: "stem",
      body: "primary",
      detail: "secondary",
      signal: "accent",
      highlight: "highlight",
    },
    shape: {
      height: 4.8,
      stemRadius: 0.58,
      capRadius: 2.25,
      capDepth: 0.9,
      spotCount: 11,
      satelliteCount: 3,
    },
    motion: {
      wind: 0.16,
      touchStrength: 1,
      touchStiffness: 34,
      touchDamping: 7.5,
      maxLean: 0.16,
    },
    variation: {
      scaleMin: 0.9,
      scaleMax: 1.12,
      lean: 0.035,
    },
  },
  "mid-flower-cluster": {
    name: "Bellstar Cluster",
    paletteRoles: {
      structure: "stem",
      body: "accent",
      detail: "secondary",
      signal: "highlight",
      highlight: "highlight",
    },
    shape: {
      clusterRadius: 1.25,
      flowerCount: 7,
      stemHeight: 1.25,
      bloomRadius: 0.2,
      petalCount: 6,
      leafPairs: 2,
    },
    motion: {
      wind: 0.72,
      touchStrength: 1,
      touchStiffness: 42,
      touchDamping: 8.2,
      maxLean: 0.24,
    },
    variation: {
      scaleMin: 0.82,
      scaleMax: 1.18,
      lean: 0.08,
    },
  },
  groundcover: {
    name: "Whispergrass",
    paletteRoles: {
      structure: "stem",
      body: "primary",
      detail: "secondary",
      signal: "accent",
      highlight: "highlight",
    },
    shape: {
      patchRadius: 2.6,
      count: 112,
      bladeHeight: 0.48,
      bladeWidth: 0.095,
      clumpiness: 0.62,
      heightVariance: 0.38,
    },
    motion: {
      wind: 1.08,
      touchStrength: 1,
      touchStiffness: 54,
      touchDamping: 9.5,
      maxLean: 0.12,
    },
    variation: {
      scaleMin: 0.82,
      scaleMax: 1.16,
      lean: 0.12,
    },
  },
});

const SHAPE_LIMITS = Object.freeze({
  "hero-mushroom": {
    height: [2.2, 8.5],
    stemRadius: [0.22, 1.35],
    capRadius: [0.8, 4.6],
    capDepth: [0.3, 1.8],
    spotCount: [0, 28, true],
    satelliteCount: [0, 6, true],
  },
  "mid-flower-cluster": {
    clusterRadius: [0.45, 3.2],
    flowerCount: [3, 18, true],
    stemHeight: [0.45, 2.8],
    bloomRadius: [0.08, 0.46],
    petalCount: [4, 9, true],
    leafPairs: [0, 3, true],
  },
  groundcover: {
    patchRadius: [0.6, 5],
    count: [12, 320, true],
    bladeHeight: [0.12, 1.15],
    bladeWidth: [0.025, 0.3],
    clumpiness: [0, 1],
    heightVariance: [0, 0.75],
  },
});

const MOTION_LIMITS = Object.freeze({
  wind: [0, 2],
  touchStrength: [0.1, 2],
  touchStiffness: [8, 80],
  touchDamping: [2, 24],
  maxLean: [0.03, 0.45],
});

const VARIATION_LIMITS = Object.freeze({
  scaleMin: [0.65, 1.1],
  scaleMax: [0.9, 1.5],
  lean: [0, 0.2],
});

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizeRole(value, notes) {
  const candidate = typeof value === "string" ? value.trim().toLowerCase() : "";
  const role = ROLE_ALIASES[candidate] ?? candidate;
  if (FLORA_ROLES.includes(role)) return role;
  notes.push(`unknown flora role "${String(value)}" -> mid-flower-cluster`);
  return "mid-flower-cluster";
}

function normalizeName(value, fallback, notes) {
  if (typeof value !== "string" || value.trim().length === 0) {
    if (value !== undefined) notes.push("invalid name -> role default");
    return fallback;
  }
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length <= 64) return trimmed;
  notes.push("name truncated to 64 characters");
  return trimmed.slice(0, 64);
}

function normalizeNumber(source, key, fallback, limits, notes, path) {
  const raw = source[key];
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) {
    if (raw !== undefined) notes.push(`${path}.${key} invalid -> ${fallback}`);
    return fallback;
  }
  const [lo, hi, integer] = limits;
  const clamped = Math.min(hi, Math.max(lo, n));
  const out = integer ? Math.round(clamped) : clamped;
  if (out !== n) notes.push(`${path}.${key} clamped to ${out}`);
  return out;
}

function normalizeNumericBlock(source, defaults, limits, notes, path) {
  const input = isRecord(source) ? source : {};
  const out = {};
  for (const key of Object.keys(defaults)) {
    out[key] = normalizeNumber(input, key, defaults[key], limits[key], notes, path);
  }
  return out;
}

function normalizePaletteRoles(source, defaults, notes) {
  const input = isRecord(source) ? source : {};
  const out = {};
  for (const [slot, fallback] of Object.entries(defaults)) {
    const value = input[slot];
    if (value === undefined) {
      out[slot] = fallback;
    } else if (PALETTE_ROLES.includes(value)) {
      out[slot] = value;
    } else {
      notes.push(`paletteRoles.${slot} invalid -> ${fallback}`);
      out[slot] = fallback;
    }
  }
  return out;
}

/**
 * Normalize permissive AI-authored FloraDNA into a compact immutable form.
 * Unknown fields are intentionally dropped: the compiler, not generated
 * input, owns the render/performance grammar.
 *
 * @param {unknown} raw
 * @returns {{dna: Readonly<object>, notes: string[]}}
 */
export function normalizeFloraDNA(raw) {
  const notes = [];
  const input = isRecord(raw) ? raw : {};
  if (!isRecord(raw)) notes.push("flora DNA was not an object -> defaults");

  const role = normalizeRole(input.role, notes);
  const defaults = ROLE_DEFAULTS[role];
  const shape = normalizeNumericBlock(
    input.shape,
    defaults.shape,
    SHAPE_LIMITS[role],
    notes,
    "shape"
  );
  const motion = normalizeNumericBlock(
    input.motion,
    defaults.motion,
    MOTION_LIMITS,
    notes,
    "motion"
  );
  const variation = normalizeNumericBlock(
    input.variation,
    defaults.variation,
    VARIATION_LIMITS,
    notes,
    "variation"
  );

  if (variation.scaleMin > variation.scaleMax) {
    notes.push("variation scale range reordered");
    [variation.scaleMin, variation.scaleMax] = [variation.scaleMax, variation.scaleMin];
  }

  const dna = {
    version: FLORA_DNA_VERSION,
    name: normalizeName(input.name, defaults.name, notes),
    role,
    seed: seedToUint32(input.seed ?? `${role}:${input.name ?? defaults.name}`),
    paletteRoles: normalizePaletteRoles(input.paletteRoles, defaults.paletteRoles, notes),
    shape,
    motion,
    variation,
  };

  return { dna: deepFreeze(dna), notes };
}
