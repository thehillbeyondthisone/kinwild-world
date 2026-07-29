/**
 * The parts of authoring that do not care what is being authored.
 *
 * Creature and flora authoring differ only in their schema prompt, their
 * normalizer and their fallback grammar. Everything else — coaxing JSON out of
 * a local model's reply, talking to LM Studio, and the saved-forms shelf — is
 * the same problem twice, and the recovery logic in particular is not worth
 * writing twice: it was hardened against real model output (numbers as quoted
 * strings, trailing commas, truncated replies) and that hardening should apply
 * to plants for free.
 *
 * DOM-free apart from an injectable `localStorage`.
 */

export function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function hashText(value) {
  let hash = 0x811c9dc5;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function slugify(value, fallback = "new-form") {
  const slug = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  return slug || fallback;
}

/**
 * Pull the first JSON object or array out of a reply, tolerating a code fence
 * and the trailing commas local models like to emit.
 */
export function findJsonPayload(text, label = "DNA") {
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
  if (start < 0 || end <= start) throw new Error(`No ${label} found in the reply.`);
  const raw = source.slice(start, end + 1);
  try {
    return JSON.parse(raw);
  } catch {
    return JSON.parse(raw.replace(/,(?=\s*[}\]])/g, ""));
  }
}

/**
 * Best-effort recovery when the reply as a whole will not parse: walk the text
 * for balanced brace pairs and keep the fragments that look like candidates.
 *
 * @param {string} text
 * @param {(parsed: object) => boolean} looksLikeCandidate
 */
export function candidateFragments(text, looksLikeCandidate) {
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
      if (isRecord(parsed) && looksLikeCandidate(parsed)) candidates.push(parsed);
    } catch {
      // Nested fragments are best-effort recovery for truncated model replies.
    }
  }
  return candidates;
}

export async function listAuthoringModels(endpoint = "/llm/v1/models") {
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error(`Model list returned ${response.status}.`);
  const body = await response.json();
  return (body?.data ?? [])
    .map((model) => model?.id)
    .filter((id) => typeof id === "string" && id && !/embed/i.test(id));
}

/**
 * Ask the local model for candidates and hand the raw reply text back. The
 * caller owns parsing, because that is the schema-specific half.
 */
export async function requestAuthoringReply(
  description,
  {
    systemPrompt,
    endpoint = "/llm/v1/chat/completions",
    model = "",
    signal,
    temperature = 0.92,
    maxTokens = 1100,
    tooShort = "Describe it in a little more detail.",
  },
) {
  const prompt = String(description ?? "").trim();
  if (prompt.length < 3) throw new Error(tooShort);
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
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
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
  return { text, prompt };
}

/**
 * The saved-forms shelf. Entries are re-normalized on load, so a genome saved
 * before a schema change comes back repaired rather than broken.
 */
export function loadAuthoredEntries(
  { storageKey, limit, normalize },
  storage = globalThis.localStorage,
) {
  if (!storage?.getItem) return [];
  try {
    const parsed = JSON.parse(storage.getItem(storageKey) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, limit).map((entry, index) => {
      const normalized = normalize(entry?.dna, index, entry?.prompt ?? "", "saved");
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

export function saveAuthoredEntry(
  { storageKey, limit, normalize, extraFields = () => ({}) },
  candidate,
  prompt,
  storage = globalThis.localStorage,
) {
  if (!storage?.setItem) return [];
  const current = loadAuthoredEntries({ storageKey, limit, normalize }, storage);
  const deduped = current.filter(
    (entry) => entry.genomeHash !== candidate.genomeHash,
  );
  deduped.unshift({
    dna: candidate.dna,
    prompt: String(prompt ?? "").trim().slice(0, 500),
    createdAt: Date.now(),
    repairs: candidate.repairs,
    genomeHash: candidate.genomeHash,
    ...extraFields(candidate),
  });
  const limited = deduped.slice(0, limit);
  storage.setItem(
    storageKey,
    JSON.stringify(
      limited.map((entry) => ({
        dna: entry.dna,
        prompt: entry.prompt,
        createdAt: entry.createdAt,
        repairs: entry.repairs,
        genomeHash: entry.genomeHash,
        ...extraFields(entry),
      })),
    ),
  );
  return limited;
}
