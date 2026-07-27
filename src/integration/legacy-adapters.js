import {
  INTEGRATION_CONTRACT_VERSION,
  assertFloraDescriptor,
  assertFloraInstance,
  assertCreatureAgent,
  defineCreatureProvider,
  defineFloraProvider,
} from "./provider-contracts.js";

function requireObject(value, label) {
  if (!value || typeof value !== "object") throw new TypeError(`${label} must be an object.`);
  return value;
}

function requireFunction(value, label) {
  if (typeof value !== "function") throw new TypeError(`${label} must be a function.`);
  return value;
}

function copyPosition(out, source, label) {
  if (!out || typeof out !== "object") throw new TypeError(`${label} out must be an object.`);
  if (!source || !Number.isFinite(source.x) || !Number.isFinite(source.y) || !Number.isFinite(source.z)) {
    throw new TypeError(`${label} source position must contain finite x/y/z values.`);
  }
  if (typeof out.copy === "function") return out.copy(source);
  if (typeof out.set === "function") return out.set(source.x, source.y, source.z);
  out.x = source.x;
  out.y = source.y;
  out.z = source.z;
  return out;
}

function creatureAnchorObject(creature) {
  return creature.segments?.[0] ?? creature.group;
}

function creatureRadius(creature, resolver) {
  const resolved = typeof resolver === "function" ? resolver(creature) : resolver;
  if (resolved !== undefined) {
    if (!Number.isFinite(resolved) || resolved < 0) {
      throw new RangeError("Legacy creature radius resolver must return a non-negative finite number.");
    }
    return resolved;
  }
  const scale = Number.isFinite(creature.scale) ? creature.scale : 1;
  const baseRadius = Number.isFinite(creature.segRadius) ? creature.segRadius : 0.5;
  return baseRadius * scale;
}

function makeLegacyCreatureTraits(creature, radiusResolver) {
  const traits = {};
  Object.defineProperties(traits, {
    mode: {
      enumerable: true,
      get: () => creature.isFish ? "fish" : (creature.flies ? "flier" : "walker"),
    },
    airborne: {
      enumerable: true,
      get: () => Boolean(creature.flies && creature.landState !== "landed"),
    },
    aquatic: {
      enumerable: true,
      get: () => Boolean(creature.isFish),
    },
    scale: {
      enumerable: true,
      get: () => Number.isFinite(creature.scale) ? creature.scale : 1,
    },
    radius: {
      enumerable: true,
      get: () => creatureRadius(creature, radiusResolver),
    },
  });
  return Object.freeze(traits);
}

/**
 * Wrap one existing Small World creature struct in the neutral host contract.
 *
 * All legacy behavior functions are injected; importing this module has no
 * dependency on the global state singleton or fauna module.
 *
 * @param {object} creature legacy `{group, ...state}` object.
 * @param {object} [options]
 * @param {Function} [options.stepCreature]
 * @param {Function} [options.wakeCreature]
 * @param {Function} [options.lookAtCreature]
 * @param {Function} [options.setMoveIntent]
 * @param {Function} [options.disposeCreature]
 * @param {number|((creature: object) => number)} [options.radius]
 * @returns {import("./provider-contracts.js").CreatureAgent}
 */
export function adaptLegacyCreature(creature, {
  stepCreature = null,
  wakeCreature = null,
  lookAtCreature = null,
  setMoveIntent = null,
  disposeCreature = null,
  radius,
} = {}) {
  requireObject(creature, "Legacy creature");
  requireObject(creature.group, "Legacy creature.group");
  if (stepCreature !== null) requireFunction(stepCreature, "stepCreature");
  if (wakeCreature !== null) requireFunction(wakeCreature, "wakeCreature");
  if (lookAtCreature !== null) requireFunction(lookAtCreature, "lookAtCreature");
  if (setMoveIntent !== null) requireFunction(setMoveIntent, "setMoveIntent");
  if (disposeCreature !== null) requireFunction(disposeCreature, "disposeCreature");

  let disposed = false;
  const traits = makeLegacyCreatureTraits(creature, radius);

  function requireAlive() {
    if (disposed) throw new Error("Legacy creature agent has been disposed.");
  }

  const agent = {
    contractVersion: INTEGRATION_CONTRACT_VERSION,
    source: creature,
    root: creature.group,
    interactionRoot: creature.group,
    traits,
    anchor(out) {
      requireAlive();
      return copyPosition(out, creatureAnchorObject(creature).position, "Legacy creature anchor");
    },
    bounds(out) {
      requireAlive();
      copyPosition(out, creatureAnchorObject(creature).position, "Legacy creature bounds");
      return creatureRadius(creature, radius);
    },
    heading() {
      return Number.isFinite(creature.heading)
        ? creature.heading
        : (Number.isFinite(creature.group.rotation?.y) ? creature.group.rotation.y : 0);
    },
    update(dt, time, world) {
      requireAlive();
      if (!Number.isFinite(dt) || !Number.isFinite(time)) {
        throw new TypeError("Legacy creature update requires finite dt and time.");
      }
      if (stepCreature) stepCreature(creature, dt, time, world?.heightFn);
    },
    setMoveIntent(target) {
      requireAlive();
      if (setMoveIntent) {
        setMoveIntent(creature, target);
        return true;
      }
      if (typeof creature.follow === "function") {
        creature.follow(target);
        return true;
      }
      return false;
    },
    lookAt(target) {
      requireAlive();
      if (!lookAtCreature) return false;
      lookAtCreature(creature, target);
      return true;
    },
    wake() {
      requireAlive();
      if (!wakeCreature) return false;
      wakeCreature(creature);
      return true;
    },
    dispose() {
      if (disposed) return false;
      disposed = true;
      if (disposeCreature) disposeCreature(creature);
      else if (typeof creature.group.removeFromParent === "function") {
        creature.group.removeFromParent();
      }
      return true;
    },
  };

  return assertCreatureAgent(Object.freeze(agent), "Legacy creature adapter");
}

/**
 * Build a provider around Small World's existing make/step creature functions.
 *
 * @param {object} options
 * @param {Function} options.makeCreature
 * @param {Function} [options.stepCreature]
 * @param {Function} [options.wakeCreature]
 * @param {Function} [options.lookAtCreature]
 * @param {Function} [options.setMoveIntent]
 * @param {Function} [options.disposeCreature]
 * @param {number|Function} [options.radius]
 * @param {string} [options.id]
 * @param {string|number} [options.version]
 * @returns {Readonly<object>}
 */
export function createLegacyCreatureProvider({
  makeCreature,
  stepCreature = null,
  wakeCreature = null,
  lookAtCreature = null,
  setMoveIntent = null,
  disposeCreature = null,
  radius,
  id = "small-world:legacy-creatures",
  version = "1",
}) {
  requireFunction(makeCreature, "makeCreature");

  return defineCreatureProvider({
    id,
    version,
    capabilities: { legacy: true },
    create(request = {}, world) {
      const biome = request.biome ?? world?.biome;
      if (!biome) throw new TypeError("Legacy creature creation requires a biome.");
      const creature = makeCreature(biome, request.options ?? {});
      return adaptLegacyCreature(creature, {
        stepCreature,
        wakeCreature,
        lookAtCreature,
        setMoveIntent,
        disposeCreature,
        radius,
      });
    },
  });
}

function floraScale(root) {
  const sx = Number.isFinite(root.scale?.x) ? Math.abs(root.scale.x) : 1;
  const sz = Number.isFinite(root.scale?.z) ? Math.abs(root.scale.z) : 1;
  return Math.max(sx, sz);
}

/**
 * Wrap an existing flora builder result.
 *
 * @param {object} root Three.js group returned by a legacy flora builder.
 * @param {object} options
 * @param {import("./provider-contracts.js").FloraDescriptor} options.descriptor
 * @param {(root: object) => void} [options.disposeFlora]
 * @returns {import("./provider-contracts.js").FloraInstance}
 */
export function adaptLegacyFlora(root, { descriptor, disposeFlora = null }) {
  requireObject(root, "Legacy flora root");
  assertFloraDescriptor(descriptor, "Legacy flora descriptor");
  if (disposeFlora !== null) requireFunction(disposeFlora, "disposeFlora");

  let disposed = false;
  const instance = {
    contractVersion: INTEGRATION_CONTRACT_VERSION,
    source: root,
    root,
    interactionRoot: root,
    descriptor,
    bounds(out) {
      if (disposed) throw new Error("Legacy flora instance has been disposed.");
      copyPosition(out, root.position, "Legacy flora bounds");
      const baseRadius = Number.isFinite(descriptor.boundsRadius)
        ? descriptor.boundsRadius
        : descriptor.footprint;
      return baseRadius * floraScale(root);
    },
    dispose() {
      if (disposed) return false;
      disposed = true;
      if (disposeFlora) disposeFlora(root);
      else if (typeof root.removeFromParent === "function") root.removeFromParent();
      return true;
    },
  };

  return assertFloraInstance(Object.freeze(instance), "Legacy flora adapter");
}

/**
 * Build a provider around the existing `FLORA_BUILDERS` registry.
 *
 * `describeKind` is deliberately separate from `build`: placement can query
 * footprints and ecology before allocating meshes. Until richer descriptors
 * are supplied, the adapter returns a safe zero-footprint legacy descriptor.
 *
 * @param {object} options
 * @param {Record<string, Function>} options.builders
 * @param {(kind: string, biome: object, request: object, world: object) => object} [options.describeKind]
 * @param {(root: object) => void} [options.disposeFlora]
 * @param {string} [options.id]
 * @param {string|number} [options.version]
 * @returns {Readonly<object>}
 */
export function createLegacyFloraProvider({
  builders,
  describeKind = null,
  disposeFlora = null,
  id = "small-world:legacy-flora",
  version = "1",
}) {
  requireObject(builders, "Legacy flora builders");
  if (describeKind !== null) requireFunction(describeKind, "describeKind");
  if (disposeFlora !== null) requireFunction(disposeFlora, "disposeFlora");

  function describe(request, world) {
    const kind = request.kind;
    if (typeof kind !== "string" || kind === "") {
      throw new TypeError("Legacy flora request.kind must be a non-empty string.");
    }
    const biome = request.biome ?? world?.biome;
    if (!biome) throw new TypeError("Legacy flora description requires a biome.");
    return describeKind?.(kind, biome, request, world) ?? {
      id: `legacy:${kind}`,
      kind,
      footprint: 0,
      roles: [],
      affordances: {},
    };
  }

  return defineFloraProvider({
    id,
    version,
    capabilities: { legacy: true },
    describe,
    create(request = {}, world) {
      const kind = request.kind;
      const builder = builders[kind];
      if (typeof builder !== "function") {
        throw new RangeError(`No legacy flora builder is registered for "${kind}".`);
      }
      const biome = request.biome ?? world?.biome;
      if (!biome) throw new TypeError("Legacy flora creation requires a biome.");
      const descriptor = request.descriptor ?? describe(request, world);
      const root = builder(biome, request.options ?? {});
      return adaptLegacyFlora(root, { descriptor, disposeFlora });
    },
  });
}
