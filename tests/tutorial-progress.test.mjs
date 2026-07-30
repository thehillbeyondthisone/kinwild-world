import assert from "node:assert/strict";

import {
  TUTORIAL_LAYERS,
  createTutorialProgress,
  isLayerDone,
  markLayerDone,
  nextLayer,
  serializeTutorial,
} from "../src/tutorial/progress.js";

// A fresh track starts at the beginning and has earned no words.
{
  const progress = createTutorialProgress();
  assert.equal(nextLayer(progress), "arrive");
  assert.deepEqual(progress.vocabulary, []);
}

// Closing a layer out of order closes everything before it: layers gate
// prompting, never access, so a player who has done a later thing has
// self-evidently done the earlier ones.
{
  const progress = createTutorialProgress();
  const earned = markLayerDone(progress, "notice");
  assert.equal(earned, "species", "notice teaches its one word");
  assert.ok(isLayerDone(progress, "arrive"), "the earlier layer closes with it");
  assert.ok(isLayerDone(progress, "notice"));
  assert.equal(nextLayer(progress), "follow");
}

// A layer without a word earns nothing, and re-closing earns nothing twice.
{
  const progress = createTutorialProgress();
  assert.equal(markLayerDone(progress, "arrive"), null);
  assert.equal(markLayerDone(progress, "arrive"), null);
  assert.deepEqual(progress.vocabulary, []);
  assert.equal(nextLayer(progress), "notice");
}

// Walking the whole built track ends the prompting.
{
  const progress = createTutorialProgress();
  markLayerDone(progress, "arrive");
  markLayerDone(progress, "notice");
  const last = markLayerDone(progress, "follow");
  assert.equal(last, "need");
  assert.equal(nextLayer(progress), null);
  assert.deepEqual(progress.vocabulary, ["species", "need"]);
}

// Persistence round-trips, and a restored track resumes where it left off.
{
  const progress = createTutorialProgress();
  markLayerDone(progress, "notice");
  const restored = createTutorialProgress(serializeTutorial(progress));
  assert.equal(nextLayer(restored), "follow");
  assert.deepEqual(restored.vocabulary, ["species"]);
}

// Nothing saved means first arrival — the stamped sheet's whole signal.
{
  const restored = createTutorialProgress(null);
  assert.equal(nextLayer(restored), TUTORIAL_LAYERS[0].id);
}

// A hand-edited or stale save can't invent layers or words.
{
  const restored = createTutorialProgress({
    done: ["notice", "bogus", "follow"],
    vocabulary: ["species", "hunger"],
  });
  assert.deepEqual(restored.done, ["notice", "follow"]);
  assert.deepEqual(restored.vocabulary, ["species"]);
}

// Unknown layer ids are ignored, never thrown on.
{
  const progress = createTutorialProgress();
  assert.equal(markLayerDone(progress, "compose"), null);
  assert.equal(nextLayer(progress), "arrive");
}

console.log("tutorial-progress.test.mjs passed");
