# Kinwild

An original procedural living world where generated plants and creatures share
one visual language, one physical surface, and one pulse.

This repository contains the first integrated vertical slice: reactive
FloraDNA species, seamless primitive-bodied Kinlings, deterministic
composition, terrain-aware procedural motion, and a Kinwild-owned presentation
layer. The target is authored-feeling generative art—not a pile of randomized
parts.

## Run it

Requires Node.js 20.19+ or 22.12+.

```sh
npm ci
npm run dev
```

Open `http://localhost:2001/`. Kinwild is the default experience and writes
`livingWorld=1` into the URL. Seeds remain reproducible:

```text
http://localhost:2001/?seed=0x001e&livingWorld=1
```

The borrowed Small World experience is retained only as a regression harness:

```text
http://localhost:2001/?livingWorld=0
```

## What is generated

- Semantic flora DNA compiles into a landmark canopy organism, pendant
  Pulsebell clusters, and reactive ground cover with shared species resources.
- Semantic fauna DNA compiles into local articulated primitives rendered as
  one blended toon shell, with bounded sibling phenotype variation.
- A deterministic composition planner reserves a focal clearing and arranges
  flora and fauna as a readable scene rather than uniform scatter.
- The world owns navigation intent; Kinlings own gait, terrain planting,
  expression, gaze, notice anticipation, and contact events.
- Footfalls, dust, proximity, plant touch, affordances, atmosphere, lighting,
  post-processing, camera, and UI respond through one coordinated style lock.

## Architecture

- `src/living-world/` — Kinwild identity, composition, runtime, reactions, and
  lifecycle.
- `src/generated-flora/` — FloraDNA validation, deterministic compilers,
  shared resources, instances, and touch dynamics.
- `src/generated-fauna/` — fauna DNA normalization, procedural walker rig,
  blended-shell shader, anchors, bounds, and interaction proxy.
- `src/integration/` — host-neutral provider, world-context, feature-flag, and
  presentation-event contracts.
- `src/world/` — borrowed terrain/atmosphere construction behind the Kinwild
  presentation boundary.

The detailed technical handoff is in
[`docs/KINWILD_FOUNDATION.md`](docs/KINWILD_FOUNDATION.md).

## Quality checks

```sh
npm run check
```

This runs deterministic and lifecycle tests, ESLint, and a production Vite
build. The browser acceptance pass also checks desktop/mobile framing, LOWFX,
pause/regeneration behavior, clean WebGL logs, and the built-in performance
probe.

## Lineage and license

The runtime began from Paul Robello’s MIT-licensed Small World project and
retains its copyright and license. Kinwild’s generated flora/fauna systems,
composition, art direction, terminology, and default experience are an
original layer designed to become independent of that donor scaffold.

MIT — see [`LICENSE`](LICENSE).
