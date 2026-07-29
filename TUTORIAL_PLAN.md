# Kinwild — the tutorial that teaches the machine

Status: foundation landed (1.13.0); layers not yet built.

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

### Why the card belongs at Layer 3

The affordance lens draws its motes from each archetype's own `affordances`
array (`generated-flora/archetypes.js`). Toggle it on a spire and the overlay
is literally rendering three strings out of a genome. The card is the same data
with the veil off — and it works because it is *short*. Twenty lines on one
page with no scrolling is the whole argument.

### The Genome Card, two faces

- **Pressed-page face** (default): generated controls as notebook rows —
  `label · value · range bar`. The bar carries the teaching: you can see that
  `shape.height` sits near the top of what a spire is allowed to be.
- **Writing face**: the real formatted JSON, notebook serif, paper tone, with
  the line count as a caption — *"nineteen lines"* — visible every time.

The genomeHash is an ink stamp that re-settles on every edit. Watching it
change as you drag is the cheapest possible proof that the hash is a function
of the content.

Vibe guard, non-negotiable: no monospace-devtools styling, no syntax-highlight
rainbow, no brace gutters, no red error text anywhere.

## What landed in 1.13.0

The substrate, all of it DOM-free and tested:

| | |
|---|---|
| `generated-fauna/dna.js` | `WALKER_CLAMPS` / `WALKER_WING_CLAMPS` / `WALKER_RELATIONS` — the bounds are a table, as the flora side already was |
| `generated-flora/dna.js` | `MOTION_LIMITS` / `VARIATION_LIMITS` exported |
| `src/ui/genome-schema.js` | `describeGenome` — controls generated from the schema; `numericFields` for the mutation operator, so the two cannot disagree |
| `src/ui/genome-voice.js` | `phraseRepair` — repair notes in the naturalist's voice |
| `living-world/runtime.js` | `removeLivingFlora`; `introduceLivingFlora({at})`; affordance ordinals made monotonic |

The ordinal fix was a latent bug, not a refactor: `ordinal` is an identity that
kin hold as claims, but it was assigned from array length — safe only while
nothing ever removed an affordance.

## What is still to build

Dependency-ordered. Items marked ⚑ are design-heavy enough to want a dedicated
pass rather than being folded into a larger session.

1. ⚑ **The genome editor** (`src/ui/genome-editor.js`) — the two-faced card,
   the range-bar visual, marginalia placement, debounced live rebuild. The
   risk is not volume, it is *feel*: a JSON editor that reads as devtools in a
   cute frame is worse than not shipping.
2. Genome Card read-only mode, wired into the observatory selection path.
3. ⚑ **The affordance lens + prediction scoring** (Layer 3). Independently
   valuable — it is also the debugging view the ecology has never had, and the
   one that would have made the simulation-only bugs visible.
4. `src/genome-mutate.js` — bounded mutation over `numericFields`. Do not
   pre-clamp: letting a mutation overshoot means the player sees a repair note
   fire, which teaches that the bounds are the world's rules and not the UI's.
5. Catalog v2 metadata + generated-species coverage + migration.
6. `src/genome-link.js` — `?kin=` / `?sprig=` alongside `?seed=`, never
   replacing it. `writeSeedToUrl` must preserve or explicitly drop them.
7. Studio paste-import and the Layer 7a inherit entry points.
8. The player-affordance placement verb (Layer 4).
9. ⚑ **Relationship edges** (Layer 6).
10. Tutorial progression state — a thin orchestration layer over 1–9, DOM-free
    like `src/ui/studio-progress.js`, persisted beside the catalog. Do last.

## Notes for whoever picks this up

- The studio's grammar fallback means authoring works with **no LLM at all**,
  so none of this depends on LM Studio being up.
- Skeleton node ids are stable and path-derived (`0/1/b2`) and rosters are
  family-stable — both were built for exactly the naming a Field Guide needs.
- `phraseRepair`'s drift guard counts `push` sites in both normalizers. Adding
  a repair without a phrasing fails the suite rather than silently degrading.
- The vibe is a constraint, not an aspiration. The tutorial voice is a field
  naturalist's notebook, not a HUD.
