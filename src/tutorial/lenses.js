/**
 * What a lens draws, as plain data.
 *
 * A lens is one of the engine's own debugging views handed to the player. The
 * ecology has needed an affordance view since it was written; the body has
 * needed a carrier view since the shell was ported. Rather than build three
 * overlays, the three agree on one vocabulary of marks, and this module turns
 * runtime data into that vocabulary. The renderer (`src/ui/lens-layer.js`)
 * knows how to draw a mark and nothing about what any of them mean.
 *
 * DOM-free and three-free on purpose, like `genome-draft.js` under the card:
 * every builder here takes plain arrays of numbers and returns plain objects,
 * so what a lens *says* can be asserted in node. Projection, and the matrices
 * that resolve `space`, belong to the renderer.
 *
 * Two rules carried over from the notebook's other paper:
 *
 * - **Weight, never colour.** Groups are distinguished by how heavily the mark
 *   is inked. A four-colour key would read as an inspector overlay, and the
 *   whole point is that this reads as a drawing.
 * - **Marks are keyed.** A lens redraws while the field moves, so every mark
 *   carries a stable identity and the renderer patches nodes instead of
 *   rebuilding the overlay each frame.
 */

/**
 * The coordinate frame a mark's points are written in.
 *
 * - `world` — the living world's own frame, which is what the runtime stores
 *   affordances in and what a walker reports its feet in (they are built from
 *   `root.position` and a surface sample, so they are already out of the
 *   actor).
 * - `actor` — local to a kin's root, which is what a primitive snapshot is.
 *   The renderer resolves these through the agent's own matrix, so a mark
 *   stays welded to the body as it walks.
 */
export const MARK_SPACES = Object.freeze(["world", "actor"]);

/** Every kind of mark the renderer knows how to draw. */
export const MARK_KINDS = Object.freeze(["dot", "ring", "link", "tag"]);

/** Ink weights. Three is as many as stay distinguishable in pencil. */
export const MAX_WEIGHT = 3;

function point(value) {
  return [Number(value?.[0]) || 0, Number(value?.[1]) || 0, Number(value?.[2]) || 0];
}

function dot(key, at, { space = "world", weight = 1, size = 4 } = {}) {
  return { kind: "dot", key, space, at: point(at), weight, size };
}

function ring(key, at, { space = "world", weight = 1, size = 7, radius = null } = {}) {
  return { kind: "ring", key, space, at: point(at), weight, size, radius };
}

function link(key, from, to, { space = "world", weight = 1 } = {}) {
  return { kind: "link", key, space, from: point(from), to: point(to), weight };
}

function tag(key, at, text, { space = "world", weight = 1 } = {}) {
  return { kind: "tag", key, space, at: point(at), text: String(text), weight };
}

/**
 * The gait, drawn under a walking kin.
 *
 * The reveal is that the dots do not move. A foot is planted in the world and
 * stays there while the body travels away from it, until the error grows past
 * what the genome allows and the foot swings to a new home — which is the
 * whole of `walker.js`'s step trigger, made visible without a word of
 * explanation. The ring is where a swinging foot is going; the line is drawn
 * only for the foot actually in flight, so at most one or two exist at a time
 * and the frame never fills with lines.
 *
 * Phase groups are ink weight, not colour: a trot is two weights alternating,
 * a tripod is three.
 *
 * @param {Array<{planted: number[], target: number[], stepping: boolean, gaitGroup: number}>} feet
 *   as reported by `agent.debug.feet()`
 * @returns {Array<object>} marks in world space
 */
export function gaitMarks(feet) {
  const marks = [];
  const list = Array.isArray(feet) ? feet : [];
  for (let index = 0; index < list.length; index++) {
    const foot = list[index];
    if (!foot) continue;
    const weight = Math.min(MAX_WEIGHT, (Number(foot.gaitGroup) || 0) + 1);
    marks.push(dot(`foot:${index}`, foot.planted, { weight, size: 5 }));
    if (!foot.stepping) continue;
    // Only a foot in flight has anywhere to be going. A planted foot's target
    // is its own position, and drawing that would put a ring under every dot
    // and say nothing.
    marks.push(ring(`aim:${index}`, foot.target, { weight, size: 8 }));
    marks.push(link(`swing:${index}`, foot.planted, foot.target, { weight }));
  }
  return marks;
}

/**
 * The underdrawing: the shapes a body is actually made of.
 *
 * A kin is a handful of capsules and spheres whose meshes are pulled onto the
 * smooth-min surface of the set they belong to, so the joins are not joins.
 * Drawn as construction shapes, that is a naturalist blocking in an animal
 * before smoothing it — which is the honest picture, and cheaper to look at
 * than to explain.
 *
 * The edges are the blend graph, and they are the point: a primitive blends
 * with the ones it is *jointed* to, never merely the ones it is near, which is
 * why a foot passing a thigh does not weld to it. `influences[i]` lists i's
 * neighbours (the primitive's own index is prepended when the shader's list is
 * packed, so it is not in here), and the lists are symmetric by construction,
 * so each join is emitted once.
 *
 * @param {Array<{position: number[], scale: number[]}>} primitives
 *   as reported by `agent.debug.primitiveSnapshot()`
 * @param {number[][]} influences one neighbour list per primitive
 * @returns {Array<object>} marks in actor space
 */
export function underdrawingMarks(primitives, influences) {
  const marks = [];
  const list = Array.isArray(primitives) ? primitives : [];
  const lists = Array.isArray(influences) ? influences : [];

  for (let index = 0; index < list.length; index++) {
    const primitive = list[index];
    if (!primitive) continue;
    const scale = primitive.scale ?? [1, 1, 1];
    const spread = Math.max(Number(scale[0]) || 0, Number(scale[2]) || 0);
    marks.push(
      ring(`carrier:${index}`, primitive.position, {
        space: "actor",
        weight: 1,
        // A carrier is drawn at its own size, so the body reads as the shapes
        // it is rather than as a constellation of equal pips.
        radius: Math.max(0.02, spread * 0.5),
      }),
    );
  }

  const drawn = new Set();
  for (let index = 0; index < lists.length; index++) {
    const neighbors = lists[index];
    if (!Array.isArray(neighbors)) continue;
    for (const neighbor of neighbors) {
      if (!Number.isInteger(neighbor) || neighbor === index) continue;
      if (!list[index] || !list[neighbor]) continue;
      const a = Math.min(index, neighbor);
      const b = Math.max(index, neighbor);
      const key = `${a}-${b}`;
      if (drawn.has(key)) continue;
      drawn.add(key);
      marks.push(
        link(`joint:${key}`, list[a].position, list[b].position, {
          space: "actor",
          weight: 2,
        }),
      );
    }
  }
  return marks;
}

/**
 * What the field is offering, and what one kin is about to take.
 *
 * Every mark here is one string out of a plant's own genome: an archetype
 * advertises `["nectar", "perch"]` and the lens draws exactly those, which is
 * why toggling it on a spire is a genome being rendered rather than a legend
 * being consulted. The predicted target is inked heaviest and named, because
 * Layer 3 asks the player to guess it before it is taken.
 *
 * @param {Array<{type: string, x: number, y: number, z: number, radius: number, ordinal: number}>} affordances
 *   `state.livingWorld.registrations.affordances`
 * @param {{types?: string[], predicted?: number|null, named?: boolean}} [options]
 *   `types` filters to the affordance strings worth showing; `predicted` is the
 *   ordinal a kin is currently going to.
 * @returns {Array<object>} marks in world space
 */
export function affordanceMarks(affordances, options = {}) {
  const marks = [];
  const list = Array.isArray(affordances) ? affordances : [];
  const types = Array.isArray(options.types) && options.types.length ? new Set(options.types) : null;
  const predicted = Number.isInteger(options.predicted) ? options.predicted : null;

  for (const record of list) {
    if (!record || (types && !types.has(record.type))) continue;
    const at = [record.x, record.y, record.z];
    const chosen = predicted !== null && record.ordinal === predicted;
    const key = `aff:${record.ordinal}`;
    marks.push(
      dot(key, at, { weight: chosen ? MAX_WEIGHT : 1, size: chosen ? 6 : 3 }),
    );
    if (!chosen) continue;
    // The reach is drawn only for the one being gone to. Ringing all of them
    // would cover the island — there are a couple of hundred.
    marks.push(
      ring(`${key}:reach`, at, {
        weight: 2,
        radius: Math.max(0.1, Number(record.radius) || 0),
      }),
    );
    if (options.named !== false) marks.push(tag(`${key}:name`, at, record.type, { weight: 2 }));
  }
  return marks;
}
