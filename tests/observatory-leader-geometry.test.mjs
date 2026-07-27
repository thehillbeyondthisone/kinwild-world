import assert from "node:assert/strict";
import {
  labelAttachment,
  leaderPoints,
  overlapsAny,
  placeCallout,
} from "../src/ui/observatory-callouts.js";

const viewport = { width: 1280, height: 720 };
const label = { left: 700, right: 880, top: 300, bottom: 362 };

// A leader is exactly three points: subject, elbow, label edge.
const right = leaderPoints({ x: 420, y: 520 }, label, viewport);
assert.equal(right.points.length, 3, "a leader is subject, elbow and edge");
assert.equal(right.side, "left", "a subject left of the label attaches to its left edge");
assert.equal(right.points[2].x, label.left, "the line should terminate on the label edge");

const fromRight = leaderPoints({ x: 1100, y: 200 }, label, viewport);
assert.equal(fromRight.side, "right");
assert.equal(fromRight.points[2].x, label.right);

// The nearest vertical edge always wins — a line into the top or bottom would
// cross the text rather than point at it.
for (const x of [0, 300, 699, 701, 900, 1279]) {
  const leader = leaderPoints({ x, y: 331 }, label, viewport);
  const expected = x <= label.left ? label.left : label.right;
  assert.equal(leader.points[2].x, expected, `subject at x=${x} attaches to the near edge`);
}

// Termination stays on the label's own span, never off its corner.
for (const y of [0, 120, 331, 600, 719]) {
  const leader = leaderPoints({ x: 300, y }, label, viewport);
  const end = leader.points[2];
  assert.ok(
    end.y >= label.top && end.y <= label.bottom,
    `subject at y=${y} should attach within the label's height, got ${end.y}`,
  );
}

// Everything stays on screen, including for subjects pinned at the edges.
for (const anchor of [
  { x: 0, y: 0 },
  { x: 1280, y: 720 },
  { x: -400, y: 900 },
  { x: 5000, y: -200 },
]) {
  const leader = leaderPoints(anchor, label, viewport);
  for (const point of leader.points) {
    assert.ok(
      point.x >= 0 && point.x <= viewport.width,
      `x ${point.x} should stay inside the viewport`,
    );
    assert.ok(
      point.y >= 0 && point.y <= viewport.height,
      `y ${point.y} should stay inside the viewport`,
    );
  }
  assert.ok(/^M[\d.]+ [\d.]+Q[\d.]+ [\d.]+ [\d.]+ [\d.]+L[\d.]+ [\d.]+$/.test(leader.path));
  assert.ok(!leader.path.includes("NaN"), "a NaN path silently draws nothing");
}

// The elbow lies between the subject and the edge on both axes: a leader that
// overshoots and doubles back reads as a glitch, not a drawn line.
for (const anchor of [{ x: 200, y: 100 }, { x: 1200, y: 690 }, { x: 690, y: 340 }]) {
  const [start, elbow, end] = leaderPoints(anchor, label, viewport).points;
  assert.ok(
    elbow.x >= Math.min(start.x, end.x) - 0.01 &&
      elbow.x <= Math.max(start.x, end.x) + 0.01,
    "the elbow should not overshoot horizontally",
  );
  assert.ok(
    elbow.y >= Math.min(start.y, end.y) - 0.01 &&
      elbow.y <= Math.max(start.y, end.y) + 0.01,
    "the elbow should not overshoot vertically",
  );
}

// A subject sitting on top of its own label degenerates rather than explodes.
const overlapping = leaderPoints({ x: 790, y: 331 }, label, viewport);
assert.equal(overlapping.points.length, 3);
assert.ok(!overlapping.path.includes("NaN"));

// labelAttachment is the same decision, exposed on its own.
assert.equal(labelAttachment({ x: 10, y: 331 }, label).side, "left");
assert.equal(labelAttachment({ x: 1270, y: 331 }, label).side, "right");

// Collision helpers.
const reserved = [{ left: 600, right: 900, top: 280, bottom: 400 }];
assert.equal(overlapsAny({ left: 650, right: 700, top: 300, bottom: 320 }, reserved), true);
assert.equal(overlapsAny({ left: 100, right: 200, top: 300, bottom: 320 }, reserved), false);
assert.equal(overlapsAny({ left: 100, right: 200, top: 0, bottom: 10 }, undefined), false);

const size = { width: 180, height: 62, gap: 25 };
assert.deepEqual(
  placeCallout({ x: 300, y: 100 }, size, reserved, viewport),
  { left: 300, top: 100 },
  "a clear subject keeps its callout beside it",
);
const narrowPanel = [{ left: 700, right: 780, top: 280, bottom: 400 }];
assert.deepEqual(
  placeCallout({ x: 690, y: 300 }, size, narrowPanel, viewport),
  { left: 690 - size.width - size.gap, top: 300 },
  "a blocked callout should flip to the subject's other side before it moves",
);

// The dock reserves a band right across the lower middle of the viewport. A
// subject standing in front of it has no room on either side at its own
// height, and used to lose its callout entirely.
const band = [{ left: 300, right: 1100, top: 400, bottom: 540 }];
const lifted = placeCallout({ x: 600, y: 430 }, size, band, viewport);
assert.ok(lifted, "a callout blocked on both sides should lift clear, not vanish");
assert.ok(lifted.top + size.height <= 400, "the lift should clear the blocking panel");
assert.ok(
  Math.abs(lifted.top - 430) < 200,
  "the lift should be the nearest escape, not an arbitrary jump",
);

// Two panels stacked around the subject: it should take the nearer escape.
const nearestFirst = placeCallout(
  { x: 600, y: 430 },
  size,
  [
    { left: 300, right: 1100, top: 425, bottom: 470 },
    { left: 300, right: 1100, top: 200, bottom: 300 },
  ],
  viewport,
);
assert.ok(nearestFirst, "a subject between panels should still place");
assert.ok(
  !overlapsAny(
    {
      left: nearestFirst.left,
      right: nearestFirst.left + size.width,
      top: nearestFirst.top - 4,
      bottom: nearestFirst.top + size.height,
    },
    [
      { left: 300, right: 1100, top: 425, bottom: 470 },
      { left: 300, right: 1100, top: 200, bottom: 300 },
    ],
  ),
  "the chosen position must not overlap any reserved rect",
);

assert.equal(
  placeCallout({ x: 700, y: 300 }, size, [{ left: 0, right: 1280, top: 0, bottom: 720 }], viewport),
  null,
  "a callout with nowhere to sit should report that, not overlap a panel",
);
assert.equal(
  placeCallout({ x: 4, y: 300 }, size, [], viewport),
  null,
  "a callout should not hang off the left margin",
);

console.log("observatory-leader-geometry.test.mjs passed");
