# Kinwild — the tutorial that teaches the machine

Status at **1.18.0**: foundation landed (1.13.0); the genome card landed
(1.14.0); rebuild seam + flier fixes (1.14.1); **Layers 0–2 landed (1.15.0)**
and verified in a browser on 2026-08-12 — the onboarding track below is real:
seed-stamp cold open, margin notes, ring sights. Since then the tutorial has
grown a second thread, **the lenses**: the glass (1.15.2), the underdrawing
(1.17.0) and the gait lens (1.18.0) are all reachable instruments, ahead of the
rungs that are meant to prompt them. Remaining layers are in "What is still to
build" and in HANDOFF.md's "Where we are" section.

**The track and the instruments have come apart, and closing that is the next
job.** Prompting stops at Layer 2. Layer 3's artifact (the card) and Layers
4b/4c's instruments (underdrawing, gait) are all built and openable; Layer 3's
own instrument — the affordance lens — is written as data
(`affordanceMarks`) and tested, and nothing opens it.

## The premise

Kinwild's content *is* its architecture. A species is a genome — a ~20-line
JSON document — deterministically compiled into a living thing. A behaviour is
a need scored against an affordance registry. A world is a seed. Almost nothing
here is hand-placed, so almost nothing has to be taught as an arbitrary rule:
every gameplay verb the player learns is a real system boundary.

So the tutorial is not a tooltip layer bolted onto a finished game. It is the
difficulty curve, and each rung hands the player one more piece of the
generator. It ends with them authoring a species, because authoring is the last
thing the machine itself does.

Two rules run through all of it:

- **Never name a system before the player has seen it act.** Vocabulary is a
  reward for observation, never a preamble.
- **Every layer ends on a sight, not a confirmation.** No "Lesson complete."

## The genome thread

The genome is **present but unnamed from Layer 1**. The player sees its
consequences from the first minute, sees the artifact at Layer 3, edits it at
Layer 4, and inherits it at Layer 7. It is never a reveal.

*the same writing makes the same thing* → *the writing is short* → *the writing
is legible* → *the writing is editable* → *edits are inherited* → *writing
travels.*

## The layers

| | Mechanically | Architecturally | Genome thread |
|---|---|---|---|
| **0 Arrive** | orbit, idle, let the island resolve | a world came from a number | same seed regenerates identically — the motif every later layer echoes |
| **1 Notice** | find the others of this one | individuals belong to species (`roster.js`) | *"the same nine lines, written twice"* — a count, not a document |
| **2 Follow** | stay with one kin | behaviour is need pressure (`kin-goals.js`) | *"how fast these fill is one of the written lines"* (`motion.*`) |
| **3 Observe** | predict its next plant | flora advertises, fauna pursues, flora answers | **the Genome Card** — the artifact, both faces |
| **4 Interact** | place something; nudge one field | you write into the same registry plants do | one slider, live rebuild in place |
| **5 Catalog** | photograph, name, keep | a species is a record with provenance | genome + hash + parent + world seed on the entry |
| **6 Relate** | pair kin to plant | ecology is a graph the roster composes | an edge names the affordance string that made it |
| **7a Inherit** | take a cutting / raise a kinling | descent, not randomization | bounded mutation; repair notes fire on overshoot |
| **7b Compose** | the Form Studio as it stands | model proposes, engine validates | lands on a player who knows what the three cards are |

Vocabulary budget, one per layer: species (1), need (2), affordance + genome
(3), registry (4), provenance (5), relationship (6), lineage (7). The
validator is never named — only felt.

**Layers are not levels.** Nothing locks; the layers gate *prompting*, not
access. An experienced player outruns the track.

### Layer 1 asks for a verb the player does not have yet

Found by walking the track in a browser, 2026-08-12. *Notice* closes when two
different individuals sharing a `speciesId` are selected in turn — and the only
way to select a second individual of a species is to open the locator (`L`),
click its species row, and press **`Tab`** to cycle instances. The Field
Taxonomy medallions cannot do it (one medallion always resolves to the same
individual, and two medallions are two different species), and the kin-group
dots on the specimen readout are indicators, not controls. So the layer that is
supposed to need nothing but noticing in fact needs the panel Layer 2 is meant
to introduce.

Two honest fixes, and they are not exclusive: give *notice* a verb the player
already has, or let a layer teach the instrument it depends on. Related, and
worse on a phone: with `LOWFX` the world carries **two** kin rather than five,
which can leave no two of a species in the field at all — the layer is then
unsatisfiable, and since prompting advances in order, nothing after it prompts
either. A layer needs a way past a world that cannot answer it.

### Why the card belongs at Layer 3

The affordance lens draws its motes from each archetype's own `affordances`
array (`generated-flora/archetypes.js`). Toggle it on a spire and the overlay
is literally rendering three strings out of a genome. The card is the same data
with the veil off — and it works because it is *short*.

**How short, measured rather than guessed:** 34 lines for a groundcover, 42 for
a flier. An earlier draft of this doc claimed "about twenty" and used it to
argue the page must never scroll; that number was invented and the argument
built on it was wrong. The caption spells out whatever the real count is, and
on a short viewport the page scrolls a little. "Forty-two lines" is still a
remarkable thing to say about an animal that walks and beats its wings.

### The Genome Card, two faces — built in 1.14.0

- **Pressed-page face** (default): generated controls as notebook rows — a term
  in small caps against a measuring rule. The rule carries the teaching: end
  ticks, an ink fill, a nib at the value, and hatching over whatever a
  relational bound currently puts out of reach.
- **Writing face**: the real formatted JSON — `JSON.parse` of what is on screen
  returns the genome — set in the notebook serif on the same paper, with the
  line count as a caption. Keys stay in the normalizer's own order rather than
  sorted: a genome that opens with its name reads as a description, and one
  that opens with `archetype, motion, name` reads as a data structure.

The genomeHash is an ink stamp. Its characters change on every sample of a
drag; the ink pulse waits for the previous one to finish, because a half-second
animation retriggered at 60Hz is a jitter and never once a stamp coming down.

Vibe guard, non-negotiable: no monospace-devtools styling, no syntax-highlight
rainbow, no brace gutters, no red error text anywhere. This is enforced by
`genome-card-static.test.mjs` rather than left to good intentions.

## What landed in 1.13.0

The substrate, all of it DOM-free and tested:

| | |
|---|---|
| `generated-fauna/dna.js` | `WALKER_CLAMPS` / `WALKER_WING_CLAMPS` / `WALKER_RELATIONS` — the bounds are a table, as the flora side already was |
| `generated-flora/dna.js` | `MOTION_LIMITS` / `VARIATION_LIMITS` exported |
| `src/ui/genome-schema.js` | `describeGenome` — controls generated from the schema; `numericFields` for the mutation operator, so the two cannot disagree |
| `src/ui/genome-voice.js` | `phraseRepair` — repair notes in the naturalist's voice |
| `living-world/runtime.js` | `removeLivingFlora`; `introduceLivingFlora({at})`; affordance ordinals made monotonic |

## What landed in 1.14.0

| | |
|---|---|
| `src/ui/genome-draft.js` | the editing session, DOM-free: apply a change, let the normalizer answer, file the answer in the right margin. Also the writing-face document model |
| `src/ui/genome-card.js` | the two-faced card. A view over a draft — it imports neither three.js, nor the runtime, nor a normalizer |
| `observatory.js` | rebuild in place: a plant on its own spot, a kin with its pose and follow camera carried across |

The card leans on one property, which is why the test asserts it before
anything else: **a canonical genome renormalizes silently.** That is what lets
a repair note sit beside a field without lying about why it appeared — every
note on the board was caused by the edit just made.

The ordinal fix was a latent bug, not a refactor: `ordinal` is an identity that
kin hold as claims, but it was assigned from array length — safe only while
nothing ever removed an affordance.

## What landed in 1.15.0–1.18.0

| | |
|---|---|
| `src/tutorial/progress.js`, `copy.js` | the track: layers 0–2 as a pure state machine over strings, both tested in node |
| `src/ui/tutorial-notes.js` | the notebook margin — seed stamp, notes with self-drawing leaders, asides, ring sights |
| `src/tutorial/lenses.js` | what a lens *says*, as data: gait, underdrawing, affordances → one vocabulary of marks (dot, ring, link, tag). Weight, never colour |
| `src/ui/lens-layer.js` | the glass they are drawn on. Marks patched by key, since a lens redraws every frame it is open; a reach radius is projected, never a fixed pixel size |
| `src/ui/viewport-project.js` | world → CSS pixels, lifted out of `observatory.js` once the lenses needed it too |
| the shell-mix dial + `GENERATED_FAUNA_EXPLODE` | a body scrubbed back to its carriers, with the blend graph over them — Layer 4b as an instrument |
| the gait lens | planted feet that do not move while the body travels away from them — Layer 4c as an instrument, and `walker.js`'s step trigger made visible |

The three lenses agree on one claim, and it is the reason they are the
difficulty curve rather than an addition to it: **each is a debugging view the
engine needed anyway, handed to the player.**

## What is still to build

Dependency-ordered. Items marked ⚑ are design-heavy enough to want a dedicated
pass rather than being folded into a larger session.

1. ~~The genome editor~~ — **landed in 1.14.0** as `src/ui/genome-card.js`
   over `src/ui/genome-draft.js`. Read-only mode exists (`show(dna, {editable:
   false})`) but nothing calls it yet.
2. ~~Wider entry points~~ — **landed in 1.18.0**; the studio's candidate cards
   offer the genome. **Palette editing is still absent**: swatches are shown
   but not offered, because a colour picker is an OS panel and this is a page.
   It needs a drawn control in the card's own idiom — a design task, not a
   wiring one.
3. **The affordance lens** (Layer 3's instrument) — **half landed**. The glass
   (`src/ui/lens-layer.js`) and the marks (`affordanceMarks` in
   `src/tutorial/lenses.js`) exist and are tested; **nothing opens them.** This
   is the cheapest item on the list: a toggle beside *Read the genome* and
   *Watch the feet*, sourcing `state.livingWorld.registrations.affordances` and
   the followed kin's `needs.goal.ordinal`. Do it behind a single
   `setLens(name | null)` arbiter — three lenses now share one glass and the
   exclusivity between them is pairwise and ad-hoc.
3b. ⚑ **Prediction scoring** — Layer 3's *verb*, and a separate thing from the
   lens. Nothing exists. How a guess is stated, when it resolves, and what
   right and wrong look like when a layer must end on a sight and never a
   confirmation, are all still open.
4. `src/genome-mutate.js` — bounded mutation over `numericFields`. Do not
   pre-clamp: letting a mutation overshoot means the player sees a repair note
   fire, which teaches that the bounds are the world's rules and not the UI's.
5. Catalog v2 metadata + generated-species coverage + migration.
6. `src/genome-link.js` — `?kin=` / `?sprig=` alongside `?seed=`, never
   replacing it. `writeSeedToUrl` must preserve or explicitly drop them.
7. Studio paste-import and the Layer 7a inherit entry points.
8. The player-affordance placement verb (Layer 4).
9. ⚑ **Relationship edges** (Layer 6).
10. Tutorial progression state — **exists** as `src/tutorial/progress.js`,
    DOM-free and persisted at `smallworld:tutorial:v1`, carrying layers 0–2.
    It is no longer a "do last" item: **each new layer's rung lands with the
    layer**, and appending to `TUTORIAL_LAYERS` needs no migration because
    `createTutorialProgress` filters restored ids against `ORDER`. One thing to
    settle before Layer 3: this document budgets Layer 3 two words (affordance
    + genome), but `vocabulary` is a single string per layer and
    `markLayerDone` returns one. Widen it to an array, or the budget quietly
    becomes one word.

## Notes for whoever picks this up

- The studio's grammar fallback means authoring works with **no LLM at all**,
  so none of this depends on LM Studio being up.
- Skeleton node ids are stable and path-derived (`0/1/b2`) and rosters are
  family-stable — both were built for exactly the naming a Field Guide needs.
- `phraseRepair`'s drift guard counts `push` sites in both normalizers. Adding
  a repair without a phrasing fails the suite rather than silently degrading.
- The vibe is a constraint, not an aspiration. The tutorial voice is a field
  naturalist's notebook, not a HUD.
