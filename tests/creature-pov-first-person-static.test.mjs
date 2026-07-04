// QA-009: syncCreaturePovCamera / setCreaturePovRenderHidden /
// restoreCreaturePovRenderHidden are pure, DOM-free functions (src/creaturePov.js)
// and are exercised here with real THREE.js objects instead of grepping their
// source text. The eye-lift constant is imported directly. The remaining
// checks (main.js render-loop wiring, ui.js stroll-entry follow-target
// preservation, grass.js pusher population) only exist as integration glue
// inside modules that touch the DOM/WebGL at import time (main.js) or as
// closures inside ui.js's initUi() — those stay as source-text assertions.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

globalThis.__APP_VERSION__ = 'test';

const mainSource = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const uiSource = ["ui.js","ui/context.js","ui/constants.js","ui/storage.js","ui/settings-panel.js","ui/help-panel.js","ui/catalog-panel.js","ui/locator-panel.js","ui/first-person.js","ui/photo-mode.js","ui/input.js"].map((p) => readFileSync(new URL("../src/" + p, import.meta.url), "utf8")).join("\n");
const grassSource = readFileSync(new URL('../src/grass.js', import.meta.url), 'utf8');

const { syncCreaturePovCamera, setCreaturePovRenderHidden, restoreCreaturePovRenderHidden, POV_EYE_LIFT } =
  await import('../src/creaturePov.js');

// Protected invariant: creature POV sits POV_EYE_LIFT units above the
// creature's anchor and looks out along the anchor's forward axis; hiding a
// followed creature's render group is reversible.
assert.equal(POV_EYE_LIFT, 0.35, 'Creature POV camera should sit 0.35 units above the anchor.');

function makeFakeCreature() {
  const parent = new THREE.Object3D();
  const group = new THREE.Object3D();
  parent.add(group);
  group.position.set(5, 0, 5);
  return { group, scale: 1, segRadius: 0.42 };
}

{
  const creature = makeFakeCreature();
  const camera = new THREE.PerspectiveCamera();
  const controls = { target: new THREE.Vector3() };
  const ok = syncCreaturePovCamera(camera, controls, creature);
  assert.equal(ok, true, 'syncCreaturePovCamera should succeed for a creature attached to the scene');
  assert.ok(camera.position.y > creature.group.position.y, 'the POV camera should be lifted above the anchor position');
  assert.notDeepEqual(controls.target, new THREE.Vector3(0, 0, 0), 'orbit controls target should be moved to the creature look-at point');
}

{
  // No parent — creature isn't in the scene (e.g. mid-teardown) — must fail closed.
  const group = new THREE.Object3D();
  const creature = { group, scale: 1 };
  const camera = new THREE.PerspectiveCamera();
  const ok = syncCreaturePovCamera(camera, null, creature);
  assert.equal(ok, false, 'syncCreaturePovCamera should decline when the creature has no scene parent');
}

{
  const creature = makeFakeCreature();
  setCreaturePovRenderHidden(creature);
  assert.equal(creature.group.visible, false, 'the followed creature should be hidden while its POV is active');
  restoreCreaturePovRenderHidden();
  assert.equal(creature.group.visible, true, 'restoring should bring the creature back to its prior visibility');
}

assert(
  mainSource.includes('syncCreaturePovCamera(camera, controls, followedCreature)'),
  'First-person camera updates should switch to the followed creature POV when a follow target exists.'
);

assert(
  mainSource.includes('setCreaturePovRenderHidden(followedCreature)'),
  'The followed creature render group should be hidden while first-person creature POV is active.'
);

const enterStrollStart = uiSource.indexOf('function enterStroll()');
const exitStrollStart = uiSource.indexOf('function exitStroll()');
assert(enterStrollStart > -1 && exitStrollStart > enterStrollStart, 'test should locate first-person stroll entry body');
const enterStrollBody = uiSource.slice(enterStrollStart, exitStrollStart);

assert(
  !enterStrollBody.includes('setFollowTarget(null);'),
  'Entering first-person stroll while following a creature should preserve that follow target for creature POV.'
);

assert(
  uiSource.includes('canvas.requestPointerLock?.().catch(() => {});'),
  'First-person entry should swallow pointer-lock rejection so unsupported browser contexts do not emit an unhandled error.'
);

assert(
  grassSource.includes('for (const c of state.creatures)') &&
    !grassSource.includes('if (!c.group || !c.group.visible) continue;'),
  'Grass pushers should still be populated from creature state even when a followed creature is hidden from rendering.'
);
