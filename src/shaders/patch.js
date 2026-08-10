/**
 * Splicing into three.js' generated shader source, safely.
 *
 * This lives on its own, with no imports at all, for a reason worth stating: it
 * used to sit in `src/util.js`, which imports `state.js`, which reads Vite's
 * `__APP_VERSION__` define. Importing it from `generated-fauna/shell.js` made
 * the entire generated-fauna module graph un-importable in node and took four
 * headless suites down with it — and those suites are how fauna determinism and
 * normalization are asserted in the first place.
 *
 * A pure string function should not drag a browser runtime behind it. `util.js`
 * re-exports this so existing callers are unchanged.
 */

/**
 * String.replace against three.js' generated shader source, but warns instead
 * of silently no-op'ing when the anchor doesn't match (e.g. after a three.js
 * upgrade changes an `#include` chunk's surrounding text).
 *
 * A miss is never an error: the shader still compiles and the effect is simply
 * absent, which is the hardest kind of breakage to notice. `tests/shader-patch-
 * anchors.test.mjs` is the other half of this guard — it fails the build when
 * an anchor stops existing in three's own source.
 *
 * @param {string} source - shader source to patch
 * @param {string} anchor - exact substring to find
 * @param {string} replacement - replacement text (same shape as String.replace)
 * @param {string} label - short identifier for the warning message
 */
export function replaceOrWarn(source, anchor, replacement, label) {
  if (!source.includes(anchor)) {
    console.warn(`[replaceOrWarn] anchor not found for "${label}" — shader patch skipped`);
    return source;
  }
  return source.replace(anchor, replacement);
}
