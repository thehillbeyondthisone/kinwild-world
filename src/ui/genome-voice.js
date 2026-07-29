/**
 * Repair notes, said out loud.
 *
 * Both normalizers repair rather than reject, and each fix appends a short
 * technical note: `"legs.thickness: reduced to fit leg length"`. Those are
 * exactly the right *semantics* to show a player — every one of them is a
 * rule of the world, stated at the moment it applied to something the player
 * made — and exactly the wrong voice. Shown raw they read as validation
 * errors, and a field guide does not throw errors.
 *
 * So this restates them as a naturalist's marginalia. The rule is unchanged;
 * only the register moves. Nothing here decides anything — the normalizer has
 * already done the work by the time a note exists.
 *
 * DOM-free and pure, so the phrasing is testable on its own.
 */

/** Friendly nouns for the paths that come up in notes. */
const NOUNS = Object.freeze({
  // Palette first: "palette.body" would otherwise shorten to "the body" and
  // collide with the body's actual size. The sentence supplies "colour", so
  // the noun must not — "its body colour didn't read as a colour" is a
  // sentence that says the same word twice for no reason.
  "palette.body": "its body",
  "palette.head": "its head",
  "palette.limb": "its legs",
  "palette.eye": "the whites of its eyes",
  "palette.pupil": "its pupils",
  "body.radius": "the body",
  "body.halfLength": "the body's length",
  "head.radius": "the head",
  "head.eyeRadius": "the eyes",
  "head.offset": "the head's place on the body",
  "legs.length": "the legs",
  "legs.thickness": "the legs",
  "legs.stance": "how wide it stands",
  "legs.spread": "how far its legs sit apart",
  "motion.stepDuration": "the pace of a step",
  "motion.stepTrigger": "how far it drifts before stepping",
  "motion.lift": "how high it picks its feet up",
  "motion.bob": "its bob as it walks",
  "wings.span": "the wings",
  "wings.chord": "the wings' depth",
  "wings.beat": "the wingbeat",
  "wings.dihedral": "the angle of the wings",
  "shape.height": "its height",
  "shape.stemCount": "the stems",
  "shape.stemRadius": "the stems",
  "shape.capRadius": "the cap",
  "shape.capDepth": "the cap's depth",
  "shape.budRadius": "the buds",
  "shape.bloomRadius": "the blooms",
  "shape.clusterRadius": "the cluster",
  "shape.patchRadius": "the patch",
  "shape.bladeHeight": "the blades",
  "shape.bladeWidth": "the blades",
  "shape.leafRadius": "the leaves",
  "shape.frondLength": "the fronds",
  "shape.padRadius": "the pads",
  "motion.wind": "how it takes the wind",
  "motion.maxLean": "how far it leans",
  "motion.touchStrength": "how it answers a touch",
  "variation.scaleMin": "its smallest",
  "variation.scaleMax": "its largest",
});

/** "shape.stemRadius" -> "the stem radius". Last resort, still soft. */
function nounFor(path) {
  if (NOUNS[path]) return NOUNS[path];
  const leaf = String(path).split(".").pop();
  const words = leaf
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
  return `the ${words}`;
}

/** Trim a trailing zero-heavy decimal so the prose reads like speech. */
function tidy(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return String(Number(n.toPrecision(3)));
}

/**
 * Ordered patterns. First match wins, so the specific relational notes are
 * listed before the generic clamp that would otherwise swallow them.
 */
const PHRASINGS = [
  // --- relational constraints: the ones worth real character ---
  [
    /^legs\.thickness: reduced to fit leg length$/,
    () => "the legs came out sturdier than they were long — I slimmed them.",
  ],
  [
    /^head\.eyeRadius: reduced to fit head$/,
    () => "the eyes were bigger than the head could carry — I brought them in.",
  ],
  [
    /^wings\.span: reduced to fit the body$/,
    () => "the wings reached wider than that body could hang them — I drew them in.",
  ],
  [
    /^wings\.chord: reduced to fit the span$/,
    () => "the wings were deeper than their span could hold — I narrowed them.",
  ],

  // --- structure ---
  [
    /^legs\.count: repaired to (\d+)$/,
    (m) => `${m[1]} legs is what this body had room for.`,
  ],
  [
    /^locomotion: repaired to walker$/,
    () => "I couldn't tell how this one gets about, so it walks.",
  ],
  [
    /^root: expected object; used curated defaults$/,
    () => "there was nothing here to read, so I started from one I know.",
  ],
  [
    /^flora DNA was not an object -> defaults$/,
    () => "there was nothing here to read, so I started from one I know.",
  ],

  // --- naming ---
  [/^speciesId: expected string$/, () => "the species name wasn't written down, so it kept its own."],
  [/^speciesId: empty after normalization$/, () => "the species name came out empty, so it kept its own."],
  [/^speciesId: normalized to "(.+)"$/, (m) => `I tidied the species name to “${m[1]}”.`],
  [/^name: expected non-empty string$/, () => "it arrived unnamed, so it kept the name it had."],
  [/^invalid name -> archetype default$/, () => "it arrived unnamed, so it kept the name it had."],
  [/^name: trimmed to 64 characters$/, () => "the name ran long, so I shortened it."],
  [/^name truncated to 64 characters$/, () => "the name ran long, so I shortened it."],

  // --- flora identity ---
  [
    /^unknown flora archetype "(.*)" -> (\w+)$/,
    (m) => `I didn't know “${m[1]}”, so it grew as a ${m[2]}.`,
  ],
  // Emitted by `normalizeArchetype` when a role was offered as a shape hint,
  // so this is still about the silhouette it grew, not the tier it occupies.
  [
    /^unknown flora role "(.*)" -> (\w+)$/,
    (m) => `“${m[1]}” didn't tell me a shape, so it grew as a ${m[2]}.`,
  ],
  [
    /^paletteRoles\.(\w+) invalid -> (\w+)$/,
    (m) => `nothing answered to that ${m[1]} colour, so it took the ${m[2]}.`,
  ],
  [
    /^variation scale range reordered$/,
    () => "its smallest was larger than its largest, so I swapped the two.",
  ],

  // --- generic shapes, last ---
  [
    /^(.+): clamped to (.+)$/,
    (m) => `${nounFor(m[1])} settled at ${tidy(m[2])} — that's as far as this one goes.`,
  ],
  [
    /^(.+?) clamped to (.+)$/,
    (m) => `${nounFor(m[1])} settled at ${tidy(m[2])} — that's as far as this one goes.`,
  ],
  [
    /^(.+): expected finite number$/,
    (m) => `${nounFor(m[1])} wasn't a number I could use, so it kept the usual.`,
  ],
  [
    /^(.+?) invalid -> (.+)$/,
    (m) => `${nounFor(m[1])} wasn't something I could use, so it settled at ${tidy(m[2])}.`,
  ],
  [
    /^(.+): expected \[x, y, z\]$/,
    (m) => `${nounFor(m[1])} didn't read as a point, so it kept its usual place.`,
  ],
  [
    /^(.+): expected #rrggbb$/,
    (m) => `${nounFor(m[1])} didn't read as a colour, so it kept the one it had.`,
  ],
];

/** What a note becomes when no pattern claims it. Still a field note. */
export const GENERIC_PHRASING = "I made a small adjustment so this one would hold together.";

/**
 * Restate one repair note in the field guide's voice.
 *
 * @param {string} note a note from `normalizeWalkerDNA` or `normalizeFloraDNA`
 * @returns {string} prose, never a field path and never an error
 */
export function phraseRepair(note) {
  if (typeof note !== "string" || !note.trim()) return GENERIC_PHRASING;
  for (const [pattern, say] of PHRASINGS) {
    const match = note.match(pattern);
    if (match) return say(match);
  }
  return GENERIC_PHRASING;
}

/**
 * Phrase a whole batch, dropping duplicates.
 *
 * A resized genome routinely repairs the same thing on several fields; the
 * player wants to know what happened, not how many times.
 */
export function phraseRepairs(notes) {
  if (!Array.isArray(notes)) return [];
  const said = new Set();
  const out = [];
  for (const note of notes) {
    const phrase = phraseRepair(note);
    if (said.has(phrase)) continue;
    said.add(phrase);
    out.push(phrase);
  }
  return out;
}
