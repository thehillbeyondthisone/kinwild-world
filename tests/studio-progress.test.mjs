import assert from "node:assert/strict";
import {
  STUDIO_MESSAGES,
  STUDIO_MESSAGE_MS,
  STUDIO_STAGES,
  studioMessage,
  studioProgress,
} from "../src/ui/studio-progress.js";

// The bar stands in for an unbounded wait, so the one property that must hold
// is that it never claims completion on its own.
assert.equal(studioProgress(0), 0, "an unstarted request should read as empty");
for (const elapsed of [1, 900, 4200, 30_000, 10 * 60_000]) {
  const value = studioProgress(elapsed);
  assert.ok(value > 0 && value < 1, `progress at ${elapsed}ms should sit inside (0, 1)`);
}
assert.ok(
  studioProgress(30_000) < 0.93,
  "progress must stay under its ceiling however long the model takes",
);
let previous = -1;
for (let elapsed = 0; elapsed <= 20_000; elapsed += 250) {
  const value = studioProgress(elapsed);
  assert.ok(value >= previous, "progress must never run backwards");
  previous = value;
}
// Garbage in (a clock that jumped, a missing start time) must not produce a
// NaN width, which CSS silently drops and leaves the bar frozen.
for (const bad of [Number.NaN, -1, undefined, Infinity]) {
  assert.equal(studioProgress(bad), 0, `${String(bad)} elapsed should read as empty`);
}

// Chatter cycles rather than running out on a slow model.
assert.equal(studioMessage(0), STUDIO_MESSAGES[0]);
assert.equal(studioMessage(STUDIO_MESSAGE_MS), STUDIO_MESSAGES[1]);
assert.equal(
  studioMessage(STUDIO_MESSAGE_MS * STUDIO_MESSAGES.length),
  STUDIO_MESSAGES[0],
  "the message run should wrap instead of falling off the end",
);
assert.ok(STUDIO_MESSAGES.length >= 8, "a long wait needs enough distinct lines");
assert.equal(
  new Set(STUDIO_MESSAGES).size,
  STUDIO_MESSAGES.length,
  "repeated lines read as a stuck UI",
);

// Vibe (CLAUDE.md): nothing sharp, technical, or alarming in player-facing copy.
const copy = [...STUDIO_MESSAGES, ...Object.values(STUDIO_STAGES)].join(" ").toLowerCase();
for (const word of ["error", "fail", "kill", "abort", "crash", "invalid"]) {
  assert.ok(!copy.includes(word), `studio copy should not say "${word}"`);
}

console.log("studio-progress.test.mjs passed");
