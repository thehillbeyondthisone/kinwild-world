/**
 * Tutorial progression — which layers of the field notebook the player has
 * walked through, and which words they have earned.
 *
 * DOM-free on purpose, like `studio-progress.js` and `genome-draft.js`: the
 * whole track is a pure state machine so it can be tested without a browser,
 * and the renderer (`src/ui/tutorial-notes.js`) is a view over it.
 *
 * Two rules from TUTORIAL_PLAN.md are enforced here rather than by habit:
 *
 * - **Layers gate prompting, never access.** There is no "locked" state — a
 *   player who does Layer 2's thing first is simply done with Layers 0–2.
 *   `markLayerDone` cascades backward for exactly this reason.
 * - **A layer ends on a sight, not a confirmation.** There is no "dismiss"
 *   transition; the only way a layer closes is `markLayerDone`, called when
 *   the player has done the thing.
 */

/**
 * The built layers, in order. Layers 3–7b from TUTORIAL_PLAN.md append here as
 * they land; `vocabulary` is the one word the layer is allowed to teach.
 */
export const TUTORIAL_LAYERS = Object.freeze([
  Object.freeze({ id: "arrive", vocabulary: null }),
  Object.freeze({ id: "notice", vocabulary: "species" }),
  Object.freeze({ id: "follow", vocabulary: "need" }),
]);

const ORDER = TUTORIAL_LAYERS.map((layer) => layer.id);

/**
 * Fresh progress, or a restored one. `done` keeps layer ids in walk order so
 * the serialized form reads as a margin note rather than a bitmap.
 */
export function createTutorialProgress(saved) {
  const progress = { done: [], vocabulary: [] };
  if (!saved || typeof saved !== "object") return progress;
  const done = Array.isArray(saved.done) ? saved.done : [];
  for (const id of done) {
    if (ORDER.includes(id) && !progress.done.includes(id)) progress.done.push(id);
  }
  const vocabulary = Array.isArray(saved.vocabulary) ? saved.vocabulary : [];
  for (const word of vocabulary) {
    if (
      TUTORIAL_LAYERS.some((layer) => layer.vocabulary === word) &&
      !progress.vocabulary.includes(word)
    ) {
      progress.vocabulary.push(word);
    }
  }
  return progress;
}

/** The first layer not yet walked — the only one allowed to prompt. */
export function nextLayer(progress) {
  for (const id of ORDER) {
    if (!progress.done.includes(id)) return id;
  }
  return null;
}

export function isLayerDone(progress, id) {
  return progress.done.includes(id);
}

/**
 * Close a layer — and every layer before it, because a player who has done
 * Layer 2's thing has self-evidently done Layer 0's. Returns the vocabulary
 * word newly earned, or null when the layer teaches no word (or was already
 * done). Unknown ids are ignored.
 */
export function markLayerDone(progress, id) {
  const index = ORDER.indexOf(id);
  if (index < 0) return null;
  let earned = null;
  for (let i = 0; i <= index; i++) {
    const layer = TUTORIAL_LAYERS[i];
    if (progress.done.includes(layer.id)) continue;
    progress.done.push(layer.id);
    if (i === index && layer.vocabulary) {
      earned = layer.vocabulary;
      if (!progress.vocabulary.includes(earned)) {
        progress.vocabulary.push(earned);
      }
    } else if (layer.vocabulary && !progress.vocabulary.includes(layer.vocabulary)) {
      // A cascaded layer still teaches its word — the player saw the sight
      // even if they never saw the prompt.
      progress.vocabulary.push(layer.vocabulary);
    }
  }
  return earned;
}

/** The plain-JSON form persisted beside the catalog (`smallworld:tutorial:v1`). */
export function serializeTutorial(progress) {
  return { done: [...progress.done], vocabulary: [...progress.vocabulary] };
}
