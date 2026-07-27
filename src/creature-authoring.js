import {
  normalizeWalkerDNA,
  seededUnit,
} from "./generated-fauna/dna.js";

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

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hashText(value) {
  let hash = 0x811c9dc5;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function slugify(value, fallback = "new-form") {
  const slug = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  return slug || fallback;
}

function findJsonPayload(text) {
  const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced ? fenced[1] : String(text);
  const objectStart = source.indexOf("{");
  const arrayStart = source.indexOf("[");
  let start = -1;
  let end = -1;
  if (objectStart >= 0 && (arrayStart < 0 || objectStart < arrayStart)) {
    start = objectStart;
    end = source.lastIndexOf("}");
  } else if (arrayStart >= 0) {
    start = arrayStart;
    end = source.lastIndexOf("]");
  }
  if (start < 0 || end <= start) throw new Error("No creature DNA found in the reply.");
  const raw = source.slice(start, end + 1);
  try {
    return JSON.parse(raw);
  } catch {
    return JSON.parse(raw.replace(/,(?=\s*[}\]])/g, ""));
  }
}

function candidateFragments(text) {
  const source = String(text);
  const starts = [];
  const candidates = [];
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quoted) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        quoted = false;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === "{") {
      starts.push(index);
      continue;
    }
    if (character !== "}" || starts.length === 0) continue;
    const start = starts.pop();
    try {
      const parsed = JSON.parse(
        source.slice(start, index + 1).replace(/,(?=\s*[}\]])/g, ""),
      );
      if (
        isRecord(parsed) &&
        typeof parsed.name === "string" &&
        isRecord(parsed.body) &&
        isRecord(parsed.legs)
      ) {
        candidates.push(parsed);
      }
    } catch {
      // Nested fragments are best-effort recovery for truncated model replies.
    }
  }
  return candidates;
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
    const parsed = findJsonPayload(text);
    rawCandidates = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.candidates)
        ? parsed.candidates
        : [parsed];
  } catch (error) {
    rawCandidates = candidateFragments(text);
    if (rawCandidates.length === 0) throw error;
  }
  if (rawCandidates.length === 0) throw new Error("The model returned no creature candidates.");
  return rawCandidates
    .slice(0, 3)
    .map((candidate, index) =>
      normalizeCandidate(candidate, index, description, "model"),
    );
}

export async function listAuthoringModels(endpoint = "/llm/v1/models") {
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error(`Model list returned ${response.status}.`);
  const body = await response.json();
  return (body?.data ?? [])
    .map((model) => model?.id)
    .filter((id) => typeof id === "string" && id && !/embed/i.test(id));
}

export async function requestCreatureCandidates(
  description,
  {
    endpoint = "/llm/v1/chat/completions",
    model = "",
    signal,
  } = {},
) {
  const prompt = String(description ?? "").trim();
  if (prompt.length < 3) throw new Error("Describe the creature in a little more detail.");
  let resolvedModel = model;
  if (!resolvedModel) {
    const available = await listAuthoringModels();
    resolvedModel = available[0] ?? "";
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      model: resolvedModel,
      temperature: 0.92,
      max_tokens: 1100,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (response.status >= 500) {
    throw new Error("The local authoring model is not reachable.");
  }
  if (!response.ok) {
    let detail;
    try {
      const rawError = await response.text();
      try {
        const errorBody = JSON.parse(rawError);
        detail = String(errorBody?.error?.message ?? errorBody?.message ?? rawError);
      } catch {
        detail = rawError;
      }
    } catch {
      detail = "";
    }
    throw new Error(
      detail
        ? `The authoring model returned ${response.status}: ${detail.slice(0, 140)}`
        : `The authoring model returned ${response.status}.`,
    );
  }
  const body = await response.json();
  const text = body?.choices?.[0]?.message?.content;
  if (!text) throw new Error("The authoring model returned an empty reply.");
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

export function loadAuthoredForms(storage = globalThis.localStorage) {
  if (!storage?.getItem) return [];
  try {
    const parsed = JSON.parse(storage.getItem(CREATURE_AUTHORING_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .slice(0, CREATURE_AUTHORING_LIMIT)
      .map((entry, index) => {
        const normalized = normalizeCandidate(
          entry?.dna,
          index,
          entry?.prompt ?? "",
          "saved",
        );
        return {
          prompt: String(entry?.prompt ?? ""),
          createdAt: Number(entry?.createdAt) || 0,
          ...normalized,
          repairs: Object.freeze(
            Array.isArray(entry?.repairs)
              ? entry.repairs.map(String)
              : [...normalized.repairs],
          ),
        };
      });
  } catch {
    return [];
  }
}

export function saveAuthoredForm(
  candidate,
  prompt,
  storage = globalThis.localStorage,
) {
  if (!storage?.setItem) return [];
  const current = loadAuthoredForms(storage);
  const deduped = current.filter(
    (entry) => entry.genomeHash !== candidate.genomeHash,
  );
  deduped.unshift({
    dna: candidate.dna,
    prompt: String(prompt ?? "").trim().slice(0, 500),
    createdAt: Date.now(),
    repairs: candidate.repairs,
    primitiveCount: candidate.primitiveCount,
    genomeHash: candidate.genomeHash,
  });
  const limited = deduped.slice(0, CREATURE_AUTHORING_LIMIT);
  storage.setItem(
    CREATURE_AUTHORING_STORAGE_KEY,
    JSON.stringify(
      limited.map((entry) => ({
        dna: entry.dna,
        prompt: entry.prompt,
        createdAt: entry.createdAt,
        repairs: entry.repairs,
      })),
    ),
  );
  return limited;
}
