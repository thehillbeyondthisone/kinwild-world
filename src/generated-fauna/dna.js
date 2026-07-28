const COLOR_RE = /^#[0-9a-f]{6}$/i;
const LEG_COUNTS = [2, 4, 6];
const LOCOMOTIONS = ["walker", "flier"];

const CURATED_WINGS = deepFreeze({
  span: 0.44,
  chord: 0.13,
  beat: 7.5,
  dihedral: 0.26,
});

export const GENERATED_FAUNA_SCHEMA_VERSION = 1;
export const GENERATED_FAUNA_MAX_PRIMITIVES = 16;
export const GENERATED_FAUNA_MAX_INFLUENCES = 8;

export const CURATED_WALKER_DNA = deepFreeze({
  schemaVersion: GENERATED_FAUNA_SCHEMA_VERSION,
  locomotion: "walker",
  speciesId: "moss-trundle",
  name: "Moss Trundle",
  seed: 0x4d31,
  palette: {
    body: "#f29a49",
    head: "#ffd06a",
    limb: "#c96b42",
    eye: "#fff8e8",
    pupil: "#1a1c2c",
  },
  body: {
    radius: 0.32,
    halfLength: 0.2,
  },
  head: {
    radius: 0.22,
    offset: [0, 0.18, 0.34],
    eyeRadius: 0.052,
  },
  legs: {
    count: 4,
    length: 0.48,
    thickness: 0.07,
    stance: 0.2,
    spread: 0.24,
  },
  motion: {
    stepDuration: 0.24,
    stepTrigger: 0.13,
    lift: 0.075,
    bob: 0.018,
  },
});

/**
 * Convert untrusted semantic walker input into a small, bounded genome.
 * Unknown or malformed fields repair to curated defaults. The only hard
 * failure is a caller-provided primitive budget too small for any walker.
 *
 * @param {unknown} raw
 * @param {{maxPrimitives?: number, maxInfluences?: number}} [options]
 * @returns {{
 *   dna: typeof CURATED_WALKER_DNA,
 *   repairs: string[],
 *   primitiveCount: number,
 *   genomeHash: string
 * }}
 */
export function normalizeWalkerDNA(raw, options = {}) {
  const source = isRecord(raw) ? raw : {};
  const repairs = [];
  if (!isRecord(raw)) repairs.push("root: expected object; used curated defaults");

  const maxPrimitives = boundedInteger(
    options.maxPrimitives,
    1,
    GENERATED_FAUNA_MAX_PRIMITIVES,
    GENERATED_FAUNA_MAX_PRIMITIVES,
  );
  const maxInfluences = boundedInteger(
    options.maxInfluences,
    1,
    GENERATED_FAUNA_MAX_INFLUENCES,
    GENERATED_FAUNA_MAX_INFLUENCES,
  );
  if (maxPrimitives < primitiveCountForLegs(2) || maxInfluences < 4) {
    throw new RangeError(
      "generated walker budget must allow at least 6 primitives and 4 influences",
    );
  }

  const paletteSource = isRecord(source.palette) ? source.palette : {};
  const bodySource = isRecord(source.body) ? source.body : {};
  const headSource = isRecord(source.head) ? source.head : {};
  const legsSource = isRecord(source.legs) ? source.legs : {};
  const motionSource = isRecord(source.motion) ? source.motion : {};

  const locomotion = safeLocomotion(source.locomotion, repairs);
  const flier = locomotion === "flier";
  const wingsSource = isRecord(source.wings) ? source.wings : {};
  // Fliers default to two legs: they spend most of their time with them
  // tucked, and a lighter body plan leaves headroom for the wings.
  let legCount = nearestLegCount(numberOr(legsSource.count, flier ? 2 : 4));
  while (
    (primitiveCountFor(legCount, locomotion) > maxPrimitives ||
      influenceCountFor(legCount, locomotion) + 1 > maxInfluences) &&
    legCount > 2
  ) {
    legCount = LEG_COUNTS[LEG_COUNTS.indexOf(legCount) - 1];
  }
  if (legCount !== legsSource.count && legsSource.count !== undefined) {
    repairs.push(`legs.count: repaired to ${legCount}`);
  }

  const dna = {
    schemaVersion: GENERATED_FAUNA_SCHEMA_VERSION,
    locomotion,
    speciesId: safeId(source.speciesId, CURATED_WALKER_DNA.speciesId, repairs),
    name: safeName(source.name, CURATED_WALKER_DNA.name, repairs),
    seed: finiteInteger(source.seed, CURATED_WALKER_DNA.seed) >>> 0,
    palette: {
      body: safeColor(
        paletteSource.body,
        CURATED_WALKER_DNA.palette.body,
        "palette.body",
        repairs,
      ),
      head: safeColor(
        paletteSource.head,
        CURATED_WALKER_DNA.palette.head,
        "palette.head",
        repairs,
      ),
      limb: safeColor(
        paletteSource.limb,
        CURATED_WALKER_DNA.palette.limb,
        "palette.limb",
        repairs,
      ),
      eye: safeColor(
        paletteSource.eye,
        CURATED_WALKER_DNA.palette.eye,
        "palette.eye",
        repairs,
      ),
      pupil: safeColor(
        paletteSource.pupil,
        CURATED_WALKER_DNA.palette.pupil,
        "palette.pupil",
        repairs,
      ),
    },
    body: {
      radius: clamped(
        bodySource.radius,
        0.16,
        0.46,
        CURATED_WALKER_DNA.body.radius,
        "body.radius",
        repairs,
      ),
      halfLength: clamped(
        bodySource.halfLength,
        0.08,
        0.42,
        CURATED_WALKER_DNA.body.halfLength,
        "body.halfLength",
        repairs,
      ),
    },
    head: {
      radius: clamped(
        headSource.radius,
        0.1,
        0.34,
        CURATED_WALKER_DNA.head.radius,
        "head.radius",
        repairs,
      ),
      offset: safeVec3(
        headSource.offset,
        CURATED_WALKER_DNA.head.offset,
        [-0.35, -0.1, -0.1],
        [0.35, 0.55, 0.7],
        "head.offset",
        repairs,
      ),
      eyeRadius: clamped(
        headSource.eyeRadius,
        0.022,
        0.09,
        CURATED_WALKER_DNA.head.eyeRadius,
        "head.eyeRadius",
        repairs,
      ),
    },
    legs: {
      count: legCount,
      length: clamped(
        legsSource.length,
        0.24,
        0.78,
        CURATED_WALKER_DNA.legs.length,
        "legs.length",
        repairs,
      ),
      thickness: clamped(
        legsSource.thickness,
        0.035,
        0.13,
        CURATED_WALKER_DNA.legs.thickness,
        "legs.thickness",
        repairs,
      ),
      stance: clamped(
        legsSource.stance,
        0.1,
        0.38,
        CURATED_WALKER_DNA.legs.stance,
        "legs.stance",
        repairs,
      ),
      spread: clamped(
        legsSource.spread,
        0.08,
        0.42,
        CURATED_WALKER_DNA.legs.spread,
        "legs.spread",
        repairs,
      ),
    },
    motion: {
      stepDuration: clamped(
        motionSource.stepDuration,
        0.14,
        0.5,
        CURATED_WALKER_DNA.motion.stepDuration,
        "motion.stepDuration",
        repairs,
      ),
      stepTrigger: clamped(
        motionSource.stepTrigger,
        0.07,
        0.28,
        CURATED_WALKER_DNA.motion.stepTrigger,
        "motion.stepTrigger",
        repairs,
      ),
      lift: clamped(
        motionSource.lift,
        0.025,
        0.18,
        CURATED_WALKER_DNA.motion.lift,
        "motion.lift",
        repairs,
      ),
      bob: clamped(
        motionSource.bob,
        0,
        0.05,
        CURATED_WALKER_DNA.motion.bob,
        "motion.bob",
        repairs,
      ),
    },
  };

  if (flier) {
    dna.wings = {
      span: clamped(
        wingsSource.span, 0.22, 0.95, CURATED_WINGS.span, "wings.span", repairs,
      ),
      chord: clamped(
        wingsSource.chord, 0.05, 0.34, CURATED_WINGS.chord, "wings.chord", repairs,
      ),
      beat: clamped(
        wingsSource.beat, 3, 16, CURATED_WINGS.beat, "wings.beat", repairs,
      ),
      dihedral: clamped(
        wingsSource.dihedral, 0, 0.6, CURATED_WINGS.dihedral, "wings.dihedral",
        repairs,
      ),
    };
  }

  // Relational constraints matter more than independently valid scalars.
  const maxThickness = dna.legs.length * 0.24;
  if (dna.legs.thickness > maxThickness) {
    dna.legs.thickness = maxThickness;
    repairs.push("legs.thickness: reduced to fit leg length");
  }
  const maxEye = dna.head.radius * 0.34;
  if (dna.head.eyeRadius > maxEye) {
    dna.head.eyeRadius = maxEye;
    repairs.push("head.eyeRadius: reduced to fit head");
  }

  if (flier) {
    // A wing wider than the body reads as a glider, not a kinling. Hold the
    // span against the body it hangs off rather than against an absolute.
    const maxSpan = dna.body.radius * 2.6;
    if (dna.wings.span > maxSpan) {
      dna.wings.span = maxSpan;
      repairs.push("wings.span: reduced to fit the body");
    }
    const maxChord = dna.wings.span * 0.42;
    if (dna.wings.chord > maxChord) {
      dna.wings.chord = maxChord;
      repairs.push("wings.chord: reduced to fit the span");
    }
  }

  const primitiveCount = primitiveCountFor(dna.legs.count, locomotion);
  if (
    primitiveCount > maxPrimitives ||
    influenceCountFor(dna.legs.count, locomotion) + 1 > maxInfluences
  ) {
    throw new RangeError("normalized generated walker exceeds renderer budget");
  }

  const frozen = deepFreeze(dna);
  return {
    dna: frozen,
    repairs,
    primitiveCount,
    genomeHash: fnv1a(JSON.stringify(frozen)),
  };
}

function safeLocomotion(value, repairs) {
  if (value === undefined) return "walker";
  if (typeof value === "string" && LOCOMOTIONS.includes(value)) return value;
  repairs.push("locomotion: repaired to walker");
  return "walker";
}

export function primitiveCountForLegs(count) {
  return 2 + count * 2;
}

/**
 * Primitives a body plan costs. A flier pays two more than a walker with the
 * same leg count — one capsule per wing.
 */
export function primitiveCountFor(count, locomotion = "walker") {
  return primitiveCountForLegs(count) + (locomotion === "flier" ? 2 : 0);
}

/**
 * Entries in the body's own influence list: the head, every upper leg, and
 * each wing. This is what caps a flier at four legs — six would need ten
 * influences against a budget of eight.
 */
export function influenceCountFor(count, locomotion = "walker") {
  return 1 + count + (locomotion === "flier" ? 2 : 0);
}

/** Stable per-channel value in [0, 1); independent of ambient Math.random. */
export function seededUnit(seed, channel) {
  const channelHash = Number.parseInt(fnv1a(String(channel)), 16) >>> 0;
  let x = ((seed >>> 0) ^ channelHash ^ 0x9e3779b9) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function finiteInteger(value, fallback) {
  return Math.round(numberOr(value, fallback));
}

function boundedInteger(value, lo, hi, fallback) {
  return Math.min(hi, Math.max(lo, finiteInteger(value, fallback)));
}

function nearestLegCount(value) {
  let result = LEG_COUNTS[0];
  let distance = Infinity;
  for (const count of LEG_COUNTS) {
    const next = Math.abs(value - count);
    if (next < distance) {
      result = count;
      distance = next;
    }
  }
  return result;
}

function clamped(value, lo, hi, fallback, path, repairs) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    if (value !== undefined) repairs.push(`${path}: expected finite number`);
    return fallback;
  }
  const result = Math.min(hi, Math.max(lo, numeric));
  if (result !== numeric) repairs.push(`${path}: clamped to ${result}`);
  return result;
}

function safeVec3(value, fallback, lo, hi, path, repairs) {
  if (!Array.isArray(value) || value.length < 3) {
    if (value !== undefined) repairs.push(`${path}: expected [x, y, z]`);
    return [...fallback];
  }
  return [0, 1, 2].map((index) =>
    clamped(value[index], lo[index], hi[index], fallback[index], `${path}[${index}]`, repairs),
  );
}

function safeColor(value, fallback, path, repairs) {
  if (typeof value !== "string" || !COLOR_RE.test(value)) {
    if (value !== undefined) repairs.push(`${path}: expected #rrggbb`);
    return fallback;
  }
  return value.toLowerCase();
}

function safeId(value, fallback, repairs) {
  if (typeof value !== "string") {
    if (value !== undefined) repairs.push("speciesId: expected string");
    return fallback;
  }
  const result = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (!result) {
    repairs.push("speciesId: empty after normalization");
    return fallback;
  }
  if (result !== value) repairs.push(`speciesId: normalized to "${result}"`);
  return result;
}

function safeName(value, fallback, repairs) {
  if (typeof value !== "string" || !value.trim()) {
    if (value !== undefined) repairs.push("name: expected non-empty string");
    return fallback;
  }
  const result = value.trim().slice(0, 64);
  if (result !== value) repairs.push("name: trimmed to 64 characters");
  return result;
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}
