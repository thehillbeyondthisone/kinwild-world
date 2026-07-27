export {
  INTEGRATION_FEATURE_FLAG_DEFINITIONS,
  parseFeatureFlagValue,
  readIntegrationFeatureFlags,
} from "./feature-flags.js";

export { WorldContext, createWorldContext } from "./world-context.js";

export {
  PRESENTATION_EVENTS,
  createPresentationEventBus,
} from "./presentation-events.js";

export {
  INTEGRATION_CONTRACT_VERSION,
  assertCreatureAgent,
  assertFloraDescriptor,
  assertFloraInstance,
  defineCreatureProvider,
  defineFloraProvider,
} from "./provider-contracts.js";

export {
  adaptLegacyCreature,
  adaptLegacyFlora,
  createLegacyCreatureProvider,
  createLegacyFloraProvider,
} from "./legacy-adapters.js";
