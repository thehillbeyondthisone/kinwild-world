# Kinwild foundation

Kinwild is an original procedural living-world prototype. Small World is used
only as a temporary donor for mature Three.js terrain, lifecycle, camera, and
post-processing infrastructure; its visible biomes, flora, fauna, catalog,
music, portals, and presentation are excluded from the default experience.

## Launch modes

- `/` launches Kinwild and canonicalizes the URL with `livingWorld=1`.
- `?seed=0x001e&livingWorld=1` reproduces a Kinwild strain.
- `?livingWorld=0` launches the untouched donor experience for regression
  comparison and rollback.
- `?generatedFlora=1` or `?generatedFauna=1` enables a single generated
  provider in the donor harness for contract testing.

## Runtime shape

```text
seed
  -> namespaced deterministic streams
  -> Kinwild style genome
  -> focal clearing and authored composition
  -> FloraDNA species compilers
  -> fauna DNA and local SDF-shell actors
  -> shared surface, affordance, and event contracts
  -> terrain contact, plant reactions, particles, gaze, and camera
```

`src/integration/` defines the host-neutral contracts and adapters.
`src/generated-flora/` compiles validated semantic plant DNA into shared
geometry/material species and lightweight instances. `src/generated-fauna/`
normalizes creature DNA and renders articulated primitive anatomy as a local
blended shell. `src/living-world/` owns the original Kinwild style,
composition, placement, cross-system reactions, presentation, and lifecycle.

## Current vertical slice

The foundation intentionally proves depth before breadth:

- one deterministic focal composition rather than uniform scatter;
- one landmark flora family, one pendant-bell mid-layer, and one reactive
  ground-cover family;
- one related Kinling species expressed through three sibling phenotypes;
- terrain-planted procedural gait, gaze, blink, notice anticipation, and
  externally owned motion intent;
- shared footfall events, dust, proximity/touch reactions, shelter/perch/nectar
  affordances, and collision ownership;
- a Kinwild-only palette, atmosphere lock, framing, typography, terminology,
  catalog, and silent audio boundary;
- LOWFX density and shader reductions plus deterministic disposal.

Gameplay, portals, progression, and large ecology systems are deliberately
outside this foundation pass. The next layer should add species breadth and
ecological relationships without weakening the art lock or reintroducing donor
identity.

## Invariants

- Generated content never consumes ambient `Math.random`.
- Flora and fauna use coordinates local to the shared world root.
- The world runtime owns movement intent and ecological placement.
- Generated systems own and idempotently dispose their resources.
- Runtime DNA is repaired and bounded before geometry or shaders are built.
- A failed generation cannot leave generated actors or shared species alive.
- The donor path remains available and behaviorally unchanged behind
  `livingWorld=0`.

## Validation

Run:

```sh
npm run check
```

Visual acceptance includes clean browser logs, deterministic seed comparison,
desktop and mobile framing, LOWFX behavior, pause/regeneration checks, and a
performance probe using `?perf=1&perfFrames=120&perfSettle=20`.

The reference `0x001e` desktop pass at 1280×720, DPR 1, and full Kinwild
effects measured 18.33 ms/frame (54.5 fps) with a 33.4 ms p95 across 120
frames. It rendered 4 Kinlings, 31 terrain-validated flora placements, 74
instanced meshes, 261 scene objects, and 11 shadow casters. On the same
browser/GPU path, the captured donor baseline measured 23.61 ms/frame
(42.4 fps) with a 33.5 ms p95. Treat these as a regression reference rather
than a cross-device promise.
