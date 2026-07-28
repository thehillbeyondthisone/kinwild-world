/**
 * Plant skeletons.
 *
 * A plant's silhouette used to be a code path: three renderers, three
 * shapes, forever. This module is the replacement — a deterministic node
 * graph compiled from DNA, the way a creature's primitive list is compiled
 * from its own. A mushroom becomes one point in the space rather than the
 * only point.
 *
 * DOM-free, THREE-free, and free of `Math.random`. Node ids are path-derived
 * (`1/2/b0`) and stable: growth, damage and saves must be able to name a part
 * of a plant across sessions, which they cannot do against an index that
 * shifts when a branch count changes.
 */

/** Hard ceiling on nodes per plant. Exceeded rolls are pruned, never grown. */
export const MAX_SKELETON_NODES = 40;

/** How much geometry we are willing to generate before pruning starts. */
const GENERATION_CEILING = MAX_SKELETON_NODES * 4;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export const SKELETON_HABITS = Object.freeze([
  "upright",
  "arching",
  "rosette",
  "creeping",
  "clumping",
]);

/**
 * Per-habit posture. `tilt` is how far a stem leans off vertical at its base;
 * `bend` is how much each successive segment of a stem continues to bend in
 * that direction (an arching fern keeps going, an upright trunk barely does).
 */
const HABIT_POSTURE = Object.freeze({
  upright: { tilt: 0.05, bend: 0.55, spread: 0.16 },
  arching: { tilt: 0.34, bend: 1.55, spread: 0.34 },
  rosette: { tilt: 0.62, bend: 0.7, spread: 0.28 },
  creeping: { tilt: 1.12, bend: 0.85, spread: 0.5 },
  clumping: { tilt: 0.17, bend: 0.6, spread: 0.6 },
});

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function normalize(v) {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

/** Any unit vector perpendicular to `d`, chosen without a branch on epsilon. */
function perpendicular(d) {
  const seed = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  return normalize([
    seed[1] * d[2] - seed[2] * d[1],
    seed[2] * d[0] - seed[0] * d[2],
    seed[0] * d[1] - seed[1] * d[0],
  ]);
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/**
 * Tilt `direction` away from itself by `angle`, rotated `azimuth` around it.
 */
function deflect(direction, angle, azimuth) {
  if (angle === 0) return [...direction];
  const u = perpendicular(direction);
  const v = cross(direction, u);
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  const ca = Math.cos(azimuth);
  const sa = Math.sin(azimuth);
  return normalize([
    direction[0] * c + (u[0] * ca + v[0] * sa) * s,
    direction[1] * c + (u[1] * ca + v[1] * sa) * s,
    direction[2] * c + (u[2] * ca + v[2] * sa) * s,
  ]);
}

function tip(node) {
  return [
    node.origin[0] + node.direction[0] * node.length,
    node.origin[1] + node.direction[1] * node.length,
    node.origin[2] + node.direction[2] * node.length,
  ];
}

/**
 * Deterministic pruning: deepest first, thinnest first inside a depth, id
 * order last. Only leaves are ever removed, so the graph stays connected and
 * removing a branch can never orphan one of its children.
 */
function pruneToBudget(nodes, budget) {
  if (nodes.length <= budget) return nodes;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childCount = new Map();
  for (const node of nodes) {
    if (node.parent === null) continue;
    childCount.set(node.parent, (childCount.get(node.parent) ?? 0) + 1);
  }
  const alive = new Set(nodes.map((node) => node.id));

  while (alive.size > budget) {
    let victim = null;
    for (const id of alive) {
      if ((childCount.get(id) ?? 0) > 0) continue;
      const node = byId.get(id);
      // Never prune a root: a plant with no stem is not a smaller plant.
      if (node.parent === null) continue;
      if (
        !victim ||
        node.depth > victim.depth ||
        (node.depth === victim.depth && node.radiusEnd < victim.radiusEnd) ||
        (node.depth === victim.depth &&
          node.radiusEnd === victim.radiusEnd &&
          node.id > victim.id)
      ) {
        victim = node;
      }
    }
    if (!victim) break;
    alive.delete(victim.id);
    childCount.set(victim.parent, (childCount.get(victim.parent) ?? 1) - 1);
  }

  return nodes.filter((node) => alive.has(node.id));
}

/**
 * Compile a skeleton from a DNA-derived spec.
 *
 * @param {{
 *   habit?: string,
 *   stems?: number,
 *   baseSpread?: number,
 *   height?: number,
 *   heightVariance?: number,
 *   baseRadius?: number,
 *   taper?: number,
 *   curve?: number,
 *   segments?: number,
 *   branch?: {count?: number, angle?: number, twist?: number, depth?: number, falloff?: number},
 *   maxNodes?: number,
 * }} spec
 * @param {{range: Function, next: Function, fork: Function}} rng
 */
export function compileSkeleton(spec = {}, rng) {
  const habit = SKELETON_HABITS.includes(spec.habit) ? spec.habit : "upright";
  const posture = HABIT_POSTURE[habit];
  const stemCount = Math.max(1, Math.round(spec.stems ?? 1));
  const height = Math.max(0.02, spec.height ?? 1);
  const heightVariance = clamp(spec.heightVariance ?? 0.12, 0, 0.9);
  const baseRadius = Math.max(0.002, spec.baseRadius ?? 0.1);
  const taper = clamp(spec.taper ?? 0.55, 0.02, 1.4);
  const curve = clamp(spec.curve ?? 0, 0, 1);
  const baseSpread = Math.max(0, spec.baseSpread ?? 0);
  const segments = Math.max(
    1,
    Math.min(4, Math.round(spec.segments ?? 1 + curve * 3)),
  );
  const branch = spec.branch ?? {};
  const branchCount = Math.max(0, Math.round(branch.count ?? 0));
  const branchAngle = clamp(branch.angle ?? 0.7, 0, 1.5);
  const branchTwist = branch.twist ?? GOLDEN_ANGLE;
  const branchDepth = Math.max(0, Math.round(branch.depth ?? 0));
  const branchFalloff = clamp(branch.falloff ?? 0.68, 0.15, 0.95);
  const budget = Math.max(1, Math.round(spec.maxNodes ?? MAX_SKELETON_NODES));

  const stemRng = rng.fork("skeleton/stems");
  const nodes = [];

  // Stems: each one a short chain, so `curve` can bend it without every
  // archetype having to spend its whole node budget on a single trunk.
  for (let stem = 0; stem < stemCount && nodes.length < GENERATION_CEILING; stem++) {
    const azimuth =
      stemCount === 1
        ? stemRng.range(0, Math.PI * 2)
        : stem * GOLDEN_ANGLE + stemRng.range(-0.14, 0.14);
    const radial = stemCount === 1 ? 0 : Math.sqrt((stem + 0.4) / stemCount) * baseSpread;
    const tiltRoll = posture.tilt + stemRng.range(-posture.spread, posture.spread) * 0.5;
    let direction = deflect([0, 1, 0], Math.max(0, tiltRoll), azimuth);
    let origin = [Math.cos(azimuth) * radial, 0, Math.sin(azimuth) * radial];
    const stemHeight = height * (1 + stemRng.range(-heightVariance, heightVariance));
    const segmentLength = stemHeight / segments;
    let parent = null;
    let radius = baseRadius;

    for (let segment = 0; segment < segments; segment++) {
      const t = (segment + 1) / segments;
      const radiusEnd = baseRadius * (1 - (1 - taper) * t);
      const id = segment === 0 ? `${stem}` : `${parent}/${segment}`;
      nodes.push({
        id,
        parent,
        depth: 0,
        stem,
        segment,
        origin,
        direction,
        length: segmentLength,
        radiusStart: radius,
        radiusEnd,
      });
      origin = tip(nodes[nodes.length - 1]);
      radius = radiusEnd;
      parent = id;
      direction = deflect(
        direction,
        curve * posture.bend * (1 / segments) + stemRng.range(-0.03, 0.03),
        azimuth,
      );
    }
  }

  // Branches: breadth-first, so a budget cut removes the outermost order of
  // branching rather than half of one arbitrary limb.
  let frontier = nodes.filter((node) => node.segment === segments - 1);
  for (let depth = 1; depth <= branchDepth && branchCount > 0; depth++) {
    const depthRng = rng.fork(`skeleton/branch/${depth}`);
    const next = [];
    for (const parentNode of frontier) {
      if (nodes.length >= GENERATION_CEILING) break;
      for (let k = 0; k < branchCount; k++) {
        if (nodes.length >= GENERATION_CEILING) break;
        const azimuth = k * branchTwist + depth * 0.7 + depthRng.range(-0.2, 0.2);
        const angle = branchAngle * depthRng.range(0.78, 1.18);
        const child = {
          id: `${parentNode.id}/b${k}`,
          parent: parentNode.id,
          depth,
          stem: parentNode.stem,
          segment: 0,
          origin: tip(parentNode),
          direction: deflect(parentNode.direction, angle, azimuth),
          length: parentNode.length * branchFalloff * depthRng.range(0.86, 1.14),
          radiusStart: parentNode.radiusEnd,
          radiusEnd: parentNode.radiusEnd * branchFalloff,
        };
        nodes.push(child);
        next.push(child);
      }
    }
    frontier = next;
  }

  const kept = pruneToBudget(nodes, budget);
  const parents = new Set(kept.map((node) => node.parent));
  const graph = kept.map((node) =>
    Object.freeze({
      ...node,
      origin: Object.freeze([...node.origin]),
      direction: Object.freeze([...node.direction]),
      terminal: !parents.has(node.id),
      tip: Object.freeze(tip(node)),
    }),
  );

  let extentY = 0;
  let extentRadial = 0;
  for (const node of graph) {
    for (const point of [node.origin, node.tip]) {
      extentY = Math.max(extentY, point[1]);
      extentRadial = Math.max(extentRadial, Math.hypot(point[0], point[2]));
    }
  }

  return Object.freeze({
    habit,
    nodes: Object.freeze(graph),
    terminals: Object.freeze(graph.filter((node) => node.terminal)),
    extent: Object.freeze({ height: extentY, radius: extentRadial }),
  });
}

export { GOLDEN_ANGLE };
