import * as THREE from "three";
import { applyWindSway } from "../util.js";
import { ARCHETYPES } from "./archetypes.js";
import { buildOrganGeometry } from "./organs.js";
import { compileSkeleton } from "./skeleton.js";
import { createRng } from "./rng.js";

const UP = new THREE.Vector3(0, 1, 0);
const SIDEWAYS = new THREE.Vector3(1, 0, 0);

/** The widest a per-plant organ jitter may scale, used to size bounds. */
const ORGAN_JITTER_CEILING = 1.4;

function makeResourceTracker() {
  const geometries = new Set();
  const materials = new Set();
  let disposed = false;

  return {
    geometry(geometry) {
      geometries.add(geometry);
      return geometry;
    },
    material(material) {
      materials.add(material);
      return material;
    },
    counts() {
      return Object.freeze({
        geometries: geometries.size,
        materials: materials.size,
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}

function makeMaterial(resources, color, {
  wind = 0,
  vertexColors = false,
  // Base white so per-plant tint arrives via instanceColor alone. Used by
  // organ materials: organ geometries bake no color attribute, so enabling
  // vertexColors on them would bind an absent attribute and read GL's
  // generic default (black). instanceColor needs no USE_COLOR in r185.
  instanceTint = false,
  side = THREE.FrontSide,
  roughness = 0.88,
  emissive = 0x000000,
  emissiveIntensity = 0,
} = {}) {
  const material = new THREE.MeshStandardMaterial({
    color: vertexColors || instanceTint ? 0xffffff : color,
    emissive,
    emissiveIntensity,
    roughness,
    metalness: 0,
    flatShading: false,
    vertexColors,
    side,
  });
  material.userData.generatedFlora = true;
  material.userData.windStrength = wind;
  if (wind > 0) applyWindSway(material, wind, { plantRelative: true });
  return resources.material(material);
}

function freezeBounds({
  centerY,
  radius,
  height,
  footprintRadius,
  dynamicMargin = 0,
}) {
  return Object.freeze({
    type: "sphere-with-footprint",
    center: Object.freeze([0, centerY, 0]),
    radius,
    height,
    footprintRadius,
    dynamicMargin,
  });
}


/**
 * Every skeleton segment merged into one tapered tube.
 *
 * The v1 compiler spent a mesh per organ group per plant; a branching plant
 * built that way would spend one per twig. One geometry for the whole
 * structure is what makes an archetype with real branching affordable at all.
 */
function buildStemGeometry(nodes, { radialSegments, baseColor, tipColor, height }) {
  const positions = [];
  const colors = [];
  const indices = [];
  const axis = new THREE.Vector3();
  const sideA = new THREE.Vector3();
  const sideB = new THREE.Vector3();
  const point = new THREE.Vector3();
  const color = new THREE.Color();
  const safeHeight = Math.max(height, 1e-5);

  const pushVertex = (x, y, z) => {
    positions.push(x, y, z);
    color.copy(baseColor).lerp(tipColor, THREE.MathUtils.clamp(y / safeHeight, 0, 1));
    colors.push(color.r, color.g, color.b);
    return positions.length / 3 - 1;
  };

  for (const node of nodes) {
    axis.set(node.direction[0], node.direction[1], node.direction[2]);
    sideA.copy(Math.abs(axis.y) < 0.9 ? UP : SIDEWAYS).cross(axis).normalize();
    sideB.copy(axis).cross(sideA).normalize();

    const ringStart = positions.length / 3;
    for (const [t, radius] of [[0, node.radiusStart], [1, node.radiusEnd]]) {
      for (let step = 0; step < radialSegments; step++) {
        const angle = (step / radialSegments) * Math.PI * 2;
        point
          .set(node.origin[0], node.origin[1], node.origin[2])
          .addScaledVector(axis, node.length * t)
          .addScaledVector(sideA, Math.cos(angle) * radius)
          .addScaledVector(sideB, Math.sin(angle) * radius);
        pushVertex(point.x, point.y, point.z);
      }
    }
    for (let step = 0; step < radialSegments; step++) {
      const a = ringStart + step;
      const b = ringStart + ((step + 1) % radialSegments);
      const c = a + radialSegments;
      const d = b + radialSegments;
      indices.push(a, c, b, b, c, d);
    }

    // Close the ends that would otherwise show as holes: the ground contact
    // and any twig tip an organ does not cover.
    if (node.terminal) {
      point
        .set(node.origin[0], node.origin[1], node.origin[2])
        .addScaledVector(axis, node.length);
      const centre = pushVertex(point.x, point.y, point.z);
      for (let step = 0; step < radialSegments; step++) {
        indices.push(
          ringStart + radialSegments + step,
          centre,
          ringStart + radialSegments + ((step + 1) % radialSegments),
        );
      }
    }
    if (node.parent === null) {
      const centre = pushVertex(node.origin[0], node.origin[1], node.origin[2]);
      for (let step = 0; step < radialSegments; step++) {
        indices.push(
          ringStart + ((step + 1) % radialSegments),
          centre,
          ringStart + step,
        );
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

const AFFORDANCE_BUILDERS = Object.freeze({
  landmark: (metrics) => [{
    type: "landmark",
    position: [0, metrics.height * 0.5, 0],
    radius: Math.max(0.2, metrics.radius * 0.7),
    capacity: 1,
  }],
  perch: (metrics) => [{
    type: "perch",
    position: [0, metrics.height, 0],
    radius: Math.max(0.15, metrics.radius * 0.45),
    capacity: Math.max(1, Math.round(metrics.radius)),
  }],
  shelter: (metrics) => [{
    type: "shelter",
    position: [0, metrics.height * 0.14, 0],
    radius: Math.max(0.2, metrics.radius * 0.72),
    capacity: 3,
  }],
  forage: (metrics) => [{
    type: "forage",
    position: [0, metrics.height * 0.35, 0],
    radius: Math.max(0.2, metrics.radius),
    capacity: Math.max(1, Math.round(metrics.radius * 2)),
  }],
  "soft-cover": (metrics) => [{
    type: "soft-cover",
    position: [0, metrics.height * 0.5, 0],
    radius: Math.max(0.15, metrics.radius * 0.82),
    capacity: Math.max(1, Math.round(metrics.radius)),
  }],
  // Nectar is the one affordance that is per-organ rather than per-plant: a
  // pollinator visits one bloom, not a cluster.
  nectar: (metrics, layout) => {
    const blooms = layout.bloom ?? [];
    if (blooms.length === 0) {
      return [{
        type: "nectar",
        position: [0, metrics.height * 0.7, 0],
        radius: Math.max(0.1, metrics.radius * 0.4),
        capacity: 1,
      }];
    }
    return blooms.map((bloom) => ({
      type: "nectar",
      position: [...bloom.position],
      radius: Math.max(0.06, metrics.organReach * 1.2),
      capacity: 1,
    }));
  },
  pollen: (metrics, layout) => [{
    type: "pollen",
    position: [0, metrics.height * 0.72, 0],
    radius: Math.max(0.2, metrics.radius),
    capacity: Math.max(1, (layout.bloom ?? []).length),
  }],
});

function buildAffordances(types, metrics, layout) {
  const out = [];
  for (const type of types) {
    const builder = AFFORDANCE_BUILDERS[type];
    if (!builder) continue;
    out.push(...builder(metrics, layout));
  }
  return out;
}


const EMPTY_SKELETON = Object.freeze({
  habit: "creeping",
  nodes: Object.freeze([]),
  terminals: Object.freeze([]),
  extent: Object.freeze({ height: 0, radius: 0 }),
});

const scratchPosition = new THREE.Vector3();
const scratchDirection = new THREE.Vector3();
const scratchScale = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchRoll = new THREE.Quaternion();

/**
 * Turn an archetype placement — a position plus the direction its local +Y
 * should point — into a matrix, written into `target`.
 */
export function composePlacement(target, placement) {
  scratchPosition.set(...placement.position);
  scratchDirection.set(...placement.dir);
  if (scratchDirection.lengthSq() < 1e-10) scratchDirection.copy(UP);
  scratchDirection.normalize();
  scratchQuaternion.setFromUnitVectors(UP, scratchDirection);
  scratchRoll.setFromAxisAngle(UP, placement.roll ?? 0);
  scratchQuaternion.multiply(scratchRoll);
  scratchScale.set(...placement.scale);
  return target.compose(scratchPosition, scratchQuaternion, scratchScale);
}

/**
 * Compile one normalized DNA object into the shared GPU resources a species
 * batch needs: a small set of structural variants, one merged stem geometry
 * per variant, and one geometry plus material per organ type.
 *
 * Nothing here creates a mesh. Batching owns that (`batch.js`), because a
 * plant is a row now rather than a group — see that module's header for why
 * the touch pose moved into the vertex shader.
 *
 * @param {object} dna normalized FloraDNA (v2)
 * @param {Record<string, THREE.Color>} colors resolved palette slots
 * @param {{variantCount?: number}} [options]
 */
/**
 * How wide the plant actually is at the height something walks into it.
 *
 * Collision was sized from the bounds radius, which includes the crown — a
 * canopy hero got 5.77, so kin were held nearly seven units from a trunk and
 * could never walk under a tree. The structure below knee height is the part
 * you can actually bump into.
 */
const TRUNK_PROBE_HEIGHT = 1.3;

function trunkRadiusOf(skeleton) {
  let radius = 0;
  for (const node of skeleton.nodes) {
    for (const point of [node.origin, node.tip]) {
      if (point[1] > TRUNK_PROBE_HEIGHT) continue;
      radius = Math.max(
        radius,
        Math.hypot(point[0], point[2]) + Math.max(node.radiusStart, node.radiusEnd),
      );
    }
  }
  return radius;
}

export function compileArchetype(dna, colors, { variantCount = 1 } = {}) {
  const archetype = ARCHETYPES[dna.archetype];
  if (!archetype) {
    throw new Error(`unsupported generated-flora archetype: ${dna.archetype}`);
  }
  const resources = makeResourceTracker();
  const shape = dna.shape;
  const speciesRng = createRng(dna.seed);
  const skeletonSpec = archetype.skeleton(shape);
  const variantTotal = Math.max(1, Math.round(variantCount));

  // Structural variants: a bounded set of skeletons compiled once and reused
  // across the field, so plants of a species differ without any of them
  // owning a buffer. Each variant is its own batch, so an unused variant
  // costs nothing rather than a pool of zero-scaled rows.
  const variants = [];
  for (let index = 0; index < variantTotal; index++) {
    const skeleton = skeletonSpec
      ? compileSkeleton(skeletonSpec, speciesRng.fork(`skeleton/${index}`))
      : EMPTY_SKELETON;
    variants.push({
      index,
      skeleton,
      stemGeometry: null,
      organGeometries: new Map(),
      strides: {},
    });
  }

  const stemMaterial = skeletonSpec
    ? makeMaterial(resources, colors.structure, {
        wind: dna.motion.wind * 0.5,
        vertexColors: true,
        roughness: 0.9,
      })
    : null;
  for (const variant of variants) {
    if (variant.skeleton.nodes.length === 0) continue;
    variant.stemGeometry = resources.geometry(
      buildStemGeometry(variant.skeleton.nodes, {
        radialSegments: dna.role === "hero" ? 9 : 6,
        baseColor: colors.structure,
        tipColor: colors.detail ?? colors.structure,
        height: Math.max(variant.skeleton.extent.height, 1e-4),
      }),
    );
  }

  const organPlans = archetype.organs(shape).map((plan) => ({
    key: plan.key,
    type: plan.type,
    reach: plan.reach ?? 0,
    // Detail organs are the ones a plant can lose at distance without
    // changing its silhouette. Declared, not inferred from size: a
    // groundcover blade is small and still load-bearing for how the far side
    // of the island reads.
    lod: plan.lod === true,
    colorSlot: plan.material.colorSlot,
    vertexColors: plan.material.vertexColors ?? false,
    bloom: plan.material.bloom ?? false,
    params: plan.params,
    material: makeMaterial(resources, colors[plan.material.colorSlot], {
      wind: dna.motion.wind * (plan.material.wind ?? 1),
      instanceTint: plan.material.vertexColors ?? false,
      side: plan.material.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
      roughness: plan.material.roughness ?? 0.88,
      emissive: plan.material.emissiveSlot ? colors[plan.material.emissiveSlot] : 0x000000,
      emissiveIntensity: plan.material.emissiveIntensity ?? 0,
    }),
  }));

  // Row strides. Organ counts follow from the shape and the variant's node
  // count, never from the per-plant roll, so one sample layout per variant
  // measures them exactly.
  //
  // The geometry is rebuilt per variant even though its parameters do not
  // vary: each batch carries per-plant instanced attributes on its geometry,
  // so two batches sharing one would overwrite each other's plant lookup.
  for (const variant of variants) {
    const sample = archetype.layout(
      shape,
      variant.skeleton,
      createRng(`${dna.seed}/stride/${variant.index}`),
    );
    for (const plan of organPlans) {
      const stride = (sample[plan.key] ?? []).length;
      variant.strides[plan.key] = stride;
      if (stride === 0) continue;
      variant.organGeometries.set(
        plan.key,
        resources.geometry(buildOrganGeometry(plan.type, plan.params)),
      );
    }
  }

  const organReach = organPlans.reduce((max, plan) => Math.max(max, plan.reach), 0);
  const spread = archetype.spread ? archetype.spread(shape) : 0;
  const extentHeight = Math.max(...variants.map((v) => v.skeleton.extent.height));
  const extentRadius = Math.max(...variants.map((v) => v.skeleton.extent.radius));
  const totalHeight = extentHeight + organReach * ORGAN_JITTER_CEILING;
  const staticFootprint = Math.max(
    extentRadius + organReach * ORGAN_JITTER_CEILING,
    spread,
    0.05,
  );
  const dynamicMargin =
    totalHeight * Math.sin(dna.motion.maxLean + dna.variation.lean);
  const metrics = Object.freeze({
    height: Math.max(totalHeight, 0.02),
    radius: staticFootprint,
    organReach,
    // What a creature can walk into, as opposed to what the plant occupies.
    trunkRadius: Math.max(
      ...variants.map((variant) => trunkRadiusOf(variant.skeleton)),
      0,
    ),
  });
  const bounds = freezeBounds({
    centerY: metrics.height * 0.5,
    radius: Math.hypot(staticFootprint, metrics.height * 0.5) + dynamicMargin,
    height: metrics.height,
    footprintRadius: staticFootprint + dynamicMargin,
    dynamicMargin,
  });

  const layoutFor = (variantIndex, rng) =>
    archetype.layout(shape, variants[variantIndex].skeleton, rng);

  // The schema is what the affordance registry and the relations panel read;
  // it must match the types the per-plant affordance list actually emits.
  const affordanceSchema = Object.freeze([
    ...new Set(
      buildAffordances(
        archetype.affordances,
        metrics,
        layoutFor(0, createRng(`${dna.seed}/schema`)),
      ).map((entry) => entry.type),
    ),
  ]);

  return {
    archetype: archetype.key,
    role: dna.role,
    bounds,
    metrics,
    affordanceSchema,
    variants,
    organPlans,
    stemMaterial,
    layoutFor,
    affordancesFor: (layout) =>
      buildAffordances(archetype.affordances, metrics, layout),
    resourceCounts: resources.counts(),
    dispose: () => resources.dispose(),
  };
}
