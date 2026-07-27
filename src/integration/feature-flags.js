/**
 * Generated-content switches are deliberately opt-in while the integration is
 * being proven. URL values take precedence over build/runtime environment
 * values so a deployed build can be tested in either direction without
 * changing persisted settings.
 */
export const INTEGRATION_FEATURE_FLAG_DEFINITIONS = Object.freeze({
  livingWorld: Object.freeze({
    query: "livingWorld",
    env: "VITE_LIVING_WORLD",
  }),
  generatedFauna: Object.freeze({
    query: "generatedFauna",
    env: "VITE_SW_GENERATED_FAUNA",
  }),
  generatedFlora: Object.freeze({
    query: "generatedFlora",
    env: "VITE_SW_GENERATED_FLORA",
  }),
});

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

/**
 * Parse a strict boolean feature-flag value.
 *
 * Unknown values return `undefined` rather than becoming truthy. This is
 * important for experimental render paths: malformed configuration must fail
 * closed.
 *
 * @param {unknown} value
 * @returns {boolean|undefined}
 */
export function parseFeatureFlagValue(value) {
  if (typeof value === "boolean") return value;
  if (value === 1) return true;
  if (value === 0) return false;
  if (typeof value !== "string") return undefined;

  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return undefined;
}

function runtimeEnvironment() {
  return import.meta.env ?? globalThis.process?.env ?? {};
}

function searchParamsFrom(search) {
  if (search instanceof URLSearchParams) return search;
  return new URLSearchParams(String(search ?? ""));
}

/**
 * Resolve all integration flags without reading or writing Small World's
 * persisted settings.
 *
 * Precedence is:
 * 1. an explicitly present URL parameter;
 * 2. its corresponding environment value;
 * 3. `false`.
 *
 * A bare URL key such as `?generatedFauna` means true. An invalid explicit URL
 * value means false (rather than falling through to an environment opt-in), so
 * the URL remains an authoritative emergency override.
 *
 * @param {object} [options]
 * @param {string|URLSearchParams} [options.search] URL query string or params.
 * @param {Record<string, unknown>} [options.env] Vite/Node-like environment.
 * @returns {Readonly<{
 *   livingWorld: boolean,
 *   generatedFauna: boolean,
 *   generatedFlora: boolean,
 * }>}
 */
export function readIntegrationFeatureFlags({
  search = globalThis.location?.search ?? "",
  env = runtimeEnvironment(),
} = {}) {
  const params = searchParamsFrom(search);
  const resolved = {};

  for (const [key, definition] of Object.entries(INTEGRATION_FEATURE_FLAG_DEFINITIONS)) {
    if (params.has(definition.query)) {
      const raw = params.get(definition.query);
      resolved[key] = raw === "" ? true : (parseFeatureFlagValue(raw) ?? false);
      continue;
    }

    resolved[key] = parseFeatureFlagValue(env?.[definition.env]) ?? false;
  }

  return Object.freeze(resolved);
}
