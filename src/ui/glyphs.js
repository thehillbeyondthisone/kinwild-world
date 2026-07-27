// Botanical/creature line-art registry for the observatory.
//
// Every glyph is a <symbol> in index.html rendered through <use href="#id">.
// Same-document <use> is deliberate: it inherits `currentColor`, which is what
// lets the identical glyph render in gold on the dark panels and in
// --obs-paper-ink on the cream specimen card. An external sprite file does not
// inherit color reliably across engines.
//
// The registry itself is DOM-free at module scope so tests can import it in
// node and check it against the markup in both directions — a typo'd href
// renders as an invisible nothing rather than throwing, so one-directional
// checking would miss it.

const SVG_NS = "http://www.w3.org/2000/svg";

export const GLYPHS = Object.freeze({
  rail: Object.freeze({
    field: "kw-rail-field",
    fauna: "kw-rail-fauna",
    flora: "kw-rail-flora",
    relations: "kw-rail-relations",
    catalog: "kw-rail-catalog",
    controls: "kw-rail-controls",
  }),
  specimenRow: Object.freeze({
    strain: "kw-row-strain",
    kin: "kw-row-kin",
    movement: "kw-row-movement",
    morphology: "kw-row-morphology",
    resonance: "kw-row-resonance",
    habitat: "kw-row-habitat",
    traits: "kw-row-traits",
    activity: "kw-row-activity",
  }),
  taxon: Object.freeze({
    walkerLow: "kw-taxon-walker-low",
    walkerMid: "kw-taxon-walker-mid",
    walkerTall: "kw-taxon-walker-tall",
    canopy: "kw-taxon-canopy",
    bloom: "kw-taxon-bloom",
    ground: "kw-taxon-ground",
    unobserved: "kw-taxon-unobserved",
  }),
  morphology: Object.freeze({
    legs2: "kw-morph-legs2",
    legs4: "kw-morph-legs4",
    legs6: "kw-morph-legs6",
    longbody: "kw-morph-longbody",
    roundbody: "kw-morph-roundbody",
    broadhead: "kw-morph-broadhead",
    smallhead: "kw-morph-smallhead",
    highgait: "kw-morph-highgait",
    lowgait: "kw-morph-lowgait",
  }),
  trait: Object.freeze({
    upright: "kw-trait-upright",
    grounded: "kw-trait-grounded",
    manyfoot: "kw-trait-manyfoot",
    "long-step": "kw-trait-longstep",
    broadbody: "kw-trait-broadbody",
    "high-gait": "kw-trait-highgait",
    steady: "kw-trait-steady",
  }),
  dock: Object.freeze({
    focus: "kw-dock-focus",
    orbit: "kw-dock-orbit",
    drift: "kw-dock-drift",
    catalog: "kw-dock-catalog",
    strain: "kw-dock-strain",
    mutate: "kw-dock-mutate",
  }),
  condition: Object.freeze({
    moonNew: "kw-cond-moon-new",
    moonHalf: "kw-cond-moon-half",
    moonFull: "kw-cond-moon-full",
    windCalm: "kw-cond-wind-calm",
    windLow: "kw-cond-wind-low",
    windHigh: "kw-cond-wind-high",
    thermalCool: "kw-cond-thermal-cool",
    thermalMild: "kw-cond-thermal-mild",
  }),
  emblem: Object.freeze({
    plaque: "kw-emblem-plaque",
    sunHorizon: "kw-emblem-sun-horizon",
    seal: "kw-emblem-seal",
    orbital: "kw-emblem-orbital",
    orbitalWide: "kw-emblem-orbital-wide",
  }),
});

/** Every glyph id in the registry, flattened. Used by the sprite parity test. */
export function allGlyphIds() {
  return Object.values(GLYPHS).flatMap((group) => Object.values(group));
}

/**
 * Pick the morphology glyph run for a normalized walker DNA — six slots that
 * summarize the silhouette the same way the specimen card's prose row does.
 * DOM-free so it can be asserted directly.
 *
 * @param {Object} dna - normalized walker DNA
 * @returns {string[]} glyph ids
 */
export function morphologyGlyphs(dna) {
  if (!dna) return [];
  const m = GLYPHS.morphology;
  const legs = dna.legs?.count >= 6 ? m.legs6 : dna.legs?.count >= 4 ? m.legs4 : m.legs2;
  return [
    legs,
    dna.body?.halfLength > 0.27 ? m.longbody : m.roundbody,
    dna.head?.radius > 0.25 ? m.broadhead : m.smallhead,
    dna.motion?.lift > 0.11 ? m.highgait : m.lowgait,
    dna.legs?.length > 0.58 ? m.legs6 : m.legs2,
    dna.body?.radius > 0.37 ? m.roundbody : m.longbody,
  ];
}

/** Map the strings from `deriveTraits` onto trait glyph ids, dropping unknowns. */
export function traitGlyphs(traits) {
  return (traits ?? []).map((trait) => GLYPHS.trait[trait]).filter(Boolean);
}

/**
 * Six condition glyphs describing the field right now: moon phase, wind, and
 * thermal, each doubled so the row reads as a dial rather than three symbols.
 *
 * @param {{night: number, wind: number}} conditions
 * @returns {{id: string, on: boolean}[]}
 */
export function conditionGlyphs({ night = 0, wind = 0 } = {}) {
  const c = GLYPHS.condition;
  const moon = night > 0.64 ? c.moonFull : night > 0.28 ? c.moonHalf : c.moonNew;
  const air = wind > 1.25 ? c.windHigh : wind > 0.2 ? c.windLow : c.windCalm;
  const thermal = night > 0.58 ? c.thermalCool : c.thermalMild;
  return [
    { id: c.moonNew, on: moon === c.moonNew },
    { id: c.moonHalf, on: moon === c.moonHalf },
    { id: c.moonFull, on: moon === c.moonFull },
    { id: c.windCalm, on: air === c.windCalm },
    { id: air === c.windHigh ? c.windHigh : c.windLow, on: air !== c.windCalm },
    { id: thermal, on: true },
  ];
}

/**
 * Build an <svg><use/></svg> pair for a glyph id.
 *
 * @param {string} id - a value from GLYPHS
 * @param {string} [className]
 * @returns {SVGSVGElement}
 */
export function glyphSvg(id, className = "kw-glyph") {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG_NS, "use");
  // Plain href, not xlink:href — the namespaced form is obsolete in every
  // engine this app targets.
  use.setAttribute("href", `#${id}`);
  svg.append(use);
  return svg;
}

/** Replace a container's children with a run of glyphs. */
export function renderGlyphRun(target, ids, className = "kw-glyph") {
  if (!target) return;
  target.replaceChildren(...ids.map((id) => glyphSvg(id, className)));
}

/** Like renderGlyphRun, but each entry carries an on/off state for dial rows. */
export function renderGlyphDial(target, entries, className = "kw-glyph") {
  if (!target) return;
  target.replaceChildren(
    ...entries.map(({ id, on }) => {
      const svg = glyphSvg(id, className);
      svg.classList.add(on ? "is-on" : "is-off");
      return svg;
    }),
  );
}
