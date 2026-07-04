// QA-009: this file checks pointer-lock suspension/resume wiring for photo
// review, all inside ui.js's initUi() closures (makeFirstPersonMode's shared
// state machine). Exercising it behaviorally would need a real
// PointerEvent/pointer-lock browser environment; no pure logic to extract.
// Stays a source-text assertion.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');

assert(
  uiSource.includes('_photoFP.reviewOpen = true'),
  'Opening the photo review should mark photo first-person input as suspended.'
);
assert(
  uiSource.includes('document.exitPointerLock?.()'),
  'Opening the photo review should release pointer lock so save/discard buttons are clickable.'
);
assert(
  uiSource.includes('canvas.requestPointerLock?.().catch(() => {});'),
  'Photo mode should ignore rejected pointer-lock requests so browser automation does not create unhandled rejections.'
);
assert(
  uiSource.includes('if (fp.reviewOpen) return;'),
  'Photo review should suspend first-person movement while the save/discard prompt is visible.'
);
assert(
  uiSource.includes('ignoreLockLossIf: (fp) => fp.reviewOpen,'),
  'Pointer-lock changes caused by photo review should not exit photo mode.'
);
assert(
  uiSource.includes('if (ignoreLockLossIf?.(fp)) return;'),
  'The shared first-person pointer-lock state machine should honor each mode\'s lock-loss guard (QA-007).'
);
assert(
  uiSource.includes('const knownKeys = new Set(["w", "a", "s", "d", "shift", ...extraKeys]);')
    && uiSource.includes('fp.keys[k] = down;'),
  'S key should remain backward movement in first-person photo mode via the shared WASD key handler (QA-007).'
);
assert(
  !uiSource.includes('if (k === "s" && down) { capturePhoto(); e.preventDefault(); return; }'),
  'First-person photo mode should not capture when pressing S.'
);
assert(
  !uiSource.includes('&& document.body.classList.contains("photo-mode")) {\n      e.preventDefault();\n      capturePhoto();'),
  'Global S-key handling should not capture photos while photo mode uses WASD movement.'
);
