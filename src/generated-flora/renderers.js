import * as THREE from "three";
import { applyWindSway } from "../util.js";
import { BLOOM_LAYER } from "../postfx.js";
import { ARCHETYPES } from "./archetypes.js";
import { buildOrganGeometry } from "./organs.js";
import { compileSkeleton } from "./skeleton.js";
import { createRng } from "./rng.js";
import { createTouchEnvelope } from "./touch.js";
import { varyColor } from "./palette.js";

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
  side = THREE.FrontSide,
  roughness = 0.88,
  emissive = 0x000000,
  emissiveIntensity = 0,
} = {}) {
  const material = new THREE.MeshStandardMaterial({
    color: vertexColors ? 0xffffff : color,
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
  if (wind > 0) applyWindSway(material, wind);
  return resources.material(material);
}

function setMeshPresentation(object, { castShadow = false, receiveShadow = true } = {}) {
  object.castShadow = castShadow;
  object.receiveShadow = receiveShadow;
  return object;
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
 * Rest lean, touch pivots and the touch envelope. Unchanged from the v1
 * compiler on purpose: the `{value, velocity, direction, active, max}`
 * snapshot this returns is what the observatory's resonance trace reads, and
 * the bridge in `living-world/runtime.js` passes it straight through.
 */
function createAnimatedRoot(dna, rng, mode) {
  const group = new THREE.Group();
  const restPivot = new THREE.Group();
  const touchPivot = new THREE.Group();
  group.add(restPivot);
  restPivot.add(touchPivot);

  const restAngle = rng.range(0, Math.PI * 2);
  const restLean = mode === "ground" ? 0 : dna.variation.lean;
  restPivot.rotation.x = Math.cos(restAngle) * restLean;
  restPivot.rotation.z = Math.sin(restAngle) * restLean;

  const fallbackAngle = rng.range(0, Math.PI * 2);
  const envelope = createTouchEnvelope({
    strength: dna.motion.touchStrength,
    stiffness: dna.motion.touchStiffness,
    damping: dna.motion.touchDamping,
    maxValue: 0.75,
    fallbackDirection: {
      x: Math.cos(fallbackAngle),
      z: Math.sin(fallbackAngle),
    },
  });

  const applyPose = (snapshot) => {
    const lean = snapshot.value * dna.motion.maxLean;
    touchPivot.rotation.x = snapshot.direction.z * lean;
    touchPivot.rotation.z = -snapshot.direction.x * lean;
    const impact = Math.min(Math.abs(snapshot.value), 0.6);
    if (mode === "ground") {
      touchPivot.scale.set(1 + impact * 0.07, 1 - impact * 0.18, 1 + impact * 0.07);
    } else if (mode === "mid") {
      touchPivot.scale.set(1 + impact * 0.025, 1 - impact * 0.055, 1 + impact * 0.025);
    } else {
      touchPivot.scale.set(1 + impact * 0.012, 1 - impact * 0.035, 1 + impact * 0.012);
    }
  };

  return {
    group,
    content: touchPivot,
    touch(amount, direction) {
      return envelope.trigger(amount, direction);
    },
    update(dt) {
      const snapshot = envelope.update(dt);
      applyPose(snapshot);
      return snapshot;
    },
    resetTouch() {
      const snapshot = envelope.reset();
      applyPose(snapshot);
      return snapshot;
    },
    touchState() {
      return envelope.snapshot();
    },
  };
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

const scratchPosition = new THREE.Vector3();
const scratchDirection = new THREE.Vector3();
const scratchScale = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchRoll = new THREE.Quaternion();
const scratchMatrix = new THREE.Matrix4();

function writePlacement(mesh, index, placement) {
  scratchPosition.set(...placement.position);
  scratchDirection.set(...placement.dir);
  if (scratchDirection.lengthSq() < 1e-10) scratchDirection.copy(UP);
  scratchDirection.normalize();
  scratchQuaternion.setFromUnitVectors(UP, scratchDirection);
  scratchRoll.setFromAxisAngle(UP, placement.roll ?? 0);
  scratchQuaternion.multiply(scratchRoll);
  scratchScale.set(...placement.scale);
  mesh.setMatrixAt(
    index,
    scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale),
  );
}

/**
 * Compile one normalized DNA object into immutable shared GPU resources plus
 * an archetype-driven instance factory.
 *
 * Geometry is species-level: one merged stem plus one geometry per organ
 * type. Per-plant variation lives in the instance matrices written in
 * `create`, so two plants of a species differ without either owning a buffer.
 *
 * @param {object} dna normalized FloraDNA (v2)
 * @param {Record<string, THREE.Color>} colors resolved palette slots
 */
export function compileArchetype(dna, colors) {
  const archetype = ARCHETYPES[dna.archetype];
  if (!archetype) {
    throw new Error(`unsupported generated-flora archetype: ${dna.archetype}`);
  }
  const resources = makeResourceTracker();
  const shape = dna.shape;
  const speciesRng = createRng(dna.seed);

  const skeletonSpec = archetype.skeleton(shape);
  const skeleton = skeletonSpec
    ? compileSkeleton(skeletonSpec, speciesRng.fork("skeleton"))
    : Object.freeze({
        habit: archetype.habit,
        nodes: Object.freeze([]),
        terminals: Object.freeze([]),
        extent: Object.freeze({ height: 0, radius: 0 }),
      });

  const stem = skeleton.nodes.length > 0
    ? {
        geometry: resources.geometry(
          buildStemGeometry(skeleton.nodes, {
            radialSegments: dna.role === "hero" ? 9 : 6,
            baseColor: colors.structure,
            tipColor: colors.detail ?? colors.structure,
            height: Math.max(skeleton.extent.height, 1e-4),
          }),
        ),
        material: makeMaterial(resources, colors.structure, {
          wind: dna.motion.wind * 0.5,
          vertexColors: true,
          roughness: 0.9,
        }),
      }
    : null;

  const organPlans = archetype.organs(shape).map((plan) => ({
    ...plan,
    geometry: resources.geometry(buildOrganGeometry(plan.type, plan.params)),
    threeMaterial: makeMaterial(resources, colors[plan.material.colorSlot], {
      wind: dna.motion.wind * (plan.material.wind ?? 1),
      vertexColors: plan.material.vertexColors ?? false,
      side: plan.material.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
      roughness: plan.material.roughness ?? 0.88,
      emissive: plan.material.emissiveSlot
        ? colors[plan.material.emissiveSlot]
        : 0x000000,
      emissiveIntensity: plan.material.emissiveIntensity ?? 0,
    }),
  }));

  const organReach = organPlans.reduce(
    (max, plan) => Math.max(max, plan.reach ?? 0),
    0,
  );
  const spread = archetype.spread ? archetype.spread(shape) : 0;
  const totalHeight = skeleton.extent.height + organReach * ORGAN_JITTER_CEILING;
  const staticFootprint = Math.max(
    skeleton.extent.radius + organReach * ORGAN_JITTER_CEILING,
    spread,
    0.05,
  );
  const dynamicMargin =
    totalHeight * Math.sin(dna.motion.maxLean + dna.variation.lean);
  const metrics = Object.freeze({
    height: Math.max(totalHeight, 0.02),
    radius: staticFootprint,
    organReach,
  });
  const bounds = freezeBounds({
    centerY: metrics.height * 0.5,
    radius:
      Math.hypot(staticFootprint, metrics.height * 0.5) + dynamicMargin,
    height: metrics.height,
    footprintRadius: staticFootprint + dynamicMargin,
    dynamicMargin,
  });

  // The schema is what the affordance registry and the relations panel read;
  // it must match the types `create` actually emits.
  const schemaSample = buildAffordances(
    archetype.affordances,
    metrics,
    archetype.layout(shape, skeleton, createRng(dna.seed).fork("schema")),
  );
  const affordanceSchema = Object.freeze([
    ...new Set(schemaSample.map((entry) => entry.type)),
  ]);

  return {
    archetype: archetype.key,
    bounds,
    affordanceSchema,
    skeleton,
    resourceCounts: resources.counts(),
    dispose: () => resources.dispose(),
    create(rng) {
      const animated = createAnimatedRoot(dna, rng.fork("touch"), dna.role);
      const content = animated.content;
      const layout = archetype.layout(shape, skeleton, rng.fork("layout"));

      if (stem) {
        content.add(
          setMeshPresentation(new THREE.Mesh(stem.geometry, stem.material), {
            castShadow: dna.role !== "ground",
          }),
        );
      }

      const colorRng = rng.fork("organ-color");
      for (const plan of organPlans) {
        const placements = layout[plan.key] ?? [];
        if (placements.length === 0) continue;
        const mesh = setMeshPresentation(
          new THREE.InstancedMesh(
            plan.geometry,
            plan.threeMaterial,
            placements.length,
          ),
          { castShadow: dna.role === "hero" && plan.reach > 0.25 },
        );
        for (let index = 0; index < placements.length; index++) {
          const placement = placements[index];
          writePlacement(mesh, index, placement);
          if (plan.material.vertexColors) {
            mesh.setColorAt(
              index,
              varyColor(
                colors[placement.color] ?? colors[plan.material.colorSlot],
                colorRng.range(-1, 1),
                0.06,
              ),
            );
          }
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        if (plan.material.bloom) mesh.layers.enable(BLOOM_LAYER);
        content.add(mesh);
      }

      return {
        ...animated,
        affordances: buildAffordances(archetype.affordances, metrics, layout),
      };
    },
  };
}
