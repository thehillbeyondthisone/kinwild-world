/**
 * The integrated world deliberately borrows Small World's renderer and terrain
 * plumbing without borrowing its visible identity. "Kinwild" is a compact art
 * lock for the proof: dark mineral terrain, warm living forms, bold ink, close
 * framing, and one buoyant motion language shared by plants and creatures.
 */
export const LIVING_WORLD_STYLE_ID = "kinwild-v1";

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

function mixSeed32(seed, channel) {
  let hash = (Number(seed) >>> 0) ^ 0x811c9dc5;
  const text = String(channel);
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

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
  return {
    ...sourceBiome,
    styleId: LIVING_WORLD_STYLE_ID,
    name: "kinwild",
    sub: "everything here shares a pulse.",
    ground: [p.terrainDeep, p.terrainMid, p.terrainLift],
    cliff: p.ink,
    underside: "#080b17",
    sky: p.sky,
    fog: p.fog,
    fogDensity: 0.022,
    terrainAmplitude: 1.45,
    // `id` intentionally remains the source biome ID for URL/catalog
    // compatibility, so every source-only visual switch must be neutralized
    // explicitly. In particular, `cloudlike` changes terrain colouring and
    // its PBR response in addition to enabling cloud-specific sky treatment.
    cloudlike: false,
    cloudSwirl: false,
    accent: p.amber,
    sun: p.cream,
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
    dusk: {
      sky: "#a86f91",
      fog: "#3a5068",
      sun: "#ffc681",
      ground: "#162c3b",
    },
    night: {
      sky: "#10152d",
      fog: "#111b31",
      sun: "#9f8de0",
      ground: "#09111d",
    },
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

export function createLivingFloraRecipes(seed) {
  const p = LIVING_WORLD_PALETTE;
  return Object.freeze([
    Object.freeze({
      key: "veilcrown",
      variant: "veilcrown",
      label: "Veilcrown",
      role: "hero",
      dna: {
        role: "hero-mushroom",
        name: "Veilcrown",
        seed: mixSeed32(seed, "flora/veilcrown"),
        shape: {
          height: 3.75,
          stemRadius: 0.48,
          capRadius: 2,
          capDepth: 0.72,
          spotCount: 17,
          satelliteCount: 3,
        },
        motion: {
          wind: 0.24,
          touchStrength: 1.15,
          touchStiffness: 28,
          touchDamping: 6.5,
          maxLean: 0.13,
        },
        variation: { scaleMin: 0.98, scaleMax: 1.04, lean: 0.025 },
      },
      palette: {
        stem: p.cream,
        primary: p.violet,
        secondary: p.coral,
        accent: p.amber,
        highlight: p.cream,
        shadow: p.ink,
      },
    }),
    Object.freeze({
      key: "pulsebell",
      variant: "pulsebell",
      label: "Pulsebells",
      role: "mid",
      dna: {
        role: "mid-flower-cluster",
        name: "Pulsebells",
        seed: mixSeed32(seed, "flora/pulsebell"),
        shape: {
          clusterRadius: 0.78,
          flowerCount: 5,
          stemHeight: 1.2,
          bloomRadius: 0.32,
          petalCount: 5,
          leafPairs: 1,
        },
        motion: {
          wind: 0.92,
          touchStrength: 1.2,
          touchStiffness: 36,
          touchDamping: 7.2,
          maxLean: 0.27,
        },
        variation: { scaleMin: 0.88, scaleMax: 1.14, lean: 0.08 },
      },
      palette: {
        stem: p.cream,
        primary: p.violet,
        secondary: p.coral,
        accent: p.violet,
        highlight: p.amber,
        shadow: p.ink,
      },
    }),
    Object.freeze({
      key: "threadgrass",
      variant: "threadgrass",
      label: "Threadgrass",
      role: "ground",
      dna: {
        role: "groundcover",
        name: "Threadgrass",
        seed: mixSeed32(seed, "flora/threadgrass"),
        shape: {
          patchRadius: 1.7,
          count: 72,
          bladeHeight: 0.7,
          bladeWidth: 0.06,
          clumpiness: 0.84,
          heightVariance: 0.42,
        },
        motion: {
          wind: 1.24,
          touchStrength: 1.25,
          touchStiffness: 46,
          touchDamping: 8.2,
          maxLean: 0.16,
        },
        variation: { scaleMin: 0.9, scaleMax: 1.16, lean: 0.13 },
      },
      palette: {
        stem: p.terrainLift,
        primary: p.terrainLift,
        secondary: p.amber,
        accent: p.coral,
        highlight: p.cream,
        shadow: p.ink,
      },
    }),
  ]);
}

export function createLivingFaunaDNA(seed, individual = 0) {
  const p = LIVING_WORLD_PALETTE;
  const phenotype =
    (mixSeed32(seed, "fauna/kinling/family") + individual) % 3;
  const silhouettes = [
    {
      body: { radius: 0.35, halfLength: 0.31 },
      head: { radius: 0.235, offset: [0, 0.18, 0.43], eyeRadius: 0.055 },
      legs: { length: 0.54, thickness: 0.072, spread: 0.27 },
      palette: { body: p.coral, head: p.amber, limb: p.violet },
    },
    {
      body: { radius: 0.39, halfLength: 0.23 },
      head: { radius: 0.27, offset: [0, 0.21, 0.37], eyeRadius: 0.064 },
      legs: { length: 0.46, thickness: 0.082, spread: 0.29 },
      palette: { body: p.violet, head: p.coral, limb: p.amber },
    },
    {
      body: { radius: 0.32, halfLength: 0.27 },
      head: { radius: 0.225, offset: [0, 0.22, 0.39], eyeRadius: 0.052 },
      legs: { length: 0.61, thickness: 0.068, spread: 0.285 },
      palette: { body: p.amber, head: p.cream, limb: p.coral },
    },
  ];
  const form = silhouettes[phenotype];
  return {
    schemaVersion: 1,
    speciesId: "kinling",
    name: "Kinling",
    seed: mixSeed32(seed, `fauna/kinling/${individual}`),
    palette: {
      ...form.palette,
      eye: p.cream,
      pupil: p.ink,
    },
    body: form.body,
    head: form.head,
    legs: {
      count: 4,
      length: form.legs.length,
      thickness: form.legs.thickness,
      stance: 0.23,
      spread: form.legs.spread,
    },
    motion: {
      stepDuration: 0.29,
      stepTrigger: 0.135,
      lift: 0.092,
      bob: 0.024,
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
