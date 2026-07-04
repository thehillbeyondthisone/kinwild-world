// Static invariants for Verdant Grove polish and custom domain setup
// (QA-023 port of tests/test_verdant_grove_custom_domain.py).
//
// Biome config (groveDetails, edgeAura, creatureColors, furProbability,
// GRASS_DENSITY/GRASS_HEIGHT, grass-edge-disc absence) is real, importable
// data from biomes.js, so it's asserted directly off the BIOMES table
// instead of slicing biomes.js's source text between two `id:` markers.
// Everything else here — CNAME/README/CLAUDE.md domain text, GLSL shader
// bodies, InstancedMesh/leaf-batch wiring, and same-file code-ordering
// invariants (e.g. "the fur roll must run before geometry construction") —
// has no black-box behavior to observe without a full renderer or is
// inherently a statement about source order, so those stay readFileSync
// greps, matching the original file's intent per assertion.

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

const { BIOMES, GRASS_DENSITY, GRASS_HEIGHT } = await import('../src/biomes.js');

function readSrc(rel) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8');
}

function readFloraSrc() {
  // src/flora.js is a thin registry; builders were split out under
  // src/flora/. Join all seven files so assertions that need two markers
  // in the same blob (relative-order checks) resolve against one string.
  return [
    '../src/flora/_shared.js',
    '../src/flora/trees.js',
    '../src/flora/garden.js',
    '../src/flora/rocks.js',
    '../src/flora/structures.js',
    '../src/flora/aquatic.js',
    '../src/flora/volcanic.js',
  ].map(readSrc).join('\n');
}

// test_github_pages_custom_domain_is_configured
{
  const cname = readSrc('../CNAME').trim();
  assert.equal(cname, 'small-world.pardev.net');
}

// test_public_docs_use_custom_domain
{
  for (const rel of ['../README.md', '../CLAUDE.md']) {
    const text = readSrc(rel);
    assert.match(text, /https:\/\/small-world\.pardev\.net\//);
    assert.doesNotMatch(text, /https:\/\/paulrobello\.github\.io\/small-world\//);
  }
}

// test_verdant_biome_declares_grove_detail_flags
{
  const verdant = BIOMES.find((b) => b.id === 'verdant');
  assert.ok(verdant, 'verdant biome should exist');
  assert.ok(verdant.groveDetails, 'verdant should declare groveDetails');
  assert.ok(verdant.groveDetails.mushroomFamilies, 'verdant groveDetails should include mushroomFamilies');
  assert.ok(verdant.groveDetails.fairyRing, 'verdant groveDetails should include fairyRing');
}

// test_verdant_grove_has_mist_edge_disc
{
  const verdant = BIOMES.find((b) => b.id === 'verdant');
  assert.ok(verdant.edgeAura, 'verdant should declare an edgeAura');
  assert.equal(verdant.edgeAura.pattern, 'mist', 'verdant edge aura should use the mist pattern, not grass');
}

// test_world_places_verdant_detail_layers
{
  const worldSrc = readSrc('../src/world.js');
  const envSrc = readSrc('../src/environment.js');
  const floraSrc = readFloraSrc();
  const inspectSrc = readSrc('../src/inspect.js');

  assert.match(envSrc, /makeVerdantGroveDetails/);
  assert.match(worldSrc, /makeVerdantGroveDetails/);
  assert.match(worldSrc, /FLORA_BUILDERS\.fairyring/);
  assert.match(floraSrc, /fairyring\(biome\)/);
  assert.match(inspectSrc, /"fairyring"/);
}

// test_tree_and_large_mushroom_canopies_block_each_other
{
  const worldSrc = readSrc('../src/world.js');
  assert.match(worldSrc, /CANOPY_SPACING_KINDS/);
  assert.match(worldSrc, /"tree", "leafballtree", "pine", "snowpine", "deadtree", "bigmushroom"/);
  assert.match(worldSrc, /CANOPY_SPACING_PAD/);
  assert.match(worldSrc, /CANOPY_SPACING_KINDS\.has\(kind\)/);
  assert.match(worldSrc, /blocksFloraPlacement\(p\.x, p\.z, fp \* CANOPY_SPACING_PAD, CANOPY_SPACING_KINDS\)/);
}

// test_grove_spores_are_smaller_and_animated
{
  const floraSrc = readFloraSrc();
  assert.match(floraSrc, /applySporeDrift/);
  assert.match(floraSrc, /uSporeDrift/);
  assert.match(floraSrc, /new THREE\.SphereGeometry\(0\.0195/);
  assert.doesNotMatch(floraSrc, /new THREE\.SphereGeometry\(0\.026, 6, 5\)/);
  assert.doesNotMatch(floraSrc, /new THREE\.SphereGeometry\(0\.032, 6, 5\)/);
}

// test_grass_edge_discs_are_biome_defined_and_only_lowfx_disabled
{
  const stateSrc = readSrc('../src/state.js');
  const skySrc = readSrc('../src/sky.js');
  const uiSrc = readSrc('../src/ui/settings-panel.js');
  const htmlSrc = readSrc('../index.html');

  assert.doesNotMatch(stateSrc, /grassEdgeDiscs/);
  assert.doesNotMatch(uiSrc, /grassEdgeDiscs/);
  assert.doesNotMatch(htmlSrc, /setting-grass-edge-discs/);
  assert.match(skySrc, /if \(isGrassAura && LOWFX\) return null;/);
}

// test_only_bare_biome_grass_density_overrides_are_present (behavioral: real exports)
{
  assert.deepEqual(
    GRASS_DENSITY,
    { ashen: 0, desert: 0, frozen: 0, coral: 0, cloud: 0, obsidian: 0 },
    'GRASS_DENSITY should only carry bare zero overrides for biomes without grass'
  );
  assert.deepEqual(GRASS_HEIGHT, {}, 'GRASS_HEIGHT should carry no per-biome overrides');
}

// test_settings_panel_has_reset_to_defaults_button
{
  const htmlSrc = readSrc('../index.html');
  const uiSrc = readSrc('../src/ui/settings-panel.js');
  assert.match(htmlSrc, /setting-reset-defaults/);
  assert.match(htmlSrc, /reset all to defaults/);
  assert.match(uiSrc, /localStorage\.removeItem\(SETTINGS_KEY\)/);
  assert.match(uiSrc, /window\.location\.reload\(\)/);
}

// test_mushroom_perches_follow_wind_sway
{
  const floraSrc = readFloraSrc();
  const worldSrc = readSrc('../src/world.js');
  const creatureSrc = readSrc('../src/fauna/creature.js');

  assert.match(floraSrc, /g\.userData\.perchWind/);
  assert.match(worldSrc, /perchWind: f\.userData\.perchWind/);
  assert.match(creatureSrc, /function currentPerchPoint\(perch\)/);
  assert.match(creatureSrc, /state\.windUniforms\.uTime\.value/);
  assert.match(creatureSrc, /modelMatrix \* vec4\(transformed, 1\.0\)/);
  assert.match(creatureSrc, /perchOffsetX/);
  assert.match(creatureSrc, /perchOffsetZ/);
  assert.match(creatureSrc, /currentPerchPoint\(c\.perchTarget\)/);
}

// test_mushrooms_caterpillars_and_snails_use_smooth_shading
{
  const floraSrc = readFloraSrc();
  const caterpillarSrc = readSrc('../src/fauna/caterpillar.js');

  for (const marker of ['mushroom.stem.mat.smooth', 'bigmushroom.stem.mat.smooth', 'grove.babyMushroom.stem.mat.smooth']) {
    assert.ok(floraSrc.includes(marker), `flora source should include ${marker}`);
  }
  assert.match(caterpillarSrc, /caterpillar\.head\.mat\.smooth/);
  assert.match(caterpillarSrc, /caterpillar\.segment\.mat\.smooth/);
  assert.match(caterpillarSrc, /snail\.shell\.mat\.smooth/);
  assert.match(caterpillarSrc, /snail\.ridge\.mat\.smooth/);
  assert.match(caterpillarSrc, /const segDetail = wantsFur \? 1 : 2/);
  assert.match(caterpillarSrc, /new THREE\.IcosahedronGeometry\(segRadius, segDetail\)/);
  assert.doesNotMatch(caterpillarSrc, /new THREE\.IcosahedronGeometry\(segRadius, 0\)/);
  assert.match(caterpillarSrc, /3 \+ Math\.floor\(Math\.random\(\) \* 6\)/);
  assert.doesNotMatch(caterpillarSrc, /3 \+ Math\.floor\(Math\.random\(\) \* 4\)/);
  assert.doesNotMatch(caterpillarSrc, /caterpillar\.head\.mat\.flat/);
  assert.doesNotMatch(caterpillarSrc, /snail\.shell\.mat\.flat/);
}

// test_leafballtree_trunk_height_varies_up_to_twenty_five_percent
{
  const floraSrc = readFloraSrc();
  const worldSrc = readSrc('../src/world.js');

  assert.match(floraSrc, /leafballtreeTrunkHeightMul = 1 \+ Math\.random\(\) \* 0\.25/);
  assert.match(floraSrc, /canopyYOffset = 1\.45 \* \(leafballtreeTrunkHeightMul - 1\)/);
  assert.match(floraSrc, /trunk\.scale\.y = leafballtreeTrunkHeightMul/);
  assert.match(floraSrc, /canopyCenter = new THREE\.Vector3\(0, 1\.46 \+ canopyYOffset, 0\)/);
  assert.match(floraSrc, /g\.userData\.obstacleTopY = 2\.25 \+ canopyYOffset/);
  assert.match(worldSrc, /f\.userData\.obstacleTopY \?\? OBSTACLE_TOP\[kind\]/);
}

// test_verdant_walker_palette_is_softer_and_walker_parts_are_smooth
{
  const creatureSrc = readSrc('../src/fauna/creature.js');
  const verdant = BIOMES.find((b) => b.id === 'verdant');

  assert.deepEqual(
    verdant.creatureColors,
    ['#53693e', '#657a45', '#7b7045', '#8a6a3f'],
    'verdant creature colors should be the softer moss/moth palette'
  );
  assert.match(creatureSrc, /walker\.body\.mat\.smooth/);
  assert.match(creatureSrc, /walker\.belly\.mat\.smooth/);
  assert.match(creatureSrc, /walker\.leg\.mat\.smooth/);
  assert.match(creatureSrc, /walker\.foot\.mat\.smooth/);
  assert.match(creatureSrc, /const bodyDetail = wantsFur \? 1 : 2/);
  assert.match(creatureSrc, /new THREE\.IcosahedronGeometry\(0\.42, bodyDetail\)/);
  assert.doesNotMatch(creatureSrc, /new THREE\.IcosahedronGeometry\(0\.42, 0\)/);
}

// test_walker_fur_roll_happens_before_geometry_jitter
// A pure code-ordering invariant (the fur roll must be decided before the
// body geometry is built, or geometry-detail level would be wrong) — there
// is no black-box behavior to observe here beyond the order of two source
// statements, so this stays a grep by nature, not by convenience.
{
  const creatureSrc = readSrc('../src/fauna/creature.js');
  assert.match(creatureSrc, /const furRoll = furProb > 0 \? Math\.random\(\) : 1/);
  assert.match(creatureSrc, /const wantsFur = isBumblebee \|\| \(!isFish && \(opts\.furry \?\? \(furProb > 0 && furRoll < furProb\)\)\)/);
  assert.ok(creatureSrc.indexOf('const furRoll') < creatureSrc.indexOf('const bodyGeo'));
  assert.ok(creatureSrc.indexOf('const wantsFur') < creatureSrc.indexOf('const bodyGeo'));
  assert.match(creatureSrc, /if \(wantsFur\) \{/);
}

// test_lowfx_keeps_a_reduced_fur_stack
{
  const furSrc = readSrc('../src/fur.js');
  assert.doesNotMatch(furSrc, /if \(LOWFX\) return null/);
  assert.match(furSrc, /const layers = opts\.layers \?\? \(LOWFX \? 4 : 8\);/);
  assert.match(furSrc, /const furLength = opts\.length \?\? biome\.furLength \?\? \(LOWFX \? 0\.082 : 0\.072\);/);
}

// test_mushroom_grove_creature_palette_uses_muted_spore_tones
{
  const grove = BIOMES.find((b) => b.id === 'grove');
  assert.deepEqual(
    grove.creatureColors,
    ['#ff90c0', '#c7a0c8', '#9c84d4', '#ffd1a3'],
    'grove creature colors should be the muted spore-tone palette'
  );
  assert.ok(!grove.creatureColors.includes('#fff2b3'), 'grove should no longer use the old bright palette entry');
}

// test_verdant_fur_is_readable_in_live_world
{
  const creatureSrc = readSrc('../src/fauna/creature.js');
  const furSrc = readSrc('../src/fur.js');
  const verdant = BIOMES.find((b) => b.id === 'verdant');

  assert.equal(verdant.furProbability, 1.0, 'verdant should give every eligible creature fur');
  assert.equal(verdant.furLength, 0.075, 'verdant fur length should be the tuned value');
  assert.ok(!('furTip' in verdant), 'verdant should not declare a separate furTip color');
  assert.match(creatureSrc, /tipColor: bodyCol\.clone\(\)/);
  assert.doesNotMatch(creatureSrc, /new THREE\.Color\(biome\.furTip\)/);
  assert.match(furSrc, /vec3 cell = floor\(vPos \* 80\.0\);/);
}

// test_verdant_fliers_get_fur_but_fish_do_not
{
  const creatureSrc = readSrc('../src/fauna/creature.js');
  assert.match(creatureSrc, /const wantsFur = isBumblebee \|\| \(!isFish && \(opts\.furry \?\? \(furProb > 0 && furRoll < furProb\)\)\)/);
  assert.match(creatureSrc, /Fish never get fur; fliers use the same/);
}

// test_verdant_uses_leafballtree_with_custom_leaf_wind
{
  const floraSrc = readFloraSrc();
  const worldSrc = readSrc('../src/world.js');
  const inspectSrc = readSrc('../src/inspect.js');
  const verdant = BIOMES.find((b) => b.id === 'verdant');

  assert.ok(verdant.flora.includes('leafballtree'), 'verdant should place leafballtree flora');
  assert.ok(!verdant.flora.includes('tree'), 'verdant should not place the plain tree kind');
  assert.match(floraSrc, /leafballtree\(biome\)/);
  assert.match(floraSrc, /applyLeafPlateWind/);
  assert.match(floraSrc, /uLeafPlateWind/);
  assert.match(floraSrc, /leafOrigin/);
  assert.match(floraSrc, /tipFlex/);
  assert.doesNotMatch(floraSrc, /float height = max\(wp\.y, 0\.0\);/);
  assert.match(floraSrc, /applyLeafPlateGradient/);
  assert.match(floraSrc, /uLeafTipLift/);
  assert.match(floraSrc, /vLeafPlateVein/);
  assert.match(floraSrc, /uLeafSideShade/);
  assert.match(floraSrc, /vLeafPlateSide/);
  assert.match(floraSrc, /shingleLift/);
  assert.match(worldSrc, /leafballtree/);
  assert.match(inspectSrc, /"leafballtree"/);
  assert.match(floraSrc, /Curved, anchored leaf/);
  assert.doesNotMatch(floraSrc, /leafballtree\.leaf\.mat\.inner/);
  assert.doesNotMatch(floraSrc, /inner underside fill/);
  assert.match(floraSrc, /leafballtree\.branch\.geo/);
}

// test_leafballtree_leaves_have_subtle_instanced_outlines
{
  const floraSrc = readFloraSrc();
  assert.match(floraSrc, /leafballtree\.leaf\.outline\.geo/);
  assert.match(floraSrc, /leafballtree\.leaf\.outline\.mat/);
  assert.match(floraSrc, /pos\.setX\(i, pos\.getX\(i\) \* 1\.075\)/);
  assert.match(floraSrc, /pos\.setZ\(i, pos\.getZ\(i\) - 0\.006\)/);
  assert.match(floraSrc, /new THREE\.MeshBasicMaterial/);
  assert.match(floraSrc, /outline: getLeafballOutlineColor\(leaves, trunk\)/);
  assert.match(floraSrc, /function getLeafballOutlineColor\(leaves, trunk\)/);
  assert.match(floraSrc, /color: palette\.outline/);
  assert.match(floraSrc, /polygonOffset: true/);
  assert.match(floraSrc, /const outline = makeInstancedLeafBatch\(leafOutlineGeo, leafOutlineMat, leafBuckets\[i\]\)/);
  assert.match(floraSrc, /outline\.renderOrder = -1/);
  assert.ok(floraSrc.indexOf('const outline = makeInstancedLeafBatch') < floraSrc.indexOf('const leaves = makeInstancedLeafBatch'));
}

// test_leafballtree_uses_instanced_leaf_batches
{
  const floraSrc = readFloraSrc();
  assert.match(floraSrc, /makeInstancedLeafBatch/);
  assert.match(floraSrc, /new THREE\.InstancedMesh\(geometry, material, matrices\.length\)/);
  assert.match(floraSrc, /leafBuckets/);
  assert.match(floraSrc, /leafBuckets\[matIndex\]\.push\(matrix\.clone\(\)\)/);
  assert.match(floraSrc, /USE_INSTANCING/);
  assert.match(floraSrc, /modelMatrix \* instanceMatrix \* vec4\(0\.0, 0\.0, 0\.0, 1\.0\)/);
  assert.doesNotMatch(floraSrc, /const leaf = new THREE\.Mesh\(leafGeo, mat\);/);
}

// test_inspect_supports_initial_view_param_and_default_pause
{
  const inspectSrc = readSrc('../src/inspect.js');
  const stateSrc = readSrc('../src/state.js');
  const mainSrc = readSrc('../main.js');
  const htmlSrc = readSrc('../index.html');

  assert.match(inspectSrc, /INSPECT_VIEW_DIRECTIONS/);
  for (const view of ['default', 'top', 'left', 'right', 'front', 'back', 'up']) {
    assert.ok(inspectSrc.includes(`${view}: new THREE.Vector3`), `inspect.js should define a ${view} view direction`);
  }
  assert.match(inspectSrc, /_params\.get\("view"\)/);
  assert.match(inspectSrc, /sp\.set\("view", _viewName\)/);
  assert.match(inspectSrc, /_parseVectorParam\(_params\.get\("camera"\)\)/);
  assert.match(inspectSrc, /_parseVectorParam\(_params\.get\("target"\)\)/);
  assert.match(inspectSrc, /_parsePositiveNumberParam\(_params\.get\("distance"\)\)/);
  assert.match(inspectSrc, /_parsePositiveNumberParam\(_params\.get\("zoom"\)\)/);
  assert.match(inspectSrc, /sp\.set\("camera", _formatVectorParam\(_cameraOverride\)\)/);
  assert.match(inspectSrc, /sp\.set\("target", _formatVectorParam\(_targetOverride\)\)/);
  assert.match(inspectSrc, /sp\.set\("distance"/);
  assert.match(inspectSrc, /sp\.set\("zoom"/);
  assert.match(inspectSrc, /camera\.position\.copy\(_cameraOverride\)/);
  assert.match(inspectSrc, /controls\.target\.copy\(_targetOverride\)/);
  assert.match(inspectSrc, /const distance = _distanceOverride \?\? fitDistance/);
  assert.match(inspectSrc, /camera\.zoom = _zoomOverride/);
  assert.match(inspectSrc, /let _paused = _params\.get\("paused"\) !== "0";/);
  assert.match(inspectSrc, /controls\.autoRotate = !_paused/);
  assert.match(stateSrc, /autoRotate: false/);
  assert.match(mainSrc, /controls\.autoRotate = false/);
  assert.match(htmlSrc, /id="setting-auto-rotate"/);
  assert.doesNotMatch(htmlSrc, /id="setting-auto-rotate" checked/);
}

// test_inspect_wind_toggle_defaults_off
{
  const inspectSrc = readSrc('../src/inspect.js');
  assert.match(inspectSrc, /_params\.get\("wind"\) === "1"/);
  assert.match(inspectSrc, /_inspectWindEnabled/);
  assert.match(inspectSrc, /applyInspectWindSetting/);
  assert.match(inspectSrc, /state\.windUniforms\.uFoliageWind\.value = _inspectWindEnabled \? 1 : 0/);
  assert.match(inspectSrc, /e\.key === "w" \|\| e\.key === "W"/);
  assert.match(inspectSrc, /sp\.set\("wind", "1"\)/);
  assert.match(inspectSrc, /WIND/);
}

// test_inspect_hides_world_vignette
{
  const inspectSrc = readSrc('../src/inspect.js');
  assert.match(inspectSrc, /document\.querySelector\("\.vignette"\)\?\.classList\.add\("inspect-hidden"\)/);
}

// test_inspect_supports_screenshot_param_and_keybind
{
  const inspectSrc = readSrc('../src/inspect.js');
  const mainSrc = readSrc('../main.js');

  assert.match(inspectSrc, /_params\.get\("screenshot"\) === "1"/);
  assert.match(inspectSrc, /downloadInspectScreenshot/);
  assert.match(inspectSrc, /renderer\.domElement\.toDataURL/);
  assert.match(inspectSrc, /a\.download = `small-world-inspect-\$\{biomeTag\}-\$\{variantTag\}-\$\{seedTag\}-\$\{_viewName\}\.png`/);
  assert.match(inspectSrc, /e\.key === "s" \|\| e\.key === "S"/);
  assert.match(inspectSrc, /scheduleAutoScreenshot/);
  assert.match(mainSrc, /preserveDrawingBuffer: true/);
}

console.log('verdant-grove-custom-domain.test.mjs passed');
