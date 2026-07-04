// Creature first-person camera: syncCreaturePovCamera places the camera at a
// followed creature's eye center (midpoint of eyeParts[0] and eyeParts[2],
// falling back to an offset along the body's forward axis) looking out along its
// facing. setCreaturePovRenderHidden / restoreCreaturePovRenderHidden toggle the
// creature's own group.visible so it doesn't occlude its own view. The anchor is
// segments[0] when present (caterpillar/snail pattern) or group otherwise, matching
// the follow-camera gotcha in main.js. Module-scoped scratch vectors avoid per-frame allocation.
import * as THREE from "three";
import { state } from "./state.js";

/** World-units the POV camera lifts above the eye-center anchor before framing the shot. */
export const POV_EYE_LIFT = 0.35;
const POV_LOOK_DISTANCE = 8;

const _eyeA = new THREE.Vector3();
const _eyeB = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _lookAt = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _forward = new THREE.Vector3();
const _up = new THREE.Vector3();

let _hiddenCreature = null;
let _hiddenWasVisible = true;

function getCreaturePovAnchor(creature) {
  return creature?.segments?.[0] ?? creature?.group ?? null;
}

function getEyeCenter(creature, out) {
  const eyes = creature?.eyeParts;
  if (!eyes || eyes.length < 3 || !eyes[0] || !eyes[2]) return false;
  eyes[0].updateWorldMatrix(true, false);
  eyes[2].updateWorldMatrix(true, false);
  eyes[0].getWorldPosition(_eyeA);
  eyes[2].getWorldPosition(_eyeB);
  out.copy(_eyeA).add(_eyeB).multiplyScalar(0.5);
  return true;
}

/**
 * Place the camera at a followed creature's eye center (midpoint of
 * `eyeParts[0]`/`eyeParts[2]`, falling back to a forward-axis offset when eye
 * parts are absent) looking along its facing. Uses `segments[0]` as the
 * anchor when present (the caterpillar/snail pattern where meshes move
 * inside a static group), matching the follow-camera gotcha in main.js;
 * otherwise anchors to `group`. No-op (returns false) if the creature has
 * been detached from the scene.
 *
 * @param {THREE.Camera} camera - camera to reposition in place
 * @param {Object|null} controls - OrbitControls-like object; its `target` is synced too, if present
 * @param {Object} followedCreature - creature/caterpillar struct to view from
 * @returns {boolean} true if the camera was repositioned, false if the anchor was unavailable
 */
export function syncCreaturePovCamera(camera, controls, followedCreature) {
  const anchor = getCreaturePovAnchor(followedCreature);
  if (!camera || !anchor || !followedCreature?.group?.parent) return false;

  anchor.updateWorldMatrix(true, true);
  anchor.getWorldQuaternion(_quat);
  _forward.set(0, 0, 1).applyQuaternion(_quat).normalize();
  _up.set(0, 1, 0).applyQuaternion(_quat).normalize();

  if (!getEyeCenter(followedCreature, _pos)) {
    anchor.getWorldPosition(_pos);
    const ws = state.userSettings.worldScale ?? 1;
    const bodyScale = followedCreature.scale ?? 1;
    const radius = followedCreature.segRadius ?? 0.42;
    _pos.addScaledVector(_forward, radius * bodyScale * ws);
  }

  const liftScale = (followedCreature.scale ?? 1) * (state.userSettings.worldScale ?? 1);
  _pos.addScaledVector(_up, POV_EYE_LIFT * liftScale);
  _lookAt.copy(_pos).addScaledVector(_forward, POV_LOOK_DISTANCE * (state.userSettings.worldScale ?? 1));

  camera.position.copy(_pos);
  camera.lookAt(_lookAt);
  if (controls?.target) controls.target.copy(_lookAt);
  return true;
}

/** Restore the last hidden-for-POV creature's original `group.visible`, then clear the tracked ref. */
export function restoreCreaturePovRenderHidden() {
  if (!_hiddenCreature) return;
  if (_hiddenCreature.group) _hiddenCreature.group.visible = _hiddenWasVisible;
  _hiddenCreature = null;
}

/**
 * Hide a followed creature's own group so its POV camera doesn't render its
 * own body between it and the view. Restores any previously-hidden creature
 * first if the target has changed.
 *
 * @param {Object|null} followedCreature - creature to hide, or null/undefined to just restore
 */
export function setCreaturePovRenderHidden(followedCreature) {
  if (!followedCreature?.group) {
    restoreCreaturePovRenderHidden();
    return;
  }
  if (_hiddenCreature !== followedCreature) {
    restoreCreaturePovRenderHidden();
    _hiddenCreature = followedCreature;
  }
  _hiddenWasVisible = followedCreature.group.visible;
  followedCreature.group.visible = false;
}
