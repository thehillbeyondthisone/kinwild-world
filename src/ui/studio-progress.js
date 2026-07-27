/**
 * Form Studio progress copy and curve.
 *
 * DOM-free on purpose: authoring a creature takes anywhere from two seconds to
 * half a minute depending on whether a local model is warm, and there is no
 * progress signal to read from an OpenAI-compatible completion. So the bar is
 * honest about *stage* (which the caller knows) and entertaining about *time*
 * (which nobody knows), and both halves are unit-testable here rather than
 * being buried in event handlers.
 */

/** Named stages, in the order the studio actually walks them. */
export const STUDIO_STAGES = Object.freeze({
  reaching: "reaching for a local model",
  authoring: "the authoring model is drafting",
  grammar: "the field grammar is drafting",
  validating: "validating anatomy and gait",
  settling: "settling three studies",
});

/**
 * Field-notebook chatter. Rotated while a request is in flight so a long wait
 * reads as somebody working rather than as a hang.
 */
export const STUDIO_MESSAGES = Object.freeze([
  "sharpening a pencil on the field desk",
  "counting legs, then counting them again",
  "asking the meadow for a second opinion",
  "measuring a stride against the wind",
  "testing whether the eyes read as curious",
  "checking that nothing is sharp or scary",
  "weighing the body against its own legs",
  "borrowing a colour from the evening light",
  "listening for the gait in the grass",
  "keeping the silhouette round and kind",
  "pressing the study flat to dry",
  "noting the specimen in the margin",
]);

/** Milliseconds each chatter line holds before the next one. */
export const STUDIO_MESSAGE_MS = 2400;

/**
 * Where the bar should sit after `elapsedMs` of an unbounded wait.
 *
 * Approaches — but never reaches — `ceiling`, so the bar always looks alive
 * and never claims to be finished before the work is. The caller drives it to
 * 1 itself once studies actually land.
 */
export function studioProgress(elapsedMs, { ceiling = 0.92, halfLifeMs = 4200 } = {}) {
  const elapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  return ceiling * (1 - Math.pow(0.5, elapsed / halfLifeMs));
}

/** The chatter line for a given elapsed time, cycling forever. */
export function studioMessage(elapsedMs) {
  const elapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  const index = Math.floor(elapsed / STUDIO_MESSAGE_MS) % STUDIO_MESSAGES.length;
  return STUDIO_MESSAGES[index];
}
