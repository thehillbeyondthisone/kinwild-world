/**
 * Authoring plants from a description.
 *
 * `normalizeFloraDNA` was written to repair "permissive AI-authored FloraDNA"
 * and nothing produced any — the Form Studio only ever authored creatures. The
 * validation path has been ready since DNA v2: nine archetypes, per-archetype
 * limits, and a roster that rolls zero repairs across every biome and seed.
 * This is the missing producer.
 *
 * Plants are easier to author than creatures in one respect: colour is not
 * theirs to choose. A species takes the field's palette so it belongs to the
 * biome it grows in, which means the model only describes *shape* — and cannot
 * produce something that clashes with the world it lands in.
 *
 * DOM-free apart from an injectable `localStorage`.
 */
import {
  ARCHETYPE_SHAPE_DEFAULTS,
  ARCHETYPE_SHAPE_LIMITS,
  FLORA_ARCHETYPES,
} from "./generated-flora/archetypes.js";
import { normalizeFloraDNA } from "./generated-flora/dna.js";
import {
  candidateFragments,
  findJsonPayload,
  hashText,
  isRecord,
  loadAuthoredEntries,
  requestAuthoringReply,
  saveAuthoredEntry,
  slugify,
} from "./authoring-shared.js";

export const FLORA_AUTHORING_STORAGE_KEY = "living-field:authored-flora:v1";
export const FLORA_AUTHORING_LIMIT = 8;

/** One line per archetype, describing what it is and what it can carry. */
function describeArchetype(key) {
  const limits = ARCHETYPE_SHAPE_LIMITS[key];
  const fields = Object.entries(limits)
    .map(([field, [low, high, integer]]) =>
      `${field}: ${low}-${high}${integer ? " (integer)" : ""}`)
    .join(", ");
  return `- "${key}" — shape { ${fields} }`;
}

const ARCHETYPE_CHARACTER = Object.freeze({
  canopy: "a tree: a branching trunk under a mass of leaves",
  spire: "a tall thin stalk with sparse glowing buds",
  cap: "a mushroom: a stem bundle under a domed cap, optionally with hanging lobes and pendants",
  bell: "a cluster of stems each carrying a hanging bell flower",
  frond: "a fern: arching stems carrying pinnate fronds",
  pad: "a low succulent rosette of thick pads",
  reed: "a clump of upright bladed stems",
  cover: "a patch of ground cover, scattered blades",
  coral: "a densely branching reef form with blunt tips",
});

export const FLORA_SYSTEM_PROMPT = `
You are designing plants for a stylised procedural island. Return exactly one
JSON object with a "candidates" array containing three distinct plants.

Each candidate:
{
  "name": "Short evocative name, one word is ideal",
  "archetype": one of ${FLORA_ARCHETYPES.map((key) => `"${key}"`).join(" | ")},
  "seed": integer,
  "shape": { ...fields for the chosen archetype only... },
  "motion": {
    "wind": 0-2,
    "touchStrength": 0.1-2,
    "touchStiffness": 8-80,
    "touchDamping": 2-24,
    "maxLean": 0.03-0.45
  }
}

What each archetype is:
${FLORA_ARCHETYPES.map((key) => `- "${key}" — ${ARCHETYPE_CHARACTER[key]}`).join("\n")}

Shape fields, per archetype. Use only the fields for the archetype you chose:
${FLORA_ARCHETYPES.map(describeArchetype).join("\n")}

Design rules:
- Colour is NOT yours to choose. A plant takes the palette of the field it
  grows in, so describe shape and movement only. There is no palette field.
- The three candidates should be genuinely different plants, not one plant at
  three sizes. Prefer three different archetypes when the request allows it.
- Wind should suit the mass: a tree barely moves (0.1-0.4), a groundcover
  whips (0.9-1.5).
- Keep silhouettes readable and rounded. This world is cute, never spiky or
  menacing.
- Do not include prose, markdown, comments, or fields outside the schema.
`.trim();

function looksLikeFlora(parsed) {
  return (
    typeof parsed.archetype === "string" ||
    (isRecord(parsed.shape) && typeof parsed.name === "string")
  );
}

function normalizeFloraCandidate(raw, index, description, origin = "model") {
  const source = {
    ...(isRecord(raw) ? raw : {}),
    seed: Number.isFinite(Number(raw?.seed))
      ? Number(raw.seed) >>> 0
      : hashText(`${description}/flora/${index}`),
    name:
      typeof raw?.name === "string" && raw.name.trim()
        ? raw.name.trim().slice(0, 48)
        : `Field Plant ${index + 1}`,
  };
  const { dna, notes } = normalizeFloraDNA(source);
  return Object.freeze({
    source: origin,
    key: slugify(source.name, `field-plant-${index + 1}`),
    dna,
    // `notes` is what the flora normalizer calls its repairs; the studio shows
    // them the same way it shows a creature's.
    repairs: Object.freeze([...notes]),
    genomeHash: hashText(JSON.stringify(dna)).toString(16).padStart(8, "0"),
  });
}

export function extractFloraCandidates(text, description = "") {
  let rawCandidates;
  try {
    const payload = findJsonPayload(text, "plant DNA");
    rawCandidates = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.candidates)
        ? payload.candidates
        : [payload];
  } catch {
    rawCandidates = candidateFragments(text, looksLikeFlora);
  }
  if (!Array.isArray(rawCandidates) || rawCandidates.length === 0) {
    rawCandidates = candidateFragments(text, looksLikeFlora);
  }
  if (rawCandidates.length === 0) {
    throw new Error("No plant DNA found in the reply.");
  }
  return rawCandidates
    .slice(0, 3)
    .map((candidate, index) =>
      normalizeFloraCandidate(candidate, index, description, "model"),
    );
}

/**
 * The field's own grammar, for when no local model answers.
 *
 * Three different archetypes chosen from the description, each rolled inside
 * its own limits — so the fallback produces the same kind of variety the
 * roster does rather than three tweaks of one default.
 */
export function createProceduralFloraStudies(description) {
  const seed = hashText(String(description ?? "field plant"));
  const pool = [...FLORA_ARCHETYPES];
  const chosen = [];
  for (let index = 0; index < 3 && pool.length > 0; index++) {
    const pick = (seed >>> (index * 5)) % pool.length;
    chosen.push(pool.splice(pick, 1)[0]);
  }
  return chosen.map((archetype, index) => {
    const limits = ARCHETYPE_SHAPE_LIMITS[archetype];
    const defaults = ARCHETYPE_SHAPE_DEFAULTS[archetype];
    const shape = {};
    let cursor = hashText(`${description}/${archetype}`);
    for (const [field, [low, high, integer]] of Object.entries(limits)) {
      // A small deterministic walk, biased toward the archetype's own default
      // so the study still reads as that kind of plant.
      cursor = Math.imul(cursor ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
      const unit = (cursor % 1024) / 1024;
      const centre = defaults[field] ?? (low + high) / 2;
      const value = centre + (unit - 0.5) * (high - low) * 0.55;
      const clamped = Math.min(high, Math.max(low, value));
      shape[field] = integer ? Math.round(clamped) : clamped;
    }
    return normalizeFloraCandidate(
      {
        name: `${archetype[0].toUpperCase()}${archetype.slice(1)} Study ${index + 1}`,
        archetype,
        seed: hashText(`${description}/seed/${archetype}`),
        shape,
      },
      index,
      description,
      "grammar",
    );
  });
}

function fillFloraCandidateSet(candidates, description) {
  if (candidates.length >= 3) return candidates.slice(0, 3);
  const filler = createProceduralFloraStudies(description);
  const merged = [...candidates];
  for (const candidate of filler) {
    if (merged.length >= 3) break;
    if (merged.some((entry) => entry.genomeHash === candidate.genomeHash)) continue;
    merged.push(candidate);
  }
  return merged.slice(0, 3);
}

export async function requestFloraCandidates(description, options = {}) {
  const { text, prompt } = await requestAuthoringReply(description, {
    ...options,
    systemPrompt: FLORA_SYSTEM_PROMPT,
    tooShort: "Describe the plant in a little more detail.",
  });
  return fillFloraCandidateSet(extractFloraCandidates(text, prompt), prompt);
}

const SHELF = {
  storageKey: FLORA_AUTHORING_STORAGE_KEY,
  limit: FLORA_AUTHORING_LIMIT,
  normalize: normalizeFloraCandidate,
  extraFields: (entry) => ({ key: entry.key }),
};

export function loadAuthoredFlora(storage = globalThis.localStorage) {
  return loadAuthoredEntries(SHELF, storage);
}

export function saveAuthoredFlora(candidate, prompt, storage = globalThis.localStorage) {
  return saveAuthoredEntry(SHELF, candidate, prompt, storage);
}
