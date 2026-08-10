/**
 * World → screen, in CSS pixels.
 *
 * Split out of `observatory.js` when the tutorial's lenses needed the same
 * projection: a lens draws marks onto live subjects exactly the way a callout
 * draws a leader onto one, and two copies of this would drift.
 *
 * It does not live in `observatory-callouts.js`, which is deliberately free of
 * both three.js and the DOM so its geometry can be asserted in node. This
 * needs a camera and the window, so it is its own small module rather than a
 * reason to spoil that one.
 *
 * The overlay `<svg>` carries no viewBox, so its user units *are* CSS pixels
 * and the numbers returned here go straight into a path.
 */
import * as THREE from "three";

const scratch = new THREE.Vector3();

/**
 * Project a world object into CSS-pixel viewport coordinates.
 *
 * Returns null when the subject is behind the camera or outside the depth
 * range, which is the caller's signal to hide the mark rather than draw to a
 * point that is not on screen.
 *
 * @param {THREE.Object3D} object
 * @param {THREE.Camera} camera
 * @param {{x: number, y: number}} out written in place, so a per-frame caller
 *   allocates nothing
 * @returns {{x: number, y: number}|null}
 */
export function projectToViewport(object, camera, out) {
  if (!object || !camera) return null;
  object.updateWorldMatrix(true, false);
  object.getWorldPosition(scratch);
  return projectPoint(scratch, camera, out);
}

/**
 * The same projection for a bare world-space point.
 *
 * The lenses need this: a planted foot, a step target and a primitive centre
 * are positions the runtime already knows, not objects in the scene graph, and
 * giving each one an `Object3D` to be projected through would be a scene-graph
 * node per mark per frame.
 *
 * @param {{x: number, y: number, z: number}} point world space
 * @param {THREE.Camera} camera
 * @param {{x: number, y: number}} out
 * @returns {{x: number, y: number}|null}
 */
export function projectPoint(point, camera, out) {
  if (!point || !camera) return null;
  scratch.set(point.x, point.y, point.z);
  scratch.project(camera);
  if (scratch.z < -1 || scratch.z > 1) return null;
  out.x = (scratch.x * 0.5 + 0.5) * window.innerWidth;
  out.y = (-scratch.y * 0.5 + 0.5) * window.innerHeight;
  return out;
}
