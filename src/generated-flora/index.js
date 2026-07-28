import * as THREE from "three";
import { state } from "../state.js";
import { LOWFX } from "../lowfx.js";
import { BLOOM_LAYER } from "../postfx.js";
import {
  FLORA_ARCHETYPES,
  FLORA_DNA_VERSION,
  FLORA_ROLES,
  PALETTE_ROLES,
  normalizeFloraDNA,
} from "./dna.js";
import {
  deriveBiomePalette,
  resolveSpeciesColors,
  varyColor,
} from "./palette.js";
import {
  createRng,
  hashSeed,
  seedToUint32,
  stableStringify,
} from "./rng.js";
import { createTouchEnvelope } from "./touch.js";
import { compileArchetype, composePlacement } from "./renderers.js";
import {
  FLORA_VIEWER,
  applyTouchBend,
  createBatch,
  createTouchField,
} from "./batch.js";

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * How many structural variants a species compiles.
 *
 * Each variant is its own batch, so the number is a draw-call budget as much
 * as a variety budget. Heroes get one because a field plants exactly one of
 * them — a second hero variant would be an empty batch.
 */
const VARIANTS_BY_ROLE = Object.freeze({ hero: 1, mid: 3, ground: 3 });

/** How hard a touched plant squashes, per tier. Matches the old pivot pose. */
const SQUASH_BY_ROLE = Object.freeze({ hero: 0.035, mid: 0.055, ground: 0.18 });

/** Organs smaller than this collapse at distance instead of being drawn. */
const LOD_ORGAN_REACH = 0.35;
const LOD_DISTANCE = LOWFX ? 32 : 60;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function setPosition(target, value) {
  if (Array.isArray(value)) {
    target.set(finite(value[0]), finite(value[1]), finite(value[2]));
    return;
  }
  if (isRecord(value)) {
    target.set(finite(value.x), finite(value.y), finite(value.z));
  }
}

function setScale(target, value, fallback) {
  if (typeof value === "number") {
    target.setScalar(Math.max(0.001, finite(value, fallback)));
    return;
  }
  if (Array.isArray(value)) {
    target.set(
      Math.max(0.001, finite(value[0], fallback)),
      Math.max(0.001, finite(value[1], fallback)),
      Math.max(0.001, finite(value[2], fallback)),
    );
    return;
  }
  if (isRecord(value)) {
    target.set(
      Math.max(0.001, finite(value.x, fallback)),
      Math.max(0.001, finite(value.y, fallback)),
      Math.max(0.001, finite(value.z, fallback)),
    );
    return;
  }
  target.setScalar(fallback);
}

function cloneAffordances(affordances) {
  return Object.freeze(
    affordances.map((affordance) =>
      Object.freeze({
        ...affordance,
        position: Object.freeze([...affordance.position]),
      }),
    ),
  );
}

/**
 * A pool of row slots inside one variant's batches. Disposing a plant returns
 * its slot, so a long-lived field that plants and clears repeatedly does not
 * grow its batches without bound.
 */
function makeSlotPool() {
  const free = [];
  let next = 0;
  return {
    take: () => (free.length > 0 ? free.pop() : next++),
    give: (slot) => free.push(slot),
    get high() {
      return next;
    },
  };
}

/**
 * Compile permissive AI-authored FloraDNA into one species.
 *
 * Geometry, materials and batches are allocated once here and shared by every
 * plant. A plant is a row in those batches plus an empty `THREE.Group` that
 * carries its transform — the group is what the host world parents, raycasts
 * and positions, exactly as before; it simply no longer holds meshes.
 *
 * @param {unknown} rawDNA
 * @param {{biome?: object, palette?: object, seed?: unknown, variantCount?: number}} [options]
 */
export function buildSpecies(rawDNA, options = {}) {
  const input = isRecord(rawDNA) ? rawDNA : {};
  const normalizedInput =
    options.seed === undefined ? input : { ...input, seed: options.seed };
  const { dna, notes } = normalizeFloraDNA(normalizedInput);
  const palette = deriveBiomePalette(options.biome, options.palette);
  const colors = resolveSpeciesColors(dna, palette);
  const variantCount = Math.max(
    1,
    Math.round(
      options.variantCount ??
        (LOWFX
          ? Math.ceil(VARIANTS_BY_ROLE[dna.role] / 2)
          : VARIANTS_BY_ROLE[dna.role]),
    ),
  );
  const compiled = compileArchetype(dna, colors, { variantCount });
  const digest = hashSeed("generated-flora", dna, palette)
    .toString(16)
    .padStart(8, "0");
  const id = `flora:${dna.archetype}:${digest}`;

  const batchRoot = new THREE.Group();
  batchRoot.name = `generated-flora-batches:${id}`;
  const touchField = createTouchField();
  const squash = SQUASH_BY_ROLE[dna.role] ?? 0.05;

  const bendMaterial = (material, reach) =>
    applyTouchBend(material, {
      field: touchField,
      maxLean: dna.motion.maxLean,
      squash,
      lodDistance: reach > 0 && reach < LOD_ORGAN_REACH ? LOD_DISTANCE : 0,
      viewer: FLORA_VIEWER,
    });

  if (compiled.stemMaterial) bendMaterial(compiled.stemMaterial, 0);
  for (const plan of compiled.organPlans) bendMaterial(plan.material, plan.reach);

  // One batch set per structural variant. Batches are compact — a plant only
  // ever occupies rows in the variant it actually wears — so an unused
  // variant costs an empty draw, not a pool of degenerate rows.
  const variantStates = compiled.variants.map((variant) => {
    const batches = new Map();
    if (variant.stemGeometry) {
      const batch = createBatch({
        name: `${id}:stem:${variant.index}`,
        geometry: variant.stemGeometry,
        material: compiled.stemMaterial,
        stride: 1,
      });
      batch.mesh.castShadow = dna.role !== "ground";
      batch.attachTo(batchRoot);
      batches.set("__stem", batch);
    }
    for (const plan of compiled.organPlans) {
      const stride = variant.strides[plan.key] ?? 0;
      const geometry = variant.organGeometries.get(plan.key);
      if (stride === 0 || !geometry) continue;
      const batch = createBatch({
        name: `${id}:${plan.key}:${variant.index}`,
        geometry,
        material: plan.material,
        stride,
      });
      batch.mesh.castShadow = dna.role === "hero" && plan.reach > 0.25;
      if (plan.bloom) batch.mesh.layers.enable(BLOOM_LAYER);
      batch.attachTo(batchRoot);
      batches.set(plan.key, batch);
    }
    return { variant, batches, slots: makeSlotPool() };
  });

  const instances = new Set();
  const plantSlots = makeSlotPool();
  let nextOrdinal = 0;
  let disposed = false;

  const rowMatrix = new THREE.Matrix4();
  const placementMatrix = new THREE.Matrix4();
  const restMatrix = new THREE.Matrix4();
  const basePoint = new THREE.Vector3();

  function buildInstance(instanceOptions, instanceId, rng) {
    const variantIndex = rng.fork("variant").int(0, variantStates.length - 1);
    const variantState = variantStates[variantIndex];
    const slot = variantState.slots.take();
    const plantIndex = plantSlots.take();
    touchField.ensureCapacity(plantIndex + 1);

    const group = new THREE.Group();
    group.name = `generated-flora:${dna.role}:${instanceId}`;
    setPosition(group.position, instanceOptions.position);
    group.rotation.y = Number.isFinite(instanceOptions.rotationY)
      ? instanceOptions.rotationY
      : rng.fork("placement-yaw").range(0, Math.PI * 2);
    setScale(
      group.scale,
      instanceOptions.scale,
      rng.fork("placement-scale").range(dna.variation.scaleMin, dna.variation.scaleMax),
    );

    // Rest lean is static, so it is folded into the row rather than kept as a
    // pivot. Groundcover has none, the same exception the pivot pose made.
    const restRng = rng.fork("touch");
    const restAngle = restRng.range(0, Math.PI * 2);
    const restLean = dna.role === "ground" ? 0 : dna.variation.lean;
    restMatrix.makeRotationFromEuler(
      new THREE.Euler(
        Math.cos(restAngle) * restLean,
        0,
        Math.sin(restAngle) * restLean,
      ),
    );

    const fallbackAngle = restRng.range(0, Math.PI * 2);
    const envelope = createTouchEnvelope({
      strength: dna.motion.touchStrength,
      stiffness: dna.motion.touchStiffness,
      damping: dna.motion.touchDamping,
      maxValue: 0.75,
      fallbackDirection: { x: Math.cos(fallbackAngle), z: Math.sin(fallbackAngle) },
    });

    const layout = compiled.layoutFor(variantIndex, rng.fork("layout"));
    const colorRng = rng.fork("organ-color");
    const localAffordances = cloneAffordances(compiled.affordancesFor(layout));

    let lastMatrix = null;

    const writeRows = () => {
      group.updateMatrix();
      basePoint.setFromMatrixPosition(group.matrix);
      for (const [key, batch] of variantState.batches) {
        batch.ensureCapacity(variantState.slots.high);
        batch.setActivePlants(variantState.slots.high);
        const start = batch.rowsFor(slot);
        if (key === "__stem") {
          rowMatrix.multiplyMatrices(group.matrix, restMatrix);
          batch.setRow(start, rowMatrix, plantIndex, basePoint);
        } else {
          const placements = layout[key] ?? [];
          for (let index = 0; index < batch.stride; index++) {
            const placement = placements[index];
            if (!placement) {
              batch.clearRow(start + index);
              continue;
            }
            composePlacement(placementMatrix, placement);
            rowMatrix
              .multiplyMatrices(group.matrix, restMatrix)
              .multiply(placementMatrix);
            batch.setRow(start + index, rowMatrix, plantIndex, basePoint);
          }
        }
        batch.flush();
      }
      lastMatrix = group.matrix.clone();
    };

    const writeColors = () => {
      for (const plan of compiled.organPlans) {
        if (!plan.vertexColors) continue;
        const batch = variantState.batches.get(plan.key);
        if (!batch) continue;
        const placements = layout[plan.key] ?? [];
        const start = batch.rowsFor(slot);
        for (let index = 0; index < batch.stride; index++) {
          const placement = placements[index];
          if (!placement) continue;
          batch.setColor(
            start + index,
            varyColor(
              colors[placement.color] ?? colors[plan.colorSlot],
              colorRng.range(-1, 1),
              0.06,
            ),
          );
        }
        batch.flush();
      }
    };

    writeRows();
    writeColors();
    touchField.write(plantIndex, 0, 0, 0, 0);

    const publishTouch = (snapshot) => {
      touchField.write(
        plantIndex,
        snapshot.direction.x,
        snapshot.direction.z,
        snapshot.value,
        Math.min(Math.abs(snapshot.value), 0.6),
      );
      return snapshot;
    };

    const clearRows = () => {
      for (const batch of variantState.batches.values()) {
        const start = batch.rowsFor(slot);
        for (let index = 0; index < batch.stride; index++) {
          batch.clearRow(start + index);
        }
        batch.flush();
      }
    };

    return {
      group,
      variantIndex,
      plantIndex,
      localAffordances,
      envelope,
      publishTouch,
      clearRows,
      release() {
        variantState.slots.give(slot);
        plantSlots.give(plantIndex);
      },
      syncTransform() {
        group.updateMatrix();
        if (lastMatrix && lastMatrix.equals(group.matrix)) return false;
        writeRows();
        return true;
      },
    };
  }

  function buildInstanceApi({ instanceId, instanceOptions, rng, onDispose }) {
    const built = buildInstance(instanceOptions, instanceId, rng);
    const group = built.group;
    let instanceDisposed = false;

    const getWorldBounds = (target = new THREE.Sphere()) => {
      group.updateWorldMatrix(true, false);
      const center = new THREE.Vector3(...compiled.bounds.center);
      group.localToWorld(center);
      const worldScale = new THREE.Vector3();
      group.getWorldScale(worldScale);
      target.center.copy(center);
      target.radius =
        compiled.bounds.radius *
        Math.max(Math.abs(worldScale.x), Math.abs(worldScale.y), Math.abs(worldScale.z));
      return target;
    };

    const getWorldAffordances = () => {
      group.updateWorldMatrix(true, false);
      const worldScale = new THREE.Vector3();
      group.getWorldScale(worldScale);
      const radiusScale = Math.max(
        Math.abs(worldScale.x),
        Math.abs(worldScale.y),
        Math.abs(worldScale.z),
      );
      return built.localAffordances.map((affordance) => {
        const position = new THREE.Vector3(...affordance.position);
        group.localToWorld(position);
        return {
          ...affordance,
          space: "world",
          position,
          radius: affordance.radius * radiusScale,
        };
      });
    };

    const api = {
      speciesId: id,
      instanceId,
      role: dna.role,
      archetype: dna.archetype,
      variantIndex: built.variantIndex,
      plantIndex: built.plantIndex,
      group,
      localBounds: compiled.bounds,
      affordances: built.localAffordances,
      touch(amount = 1, direction) {
        if (instanceDisposed) return built.envelope.snapshot();
        return built.publishTouch(built.envelope.trigger(amount, direction));
      },
      /**
       * Steps the touch spring and republishes it. Also picks up a change to
       * the plant's own transform — the host aligns a plant to the surface
       * after creating it, and a row that is not rewritten would leave the
       * plant drawn at its pre-alignment pose.
       */
      update(dt) {
        if (instanceDisposed) return built.envelope.snapshot();
        built.syncTransform();
        return built.publishTouch(built.envelope.update(dt));
      },
      resetTouch() {
        if (instanceDisposed) return built.envelope.snapshot();
        return built.publishTouch(built.envelope.reset());
      },
      touchState() {
        return built.envelope.snapshot();
      },
      getWorldBounds,
      getWorldAffordances,
      dispose() {
        if (instanceDisposed) return;
        instanceDisposed = true;
        built.clearRows();
        built.release();
        group.removeFromParent();
        group.clear();
        onDispose(api);
      },
    };

    Object.defineProperty(api, "disposed", {
      enumerable: true,
      get: () => instanceDisposed,
    });

    group.userData.generatedFlora = {
      speciesId: id,
      instanceId,
      role: dna.role,
      archetype: dna.archetype,
      bounds: compiled.bounds,
      affordances: built.localAffordances,
    };
    return Object.freeze(api);
  }

  const species = {
    id,
    name: dna.name,
    role: dna.role,
    archetype: dna.archetype,
    variantCount: variantStates.length,
    /** The batches every plant of this species draws from. Parent this once. */
    batchRoot,
    skeletons: Object.freeze(compiled.variants.map((variant) => variant.skeleton)),
    dna,
    notes: Object.freeze([...notes]),
    palette,
    bounds: compiled.bounds,
    affordanceSchema: compiled.affordanceSchema,
    resourceCounts: compiled.resourceCounts,
    windUniforms: state.windUniforms,
    /** Every batch mesh, in a stable order — the draw-call surface. */
    batchMeshes() {
      const meshes = [];
      for (const variantState of variantStates) {
        for (const batch of variantState.batches.values()) meshes.push(batch.mesh);
      }
      return meshes;
    },
    createInstance(instanceOptions = {}) {
      if (disposed) {
        throw new Error(`generated-flora species "${id}" has been disposed`);
      }
      const safeOptions = isRecord(instanceOptions) ? instanceOptions : {};
      const ordinal = nextOrdinal++;
      const semanticKey = safeOptions.id ?? safeOptions.seed ?? ordinal;
      const instanceSeed = hashSeed(
        "generated-flora-instance",
        dna.seed,
        id,
        semanticKey,
      );
      const instanceId =
        safeOptions.id === undefined
          ? `${id}:${ordinal}`
          : `${id}:${stableStringify(safeOptions.id)}`;
      const instance = buildInstanceApi({
        instanceId,
        instanceOptions: safeOptions,
        rng: createRng(instanceSeed),
        onDispose: (entry) => instances.delete(entry),
      });
      instances.add(instance);
      return instance;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const instance of [...instances]) instance.dispose();
      for (const variantState of variantStates) {
        for (const batch of variantState.batches.values()) batch.dispose();
      }
      batchRoot.removeFromParent();
      touchField.dispose();
      compiled.dispose();
    },
  };

  Object.defineProperties(species, {
    disposed: {
      enumerable: true,
      get: () => disposed,
    },
    instanceCount: {
      enumerable: true,
      get: () => instances.size,
    },
  });

  return Object.freeze(species);
}

export {
  FLORA_ARCHETYPES,
  FLORA_DNA_VERSION,
  FLORA_ROLES,
  FLORA_VIEWER,
  PALETTE_ROLES,
  createRng,
  createTouchEnvelope,
  deriveBiomePalette,
  hashSeed,
  normalizeFloraDNA,
  resolveSpeciesColors,
  seedToUint32,
  stableStringify,
  varyColor,
};
