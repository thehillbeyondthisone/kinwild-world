// Static regression checks for fauna obstacle avoidance and crawler trails
// (QA-023 port of tests/test_fauna_obstacle_and_trail_static.py).
//
// OBSTACLE_KINDS/OBSTACLE_TOP and GROUND_CREATURE_BLOCK_KINDS are consts
// scoped inside generateWorld() in world.js (not module exports), so there
// is no importable surface to assert against without changing world.js's
// public API — out of scope for a straight test port. Grepping the source
// is the direct way to pin these tables and the call sites that use them.
// The crawler trail's "trimmed by distance, not frame count" invariant is
// already covered behaviorally by tests/caterpillar-trail-trim.test.mjs
// (it drives stepCaterpillar for a simulated minute and asserts the ring
// buffer's live length stays bounded); the grep here additionally pins the
// specific mechanism names and the absence of the old frame-count trim.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const WORLD_SRC = ["world.js","world/atmosphere.js","world/flora-placement.js","world/fauna-population.js","world/ground-cover.js","world/portal-placement.js"].map((p) => readFileSync(new URL("../src/" + p, import.meta.url), "utf8")).join("\\n");
const CATERPILLAR_SRC = readFileSync(new URL('../src/fauna/caterpillar.js', import.meta.url), 'utf8');
const SHARED_SRC = readFileSync(new URL('../src/fauna/shared.js', import.meta.url), 'utf8');

function extractConstBlock(source, name) {
  const marker = `const ${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} declaration not found`);
  const brace = source.indexOf('{', start);
  const bracket = source.indexOf('[', start);
  const candidates = [brace, bracket].filter((i) => i !== -1);
  const opener = Math.min(...candidates);
  const openChar = source[opener];
  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 0;
  for (let i = opener; i < source.length; i++) {
    const ch = source[i];
    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) return source.slice(opener, i + 1);
    }
  }
  throw new Error(`${name} declaration end not found`);
}

// test_cactuses_are_static_obstacles_with_height_filter
{
  const obstacleKinds = extractConstBlock(WORLD_SRC, 'OBSTACLE_KINDS');
  const obstacleTop = extractConstBlock(WORLD_SRC, 'OBSTACLE_TOP');
  assert.match(obstacleKinds, /"cactus"/, 'cactus should be a static obstacle kind');
  assert.match(obstacleTop, /\bcactus:\s*1\.[0-9]+/, 'cactus should have a height-filter entry above 1.0');
}

// test_crawler_trails_are_retained_by_distance_not_frame_count
{
  assert.match(CATERPILLAR_SRC, /trailMaxDistance/);
  assert.match(CATERPILLAR_SRC, /ringTrimByDistance\(c\.trail, c\.trailMaxDistance\)/);
  assert.doesNotMatch(
    CATERPILLAR_SRC,
    /if \(c\.trail\.length > 300\) c\.trail\.length = 300/,
    'the old frame-count-capped trim must not have come back'
  );
}

// test_crawlers_turn_in_place_on_static_obstacles
{
  assert.match(CATERPILLAR_SRC, /staticResponse: "turn"/);
  assert.match(SHARED_SRC, /staticResponse = opts\?\.staticResponse \?\? "slide"/);
  assert.match(SHARED_SRC, /staticResponse === "turn"/);
}

// test_ground_creatures_do_not_spawn_inside_fairy_rings
{
  const creatureBlockKinds = extractConstBlock(WORLD_SRC, 'GROUND_CREATURE_BLOCK_KINDS');
  assert.match(creatureBlockKinds, /"fairyring"/);
  assert.match(WORLD_SRC, /blocksPlacement\(p\.x, p\.z, 0\.35, GROUND_CREATURE_BLOCK_KINDS\)/);
  assert.match(WORLD_SRC, /blocksPlacement\(nx, nz, 0\.3, GROUND_CREATURE_BLOCK_KINDS\)/);
}

// test_crawler_body_segments_yaw_along_the_trail_tangent
{
  assert.match(CATERPILLAR_SRC, /seg\.rotation\.order = "YXZ"/);
  assert.match(
    CATERPILLAR_SRC,
    /const frontPt = ringFindAt\(c\.trail, Math\.max\(0, d - c\.segSpacing \* 0\.5\), _frontScratch\)/
  );
  assert.match(
    CATERPILLAR_SRC,
    /const backPt = ringFindAt\(c\.trail, d \+ c\.segSpacing \* 0\.5, _backScratch\)/
  );
  assert.match(
    CATERPILLAR_SRC,
    /const bodyHeading = Math\.atan2\(frontPt\.z - backPt\.z, frontPt\.x - backPt\.x\)/
  );
  assert.match(CATERPILLAR_SRC, /seg\.rotation\.y = -bodyHeading \+ Math\.PI \/ 2/);
}

console.log('fauna-obstacle-and-trail.test.mjs passed');
