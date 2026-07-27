import assert from "node:assert/strict";

import {
  PRESENTATION_EVENTS,
  createPresentationEventBus,
} from "../src/integration/presentation-events.js";

const calls = [];
const bus = createPresentationEventBus();
const unsubscribe = bus.on(PRESENTATION_EVENTS.LAND, (event) => {
  calls.push(`regular:${event.sequence}`);
});
bus.once(PRESENTATION_EVENTS.LAND, (event) => {
  calls.push(`once:${event.sequence}`);
});
bus.onAny((event) => {
  calls.push(`any:${event.type}:${event.sequence}`);
});

const first = bus.emit(PRESENTATION_EVENTS.LAND, { strength: 0.8 }, { time: 4.25 });
assert.equal(Object.isFrozen(first), true);
assert.deepEqual(first, {
  type: PRESENTATION_EVENTS.LAND,
  detail: { strength: 0.8 },
  time: 4.25,
  sequence: 1,
});
assert.deepEqual(calls, [
  "regular:1",
  "once:1",
  `any:${PRESENTATION_EVENTS.LAND}:1`,
]);

bus.emit(PRESENTATION_EVENTS.LAND, null, { time: 4.5 });
assert.deepEqual(calls.slice(3), [
  "regular:2",
  `any:${PRESENTATION_EVENTS.LAND}:2`,
], "once listeners should be removed before later or re-entrant emission");
assert.equal(bus.sequence, 2);
assert.equal(unsubscribe(), true);
assert.equal(unsubscribe(), false, "unsubscribe should be idempotent");

const snapshotBus = createPresentationEventBus();
const snapshotCalls = [];
snapshotBus.on("test", () => {
  snapshotCalls.push("first");
  snapshotBus.on("test", () => snapshotCalls.push("late"));
});
snapshotBus.on("test", () => snapshotCalls.push("second"));
snapshotBus.emit("test");
assert.deepEqual(snapshotCalls, ["first", "second"]);
snapshotBus.emit("test");
assert.deepEqual(snapshotCalls, ["first", "second", "first", "second", "late"]);

const handledErrors = [];
const errorBus = createPresentationEventBus({
  onError(error, event) {
    handledErrors.push([error.message, event.sequence]);
  },
});
let survivorRan = false;
errorBus.on("impact", () => {
  throw new Error("broken sparkle");
});
errorBus.on("impact", () => {
  survivorRan = true;
});
errorBus.emit("impact", null, { time: 1 });
assert.deepEqual(handledErrors, [["broken sparkle", 1]]);
assert.equal(survivorRan, true, "one presentation failure should not starve later effects");

const throwingBus = createPresentationEventBus();
throwingBus.on("impact", () => {
  throw new Error("unhandled");
});
assert.throws(() => throwingBus.emit("impact"), /unhandled/);

assert.equal(snapshotBus.listenerCount("test"), 4);
assert.equal(snapshotBus.clear("test"), 4);
assert.equal(snapshotBus.listenerCount(), 0);
assert.throws(() => bus.on("", () => {}), /non-empty string/);
assert.throws(() => bus.emit("test", null, { time: Number.NaN }), /finite or null/);

const originalRandom = Math.random;
Math.random = () => {
  throw new Error("presentation dispatch must not consume global entropy");
};
try {
  createPresentationEventBus().emit(PRESENTATION_EVENTS.FOOTFALL, { foot: "left" }, { time: 7 });
} finally {
  Math.random = originalRandom;
}

console.log("integration-presentation-events.test.mjs passed");
