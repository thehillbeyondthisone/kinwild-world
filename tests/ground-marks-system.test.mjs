// Behavioral regression test (QA-023 Python→mjs port, following QA-009
// conventions) for the terrain-painted soft-ground creature marks system,
// replacing tests/test_ground_marks_static.py.
//
// Most of the original Python file grepped source text for the mark
// system's shape. Where the target is an exported, callable function
// (makeGroundMarks/emitGroundMark/stepGroundMarks in environment.js) or
// real biome/creature data, this file drives the real objects and asserts
// on observed behavior instead. The handful of assertions that only make
// sense against GLSL shader source (the onBeforeCompile string patch) or
// cross-file wiring statements (state.js/world.js/main.js call sites, none
// of which are separately invokable) are kept as readFileSync greps, each
// with a comment explaining why.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.__APP_VERSION__ = 'test';
globalThis.window = {
  location: { search: '' },
  matchMedia: () => ({ matches: false }),
};
Object.defineProperty(globalThis, 'navigator', {
  value: { maxTouchPoints: 0 },
  configurable: true,
});
function gradient() {
  return { addColorStop() {} };
}
const ctx2d = new Proxy(
  {
    clearRect() {},
    createRadialGradient: () => gradient(),
    createLinearGradient: () => gradient(),
  },
  { get(target, prop) { return prop in target ? target[prop] : () => null; } }
);
globalThis.document = {
  createElement() {
    return { width: 0, height: 0, getContext: () => ctx2d };
  },
};

const { BIOMES } = await import('../src/biomes.js');
const { state } = await import('../src/state.js');
const { makeGroundMarks, emitGroundMark, stepGroundMarks } = await import('../src/environment.js');
const { makeCreature, stepCreature } = await import('../src/fauna/creature.js');
const { makeCaterpillar, stepCaterpillar } = await import('../src/fauna/caterpillar.js');

const ENV_SRC = readFileSync(new URL('../src/environment.js', import.meta.url), 'utf8');
const STATE_SRC = readFileSync(new URL('../src/state.js', import.meta.url), 'utf8');
const WORLD_SRC = readFileSync(new URL('../src/world.js', import.meta.url), 'utf8');
const MAIN_SRC = readFileSync(new URL('../main.js', import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// 1. Soft-ground biomes are configured with a groundMarks table (behavioral
//    replacement for test_soft_ground_biomes_are_configured).
// ---------------------------------------------------------------------------
{
  const expectedIds = ['verdant', 'desert', 'frozen', 'golden', 'mossy', 'twilight', 'grove'];
  for (const id of expectedIds) {
    const biome = BIOMES.find((b) => b.id === id);
    assert.ok(biome, `biome ${id} should exist`);
    assert.ok(biome.groundMarks, `biome ${id} should configure groundMarks`);
  }
  const desert = BIOMES.find((b) => b.id === 'desert');
  assert.equal(desert.groundMarks.poof, 'sand', 'desert ground marks should trigger sand poofs');
}

// ---------------------------------------------------------------------------
// 2. Mark lifecycle: emitting adds a mark and flips the active flag;
//    stepping past a mark's life expires it and clears the flag again;
//    the system respects its maxMarks cap (replaces the exported-function
//    half of test_ground_mark_system_exports_and_shader_alpha).
// ---------------------------------------------------------------------------
{
  const biome = BIOMES.find((b) => b.id === 'verdant');
  const system = makeGroundMarks(biome);
  assert.ok(system, 'makeGroundMarks should build a system for a biome with groundMarks configured');
  assert.equal(system.userData.marks.length, 0, 'a fresh system should start with no marks');
  assert.equal(system.userData.active[0], 0, 'a fresh system should start inactive');

  emitGroundMark(system, { x: 1, z: 2, heading: 0, life: 1 });
  assert.equal(system.userData.marks.length, 1, 'emitGroundMark should add a mark');
  assert.equal(system.userData.active[0], 1, 'emitting a mark should flip the active flag on');

  stepGroundMarks(system, 2); // exceeds the mark's life of 1s
  assert.equal(system.userData.marks.length, 0, 'stepGroundMarks should expire marks past their life');
  assert.equal(system.userData.active[0], 0, 'expiring the last mark should flip the active flag back off');

  const cap = 5;
  system.userData.maxMarks = cap;
  for (let i = 0; i < cap + 3; i++) {
    emitGroundMark(system, { x: i, z: 0, heading: 0, life: 100 });
  }
  assert.equal(system.userData.marks.length, cap, 'the marks list should never grow past maxMarks (oldest evicted)');
}

// ---------------------------------------------------------------------------
// 3. Walkers/fliers emit ground marks via stepCreature, and walker footprint
//    emission is not gated by the shared dust-kick cooldown (replaces
//    test_walkers_and_fliers_emit_marks +
//    test_walker_footprints_are_not_gated_by_shared_dust_cooldown).
// ---------------------------------------------------------------------------
{
  const biome = BIOMES.find((b) => b.id === 'verdant');
  state.currentBiome = biome;
  state.waterMesh = null;
  state.dustKicks = [];
  state.groundMarks = makeGroundMarks(biome);
  const flatHeightFn = () => 0;

  const originalRandom = Math.random;
  Math.random = () => 0.5; // forces flies = false (0.5 is never < 0.15): a ground walker
  const walker = makeCreature(biome, {});
  Math.random = originalRandom;
  assert.equal(walker.flies, false, 'test setup requires a ground-walking (non-flying) creature');

  // Exaggerate the bob rate so the foot-touch rising edge (sVal crossing
  // 0.85) fires many times within the 2 simulated seconds below — several
  // times faster than the 0.18s shared dust-kick cooldown — while keeping
  // the creature moving the whole time.
  walker.bobSpeed = 40;
  walker.speed = 0.4;

  const dt = 0.01;
  for (let i = 0; i < 200; i++) {
    walker.pauseUntil = -1; // never pause, so the bob/footstep cycle keeps running
    stepCreature(walker, dt, i * dt, flatHeightFn);
  }

  const footprintCount = state.groundMarks.userData.marks.length;
  const dustKickCount = state.dustKicks.length;
  assert.ok(footprintCount > 0, 'a moving walker should emit footprint ground marks');
  assert.ok(
    footprintCount > dustKickCount,
    `walker footprints (${footprintCount}) should not be throttled by the shared dust-kick cooldown ` +
      `that limits dust kicks (${dustKickCount}) to roughly once every 0.18s`
  );
}

// ---------------------------------------------------------------------------
// 4. A flier landing (descending -> landed) emits ground marks under its
//    feet (replaces the flier half of test_walkers_and_fliers_emit_marks).
// ---------------------------------------------------------------------------
{
  const biome = BIOMES.find((b) => b.creatureKind !== 'fish') ?? BIOMES[0];
  state.currentBiome = biome;
  state.waterMesh = null;
  state.groundMarks = makeGroundMarks(biome);
  const flatHeightFn = () => 0;

  const originalRandom = Math.random;
  Math.random = () => 0; // forces flies = true (0 < 0.15) deterministically
  const flier = makeCreature(biome, {});
  Math.random = originalRandom;
  assert.equal(flier.flies, true, 'test setup requires a flying creature');

  flier.landState = 'descending';
  flier.perchTarget = null;
  flier.currentHover = flier.hoverHeight;

  let landed = false;
  for (let i = 0; i < 2000 && !landed; i++) {
    stepCreature(flier, 0.05, i * 0.05, flatHeightFn);
    landed = flier.landState === 'landed';
  }

  assert.ok(landed, 'test setup should bring the flier to a landed state within the simulated window');
  assert.ok(
    state.groundMarks.userData.marks.length > 0,
    'a flier committing to a landing should emit ground marks under its feet'
  );
}

// ---------------------------------------------------------------------------
// 5. Crawlers (caterpillars/snails) emit continuous ground-mark trails, and
//    the mark lifetime is scaled up for slower crawlers so the visible
//    trail covers a comparable world distance regardless of speed
//    (replaces test_crawlers_emit_continuous_trails +
//    test_crawler_trails_are_lifetime_compensated_for_slow_speed).
// ---------------------------------------------------------------------------
{
  const biome = BIOMES.find((b) => !b.noCaterpillars && !b.water) ?? BIOMES[0];
  const flatHeightFn = () => 0;

  function firstMarkLife(speed) {
    state.currentBiome = biome;
    state.waterMesh = null;
    state.groundMarks = makeGroundMarks(biome);
    const c = makeCaterpillar(biome, {});
    c.speed = speed;
    for (let i = 0; i < 4000; i++) {
      stepCaterpillar(c, 0.02, i * 0.02, flatHeightFn);
      if (state.groundMarks.userData.marks.length > 0) break;
    }
    assert.ok(state.groundMarks.userData.marks.length > 0, `crawler at speed ${speed} should emit a trail mark`);
    return state.groundMarks.userData.marks[0].baseLife;
  }

  const slowLife = firstMarkLife(0.05);
  const fastLife = firstMarkLife(5);
  assert.ok(
    slowLife > fastLife,
    `a slower crawler's trail marks should live longer than a faster crawler's (slow=${slowLife}, fast=${fastLife}), ` +
      'so the visible trail covers a comparable world distance regardless of speed'
  );
}

// ---------------------------------------------------------------------------
// 6. Shader wiring and cross-file call sites. These assertions target either
//    GLSL source injected via onBeforeCompile (never executed by this
//    headless test — there is no WebGL context to compile it against) or
//    plain orchestration statements in state.js/world.js/main.js that aren't
//    separately invokable functions. Grepping is the direct way to pin them.
// ---------------------------------------------------------------------------
{
  const start = ENV_SRC.indexOf('// ─── soft-ground creature marks');
  const end = ENV_SRC.indexOf('// ─── fly swarms', start);
  const section = ENV_SRC.slice(start, end);

  assert.match(section, /export function makeGroundMarks/);
  assert.match(section, /export function emitGroundMark/);
  assert.match(section, /export function stepGroundMarks/);
  assert.match(section, /installGroundMarkShader/);
  assert.match(section, /onBeforeCompile/);
  assert.match(section, /new THREE\.CanvasTexture/);
  assert.match(section, /uGroundMarkTex/);
  assert.match(section, /texture2D\(uGroundMarkTex/);
  assert.match(section, /diffuseColor\.rgb = mix/);
  // Superseded abstractions from an earlier implementation must stay gone.
  assert.doesNotMatch(section, /GROUND_MARK_LIFT/);
  assert.doesNotMatch(section, /new THREE\.InstancedMesh/);
  assert.doesNotMatch(section, /new THREE\.PlaneGeometry/);
  assert.doesNotMatch(section, /attribute float aAlpha/);
  assert.doesNotMatch(section, /polygonOffset: true/);

  assert.match(STATE_SRC, /groundMarks: null/);
  assert.match(WORLD_SRC, /makeGroundMarks/);
  assert.match(WORLD_SRC, /worldState\.groundMarks = null/);
  assert.match(WORLD_SRC, /worldState\.groundMarks = makeGroundMarks\(biome\)/);
  assert.match(MAIN_SRC, /stepGroundMarks/);
  assert.match(MAIN_SRC, /stepGroundMarks\(state\.groundMarks, dt\)/);
}

console.log('ground-marks-system.test.mjs passed');
