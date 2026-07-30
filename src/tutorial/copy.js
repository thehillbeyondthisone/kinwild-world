/**
 * Every word the onboarding says, in one place, in the field naturalist's
 * voice — the tutorial is a notebook margin, not a HUD, and the register is
 * easier to keep when the strings are together and short.
 *
 * The budget from TUTORIAL_PLAN.md is one vocabulary word per layer, and two
 * rules bind every line: never name a system before the player has seen it
 * act, and never say "lesson", "level", or "complete". The copy test
 * (`tests/tutorial-copy.test.mjs`) holds both, so a well-meant edit fails the
 * suite rather than quietly breaking the voice.
 */

/** The cold open: a paper sheet, the seed stamped on it, the island's name. */
export const INTRO_COPY = Object.freeze({
  caption: "this island came from this number.",
  dismiss: "press anywhere to step onto it",
});

export const LAYER_COPY = Object.freeze({
  arrive: Object.freeze({
    prompt: "look around.",
    hint: "drag to turn the island · scroll to lean closer",
  }),
  notice: Object.freeze({
    prompt: "find another like this one.",
    vocabulary: Object.freeze({
      word: "species",
      gloss: "the same few lines, written twice.",
    }),
  }),
  follow: Object.freeze({
    prompt: "stay with this one a while.",
    aside: "how fast these fill is one of the written lines.",
    vocabulary: Object.freeze({
      word: "need",
      gloss: "what it wants next, and how badly.",
    }),
  }),
});
