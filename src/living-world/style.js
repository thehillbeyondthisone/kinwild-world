/**
 * The integrated world deliberately borrows Small World's renderer and terrain
 * plumbing without borrowing its visible identity. "Kinwild" is a compact art
 * lock for the proof: dark mineral terrain, warm living forms, bold ink, close
 * framing, and one buoyant motion language shared by plants and creatures.
 *
 * The art lock is a set of *bands*, not a set of constants — see
 * `style-genome.js`. Each rolled biome supplies the hue and character; kinwild
 * supplies the range those are allowed to occupy.
 */
import { deriveStyleGenome } from "./style-genome.js";

export const LIVING_WORLD_STYLE_ID = "kinwild-v1";

/**
 * Bumped whenever generation changes what a given seed grows. Nothing is
 * published, so an existing seed rendering differently is accepted rather than
 * versioned around — but the break stays explicit and greppable, and share
 * links can carry it later.
 *
 * 2: the style genome derives the field's look from the rolled biome instead
 *    of pinning it to one frozen palette.
 */
export const LIVING_WORLD_GENERATOR_VERSION = 2;

export const LIVING_WORLD_PALETTE = Object.freeze({
  ink: "#11152a",
  terrainDeep: "#22434d",
  terrainMid: "#39706c",
  terrainLift: "#78a06f",
  coral: "#f06b78",
  violet: "#8657b8",
  amber: "#ffd166",
  cream: "#fff1d2",
  sky: "#d990a0",
  fog: "#66758b",
});

/**
 * Resolve migration switches into one runtime choice. The master living-world
 * mode always enables both generated content paths; the narrower flags remain
 * useful for contract testing without changing the host presentation.
 */
export function resolveLivingWorldFlags(flags = {}) {
  const livingWorld = flags.livingWorld === true;
  return Object.freeze({
    livingWorld,
    generatedFlora: livingWorld || flags.generatedFlora === true,
    generatedFauna: livingWorld || flags.generatedFauna === true,
  });
}

/**
 * Make a presentation recipe while retaining the source biome's stable ID.
 * Keeping the ID preserves seed URLs and lookup compatibility; every visible
 * field that carries Small World's terrarium identity is replaced or disabled.
 */
export function createLivingWorldBiome(sourceBiome) {
  if (!sourceBiome || typeof sourceBiome !== "object") {
    throw new TypeError("createLivingWorldBiome requires a source biome");
  }
  const p = LIVING_WORLD_PALETTE;
  // The look is derived from the rolled biome rather than pinned to constants:
  // twelve biomes used to render one identical field, which made the biome
  // roll invisible in this mode. The genome clamps every borrowed colour into
  // kinwild's own bands, so the field takes the biome's character without
  // taking its identity.
  const genome = deriveStyleGenome(sourceBiome);
  return {
    ...sourceBiome,
    styleId: LIVING_WORLD_STYLE_ID,
    generatorVersion: LIVING_WORLD_GENERATOR_VERSION,
    // The source is kept for anything downstream that needs to derive from it
    // (species rosters, palettes) without re-rolling the biome.
    sourceStyle: sourceBiome,
    styleGenome: genome,
    name: "kinwild",
    // Kinwild's sentence, with the biome's character in front of it — this is
    // the one place a field is allowed to say how it feels, and it reaches the
    // field card through the existing `sub` binding with no UI change.
    sub: genome.mood,
    ground: [...genome.terrain],
    cliff: genome.cliff,
    underside: genome.underside,
    sky: genome.sky,
    fog: genome.fog,
    fogDensity: genome.fogDensity,
    terrainAmplitude: genome.terrainAmplitude,
    // `id` intentionally remains the source biome ID for URL/catalog
    // compatibility, so every source-only visual switch must be neutralized
    // explicitly. In particular, `cloudlike` changes terrain colouring and
    // its PBR response in addition to enabling cloud-specific sky treatment.
    cloudlike: false,
    cloudSwirl: false,
    accent: genome.accent,
    sun: genome.sun,
    flora: [],
    floraCount: 0,
    particle: "pollen",
    creatureColors: [p.coral, p.violet, p.amber, p.cream],
    creatureCount: [0, 0],
    groveDetails: null,
    giantFlora: null,
    water: null,
    noButterflies: true,
    noCaterpillars: true,
    noFlyerNests: true,
    hasWillowisps: false,
    darkBiome: false,
    sunIntensity: 1.18,
    bloom: true,
    shadowLod: {
      microFloraShadows: false,
      staticCasterRadiusFrac: 0.42,
    },
    // Both derived, not fixed. `presentation.fixedDayFactor` is 0.74, and
    // blendPalette at that value renders roughly half dusk — constants here
    // would have left half of every field identical whatever biome rolled.
    dusk: { ...genome.dusk },
    night: { ...genome.night },
    presentation: {
      mode: "living-world",
      hideMountains: true,
      hideClouds: true,
      hideAurora: true,
      hideCloudSwirl: true,
      hideEdgeAura: true,
      hideLegacyFlora: true,
      hideLegacyFauna: true,
      hideBirds: true,
      muteLegacyMusic: true,
      closeCamera: true,
      outlineStrength: 0.24,
      aoStrength: 0.2,
      forceDepthFog: true,
      exposure: 1.16,
      fixedDayFactor: 0.74,
      fixedFogMultiplier: 0.72,
      sunMultiplier: 1.22,
      hemiMultiplier: 1.35,
    },
  };
}

/**
 * Swap only the identity layer. The baseline page remains untouched when the
 * mode is off, which makes the host a useful visual A/B and rollback path.
 */
export function applyLivingWorldDocumentIdentity(enabled, doc = globalThis.document) {
  if (!doc?.body) return false;
  doc.body.classList.toggle("living-world-mode", enabled);

  doc.title = enabled
    ? "kinwild — living forms"
    : "a small world — terrarium";
  const title = doc.querySelector(".title");
  if (title) {
    title.innerHTML = enabled
      ? "<em>kin</em>wild"
      : "<em>a small</em> world";
  }
  const eyebrow = doc.getElementById("locator-eyebrow");
  if (eyebrow) eyebrow.textContent = enabled ? "life index" : "field notes";
  const biomeLabel = doc.querySelector(".biome-card .label");
  if (biomeLabel) {
    biomeLabel.textContent = enabled ? "living field" : "current biome";
  }
  const loadingTitle = doc.querySelector(".world-loading-title");
  if (loadingTitle) {
    loadingTitle.textContent = enabled
      ? "growing a living field"
      : "crafting new world";
  }
  const helpTitle = doc.querySelector(".help-panel .settings-title");
  if (helpTitle) {
    helpTitle.textContent = enabled ? "field manual" : "help & controls";
  }

  const relabel = (id, label) => {
    const value = doc.getElementById(id);
    const labelElement = value?.closest(".stat")?.querySelector(".label");
    if (labelElement) labelElement.textContent = label;
  };
  relabel("seed", enabled ? "strain" : "seed");
  relabel("ground-creature-count", enabled ? "kin" : "ground");
  relabel("flora-count", enabled ? "forms" : "flora");

  const sameLabel = doc.querySelector("#regen-same-biome .regen-label");
  if (sameLabel) {
    sameLabel.textContent = enabled ? "new strain" : "same biome";
  }
  const nextLabel = doc.querySelector("#regen-random-biome .regen-label");
  if (nextLabel) {
    nextLabel.textContent = enabled ? "mutate field" : "next biome";
  }
  const musicToggle = doc.getElementById("music-toggle");
  if (musicToggle) musicToggle.hidden = enabled;
  const nextButton = doc.getElementById("regen-random-biome");
  if (nextButton) nextButton.hidden = enabled;
  const flyOrbit = doc.querySelector(".fly-option-orbit");
  if (flyOrbit) flyOrbit.textContent = "orbit";
  const flyMode = doc.querySelector(".fly-option-fly");
  if (flyMode) flyMode.textContent = enabled ? "drift" : "fly";

  for (const id of [
    "fly-creature-count",
    "swim-creature-count",
    "bird-count",
  ]) {
    const stat = doc.getElementById(id)?.closest(".stat");
    if (stat) stat.hidden = enabled;
  }
  return enabled;
}
