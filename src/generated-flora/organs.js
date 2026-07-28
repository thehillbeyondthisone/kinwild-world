/**
 * The organ library.
 *
 * Skeletons give a plant its structure; organs give it its character. Each
 * builder returns one shared geometry oriented so that local +Y is the
 * direction the organ grows away from its attachment point, and the origin is
 * the attachment point itself — so an archetype only ever has to hand the
 * compiler a position and a rotation that maps +Y onto a skeleton node.
 *
 * Free of `Math.random`: every builder is a pure function of its parameters.
 */
import * as THREE from "three";

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** A mushroom cap: a lathed dome with a turned-under lip. */
function buildCap({ radius = 1, depth = 0.45, lip = 0.22 }) {
  const profile = [
    new THREE.Vector2(0.0001, depth),
    new THREE.Vector2(radius * 0.28, depth * 0.94),
    new THREE.Vector2(radius * 0.58, depth * 0.74),
    new THREE.Vector2(radius * 0.85, depth * 0.38),
    new THREE.Vector2(radius, 0),
    new THREE.Vector2(radius * 0.93, -depth * lip),
    new THREE.Vector2(radius * 0.72, -depth * lip * 1.35),
  ];
  return new THREE.LatheGeometry(profile, 22);
}

/** A hanging bell: the Pulsebell hood, rim folded into the same profile. */
function buildBell({ radius = 0.25, flare = 0.9 }) {
  const profile = [
    new THREE.Vector2(0.0001, radius * 0.62),
    new THREE.Vector2(radius * 0.18, radius * 0.54),
    new THREE.Vector2(radius * 0.42, radius * 0.26),
    new THREE.Vector2(radius * 0.68, -radius * 0.2),
    new THREE.Vector2(radius * 0.88 * flare, -radius * 0.58),
    new THREE.Vector2(radius * 0.78 * flare, -radius * 0.72),
  ];
  return new THREE.LatheGeometry(profile, 16);
}

/** A grass/reed blade: a tapered curving strip, cheap and double-sided. */
function buildBlade({ height = 0.5, width = 0.09, curve = 0.11 }) {
  const levels = 5;
  const positions = [];
  const indices = [];
  for (let i = 0; i < levels; i++) {
    const t = i / (levels - 1);
    const halfWidth = width * 0.5 * (1 - t * 0.92);
    const lean = Math.sin(t * Math.PI * 0.5) * height * curve;
    positions.push(-halfWidth, t * height, lean);
    positions.push(halfWidth, t * height, lean);
    if (i < levels - 1) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A frond: a drooping pinnate leaf. Also what the Veilcrown's crown lobes
 * are made of — a lobe is a short wide frond with only one pinna pair.
 */
function buildFrond({ length = 1, width = 0.3, pinnae = 5, droop = 0.45 }) {
  const pairs = Math.max(1, Math.round(pinnae));
  const positions = [];
  const indices = [];
  for (let i = 0; i <= pairs; i++) {
    const t = i / pairs;
    const y = length * t * (1 - droop * t * 0.55);
    const z = -length * droop * t * t;
    const halfWidth = width * Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.95)) * (1 - t * 0.35);
    positions.push(-halfWidth, y, z);
    positions.push(0, y, z + width * 0.08);
    positions.push(halfWidth, y, z);
    if (i < pairs) {
      const a = i * 3;
      indices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
      indices.push(a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** A leaf mass or succulent pad: a squashed, jittered sphere. */
function buildPad({ radius = 0.5, thickness = 0.35, detail = 1 }) {
  return new THREE.IcosahedronGeometry(radius, detail)
    .scale(1, Math.max(0.06, thickness), 1)
    .translate(0, radius * Math.max(0.06, thickness), 0);
}

/** A spine or thorn. */
function buildSpine({ length = 0.2, radius = 0.03 }) {
  return new THREE.ConeGeometry(radius, length, 5, 1).translate(0, length * 0.5, 0);
}

/** A bulb, bud or coral tip. */
function buildBulb({ radius = 0.2, elongation = 1.15 }) {
  return new THREE.DodecahedronGeometry(radius, 1)
    .scale(0.86, elongation, 0.86)
    .translate(0, radius * elongation * 0.85, 0);
}

/** A hanging filament. Grows along -Y, unlike everything else here. */
function buildTendril({ length = 0.4, radius = 0.02 }) {
  return new THREE.CylinderGeometry(radius * 0.6, radius, length, 6, 1)
    .translate(0, -length * 0.5, 0);
}

/** A berry, spot or glowing pulse. */
function buildBerry({ radius = 0.07, elongation = 1 }) {
  return new THREE.OctahedronGeometry(radius, 1).scale(0.9, elongation, 0.9);
}

export const ORGAN_BUILDERS = Object.freeze({
  cap: buildCap,
  bell: buildBell,
  blade: buildBlade,
  frond: buildFrond,
  pad: buildPad,
  spine: buildSpine,
  bulb: buildBulb,
  tendril: buildTendril,
  berry: buildBerry,
});

export const ORGAN_TYPES = Object.freeze(Object.keys(ORGAN_BUILDERS));

/**
 * Build one organ geometry.
 *
 * @param {string} type one of {@link ORGAN_TYPES}
 * @param {object} params builder parameters
 * @returns {THREE.BufferGeometry}
 */
export function buildOrganGeometry(type, params = {}) {
  const builder = ORGAN_BUILDERS[type];
  if (!builder) throw new Error(`unknown flora organ: ${type}`);
  return builder(params);
}

/* ------------------------------------------------------------------ *
 * Attachment rules.
 *
 * An archetype says *where* an organ goes by naming a rule rather than by
 * walking the node list itself, so the same phrase ("terminal", "underside")
 * means the same thing on every archetype.
 * ------------------------------------------------------------------ */

/** Nodes with no children — where a plant puts the thing it is known for. */
export function terminalNodes(skeleton) {
  return skeleton.terminals;
}

/** Every node, for organs that clothe a stem rather than crown it. */
export function allNodes(skeleton) {
  return skeleton.nodes;
}

/** Everything from `depth` outwards — leaves on twigs, not on the trunk. */
export function nodesAtDepth(skeleton, depth) {
  return skeleton.nodes.filter((node) => node.depth >= depth);
}

/**
 * A deterministic disc scatter, for the archetypes whose organs are a patch
 * rather than a structure (groundcover, and a mushroom cap's spots).
 *
 * @returns {Array<{x: number, z: number, radialUnit: number}>}
 */
export function scatterDisc(rng, count, radius, clumpiness = 0) {
  const points = [];
  const clusterCount = Math.max(1, 3 + Math.round(clumpiness * 5));
  const clusters = [];
  for (let i = 0; i < clusterCount; i++) {
    const angle = i * GOLDEN_ANGLE + rng.range(-0.2, 0.2);
    const radial = Math.sqrt(rng.next()) * radius * 0.72;
    clusters.push({ x: Math.cos(angle) * radial, z: Math.sin(angle) * radial });
  }
  for (let i = 0; i < count; i++) {
    let x;
    let z;
    if (clumpiness > 0 && rng.next() < clumpiness) {
      const cluster = clusters[rng.int(0, clusters.length - 1)];
      const angle = rng.range(0, Math.PI * 2);
      const radial =
        Math.sqrt(rng.next()) * radius * (0.08 + (1 - clumpiness) * 0.28);
      x = cluster.x + Math.cos(angle) * radial;
      z = cluster.z + Math.sin(angle) * radial;
    } else {
      const angle = rng.range(0, Math.PI * 2);
      const radial = Math.sqrt(rng.next()) * radius;
      x = Math.cos(angle) * radial;
      z = Math.sin(angle) * radial;
    }
    const distance = Math.hypot(x, z);
    if (distance > radius) {
      const correction = radius / Math.max(distance, 1e-6);
      x *= correction;
      z *= correction;
    }
    points.push({ x, z, radialUnit: Math.hypot(x, z) / Math.max(radius, 1e-6) });
  }
  return points;
}

export { GOLDEN_ANGLE };
