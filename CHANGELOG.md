# Changelog

## 1.14.0 - 2026-07-29

The genome card. The thing 1.13.0 was substrate for: every creature and plant
in the field is a short written document, and now you can read it, turn it
over, and change it while it stands there.

### Added

- **The genome card**, a leaf out of the field notebook with two faces. The
  page face is one row per field, generated from the schema — a term in small
  caps against a measuring rule with a nib on it. The writing face is the real
  JSON, set in the notebook serif on the same paper, captioned with its own
  length in words ("forty-two lines"). Turning between them is a turn, not a
  tab, because the tutorial's rule is that every layer ends on a sight.
- **Relational bounds are drawn before they are enforced.** A leg may be no
  thicker than a quarter of its length, so on a short-legged creature the part
  of the thickness rule it cannot reach is hatched off. Hatched rather than
  greyed: greying says "this control is switched off", hatching says "this
  creature cannot reach here", and only the second one is true.
- **Live rebuild in place.** Moving a rule regrows the thing in the field on a
  120ms debounce — a plant on the spot it already occupies, a kin with its pose
  and its follow camera carried across, so the rebuild reads as the same animal
  changing rather than one vanishing and another arriving.
- **Marginalia.** When an edit trips a bound, the normalizer's repair note
  appears beside the field that caused it, phrased as a field note. Attribution
  is resolved against the schema rather than by reading the leading token, so
  "unknown flora archetype…" does not get filed under a field called "unknown".
- A field that moved *without being touched* is marked. Shorten a creature's
  legs and its thickness follows on its own, which is the whole lesson about
  relational bounds delivered by watching instead of by being told.
- `src/ui/genome-draft.js`: the editing session, DOM-free — apply a change,
  hand the result to the normalizer, and work out which margin the answer
  belongs in. Also the writing-face document model, which is real JSON:
  `JSON.parse` of what is on screen returns the genome.
- Entry points: "Read the genome" on the specimen readout for the selected
  kin, and the flora medallion in Field Taxonomy for a plant.

### Changed

- The specimen readout's header carries one action. It sits there rather than
  as a ninth table row so the card's own rhythm is untouched.

### Fixed

- The hash stamp re-settles when the genome changes, but is no longer
  restarted per pointer sample — a half-second animation retriggered at 60Hz
  renders as a jitter and never once as a stamp coming down. The characters
  still change continuously; only the ink pulse waits its turn.
- An edited plant that outgrows the spot it was standing in now walks to the
  nearest ground that will take it instead of disappearing.

### Verified

- 108 tests, lint, and production build green; `determinism-seed` unaffected —
  nothing here runs inside the seeded window.
- `genome-draft.test.mjs` asserts the property the marginalia depends on: a
  canonical genome renormalizes silently across all nine archetypes and both
  locomotions, so every note on the board was caused by the edit just made.
  It also checks the computed relational ceiling against what the normalizer
  actually enforces, at the ceiling and one step past it.
- `genome-card-static.test.mjs` guards the tone as an executable constraint:
  the writing face may not use a monospace face, nothing on the card may be
  red, the unreachable track must be hatched and not filtered, the native
  range widget must stay invisible, and the card may not import three.js, the
  runtime, or a normalizer.

## 1.13.0 - 2026-07-29

Foundation for a tutorial that teaches the game by teaching its genomes.
Nothing here is player-visible yet: it is the substrate the genome editor,
the mutate verb and the Field Guide's provenance all stand on. Design lives
in `TUTORIAL_PLAN.md`.

### Added

- `describeGenome` turns a genome into the controls an editor should draw,
  generated from the schema's own limits tables rather than written against
  them. A field added to either schema becomes editable, and heritable, with
  no UI change. `shape` controls come from the archetype's own key set, so a
  spire is never offered a cap radius — the discriminated union is visible in
  the UI because it is visible in the data.
- `phraseRepair` restates a normalizer's repair notes in the field guide's
  voice. The notes were always the right thing to show a player — each one is
  a rule of the world, stated at the moment it applied to something they made
  — but shown raw they read as validation errors.
- `removeLivingFlora` takes a plant back out of the field, withdrawing every
  affordance, flower spot, perch and obstacle it registered, releasing any kin
  walking toward it, and disposing its species once the last plant of it is
  gone. `introduceLivingFlora` takes an optional `at` so a rebuild lands where
  the plant stood instead of walking the placement ring.

### Changed

- The walker schema's bounds are a table (`WALKER_CLAMPS`,
  `WALKER_WING_CLAMPS`, `WALKER_RELATIONS`) rather than inline arguments to
  `clamped(...)`. The flora side already worked this way; a bound that only
  the normalizer knows about cannot be offered to an editor or a mutation
  operator, and one that is written down twice drifts silently.
- `MOTION_LIMITS` and `VARIATION_LIMITS` are exported alongside the archetype
  tables they sit beside.

### Fixed

- Affordance ordinals were array indices. `ordinal` is used as an identity —
  kin count capacity claims by it and exclude their last one by it — but was
  assigned from `affordances.length`, which was safe only while nothing ever
  removed an affordance. It is a monotonic counter now, so a plant removed and
  replaced cannot hand a live kin's claim to an unrelated affordance.

### Verified

- 106 tests, lint and build green; `determinism-seed` unaffected.
- `genome-clamp-table` asserts the extracted tables *are* the enforced bounds
  by driving the normalizer at each field's boundaries.
- `genome-schema` asserts control coverage across all nine archetypes and both
  locomotions; `genome-voice` fails when a normalizer grows a note template
  that has no phrasing.
- `living-world-runtime` drives twenty edit-rebuild passes and asserts the
  affordance registry, flower and perch spots, obstacles and species list all
  return to exactly where they started, with ordinals still unique.

## 1.12.0 - 2026-07-28

### Added

- Plant authoring in the Form Studio. `normalizeFloraDNA` was written to repair
  "permissive AI-authored FloraDNA" and nothing produced any — the studio only
  ever authored creatures. It authors both now, through the same
  three-studies flow, with a Kin / Plant mode switch.
- The plant schema is generated from the archetype limits table rather than
  written out, so a new archetype or a retuned bound cannot leave the model
  working from a stale prompt. There is no colour field: a plant takes the
  palette of the field it grows in, so an authored plant belongs to whatever
  world it lands in.
- `introduceLivingFlora` plants an authored species near the arrival clearing,
  walking outward until the ground accepts it. Saved plants return on load the
  way saved kin do.

### Changed

- Authoring's shared half — coaxing JSON out of a local model's reply, the
  LM Studio transport, and the saved-forms shelf — moved to
  `src/authoring-shared.js`. The recovery logic was hardened against real model
  output (quoted numbers, trailing commas, truncated replies) and plants get
  that hardening for free rather than a second copy of it.

### Fixed

- Hero collision was sized from the crown. A canopy hero registered a
  3.92-unit exclusion circle, so kin were held nearly seven units from a trunk
  and nothing could walk beneath a tree. It comes from the structure at
  walking height now: canopy 3.92 -> 0.61, cap 4.85 -> 1.04, spire 2.07 -> 1.11.

### Verified

- 103 tests, lint, production build, and an explicit `determinism-seed` run.
- In the browser: the mode switch reskins the studio, the grammar grows three
  plant studies with zero repairs, the chosen one is planted near the clearing
  and registers its affordances, and a one-entry shelf returns exactly one
  plant across a reload.

## 1.11.0 - 2026-07-28

### Added

- Winged kin. `locomotion` is a genome field now, and a flier carries two wing
  primitives, tucks its legs in flight, banks into its turns and beats its
  wings. Every field draws one winged family alongside its walkers, from a
  separate pool — the perches every hero plant advertises were unusable in
  principle, because `airborne` was hardcoded false.
- Fliers land on those perches. The perch affordance already carried the
  height of the plant offering it, so a flier settles on a hero's crown rather
  than at a guessed altitude, and the plant takes the weight — the frame of
  contact sends a touch impulse into it, so the spire nods as the flier
  arrives. Flora advertises, fauna uses, flora responds.
- Winged kin have their own needs: perching is a long dwell on purpose, and
  they range across the whole island where a walker works locally.

### Changed

- A goal has to be worth travelling to. With 450-odd affordances in a field
  the nearest match is almost always underfoot, so kin were satisfying need
  after need without moving. A minimum-travel floor sends them across the
  field instead — measured on one flier, four minutes: one hero visited
  becomes three, path length 127 to 177.
- A visit lasts. A need only just over threshold used to drain in well under a
  second, so a flier would touch a perch and leave in the same breath.

### Verified

- 102 tests, lint, production build, and an explicit `determinism-seed` run.
- Four simulated minutes of a real runtime: the flier makes repeated landings
  across different heroes, spends about a fifth of its time perched, and the
  walkers never leave the ground.

## 1.10.1 - 2026-07-28

### Fixed

- The Form Studio could become unreachable. Its only opener lived in the field
  card's tool row, and the field card is a lensed panel — the density toggle
  could hide it, and that state persisted, so the studio stayed gone across
  reloads with nothing to get it back but rediscovering the toggle. Narrow
  viewports start with the panels collapsed, so that was the default there.
  The instrument rail carries a second opener now; the rail sits outside every
  `data-obs-panel`, so no lens state can reach it.

## 1.10.0 - 2026-07-28

### Added

- Procedural plants: a plant's silhouette is compiled from its DNA rather than
  chosen from three fixed renderers. A deterministic skeleton (stems, curve,
  branching, habit, path-derived node ids, 40-node budget) carries organs drawn
  from a nine-piece module library, and nine archetype presets — canopy, spire,
  cap, bell, frond, pad, reed, cover, coral — sit on top. Adding a silhouette
  is a row in a table, not a renderer.
- Flora DNA v2 splits the two axes v1 fused: `role` is the compositional tier,
  `archetype` is the shape. `shape` is keyed per archetype, so a groundcover
  cannot request trunk fields. v1 role strings still resolve.
- Archetypes declare the habitat they want — elevation, slope, distance from
  the island centre — and the composition lets the site choose the plant.
- Structural variants per species, and a distance LOD for organs an archetype
  marks as detail.

### Changed

- The field fills its island. Placement is drawn inside five to nine habitat
  patches sampled from the terrain instead of three clumps around one anchor:
  on 0x0007 verdant that is 24 plants reaching under 2% of the island, to 140
  reaching 81% of its radius. The arrival clearing survives as the first hero's
  site with negative space kept around it, and kin orbit their home patch
  instead of pacing the clearing.
- Plants are rows in per-species instanced batches rather than groups of
  meshes, so draw calls scale with the roster and not the field: 20 flora draw
  calls for 140 plants, where the previous approach would have spent ~308.
  Frame time is unchanged from the same measurement at 24 plants.
- Per-plant touch moved into the vertex shader through a shared per-plant data
  texture. The spring itself stays on the CPU, so the observatory's resonance
  trace reads the same snapshot it always did.
- Groundcover carries 26-96 blades per patch rather than 60-240, against ~118
  patches instead of 24.

### Fixed

- The good hand-authored hero and flower detail was gated behind
  `dna.name === "Veilcrown"` / `"Pulsebells"`. Once the species roster started
  generating names every field silently got the plainer fallback renderer. The
  seven-lobe crown, pendant signals, lathed hood and blooming pulse are organ
  counts now, reachable by any species that rolls them.

### Verified

- 99 tests, lint, production build, and an explicit `determinism-seed` run.
- Browser sweep across verdant, desert, coral, ashen and obsidian: the hero is
  no longer a mushroom in every field, silhouettes differ within a field as
  well as between fields, and growth reaches the island's edge.
- `?livingWorld=0` still renders the donor world untouched; the observatory's
  taxonomy, FIELD RELATIONS and specimen resonance still populate.

## 1.9.0 - 2026-07-27

### Added

- Field relations is a real affordance web: every affordance the placed flora
  advertises is retained (105 across 34 plants on a full field, seven types),
  bucketed into nourish / shelter / attune / unknown, laid out on a
  deterministic phyllotaxis spiral and linked to nearest neighbours. The legend
  reports live per-category counts.
- Callout leader lines drawn in viewport space, reaching from each label to its
  projected subject, with a fourth callout for ground cover and a fifth for one
  unselected kin.
- A single shared hint box for the six instrument-rail lenses.
- Form Studio progress: staged copy over an asymptotic fill with rotating
  field-notebook messages, and an automatic fall back to the field grammar when
  no local model answers.
- Taxonomy medallions for each kinling phenotype, drawn with sprite glyphs and
  padded to eight slots with dimmed `unobserved` ghosts.
- MUTATE FIELD in the dock, and the orbital plate mark on field resonance.

### Changed

- Callout projection runs on its own animation frame while every text write
  stays on the 180ms tick, so labels track the camera instead of stair-stepping
  at 5.5Hz. Panel rects and label boxes are cached on the slow tick: the
  per-frame loop forces no style resolution at all.
- The dock is six even cells. The raised circular DRIFT knob, its orbit ring
  and dot, and their per-breakpoint re-tunings are gone; CREATE moved to the
  field card's tool row.
- Form Studio names its actions for what they do rather than how they are
  built.
- The specimen handle rides the card instead of teleporting, and tucks into the
  card's corner at widths where the dock shares its row.

### Fixed

- The specimen card and its closed handle now reach the viewport edge; the dock
  cancelled only one of the two grid gaps between it and the rail.
- The specimen resonance trace read a flat line because the flora bridge never
  exposed `touchState`, so every sample was zero. It reads the real touch
  envelope now, peak rather than mean, normalized against each species' own
  deflection clamp.
- The MOVEMENT row no longer wraps into four stacked lines, and the specimen
  handle no longer sits on top of the card's plate seal.
- Callouts no longer print on top of each other, and a callout blocked by a
  panel lifts clear instead of vanishing.

### Verified

- `npm run check` — 95 tests, lint, production build.
- Live field at 879x673 and 1440x900: 58fps with the projection loop running,
  47 getBoundingClientRect calls/sec and zero getComputedStyle calls/sec.
- MUTATE FIELD reseeds across biomes through a `hidden` control (0x4a9b
  silkvale to 0xafcd ashen).

## 1.8.0 - 2026-07-27

### Added

- A responsive living-field observatory with real world conditions, selected
  genome and morphology readouts, movement traces, derived field resonance,
  projected organism callouts, observed taxonomy, and affordance relations.
- A provider-agnostic Form Studio for OpenAI-compatible local models. It asks
  for three semantic creature studies, normalizes every candidate through the
  bounded fauna grammar, exposes repairs and primitive cost, and introduces an
  accepted form through the existing runtime provider.
- Deterministic procedural studies for offline authoring, persistent authored
  form records, and bounded reintroduction of saved forms in later strains.
- Focused authoring, observatory, persistence, and live-introduction tests.

### Changed

- Replaced the default living-world HUD with an observation-first interface
  while preserving the donor HUD behind `livingWorld=0`.
- Made generated-fauna catalog identity come from normalized species DNA
  instead of hard-coding every generated subject as a Kinling.
- Added a same-origin `/llm` development proxy targeting an OpenAI-compatible
  server at `LLM_URL` or `http://localhost:1234`.

> Versioning is semantic (major.minor.patch) and tracks `package.json`. Versions
> 1.3.4 and 1.3.5 were never cut as separate releases — work in that range was
> folded into the adjacent 1.3.3 and 1.3.6 entries — which is why the history
> below jumps from 1.3.3 to 1.3.6.

## 1.7.0 - 2026-07-26

### Added

- Kinwild as the default, original living-world experience, with the donor
  scene preserved behind `?livingWorld=0` for regression comparison.
- Host-neutral world, flora, fauna, and presentation-event contracts.
- Deterministic FloraDNA compilers for landmark, pendant-bell, and ground-cover
  species with shared resources, affordances, wind, touch, and strict disposal.
- Deterministic fauna DNA and a terrain-planted four-legged procedural actor
  rendered as a mobile-bounded blended primitive shell, including three sibling
  phenotypes, gaze, blink, gait, notice anticipation, anchors, and CPU proxies.
- Authored composition around a scored focal clearing, shared collision and
  surface ownership, footfall dust, proximity-driven foliage reactions, and
  close composition-aware camera framing.
- Kinwild palette, atmosphere, typography, terminology, catalog boundary,
  LOWFX density, tests, and technical foundation documentation.

### Changed

- Renamed package metadata to `kinwild` and made `livingWorld=1` the canonical
  launch mode.
- Removed inherited biome silhouettes, fauna, birds, portals, mountains,
  aurora, cloud treatments, legacy music, and incompatible inspector/catalog
  paths from the generated presentation.
- Added test/lint/build CI gates and fixed zero-valued performance-probe query
  parsing.

### Fixed

- Scaled generated feet now plant before the first rendered frame.
- Generated actors use world-space camera anchors, frame-rate-independent
  separation, capped correction speed, pause-safe motion, and atomic disposal.
- Regeneration, reset, and world-scale changes reframe the active composition.
- Failed generation runs release generated resources without touching a newer
  run.

## 1.6.0 - 2026-07-04

The deferred structural backlog from the 1.5.9 audit (AUDIT.md Phase 4), executed in
dependency order: test-suite conversion first so the refactors land against behavioral
coverage, then the three god-module splits, then documentation.

### Added

- "pbr surface detail" checkbox in the settings FX panel (applies on regen); the
  `pbrDetails` setting is now persisted to localStorage and disabled under LOWFX
  (ARC-L02).
- JSDoc on ~265 exported symbols across 67 `src/` files — contract one-liners,
  param units/ranges, return shapes, and signature-invisible invariants such as
  the seeded-RNG-window rules and the pool reset-every-regen contract (DOC-006).
- New behavioral tests replacing source-grep assertions: real creatures driven
  through `stepCreature`/`stepCaterpillar` (edge recovery, course correction,
  wake transitions), real flora built via `FLORA_BUILDERS` with isolated pools,
  real PBR canvas painting with pixel-variance checks, and headless
  `generateWorld` runs for build-context and loading-order invariants (QA-009).

### Changed

- `src/ui.js` (2,764 lines) split into `src/ui/` sub-modules — context, settings
  panel, first-person modes, photo mode, input glue, locator/follow/tour, help
  panel, catalog panel — behind an unchanged 83-line public entry (ARC-001).
- `src/fauna/creature.js` (2,020 → 1,365 lines): burrower mound, perch/landing
  FSM, and sleep systems extracted to `creature-mound.js` / `creature-perch.js` /
  `creature-sleep.js`; `stepCreature` is now a thin dispatcher over
  `stepThink`/`moveCreature`/`positionCreatureY`/`animateCreature` (ARC-002,
  QA-010).
- `src/environment.js` is a 31-line barrel over `src/environment/` — particles,
  swarms, decals, groundcover, water (ARC-002).
- `generateWorld` decomposed into `src/world/` phase modules — atmosphere,
  flora placement, portal placement, ground cover, fauna population — with every
  `Math.random()` draw and `yieldIfNeeded()` await at its exact prior position;
  `world.js` drops to 413 lines (QA-008).
- Python test suite ported to node `.mjs`; `make test` no longer requires
  Python 3 (QA-023).
- Inspect mode reuses the production wildflower/grass-blade geometry builders
  instead of hand-rolled copies that had drifted slightly (ARC-013).

### Verified

- `make checkall` green after every stage: full test suite, ESLint, production
  build.
- Determinism gates (`determinism-seed`, `portal-world-rng-parity`,
  `world-build-context`) run after each extraction stage of every split — the
  same seed still reproduces the identical world.
- QA-019 grass pre-allocation measured live (`?perf=1`, verdant, seed 0x0001):
  265,875 allocated slots ≈ 16 MB instance matrix (not the ~130 MB the audit
  estimated), 120 fps at 8.3 ms/frame, and the ceiling exactly equals the
  density slider's 300% maximum — left unchanged by design.
- pbr toggle verified in a live browser: persists, respects the LOWFX disable,
  and regenerates the world on change.

## 1.5.9 - 2026-07-03

Second audit-driven remediation pass (four-domain audit in `AUDIT.md`): two runtime correctness bugs, two per-frame performance bugs, security hardening, dedup/consistency cleanups, and a documentation sync. No new user-facing features.

### Added
- `src/shaders/noise.js` — shared GLSL hash/value-noise chunks consumed by `sky.js`, `grass.js`, and `flora/volcanic.js` (precision-distinct variants preserved, not merged).
- `src/world-constants.js` grew shared world↔portal helpers: `rollBiomeAndLayout` (the RNG prefix the portal preview replays), `terrainAmpFor`, `WATER_SURFACE_Y`, wet-depth/flatten/footprint helpers — the preview can no longer silently drift from the destination world.
- Biome flags `hasWillowisps`, `giantFlora`, `guaranteeBurrower`, `treeFloraRadiusFrac` replace hardcoded `biome.id` behavior branches; `EDGE_AURA_DEFAULTS` deduplicates the per-biome edge-aura config.
- Content-Security-Policy meta tag in `index.html` (verified against the Vite build; `style-src 'unsafe-inline'` and `connect-src data:` are load-bearing and documented inline).
- `makeFirstPersonMode` factory in `ui.js` — stroll/fly/photo modes share one mouse-look/key-map/pointer-lock implementation, so the pointer-lock retry fix now covers all three.
- Behavioral regression tests: `caterpillar-trail-trim.test.mjs`, `portal-preview-pool-isolation-runtime.test.mjs`, `portal-world-rng-parity-runtime.test.mjs`, catalog quota-failure rollback case.
- `AUDIT.md` — full four-domain audit report with remediation plan and deferred-work backlog.

### Changed
- Portal previews build against isolated resource pools (`withIsolatedFloraPool`/`withIsolatedCreaturePool`) instead of the shared per-regen pools; the retained-set disposal machinery is gone.
- `disposeGroup` accepts `{ skip }`; creature/crawler placement-rejection paths pass pooled-resource skip sets so a rejected spawn can't dispose geometry other creatures share.
- Ground-mark canvas repaints throttled to ~10 Hz with a cached unit gradient (was: full 512×512 repaint + GPU re-upload every frame).
- Sand/cinder particles clamp against a baked 64×64 height grid and pre-filtered fissure obstacles (was: ~10k three-octave noise evals per frame).
- Twilight's grass-pattern edge aura builds 3,200 line segments instead of 3,200,000 (~128 MB → ~125 KB of attribute data). Visually equivalent at normal viewing; downstream RNG draws shift for twilight seeds, so those worlds differ slightly from 1.5.8.
- Wind/grass settings reapply now rides the existing `world-ready` CustomEvent; the `state._reapply*` back-channel calls from `world.js` and the redundant poll trigger are gone.
- Grass baselines `GRASS_DENSITY_BASE`/`GRASS_HEIGHT_BASE` are canonical exports of `state.js`; persisted settings are type-coerced and range-clamped on load.
- Fur `uLayers` is per-template instead of a shared monotonically-ratcheting uniform; shader `onBeforeCompile` patches warn when their anchor string no longer matches; music playback errors log and clear state so a biome can retry, and superseded crossfades cancel.
- Caterpillar eye/pupil resources pooled per regen (`resetCaterpillarPool`); butterfly/bee/bird velocity integrate/damp/cap/orient boilerplate shared via `fauna/shared.js` helpers; `pushOutOfObstacles` grid/fallback duplication collapsed; nine PBR LOWFX fallback guards collapsed into `pbrMaterialOr`.
- CLAUDE.md architecture inventory synced to the post-1.5.8 module layout (flora split, `world-hud`/`world-constants`/`ui/storage`, catalog subsystem, testing docs, TOC); README gains badges, troubleshooting, prerequisites; CONTRIBUTING gains a Testing section.

### Fixed
- Portal previews contaminated the shared flora/creature pools with the target biome's materials, and preview teardown disposed pooled resources still referenced by the live world (visible wrong-biome flora when a portal was present).
- Caterpillar trail ring buffers never trimmed — unbounded memory growth and linearly rising per-frame cost over a session (~3,850 points after one minute vs. the intended ~200).
- Photo-mode fog decayed to near-zero on cloudlike biomes (cumulative per-frame multiply while paused); fog now derives from a snapshotted baseline.
- Focused `<select>` elements (music dropdown) no longer trigger regen/pause on `r`/Space; catalog save failures show a recoverable error state instead of sticking on "saving"; overlapping catalog panel renders can't interleave; catalog blob/metadata writes can't strand orphans on partial failure.
- `parseSeed` masks to the documented 16-bit seed space; interpolated caterpillar trail positions include `y`; sundry dead code, stale comments, shadowed variables, and disposal gaps (terrain depth material, reflection dome clone, per-texel Vector3 churn).

### Verified
- `make checkall` — 71 JS tests + 53 Python tests, ESLint clean, production build.
- Visual smoke test (headless Chromium): twilight biome loads with zero console errors; zoomed-out island compared side-by-side against the production 1.5.8 build on the same seed.
- `tests/determinism-seed.test.mjs` plus the new portal parity and pool-isolation tests pass; five-seed RNG-prefix parity confirmed.

## 1.5.8 - 2026-06-16

Audit-driven remediation: critical bug fixes, internal structural refactors, hardening, and a determinism regression test. No user-facing feature changes.

### Added
- `tests/determinism-seed.test.mjs` — regression test proving the same seed reproduces a byte-identical world (mechanism + fresh-process structural snapshots). The guardrail that made the structural refactors safe.
- `CONTRIBUTING.md` and README `## License` / `## Contributing` sections.

### Changed
- Split `src/flora.js` (3,225 LOC) into per-kind modules under `src/flora/` (`_shared`, `trees`, `garden`, `rocks`, `structures`, `aquatic`, `volcanic`); `flora.js` is now a thin registry.
- Split `stepCreature` (~860 LOC) into per-mode dispatchers (`stepSleeper` / `stepNightSleep` / `stepBurrower` / `stepFlier`) and deduplicated the sleepiness/slope-pose helpers.
- Extracted `generateWorld`'s HUD/URL finalization phase into `src/world-hud.js` and the UI persistence layer into `src/ui/storage.js`.
- Deduplicated world/portal construction constants into `src/world-constants.js` (single source of truth).
- SHA-pinned all GitHub Actions in the deploy workflow to commit SHAs; gated the `window.__sw` devtools handle behind dev mode.

### Fixed
- Added WebGL context-loss/restore handling so a GPU reset no longer leaves a dead black canvas.
- Fixed a cancelled-and-superseded regen leaving `isGeneratingWorld` stuck true.
- Reapply wind settings synchronously on regen (no more brief wind flicker after each regen).
- Dispose portal-preview builder originals after cloning (per-placement GPU leak), and added a `dispose()` path to the post-FX API.
- Import the shared `wrapAngle` in `caterpillar.js` instead of re-declaring it per frame; guarded divide-by-zero in the fur shader and a zero-base-color Infinity in the grass color computation.
- Fixed a latent portal-preview divergence (`beachsucculent` vs `beach_succulent` flora-footprint key).
- Corrected `package.json` license to MIT and fixed several CLAUDE.md accuracy drifts (async determinism mechanism, `newRandomSeed` count/signature, perch-selection logic).

### Verified
- Verified with `make checkall` (JS + 53 Python tests, lint, production build), the new determinism regression test, and a live browser smoke (cloud-island world renders, no console errors).

## 1.5.7 - 2026-06-14

### Changed
- Bumped dev tooling to latest: `esbuild` 0.28.0 → 0.28.1, `eslint` 10.4.0 → 10.5.0, `vite` 8.0.13 → 8.0.16. Runtime deps (`three`, `simplex-noise`) were already at latest.

### Verified
- Verified with `make checkall` (JS + 53 Python tests, lint, production build) and `npm outdated`/`npm audit` clean.

## 1.5.6 - 2026-06-14

### Changed
- Documented the Field Guide catalog workflow, persistence, duplicate-photo review, and catalog navigation in the README.

### Verified
- Verified with `make checkall`, README diff review, and `graphify update .`.

## 1.5.5 - 2026-06-14

### Fixed
- Removed butterflies from Ashen Wastes spawning and catalog requirements.

### Verified
- Verified with focused catalog/Ashen checks, `make checkall`, an in-app Browser Ashen catalog/locator smoke, and `graphify update .`.

## 1.5.4 - 2026-06-14

### Changed
- Replaced the first-person stroll HUD button's visible `POV`/`stroll` text with a compact icon.
- Made Field Guide biome titles and locked photo slots load that biome with the current seed, preserving the selected biome in the URL.

### Fixed
- Guaranteed Lavender Marsh worlds reserve at least one burrower so the Field Guide and locator can always include that biome-specific entry.

### Verified
- Verified with the focused POV/catalog/world-generation static tests, `make checkall`, an in-app Browser HUD/catalog/locator smoke on `0xA366`, and `graphify update .`.

## 1.5.3 - 2026-06-14

### Fixed
- Fixed non-catalog photo review layout so cloud/sky captures hide the photo-mode seed/hint row and show the no-subject state as a contained status above save/discard.
- Fixed the current-biome Field Guide so locked entries are filtered to subjects the locator can actually target in the generated world, while saved entries remain visible.
- Replaced the Field Guide HUD button's `FG` text with a compact icon.

### Verified
- Verified with focused photo-review HUD/catalog tests, `make checkall`, an in-app Browser catalog/locator smoke on `0xA366`, an agentchrome cloud/no-subject capture on `0xA366`, and `graphify update .`.

## 1.5.2 - 2026-06-14

### Fixed
- Fixed photo-review catalog actions losing contrast over the bright photo border, and added a readable subject-name label to the frame.

### Verified
- Verified with focused catalog UI tests, `make checkall`, an in-app Browser photo-review smoke on `0x2676`, and `graphify update .`.

## 1.5.1 - 2026-06-14

### Added
- Added a persistent on-screen Field Guide button and a `G` hotkey for opening the biome photo catalog without visiting Settings.

### Verified
- Verified with focused catalog UI and POV static tests, `make checkall`, an agentchrome browser smoke for the HUD button and `G` hotkey, and `graphify update .`.

## 1.5.0 - 2026-06-14

### Added
- Added a biome-specific field guide catalog that unlocks fauna and flora entries from photo-mode reticle captures and persists thumbnail photos locally.
- Added catalog compare/replace review controls for re-photographing an existing entry, plus a field guide panel grouped by biome.

### Changed
- Photo review now resolves the reticle subject from scene catalog metadata while preserving regular PNG save/discard behavior.

### Verified
- Verified with focused catalog, subject, photo-review, and UI tests, `make checkall`, an agentchrome browser capture/save/keep/replace run on `0x2676`, and `graphify update .`.

## 1.4.0 - 2026-06-12

### Added
- Added a mid-tier mobile FX profile (`MIDFX`) that keeps bloom but defaults the depth-driven effects (outline, AO, depth fog) off, shrinks the water-reflection target, and caps the pixel ratio at 1.5 on touch devices with DPR ≥ 1.5. Overridable with `?midfx=1` / `?midfx=0`.
- Added PBR detail-texture prewarming so the per-biome canvas paints happen between world-gen frame slices instead of hitching flora placement on slower devices.
- Added vendor chunk splitting in the Vite build so Three.js and simplex-noise ship in stable-hash chunks that survive app-code deploys.
- Added a `make test` target (tests without lint/build) and made the test loop fail the build on any failing file.

### Changed
- Replaced the bloom pipeline with a mip-chain bloom (filtered downsample + Karis average + tent upsample) that does its blur at 1/2–1/32 resolution — far cheaper than the previous full-resolution stacked-pair Gaussian, with no pixelation. The bloom-radius slider now drives the per-step scatter weight.
- Moved the default orbit camera ~36% closer to the island center so worlds frame tighter on load.
- Eliminated per-frame allocations across the fauna hot paths (obstacle-grid queries, terrain-normal/slope sampling, walker slope cache, stray-recovery distance checks) by reusing module-scope scratch objects.
- Consolidated the redundant `state.portal` scalar into the `state.portals` array everywhere.
- Folded the duplicated angle-wrapping loops in `creature.js` into the shared `wrapAngle` helper.

### Fixed
- Fixed the bloom-radius slider above 100% (both branches of the radius mapping were identical, so the wide-halo range never engaged) and restored its 0–300% range.
- Fixed burrower mound sink running at 2× speed from a duplicated `stepMoundSink` call.
- Fixed a per-regen material leak from hidden burrower mounds that `disposeGroup` could not reach.
- Fixed corrupted `?perf=1` telemetry where the will-o'-wisp step shared a phase label with the butterfly/bee/flock step.
- Fixed a bloom render-target resize crash ("Attached DepthTexture is initialized to the incorrect size") by resizing the shared-depth bloom target alongside the depth pre-pass target.

### Verified
- Verified with `make checkall` (all JS + Python tests, lint, production build), headed-browser bloom A/B and resize checks on glow biomes, multi-biome regen smoke tests, and `graphify update .`.

## 1.3.9 - 2026-05-28

### Added
- Added static regression coverage for doubled island sizing without increasing flora or creature spawn counts.
- Added static regression coverage for island-aware orbit framing, renderer pixel-ratio caps, contact-shadow LOD, and Verdant static shadow LOD.
- Added static regression coverage for Mossy Ruins using the mist edge ring.

### Changed
- Doubled the base island size while keeping flora and creature counts tied to the old density target so islands have more breathing room.
- Changed the default orbit camera to frame the generated island from its actual layout radius.
- Lowered the renderer pixel-ratio cap for mobile viewports.
- Added Verdant Grove shadow LOD so far static flora no longer all submit to the shadow map.
- Limited creature and caterpillar contact-shadow discs to the active camera or orbit focus area.
- Changed Mossy Ruins from the black grass-edge ring to a translucent mist ring.
- Doubled default grass density for grass-enabled biomes, including a saved-setting migration so existing browsers move from the old 12.5 baseline to the new 25 baseline.
- Extended the perf probe output with the active static shadow LOD radius.

### Fixed
- Reduced the mobile fly joystick look sensitivity by 50%.
- Fixed stale obstacle-grid reuse during async world generation so fauna steering falls back to the current obstacle array.

### Verified
- Verified with focused JS tests for grass density, island sizing, mobile fly touch, fauna obstacle avoidance, Mossy Ruins mist ring, orbit/render/shadow LOD, and perf-probe reporting.
- Verified with rendered Chrome smoke tests for Verdant Grove and Mossy Ruins, including a Verdant probe showing doubled grass count from `276950` to `553900` with FX disabled.
- Verified with `make checkall` and `graphify update .`.

## 1.3.8 - 2026-05-28

### Changed
- Reworked mobile fly controls into circular touch controls pinned above the bottom HUD.
- Replaced the mobile fly direction arrows with a left-side look joystick.
- Changed the right-side mobile fly buttons to drive forward and backward movement.

### Verified
- Verified with `node tests/mobile-fly-touch-static.test.mjs`, `make checkall`, a mobile viewport smoke test, and `graphify update .`.

## 1.3.7 - 2026-05-28

### Added
- Added compact mobile touch controls for fly camera mode, with edge-pinned movement and altitude buttons plus touch-drag look on the open view.
- Added static regression coverage for the mobile fly camera touch controls.

### Changed
- Changed the fresh-load auto-rotate camera setting to default off in both runtime state and the static settings markup.

### Verified
- Verified with `node tests/mobile-fly-touch-static.test.mjs`, the focused auto-rotate unittest, `make checkall`, and `git diff --check`.

## 1.3.6 - 2026-05-28

### Changed
- Changed the footer fly control into an explicit orbit/fly toggle with clearer active-state text.
- Improved the mobile footer grid so camera toggles and regenerate actions keep balanced touch targets on narrow screens.

### Verified
- Verified with `node tests/pov-toggle-static.test.mjs`, `make checkall`, and a 390px-wide Playwright mobile render/click check.

## 1.3.3 - 2026-05-26

### Added
- Added first-visit help that opens the full help modal once per browser.
- Added a main-view fly camera mode, available from settings or the `V` key, with WASD movement, mouse look, and `E`/`Q` vertical movement.
- Added regression coverage for HUD readability, help modal layout, music toggle state, and immediate music shutdown.
- Added static regression coverage for the fly camera mode UI wiring and tilt-shift gating.

### Changed
- Improved HUD readability with stronger mono text, translucent backdrops, higher contrast secondary labels, and title-cased biome names.
- Changed the help panel into a centered modal with fixed `Help & Controls`, `Modes`, and `Controls` header content while only the body rows scroll.
- Changed help and camera settings copy to document fly camera controls.
- Removed the persistent `drag · zoom · observe` hint above the lower controls.
- Made the top-left title block fade out after five seconds.
- Updated the music toggle icon and accessible labels to distinguish music-on from muted state.

### Fixed
- Fixed music toggle-off behavior so the shared background audio element is silenced and paused immediately.
- Fixed same-origin tab behavior so music-off settings propagate to other open Small World tabs.
- Fixed tilt-shift gating so it also stays disabled while the main-view fly camera is active.

### Verified
- UI/music changes were committed in `959e521` after `make checkall`, focused UI/music regression tests, rendered browser checks for the help modal, music toggle, and title fade, `git diff --check`, and `graphify update .`.
- Fly camera changes were verified with focused fly-mode and tilt-shift static tests, `make checkall`, `graphify update .`, and a Playwright smoke test for `V`, `W`, and `Esc`.
- Release version bump and documentation updates were verified with `make checkall`.

## 1.3.2 - 2026-05-25

### Added
- Added biome portals that can render a preview of the destination biome and allow first-person traversal by reloading into the target seed.
- Added portal settings for enabling portals, double portal placement, and preview rendering details for grass, flora, creatures, and local FX.
- Added original biome music scores and a biome music track selector that can override the default track per biome.

### Changed
- Biome music now streams from `https://static.pardev.net/small-world/music/` so MP3 files stay out of the GitHub Pages build and git history.
- Portal rings now use the destination biome palette and sit deeper in the ground.
- Double portal placement now spreads portals across the island instead of clustering them.
- Portal previews now use higher-fidelity render targets, player-matched projection, and destination biome terrain/flora/grass/creature generation.
- Portals now default to off.

### Fixed
- Fixed portal-side arrival orientation and pointer-lock handling after traversal.
- Fixed portal placement and terrain flattening so portals avoid obstacles and reduce nearby flora/grass clipping.
- Fixed portal previews that could render the wrong side, upside-down back views, or placeholder-like destination scenes.
