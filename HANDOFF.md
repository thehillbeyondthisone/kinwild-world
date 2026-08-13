# Kinwild — handoff

> **Written for a cold session.** Everything needed to pick this up is here.
>
> Repo: `C:\source\repos\creaturecreator\small-world-integration` — a nested
> git repo (kinwild) inside `creaturecreator`, branch
> `codex/integration-foundation`, upstream = paulrobello/small-world,
> **nothing pushed**. The parent repo is a separate project (Creature Creator,
> port 5173) and is not touched by this work.
>
> Version **1.18.0**. Gate per commit: `npm run check` (**114 tests** + lint +
> build) **plus** `node tests/determinism-seed.test.mjs` explicitly. Both were
> green on a clean tree at 2026-08-12.
>
> Dev server: **`npm run dev`** → :2001. Do *not* use the `make` targets —
> `make` on this machine resolves to Embarcadero MAKE, not GNU make, and fails
> with "'dev-stop' does not exist". CLAUDE.md's make targets are aspirational
> here. Restart the server after a version bump (`APP_VERSION` is injected by
> Vite at server start).
>
> **`?livingWorld=1` is auto-injected now** — the observatory *is* the default
> mode; the old warning below about the donor world is stale.

---

# Where we are — 2026-08-12 (read this first)

**This section supersedes the stale parts of Parts I–III below.** Everything
the 2026-07-29 audit ordered has landed; the audit is no longer the work
order. `TUTORIAL_PLAN.md` is.

Tree is **clean at 1.18.0**, everything below committed, gate green.

## Landed since the last handoff

| | |
|---|---|
| 1.15.0 | onboarding layers 0–2, and 1.14.1's rebuild-seam + flier fixes |
| 1.15.1 | two faults found only by driving the card and the onboarding in a browser: the margin no longer wipes on drag-release, and an anchored note no longer stretches into a full-page blank |
| 1.15.2 | **the glass** — `src/tutorial/lenses.js` (what a lens *says*, as data) and `src/ui/lens-layer.js` (the overlay), plus `viewport-project.js`. Nothing opened a lens yet |
| 1.15.3 | audit finding 8 — every shader patch installs through `replaceOrWarn`, with `tests/shader-patch-anchors.test.mjs` reading three's own source |
| 1.16.0 | the shell-mix dial under the hood — a body can be scrubbed back to its carriers |
| 1.17.0 | **the underdrawing** (Layer 4b as an instrument): the dial on the card, the blend graph drawn, the page opening up to be looked through |
| 1.18.0 | **the gait lens** (Layer 4c as an instrument), the kin-judder fix (two faults, one artifact — see `tests/living-world-kin-judder.test.mjs`), and the studio's candidate cards now offer the genome |

Audit findings 1–8 are all closed. Part I task 0 (look at the genome card) was
done — 1.15.1 is what came of it. Task 1b (wider card entry points) landed in
1.18.0. **Task 1a — the dock's two identical regen buttons — is still open and
still valid.**

## Onboarding verified in a browser, 2026-08-12

The whole of layers 0–2 was walked end to end at
`localhost:2001/?livingWorld=1&lowfx=0&seed=0x0007` with
`smallworld:tutorial:v1` cleared. It works: the stamp settles digit by digit,
"look around." closes on the first orbit gesture, "find another like this one."
closes on the second kin with the *species* aside, and "stay with this one a
while." closes after six seconds of held follow with the *need* aside. Final
state `{"done":["arrive","notice","follow"],"vocabulary":["species","need"]}`.

Three things the walk turned up. None is a crash and none was visible from
reading the code.

**1. Layer 1 has exactly one satisfying path, and it is `Tab`.** `tickOnboarding`
closes *notice* when two **different facades sharing a `speciesId`** are
selected in turn. Only three things ever set the selection:

- **Field Taxonomy medallions** — keyed `speciesId/phenotype`, resolved with
  `runtime.fauna.find(...)`, so one medallion always returns the *same*
  individual. Two medallions are two different keys. On seed `0x0007` the three
  fauna medallions are three distinct species, so no pair of clicks can ever
  satisfy the layer.
- **The kin-group dots** on the specimen readout are `<i>` elements —
  `renderKinFilter` says so in its own comment ("an indicator this pass").
  They look like the obvious control and are not one.
- **The locator panel** (`L`), whose rows are grouped *by species with a count*
  ("boulderkin 2"). Clicking the row follows one; **`Tab` cycles to the next
  instance of that type**, and that second individual is what closes the layer.

So the prompt "find another like this one." is answered only by: press `L`,
click a species row, press `Tab`. Nothing in the prompting says so, and the
locator is what Layer 2 is meant to introduce. Either give *notice* a verb the
player already has, or teach the locator before asking for it.

**2. Under LOWFX the track can hard-stall at layer 1.** `runtime.js:288` is
`const faunaCount = lowfx ? 2 : 5;`. With two kin there may be no two of a
species at all — on `0xefe3` they came out `boulderkin, kinling`, so *notice*
could not close, and because layers gate prompting in order, layers 2+ never
prompt either. LOWFX triggers on `dpr < 1.5 && shortSide < 768`, which is a real
device and not only a small pane. The track needs a way past a layer the world
cannot satisfy.

**3. The margin ignores the observatory's own panels.** `.tutorial-layer` is
`z-index: 92`, above the paper panels. With the specimen readout open — the
default state coming out of the dock — the aside is laid out at its fixed
lower-left margin (26, 523) and lands across the *emergent traits* and *kin
activity* rows, and a ring sight drawn at a followed kin's screen position sits
on the panel's paper rather than on the animal, which is behind it. The note,
the aside and the sights all want to know what is currently covering the field.

## Next up, in order

1. **Wire the affordance lens.** `affordanceMarks` (`src/tutorial/lenses.js`)
   is written and tested and **has no callers** — Layer 3's instrument is a
   toggle away. Copy the `setWatchingGait` shape. Two cautions: the three
   lenses share one glass and the exclusivity between them is currently
   pairwise and ad-hoc (`applyUnderdraw` calls `setWatchingGait(false)`, the
   gait button calls `genomeCard.close()`) — replace it with a single
   `setLens(name | null)` arbiter *before* adding a third; and do not call it
   `lens` in the markup, since `data-obs-lens` already means a rail panel.
   Measure frame time with it open: a world carries a couple of hundred
   affordances, and `types` is the pressure valve.
2. ⚑ **Prediction scoring** — Layer 3's verb, and the only design-heavy item
   here. Nothing exists. Three open questions, all design: how the player
   states a guess (clicking a plant is the obvious gesture and it collides with
   nothing today, since the living world has no click-to-pick), when it
   resolves (goal change, or arrival), and what right and wrong *look* like
   given that a layer ends on a sight and never a confirmation.
3. **Extend the progression to layers 3–4.** Appending to `TUTORIAL_LAYERS` is
   save-compatible — `createTutorialProgress` filters by `ORDER`, so an
   existing save resumes at the new layer with no migration. One real conflict
   to settle first: the plan budgets Layer 3 **two** words (affordance +
   genome), but `vocabulary` is a single string and `markLayerDone` returns
   one. Widen it to an array or the budget quietly becomes one word.
4. **The player-affordance placement verb** (Layer 4). Cheaper than it looks:
   `introduceLivingFlora({at})` and the card's rebuild-in-place both exist;
   what is missing is the gesture and the rung.
5. Then Layers 5–7 per `TUTORIAL_PLAN.md`: catalog v2 provenance, ⚑
   relationship edges, `genome-mutate.js`. 7b is largely done.
6. The three verification findings above, and task 1a.

## Still unresolved

- **`0x0007` oddities, deferred:** the user reported a yellow
  plant-part-shaped thing orbiting the world and odd plant sway. Headless
  probes cleared the living-world sim (no flora rotates, batches sane, fauna
  behaviour sane). Prime suspect: the legacy bird flock (`world.js:502-510`) —
  one flock of 5–9 birds circles the island in every world, 30% chance of the
  biome accent, and Mosshollow's accent is amber `#f4a261`. Runner-up: pollen
  particles. Next step is the user's in-game look (one solid object vs. a
  flapping cluster). The probes were throwaway scripts (deleted); recreate from
  `tests/living-world-runtime.test.mjs` if it resumes.

House note from the user: **be token-aware** — no subagent swarms or parallel
agents without asking first; verify with targeted reads and the existing
gate.

---

# Part I — the work order, as it stood on 2026-07-29

**Historical, except task 1a.** Tasks 0, 1b and 2 have all landed; the section
is kept because the *reasoning* under each — what to look at on the card, what
a dock change costs, why 0–2 was the right slice — is still the best record of
why things are shaped as they are. The live work order is in "Where we are"
above.

## 0. Look at the genome card — **done (1.15.1)**

The card shipped in 1.14.0 fully tested but **visually unverified**, so its
content and logic were proven and its *appearance* was not. It has since been
driven in a browser; 1.15.1 is what came of it. The checklist below is what was
looked at, and is worth rerunning after any change to the card.

`http://localhost:2001/?livingWorld=1&lowfx=0&seed=0x0007`, then click a
flora medallion in Field Taxonomy, or select a kin and press **Read the
genome** on the specimen readout header.

What to check, in priority order:

1. **Does it read as paper or as devtools?** This is the whole risk and the
   reason the step was flagged. If it reads as a JSON editor in a cute frame,
   that is a failure even though every test passes.
2. The turn between faces — is it a card turning, or does it read as a flip
   gimmick? 700ms, `cubic-bezier(0.22, 1, 0.36, 1)`.
3. Drag `legs.length` to its minimum on a walker. The `legs.thickness` rule
   below should become ~75% hatched with its nib resting on the hatch
   boundary, and a marginal note should appear. This is the single most
   important interaction in the feature — it is the relational-bound lesson.
4. The nib should *stop* at the ceiling while your pointer keeps going, then
   snap to truth when you let go. If it fights the drag, `syncRow`'s `holding`
   logic is wrong.
5. The hash stamp should pulse at most twice a second, not jitter at 60Hz.
6. Frame time while dragging. Rebuild is debounced at
   `COMMIT_DELAY_MS = 120` (`genome-card.js`), which means a species
   recompile up to ~8×/second. **This number was chosen from the design doc,
   not measured.** If dragging hitches, raise it — that is the expected fix.
7. Writing face: 34–42 lines, so it scrolls a little on a 1080p screen. Judge
   whether that undercuts the "it's short" argument enough to care.

Known-good baseline for comparison: median frame **16.8ms**, p95 19.4ms at
seed `0x0007` (140 plants, 20 flora draw calls, 68 total, 217k triangles).

## 1. Two cheap fixes

### 1a. The dock's two regen buttons are the same button

**Verified fact**, not a suspicion:

```js
// src/ui/help-panel.js:116-129
ctx.pickRandomBiomeSeed = () => {
  if (livingMode) return newRandomSeed();     // ← unconstrained
  ...next enabled biome...
};
ctx.pickSameBiomeSeed = () =>
  livingMode ? newRandomSeed()                // ← identical
             : newRandomSeed({ allowedBiomeIds: [current] });
```

In the parent Small World these differ (same biome vs advance to the next).
Kinwild has one style, so the distinction has nothing to bite on and **"Grow ·
New Strain" and "Mutate · New Field" both just reroll the world.**

Two consequences:

- The comment at `observatory.js` on the `obs-mutate-field` handler claims it
  "Reseeds into a different biome". That is **wrong** in living-world mode.
  Fix or delete it.
- **"Mutate" is spending the word the real mutate verb needs.** `genome-mutate.js`
  (deferred item, see Part III) is descent with modification; the button
  currently labelled Mutate throws the world away, which is close to the
  opposite. Rename before that verb lands, not after.

Suggested: collapse to one honest world-reroll action and free the sixth cell
for something real — the genome card has no dock presence at all, which is a
discoverability problem in its own right.

**Cost of touching the dock** (checked, so nobody rediscovers it):

- `style.css:3366` — `grid-template-columns: repeat(6, minmax(0, 1fr))`
- `tests/observatory-ui-static.test.mjs:177` pins that `repeat(6, ...)` regex
- `tests/observatory-ui-static.test.mjs:184` asserts `id="obs-mutate-field"`
  exists, commented "the dock needs its sixth cell"

So a dock change is three coordinated edits, not one. That is the whole risk.

### 1b. Widen the card's entry points — **done (1.18.0)**

The studio's candidate cards offer the genome now. Palette editing is still
absent, and the design problem below is unchanged.

Today the card opens from exactly two places: the specimen readout (kin) and
the flora medallion (plants). The obvious third is **the Form Studio's
candidate cards** — reading what the model actually proposed, and editing it
before introducing it, is the clearest possible statement of *model proposes,
engine validates*, which is Layer 7b's entire thesis.

Implementation note: `genome-card.js`'s host contract is `onCommit(dna, draft)`
and the observatory routes by `cardSubject.kind` (`"kin"` | `"plant"`). Add a
third kind — `"candidate"` — whose commit writes back into
`currentCandidates[index]` and re-renders that card, with **no world rebuild**,
because the thing being edited is not standing in the field yet.

Also still absent: **palette editing.** Swatches are shown read-only because
`<input type="color">` opens an OS panel and this is a page. If colour should
be editable, it needs a drawn control in the card's own idiom — a real design
task, not a wiring one.

## 2. Tutorial layers 0–2, and stop before 3 — **done (1.15.0)**

Written when **there was no tutorial and zero of the eight layers existed**.
Layers 0–2 have since landed and been verified in a browser; the argument for
why that was the right slice, and the two rules at the bottom, still hold and
still bind every layer added after.

The one piece of onboarding the codebase already had is switched off here:

```js
// src/ui/help-panel.js:51
if (!livingMode && !INSPECT && !shouldUseMobileHud() && shouldShowFirstVisitHelp())
```

So a new player arrives to an island, a HUD of instruments, and no prompting
at all.

**Why 0–2 is the right slice.** These layers need almost no new mechanics:

| Layer | Needs | Status |
|---|---|---|
| 0 Arrive | world generates, camera orbits | built |
| 1 Notice | roster + taxonomy panel | built (`living-world/roster.js`, `obs-taxonomy-list`) |
| 2 Follow | `setFollowTarget` | built (`ui/locator-panel.js`) |

The tutorial for these is **prompting over verbs that already work** — copy
and a thin progression state, not systems work. It is the cheapest item on the
list and the only one that changes whether this reads as a game or a tech demo.

**Why stop before 3.** Layer 3 ("predict its next plant") is the first layer
needing something that does not exist — the affordance lens, which is flagged
⚑ design-heavy. Natural sequence: **0–2 → lens → 3–4**. That also gives the
genome card its intended home, since Layer 3 is where the card is meant to be
introduced.

**Build shape**, following the house pattern (logic DOM-free and tested, DOM
thin over it — as `genome-draft.js` is to `genome-card.js`):

- `src/ui/tutorial.js` — DOM-free progression. Which layer is current, what
  satisfies it, what it says. Testable without a browser.
- A prompting surface in the observatory's paper idiom. **Not a HUD, not a
  toast** — the voice is a field naturalist's notebook.
- Persisted beside the catalog under a versioned key
  (`smallworld:catalog:v1` is the existing precedent).

**Non-negotiable rules from the plan**, both easy to violate by accident:

- **Never name a system before the player has seen it act.** Vocabulary is a
  reward for observation, never a preamble. Budget is one term per layer:
  species (1), need (2).
- **Every layer ends on a sight, not a confirmation.** No "Lesson complete."
- **Layers gate prompting, not access.** Nothing locks. An experienced player
  outruns the track.

**Open decision for the user:** re-enabling first-visit onboarding in living
mode means changing that `!livingMode` guard, which affects the *donor* world's
behaviour too if done carelessly. Decide whether Kinwild gets its own
onboarding path or shares the help panel's.

---

# Part II — where things stand

## What landed, most recent first

**1.14.0 — the genome card**

| | |
|---|---|
| `503c171` | specimen action legible on a phone |
| `3e19893` | **the genome card** — two faces, measuring rules, marginalia, live rebuild |

**1.13.0 — the substrate under it**

| | |
|---|---|
| `05a8030` | `removeLivingFlora`; `introduceLivingFlora({at})`; affordance ordinals made monotonic |
| `9197e93` | `phraseRepair` — repair notes in the field guide's voice |
| `fd7da12` | `describeGenome` — controls generated from the schema |
| `9882240` | flora motion/variation limits exported |
| `5af8402` | walker bounds extracted to tables |

**1.12.0 — the closed ecology loop** (`8343d4f`…`e08f3f2`): flora advertises
affordances, fauna pursues them, flora responds to being used. Plant authoring
in the studio.

## The genome card, in one paragraph

`src/ui/genome-draft.js` is the editing session and is DOM-free: apply one
change, hand the whole genome to the normalizer, then work out which margin
the answer belongs in. `src/ui/genome-card.js` is a view over that draft and
imports **neither three.js, nor the runtime, nor a normalizer** — enforced by
`genome-card-static.test.mjs`, so it can never apply a bound of its own. The
observatory owns rebuild-in-place: a plant regrows on the spot it occupies, a
kin keeps its pose and its follow camera.

## Decisions that took work to reach — don't re-litigate

**Normalization is idempotent, and the marginalia depends on it.** A canonical
genome renormalizes silently, so every repair note on the card after an edit
was caused by *that edit*. Without this the card would show a backlog of notes
the player did not cause and would be lying about why they appeared.
`genome-draft.test.mjs` asserts it across all nine archetypes and both
locomotions **before anything else**, for exactly this reason.

**Hatched, not greyed.** The unreachable stretch of a rule is hatched because
greying says "this control is switched off" and hatching says "this creature
cannot reach here" — and only the second is true. This is the difference
between a control that teaches and one that merely corrects.

**The control is drawn; the native input is invisible.** A real
`<input type="range">` at `opacity: 0` lies over the drawing, so keyboard,
touch and assistive tech all work and none of the native widget is ever seen.
The native value is only reconciled on `change` (drag end), never on `input` —
that is what lets the nib stop at a ceiling while the pointer keeps going.

**Affordance `ordinal` is an identity, not an index.** Kin hold capacity claims
by it and exclude their last-visited target by it. It was assigned from
`registrations.affordances.length`, which was safe only while nothing ever
removed an affordance; the moment `removeLivingFlora` existed, the next plant
would mint an ordinal a live kin still held and silently transfer a claim
between unrelated affordances. It is a monotonic counter now.

**Batching.** Draw calls scale with the roster, not the field: 20 flora draw
calls for 140 plants against ~308 unbatched. A plant is a row in a batch plus
an empty `THREE.Group` carrying its transform.

**The touch bend is injected into `project_vertex`, not `begin_vertex`.**
After `instanceMatrix` the vertex is already in the batch root's space, which
is where `aPlantBase` lives. Bending earlier means inverse-rotating a
world-space displacement through each row's basis — the trap `grass.js`
documents at length.

**Wind amplitude is calibrated against the donor tree**, not chosen: the donor
crown travels ~2.5% of plant height at strength 0.18; a generated canopy lands
~1.5%, groundcover ~7%. Donor flora must keep the old path
(`applyWindSway(mat, strength)` with no `{plantRelative: true}`).

**A flier caps at four legs** — influence budget, not taste. Six legs plus two
wings needs ten entries against a cap of eight.

**Hero collision comes from the trunk**, not the bounds radius, or kin are held
seven units out and every affordance the plant advertises sits inside a circle
they are pushed out of every frame.

**Species colour is separated from terrain by measurement.**
`separateFromTerrain` holds a 1.8:1 luminance floor, moving lightness only —
several biome accents are violet and grew plants at 1.00:1 against their ground.

**Determinism.** Per-frame behaviour runs *after* `generateWorld` restores the
real `Math.random`, so it is outside the seeded window. World-gen streams are
namespaced (`hashSeed("kinwild/patch", index, seed)`) so adding a species
cannot shift terrain or existing placements. **Nothing in the genome card runs
inside the seeded window** — it is all user input, long after `restoreRandom()`.

## Things that only showed under simulation

Reading the code would not have found these.

- **A goal on a hero plant was unreachable by construction.** One kin of five
  stood 6.72 from a goal with a 2.17 arrival radius for three minutes, every
  need pinned at 1.0. `reachableRadius` in `kin-goals.js` is the general guard;
  keep it.
- **Kin satisfied needs without moving** — with ~450 affordances the nearest
  match is always underfoot. `MIN_TRAVEL` makes a goal worth going to.
- **A visit ended before it read as one** — 22 landings, zero time perched.

**If you change fauna behaviour, drive it.** Build a runtime like
`tests/living-world-runtime.test.mjs`, step it 180×60 frames, and report path
length, distinct affordances visited, and time stationary. "One kin has path 14
while the others have 90" is how the above were found.

---

# Part III — reference

## Still unbuilt, dependency-ordered

From `TUTORIAL_PLAN.md`. ⚑ = wants a dedicated pass at raised effort.

1. ~~Wider card entry points~~ landed 1.18.0. **Palette editing** is still
   absent and is still a design task — see task 1b above.
2. ⚑ **Affordance lens + prediction scoring** (Layer 3). Independently
   valuable: it is also the debugging view the ecology has never had, and the
   one that would have made the simulation-only bugs above visible. **Half
   landed:** the glass (`src/ui/lens-layer.js`) and the marks
   (`affordanceMarks` in `src/tutorial/lenses.js`) exist and are tested; no
   toggle opens them, and the scoring does not exist at all.
3. `src/genome-mutate.js` — bounded mutation over `numericFields`. **Do not
   pre-clamp**: letting a mutation overshoot means the player sees a repair
   note fire, which teaches that the bounds are the world's rules and not the
   UI's. The card gives it a home ("let it drift").
4. Catalog v2 metadata + generated-species coverage + migration
5. `src/genome-link.js` — `?kin=` / `?sprig=` alongside `?seed=`, never
   replacing it. `writeSeedToUrl` must preserve or explicitly drop them;
   silently losing a genome on regen would be the worst bug in that feature.
6. Studio paste-import + Layer 7a inherit entry points
7. Player-affordance placement verb (Layer 4)
8. ⚑ **Relationship edges** (Layer 6)
9. Tutorial progression for layers 3–7 — extends task 2's `tutorial.js`

Also outstanding, unrelated: **texture count climbs across regenerations.**
Pre-existing and *not* a living-world issue — it does it with `?livingWorld=0`
too.

## Browser notes

- Screenshots need the Browser pane **displayed** or they time out, and a
  hidden pane does not tick rAF at all — the sim is frozen, so
  `requestAnimationFrame` probes never run.
- The rAF stall in world-gen is fixed (`0f5373e`): `nextGenerationFrame()`
  races rAF against a 32ms timeout. The old rAF-shim + popstate-regen
  workaround is obsolete.
- Reload after every CSS edit (Vite's CSS HMR goes stale in this pane) and
  after every resize (media queries are not re-evaluated for applied rules).
- `window.__sw = {state, controls, scene, camera, renderer}` is the live
  handle; `state.livingWorld.registrations` holds the affordance data.
- Seeds worth using: `0x0007` (verdant, canopy hero), `0x0012` (ashen, spire
  hero).
- **Always pass `lowfx=0`.** The pane is usually short enough to trip LOWFX's
  own detection (`dpr < 1.5 && shortSide < 768`), and LOWFX is not a visual
  setting — it drops the world from five kin to two (`runtime.js:288`), which
  silently changes what any behaviour or onboarding test is looking at.
- `state.livingWorld.fauna[i].agent.dna.speciesId` is the quickest read on who
  is standing in the field; there is no live handle for the observatory's
  selection, which is module-private to `observatory.js`.

## House rules

- **Reasoning effort.** The user runs this project at Opus 5 Medium by default
  and wants a pause rather than a degraded attempt above that. Flag the
  specific step that exceeds it *before* starting it, and finish everything
  that fits in full. Applies to depth of reasoning, not length of work — a
  long mechanical task is not an escalation. (1.14.0 was built at High, at the
  user's explicit direction, because the card was flagged.)
- **Don't touch the camera feel.** `OrbitControls` damping, speed and touch
  mapping in `main.js` are liked as-is.
- **The vibe is a constraint**, not an aspiration — see CLAUDE.md. Cute,
  rounded, soft, easeful. If a change would read as scary, sharp, realistic or
  twitchy it is wrong here even if technically nicer. For the card
  specifically this is now executable: `genome-card-static.test.mjs` fails if
  the writing face takes a monospace face, if anything on the card is red, if
  the unreachable track is filtered rather than hatched, or if the card
  imports three.js, the runtime, or a normalizer.
- **Never rewrite whole files with a Python script on Windows** without
  `newline='\n'` — text-mode writes flip them to CRLF, which breaks
  `ui-readability-static`'s exact-match assertions and bloats the diff.
- **Don't restore files from `cp` backups.** Cost time twice: a
  `git checkout <file>` reverted uncommitted work, and a backup was overwritten
  by a half-executed command. Revert by editing the line.
- Bump `package.json` + add a `CHANGELOG.md` entry before pushing.
  Conventional Commits; the release commit is `chore(release): X.Y.Z`.
- **Static UI tests are invariant tests.** A pure refactor that preserves
  behaviour can still break one — update the assertion to match the new shape
  rather than treating it as a regression. Runtime tests (no `-static` suffix)
  are real regressions.
