/**
 * A genome being edited.
 *
 * The editor is a card with controls on it, but almost nothing it does is
 * really about the DOM: it takes a canonical genome, applies one change,
 * hands the whole thing back to the normalizer, and then has to work out what
 * the normalizer did about it. That last part is the interesting one, and it
 * is all here so it can be tested without a browser.
 *
 * Two properties make this simple, and both are worth stating because the
 * rest of the module leans on them:
 *
 * 1. **Normalization is idempotent.** A canonical genome re-normalizes to
 *    itself in silence. So every repair note on the board after an edit was
 *    caused by *that edit* — there is no accumulated backlog to filter out,
 *    and a note can be shown next to the field the player just moved without
 *    lying about why it appeared.
 * 2. **Repair notes name their field.** Both normalizers write a dotted path
 *    at the front of the note. Matching that path against the schema is what
 *    turns a list of notes into marginalia in the right margins.
 *
 * The one thing the editor must never do is re-implement a bound. The
 * normalizer is the authority; this module only asks it questions.
 */

import { hashText } from "../authoring-shared.js";
import { normalizeWalkerDNA } from "../generated-fauna/dna.js";
import { normalizeFloraDNA } from "../generated-flora/dna.js";
import { describeGenome, genomeKind, readGenomePath } from "./genome-schema.js";
import { phraseRepair } from "./genome-voice.js";

/**
 * The 8-hex-character genome fingerprint.
 *
 * Deliberately the same expression the fauna normalizer and the flora
 * authoring path already use, so a hash minted here matches the one a genome
 * arrived with and the saved-forms shelf keeps deduplicating correctly.
 */
export function genomeFingerprint(dna) {
  return hashText(JSON.stringify(dna)).toString(16).padStart(8, "0");
}

/** Run the right normalizer and report its findings in one shape. */
export function normalizeGenome(raw, kind = genomeKind(raw)) {
  if (kind === "flora") {
    const { dna, notes } = normalizeFloraDNA(raw);
    return { kind, dna, repairs: notes, genomeHash: genomeFingerprint(dna) };
  }
  if (kind === "fauna") {
    const { dna, repairs, primitiveCount, genomeHash } = normalizeWalkerDNA(raw);
    return { kind, dna, repairs, genomeHash, primitiveCount };
  }
  throw new TypeError("normalizeGenome: not a recognised genome");
}

/** Deep structural copy of a frozen genome, so an edit has somewhere to land. */
function thaw(value) {
  if (Array.isArray(value)) return value.map(thaw);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value)) out[key] = thaw(child);
    return out;
  }
  return value;
}

/** Write a dotted path, creating plain objects as it goes. Numeric segments index arrays. */
export function writeGenomePath(target, path, value) {
  const keys = String(path).split(".");
  let cursor = target;
  for (let index = 0; index < keys.length - 1; index++) {
    const key = keys[index];
    if (cursor[key] === null || typeof cursor[key] !== "object") cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[keys[keys.length - 1]] = value;
  return target;
}

/**
 * The path a repair note is talking about, resolved against the schema.
 *
 * Notes lead with a dotted path followed by either a colon (`"legs.thickness:
 * reduced…"`) or a space (`"shape.height clamped to 8.5"`), so the leading
 * token is the candidate. It is only accepted if the schema actually has
 * something by that name — which is what keeps `"unknown flora archetype…"`
 * and `"invalid name -> …"` from being mistaken for fields called "unknown"
 * and "invalid".
 *
 * `head.offset` names a vec3 that the schema splits into three rows, so a
 * token with no exact match falls back to the first field beneath it.
 */
export function repairTarget(note, index) {
  const match = /^([A-Za-z_$][\w$]*(?:\.[\w$]+)*)[: ]/.exec(String(note));
  if (!match) return null;
  const token = match[1];
  if (index.fields.has(token)) return token;
  if (index.sections.has(token)) return token;
  const prefix = `${token}.`;
  for (const path of index.fields) {
    if (path.startsWith(prefix)) return path;
  }
  return null;
}

/** Every path the schema can be addressed by, for `repairTarget` to match on. */
function pathIndex(sections) {
  const fields = new Set();
  const knownSections = new Set();
  for (const section of sections) {
    if (section.path) knownSections.add(section.path);
    for (const field of section.fields) fields.add(field.path);
  }
  return { fields, sections: knownSections };
}

/**
 * Sort repair notes into the margins they belong in.
 *
 * Anything that names a field becomes marginalia beside that field; anything
 * about the genome as a whole (it was not an object, the archetype was not one
 * we know) is a note on the card itself. Every note is phrased before it is
 * filed — a raw note never reaches this module's callers.
 */
export function attributeRepairs(notes, sections, editedPath = null) {
  const index = pathIndex(sections);
  const byPath = new Map();
  const general = [];
  for (const note of notes ?? []) {
    const phrase = phraseRepair(note);
    let path = repairTarget(note, index);
    // A note can name a whole section ("variation scale range reordered"),
    // but no row answers to a section path — syncRow looks fields up. File it
    // beside the field that caused it when that field lives in the section,
    // else beside the section's first field. Only a fieldless section falls
    // through to the card's own notes.
    if (path && index.sections.has(path) && !index.fields.has(path)) {
      path = fieldInSection(path, editedPath, sections, index);
    }
    if (!path) {
      if (!general.includes(phrase)) general.push(phrase);
      continue;
    }
    const existing = byPath.get(path);
    if (!existing) byPath.set(path, [phrase]);
    else if (!existing.includes(phrase)) existing.push(phrase);
  }
  return { byPath, general };
}

/**
 * The row a section-level note should sit beside: the field the player just
 * moved when it belongs to the section (that is the row they are looking at,
 * and it is the field that caused the repair), otherwise the section's first
 * field. Returns null when the section has no rows at all.
 */
function fieldInSection(sectionPath, editedPath, sections, index) {
  if (editedPath && editedPath.startsWith(`${sectionPath}.`) && index.fields.has(editedPath)) {
    return editedPath;
  }
  const section = sections.find((entry) => entry.path === sectionPath);
  return section && section.fields.length ? section.fields[0].path : null;
}

/**
 * The part of a control's track the genome can actually reach right now.
 *
 * A relational bound is not a second clamp, it is the same rule the normalizer
 * applies stated ahead of time: a leg may be no thicker than a quarter of its
 * own length, so on a short-legged creature most of the thickness track is
 * simply not available. Handing that back lets the control draw the
 * unreachable stretch instead of silently taking the value back afterwards.
 */
export function fieldRange(field, dna) {
  const { lo, hi } = field;
  const bound = field.boundBy;
  if (!bound) return { lo, hi, ceiling: hi, bounded: false };
  const base = readGenomePath(dna, bound.path);
  if (!Number.isFinite(base)) return { lo, hi, ceiling: hi, bounded: false };
  const ceiling = Math.min(hi, base * bound.factor);
  return { lo, hi, ceiling, bounded: ceiling < hi - 1e-9, boundedBy: bound.path };
}

/** Where a value sits on its track, 0..1. */
export function trackFraction(value, lo, hi) {
  if (!Number.isFinite(value) || !(hi > lo)) return 0;
  return Math.min(1, Math.max(0, (value - lo) / (hi - lo)));
}

/** Every numeric field, flattened, so two genomes can be compared field by field. */
function numericPaths(sections) {
  const paths = [];
  for (const section of sections) {
    for (const field of section.fields) {
      if (field.control === "slider" || field.control === "stepper") paths.push(field.path);
    }
  }
  return paths;
}

/**
 * Fields that moved on their own.
 *
 * Editing a leg's length can shorten its thickness, because the thickness
 * bound is written in terms of the length. The player did not touch thickness,
 * so the card marks it as having moved by itself — which is the whole lesson
 * about relational bounds, delivered by watching rather than by being told.
 */
function movedFields(before, after, sections, editedPath) {
  const moved = [];
  for (const path of numericPaths(sections)) {
    if (path === editedPath) continue;
    const was = readGenomePath(before, path);
    const now = readGenomePath(after, path);
    if (Number.isFinite(was) && Number.isFinite(now) && Math.abs(was - now) > 1e-9) {
      moved.push(path);
    }
  }
  return moved;
}

function buildDraft(kind, normalized, { edited, editedPath = null, previousDna = null }) {
  const described = describeGenome(normalized.dna);
  const { byPath, general } = attributeRepairs(normalized.repairs, described.sections, editedPath);
  return Object.freeze({
    kind,
    label: described.label,
    dna: normalized.dna,
    genomeHash: normalized.genomeHash,
    primitiveCount: normalized.primitiveCount ?? null,
    sections: described.sections,
    repairs: Object.freeze([...(normalized.repairs ?? [])]),
    marginalia: byPath,
    notes: Object.freeze(general),
    // Paths the player has moved at least once this session. Purely a mark in
    // the margin; nothing branches on it.
    edited,
    editedPath,
    moved: Object.freeze(
      previousDna ? movedFields(previousDna, normalized.dna, described.sections, editedPath) : [],
    ),
  });
}

/**
 * Begin editing a genome.
 *
 * The genome is normalized on the way in even when it arrived canonical: that
 * costs nothing, and it means a draft always describes something the field
 * could actually grow.
 */
export function createGenomeDraft(raw) {
  const kind = genomeKind(raw);
  if (!kind) throw new TypeError("createGenomeDraft: not a recognised genome");
  return buildDraft(kind, normalizeGenome(raw, kind), { edited: new Set() });
}

/**
 * Apply one change and let the normalizer have the last word.
 *
 * The returned draft always describes the genome as it *settled*, not as it
 * was asked for. A control that overshot a bound will find its own value
 * pulled back when it re-reads the draft, with the note explaining why sitting
 * in `marginalia` under its path.
 */
export function editGenomeDraft(draft, path, value) {
  const next = thaw(draft.dna);
  writeGenomePath(next, path, value);
  const edited = new Set(draft.edited);
  edited.add(path);
  return buildDraft(draft.kind, normalizeGenome(next, draft.kind), {
    edited,
    editedPath: path,
    previousDna: draft.dna,
  });
}

/** Whether the draft still describes the genome it started from. */
export function draftIsDirty(draft, originalHash) {
  return draft.genomeHash !== originalHash;
}

// ── The writing face ──────────────────────────────────────────────────────

/**
 * The genome as a written document.
 *
 * Real JSON — `JSON.parse` of the joined text returns the genome — because the
 * claim the card is making is that this *is* the creature, not a rendering of
 * it. Two deliberate choices about how it is set:
 *
 * - **Keys stay in the order the normalizer wrote them.** Sorting them would
 *   be more canonical and much less legible; a genome that opens with its name
 *   and its archetype reads as a description, and one that opens with
 *   `archetype, motion, name` reads as a data structure. The hash is taken
 *   over the canonical form regardless, so nothing depends on this order.
 * - **Arrays are set inline.** A head offset is one fact about where the head
 *   sits, and giving it three lines of its own would pad the document by the
 *   better part of a tenth for no gain. The line count is the argument this
 *   page is making, so it should not be inflated by punctuation.
 */
export function genomeDocument(dna) {
  const lines = [];
  emitLines(lines, dna, 0, null, "", false);
  const text = lines.map((line) => "  ".repeat(line.indent) + line.text).join("\n");
  return { lines: Object.freeze(lines), text, count: lines.length };
}

function inlineArray(values) {
  return `[${values.map((entry) => JSON.stringify(entry)).join(", ")}]`;
}

function emitLines(out, value, indent, key, path, comma) {
  const label = key === null ? "" : `${JSON.stringify(key)}: `;
  const tail = comma ? "," : "";
  if (Array.isArray(value)) {
    out.push({ kind: "leaf", indent, key, path, text: label + inlineArray(value) + tail });
    return;
  }
  if (value && typeof value === "object") {
    out.push({ kind: "open", indent, key, path, text: `${label}{` });
    const keys = Object.keys(value);
    keys.forEach((child, index) => {
      emitLines(
        out,
        value[child],
        indent + 1,
        child,
        path ? `${path}.${child}` : child,
        index < keys.length - 1,
      );
    });
    out.push({ kind: "close", indent, key: null, path, text: `}${tail}` });
    return;
  }
  out.push({
    kind: "leaf",
    indent,
    key,
    path,
    value,
    numeric: typeof value === "number",
    text: label + JSON.stringify(value) + tail,
  });
}

const ONES = Object.freeze([
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
  "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
  "sixteen", "seventeen", "eighteen", "nineteen",
]);
const TENS = Object.freeze([
  "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
]);

/**
 * A small number written out in words.
 *
 * The caption under the writing face says "thirty-one lines" rather than
 * "31 lines" for the same reason the notes are phrased rather than printed:
 * the page is a field notebook, and a notebook writes short numbers out.
 */
export function spellNumber(value) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < 0 || n > 99) return String(value);
  if (n < 20) return ONES[n];
  const tens = TENS[Math.floor(n / 10)];
  const ones = n % 10;
  return ones ? `${tens}-${ONES[ones]}` : tens;
}
