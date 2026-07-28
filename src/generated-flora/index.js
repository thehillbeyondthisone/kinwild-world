import * as THREE from "three";
import { state } from "../state.js";
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
import { compileArchetype } from "./renderers.js";

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function setPosition(target, value) {
  if (Array.isArray(value)) {
    target.set(
      finite(value[0]),
      finite(value[1]),
      finite(value[2])
    );
    return;
  }
  if (isRecord(value)) {
    target.set(
      finite(value.x),
      finite(value.y),
      finite(value.z)
    );
  }
}

function setScale(target, value, fallback) {
  if (typeof value === "number") {
    const uniform = Math.max(0.001, finite(value, fallback));
    target.setScalar(uniform);
    return;
  }
  if (Array.isArray(value)) {
    target.set(
      Math.max(0.001, finite(value[0], fallback)),
      Math.max(0.001, finite(value[1], fallback)),
      Math.max(0.001, finite(value[2], fallback))
    );
    return;
  }
  if (isRecord(value)) {
    target.set(
      Math.max(0.001, finite(value.x, fallback)),
      Math.max(0.001, finite(value.y, fallback)),
      Math.max(0.001, finite(value.z, fallback))
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
      })
    )
  );
}

function buildInstanceApi({
  speciesId,
  role,
  dna,
  renderer,
  rng,
  instanceId,
  options,
  onDispose,
}) {
  const rendered = renderer.create(rng.fork("render"));
  const group = rendered.group;
  const localAffordances = cloneAffordances(rendered.affordances);
  let disposed = false;

  group.name = `generated-flora:${role}:${instanceId}`;
  setPosition(group.position, options.position);

  const yaw = Number.isFinite(options.rotationY)
    ? options.rotationY
    : rng.fork("placement-yaw").range(0, Math.PI * 2);
  group.rotation.y = yaw;

  const uniformScale = rng
    .fork("placement-scale")
    .range(dna.variation.scaleMin, dna.variation.scaleMax);
  setScale(group.scale, options.scale, uniformScale);

  const getWorldBounds = (target = new THREE.Sphere()) => {
    group.updateWorldMatrix(true, false);
    const center = new THREE.Vector3(...renderer.bounds.center);
    group.localToWorld(center);
    const worldScale = new THREE.Vector3();
    group.getWorldScale(worldScale);
    target.center.copy(center);
    target.radius =
      renderer.bounds.radius *
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
      Math.abs(worldScale.z)
    );
    return localAffordances.map((affordance) => {
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
    speciesId,
    instanceId,
    role,
    group,
    localBounds: renderer.bounds,
    affordances: localAffordances,
    touch(amount = 1, direction) {
      if (disposed) return rendered.touchState();
      return rendered.touch(amount, direction);
    },
    update(dt) {
      if (disposed) return rendered.touchState();
      return rendered.update(dt);
    },
    resetTouch() {
      if (disposed) return rendered.touchState();
      return rendered.resetTouch();
    },
    touchState() {
      return rendered.touchState();
    },
    getWorldBounds,
    getWorldAffordances,
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      group.traverse((object) => {
        if (object.isInstancedMesh) object.dispose();
      });
      group.clear();
      onDispose(api);
    },
  };

  Object.defineProperty(api, "disposed", {
    enumerable: true,
    get: () => disposed,
  });

  group.userData.generatedFlora = {
    speciesId,
    instanceId,
    role,
    bounds: renderer.bounds,
    affordances: localAffordances,
  };
  return Object.freeze(api);
}

/**
 * Compile permissive AI-authored FloraDNA into one species. Geometry and
 * materials are allocated once here and shared by every instance.
 *
 * @param {unknown} rawDNA
 * @param {{
 *   biome?: object,
 *   palette?: object,
 *   seed?: unknown,
 * }} [options]
 */
export function buildSpecies(rawDNA, options = {}) {
  const input = isRecord(rawDNA) ? rawDNA : {};
  const normalizedInput =
    options.seed === undefined ? input : { ...input, seed: options.seed };
  const { dna, notes } = normalizeFloraDNA(normalizedInput);
  const palette = deriveBiomePalette(options.biome, options.palette);
  const colors = resolveSpeciesColors(dna, palette);
  const renderer = compileArchetype(dna, colors);
  const digest = hashSeed("generated-flora", dna, palette)
    .toString(16)
    .padStart(8, "0");
  const id = `flora:${dna.archetype}:${digest}`;
  const instances = new Set();
  let nextOrdinal = 0;
  let disposed = false;

  const species = {
    id,
    name: dna.name,
    role: dna.role,
    archetype: dna.archetype,
    skeleton: renderer.skeleton,
    dna,
    notes: Object.freeze([...notes]),
    palette,
    bounds: renderer.bounds,
    affordanceSchema: renderer.affordanceSchema,
    resourceCounts: renderer.resourceCounts,
    windUniforms: state.windUniforms,
    createInstance(instanceOptions = {}) {
      if (disposed) {
        throw new Error(`generated-flora species "${id}" has been disposed`);
      }
      const safeOptions = isRecord(instanceOptions) ? instanceOptions : {};
      const ordinal = nextOrdinal++;
      const semanticKey =
        safeOptions.id ??
        safeOptions.seed ??
        ordinal;
      const instanceSeed = hashSeed(
        "generated-flora-instance",
        dna.seed,
        id,
        semanticKey
      );
      const instanceId =
        safeOptions.id === undefined
          ? `${id}:${ordinal}`
          : `${id}:${stableStringify(safeOptions.id)}`;
      const instance = buildInstanceApi({
        speciesId: id,
        role: dna.role,
        dna,
        renderer,
        rng: createRng(instanceSeed),
        instanceId,
        options: safeOptions,
        onDispose: (entry) => instances.delete(entry),
      });
      instances.add(instance);
      return instance;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const instance of [...instances]) instance.dispose();
      renderer.dispose();
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
