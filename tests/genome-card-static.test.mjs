// The genome card, asserted where it cannot be unit-tested.
//
// The card's logic lives in `genome-draft.js` and is covered properly by
// `genome-draft.test.mjs`. What is left here is markup and CSS, and the
// failure mode for those is not an exception — it is a card that still works
// and no longer feels like anything. So most of what follows guards *tone*,
// which this project treats as a constraint rather than an aspiration:
//
//   no monospace body text · no syntax colouring · no red · no disabled-
//   looking controls · the native range widget never visible
//
// Getting any of those wrong yields a JSON editor in a cute frame, which the
// design doc is explicit is worse than not shipping the feature at all.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const indexSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const cssSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");
const cardSource = readFileSync(new URL("../src/ui/genome-card.js", import.meta.url), "utf8");
const draftSource = readFileSync(new URL("../src/ui/genome-draft.js", import.meta.url), "utf8");
const observatorySource = readFileSync(
  new URL("../src/ui/observatory.js", import.meta.url),
  "utf8",
);

function ruleFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = cssSource.match(new RegExp(`(^|\\n)${escaped}\\s*\\{(?<body>[^}]*)\\}`, "m"));
  assert(match?.groups?.body, `Missing CSS rule for ${selector}.`);
  return match.groups.body;
}

// --- the shell exists, with two faces ---------------------------------------

assert(
  indexSource.includes('<section class="genome-card" id="genome-card"')
    && indexSource.includes('id="genome-face-page"')
    && indexSource.includes('id="genome-face-writing"')
    && indexSource.includes('id="genome-sections"')
    && indexSource.includes('id="genome-writing"'),
  "The genome card should ship both faces and the hosts its content is built into.",
);

assert(
  indexSource.includes('id="genome-flip-to-writing"')
    && indexSource.includes('id="genome-flip-to-page"'),
  "Both faces need a way back to the other one.",
);

// The card starts inert, like the studio, so a closed modal is not in the tab
// order and screen readers do not read a page nobody can see.
assert(
  indexSource.includes('<section class="genome-card" id="genome-card" aria-hidden="true" inert>')
    && indexSource.includes('<article class="genome-face genome-face-writing" id="genome-face-writing" inert>'),
  "The card and its hidden face should start inert.",
);

assert(
  indexSource.includes('<button class="obs-paper-action" id="obs-read-genome"'),
  "The specimen readout should offer the page it was read off.",
);

// --- it is a turn, not a tab -------------------------------------------------

const faces = ruleFor(".genome-leaf-faces");
assert(
  faces.includes("transform-style: preserve-3d;") && faces.includes("transition: transform"),
  "The two faces should turn in 3D rather than cross-fade.",
);

// --- looking underneath ------------------------------------------------------

// The card is modal over a 74%-black blurred scrim, which is right for reading
// and exactly wrong for the one thing the underdrawing shows: the animal in the
// field coming apart. Looking-through has to clear the scrim, or the dial moves
// something nobody can see.
const lookingScrim = ruleFor(".genome-card.looking-through .genome-card-scrim");
assert(
  lookingScrim.includes("backdrop-filter: none;"),
  "Looking through the page must drop the scrim's blur, or the field stays hidden.",
);
assert(
  /background:\s*rgba\([^)]*0\.1\d*\s*\)/.test(lookingScrim),
  "Looking through the page must clear the scrim's darkness.",
);

// The ghosting is on the container that holds both faces. Per-face opacity
// would be a cross-fade between them, which the turn above exists to avoid.
assert(
  ruleFor(".genome-card.looking-through .genome-leaf-faces").includes("opacity:"),
  "Looking through should ghost the faces as one, not each face separately.",
);

// The dial is a sibling of the faces, never a row among the genome's own rules:
// shellMix is not a property of the creature, and it also has to stay solid
// while the faces fade, which a child of a faded parent cannot do.
assert(
  /<\/div>\s*(?:<!--[\s\S]*?-->\s*)*<div class="genome-underdraw"/.test(indexSource),
  "The underdrawing dial should follow the faces block, not sit inside a face.",
);

// Same drawn-control idiom as every other rule on the card: a real range input,
// invisible, over a drawing.
assert(
  ruleFor(".genome-underdraw-dial").includes("opacity: 0;"),
  "The underdrawing dial should be a real input lying invisibly over the drawing.",
);
assert(
  ruleFor(".genome-leaf-faces.flipped").includes("transform: rotateY(-180deg);"),
  "Flipping should rotate the leaf.",
);
assert(
  ruleFor(".genome-face-writing").includes("transform: rotateY(180deg);"),
  "The writing face must be pre-rotated, or it turns up mirrored.",
);
assert(
  ruleFor(".genome-face").includes("backface-visibility: hidden;"),
  "Without a hidden backface both faces render through each other mid-turn.",
);
assert(
  ruleFor(".genome-leaf").includes("perspective:"),
  "Perspective belongs on the holder, or the turn reads as a width animation.",
);

// --- it is paper -------------------------------------------------------------

const face = ruleFor(".genome-face");
assert(
  face.includes("color: var(--obs-paper-ink);") && face.includes("linear-gradient(103deg"),
  "The card should be the specimen dock's paper stock, not a panel.",
);

// The single most important rule in this file. Prose on the writing face is
// set in the notebook serif; the moment it becomes a monospace face the card
// is a code editor no matter what colour the background is.
const writing = ruleFor(".genome-writing");
assert(
  writing.includes('font-family: "Cormorant Infant", Georgia, serif;'),
  "The writing face must be set in the notebook serif, never a monospace face.",
);
assert(
  !writing.includes("monospace"),
  "The writing face must not use a monospace face.",
);

// Figures are a different matter: a field table sets its measurements in the
// mono face, and the specimen readout already does exactly that.
assert(
  ruleFor(".genome-row-value").includes('font-family: "DM Mono", monospace;')
    && ruleFor(".genome-row-value").includes("font-variant-numeric: tabular-nums;"),
  "Figures should be set as measurements, and must not shuffle while a rule is dragged.",
);

// --- the drawn control -------------------------------------------------------

const dial = ruleFor(".genome-dial");
assert(
  dial.includes("opacity: 0;") && dial.includes("appearance: none;"),
  "The real range input must be invisible — the control is drawn, not styled.",
);
assert(
  ruleFor(".genome-rule-track").includes("border-left:")
    && ruleFor(".genome-rule-track").includes("border-right:"),
  "The rule should carry end ticks, which is what makes it read as a measuring rule.",
);

// Hatched, not greyed. A greyed track says "this input is switched off"; a
// hatched one says "this creature cannot reach here", which is the lesson.
const beyond = ruleFor(".genome-rule-beyond");
assert(
  beyond.includes("repeating-linear-gradient("),
  "The unreachable stretch of a rule should be hatched.",
);
assert(
  !/grayscale|filter:/.test(beyond),
  "The unreachable stretch must not be rendered as a disabled control.",
);
assert(
  cardSource.includes("parts.row.classList.toggle(\"bounded\", range.bounded)"),
  "The hatching should be driven by the computed relational ceiling.",
);

// --- no red, anywhere --------------------------------------------------------

const cardBlockStart = cssSource.indexOf("/* ── Genome card ");
assert(cardBlockStart > 0, "The genome card CSS block should be findable.");
const cardBlockEnd = cssSource.indexOf("@media (prefers-reduced-motion: reduce)", cardBlockStart);
// Comments stripped: this is an assertion about what the card declares, not
// about what the stylesheet says it is trying to do.
const cardCss = cssSource
  .slice(cardBlockStart, cardBlockEnd > 0 ? cardBlockEnd : undefined)
  .replace(/\/\*[\s\S]*?\*\//g, "");
assert(
  !/var\(--obs-coral\)|#e8735e|\bred\b|crimson/i.test(cardCss),
  "Nothing on the card is an error, so nothing on it should be red.",
);

// The one emphasis colour the card uses is the warm ink it shares with the
// rest of the observatory, and it marks a field that moved *correctly*.
assert(
  cssSource.includes("@keyframes genome-row-moved"),
  "A field that moved on its own should be marked.",
);
assert(
  cardSource.includes('parts.row.classList.toggle("moved", draft.moved.includes(field.path))'),
  "The moved mark should come from the draft's own account of what shifted.",
);

// --- the stamp ---------------------------------------------------------------

assert(
  cssSource.includes("@keyframes genome-stamp-settle")
    && ruleFor(".genome-stamp").includes("border-radius: 50%;")
    && cardSource.includes('stamp.classList.add("settling")'),
  "The genome hash should be a seal that re-settles when the genome changes.",
);
assert(
  cardSource.includes("void stamp.offsetWidth;"),
  "The stamp animation must be restartable, or a second edit inside its duration is silent.",
);

// --- the card is a view over a draft, and nothing else -----------------------

assert(
  !/from ["']three["']/.test(cardSource) && !/living-world/.test(cardSource),
  "The card must not reach into the scene; it hands a genome to its host.",
);
assert(
  !/normalizeWalkerDNA|normalizeFloraDNA/.test(cardSource),
  "The card must go through the draft, so it can never apply a bound of its own.",
);
assert(
  /from ["']\.\/genome-draft\.js["']/.test(cardSource),
  "The card should be built on the draft module.",
);

// The draft is the only thing allowed to know about the normalizers, and it
// must not pre-empt them: re-implementing a clamp here is the failure that
// would let the editor and the world disagree about what is possible.
assert(
  draftSource.includes("normalizeWalkerDNA") && draftSource.includes("normalizeFloraDNA"),
  "The draft should call the real normalizers.",
);
assert(
  !/Math\.min\(hi, Math\.max\(lo/.test(draftSource),
  "The draft must not clamp values itself — the normalizer is the authority.",
);

// --- rebuilding in place -----------------------------------------------------

assert(
  observatorySource.includes("removeLivingFlora(runtime, flora);")
    && observatorySource.includes(
      "introduceLivingFlora(runtime, dna, { prompt, repairs: [], at, genomeHash });",
    ),
  "An edited plant should be regrown on the spot it already occupies, carrying the edited genome's hash.",
);
assert(
  observatorySource.includes("next.place(position, heading);"),
  "An edited kin should keep its pose, so the rebuild reads as the same animal changing.",
);
assert(
  observatorySource.includes("if (followed) ctx.setFollowTarget(next);"),
  "The follow camera must be handed to the replacement, not left on a disposed facade.",
);

// A drag fires per pointer sample; the world is rebuilt on a debounce.
assert(
  /const COMMIT_DELAY_MS = \d+;/.test(cardSource)
    && cardSource.includes("window.clearTimeout(commitTimer);"),
  "Commits should be debounced rather than fired per pointer sample.",
);

// The native value is only pulled back into line once the drag ends — during
// it, the drawn nib stops at the ceiling while the pointer keeps going, which
// is how the rule refuses.
assert(
  cardSource.includes("if (!holding && parts.input.value !== String(field.value))"),
  "A drag in flight must not be fought by the value the normalizer settled on.",
);

// ...and the release must not re-apply what the drag already applied. A
// canonical genome renormalizes silently, so putting the settled value through
// as a fresh edit answers with an empty margin and erases the repair note and
// the moved mark just as the player looks up. See the matching property in
// genome-draft.test.mjs.
assert(
  cardSource.includes("if (settle && Object.is(readGenomePath(draft.dna, path), value))"),
  "Settling on a value the draft already holds must be a redraw, not an edit.",
);

// --- the modal does not leak keys into the field -----------------------------

assert(
  cardSource.includes("event.stopPropagation();"),
  "Keys pressed on the card must not also reach the field's own shortcuts.",
);

// --- reduced motion ----------------------------------------------------------

// The card's own reduced-motion block, not the one the rest of the HUD ships.
const reducedMotion = cssSource.slice(
  cssSource.indexOf("@media (prefers-reduced-motion: reduce)", cardBlockStart),
);
assert(
  reducedMotion.includes(".genome-leaf-faces") && reducedMotion.includes(".genome-stamp.settling"),
  "The turn and the stamp should stand still for anyone who asked for that.",
);

console.log("genome card static tests passed");
