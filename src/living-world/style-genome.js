/**
 * The shared style genome.
 *
 * Kinwild borrows Small World's terrain and renderer but not its identity, and
 * the first cut of that took the bluntest possible form: `createLivingWorldBiome`
 * replaced every visible field with one frozen palette. It worked as an art
 * lock and it cost all twelve biomes their character — every seed rendered the
 * same teal-and-coral field, so the biome roll was invisible.
 *
 * This module keeps the art lock while giving it a hue. Each source biome is
 * read for what it *means* — a cold pale place, a warm mineral one — and that
 * meaning is projected into kinwild's own bands. A desert field comes out warm
 * and pale, an obsidian field deep and cool, and both still read as kinwild:
 * dark mineral terrain under warm living forms, which is the contrast the ink
 * outline, bloom gating and HUD were all tuned against.
 *
 * DOM-free and free of `Math.random` so it can be unit-tested across every
 * biome in the table.
 */
import * as THREE from "three";
import { hashSeed } from "../generated-flora/rng.js";

/**
 * Kinwild's permitted saturation/lightness ranges per role.
 *
 * The hue is the biome's to choose; these are not. Terrain stays dark enough
 * for hull ink to read against it, the sun stays near-white, and no role is
 * allowed to reach the neon end — the vibe constraint in CLAUDE.md is
 * "saturated but soft", and an unclamped passthrough of `crimson dunes` or
 * `obsidian` breaks it in opposite directions.
 */
export const STYLE_BANDS = Object.freeze({
  terrainDeep: Object.freeze({ s: [0.08, 0.40], l: [0.13, 0.21] }),
  terrainMid: Object.freeze({ s: [0.08, 0.42], l: [0.25, 0.35] }),
  terrainLift: Object.freeze({ s: [0.10, 0.46], l: [0.40, 0.52] }),
  cliff: Object.freeze({ s: [0.06, 0.40], l: [0.06, 0.13] }),
  underside: Object.freeze({ s: [0.06, 0.40], l: [0.04, 0.09] }),
  sky: Object.freeze({ s: [0.12, 0.55], l: [0.56, 0.74] }),
  fog: Object.freeze({ s: [0.05, 0.30], l: [0.36, 0.54] }),
  accent: Object.freeze({ s: [0.30, 0.88], l: [0.50, 0.72] }),
  sun: Object.freeze({ s: [0.05, 0.45], l: [0.84, 0.95] }),
});

/** Fog thickness and terrain relief bands. Kinwild frames close and low. */
const FOG_DENSITY_RANGE = Object.freeze([0.016, 0.028]);
const TERRAIN_AMPLITUDE_RANGE = Object.freeze([1.15, 1.85]);

/** Fallback hues, used when a source biome omits a field entirely. */
const FALLBACK = Object.freeze({
  terrain: "#39706c",
  cliff: "#11152a",
  sky: "#d990a0",
  fog: "#66758b",
  accent: "#ffd166",
  sun: "#fff1d2",
});

const scratch = { h: 0, s: 0, l: 0 };

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

/**
 * Read a colour as HSL.
 *
 * Both the read and the write name their colour space explicitly. THREE's
 * `getHSL` defaults to LinearSRGB while `setHSL` defaults to SRGB, so a
 * round-trip that omits them silently brightens every colour it touches —
 * which is exactly how the outlines came out mid-tone instead of ink once
 * before.
 */
function readHsl(value, fallback) {
  // Validated before THREE sees it: `new THREE.Color("nonsense")` warns and
  // silently yields white rather than throwing, so a malformed biome field
  // would come back as the brightest possible colour instead of the fallback.
  const usable =
    typeof value === "number" ||
    (typeof value === "string" && /^#?[0-9a-f]{3,8}$/i.test(value.trim()));
  new THREE.Color(usable ? value : fallback).getHSL(scratch, THREE.SRGBColorSpace);
  return { h: scratch.h, s: scratch.s, l: scratch.l };
}

/**
 * Project one source colour into a kinwild band: keep its hue, clamp its
 * saturation and lightness.
 */
function harmonize(value, band, fallback = FALLBACK.terrain) {
  const hsl = readHsl(value, fallback);
  const color = new THREE.Color().setHSL(
    (hsl.h + 1) % 1,
    clamp(hsl.s, band.s[0], band.s[1]),
    clamp(hsl.l, band.l[0], band.l[1]),
    THREE.SRGBColorSpace,
  );
  return `#${color.getHexString()}`;
}

/**
 * Restate a colour at an absolute lightness, optionally scaling saturation.
 * Used for the dusk and night palettes, which are the same field seen under
 * different light rather than different colour schemes.
 */
function shade(value, lightness, saturationScale = 1, fallback = FALLBACK.terrain) {
  const hsl = readHsl(value, fallback);
  const color = new THREE.Color().setHSL(
    (hsl.h + 1) % 1,
    clamp(hsl.s * saturationScale, 0, 0.85),
    clamp(lightness, 0, 1),
    THREE.SRGBColorSpace,
  );
  return `#${color.getHexString()}`;
}

/**
 * A short lowercase phrase in the field-notes voice, derived from where the
 * biome actually sits in hue and lightness. It rides the field card's `sub`
 * line, so biome character reaches the reader as language without any Small
 * World name leaking through.
 */
export function moodFor(accentHsl, terrainHsl) {
  const warm = accentHsl.h < 0.14 || accentHsl.h > 0.86;
  const cool = accentHsl.h > 0.42 && accentHsl.h < 0.72;
  // Compared against the middle of the terrain band, not an absolute — every
  // kinwild terrain is dark, so an absolute threshold reads every field the
  // same way.
  const pale = terrainHsl.l > 0.30;
  const temperature = warm ? "warm" : cool ? "cool" : "shifting";
  const ground = pale ? "open" : "deep";
  return `${temperature} ${ground} ground, everything here shares a pulse.`;
}

/**
 * Derive kinwild's look from a source biome.
 *
 * Pure and deterministic: the same biome always yields the same genome, and
 * two different biomes never yield the same one.
 *
 * @param {object} sourceBiome an entry from `BIOMES`
 * @returns {Readonly<object>}
 */
export function deriveStyleGenome(sourceBiome) {
  const biome = sourceBiome && typeof sourceBiome === "object" ? sourceBiome : {};
  const ground = Array.isArray(biome.ground) ? biome.ground : [];

  const terrain = Object.freeze([
    harmonize(ground[0], STYLE_BANDS.terrainDeep, FALLBACK.terrain),
    harmonize(ground[1] ?? ground[0], STYLE_BANDS.terrainMid, FALLBACK.terrain),
    harmonize(ground[2] ?? ground[1] ?? ground[0], STYLE_BANDS.terrainLift, FALLBACK.terrain),
  ]);
  const accent = harmonize(biome.accent, STYLE_BANDS.accent, FALLBACK.accent);
  const sky = harmonize(biome.sky, STYLE_BANDS.sky, FALLBACK.sky);

  // Relief is not in the source table — every biome leans on `terrainAmpFor`'s
  // default — so it comes from a stable hash of the biome id instead. Cloud
  // biomes stay the softest, as they do in the donor.
  const relief = (hashSeed("kinwild/relief", biome.id ?? "kinwild") % 1000) / 1000;
  const amplitudeSpan = TERRAIN_AMPLITUDE_RANGE[1] - TERRAIN_AMPLITUDE_RANGE[0];
  const terrainAmplitude = Number(
    (
      TERRAIN_AMPLITUDE_RANGE[0] +
      relief * amplitudeSpan * (biome.cloudlike ? 0.55 : 1)
    ).toFixed(3),
  );

  const sourceFogDensity = Number.isFinite(biome.fogDensity) ? biome.fogDensity : 0.02;
  const fogDensity = Number(
    clamp(sourceFogDensity * 1.35, FOG_DENSITY_RANGE[0], FOG_DENSITY_RANGE[1]).toFixed(4),
  );

  return Object.freeze({
    sourceId: biome.id ?? "kinwild",
    terrain,
    cliff: harmonize(biome.cliff ?? ground[0], STYLE_BANDS.cliff, FALLBACK.cliff),
    underside: harmonize(
      biome.underside ?? biome.cliff ?? ground[0],
      STYLE_BANDS.underside,
      FALLBACK.cliff,
    ),
    sky,
    fog: harmonize(biome.fog ?? biome.sky, STYLE_BANDS.fog, FALLBACK.fog),
    fogDensity,
    accent,
    sun: harmonize(biome.sun ?? biome.sky, STYLE_BANDS.sun, FALLBACK.sun),
    terrainAmplitude,
    // Kinwild pins `fixedDayFactor: 0.74`, and blendPalette at that value
    // renders roughly half dusk — so leaving dusk on constants would have left
    // half of every field identical no matter which biome rolled. These are
    // the same genome under lower light, not a second colour scheme.
    dusk: Object.freeze({
      sky: shade(sky, 0.55, 1.05, FALLBACK.sky),
      fog: shade(biome.fog ?? sky, 0.32, 0.9, FALLBACK.fog),
      sun: shade(accent, 0.75, 1.1, FALLBACK.accent),
      ground: shade(terrain[0], 0.16, 0.95, FALLBACK.terrain),
    }),
    night: Object.freeze({
      sky: shade(sky, 0.12, 0.75, FALLBACK.sky),
      fog: shade(biome.fog ?? sky, 0.13, 0.7, FALLBACK.fog),
      // The moon reads cool everywhere; it keeps a little of the field's hue
      // so a warm field is not lit by an alien light.
      sun: shade(sky, 0.72, 0.55, FALLBACK.sky),
      ground: shade(terrain[0], 0.08, 0.85, FALLBACK.terrain),
    }),
    mood: moodFor(readHsl(accent, FALLBACK.accent), readHsl(terrain[1], FALLBACK.terrain)),
  });
}
