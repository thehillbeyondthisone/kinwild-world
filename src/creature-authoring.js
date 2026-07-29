import {
  normalizeWalkerDNA,
  seededUnit,
} from "./generated-fauna/dna.js";
import {
  candidateFragments,
  findJsonPayload,
  hashText,
  isRecord,
  listAuthoringModels,
  loadAuthoredEntries,
  requestAuthoringReply,
  saveAuthoredEntry,
  slugify,
} from "./authoring-shared.js";

export { listAuthoringModels };

export const CREATURE_AUTHORING_STORAGE_KEY = "living-field:authored-forms:v1";
export const CREATURE_AUTHORING_LIMIT = 8;

const SYSTEM_PROMPT = `
You are designing small, seamless, primitive-bodied creatures for a polished
procedural living world. Return exactly one JSON object with a "candidates"
array containing three distinct creature DNA objects.

Each candidate must use this schema:
{
  "schemaVersion": 1,
  "speciesId": "lowercase-kebab-id",
  "name": "Short evocative name",
  "seed": integer,
  "palette": {
    "body": "#rrggbb",
    "head": "#rrggbb",
    "limb": "#rrggbb",
    "eye": "#rrggbb",
    "pupil": "#rrggbb"
  },
  "body": { "radius": 0.16-0.46, "halfLength": 0.08-0.42 },
  "head": {
    "radius": 0.10-0.34,
    "offset": [x -0.35..0.35, y -0.10..0.55, z -0.10..0.70],
    "eyeRadius": 0.022-0.09
  },
  "legs": {
    "count": 2 | 4 | 6,
    "length": 0.24-0.78,
    "thickness": 0.035-0.13,
    "stance": 0.10-0.38,
    "spread": 0.08-0.42
  },
  "motion": {
    "stepDuration": 0.14-0.50,
    "stepTrigger": 0.07-0.28,
    "lift": 0.025-0.18,
    "bob": 0-0.05
  }
}

Design rules:
- Preserve a clear face and a readable silhouette at thumbnail size.
- The three candidates should interpret the request differently, not merely
  recolor the same anatomy.
- Keep the head overlapping the front/top of the body so it fuses visually.
- Match proportions and gait to the implied temperament and weight.
- Use harmonious palettes with strong eye/pupil contrast.
- Do not include prose, markdown, comments, or fields outside the schema.
`.trim();

function looksLikeCreature(parsed) {
  return (
    typeof parsed.name === "string" &&
    isRecord(parsed.body) &&
    isRecord(parsed.legs)
  );
}

function normalizeCandidate(raw, index, description, origin = "model") {
  const seed = Number.isFinite(Number(raw?.seed))
    ? Number(raw.seed) >>> 0
    : hashText(`${description}/${index}`);
  const source = {
    ...(isRecord(raw) ? raw : {}),
    seed,
    name:
      typeof raw?.name === "string" && raw.name.trim()
        ? raw.name.trim().slice(0, 48)
        : `Field Form ${index + 1}`,
  };
  source.speciesId = slugify(source.speciesId ?? source.name, `field-form-${index + 1}`);
  const normalized = normalizeWalkerDNA(source);
  return Object.freeze({
    source: origin,
    dna: normalized.dna,
    repairs: Object.freeze([...normalized.repairs]),
    primitiveCount: normalized.primitiveCount,
    genomeHash: normalized.genomeHash,
  });
}

export function extractCreatureCandidates(text, description = "") {
  let rawCandidates;
  try {
    const parsed = findJsonPayload(text, "creature DNA");
    rawCandidates = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.candidates)
        ? parsed.candidates
        : [parsed];
  } catch (error) {
    rawCandidates = candidateFragments(text, looksLikeCreature);
    if (rawCandidates.length === 0) throw error;
  }
  if (rawCandidates.length === 0) throw new Error("The model returned no creature candidates.");
  return rawCandidates
    .slice(0, 3)
    .map((candidate, index) =>
      normalizeCandidate(candidate, index, description, "model"),
    );
}

export async function requestCreatureCandidates(description, options = {}) {
  const { text, prompt } = await requestAuthoringReply(description, {
    ...options,
    systemPrompt: SYSTEM_PROMPT,
    tooShort: "Describe the creature in a little more detail.",
  });
  return fillCandidateSet(extractCreatureCandidates(text, prompt), prompt);
}

function paletteFor(seed, index) {
  const hue = seededUnit(seed, `palette/${index}`) * 360;
  const accent = (hue + 38 + seededUnit(seed, `accent/${index}`) * 74) % 360;
  const shadow = (hue + 204) % 360;
  return {
    body: `hsl(${hue.toFixed(0)} 72% 61%)`,
    head: `hsl(${accent.toFixed(0)} 82% 65%)`,
    limb: `hsl(${shadow.toFixed(0)} 42% 34%)`,
    eye: "#fff5d8",
    pupil: "#15152a",
  };
}

function hslToHex(value) {
  const match = String(value).match(
    /hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)/i,
  );
  if (!match) return value;
  const h = Number(match[1]) / 360;
  const s = Number(match[2]) / 100;
  const l = Number(match[3]) / 100;
  const hue = (p, q, t) => {
    let n = t;
    if (n < 0) n += 1;
    if (n > 1) n -= 1;
    if (n < 1 / 6) return p + (q - p) * 6 * n;
    if (n < 1 / 2) return q;
    if (n < 2 / 3) return p + (q - p) * (2 / 3 - n) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channels = s === 0
    ? [l, l, l]
    : [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)];
  return `#${channels
    .map((channel) => Math.round(channel * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Deterministic non-LLM studies keep the studio useful when no local model is
 * running. They are explicitly labelled procedural in the UI.
 */
export function createProceduralStudies(description) {
  const prompt = String(description ?? "field creature").trim();
  const baseSeed = hashText(prompt);
  const legCounts = [2, 4, 6];
  return legCounts.map((legCount, index) => {
    const seed = (baseSeed + Math.imul(index + 1, 0x9e3779b9)) >>> 0;
    const palette = Object.fromEntries(
      Object.entries(paletteFor(seed, index)).map(([key, value]) => [
        key,
        hslToHex(value),
      ]),
    );
    const bodyRadius = 0.25 + seededUnit(seed, "body") * 0.16;
    const raw = {
      schemaVersion: 1,
      speciesId: `study-${index + 1}-${slugify(prompt, "field-form").slice(0, 28)}`,
      name: ["Quiet Strider", "Mossback Drifter", "Manyfoot Gleam"][index],
      seed,
      palette,
      body: {
        radius: bodyRadius,
        halfLength: 0.13 + seededUnit(seed, "length") * 0.25,
      },
      head: {
        radius: bodyRadius * (0.58 + seededUnit(seed, "head") * 0.26),
        offset: [0, bodyRadius * 0.46, bodyRadius * 1.08],
        eyeRadius: bodyRadius * (0.13 + seededUnit(seed, "eyes") * 0.08),
      },
      legs: {
        count: legCount,
        length: 0.34 + seededUnit(seed, "legs") * 0.35,
        thickness: 0.045 + seededUnit(seed, "thickness") * 0.055,
        stance: 0.15 + seededUnit(seed, "stance") * 0.16,
        spread: 0.12 + seededUnit(seed, "spread") * 0.25,
      },
      motion: {
        stepDuration: 0.2 + seededUnit(seed, "tempo") * 0.2,
        stepTrigger: 0.09 + seededUnit(seed, "trigger") * 0.12,
        lift: 0.045 + seededUnit(seed, "lift") * 0.1,
        bob: seededUnit(seed, "bob") * 0.04,
      },
    };
    return normalizeCandidate(raw, index, prompt, "procedural");
  });
}

function fillCandidateSet(candidates, description) {
  if (candidates.length >= 3) return candidates.slice(0, 3);
  const studies = createProceduralStudies(description);
  const hashes = new Set(candidates.map((candidate) => candidate.genomeHash));
  for (const study of studies) {
    if (candidates.length >= 3) break;
    if (hashes.has(study.genomeHash)) continue;
    candidates.push(study);
    hashes.add(study.genomeHash);
  }
  return candidates;
}

const SHELF = {
  storageKey: CREATURE_AUTHORING_STORAGE_KEY,
  limit: CREATURE_AUTHORING_LIMIT,
  normalize: normalizeCandidate,
  extraFields: (entry) => ({ primitiveCount: entry.primitiveCount }),
};

export function loadAuthoredForms(storage = globalThis.localStorage) {
  return loadAuthoredEntries(SHELF, storage);
}

export function saveAuthoredForm(candidate, prompt, storage = globalThis.localStorage) {
  return saveAuthoredEntry(SHELF, candidate, prompt, storage);
}
