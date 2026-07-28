/**
 * The archetype presets.
 *
 * An archetype is DNA, not a code path. Each entry below says how a shape
 * block becomes a skeleton spec, which organs hang off that skeleton, and
 * what the resulting plant offers the ecology. Adding a new silhouette means
 * adding a row here — it does not mean adding a renderer.
 *
 * `defaults` and `limits` are the discriminated union the normalizer enforces:
 * a groundcover has no trunk fields to request, so it cannot request them.
 *
 * DOM-free, THREE-free, free of `Math.random`. Placements are expressed as a
 * position plus the direction the organ's local +Y should point; the compiler
 * turns those into matrices.
 */
import { GOLDEN_ANGLE, scatterDisc } from "./organs.js";

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function normalize(v) {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

/** Blend a node's own direction toward a radial outward lean. */
function outward(node, amount) {
  const radial = Math.hypot(node.tip[0], node.tip[2]);
  if (radial < 1e-5 || amount === 0) return [...node.direction];
  return normalize([
    node.direction[0] + (node.tip[0] / radial) * amount,
    node.direction[1],
    node.direction[2] + (node.tip[2] / radial) * amount,
  ]);
}

const UPWARD = Object.freeze([0, 1, 0]);

function jitterScale(rng, low = 0.84, high = 1.18) {
  const s = rng.range(low, high);
  return [s, rng.range(low, high), s];
}

/* ------------------------------------------------------------------ *
 * canopy — a tree. The archetype the old three-role compiler could not
 * express at all, and the reason every field's centrepiece was a mushroom.
 * ------------------------------------------------------------------ */
const canopy = {
  key: "canopy",
  role: "hero",
  habit: "upright",
  affordances: ["landmark", "perch", "shelter"],
  defaults: {
    name: "Boughcrown",
    shape: {
      height: 6.4,
      stemCount: 1,
      stemRadius: 0.42,
      taper: 0.46,
      curve: 0.22,
      branchCount: 3,
      branchAngle: 0.72,
      branchDepth: 2,
      branchFalloff: 0.7,
      leafRadius: 1.15,
      leafThickness: 0.62,
    },
  },
  limits: {
    height: [2.4, 12],
    stemCount: [1, 3, true],
    stemRadius: [0.12, 1.1],
    taper: [0.2, 0.9],
    curve: [0, 0.6],
    branchCount: [2, 4, true],
    branchAngle: [0.3, 1.2],
    branchDepth: [1, 3, true],
    branchFalloff: [0.45, 0.88],
    leafRadius: [0.3, 2.4],
    leafThickness: [0.2, 1],
  },
  skeleton: (s) => ({
    habit: "upright",
    stems: s.stemCount,
    baseSpread: s.stemRadius * 1.7,
    height: s.height / (1 + s.branchDepth * 0.42),
    baseRadius: s.stemRadius,
    taper: s.taper,
    curve: s.curve,
    branch: {
      count: s.branchCount,
      angle: s.branchAngle,
      depth: s.branchDepth,
      falloff: s.branchFalloff,
    },
  }),
  organs: (s) => [
    {
      key: "leaf",
      type: "pad",
      params: { radius: s.leafRadius, thickness: s.leafThickness, detail: 1 },
      material: {
        colorSlot: "body",
        wind: 1,
        roughness: 0.8,
        vertexColors: true,
        emissiveSlot: "body",
        emissiveIntensity: 0.06,
      },
      reach: s.leafRadius,
    },
  ],
  layout: (s, skeleton, rng) => ({
    leaf: skeleton.terminals.map((node, index) => ({
      position: node.tip,
      dir: outward(node, 0.25),
      roll: index * GOLDEN_ANGLE,
      scale: jitterScale(rng, 0.78, 1.24),
      color: index % 3 === 0 ? "detail" : "body",
    })),
  }),
};

/* ------------------------------------------------------------------ *
 * spire — tall, thin, sparsely budded. Ridge-line punctuation.
 * ------------------------------------------------------------------ */
const spire = {
  key: "spire",
  role: "hero",
  habit: "upright",
  affordances: ["landmark", "perch"],
  defaults: {
    name: "Spindlecrown",
    shape: {
      height: 6.8,
      stemCount: 2,
      stemRadius: 0.24,
      taper: 0.18,
      curve: 0.14,
      budRadius: 0.24,
      ringCount: 4,
    },
  },
  limits: {
    height: [2.6, 10.5],
    stemCount: [1, 4, true],
    stemRadius: [0.08, 0.55],
    taper: [0.06, 0.45],
    curve: [0, 0.4],
    budRadius: [0.06, 0.55],
    ringCount: [0, 8, true],
  },
  skeleton: (s) => ({
    habit: "upright",
    stems: s.stemCount,
    baseSpread: s.stemRadius * 2.6,
    height: s.height,
    heightVariance: 0.18,
    baseRadius: s.stemRadius,
    taper: s.taper,
    curve: s.curve,
    segments: 3,
    branch: { count: 0, depth: 0 },
  }),
  organs: (s) => [
    {
      key: "bud",
      type: "bulb",
      params: { radius: s.budRadius, elongation: 1.35 },
      material: {
        colorSlot: "signal",
        wind: 1,
        roughness: 0.62,
        vertexColors: true,
        emissiveSlot: "signal",
        emissiveIntensity: 0.34,
        bloom: true,
      },
      reach: s.budRadius * 1.4,
    },
    {
      key: "ring",
      type: "berry",
      params: { radius: s.budRadius * 0.34, elongation: 0.9 },
      material: {
        colorSlot: "highlight",
        wind: 1,
        roughness: 0.55,
        vertexColors: true,
        emissiveSlot: "signal",
        emissiveIntensity: 0.2,
      },
      reach: s.budRadius * 0.5,
    },
  ],
  layout: (s, skeleton, rng) => {
    const nodes = skeleton.nodes;
    const rings = [];
    for (let index = 0; index < s.ringCount && nodes.length > 0; index++) {
      const node = nodes[index % nodes.length];
      const t = rng.range(0.25, 0.9);
      const azimuth = index * GOLDEN_ANGLE;
      const offset = node.radiusStart * 1.25;
      rings.push({
        position: [
          node.origin[0] + node.direction[0] * node.length * t + Math.cos(azimuth) * offset,
          node.origin[1] + node.direction[1] * node.length * t,
          node.origin[2] + node.direction[2] * node.length * t + Math.sin(azimuth) * offset,
        ],
        dir: [Math.cos(azimuth), 0.35, Math.sin(azimuth)],
        roll: azimuth,
        scale: jitterScale(rng, 0.7, 1.3),
        color: index % 2 === 0 ? "highlight" : "signal",
      });
    }
    return {
      bud: skeleton.terminals.map((node, index) => ({
        position: node.tip,
        dir: node.direction,
        roll: index * GOLDEN_ANGLE,
        scale: jitterScale(rng, 0.82, 1.2),
        color: index % 2 === 0 ? "signal" : "highlight",
      })),
      ring: rings,
    };
  },
};

/* ------------------------------------------------------------------ *
 * cap — the mushroom, now one archetype among nine rather than the only
 * hero. The Veilcrown's separated crown lobes and pendant signals live here
 * as organ counts instead of a `dna.name === "Veilcrown"` branch.
 * ------------------------------------------------------------------ */
const cap = {
  key: "cap",
  role: "hero",
  habit: "upright",
  affordances: ["landmark", "perch", "shelter"],
  defaults: {
    name: "Crowncap",
    shape: {
      height: 4.2,
      stemCount: 3,
      stemRadius: 0.52,
      taper: 0.78,
      curve: 0.2,
      capRadius: 2.1,
      capDepth: 0.82,
      lobeCount: 7,
      spotCount: 11,
      pendantCount: 9,
    },
  },
  limits: {
    height: [1.6, 8.5],
    stemCount: [1, 6, true],
    stemRadius: [0.16, 1.3],
    taper: [0.4, 1.2],
    curve: [0, 0.45],
    capRadius: [0.6, 4.6],
    capDepth: [0.2, 1.8],
    lobeCount: [0, 9, true],
    spotCount: [0, 24, true],
    pendantCount: [0, 18, true],
  },
  skeleton: (s) => ({
    habit: "upright",
    stems: s.stemCount,
    baseSpread: s.stemRadius * 0.9,
    height: s.height,
    heightVariance: 0.05,
    baseRadius: s.stemRadius / Math.sqrt(s.stemCount),
    taper: s.taper,
    curve: s.curve,
    branch: { count: 0, depth: 0 },
  }),
  organs: (s) => [
    {
      key: "cap",
      type: "cap",
      params: { radius: s.capRadius, depth: s.capDepth, lip: 0.24 },
      material: {
        colorSlot: "body",
        wind: 1,
        roughness: 0.78,
        vertexColors: true,
        emissiveSlot: "body",
        emissiveIntensity: 0.1,
        doubleSide: true,
      },
      reach: s.capRadius,
    },
    {
      key: "lobe",
      type: "frond",
      params: {
        length: s.capRadius * 0.66,
        width: s.capRadius * 0.3,
        pinnae: 2,
        droop: 0.55,
      },
      material: {
        colorSlot: "detail",
        wind: 1,
        roughness: 0.76,
        vertexColors: true,
        doubleSide: true,
      },
      reach: s.capRadius * 1.5,
    },
    {
      key: "spot",
      type: "berry",
      params: { radius: Math.max(0.045, s.capRadius * 0.07), elongation: 0.4 },
      material: {
        colorSlot: "signal",
        wind: 1,
        roughness: 0.6,
        vertexColors: true,
      },
      reach: s.capRadius * 0.1,
    },
    {
      key: "filament",
      type: "tendril",
      params: {
        length: s.capDepth * 0.95,
        radius: Math.max(0.008, s.capRadius * 0.012),
      },
      material: { colorSlot: "structure", wind: 1, roughness: 0.92 },
      reach: 0,
    },
    {
      key: "pendant",
      type: "berry",
      params: {
        radius: Math.max(0.05, s.capRadius * 0.055),
        elongation: 1.55,
      },
      material: {
        colorSlot: "signal",
        wind: 1,
        roughness: 0.62,
        vertexColors: true,
        emissiveSlot: "signal",
        emissiveIntensity: 0.34,
        bloom: true,
      },
      reach: s.capDepth * 1.4,
    },
  ],
  layout: (s, skeleton, rng) => {
    const crownY = skeleton.extent.height;
    const lobes = [];
    for (let index = 0; index < s.lobeCount; index++) {
      const yaw = (index / Math.max(1, s.lobeCount)) * Math.PI * 2 + rng.range(-0.08, 0.08);
      const droop = -0.28 - rng.range(0, 0.34);
      lobes.push({
        position: [
          Math.cos(yaw) * s.capRadius * 0.42,
          crownY + rng.range(-0.05, 0.05),
          Math.sin(yaw) * s.capRadius * 0.42,
        ],
        dir: [Math.cos(yaw), droop, Math.sin(yaw)],
        roll: 0,
        scale: jitterScale(rng, 0.85, 1.15),
        color: index % 3 === 0 ? "signal" : index % 2 === 0 ? "detail" : "body",
      });
    }

    const spots = [];
    for (let index = 0; index < s.spotCount; index++) {
      const angle = rng.range(0, Math.PI * 2);
      const radialUnit = Math.sqrt(rng.range(0.04, 0.72));
      const dome = Math.sqrt(Math.max(0, 1 - radialUnit * radialUnit));
      spots.push({
        position: [
          Math.cos(angle) * radialUnit * s.capRadius,
          crownY + s.capDepth * dome * 0.92,
          Math.sin(angle) * radialUnit * s.capRadius,
        ],
        dir: [
          Math.cos(angle) * radialUnit,
          Math.max(0.2, dome),
          Math.sin(angle) * radialUnit,
        ],
        roll: angle,
        scale: jitterScale(rng, 0.68, 1.28),
        color: index % 4 === 0 ? "highlight" : "signal",
      });
    }

    const filaments = [];
    const pendants = [];
    for (let index = 0; index < s.pendantCount; index++) {
      const angle =
        (index / Math.max(1, s.pendantCount)) * Math.PI * 2 + rng.range(-0.11, 0.11);
      const radial = s.capRadius * rng.range(0.5, 0.95);
      const drop = rng.range(0.55, 1.35);
      const anchor = [
        Math.cos(angle) * radial,
        crownY - s.capDepth * 0.16,
        Math.sin(angle) * radial,
      ];
      filaments.push({
        position: anchor,
        dir: UPWARD,
        roll: angle,
        scale: [1, drop, 1],
        color: "structure",
      });
      pendants.push({
        position: [anchor[0], anchor[1] - s.capDepth * 0.95 * drop, anchor[2]],
        dir: UPWARD,
        roll: angle,
        scale: jitterScale(rng, 0.72, 1.22),
        color: index % 4 === 0 ? "highlight" : "signal",
      });
    }

    return {
      cap: [
        {
          position: [0, crownY, 0],
          dir: UPWARD,
          roll: rng.range(0, Math.PI * 2),
          scale: [1, 1, 1],
          color: "body",
        },
      ],
      lobe: lobes,
      spot: spots,
      filament: filaments,
      pendant: pendants,
    };
  },
};

/* ------------------------------------------------------------------ *
 * bell — the flower cluster. The Pulsebell's lathed hood and hanging pulse
 * are the organ set, not a hardcoded name check.
 * ------------------------------------------------------------------ */
const bell = {
  key: "bell",
  role: "mid",
  habit: "clumping",
  affordances: ["nectar", "pollen"],
  defaults: {
    name: "Bellstar",
    shape: {
      clusterRadius: 1.05,
      stemCount: 7,
      stemHeight: 1.25,
      stemRadius: 0.028,
      bloomRadius: 0.26,
      leafPairs: 2,
      curve: 0.22,
    },
  },
  limits: {
    clusterRadius: [0.35, 3.2],
    stemCount: [3, 18, true],
    stemHeight: [0.4, 2.8],
    stemRadius: [0.008, 0.09],
    bloomRadius: [0.07, 0.5],
    leafPairs: [0, 3, true],
    curve: [0, 0.5],
  },
  skeleton: (s) => ({
    habit: "clumping",
    stems: s.stemCount,
    baseSpread: s.clusterRadius,
    height: s.stemHeight,
    heightVariance: 0.2,
    baseRadius: s.stemRadius,
    taper: 0.72,
    curve: s.curve,
    segments: 2,
    branch: { count: 0, depth: 0 },
  }),
  organs: (s) => [
    {
      key: "bloom",
      type: "bell",
      params: { radius: s.bloomRadius, flare: 1 },
      material: {
        colorSlot: "body",
        wind: 1,
        roughness: 0.7,
        vertexColors: true,
        emissiveSlot: "body",
        emissiveIntensity: 0.2,
        doubleSide: true,
      },
      reach: s.bloomRadius,
    },
    {
      key: "pulse",
      type: "berry",
      params: { radius: s.bloomRadius * 0.26, elongation: 1.4 },
      material: {
        colorSlot: "highlight",
        wind: 1,
        roughness: 0.48,
        vertexColors: true,
        emissiveSlot: "signal",
        emissiveIntensity: 1.18,
        bloom: true,
      },
      reach: s.bloomRadius * 0.4,
    },
    {
      key: "leaf",
      type: "blade",
      params: {
        height: s.bloomRadius * 2.4,
        width: s.bloomRadius * 0.7,
        curve: 0.3,
      },
      material: {
        colorSlot: "detail",
        wind: 1,
        roughness: 0.86,
        vertexColors: true,
        doubleSide: true,
      },
      reach: s.bloomRadius * 2.4,
    },
  ],
  layout: (s, skeleton, rng) => {
    const blooms = [];
    const pulses = [];
    const leaves = [];
    skeleton.terminals.forEach((node, index) => {
      const dir = outward(node, 0.18);
      blooms.push({
        position: node.tip,
        dir,
        roll: index * GOLDEN_ANGLE,
        scale: jitterScale(rng, 0.82, 1.18),
        color: index % 3 === 0 ? "signal" : index % 2 === 0 ? "detail" : "body",
      });
      pulses.push({
        position: [
          node.tip[0] - dir[0] * s.bloomRadius * 0.85,
          node.tip[1] - dir[1] * s.bloomRadius * 0.85,
          node.tip[2] - dir[2] * s.bloomRadius * 0.85,
        ],
        dir,
        roll: 0,
        scale: jitterScale(rng, 0.78, 1.22),
        color: index % 2 === 0 ? "highlight" : "signal",
      });
    });
    skeleton.nodes.forEach((node, index) => {
      for (let pair = 0; pair < s.leafPairs; pair++) {
        for (const side of [-1, 1]) {
          const yaw = index * GOLDEN_ANGLE + pair * 1.42 + (side > 0 ? Math.PI : 0);
          leaves.push({
            position: [
              node.origin[0] + node.direction[0] * node.length * (0.3 + pair * 0.22),
              node.origin[1] + node.direction[1] * node.length * (0.3 + pair * 0.22),
              node.origin[2] + node.direction[2] * node.length * (0.3 + pair * 0.22),
            ],
            dir: [Math.cos(yaw) * 0.85, 0.5, Math.sin(yaw) * 0.85],
            roll: yaw,
            scale: jitterScale(rng, 0.7 + pair * 0.12, 1.05 + pair * 0.12),
            color: index % 2 === 0 ? "detail" : "body",
          });
        }
      }
    });
    return { bloom: blooms, pulse: pulses, leaf: leaves };
  },
};

/* ------------------------------------------------------------------ *
 * frond — a fern. Arching rachis, pinnate leaves at every node.
 * ------------------------------------------------------------------ */
const frond = {
  key: "frond",
  role: "mid",
  habit: "arching",
  affordances: ["shelter", "soft-cover"],
  defaults: {
    name: "Curlfrond",
    shape: {
      height: 1.35,
      stemCount: 5,
      stemRadius: 0.05,
      curve: 0.62,
      frondLength: 0.85,
      frondWidth: 0.24,
      pinnaCount: 6,
    },
  },
  limits: {
    height: [0.4, 3.2],
    stemCount: [2, 9, true],
    stemRadius: [0.015, 0.2],
    curve: [0.2, 1],
    frondLength: [0.2, 1.8],
    frondWidth: [0.06, 0.55],
    pinnaCount: [3, 9, true],
  },
  skeleton: (s) => ({
    habit: "arching",
    stems: s.stemCount,
    baseSpread: s.height * 0.18,
    height: s.height,
    heightVariance: 0.22,
    baseRadius: s.stemRadius,
    taper: 0.4,
    curve: s.curve,
    segments: 3,
    branch: { count: 0, depth: 0 },
  }),
  organs: (s) => [
    {
      key: "frond",
      type: "frond",
      params: {
        length: s.frondLength,
        width: s.frondWidth,
        pinnae: s.pinnaCount,
        droop: 0.5,
      },
      material: {
        colorSlot: "body",
        wind: 1,
        roughness: 0.88,
        vertexColors: true,
        doubleSide: true,
        emissiveSlot: "signal",
        emissiveIntensity: 0.05,
      },
      reach: s.frondLength,
    },
  ],
  layout: (s, skeleton, rng) => ({
    frond: skeleton.nodes.map((node, index) => {
      const t = node.terminal ? 1 : 0.6;
      return {
        position: [
          node.origin[0] + node.direction[0] * node.length * t,
          node.origin[1] + node.direction[1] * node.length * t,
          node.origin[2] + node.direction[2] * node.length * t,
        ],
        dir: outward(node, 0.3),
        roll: index * GOLDEN_ANGLE + rng.range(-0.2, 0.2),
        scale: jitterScale(rng, 0.72, 1.2),
        color: index % 3 === 0 ? "detail" : "body",
      };
    }),
  }),
};

/* ------------------------------------------------------------------ *
 * pad — a succulent rosette. Thick, low, spined.
 * ------------------------------------------------------------------ */
const pad = {
  key: "pad",
  role: "mid",
  habit: "rosette",
  affordances: ["forage", "shelter"],
  defaults: {
    name: "Palmshade",
    shape: {
      padCount: 7,
      padRadius: 0.5,
      padThickness: 0.28,
      stubLength: 0.22,
      spread: 0.7,
      spineCount: 8,
    },
  },
  limits: {
    padCount: [3, 14, true],
    padRadius: [0.12, 1.2],
    padThickness: [0.08, 0.5],
    stubLength: [0.05, 0.9],
    spread: [0.2, 1.2],
    spineCount: [0, 20, true],
  },
  skeleton: (s) => ({
    habit: "rosette",
    stems: s.padCount,
    baseSpread: s.padRadius * s.spread * 0.5,
    height: s.stubLength,
    heightVariance: 0.25,
    baseRadius: Math.max(0.012, s.padRadius * 0.16),
    taper: 0.7,
    curve: 0.1,
    segments: 1,
    branch: { count: 0, depth: 0 },
  }),
  organs: (s) => [
    {
      key: "pad",
      type: "pad",
      params: { radius: s.padRadius, thickness: s.padThickness, detail: 1 },
      material: {
        colorSlot: "body",
        wind: 1,
        roughness: 0.82,
        vertexColors: true,
      },
      reach: s.padRadius,
    },
    {
      key: "spine",
      type: "spine",
      params: {
        length: s.padRadius * 0.34,
        radius: Math.max(0.006, s.padRadius * 0.035),
      },
      material: { colorSlot: "highlight", wind: 1, roughness: 0.5 },
      reach: s.padRadius * 0.34,
    },
  ],
  layout: (s, skeleton, rng) => {
    const pads = skeleton.terminals.map((node, index) => ({
      position: node.tip,
      dir: outward(node, s.spread * 0.6),
      roll: index * GOLDEN_ANGLE,
      scale: jitterScale(rng, 0.8, 1.22),
      color: index % 3 === 0 ? "detail" : "body",
    }));
    const spines = [];
    for (let index = 0; index < s.spineCount && pads.length > 0; index++) {
      const host = pads[index % pads.length];
      const angle = index * GOLDEN_ANGLE;
      const radial = s.padRadius * rng.range(0.3, 0.85);
      spines.push({
        position: [
          host.position[0] + Math.cos(angle) * radial,
          host.position[1] + s.padRadius * s.padThickness * 1.1,
          host.position[2] + Math.sin(angle) * radial,
        ],
        dir: host.dir,
        roll: angle,
        scale: jitterScale(rng, 0.7, 1.3),
        color: "highlight",
      });
    }
    return { pad: pads, spine: spines };
  },
};

/* ------------------------------------------------------------------ *
 * reed — a clump of vertical stems near water. Bladed, plumed.
 * ------------------------------------------------------------------ */
const reed = {
  key: "reed",
  role: "ground",
  habit: "clumping",
  affordances: ["soft-cover", "forage"],
  defaults: {
    name: "Sedgetuft",
    shape: {
      height: 1.5,
      stemCount: 12,
      clumpRadius: 0.6,
      stemRadius: 0.035,
      curve: 0.16,
      bladeWidth: 0.1,
      plumeRadius: 0.09,
    },
  },
  limits: {
    height: [0.4, 4],
    stemCount: [4, 24, true],
    clumpRadius: [0.2, 2.2],
    stemRadius: [0.012, 0.14],
    curve: [0, 0.45],
    bladeWidth: [0.03, 0.24],
    plumeRadius: [0, 0.35],
  },
  skeleton: (s) => ({
    habit: "clumping",
    stems: s.stemCount,
    baseSpread: s.clumpRadius,
    height: s.height,
    heightVariance: 0.3,
    baseRadius: s.stemRadius,
    taper: 0.35,
    curve: s.curve,
    segments: 2,
    branch: { count: 0, depth: 0 },
  }),
  organs: (s) => [
    {
      key: "blade",
      type: "blade",
      params: {
        height: s.height * 0.55,
        width: s.bladeWidth,
        curve: 0.16,
      },
      material: {
        colorSlot: "body",
        wind: 1,
        roughness: 0.9,
        vertexColors: true,
        doubleSide: true,
      },
      reach: s.height * 0.55,
    },
    {
      key: "plume",
      type: "bulb",
      params: { radius: Math.max(0.01, s.plumeRadius), elongation: 2.1 },
      material: {
        colorSlot: "signal",
        wind: 1,
        roughness: 0.72,
        vertexColors: true,
      },
      reach: Math.max(0.01, s.plumeRadius) * 2.2,
    },
  ],
  layout: (s, skeleton, rng) => ({
    blade: skeleton.nodes.map((node, index) => {
      const yaw = index * GOLDEN_ANGLE;
      return {
        position: node.origin,
        dir: [Math.cos(yaw) * 0.28, 1, Math.sin(yaw) * 0.28],
        roll: yaw,
        scale: jitterScale(rng, 0.7, 1.3),
        color: index % 4 === 0 ? "detail" : "body",
      };
    }),
    plume:
      s.plumeRadius <= 0
        ? []
        : skeleton.terminals.map((node, index) => ({
            position: node.tip,
            dir: node.direction,
            roll: index * GOLDEN_ANGLE,
            scale: jitterScale(rng, 0.75, 1.25),
            color: index % 2 === 0 ? "signal" : "highlight",
          })),
  }),
};

/* ------------------------------------------------------------------ *
 * cover — groundcover. The one archetype with no skeleton: a patch of
 * blades scattered across a disc rather than a structure.
 * ------------------------------------------------------------------ */
const cover = {
  key: "cover",
  role: "ground",
  habit: "creeping",
  affordances: ["forage", "soft-cover"],
  defaults: {
    name: "Whispergrass",
    shape: {
      patchRadius: 2.6,
      count: 112,
      bladeHeight: 0.48,
      bladeWidth: 0.095,
      clumpiness: 0.62,
      heightVariance: 0.38,
    },
  },
  limits: {
    patchRadius: [0.6, 5],
    count: [12, 320, true],
    bladeHeight: [0.12, 1.15],
    bladeWidth: [0.025, 0.3],
    clumpiness: [0, 1],
    heightVariance: [0, 0.75],
  },
  skeleton: () => null,
  // A patch has no structure to take its extent from, so it declares one.
  spread: (s) => s.patchRadius + s.bladeWidth,
  organs: (s) => [
    {
      key: "blade",
      type: "blade",
      params: { height: s.bladeHeight, width: s.bladeWidth, curve: 0.11 },
      material: {
        colorSlot: "body",
        wind: 1,
        roughness: 0.92,
        vertexColors: true,
        doubleSide: true,
        emissiveSlot: "signal",
        emissiveIntensity: 0.07,
      },
      // Blades carry their height variance in the instance scale, so the
      // reach that sizes the bounds has to carry it too.
      reach: s.bladeHeight * (1 + s.heightVariance),
    },
  ],
  layout: (s, skeleton, rng) => ({
    blade: scatterDisc(rng, s.count, s.patchRadius, s.clumpiness).map(
      (point, index) => {
        const lean = rng.range(-0.22, 0.22);
        const yaw = rng.range(0, Math.PI * 2);
        const heightScale = clamp(
          1 + rng.range(-s.heightVariance, s.heightVariance),
          0.35,
          2,
        );
        return {
          position: [point.x, 0, point.z],
          dir: [Math.sin(lean) * Math.cos(yaw), 1, Math.sin(lean) * Math.sin(yaw)],
          roll: yaw,
          scale: [rng.range(0.78, 1.28), heightScale, rng.range(0.82, 1.18)],
          color: index % 5 === 0 ? "detail" : "body",
        };
      },
    ),
  }),
};

/* ------------------------------------------------------------------ *
 * coral — heavy branching, blunt tips. Reef fields, and the archetype the
 * SDF blend-shell work in Stage 4 will want first.
 * ------------------------------------------------------------------ */
const coral = {
  key: "coral",
  role: "mid",
  habit: "upright",
  affordances: ["shelter", "perch"],
  defaults: {
    name: "Reefbranch",
    shape: {
      height: 1.6,
      stemCount: 2,
      stemRadius: 0.18,
      taper: 0.7,
      branchCount: 3,
      branchAngle: 0.85,
      branchDepth: 2,
      branchFalloff: 0.72,
      tipRadius: 0.14,
    },
  },
  limits: {
    height: [0.4, 3.6],
    stemCount: [1, 4, true],
    stemRadius: [0.05, 0.55],
    taper: [0.35, 0.95],
    branchCount: [2, 4, true],
    branchAngle: [0.4, 1.3],
    branchDepth: [1, 3, true],
    branchFalloff: [0.5, 0.9],
    tipRadius: [0.03, 0.4],
  },
  skeleton: (s) => ({
    habit: "upright",
    stems: s.stemCount,
    baseSpread: s.stemRadius * 2.2,
    height: s.height / (1 + s.branchDepth * 0.5),
    baseRadius: s.stemRadius,
    taper: s.taper,
    curve: 0.24,
    branch: {
      count: s.branchCount,
      angle: s.branchAngle,
      depth: s.branchDepth,
      falloff: s.branchFalloff,
    },
  }),
  organs: (s) => [
    {
      key: "tip",
      type: "bulb",
      params: { radius: s.tipRadius, elongation: 1.1 },
      material: {
        colorSlot: "signal",
        wind: 1,
        roughness: 0.66,
        vertexColors: true,
        emissiveSlot: "signal",
        emissiveIntensity: 0.16,
      },
      reach: s.tipRadius * 1.3,
    },
  ],
  layout: (s, skeleton, rng) => ({
    tip: skeleton.terminals.map((node, index) => ({
      position: node.tip,
      dir: node.direction,
      roll: index * GOLDEN_ANGLE,
      scale: jitterScale(rng, 0.8, 1.25),
      color: index % 3 === 0 ? "highlight" : "signal",
    })),
  }),
};

const ENTRIES = [canopy, spire, cap, bell, frond, pad, reed, cover, coral];

export const FLORA_ARCHETYPES = Object.freeze(ENTRIES.map((entry) => entry.key));

export const ARCHETYPES = Object.freeze(
  Object.fromEntries(ENTRIES.map((entry) => [entry.key, Object.freeze(entry)])),
);

/** The compositional tier an archetype defaults to when DNA omits one. */
export const ARCHETYPE_ROLES = Object.freeze(
  Object.fromEntries(ENTRIES.map((entry) => [entry.key, entry.role])),
);

export const ARCHETYPE_SHAPE_DEFAULTS = Object.freeze(
  Object.fromEntries(
    ENTRIES.map((entry) => [entry.key, Object.freeze({ ...entry.defaults.shape })]),
  ),
);

export const ARCHETYPE_SHAPE_LIMITS = Object.freeze(
  Object.fromEntries(ENTRIES.map((entry) => [entry.key, Object.freeze(entry.limits)])),
);

export const ARCHETYPE_NAME_DEFAULTS = Object.freeze(
  Object.fromEntries(ENTRIES.map((entry) => [entry.key, entry.defaults.name])),
);
