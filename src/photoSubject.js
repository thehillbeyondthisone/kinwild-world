import * as THREE from "three";
import { buildCatalogSubject } from "./catalog.js";

const centerNdc = new THREE.Vector2(0, 0);

/**
 * Walk an object's ancestor chain looking for a Field Guide catalog subject
 * tagged in `userData.catalog`, reconstructing the full subject via
 * `buildCatalogSubject` if only the loose `{category, variant, biomeId}`
 * shape is present.
 *
 * @param {THREE.Object3D} object - hit object to start the ancestor walk from
 * @returns {Object|null} catalog subject, or null if none found up the chain
 */
export function getCatalogSubjectFromObject(object) {
  let cursor = object;
  while (cursor) {
    const catalog = cursor.userData?.catalog;
    if (catalog?.key) return catalog;
    if (catalog?.category && catalog?.variant && catalog?.biomeId) {
      return buildCatalogSubject(catalog);
    }
    cursor = cursor.parent;
  }
  return null;
}

/**
 * Find the nearest raycast hit whose ancestor chain resolves to a catalog subject.
 *
 * @param {THREE.Intersection[]} hits - raycaster intersection results
 * @returns {{subject: Object, object: THREE.Object3D, hit: THREE.Intersection}|null}
 */
export function findCatalogSubjectInHits(hits) {
  const sortedHits = [...hits].sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
  for (const hit of sortedHits) {
    const subject = getCatalogSubjectFromObject(hit.object);
    if (subject) return { subject, object: hit.object, hit };
  }
  return null;
}

/**
 * Resolve which catalog subject a photo-mode capture is aimed at, by
 * raycasting from screen center against the scene root. This is what the
 * shutter click uses to know what was framed.
 *
 * @param {Object} args
 * @param {THREE.Camera} args.camera - active camera (raycast origin/direction)
 * @param {THREE.Object3D} args.root - scene subtree to raycast against
 * @param {THREE.Raycaster} [args.raycaster] - raycaster instance to reuse
 * @returns {{subject: Object, object: THREE.Object3D, hit: THREE.Intersection}|null}
 */
export function findPhotoCatalogSubject({ camera, root, raycaster = new THREE.Raycaster() }) {
  if (!camera || !root) return null;
  raycaster.setFromCamera(centerNdc, camera);
  return findCatalogSubjectInHits(raycaster.intersectObject(root, true));
}
