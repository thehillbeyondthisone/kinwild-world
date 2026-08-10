/**
 * The overlay a lens is drawn on.
 *
 * This module is the view, exactly as `tutorial-notes.js` is the view over the
 * onboarding's state machine: what a lens *means* lives in
 * `src/tutorial/lenses.js` and is asserted in node; everything here only knows
 * how to put a dot, a ring, a line or a small word on the glass and keep it
 * over its subject while the field moves.
 *
 * Marks are patched by key rather than rebuilt. A lens redraws every frame it
 * is open, and replacing the overlay's children at 60Hz is a
 * style-recalculation problem — the same one the observatory's callouts hit
 * and solved by caching.
 *
 * The `<svg>` carries no viewBox, so its user units are CSS pixels and a
 * projected point goes straight into an attribute.
 */
import * as THREE from "three";
import { projectPoint } from "./viewport-project.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Marks smaller than this are not worth the ink; a lens at distance fades out. */
const MIN_PIXEL_RADIUS = 1.5;

const scratchPoint = new THREE.Vector3();
const scratchEdge = new THREE.Vector3();
const scratchRight = new THREE.Vector3();
const projected = { x: 0, y: 0 };
const projectedEdge = { x: 0, y: 0 };

/**
 * A mark's point, out of its own frame and into the world.
 *
 * `world` marks are in the living world's frame (an affordance record, a
 * planted foot) and `actor` marks are local to one kin (a primitive centre),
 * which is what welds the underdrawing to a body as it walks.
 */
function toWorld(out, at, space, roots) {
  out.set(at[0], at[1], at[2]);
  const root = space === "actor" ? roots.actorRoot : roots.worldRoot;
  if (root) {
    root.updateWorldMatrix(true, false);
    out.applyMatrix4(root.matrixWorld);
  }
  return out;
}

/**
 * How many CSS pixels a world-space radius covers at that point.
 *
 * Measured rather than assumed: the centre and a point one radius to the
 * camera's right are both projected and the distance between them taken. A
 * fixed pixel size would make an affordance's reach a lie at every distance
 * but one, and reach is the whole content of that ring.
 */
function radiusInPixels(worldCentre, worldRadius, camera, scale) {
  scratchRight.setFromMatrixColumn(camera.matrixWorld, 0);
  scratchEdge.copy(worldCentre).addScaledVector(scratchRight, worldRadius * scale);
  if (!projectPoint(worldCentre, camera, projected)) return null;
  if (!projectPoint(scratchEdge, camera, projectedEdge)) return null;
  return Math.hypot(projectedEdge.x - projected.x, projectedEdge.y - projected.y);
}

function makeNode(kind) {
  if (kind === "link") return document.createElementNS(SVG_NS, "line");
  if (kind === "tag") return document.createElementNS(SVG_NS, "text");
  return document.createElementNS(SVG_NS, "circle");
}

/**
 * Wire the lens overlay. Markup lives in index.html (`#lens-layer`), as with
 * every other panel.
 */
export function initLensLayer() {
  const svg = document.getElementById("lens-marks");
  const nodes = new Map();
  let live = new Set();

  /** The largest axis of a root's world scale, for sizing world radii. */
  function rootScale(root) {
    if (!root) return 1;
    root.updateWorldMatrix(true, false);
    scratchEdge.setFromMatrixScale(root.matrixWorld);
    return Math.max(scratchEdge.x, scratchEdge.y, scratchEdge.z) || 1;
  }

  function nodeFor(mark) {
    let entry = nodes.get(mark.key);
    if (entry && entry.kind !== mark.kind) {
      entry.node.remove();
      entry = null;
    }
    if (!entry) {
      const node = makeNode(mark.kind);
      node.setAttribute("class", `lens-mark lens-${mark.kind} lens-weight-${mark.weight}`);
      svg.append(node);
      entry = { node, kind: mark.kind };
      nodes.set(mark.key, entry);
    }
    return entry.node;
  }

  return {
    /**
     * Draw one lens's marks.
     *
     * @param {Array<object>} marks from `src/tutorial/lenses.js`
     * @param {{camera: THREE.Camera, worldRoot?: THREE.Object3D,
     *          actorRoot?: THREE.Object3D}} context
     */
    draw(marks, context) {
      const { camera } = context ?? {};
      if (!svg || !camera) return;
      const roots = {
        worldRoot: context.worldRoot ?? null,
        actorRoot: context.actorRoot ?? null,
      };
      const worldScale = rootScale(roots.worldRoot);
      const actorScale = rootScale(roots.actorRoot);
      live = new Set();

      for (const mark of marks ?? []) {
        const scale = mark.space === "actor" ? actorScale : worldScale;

        if (mark.kind === "link") {
          toWorld(scratchPoint, mark.from, mark.space, roots);
          const from = projectPoint(scratchPoint, camera, projected)
            ? { x: projected.x, y: projected.y }
            : null;
          toWorld(scratchPoint, mark.to, mark.space, roots);
          const to = projectPoint(scratchPoint, camera, projectedEdge)
            ? { x: projectedEdge.x, y: projectedEdge.y }
            : null;
          // A line with one end off screen is a line to nowhere; drop it
          // rather than pin it to the frame edge and imply a subject there.
          if (!from || !to) continue;
          const node = nodeFor(mark);
          node.setAttribute("x1", from.x.toFixed(1));
          node.setAttribute("y1", from.y.toFixed(1));
          node.setAttribute("x2", to.x.toFixed(1));
          node.setAttribute("y2", to.y.toFixed(1));
          node.removeAttribute("visibility");
          live.add(mark.key);
          continue;
        }

        toWorld(scratchPoint, mark.at, mark.space, roots);
        let radius = null;
        if (mark.radius !== null && mark.radius !== undefined) {
          radius = radiusInPixels(scratchPoint, mark.radius, camera, scale);
          if (radius === null || radius < MIN_PIXEL_RADIUS) continue;
        }
        if (!projectPoint(scratchPoint, camera, projected)) continue;

        const node = nodeFor(mark);
        if (mark.kind === "tag") {
          node.setAttribute("x", (projected.x + 8).toFixed(1));
          node.setAttribute("y", (projected.y - 8).toFixed(1));
          if (node.textContent !== mark.text) node.textContent = mark.text;
        } else {
          node.setAttribute("cx", projected.x.toFixed(1));
          node.setAttribute("cy", projected.y.toFixed(1));
          node.setAttribute("r", (radius ?? mark.size).toFixed(1));
        }
        node.removeAttribute("visibility");
        live.add(mark.key);
      }

      // Sweep: anything not drawn this pass is hidden rather than removed, so a
      // foot that walks behind the island and back does not churn the DOM.
      for (const [key, entry] of nodes) {
        if (!live.has(key)) entry.node.setAttribute("visibility", "hidden");
      }
    },

    /** Take every mark down — a regen, or the lens being switched off. */
    clear() {
      for (const entry of nodes.values()) entry.node.remove();
      nodes.clear();
      live = new Set();
    },
  };
}
