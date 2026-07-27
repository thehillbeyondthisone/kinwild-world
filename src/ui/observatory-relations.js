/**
 * Field relations: the affordance web behind the observatory's relations
 * panel.
 *
 * DOM-free and deterministic on purpose. The panel used to be a hardcoded SVG
 * triangle, and the graph that replaces it has to lay out identically for the
 * same seed every time it is rebuilt — a force solver would settle differently
 * on every regen and make the panel a source of visual noise rather than a
 * reading of the field. There is no solver here: selection is a total order,
 * placement is a closed-form spiral, and linkage is nearest-neighbour.
 */

/**
 * The four legible categories. Seven affordance types is more than a 79px
 * legend can carry, and the distinctions that matter to a reader are what the
 * plant offers, not which renderer emitted it.
 */
export const RELATION_CATEGORIES = Object.freeze([
  "nourish",
  "shelter",
  "attune",
  "unknown",
]);

const CATEGORY_BY_TYPE = Object.freeze({
  nectar: "nourish",
  pollen: "nourish",
  forage: "nourish",
  shelter: "shelter",
  "soft-cover": "shelter",
  perch: "attune",
  landmark: "attune",
});

/** Golden angle — the divergence that makes a phyllotaxis spiral even. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function relationCategory(type) {
  return CATEGORY_BY_TYPE[type] ?? "unknown";
}

/**
 * Count every affordance by category. Read by the legend, which reports the
 * whole field rather than only the nodes that fit on the plot.
 */
export function relationTotals(affordances) {
  const totals = Object.fromEntries(RELATION_CATEGORIES.map((key) => [key, 0]));
  for (const affordance of affordances ?? []) {
    totals[relationCategory(affordance?.type)] += 1;
  }
  return totals;
}

function byRank(a, b) {
  // Capacity first — an affordance that can serve six creatures says more
  // about the field than one that serves one — then floraKey and ordinal, so
  // the order is total and two runs over the same registrations can never
  // disagree.
  const capacity = (b?.capacity ?? 0) - (a?.capacity ?? 0);
  if (capacity !== 0) return capacity;
  const key = String(a?.floraKey ?? "").localeCompare(String(b?.floraKey ?? ""));
  if (key !== 0) return key;
  return (a?.ordinal ?? 0) - (b?.ordinal ?? 0);
}

/**
 * Pick the nodes worth drawing: the best of each category in turn, until the
 * plot is full.
 *
 * Straight capacity ranking gave every seat to nectar — a real field carries
 * three times as much of it as anything else, and it has the largest capacity
 * figures — so the plot came out one solid colour against a four-colour
 * legend. Round-robin keeps the top of each category on the plot while still
 * ranking within a category by capacity.
 */
function selectNodes(affordances, nodeCount) {
  const budget = Math.max(0, nodeCount);
  const buckets = RELATION_CATEGORIES.map((category) =>
    (affordances ?? [])
      .filter((affordance) => relationCategory(affordance?.type) === category)
      .sort(byRank),
  );
  const picked = [];
  for (let round = 0; picked.length < budget; round++) {
    let placedThisRound = false;
    for (const bucket of buckets) {
      if (picked.length >= budget) break;
      if (round >= bucket.length) continue;
      picked.push(bucket[round]);
      placedThisRound = true;
    }
    if (!placedThisRound) break;
  }
  return picked;
}

/**
 * Build the drawable graph.
 *
 * @param {Array<object>} affordances runtime.registrations.affordances
 * @param {{nodeCount?: number, width?: number, height?: number, padding?: number}} [options]
 * @returns {{nodes: Array<object>, links: Array<object>, totals: object, count: number}}
 */
export function buildRelationGraph(affordances, options = {}) {
  const {
    nodeCount = 7,
    width = 180,
    height = 74,
    padding = 11,
  } = options;

  const selected = selectNodes(affordances, nodeCount);
  const totals = relationTotals(affordances);
  if (selected.length === 0) {
    return { nodes: [], links: [], totals, count: 0 };
  }

  // Phyllotaxis: r = sqrt((i + 0.5) / n) spreads points evenly over a disc
  // with no relaxation pass. The disc is then squashed into the panel's
  // rectangle, which is wider than it is tall.
  const centerX = width / 2;
  const centerY = height / 2;
  const radiusX = centerX - padding;
  const radiusY = centerY - padding;
  const nodes = selected.map((affordance, index) => {
    const radius = Math.sqrt((index + 0.5) / selected.length);
    const angle = index * GOLDEN_ANGLE;
    return {
      id: `${affordance?.floraKey ?? "flora"}:${affordance?.ordinal ?? index}`,
      category: relationCategory(affordance?.type),
      type: affordance?.type ?? "unknown",
      capacity: affordance?.capacity ?? 0,
      floraKey: affordance?.floraKey ?? "",
      // Larger dots for larger capacity, over a deliberately narrow range —
      // this is a diagram, not a bubble chart.
      radius: 3.2 + Math.min(1, (affordance?.capacity ?? 0) / 8) * 2.6,
      x: centerX + Math.cos(angle) * radius * radiusX,
      y: centerY + Math.sin(angle) * radius * radiusY,
    };
  });

  // Each node reaches for its two nearest neighbours; pairs are keyed low-high
  // so a mutual choice is stored once. The result is connected in practice and
  // never a hairball.
  const seen = new Set();
  const links = [];
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    const neighbours = nodes
      .map((other, otherIndex) => ({
        otherIndex,
        distance: Math.hypot(other.x - node.x, other.y - node.y),
      }))
      .filter((entry) => entry.otherIndex !== index)
      .sort((a, b) => a.distance - b.distance || a.otherIndex - b.otherIndex)
      .slice(0, 2);
    for (const neighbour of neighbours) {
      const low = Math.min(index, neighbour.otherIndex);
      const high = Math.max(index, neighbour.otherIndex);
      const key = `${low}-${high}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({
        from: low,
        to: high,
        x1: nodes[low].x,
        y1: nodes[low].y,
        x2: nodes[high].x,
        y2: nodes[high].y,
      });
    }
  }

  return { nodes, links, totals, count: links.length };
}
