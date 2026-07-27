/**
 * Leader-line geometry for the observatory's callouts.
 *
 * DOM-free so the shape can be tested without a browser: everything here takes
 * plain rectangles and points in CSS-pixel space and returns points in the
 * same space. The overlay `<svg>` deliberately carries no viewBox, so its user
 * units *are* CSS pixels and these numbers go straight into a path.
 *
 * The line runs anchor → elbow → label edge, rather than a straight rule: a
 * diagonal that turns and then runs flat into the text reads as drawn by hand
 * on a field sheet, which is the register this HUD is written in.
 */

/** Elbow angle, in radians. Shallow enough to read as a drawn line. */
const ELBOW_ANGLE = (35 * Math.PI) / 180;
/** How far the flat run into the label extends before the edge. */
const RUN_IN = 26;
/** Perpendicular bow on the diagonal leg, so it is not machine-straight. */
const SAG = 6;

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

/**
 * Which edge of the label the line should terminate on, and where.
 *
 * The nearest vertical edge wins: callouts are wider than they are tall and
 * their text runs horizontally, so a line arriving at the side reads as
 * pointing at the label while one arriving at the top or bottom reads as
 * crossing it.
 */
export function labelAttachment(anchor, label) {
  const midY = (label.top + label.bottom) / 2;
  // Aim at the label's vertical middle, but follow the anchor when the anchor
  // is above or below it, so a subject low on screen does not get a line into
  // the label's centre from underneath.
  const y = clamp(anchor.y, label.top + 6, label.bottom - 6);
  const side = anchor.x <= label.left ? "left" : "right";
  return {
    side,
    x: side === "left" ? label.left : label.right,
    y: Number.isFinite(y) ? y : midY,
  };
}

/**
 * Three points: the subject, an elbow, and the label edge.
 *
 * @param {{x: number, y: number}} anchor projected subject position
 * @param {{left: number, right: number, top: number, bottom: number}} label
 * @param {{width: number, height: number}} viewport
 * @returns {{points: Array<{x: number, y: number}>, side: string, path: string}}
 */
export function leaderPoints(anchor, label, viewport) {
  const width = viewport?.width ?? 0;
  const height = viewport?.height ?? 0;
  const start = {
    x: clamp(anchor?.x ?? 0, 0, width),
    y: clamp(anchor?.y ?? 0, 0, height),
  };
  const attach = labelAttachment(start, label);
  const end = {
    x: clamp(attach.x, 0, width),
    y: clamp(attach.y, 0, height),
  };

  // The elbow sits a fixed run-in from the label, at the point where a line
  // leaving the anchor at the elbow angle would have arrived. Clamped so a
  // subject very close to its label cannot fold the elbow past either end.
  const direction = attach.side === "left" ? -1 : 1;
  const elbowX = clamp(
    end.x + direction * RUN_IN,
    Math.min(start.x, end.x),
    Math.max(start.x, end.x),
  );
  const dropX = Math.abs(elbowX - start.x);
  const elbowY = clamp(
    start.y + Math.sign(end.y - start.y) * dropX * Math.tan(ELBOW_ANGLE),
    Math.min(start.y, end.y),
    Math.max(start.y, end.y),
  );
  const elbow = {
    x: clamp(elbowX, 0, width),
    y: clamp(elbowY, 0, height),
  };

  // Bow the diagonal leg perpendicular to itself. The control point is the
  // midpoint pushed sideways, which is a quadratic that never overshoots
  // either endpoint.
  const legX = elbow.x - start.x;
  const legY = elbow.y - start.y;
  const legLength = Math.hypot(legX, legY) || 1;
  const control = {
    x: (start.x + elbow.x) / 2 + (-legY / legLength) * SAG,
    y: (start.y + elbow.y) / 2 + (legX / legLength) * SAG,
  };

  return {
    side: attach.side,
    points: [start, elbow, end],
    path:
      `M${start.x.toFixed(1)} ${start.y.toFixed(1)}` +
      `Q${control.x.toFixed(1)} ${control.y.toFixed(1)} ${elbow.x.toFixed(1)} ${elbow.y.toFixed(1)}` +
      `L${end.x.toFixed(1)} ${end.y.toFixed(1)}`,
  };
}

/**
 * Does `box` overlap any reserved rectangle?
 *
 * Split out from placement so the caller can hand in rects it cached on the
 * slow tick — measuring them per callout per frame is what made the 60Hz
 * version a style-recalculation problem.
 */
export function overlapsAny(box, reserved) {
  for (const rect of reserved ?? []) {
    if (
      box.left < rect.right &&
      box.right > rect.left &&
      box.top < rect.bottom &&
      box.bottom > rect.top
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Choose where a callout sits: beside its subject if that is clear, flipped to
 * the subject's other side if not, and lifted clear of whatever blocks it if
 * neither side works at the subject's own height.
 *
 * The lift matters more than it sounds. The dock alone reserves a 700x136 band
 * across the lower middle of the viewport, and a subject standing in front of
 * it had nowhere to go on its own row — every callout simply vanished. A label
 * raised above the panel with a leader still reaching down to the subject is
 * both legible and honest about what it points at.
 *
 * @returns {{left: number, top: number}|null} null when nothing fits
 */
export function placeCallout(anchor, size, reserved, viewport, margin = 32) {
  const width = viewport?.width ?? 0;
  const height = viewport?.height ?? 0;
  const lefts = [anchor.x, anchor.x - size.width - size.gap];

  const tops = [anchor.y];
  for (const rect of reserved ?? []) {
    // Only rects that actually straddle the subject's row are worth escaping.
    if (anchor.y + size.height > rect.top && anchor.y < rect.bottom) {
      tops.push(rect.top - size.height - 10);
    }
  }
  // Nearest lift first, so a callout rises no further than it has to.
  tops.sort((a, b) => Math.abs(a - anchor.y) - Math.abs(b - anchor.y));

  for (const top of tops) {
    if (top < 0 || top + size.height > height) continue;
    for (const left of lefts) {
      if (left < margin || left + size.width > width - margin / 2) continue;
      const box = {
        left,
        right: left + size.width,
        top: top - 4,
        bottom: top + size.height,
      };
      if (!overlapsAny(box, reserved)) return { left, top };
    }
  }
  return null;
}
