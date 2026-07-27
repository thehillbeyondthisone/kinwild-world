import * as THREE from "three";
import { APP_VERSION, state } from "../state.js";
import { generateIslandName } from "../islandname.js";
import {
  GLYPHS,
  conditionGlyphs,
  morphologyGlyphs,
  renderGlyphDial,
  renderGlyphRun,
  traitGlyphs,
} from "./glyphs.js";
import { introduceLivingFauna } from "../living-world/index.js";
import {
  createProceduralStudies,
  listAuthoringModels,
  loadAuthoredForms,
  requestCreatureCandidates,
  saveAuthoredForm,
} from "../creature-authoring.js";
import { ctx } from "./context.js";

const CYCLE_KEY = "living-field:observation-cycle:v1";
const PANEL_VISIBILITY_KEY = "living-field:panel-visibility:v1";
const PANEL_LENSES = [
  "field",
  "fauna",
  "flora",
  "relations",
  "catalog",
  "controls",
];
const MAX_RETURNING_FORMS = 4;
// Comfortably past the 4.4s masthead pulse (and its 2.2s reduced-motion
// variant) so the fallback only fires when animationend genuinely never does.
const BRAND_PULSE_SETTLE_MS = 5200;
const METER_DOTS = 10;
const WAVE_SAMPLES = 56;
// Window the kin-activity rate is measured over. Long enough that a single
// footfall does not spike it, short enough to track a herd settling.
const ACTIVITY_WINDOW_MS = 4000;
const vector = new THREE.Vector3();
const surfaceHit = { height: 0, normal: new THREE.Vector3(), material: null };

function element(id) {
  return document.getElementById(id);
}

function safeText(value, fallback = "—") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function surfaceMaterialLabel(material) {
  if (typeof material === "string") return safeText(material, "terrain");
  if (typeof material?.name === "string" && material.name.trim()) {
    return material.name.trim().toLowerCase();
  }
  return "terrain";
}

function formatSeed(seed) {
  return `0x${(Number(seed) >>> 0).toString(16).padStart(4, "0").slice(-4)}`;
}

function formatElapsed(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remaining = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function pathFrom(width, height, points, valueAt) {
  const safePoints = Math.max(2, points);
  let path = "";
  for (let index = 0; index < safePoints; index++) {
    const t = index / (safePoints - 1);
    const x = t * width;
    const y = height * 0.5 - valueAt(t, index) * height * 0.42;
    path += `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return path;
}

function meanHeadingCoherence(actors) {
  if (!actors?.length) return 0;
  let x = 0;
  let z = 0;
  for (const actor of actors) {
    const speed = actor.velocity?.length?.() ?? 0;
    const weight = Math.max(0.2, Math.min(1, speed * 2.4));
    x += Math.sin(actor.facade?.heading ?? 0) * weight;
    z += Math.cos(actor.facade?.heading ?? 0) * weight;
  }
  return Math.min(1, Math.hypot(x, z) / actors.length);
}

function movementStability(actors) {
  if (!actors?.length) return 0;
  const speeds = actors.map((actor) => actor.velocity?.length?.() ?? 0);
  const mean = speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length;
  const variance =
    speeds.reduce((sum, speed) => sum + (speed - mean) ** 2, 0) /
    speeds.length;
  return Math.max(0, Math.min(1, 1 - Math.sqrt(variance) * 2.8));
}

function renderRun(target, count, factory) {
  if (!target) return;
  const items = [];
  for (let index = 0; index < count; index++) items.push(factory(index));
  target.replaceChildren(...items);
}

function renderMeter(target, value, count = METER_DOTS) {
  const lit = Math.round(Math.max(0, Math.min(1, value)) * count);
  renderRun(target, count, (index) => {
    const dot = document.createElement("i");
    if (index < lit) dot.className = "on";
    return dot;
  });
}

/**
 * A fixed-length ring of samples plus the path generator that reads it.
 * The waveforms used to be pure `sin(t)` with no input; these carry the real
 * signal so the trace actually moves with the field.
 */
function makeRing(size) {
  return { values: new Float32Array(size), head: 0, filled: 0 };
}

function pushRing(ring, value) {
  ring.values[ring.head] = Number.isFinite(value) ? value : 0;
  ring.head = (ring.head + 1) % ring.values.length;
  if (ring.filled < ring.values.length) ring.filled += 1;
}

function pathFromRing(ring, width, height, amplitude = 1) {
  const size = ring.values.length;
  return pathFrom(width, height, size, (_t, index) => {
    // Read oldest-first so the trace scrolls left as samples arrive.
    const slot = (ring.head + index) % size;
    return (ring.values[slot] * 2 - 1) * amplitude;
  });
}

function deriveTraits(dna) {
  if (!dna) return ["unobserved"];
  const traits = [];
  if (dna.legs.count === 2) traits.push("upright");
  if (dna.legs.count === 4) traits.push("grounded");
  if (dna.legs.count === 6) traits.push("manyfoot");
  if (dna.legs.length > 0.58) traits.push("long-step");
  if (dna.body.radius > 0.37) traits.push("broadbody");
  if (dna.motion.lift > 0.11) traits.push("high-gait");
  if (dna.motion.bob < 0.016) traits.push("steady");
  return traits.slice(0, 4);
}

function setPalette(target, palette, keys = ["body", "head", "limb", "eye"]) {
  if (!target) return;
  target.replaceChildren();
  for (const key of keys) {
    const color = palette?.[key];
    if (!color) continue;
    const dot = document.createElement("i");
    dot.style.backgroundColor = color;
    target.append(dot);
  }
}

function createTaxon({ name, glyph, color, kind, key }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "obs-taxon";
  button.dataset.kind = kind;
  button.dataset.key = key;
  const icon = document.createElement("span");
  icon.className = "obs-taxon-icon";
  icon.textContent = glyph;
  const colorDot = document.createElement("i");
  colorDot.style.backgroundColor = color;
  icon.append(colorDot);
  const label = document.createElement("span");
  label.className = "obs-taxon-name";
  label.textContent = name;
  button.append(icon, label);
  return button;
}

function taxonomyRecords(runtime) {
  if (!runtime) return [];
  const records = [];
  const fauna = new Map();
  for (const actor of runtime.fauna ?? []) {
    const dna = actor.agent?.dna;
    if (!dna || fauna.has(dna.speciesId)) continue;
    fauna.set(dna.speciesId, true);
    records.push({
      kind: "fauna",
      key: dna.speciesId,
      name: dna.name,
      glyph: dna.legs.count === 6 ? "✣" : dna.legs.count === 2 ? "⋔" : "◉",
      color: dna.palette.body,
    });
  }
  const flora = new Map();
  for (const entry of runtime.flora ?? []) {
    const species = entry.species;
    const key = species?.id ?? entry.recipe?.key;
    if (!key || flora.has(key)) continue;
    flora.set(key, true);
    const role = species?.role ?? entry.recipe?.role;
    records.push({
      kind: "flora",
      key,
      name: species?.name ?? entry.recipe?.dna?.name ?? "Field flora",
      glyph:
        role === "hero-mushroom"
          ? "♁"
          : role === "groundcover"
            ? "≋"
            : "✥",
      color: entry.recipe?.palette?.primary ?? "#d8aa62",
    });
  }
  return records.slice(0, 8);
}

function projectCallout(target, object, camera, offsetX, offsetY) {
  if (!target || !object || !camera) {
    target?.classList.remove("visible");
    return;
  }
  object.updateWorldMatrix(true, false);
  object.getWorldPosition(vector);
  vector.project(camera);
  if (vector.z < -1 || vector.z > 1) {
    target.classList.remove("visible");
    return;
  }
  const x = (vector.x * 0.5 + 0.5) * window.innerWidth + offsetX;
  const y = (-vector.y * 0.5 + 0.5) * window.innerHeight + offsetY;
  const reserved = [
    ".obs-field-card",
    ".obs-specimen:not(.collapsed)",
    ".obs-paper-tab",
    ".obs-resonance",
    ".obs-dock",
    ".obs-taxonomy",
    ".obs-relations",
  ]
    .map((selector) => document.querySelector(selector))
    .filter((element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    })
    .map((element) => element.getBoundingClientRect());
  const collides = (left) => {
    const box = {
      left: left - 32,
      right: left + 180,
      top: y - 4,
      bottom: y + 62,
    };
    return reserved.some(
      (rect) =>
        box.left < rect.right &&
        box.right > rect.left &&
        box.top < rect.bottom &&
        box.bottom > rect.top,
    );
  };
  const safeX = [x, x - 205].find(
    (candidate) =>
      candidate >= 32 &&
      candidate <= window.innerWidth - 170 &&
      !collides(candidate),
  );
  if (safeX == null || y < 135 || y > window.innerHeight - 175) {
    target.classList.remove("visible");
    return;
  }
  target.style.transform = `translate3d(${safeX.toFixed(0)}px, ${y.toFixed(0)}px, 0)`;
  target.classList.add("visible");
}

function blueprintMarkup(dna) {
  const bodyWidth = 62 + dna.body.halfLength * 95;
  const bodyHeight = 28 + dna.body.radius * 70;
  const bodyX = 100 - bodyWidth * 0.5;
  const bodyY = 54 - bodyHeight * 0.5;
  const headRadius = 12 + dna.head.radius * 38;
  const headX = 100 + bodyWidth * 0.39;
  const headY = 48 - dna.head.offset[1] * 18;
  const legTopY = bodyY + bodyHeight * 0.7;
  const legBottomY = Math.min(111, legTopY + 24 + dna.legs.length * 28);
  const positions = [];
  for (let index = 0; index < dna.legs.count; index++) {
    const group = Math.floor(index / 2);
    const pair = index % 2;
    const pairs = dna.legs.count / 2;
    const x = bodyX + 12 + (group / Math.max(1, pairs - 1)) * (bodyWidth - 24);
    positions.push({
      x1: x,
      y1: legTopY,
      x2: x + (pair === 0 ? -8 : 8),
      y2: legBottomY,
    });
  }
  return `
    <svg class="form-blueprint" viewBox="0 0 200 125" aria-hidden="true">
      ${positions
        .map(
          (leg) =>
            `<path class="limb" d="M${leg.x1.toFixed(1)} ${leg.y1.toFixed(1)} Q${(
              (leg.x1 + leg.x2) /
              2
            ).toFixed(1)} ${(leg.y1 + 12).toFixed(1)} ${leg.x2.toFixed(1)} ${leg.y2.toFixed(1)}" stroke="${dna.palette.limb}" stroke-width="${Math.max(3, dna.legs.thickness * 52).toFixed(1)}"/>`,
        )
        .join("")}
      <rect class="body" x="${bodyX.toFixed(1)}" y="${bodyY.toFixed(1)}" width="${bodyWidth.toFixed(1)}" height="${bodyHeight.toFixed(1)}" rx="${(bodyHeight * 0.48).toFixed(1)}" fill="${dna.palette.body}"/>
      <circle class="head" cx="${headX.toFixed(1)}" cy="${headY.toFixed(1)}" r="${headRadius.toFixed(1)}" fill="${dna.palette.head}"/>
      <circle class="eye" cx="${(headX + headRadius * 0.38).toFixed(1)}" cy="${(headY - headRadius * 0.15).toFixed(1)}" r="${Math.max(2.5, dna.head.eyeRadius * 42).toFixed(1)}"/>
    </svg>
  `;
}

function candidateCard(candidate, index) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "form-candidate";
  button.dataset.index = String(index);
  button.innerHTML = blueprintMarkup(candidate.dna);
  const title = document.createElement("h3");
  title.textContent = candidate.dna.name;
  const id = document.createElement("div");
  id.className = "form-candidate-id";
  id.textContent = `${candidate.source} · ${candidate.dna.speciesId} · ${candidate.genomeHash}`;
  const stats = document.createElement("div");
  stats.className = "form-candidate-stats";
  for (const [label, value] of [
    ["legs", `${candidate.dna.legs.count}`],
    ["primitives", `${candidate.primitiveCount}/16`],
    ["gait", `${Math.round(1 / candidate.dna.motion.stepDuration * 10) / 10} hz`],
    ["repairs", `${candidate.repairs.length}`],
  ]) {
    const key = document.createElement("span");
    key.textContent = label;
    const item = document.createElement("span");
    item.textContent = value;
    stats.append(key, item);
  }
  const repair = document.createElement("div");
  repair.className = "form-candidate-repair";
  repair.textContent = candidate.repairs.length
    ? `${candidate.repairs.length} bounded adjustment${candidate.repairs.length === 1 ? "" : "s"} applied`
    : "canonical genome · no repair required";
  button.append(title, id, stats, repair);
  return button;
}

export function initObservatory() {
  const shell = element("observatory-shell");
  if (!shell) return;

  const sessionStarted = performance.now();
  const refs = {
    observed: element("obs-observed"),
    cycle: element("obs-cycle"),
    notePhase: element("obs-note-phase"),
    noteAir: element("obs-note-air"),
    conditions: element("obs-conditions"),
    temperature: element("obs-field-temperature"),
    fieldName: element("obs-field-name"),
    fieldSub: element("obs-field-sub"),
    genome: element("obs-genome"),
    strainRun: element("obs-strain-run"),
    species: element("obs-species"),
    movement: element("obs-movement"),
    morphology: element("obs-morphology"),
    morphologyText: element("obs-morphology-text"),
    habitat: element("obs-habitat"),
    activity: element("obs-activity"),
    activityRun: element("obs-activity-run"),
    caption: element("obs-selection-caption"),
    palette: element("obs-palette"),
    traits: element("obs-traits"),
    specimenWave: element("obs-specimen-wave"),
    movementPath: element("obs-movement-path"),
    fieldWave: element("obs-field-wave"),
    fieldThread: element("obs-field-thread"),
    stability: element("obs-stability"),
    coherence: element("obs-coherence"),
    harmony: element("obs-harmony"),
    pulse: element("obs-pulse-label"),
    taxonomy: element("obs-taxonomy-list"),
    railCount: element("obs-rail-count"),
    catalogCount: element("obs-catalog-count"),
    strain: element("obs-strain-label"),
    focus: element("obs-focus-label"),
    relationStatus: element("obs-relation-status"),
    creatureCallout: element("obs-callout-creature"),
    heroCallout: element("obs-callout-hero"),
    floraCallout: element("obs-callout-flora"),
  };

  const version = element("obs-version");
  if (version) version.textContent = APP_VERSION;
  const brand = element("obs-brand");

  // The masthead stays visible; a regen replays a pulse over it. Removing the
  // class and forcing a reflow is what lets the same animation restart when
  // two regens land close together.
  let brandSettleTimer = 0;
  const settleBrand = () => {
    window.clearTimeout(brandSettleTimer);
    brand?.classList.remove("is-revealing");
  };

  function emphasizeBrand() {
    if (!brand) return;
    brand.classList.remove("is-revealing");
    void brand.offsetWidth;
    brand.classList.add("is-revealing");
    // animationend never fires if the animation is suppressed or the tab is
    // not compositing, so the class is also cleared on a timer. Without this
    // the heading could be left mid-keyframe indefinitely.
    window.clearTimeout(brandSettleTimer);
    brandSettleTimer = window.setTimeout(settleBrand, BRAND_PULSE_SETTLE_MS);
  }

  brand?.addEventListener("animationend", (event) => {
    if (event.target === brand) settleBrand();
  });

  let selectedFacade = null;
  let previousFollow = null;
  let observedRuntime = null;
  let unsubscribeEvents = null;
  let eventLog = [];
  let cycle = Number.parseInt(localStorage.getItem(CYCLE_KEY) ?? "0", 10) || 0;
  let currentCandidates = [];
  let candidateIndex = -1;
  let requestController = null;
  let brandPulseTimer = 0;
  // Rolling samples behind the four traces. Before these the waveforms were
  // fixed sines with no input at all — they looked live and measured nothing.
  const speedRing = makeRing(WAVE_SAMPLES);
  const agitationRing = makeRing(WAVE_SAMPLES);
  const coherenceRing = makeRing(WAVE_SAMPLES);
  const stabilityRing = makeRing(WAVE_SAMPLES);
  const compactPanelQuery = window.matchMedia(
    "(max-width: 1120px), (max-height: 650px)",
  );
  const defaultPanelVisibility = () => {
    const spacious = !compactPanelQuery.matches;
    return Object.fromEntries(
      PANEL_LENSES.map((lens) => [
        lens,
        spacious || lens === "field" || lens === "controls",
      ]),
    );
  };
  const loadPanelVisibility = () => {
    try {
      const stored = JSON.parse(localStorage.getItem(PANEL_VISIBILITY_KEY));
      if (!stored || typeof stored !== "object") return defaultPanelVisibility();
      return Object.fromEntries(
        PANEL_LENSES.map((lens) => [lens, stored[lens] !== false]),
      );
    } catch {
      return defaultPanelVisibility();
    }
  };
  const panelVisibility = loadPanelVisibility();

  function renderPanelVisibility({ persist = false } = {}) {
    const firstRender = !shell.classList.contains("obs-panels-ready");
    for (const lens of PANEL_LENSES) {
      const visible = panelVisibility[lens] !== false;
      const button = document.querySelector(`[data-obs-lens="${lens}"]`);
      button?.classList.toggle("active", visible);
      button?.setAttribute("aria-pressed", String(visible));
      document
        .querySelectorAll(`[data-obs-panel="${lens}"]`)
        .forEach((panel) => {
          panel.classList.toggle("obs-lens-hidden", !visible);
          panel.setAttribute("aria-hidden", String(!visible));
        });
    }
    const anyVisible = PANEL_LENSES.some(
      (lens) => panelVisibility[lens] !== false,
    );
    element("obs-density-toggle").setAttribute(
      "aria-pressed",
      String(anyVisible),
    );
    if (
      firstRender &&
      panelVisibility.fauna !== false &&
      window.matchMedia("(max-width: 760px)").matches
    ) {
      element("obs-specimen").classList.add("mobile-open");
      element("obs-specimen-close").setAttribute("aria-expanded", "true");
      element("obs-specimen-close").setAttribute(
        "aria-label",
        "collapse specimen readout",
      );
    }
    shell.classList.add("obs-panels-ready");
    if (persist) {
      localStorage.setItem(
        PANEL_VISIBILITY_KEY,
        JSON.stringify(panelVisibility),
      );
    }
  }

  function togglePanelLens(lens) {
    const opening = panelVisibility[lens] === false;
    panelVisibility[lens] = !panelVisibility[lens];
    if (lens === "fauna" && window.matchMedia("(max-width: 760px)").matches) {
      const specimen = element("obs-specimen");
      specimen.classList.toggle("mobile-open", opening);
      if (opening) specimen.classList.remove("collapsed");
      element("obs-specimen-close").setAttribute(
        "aria-expanded",
        String(opening),
      );
      element("obs-specimen-close").setAttribute(
        "aria-label",
        opening ? "collapse specimen readout" : "open specimen readout",
      );
    }
    renderPanelVisibility({ persist: true });
  }

  function bindRuntime(runtime) {
    if (runtime === observedRuntime) return;
    unsubscribeEvents?.();
    observedRuntime = runtime;
    eventLog = [];
    if (runtime?.events?.onAny) {
      unsubscribeEvents = runtime.events.onAny((event) => {
        eventLog.push(event);
        if (eventLog.length > 128) eventLog.shift();
      });
    } else {
      unsubscribeEvents = null;
    }
  }

  function currentSelection(runtime) {
    if (ctx.followTarget?.generatedAgent) {
      selectedFacade = ctx.followTarget;
    }
    const stillAlive = runtime?.fauna?.some(
      (actor) => actor.facade === selectedFacade,
    );
    if (!stillAlive) selectedFacade = runtime?.fauna?.[0]?.facade ?? null;
    return selectedFacade;
  }

  function updateTaxonomy(runtime) {
    const records = taxonomyRecords(runtime);
    refs.taxonomy.replaceChildren(
      ...records.map((record) => {
        const button = createTaxon(record);
        button.addEventListener("click", () => {
          if (record.kind === "fauna") {
            const actor = runtime.fauna.find(
              (entry) => entry.agent.dna.speciesId === record.key,
            );
            if (actor) {
              selectedFacade = actor.facade;
              ctx.setFollowTarget(actor.facade);
              update();
            }
          } else {
            const flora = runtime.flora.find(
              (entry) => (entry.species?.id ?? entry.recipe?.key) === record.key,
            );
            if (flora && ctx.controls) {
              flora.instance.root.getWorldPosition(vector);
              ctx.controls.target.copy(vector);
              ctx.controls.update();
            }
          }
        });
        return button;
      }),
    );
    refs.railCount.textContent = String(records.length).padStart(2, "0");
    refs.catalogCount.textContent = `${String(records.length).padStart(2, "0")} observed`;
  }

  function updateSpecimen(runtime, selected, time) {
    const actor = runtime?.fauna?.find((entry) => entry.facade === selected);
    const agent = selected?.generatedAgent;
    const dna = agent?.dna;
    const fauna = runtime?.fauna ?? [];
    refs.genome.textContent = formatSeed(state.currentSeed);
    // A short glyph run keyed off the genome hash — a visual fingerprint that
    // changes with the specimen without pretending to be a measurement.
    const hash = selected?.genomeHash ?? "";
    const morphIds = Object.values(GLYPHS.morphology);
    renderGlyphRun(
      refs.strainRun,
      hash
        ? [...hash.slice(0, 4)].map(
            (ch, i) => morphIds[(parseInt(ch, 16) + i) % morphIds.length],
          )
        : [],
    );

    refs.species.textContent = String(fauna.length).padStart(2, "0");
    setPalette(refs.palette, dna?.palette, ["body", "head", "limb", "eye", "pupil"]);

    // fly/swim read 00 while the walker is the only archetype, but they come
    // from real trait flags rather than a literal, so they go live the moment
    // an airborne or aquatic form is authored.
    const flying = fauna.filter((entry) => entry.agent?.traits?.airborne).length;
    const swimming = fauna.filter((entry) => entry.agent?.traits?.aquatic).length;
    const drift = actor ? Math.round(actor.velocity.length() * 100) : 0;
    refs.movement.textContent = `fly ${String(flying).padStart(2, "0")}   swim ${String(swimming).padStart(2, "0")}   drift ${String(Math.min(99, drift)).padStart(2, "0")}`;

    renderGlyphRun(refs.morphology, morphologyGlyphs(dna));
    refs.morphologyText.textContent = dna
      ? `${dna.legs.count}-leg · ${dna.body.halfLength > 0.27 ? "longbody" : "roundbody"}`
      : "—";

    // The repairs count moves into the caption as its human-readable string;
    // these have always existed as prose and only the count was ever shown.
    const repairs = selected?.authoring?.repairs ?? agent?.repairs ?? [];
    refs.caption.textContent = agent
      ? repairs.length
        ? String(repairs[0])
        : "canonical genome"
      : "focused living form";
    refs.focus.textContent = dna
      ? `${dna.speciesId.slice(0, 18)}`
      : "no specimen";

    const traits = deriveTraits(dna);
    renderGlyphRun(refs.traits, traitGlyphs(traits));
    // The glyphs are the visual; the words stay reachable as the label.
    refs.traits?.setAttribute("title", traits.join(" · "));

    if (actor && runtime?.surface) {
      runtime.surface.sample(actor.position.x, actor.position.z, surfaceHit);
      const slope =
        Math.acos(Math.max(-1, Math.min(1, surfaceHit.normal.y))) *
        (180 / Math.PI);
      const elevation =
        surfaceHit.height < 0.35
          ? "low"
          : surfaceHit.height > 2.2
            ? "high"
            : "mid";
      refs.habitat.textContent = `elev. ${elevation} · slope ${slope.toFixed(0)}° · ${surfaceMaterialLabel(surfaceHit.material)}`;
    } else {
      refs.habitat.textContent = "elev. — · slope — · air mild";
    }

    // Footfalls per second over a rolling window — the event log has always
    // been collected and never read.
    const now = performance.now();
    const recentSteps = eventLog.filter(
      (event) =>
        event.type === "creature:footfall" &&
        now - (event.time ?? 0) < ACTIVITY_WINDOW_MS,
    ).length;
    const rate = recentSteps / (ACTIVITY_WINDOW_MS / 1000);
    refs.activity.textContent = `${String(Math.min(99, Math.round(rate * 10))).padStart(2, "0")} steps/s`;
    renderGlyphRun(
      refs.activityRun,
      Array.from({ length: Math.min(4, Math.ceil(rate)) }, () => GLYPHS.trait["long-step"]),
    );

    // Both traces read the rings the tick fills, so they carry the specimen's
    // real speed and the field's real agitation rather than a fixed sine.
    refs.movementPath.setAttribute(
      "d",
      pathFromRing(speedRing, 160, 18, 0.9),
    );
    refs.specimenWave.setAttribute(
      "d",
      pathFromRing(agitationRing, 250, 22, 0.85),
    );
    void time;
  }

  function updateField(runtime, time) {
    const actors = runtime?.fauna ?? [];
    const coherence = meanHeadingCoherence(actors);
    const stability = movementStability(actors);
    const night = state.nightFactor ?? 0;
    const wind = state.userSettings.windEnabled
      ? state.userSettings.windStrength
      : 0;
    refs.observed.textContent = formatElapsed(
      (performance.now() - sessionStarted) / 1000,
    );
    refs.cycle.textContent = String(Math.max(1, cycle)).padStart(2, "0");
    renderGlyphDial(refs.conditions, conditionGlyphs({ night, wind }));
    refs.temperature.textContent = night > 0.58 ? "cool" : "mild";
    // Same generator the legacy HUD and help panel use, so one seed names one
    // island everywhere in the app rather than two panels disagreeing.
    refs.fieldName.textContent = generateIslandName(state.currentSeed);
    refs.fieldSub.textContent = safeText(
      state.currentBiome?.sub,
      "everything here shares a pulse.",
    );
    refs.strain.textContent = formatSeed(state.currentSeed);
    refs.harmony.textContent =
      coherence > 0.72
        ? "current in harmony"
        : coherence > 0.42
          ? "current near harmony"
          : "current loosely coupled";
    refs.pulse.textContent =
      stability > 0.72 ? "calm pulse" : stability > 0.43 ? "active pulse" : "restless pulse";
    // Two text nodes rather than one innerHTML with a <br>: the note strings
    // are derived, so they should never be parsed as markup.
    if (refs.notePhase) {
      refs.notePhase.textContent =
        night > 0.6
          ? "night phase"
          : coherence > 0.55
            ? "shared drift"
            : "wandering phase";
    }
    if (refs.noteAir) {
      const air = wind > 0.8 ? (night > 0.6 ? "cool wind" : "moving air") : night > 0.6 ? "still air" : "low wind";
      refs.noteAir.textContent = night > 0.6
        ? `${air}, low glow`
        : `${air}, ${stability > 0.62 ? "stable hum" : "changing rhythm"}`;
    }

    renderMeter(refs.stability, stability);
    renderMeter(refs.coherence, coherence);
    refs.fieldWave.setAttribute("d", pathFromRing(coherenceRing, 330, 74, 0.72));
    refs.fieldThread.setAttribute("d", pathFromRing(stabilityRing, 330, 74, 0.4));
    void time;

    const observedRelations = new Set(
      eventLog
        .filter((event) => event.type === "flora:react" || event.type === "creature:footfall")
        .map((event) => event.type),
    ).size;
    refs.relationStatus.textContent = observedRelations
      ? `· ${observedRelations} observed`
      : "· potential";
  }

  function updateCallouts(runtime, selected) {
    const actor = runtime?.fauna?.find((entry) => entry.facade === selected);
    const hero = runtime?.hero?.instance?.root;
    const flora = runtime?.flora?.find((entry) => entry.recipe?.role === "mid");
    if (actor?.agent?.dna) {
      element("obs-callout-creature-name").textContent = actor.agent.dna.name;
      element("obs-callout-creature-state").textContent =
        actor.intent?.action ?? "wandering";
      element("obs-callout-creature-note").textContent =
        deriveTraits(actor.agent.dna).slice(0, 2).join(" · ");
    }
    if (hero?.userData?.inspect?.variant) {
      element("obs-callout-hero-name").textContent =
        runtime.hero.recipe?.dna?.name ?? "Veilcrown";
    }
    if (flora) {
      element("obs-callout-flora-name").textContent =
        flora.recipe?.dna?.name ?? "Pulsebells";
    }
    projectCallout(
      refs.creatureCallout,
      selected?.trackingAnchor ?? selected?.group,
      ctx.camera,
      24,
      -12,
    );
    projectCallout(refs.heroCallout, hero, ctx.camera, 28, -55);
    projectCallout(refs.floraCallout, flora?.instance?.root, ctx.camera, 20, -18);
  }

  /**
   * Push one sample into each trace ring. Runs once per tick, before anything
   * reads them, so all four traces share a timebase.
   */
  function sampleTraces(runtime, selected) {
    const actors = runtime?.fauna ?? [];
    const actor = actors.find((entry) => entry.facade === selected);
    // Speed normalized against a brisk walk rather than an absolute cap, so a
    // drifting kinling still produces visible movement in the trace.
    pushRing(speedRing, Math.min(1, (actor?.velocity?.length?.() ?? 0) / 0.9));
    pushRing(coherenceRing, meanHeadingCoherence(actors));
    pushRing(stabilityRing, movementStability(actors));

    // Mean flora agitation: how hard the plants are currently being brushed.
    // The touch envelope has always been computed for the pose and never read
    // by anything else; touchState() is its existing read-only accessor.
    let agitation = 0;
    let counted = 0;
    for (const entry of runtime?.flora ?? []) {
      const value = entry.instance?.touchState?.()?.value;
      if (typeof value !== "number") continue;
      agitation += Math.min(1, Math.abs(value));
      counted += 1;
    }
    pushRing(agitationRing, counted ? agitation / counted : 0);
  }

  function update() {
    if (!document.body.classList.contains("living-world-mode")) return;
    const runtime = state.livingWorld;
    bindRuntime(runtime);
    if (ctx.followTarget !== previousFollow) {
      previousFollow = ctx.followTarget;
      if (ctx.followTarget?.generatedAgent) selectedFacade = ctx.followTarget;
    }
    const selected = currentSelection(runtime);
    const time = state.lastSimT ?? 0;
    sampleTraces(runtime, selected);
    updateSpecimen(runtime, selected, time);
    updateField(runtime, time);
    updateCallouts(runtime, selected);
  }

  function introduceReturningForms() {
    const runtime = state.livingWorld;
    if (!runtime || runtime.disposed) return;
    const hashes = new Set(runtime.fauna.map((actor) => actor.facade.genomeHash));
    for (const record of loadAuthoredForms().slice(0, MAX_RETURNING_FORMS)) {
      if (hashes.has(record.genomeHash)) continue;
      const facade = introduceLivingFauna(runtime, record.dna, {
        prompt: record.prompt,
        repairs: record.repairs,
      });
      hashes.add(facade.genomeHash);
    }
    updateTaxonomy(runtime);
    update();
  }

  window.addEventListener("world-ready", () => {
    cycle += 1;
    localStorage.setItem(CYCLE_KEY, String(cycle));
    selectedFacade = null;
    previousFollow = null;
    window.clearTimeout(brandPulseTimer);
    brandPulseTimer = window.setTimeout(emphasizeBrand, 240);
    window.setTimeout(introduceReturningForms, 0);
  });

  element("obs-focus").addEventListener("click", () => {
    const selected = currentSelection(state.livingWorld);
    if (selected) ctx.setFollowTarget(selected);
  });
  element("obs-orbit").addEventListener("click", () => {
    if (ctx.flyFP) ctx.exitFlyMode();
    if (ctx.stroll) ctx.exitStroll();
    ctx.controls.enabled = true;
  });
  element("obs-drift").addEventListener("click", () => {
    if (!ctx.flyFP) ctx.enterFlyMode();
  });
  element("obs-catalog").addEventListener("click", () => {
    ctx.toggleCatalogPanel();
  });
  element("obs-photo").addEventListener("click", () => {
    ctx.setPhotoMode(true);
  });
  element("obs-help").addEventListener("click", () => {
    ctx.setHelpOpen(true);
  });
  element("obs-settings").addEventListener("click", () => {
    ctx.setSettingsOpen(true);
  });
  element("obs-new-strain").addEventListener("click", () => {
    element("regen-same-biome")?.click();
  });

  element("obs-density-toggle").addEventListener("click", () => {
    const showPanels = !PANEL_LENSES.some(
      (lens) => panelVisibility[lens] !== false,
    );
    for (const lens of PANEL_LENSES) panelVisibility[lens] = showPanels;
    renderPanelVisibility({ persist: true });
  });
  const specimen = element("obs-specimen");
  const specimenToggle = element("obs-specimen-close");
  const mobileSpecimenQuery = window.matchMedia("(max-width: 760px)");
  const syncSpecimenToggle = () => {
    const expanded = mobileSpecimenQuery.matches
      ? specimen.classList.contains("mobile-open")
      : !specimen.classList.contains("collapsed");
    specimenToggle.setAttribute("aria-expanded", String(expanded));
    specimenToggle.setAttribute(
      "aria-label",
      expanded ? "collapse specimen readout" : "open specimen readout",
    );
  };
  specimenToggle.addEventListener("click", () => {
    if (mobileSpecimenQuery.matches) {
      specimen.classList.toggle("mobile-open");
      specimen.classList.remove("collapsed");
    } else {
      specimen.classList.toggle("collapsed");
    }
    syncSpecimenToggle();
  });
  mobileSpecimenQuery.addEventListener("change", syncSpecimenToggle);
  syncSpecimenToggle();
  document.querySelectorAll("[data-obs-lens]").forEach((button) => {
    button.addEventListener("click", () => {
      const lens = button.dataset.obsLens;
      if (PANEL_LENSES.includes(lens)) togglePanelLens(lens);
    });
  });
  renderPanelVisibility();

  const studio = element("form-studio");
  const description = element("form-description");
  const modelSelect = element("form-model");
  const connection = element("form-connection");
  const status = element("form-status");
  const candidateList = element("form-candidates");
  const introduceButton = element("form-introduce");
  const generateButton = element("form-generate");

  function setStudioOpen(open) {
    studio.classList.toggle("open", open);
    studio.setAttribute("aria-hidden", String(!open));
    studio.toggleAttribute("inert", !open);
    document.body.classList.toggle("form-studio-open", open);
    if (open) {
      description.focus();
      void refreshModels();
    } else {
      requestController?.abort();
    }
  }

  async function refreshModels() {
    connection.classList.remove("offline");
    connection.innerHTML = "<i></i> checking local model";
    try {
      const models = await listAuthoringModels();
      modelSelect.replaceChildren();
      const automatic = document.createElement("option");
      automatic.value = "";
      automatic.textContent = "whatever is loaded locally";
      modelSelect.append(automatic);
      for (const model of models) {
        const option = document.createElement("option");
        option.value = model;
        option.textContent = model;
        modelSelect.append(option);
      }
      connection.innerHTML = `<i></i> ${models.length ? `${models.length} model${models.length === 1 ? "" : "s"} ready` : "local endpoint ready"}`;
    } catch {
      connection.classList.add("offline");
      connection.innerHTML = "<i></i> local model offline";
    }
  }

  function selectCandidate(index) {
    candidateIndex = index;
    [...candidateList.children].forEach((card, cardIndex) => {
      card.classList.toggle("selected", cardIndex === index);
    });
    introduceButton.disabled = index < 0 || !currentCandidates[index];
  }

  function renderCandidates(candidates, sourceLabel) {
    currentCandidates = candidates;
    candidateIndex = -1;
    candidateList.replaceChildren(
      ...candidates.map((candidate, index) => {
        const card = candidateCard(candidate, index);
        card.addEventListener("click", () => selectCandidate(index));
        return card;
      }),
    );
    selectCandidate(0);
    const modelCount = candidates.filter(
      (candidate) => candidate.source === "model",
    ).length;
    status.textContent =
      sourceLabel === "The authoring model" && modelCount < candidates.length
        ? `${sourceLabel} produced ${modelCount}; the bounded grammar completed the set. Choose one to introduce.`
        : `${sourceLabel} produced ${candidates.length} validated studies. Choose one to introduce.`;
  }

  async function generateCandidates() {
    requestController?.abort();
    requestController = new AbortController();
    generateButton.disabled = true;
    introduceButton.disabled = true;
    status.textContent = "Asking the authoring model for three distinct studies…";
    try {
      const candidates = await requestCreatureCandidates(description.value, {
        model: modelSelect.value,
        signal: requestController.signal,
      });
      renderCandidates(candidates, "The authoring model");
      connection.classList.remove("offline");
      connection.innerHTML = "<i></i> local model ready";
    } catch (error) {
      if (error?.name === "AbortError") return;
      status.textContent = `${error.message} Start an OpenAI-compatible local server on port 1234, or use procedural studies.`;
      connection.classList.add("offline");
      connection.innerHTML = "<i></i> local model offline";
    } finally {
      generateButton.disabled = false;
    }
  }

  element("obs-create-form").addEventListener("click", () => setStudioOpen(true));
  element("form-studio-close").addEventListener("click", () => setStudioOpen(false));
  element("form-studio-scrim").addEventListener("click", () => setStudioOpen(false));
  generateButton.addEventListener("click", () => void generateCandidates());
  element("form-procedural").addEventListener("click", () => {
    renderCandidates(createProceduralStudies(description.value), "The procedural grammar");
  });
  introduceButton.addEventListener("click", () => {
    const candidate = currentCandidates[candidateIndex];
    if (!candidate) return;
    const runtime = state.livingWorld;
    if (!runtime || runtime.disposed) {
      status.textContent = "The field is still growing. Try again when it is ready.";
      return;
    }
    saveAuthoredForm(candidate, description.value);
    const existing = runtime.fauna.find(
      (actor) => actor.facade.genomeHash === candidate.genomeHash,
    );
    const facade = existing?.facade ?? introduceLivingFauna(
      runtime,
      candidate.dna,
      {
        prompt: description.value,
        repairs: candidate.repairs,
      },
    );
    selectedFacade = facade;
    ctx.setFollowTarget(facade);
    updateTaxonomy(runtime);
    update();
    setStudioOpen(false);
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && studio.classList.contains("open")) {
      event.stopImmediatePropagation();
      setStudioOpen(false);
    }
  }, true);

  if (state.livingWorld) {
    introduceReturningForms();
  }
  updateTaxonomy(state.livingWorld);
  update();
  window.setInterval(update, 180);
}
