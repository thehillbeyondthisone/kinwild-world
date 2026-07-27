/**
 * Canonical presentation-only signals. Simulation code emits semantic events;
 * particles, sound, camera impulse, grass response, and haptics subscribe
 * independently.
 */
export const PRESENTATION_EVENTS = Object.freeze({
  CREATURE_SPAWN: "creature:spawn",
  CREATURE_DESPAWN: "creature:despawn",
  FOOTFALL: "creature:footfall",
  LAND: "creature:land",
  TAKEOFF: "creature:takeoff",
  SLEEP: "creature:sleep",
  WAKE: "creature:wake",
  PET: "creature:pet",
  FLORA_REACT: "flora:react",
});

const ANY_EVENT = Symbol("any-presentation-event");

function requireEventType(type) {
  if (typeof type !== "string" || type.trim() === "") {
    throw new TypeError("Presentation event type must be a non-empty string.");
  }
  return type;
}

function requireListener(listener) {
  if (typeof listener !== "function") {
    throw new TypeError("Presentation event listener must be a function.");
  }
  return listener;
}

/**
 * Deterministic, synchronous event bus for optional presentation effects.
 *
 * Listener order is registration order. Emission snapshots the matching
 * listeners, so subscriptions changed by a listener affect only later emits.
 * No clock is read implicitly: callers pass simulation time explicitly.
 *
 * @param {object} [options]
 * @param {(error: unknown, event: object) => void} [options.onError]
 */
export function createPresentationEventBus({ onError = null } = {}) {
  if (onError !== null && typeof onError !== "function") {
    throw new TypeError("Presentation event onError must be a function or null.");
  }

  /** @type {Array<{type: string|symbol, listener: Function, once: boolean}>} */
  let subscriptions = [];
  let sequence = 0;

  function subscribe(type, listener, once) {
    requireListener(listener);
    const subscription = { type, listener, once };
    subscriptions.push(subscription);
    let active = true;

    return function unsubscribe() {
      if (!active) return false;
      active = false;
      const index = subscriptions.indexOf(subscription);
      if (index === -1) return false;
      subscriptions.splice(index, 1);
      return true;
    };
  }

  function on(type, listener) {
    return subscribe(requireEventType(type), listener, false);
  }

  function once(type, listener) {
    return subscribe(requireEventType(type), listener, true);
  }

  function onAny(listener) {
    return subscribe(ANY_EVENT, listener, false);
  }

  /**
   * @param {string} type
   * @param {unknown} [detail]
   * @param {object} [options]
   * @param {number|null} [options.time=null] explicit simulation time.
   * @returns {Readonly<{type: string, detail: unknown, time: number|null, sequence: number}>}
   */
  function emit(type, detail = null, { time = null } = {}) {
    const checkedType = requireEventType(type);
    if (time !== null && !Number.isFinite(time)) {
      throw new TypeError("Presentation event time must be finite or null.");
    }

    const event = Object.freeze({
      type: checkedType,
      detail,
      time,
      sequence: ++sequence,
    });
    const matching = subscriptions.filter(
      (subscription) => subscription.type === checkedType || subscription.type === ANY_EVENT
    );
    const unhandledErrors = [];

    for (const subscription of matching) {
      if (subscription.once) {
        const index = subscriptions.indexOf(subscription);
        if (index !== -1) subscriptions.splice(index, 1);
      }

      try {
        subscription.listener(event);
      } catch (error) {
        if (onError) {
          try {
            onError(error, event);
          } catch (reportingError) {
            unhandledErrors.push(reportingError);
          }
        } else {
          unhandledErrors.push(error);
        }
      }
    }

    if (unhandledErrors.length === 1) throw unhandledErrors[0];
    if (unhandledErrors.length > 1) {
      throw new AggregateError(unhandledErrors, `Presentation event "${checkedType}" failed.`);
    }
    return event;
  }

  function clear(type) {
    if (type === undefined) {
      const removed = subscriptions.length;
      subscriptions = [];
      return removed;
    }
    const checkedType = requireEventType(type);
    const before = subscriptions.length;
    subscriptions = subscriptions.filter((subscription) => subscription.type !== checkedType);
    return before - subscriptions.length;
  }

  function listenerCount(type) {
    if (type === undefined) return subscriptions.length;
    const checkedType = requireEventType(type);
    return subscriptions.filter((subscription) => subscription.type === checkedType).length;
  }

  const bus = { on, once, onAny, emit, clear, listenerCount };
  Object.defineProperty(bus, "sequence", {
    enumerable: true,
    get: () => sequence,
  });
  return Object.freeze(bus);
}
