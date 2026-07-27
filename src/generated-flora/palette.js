import * as THREE from "three";

const FALLBACKS = Object.freeze({
  stem: "#71543a",
  primary: "#6f9a55",
  secondary: "#b6c78b",
  accent: "#f4a261",
  highlight: "#fff4cf",
  shadow: "#26362a",
});

function colorHex(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  try {
    return `#${new THREE.Color(value).getHexString()}`;
  } catch {
    return fallback;
  }
}

/**
 * Resolve Small World's biome fields into the semantic palette roles shared
 * by every generated-flora role.
 *
 * @param {object} [biome]
 * @param {object} [overrides]
 * @returns {Readonly<Record<string, string>>}
 */
export function deriveBiomePalette(biome = {}, overrides = {}) {
  const ground = Array.isArray(biome.ground) ? biome.ground : [];
  const leafPalette = biome.leafballTreePalette ?? {};
  const leaves = Array.isArray(leafPalette.leaves) ? leafPalette.leaves : [];
  const palette = {
    stem: colorHex(overrides.stem ?? leafPalette.trunk ?? ground[0], FALLBACKS.stem),
    primary: colorHex(overrides.primary ?? leaves[1] ?? ground[1], FALLBACKS.primary),
    secondary: colorHex(overrides.secondary ?? leaves[2] ?? ground[2], FALLBACKS.secondary),
    accent: colorHex(overrides.accent ?? biome.accent, FALLBACKS.accent),
    highlight: colorHex(overrides.highlight ?? biome.sun ?? biome.sky, FALLBACKS.highlight),
    shadow: colorHex(overrides.shadow ?? biome.cliff ?? biome.underside, FALLBACKS.shadow),
  };
  return Object.freeze(palette);
}

/**
 * Resolve DNA material slots through the shared biome palette.
 *
 * @param {object} dna
 * @param {Record<string, string>} palette
 * @returns {Record<string, THREE.Color>}
 */
export function resolveSpeciesColors(dna, palette) {
  const colors = {};
  for (const [slot, paletteRole] of Object.entries(dna.paletteRoles)) {
    colors[slot] = new THREE.Color(palette[paletteRole] ?? FALLBACKS[paletteRole] ?? "#ffffff");
  }
  return colors;
}

/**
 * Deterministically nudge a color for instance-color variation while
 * preserving the species/biome palette relationship.
 *
 * @param {THREE.Color} source
 * @param {number} signedAmount - expected range -1..1
 * @param {number} [strength]
 * @returns {THREE.Color}
 */
export function varyColor(source, signedAmount, strength = 0.08) {
  const hsl = { h: 0, s: 0, l: 0 };
  source.getHSL(hsl, THREE.SRGBColorSpace);
  const delta = THREE.MathUtils.clamp(signedAmount, -1, 1) * strength;
  return new THREE.Color().setHSL(
    (hsl.h + delta * 0.18 + 1) % 1,
    THREE.MathUtils.clamp(hsl.s * (1 + delta * 0.3), 0, 1),
    THREE.MathUtils.clamp(hsl.l + delta, 0.04, 0.96),
    THREE.SRGBColorSpace
  );
}
