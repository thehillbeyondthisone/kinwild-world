# Kinwild — handoff

> **Written for a cold session.** Everything needed to pick this up is here.
>
> Repo: `C:\source\repos\creaturecreator\small-world-integration` — a nested
> git repo (kinwild) inside `creaturecreator`, branch
> `codex/integration-foundation`, upstream = paulrobello/small-world,
> **nothing pushed**. The parent repo is a separate project (Creature Creator,
> port 5173) and is not touched by this work.
>
> Gate per commit: `npm run check` (103 tests + lint + build) **plus**
> `node tests/determinism-seed.test.mjs` explicitly.
> Dev server: `preview_start {name:"kinwild"}` → **:2001**.
> **The living world needs `?livingWorld=1` in the URL.** Without it you get
> the untouched donor world and `state.livingWorld` is null — a seed sweep that
> forgets the flag reports "no living world" on every seed and looks broken.

## Where this landed

Version **1.12.0**. Ten commits since `cb41af2`, in two arcs.

**Arc one — the flora rework** (three staged commits, from
`WORLD_IMPLEMENTATION_PLAN.md`):

| | |
|---|---|
| `3d11076` | Archetype compiler. A plant's silhouette comes from its DNA, not a code path. |
| `84ec63f` | Species batching. Plants are rows in instanced batches; touch moved into the vertex shader. |
| `3415468` | Composed island. Habitat patches replace three clumps around one anchor. |

**Arc two — the follow-up list** (this session):

| | |
|---|---|
| `8343d4f` | Form Studio stayed reachable with every panel lens hidden. |
| `71d3f8e` | Wind sways from height up the *plant*, not up the organ. |
| `a69b041` | Plants stay distinguishable from the ground they stand on. |
| `ed4f9ee` | **Kin pursue what the field offers** instead of pacing a circle. |
| `1e9ff60` | **Winged kin**, and perches that finally mean something. |
| `01b74e9` | Hero collision sized from the trunk, not the crown. |
| `e08f3f2` | **Plant authoring** in the Form Studio. |

The through-line: the field used to *publish* an ecology that nothing
consumed. It is now a closed loop — flora advertises affordances, fauna
pursues them, flora responds to being used.

## The shape of it

```
src/generated-flora/
  archetypes.js   nine presets (canopy spire cap bell frond pad reed cover coral)
                  each declares: habit, organs, affordances, shape limits,
                  habitat preference. Adding a silhouette is a row here.
  skeleton.js     DNA -> deterministic node graph. Path-derived ids ("1/2/b0"),
                  40-node budget enforced by pruning deepest/thinnest first.
  organs.js       nine organ builders + attachment rules.
  renderers.js    compileArchetype: skeleton + organs -> shared GPU resources.
  batch.js        per-species InstancedMesh batches; the touch data texture;
                  the vertex-shader bend.
  dna.js          DNA v2. `role` = tier (hero/mid/ground), `archetype` = shape.
                  `shape` is keyed per archetype (a groundcover has no trunk
                  fields to request). v1 role strings still resolve.

src/generated-fauna/
  dna.js          `locomotion: walker | flier`; fliers carry a `wings` block.
  walker.js       one rig, two modes. Wings are two more capsules; hover, bank
                  and leg-tuck are all driven by `intent.hover`.

src/living-world/
  roster.js       8 flora families + 3 walker families + 2 flier families.
                  Every field draws one winged family from its own pool.
  runtime.js      composition, placement, the fauna step, introduce paths.
  kin-goals.js    needs -> goal choice over the affordance registry.

src/flora-authoring.js / creature-authoring.js / authoring-shared.js
```

## Decisions that took work to reach — don't re-litigate

**Batching.** Draw calls scale with the roster, not the field: 20 flora draw
calls for 140 plants where the unbatched equivalent is ~308. A plant is a row
plus an empty `THREE.Group` carrying its transform. The group is still what
the host parents, positions and raycasts — it just holds no meshes.

**The touch bend is injected into `project_vertex`, not `begin_vertex`.**
After `instanceMatrix` the vertex is already in the batch root's space, which
is where `aPlantBase` lives. Bending earlier would mean inverse-rotating a
world-space displacement through each row's own basis — the trap `grass.js`
documents at length.

**`aPlantBase` is a vec4**: xyz = base, w = plant span. Both the wind patch and
the touch patch declare it, and they install on the same material in either
order, so each declaration sits behind a `KW_PLANT_BASE_DECLARED` guard.

**Wind amplitude is calibrated against the donor tree**, not picked: the donor
crown travels ~2.5% of plant height at strength 0.18. A generated canopy lands
at ~1.5%, groundcover at ~7%. Donor flora must keep the old path —
`applyWindSway(mat, strength)` without `{ plantRelative: true }` — because a
donor plant is one mesh at plant-local coordinates and is already correct.

**A flier caps at four legs** because of the influence budget, not taste: six
legs plus two wings needs ten entries in the body's influence list against a
cap of eight. Fliers default to two.

**Hero collision comes from the trunk.** Sizing it from the bounds radius gave
a canopy a 3.92-unit exclusion circle — kin held nearly seven units out, unable
to walk under a tree, and every affordance the plant advertised sat inside a
circle they were pushed out of every frame.

**Species colour is separated from terrain by measurement.** `paletteFor`
builds from the biome accent on the premise it is warm; several biomes' accents
are violet, and those grew plants at 1.00:1 luminance against their own ground.
`separateFromTerrain` holds a 1.8:1 floor, moving lightness only.

**Determinism.** Per-frame behaviour (kin goals, flight) runs *after*
`generateWorld` restores the real `Math.random`, so it is outside the seeded
window and free to jitter. World-gen streams are namespaced
(`hashSeed("kinwild/patch", index, seed)`) so adding a species cannot shift
terrain or existing placements.

## Things that only showed under simulation

Reading the code would not have found these. A harness that drives a real
runtime for a few simulated minutes did.

- **A goal on a hero plant was unreachable by construction** — affordances sit
  at the plant, the plant's obstacle covered the crown. One kin of five stood
  6.72 from a goal with a 2.17 arrival radius for three minutes, every need
  pinned at 1.0, while the others roamed. Fixed twice over: `reachableRadius`
  in `kin-goals.js` grows the arrival radius to what the obstacle permits
  (keep it — it is the right guard for *any* affordance inside *any* obstacle),
  and `01b74e9` stopped heroes tripping it in the first place.
- **Kin satisfied needs without moving.** With ~450 affordances the nearest
  match is always underfoot. `MIN_TRAVEL` makes a goal worth going to.
- **A visit ended before it read as one.** A need only just over threshold
  drained in under a second, so a flier touched a perch and left in the same
  breath — 22 landings, zero time perched.

**If you change fauna behaviour, drive it.** Build a runtime like
`tests/living-world-runtime.test.mjs` does, step it 180×60 frames, and report
path length, distinct affordances visited, and time spent stationary. Numbers
like "one kin has path 14 while the others have 90" are how the above were
found.

## Verification, and the gap in it

Everything is measured. **Much of it has not been seen** — the Browser pane was
hidden for most of this session, so `71d3f8e`, `a69b041`, `ed4f9ee` and
`1e9ff60` are verified numerically and by simulation but not visually.

**The first thing a new session should do is display the pane and look**, at
`?livingWorld=1&lowfx=0` on `0x0007` (verdant, canopy hero) and `0x0012`
(ashen, spire hero). Specifically worth eyes:

- the wind — does a tree crown move ~1.5% of its height and read as gentle?
- the contrast fix — do plants read against terrain in cloud/frozen/desert?
- **the shot this was all built for**: a flier crossing the island, spiralling
  down onto a glowing spire crown, and the spire dipping under it.

Browser notes: screenshots need the pane **displayed** or they time out, and a
hidden pane does not tick rAF at all — the sim is frozen, so `requestAnimationFrame`
probes never run. Reload after CSS edits and after resizes. Restart the dev
server after a version bump (`APP_VERSION` is injected at server start).

## Known-good measurements, for comparison

Seed `0x0007`, verdant, `?livingWorld=1&lowfx=0`:

- 140 plants, reaching 81% of the island radius
- 20 flora draw calls (~308 unbatched), 68 total, 217k triangles
- median frame 16.8ms, p95 19.4ms — unchanged from the same measurement at 24
  plants, so frame time did not move with six times the growth
- LOWFX: 66 plants, same 81% reach, 14 batches

## Where to go next

Nothing is half-finished; the task list is clear. Candidates:

1. **Stage 4 of the original plan: SDF blend-shell hero plants.** Deliberately
   deferred until after batching and distribution. Reuse
   `generated-fauna/shell.js`'s primitive + influence-graph pattern for
   hero/landmark *structure only* (trunks, junctions, bulbs), with instanced
   organs on top. Fauna caps near 8 full-quality shells, so hero plants must be
   similarly capped and LOD'd. **This wants High reasoning effort.**
2. **New `BIOMES` entries.** Genuinely worthwhile since the style genome landed
   — a content task, not an architectural one.
3. **Aquatic locomotion.** `aquatic` is hardcoded `false` at
   `generated-fauna/walker.js`, the same way `airborne` was. The flier work is
   the template.
4. **Texture count climbs across regenerations.** Pre-existing — it does it with
   `?livingWorld=0` too, so it is a donor-world issue, not the living world's.

## House rules worth knowing

- **Reasoning effort**: the user runs this project at Opus 5 Medium by default
  and wants a pause rather than a degraded attempt above that. Flag the
  specific step that exceeds it *before* starting it, and finish everything
  that fits in full. Applies to depth of reasoning, not length of work.
- **Don't touch the camera feel.** `OrbitControls` damping, speed and touch
  mapping in `main.js` are liked as-is.
- **The vibe is a constraint**, not an aspiration — see CLAUDE.md. Cute,
  rounded, soft, easeful. If a change would read as scary, sharp, realistic or
  twitchy it is wrong here even if technically nicer.
- **Never rewrite whole files with a Python script on Windows** without
  `newline='\n'` — text-mode writes flip them to CRLF, which breaks
  `ui-readability-static`'s exact-match assertion and bloats the diff.
- **Don't restore files from `cp` backups.** Cost time twice this session: a
  `git checkout <file>` reverted uncommitted work, and a backup got overwritten
  by a half-executed command. Revert by editing the line.
- Bump `package.json` + add a `CHANGELOG.md` entry before pushing. Conventional
  Commits.
