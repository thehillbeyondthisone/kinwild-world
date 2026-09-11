# Kinwild

An original procedural living world where generated plants and creatures share
one visual language, one physical surface, and one pulse.

See it live ---> https://thehillbeyondthisone.github.io/kinwild-world

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

The development and preview servers bind to all local interfaces. Devices on
the same network can open `http://<computer-LAN-IP>:2001/`; allow Node.js
through the host firewall if the page is not reachable.

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
- The observatory reads actual field, specimen, terrain, event, and affordance
  state rather than presenting decorative telemetry.

## Creature authoring

Open **Create -> New Form** in the observatory to turn a natural-language
description into three bounded creature studies. The studio shows each
candidate's silhouette, genome hash, gait, primitive cost, and any automatic
repairs before it can enter the field. Accepted forms are saved locally and up
to four return in later strains.

The development server proxies `/llm` to an OpenAI-compatible server:

```sh
# default: http://localhost:1234 (for example, LM Studio)
npm run dev

# alternate local or hosted authoring endpoint
LLM_URL=http://localhost:11434 npm run dev
```

No provider key is stored in the browser. When no model is reachable, the same
studio offers deterministic procedural studies through the identical
validation and introduction path.

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
- `src/creature-authoring.js` - local-model client, reply repair, procedural
  studies, and persistent authored-form records.
- `src/ui/observatory.js` - live observatory read model, selection, taxonomy,
  field telemetry, projected callouts, and Form Studio interaction.

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
