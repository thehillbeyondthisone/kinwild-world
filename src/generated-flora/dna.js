import { seedToUint32 } from "./rng.js";
import {
  ARCHETYPE_NAME_DEFAULTS,
  ARCHETYPE_ROLES,
  ARCHETYPE_SHAPE_DEFAULTS,
  ARCHETYPE_SHAPE_LIMITS,
  FLORA_ARCHETYPES,
} from "./archetypes.js";

export const FLORA_DNA_VERSION = 2;

/**
 * The compositional tier a plant occupies in a field. Deliberately separate
 * from its silhouette: v1 fused the two, which is why the only hero the
 * compiler could build was a mushroom.
 */
export const FLORA_ROLES = Object.freeze(["hero", "mid", "ground"]);

export { FLORA_ARCHETYPES };

export const PALETTE_ROLES = Object.freeze([
  "stem",
  "primary",
  "secondary",
  "accent",
  "highlight",
  "shadow",
]);

const ROLE_ALIASES = Object.freeze({
  landmark: "hero",
  "hero-mushroom": "hero",
  "mid-flower-cluster": "mid",
  mid: "mid",
  flower: "mid",
  flowers: "mid",
  groundcover: "ground",
  ground: "ground",
  grass: "ground",
});

/**
 * v1 DNA named a renderer where v2 names a silhouette. The three old role
 * strings still resolve, so anything holding a saved v1 plant keeps compiling.
 */
const ARCHETYPE_ALIASES = Object.freeze({
  "hero-mushroom": "cap",
  mushroom: "cap",
  hero: "cap",
  "mid-flower-cluster": "bell",
  flower: "bell",
  flowers: "bell",
  bloom: "bell",
  groundcover: "cover",
  grass: "cover",
  ground: "cover",
  turf: "cover",
  tree: "canopy",
  canopy: "canopy",
  fern: "frond",
  succulent: "pad",
  reeds: "reed",
});

const DEFAULT_PALETTE_ROLES = Object.freeze({
  structure: "stem",
  body: "primary",
  detail: "secondary",
  signal: "accent",
  highlight: "highlight",
});

const MOTION_DEFAULTS = Object.freeze({
  hero: { wind: 0.16, touchStrength: 1, touchStiffness: 34, touchDamping: 7.5, maxLean: 0.16 },
  mid: { wind: 0.72, touchStrength: 1, touchStiffness: 42, touchDamping: 8.2, maxLean: 0.24 },
  ground: { wind: 1.08, touchStrength: 1, touchStiffness: 54, touchDamping: 9.5, maxLean: 0.12 },
});

const VARIATION_DEFAULTS = Object.freeze({
  hero: { scaleMin: 0.9, scaleMax: 1.12, lean: 0.035 },
  mid: { scaleMin: 0.82, scaleMax: 1.18, lean: 0.08 },
  ground: { scaleMin: 0.82, scaleMax: 1.16, lean: 0.12 },
});

/**
 * Exported for the same reason `ARCHETYPE_SHAPE_LIMITS` is: a genome editor
 * generates one control per field from these, and the mutation operator sizes
 * a field's drift by its range. A bound only the normalizer knows about
 * cannot be offered to either.
 */
export const MOTION_LIMITS = Object.freeze({
  wind: [0, 2],
  touchStrength: [0.1, 2],
  touchStiffness: [8, 80],
  touchDamping: [2, 24],
  maxLean: [0.03, 0.45],
});

export const VARIATION_LIMITS = Object.freeze({
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

function token(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function resolveArchetype(candidate) {
  if (FLORA_ARCHETYPES.includes(candidate)) return candidate;
  return ARCHETYPE_ALIASES[candidate] ?? null;
}

function normalizeArchetype(input, notes) {
  const explicit = token(input.archetype);
  if (explicit) {
    const resolved = resolveArchetype(explicit);
    if (resolved) return resolved;
    notes.push(`unknown flora archetype "${input.archetype}" -> bell`);
    return "bell";
  }
  const roleToken = token(input.role);
  if (!roleToken) return "bell";
  const resolved = resolveArchetype(roleToken);
  if (resolved) return resolved;
  if (!ROLE_ALIASES[roleToken] && !FLORA_ROLES.includes(roleToken)) {
    notes.push(`unknown flora role "${input.role}" -> bell`);
  }
  return "bell";
}

/**
 * The tier is taken from an explicit role when one is given, and otherwise
 * from the archetype. Unknown roles are reported by `normalizeArchetype`, so
 * this stays silent rather than logging the same repair twice.
 */
function normalizeRole(input, archetype) {
  const roleToken = token(input.role);
  if (FLORA_ROLES.includes(roleToken)) return roleToken;
  return ROLE_ALIASES[roleToken] ?? ARCHETYPE_ROLES[archetype];
}

function normalizeName(value, fallback, notes) {
  if (typeof value !== "string" || value.trim().length === 0) {
    if (value !== undefined) notes.push("invalid name -> archetype default");
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

function normalizePaletteRoles(source, notes) {
  const input = isRecord(source) ? source : {};
  const out = {};
  for (const [slot, fallback] of Object.entries(DEFAULT_PALETTE_ROLES)) {
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
 * input, owns the render/performance grammar — and because `shape` is keyed
 * per archetype, a groundcover physically cannot carry trunk fields through.
 *
 * @param {unknown} raw
 * @returns {{dna: Readonly<object>, notes: string[]}}
 */
export function normalizeFloraDNA(raw) {
  const notes = [];
  const input = isRecord(raw) ? raw : {};
  if (!isRecord(raw)) notes.push("flora DNA was not an object -> defaults");

  const archetype = normalizeArchetype(input, notes);
  const role = normalizeRole(input, archetype);
  const shape = normalizeNumericBlock(
    input.shape,
    ARCHETYPE_SHAPE_DEFAULTS[archetype],
    ARCHETYPE_SHAPE_LIMITS[archetype],
    notes,
    "shape",
  );
  const motion = normalizeNumericBlock(
    input.motion,
    MOTION_DEFAULTS[role],
    MOTION_LIMITS,
    notes,
    "motion",
  );
  const variation = normalizeNumericBlock(
    input.variation,
    VARIATION_DEFAULTS[role],
    VARIATION_LIMITS,
    notes,
    "variation",
  );

  if (variation.scaleMin > variation.scaleMax) {
    notes.push("variation scale range reordered");
    [variation.scaleMin, variation.scaleMax] = [variation.scaleMax, variation.scaleMin];
  }

  const name = normalizeName(input.name, ARCHETYPE_NAME_DEFAULTS[archetype], notes);
  const dna = {
    version: FLORA_DNA_VERSION,
    name,
    archetype,
    role,
    seed: seedToUint32(input.seed ?? `${archetype}:${input.name ?? name}`),
    paletteRoles: normalizePaletteRoles(input.paletteRoles, notes),
    shape,
    motion,
    variation,
  };

  return { dna: deepFreeze(dna), notes };
}
