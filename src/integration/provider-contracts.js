/** Version of the host/provider handshake, independent of content versions. */
export const INTEGRATION_CONTRACT_VERSION = 1;

function isObject(value) {
  return value !== null && typeof value === "object";
}

function requireObject(value, label) {
  if (!isObject(value)) throw new TypeError(`${label} must be an object.`);
  return value;
}

function requireFunction(value, label) {
  if (typeof value !== "function") throw new TypeError(`${label} must be a function.`);
  return value;
}

function requireId(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireSynchronous(value, label) {
  if (value && typeof value.then === "function") {
    throw new TypeError(`${label} must be synchronous inside world generation.`);
  }
  return value;
}

/**
 * @typedef {object} CreatureAgent
 * @property {number} contractVersion
 * @property {object} root render root parented under `state.world`
 * @property {object} interactionRoot CPU-pickable root or proxy
 * @property {object} traits live locomotion/size traits
 * @property {(out: object) => object} anchor writes world-local anchor position
 * @property {(out: object) => number} bounds writes center and returns radius
 * @property {(dt: number, time: number, world: object) => void} update
 * @property {() => void} dispose idempotent resource teardown
 */

/**
 * Validate a creature agent at the provider boundary.
 *
 * @param {unknown} agent
 * @param {string} [label]
 * @returns {CreatureAgent}
 */
export function assertCreatureAgent(agent, label = "Creature agent") {
  requireObject(agent, label);
  requireObject(agent.root, `${label}.root`);
  requireObject(agent.interactionRoot, `${label}.interactionRoot`);
  requireObject(agent.traits, `${label}.traits`);
  requireFunction(agent.anchor, `${label}.anchor`);
  requireFunction(agent.bounds, `${label}.bounds`);
  requireFunction(agent.update, `${label}.update`);
  requireFunction(agent.dispose, `${label}.dispose`);
  return agent;
}

/**
 * @typedef {object} FloraDescriptor
 * @property {string} id stable archetype ID
 * @property {string} [kind] legacy/display kind
 * @property {number} footprint placement radius at scale 1
 * @property {string[]} [roles] ecology/composition roles
 * @property {object} [habitat] declarative habitat constraints
 * @property {object} [affordances] nectar/perch/shelter/obstacle metadata
 */

/**
 * @param {unknown} descriptor
 * @param {string} [label]
 * @returns {FloraDescriptor}
 */
export function assertFloraDescriptor(descriptor, label = "Flora descriptor") {
  requireObject(descriptor, label);
  requireId(descriptor.id, `${label}.id`);
  if (!Number.isFinite(descriptor.footprint) || descriptor.footprint < 0) {
    throw new RangeError(`${label}.footprint must be a non-negative finite number.`);
  }
  if (descriptor.roles !== undefined && !Array.isArray(descriptor.roles)) {
    throw new TypeError(`${label}.roles must be an array when provided.`);
  }
  return descriptor;
}

/**
 * @typedef {object} FloraInstance
 * @property {number} contractVersion
 * @property {object} root render root parented under `state.world`
 * @property {object} interactionRoot CPU-pickable root or proxy
 * @property {FloraDescriptor} descriptor placement/ecology metadata
 * @property {(out: object) => number} bounds writes center and returns radius
 * @property {() => void} dispose idempotent resource teardown
 */

/**
 * @param {unknown} instance
 * @param {string} [label]
 * @returns {FloraInstance}
 */
export function assertFloraInstance(instance, label = "Flora instance") {
  requireObject(instance, label);
  requireObject(instance.root, `${label}.root`);
  requireObject(instance.interactionRoot, `${label}.interactionRoot`);
  assertFloraDescriptor(instance.descriptor, `${label}.descriptor`);
  requireFunction(instance.bounds, `${label}.bounds`);
  requireFunction(instance.dispose, `${label}.dispose`);
  return instance;
}

function providerMetadata(provider, kind) {
  requireObject(provider, `${kind} provider`);
  const id = requireId(provider.id, `${kind} provider.id`);
  const version = String(provider.version ?? "1");
  const capabilities = Object.freeze({ ...(provider.capabilities ?? {}) });
  return { id, version, capabilities };
}

/**
 * Define and validate a synchronous creature provider.
 *
 * A spawn request may carry an injected `rng` function. Providers that need
 * entropy must consume that function only; the integration layer deliberately
 * does not provide a global fallback.
 *
 * @param {object} provider
 * @param {string} provider.id
 * @param {string|number} [provider.version]
 * @param {object} [provider.capabilities]
 * @param {(request: object, world: object) => CreatureAgent} provider.create
 * @param {(request: object, world: object) => CreatureAgent} [provider.createPreview]
 * @returns {Readonly<object>}
 */
export function defineCreatureProvider(provider) {
  const metadata = providerMetadata(provider, "Creature");
  const create = requireFunction(provider.create, "Creature provider.create");
  const createPreview = provider.createPreview === undefined
    ? null
    : requireFunction(provider.createPreview, "Creature provider.createPreview");

  const defined = {
    kind: "creature",
    contractVersion: INTEGRATION_CONTRACT_VERSION,
    ...metadata,
    create(request = {}, world) {
      const agent = requireSynchronous(
        create.call(provider, request, world),
        `Creature provider "${metadata.id}" create`
      );
      return assertCreatureAgent(agent, `Creature provider "${metadata.id}" result`);
    },
  };

  if (createPreview) {
    defined.createPreview = (request = {}, world) => {
      const agent = requireSynchronous(
        createPreview.call(provider, request, world),
        `Creature provider "${metadata.id}" createPreview`
      );
      return assertCreatureAgent(agent, `Creature provider "${metadata.id}" preview result`);
    };
  }

  return Object.freeze(defined);
}

/**
 * Define and validate a synchronous flora provider.
 *
 * `describe` runs before construction so placement can use footprints,
 * habitat, obstacles, perches, and ecology without allocating render objects.
 *
 * @param {object} provider
 * @param {string} provider.id
 * @param {string|number} [provider.version]
 * @param {object} [provider.capabilities]
 * @param {(request: object, world: object) => FloraDescriptor} provider.describe
 * @param {(request: object, world: object) => FloraInstance} provider.create
 * @param {(request: object, world: object) => FloraInstance} [provider.createPreview]
 * @returns {Readonly<object>}
 */
export function defineFloraProvider(provider) {
  const metadata = providerMetadata(provider, "Flora");
  const describe = requireFunction(provider.describe, "Flora provider.describe");
  const create = requireFunction(provider.create, "Flora provider.create");
  const createPreview = provider.createPreview === undefined
    ? null
    : requireFunction(provider.createPreview, "Flora provider.createPreview");

  const defined = {
    kind: "flora",
    contractVersion: INTEGRATION_CONTRACT_VERSION,
    ...metadata,
    describe(request = {}, world) {
      const descriptor = requireSynchronous(
        describe.call(provider, request, world),
        `Flora provider "${metadata.id}" describe`
      );
      return assertFloraDescriptor(descriptor, `Flora provider "${metadata.id}" descriptor`);
    },
    create(request = {}, world) {
      const instance = requireSynchronous(
        create.call(provider, request, world),
        `Flora provider "${metadata.id}" create`
      );
      return assertFloraInstance(instance, `Flora provider "${metadata.id}" result`);
    },
  };

  if (createPreview) {
    defined.createPreview = (request = {}, world) => {
      const instance = requireSynchronous(
        createPreview.call(provider, request, world),
        `Flora provider "${metadata.id}" createPreview`
      );
      return assertFloraInstance(instance, `Flora provider "${metadata.id}" preview result`);
    };
  }

  return Object.freeze(defined);
}
