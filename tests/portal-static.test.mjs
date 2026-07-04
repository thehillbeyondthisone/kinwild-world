// QA-009: adds a real behavioral layer on top of the existing source-text
// assertions (kept below to avoid losing coverage on the cross-file wiring,
// GLSL shader strings, and world.js/ui.js/main.js/state.js integration glue
// that this file was already checking — those require either a full browser
// DOM or reserve grepping for GLSL, per CLAUDE.md/AUDIT.md QA-009). The new
// block imports portal.js directly (it has no DOM dependency — only THREE.js
// + a handful of sibling pure modules) and exercises createBiomePortal /
// updatePortalPreview against real THREE objects: ring placement/sink math,
// render-target sizing under LOWFX, and the distance/throttle gates that
// keep preview rendering cheap.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as THREE from 'three';

installHeadlessGlobals();
const { createBiomePortal, updatePortalPreview } = await import('../src/portal.js');
const { BIOMES } = await import('../src/biomes.js');

{
  const sourceBiome = BIOMES[0];
  const targetBiome = BIOMES[1];
  const x = 3, y = 0, z = -4, heading = 1.2;
  const portal = createBiomePortal({
    sourceBiome, targetBiome, x, y, z, heading,
    seed: 0x3f2a, targetSeed: 0x4b1c,
  });

  // Protected invariant: the ring is sunk into the ground by
  // PORTAL_RING_RADIUS - PORTAL_GROUND_SINK, not floated at the anchor's y.
  assert.ok(portal.group.position.y > y, 'the portal ring should sit above its ground anchor y (sunk in, not buried).');
  assert.ok(portal.group.position.y < y + 1.48, 'the portal ring should be substantially sunk in, not floating at full ring height.');
  assert.equal(portal.group.position.x, x);
  assert.equal(portal.group.position.z, z);
  assert.equal(portal.group.rotation.y, heading);

  // Render targets exist and share a headless-LOWFX size (our stubbed
  // window is small/low-DPR, so LOWFX auto-detects true).
  assert.ok(portal.frontRt.isWebGLRenderTarget && portal.backRt.isWebGLRenderTarget, 'createBiomePortal should build front/back render targets for the preview.');
  assert.equal(portal.frontRt.width, portal.backRt.width, 'front/back preview render targets should match in size.');

  // Blocker/obstacle geometry used by world.js flora/creature placement.
  assert.equal(portal.blocker.kind, 'portal');
  assert.equal(portal.blocker.x, x);
  assert.equal(portal.blocker.z, z);
  assert.ok(portal.blocker.r > 0, 'the portal should reserve a flora-blocking radius.');
  assert.equal(portal.obstacle.kind, 'portal');
  assert.ok(portal.obstacle.top > y, 'the portal obstacle canopy top should be above the ground anchor so fliers can pass under it only when clear.');

  // Distance gating: a camera far outside PORTAL_ACTIVE_DISTANCE should never
  // trigger a render call, however many times it's polled.
  let renderCalls = 0;
  const farRenderer = {
    getRenderTarget() { return null; },
    setRenderTarget() {},
    clear() {},
    render() { renderCalls += 1; },
  };
  const farCamera = new THREE.PerspectiveCamera();
  farCamera.position.set(10000, 0, 10000);
  updatePortalPreview(portal, farRenderer, farCamera, 1);
  updatePortalPreview(portal, farRenderer, farCamera, 2);
  assert.equal(renderCalls, 0, 'a portal far outside the active distance should never render its preview.');

  // Throttling: a camera close enough to render should render once, then
  // skip immediate re-renders until PORTAL_RENDER_INTERVAL_MS has elapsed.
  let closeRenderCalls = 0;
  const closeRenderer = {
    getRenderTarget() { return null; },
    setRenderTarget() {},
    clear() {},
    render() { closeRenderCalls += 1; },
  };
  const closeCamera = new THREE.PerspectiveCamera();
  closeCamera.position.set(x, portal.group.position.y, z + 2);
  updatePortalPreview(portal, closeRenderer, closeCamera, 10);
  assert.equal(closeRenderCalls, 2, 'a nearby portal should render both its front and back preview faces.');
  updatePortalPreview(portal, closeRenderer, closeCamera, 10.001);
  assert.equal(closeRenderCalls, 2, 'a re-render within the throttle interval should be skipped.');
  updatePortalPreview(portal, closeRenderer, closeCamera, 30);
  assert.equal(closeRenderCalls, 4, 'a re-render after the throttle interval has elapsed should render again.');
}

function installHeadlessGlobals() {
  globalThis.__APP_VERSION__ = 'test';
  globalThis.window = {
    location: { search: '' }, devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720,
    addEventListener() {}, dispatchEvent() {},
  };
  function gradient() { return { addColorStop() {} }; }
  const ctx2d = new Proxy(
    {
      createRadialGradient: () => gradient(),
      createLinearGradient: () => gradient(),
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      getContextAttributes: () => ({ alpha: true }),
    },
    { get(target, prop) { return prop in target ? target[prop] : () => null; } }
  );
  function stubEl() {
    return {
      textContent: '', style: {},
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      appendChild() {}, removeChild() {}, setAttribute() {}, dataset: {},
      getContext: () => ctx2d,
    };
  }
  globalThis.document = {
    getElementById: () => stubEl(),
    createElement: () => stubEl(),
    body: { classList: { contains() { return false; }, add() {}, remove() {} } },
    documentElement: { style: {} },
  };
  globalThis.performance = { now: () => 0 };
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 0);
}

// ---------------------------------------------------------------------------
// Below: the pre-existing source-text assertions, kept for coverage on
// cross-file wiring and GLSL that the behavioral block above doesn't reach.
// ---------------------------------------------------------------------------

const portalUrl = new URL('../src/portal.js', import.meta.url);
assert(existsSync(portalUrl), 'A dedicated portal module should own portal preview rendering.');

const portalSource = readFileSync(portalUrl, 'utf8');
const stateSource = readFileSync(new URL('../src/state.js', import.meta.url), 'utf8');
const worldSource = readFileSync(new URL('../src/world.js', import.meta.url), 'utf8');
// ARC-002: world-construction constants live in a single shared module that
// both world.js and portal.js import from.
const constantsSource = readFileSync(new URL('../src/world-constants.js', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
// PERSISTED_KEYS (the list of persisted setting names) moved to src/ui/storage.js
// as part of ARC-003 / QA-004 (ui.js split). Portal-persistence assertions now
// read the storage module.
const storageSource = readFileSync(new URL('../src/ui/storage.js', import.meta.url), 'utf8');
const grassSource = readFileSync(new URL('../src/grass.js', import.meta.url), 'utf8');

assert(
  stateSource.includes('portals: []'),
  'Shared state should track every placed portal in the portals array for render-loop updates and disposal.'
);

assert(
  stateSource.includes('portalEnabled: false')
    && stateSource.includes('portalDoublePlacement: false')
    && stateSource.includes('portalPreviewGrass: false')
    && stateSource.includes('portalPreviewFlora: true')
    && stateSource.includes('portalPreviewCreatures: false')
    && stateSource.includes('portalPreviewFx: true')
    && stateSource.includes('portalPanelOpen: false')
    && storageSource.includes('"portalEnabled"')
    && storageSource.includes('"portalDoublePlacement"')
    && storageSource.includes('"portalPreviewGrass"')
    && storageSource.includes('"portalPreviewFlora"')
    && storageSource.includes('"portalPreviewCreatures"')
    && storageSource.includes('"portalPreviewFx"')
    && storageSource.includes('"portalPanelOpen"'),
  'Portal settings should persist default-off portals, default-off double placement, and preview detail defaults.'
);

assert(
  portalSource.includes('export function createBiomePortal')
    && portalSource.includes('export function updatePortalPreview')
    && portalSource.includes('export function disposePortal')
    && portalSource.includes('targetSeed = seed')
    && portalSource.includes('targetSeed,')
    && portalSource.includes('new THREE.WebGLRenderTarget')
    && portalSource.includes('PortalPreview')
    && portalSource.includes('PortalRing')
    && portalSource.includes('PortalView')
    && portalSource.includes('const PORTAL_GROUND_SINK = 0.18 + PORTAL_RING_RADIUS * 0.1')
    && portalSource.includes('group.position.set(x, y + PORTAL_RING_RADIUS - PORTAL_GROUND_SINK, z)')
    && portalSource.includes('color: new THREE.Color(targetBiome.cliff).lerp(new THREE.Color(targetBiome.accent), 0.35)')
    && portalSource.includes('emissive: new THREE.Color(targetBiome.accent).multiplyScalar(0.18)'),
  'portal.js should create a destination-palette render-target-backed portal ring and view, sunk into the ground.'
);

assert(
  portalSource.includes('const PORTAL_RT_SIZE = LOWFX ? 256 : 768')
    && portalSource.includes('lastRenderAt')
    && portalSource.includes('PORTAL_RENDER_INTERVAL_MS')
    && portalSource.includes('const PORTAL_ACTIVE_DISTANCE = LOWFX ? 52 : 90')
    && portalSource.includes('camera.position.distanceTo(portal.group.position)'),
  'Portal preview rendering should be high enough fidelity for close viewing while remaining throttled/distance-gated for FPS.'
);

assert(
  portalSource.includes('side: THREE.DoubleSide'),
  'Portal view material should render from either side for first-person traversal.'
);

assert(
  portalSource.includes('const PORTAL_VIEW_RADIUS = PORTAL_RING_RADIUS - 0.04')
    && portalSource.includes('smoothstep(0.86, 1.0, d)')
    && portalSource.includes('smoothstep(0.985, 1.0, d)'),
  'Portal view should overlap under the ring with only a narrow rim fade so the preview fills the opening.'
);

assert(
  portalSource.includes('depthWrite: true'),
  'Portal view should write depth so screen-space depth outlines do not draw terrain/object edges over it.'
);

assert(
  portalSource.includes('uTime: { value: 0 }')
    && portalSource.includes('uDistortStrength: { value: LOWFX ? 0.00675 : 0.01125 }')
    && portalSource.includes('atan(p.y, p.x)')
    && portalSource.includes('vec2 backUv = vec2(1.0 - warpedUv.x, warpedUv.y)')
    && portalSource.includes('texture2D(tPortalFront, warpedUv)')
    && portalSource.includes('texture2D(tPortalBack, backUv)')
    && portalSource.includes('portal.view.material.uniforms.uTime.value = nowSeconds'),
  'Portal view shader should animate a radial UV distortion for a wavy, shimmery portal surface.'
);

assert(
  portalSource.includes('tPortalFront')
    && portalSource.includes('tPortalBack')
    && portalSource.includes('gl_FrontFacing ? frontCol : backCol')
    && portalSource.includes('PORTAL_ARRIVAL_OFFSET')
    && portalSource.includes('function previewPortalEyeY(heightFn, x, z)')
    && portalSource.includes('return heightFn(x, z) + 1.9')
    && portalSource.includes('function positionPreviewCamera(camera, portalAnchor, heightFn, side)')
    && portalSource.includes('portalAnchor.x + portalAnchor.nx * PORTAL_ARRIVAL_OFFSET * side')
    && portalSource.includes('camera.position.set(x, y, z)')
    && portalSource.includes('camera.lookAt(lookX, y, lookZ)')
    && portalSource.includes('export function getPortalSideArrivalPose(portal, side = 1)')
    && portalSource.includes('yaw: Math.atan2(normal.x * sideSign, normal.z * sideSign) + Math.PI')
    && portalSource.includes('export function getPortalCameraSide(portal, camera, worldScale = 1)')
    && portalSource.includes('return (dx * normal.x + dz * normal.z) >= 0 ? 1 : -1')
    && portalSource.includes('function syncPreviewProjectionToCamera(previewCamera, camera)')
    && portalSource.includes('const hFov = 2 * Math.atan(Math.tan(vFov * 0.5) * aspect)')
    && portalSource.includes('previewCamera.fov = THREE.MathUtils.radToDeg(Math.max(vFov, hFov))')
    && portalSource.includes('previewCamera.zoom = camera.zoom')
    && portalSource.includes('previewCamera.updateProjectionMatrix()')
    && portalSource.includes('positionPreviewCamera(previewFrontCamera, portalAnchor, heightFn, 1)')
    && portalSource.includes('positionPreviewCamera(previewBackCamera, portalAnchor, heightFn, -1)')
    && portalSource.includes('frontRt')
    && portalSource.includes('backRt')
    && portalSource.includes('previewFrontCamera')
    && portalSource.includes('previewBackCamera')
    && portalSource.includes('syncPreviewProjectionToCamera(portal.previewFrontCamera, camera)')
    && portalSource.includes('syncPreviewProjectionToCamera(portal.previewBackCamera, camera)')
    && portalSource.includes('renderer.render(portal.previewScene, portal.previewFrontCamera)')
    && portalSource.includes('renderer.render(portal.previewScene, portal.previewBackCamera)'),
  'Portal disc should render opposite connected-world viewpoints using a player-matched preview projection.'
);

assert(
  portalSource.includes('buildPortalPreviewScene')
    && portalSource.includes('makeHeightFn')
    && portalSource.includes('pickLayout')
    // ARC-003/QA-013: the biome-roll + pickLayout() RNG prefix is now a
    // shared helper (rollBiomeAndLayout) in world-constants.js, consumed by
    // both world.js and the portal preview, instead of a hand-copied
    // `Math.random()` call kept in sync only by a comment.
    && constantsSource.includes('export function rollBiomeAndLayout(pickLayoutFn)')
    && portalSource.includes('rollBiomeAndLayout(pickLayout)')
    // ARC-002: terrain-noise derivation is shared via src/world-constants.js
    // so the portal preview cannot drift from the real destination world.
    && constantsSource.includes('TERRAIN_NOISE_SEED_XOR = 0x5eed5eed')
    && constantsSource.includes('export function terrainNoiseFromSeed(seed)')
    && portalSource.includes('terrainNoiseFromSeed(seed)')
    // ARC-003/QA-013: terrainAmp is a shared helper (terrainAmpFor) so the
    // preview's amplitude cannot diverge from the real world's.
    && constantsSource.includes('export function terrainAmpFor(biome)')
    && constantsSource.includes('biome.cloudlike ? 2.15 : 3.2')
    && portalSource.includes('terrainAmpFor(targetBiome)')
    && portalSource.includes('targetBiome.water')
    && portalSource.includes('export function makeSeededPortalPlacement')
    && portalSource.includes('const rngSeed = ((seed >>> 0)')
    && portalSource.includes('maxRadiusFrac = 0.54')
    && portalSource.includes('minRadiusFrac = 0')
    && portalSource.includes('preferredAngle = null')
    && portalSource.includes('const isInsideMinRadius = (x, z) =>')
    && portalSource.includes('const buildPlacement = (p, y) =>')
    && portalSource.includes('withSeededRandom(rngSeed + tries, () => pickGroundPoint(maxRadiusFrac, { layout }))')
    && portalSource.includes('isInsideMinRadius(p.x, p.z)')
    && portalSource.includes('const radius = (layout?.boundRadius ?? 0) * Math.max(minRadiusFrac, maxRadiusFrac * 0.92)')
    && portalSource.includes('const baseAngle = preferredAngle ?? (mulberry32(rngSeed)() * Math.PI * 2)')
    && portalSource.includes('const heading = Math.atan2(-p.x, -p.z)')
    && portalSource.includes('flatZones: [')
    // ARC-003/QA-013: flat-zone application on a heightFn is shared with
    // world.js via applyFlatZonesToHeightFn instead of a hand-copied
    // applyPreviewFlatZones.
    && constantsSource.includes('export function applyFlatZonesToHeightFn(heightFn, flatZones)')
    && portalSource.includes('applyFlatZonesToHeightFn(rawHeightFn, portalAnchor.flatZones)')
    && portalSource.includes('const portalAnchor = makeSeededPortalPlacement({ seed, index: 0, layout, heightFn: rawHeightFn })')
    && portalSource.includes('function isInPortalPreviewSightline')
    && portalSource.includes('targetBiome.flora[Math.floor(rng() * targetBiome.flora.length)]')
    && portalSource.includes('import { FLORA_BUILDERS, withIsolatedFloraPool }')
    // QA-001/QA-002/QA-026: builder original is captured, cloned, then
    // disposed so its per-instance GPU resources don't leak each placement,
    // and the whole build runs against an isolated pool so a different
    // target biome's palette never contaminates the shared per-regen pool.
    && portalSource.includes('const original = builder(targetBiome)')
    && portalSource.includes('const obj = clonePreviewObjectUnique(original)')
    && portalSource.includes('disposeUnpooledPreviewOriginal(original, pool)')
    && portalSource.includes('withIsolatedFloraPool((pool) =>')
    && portalSource.includes('withIsolatedCreaturePool((pool) =>')
    && portalSource.includes('makeGrassField(targetBiome, heightFn')
    && portalSource.includes('makeCreature(targetBiome).group')
    && portalSource.includes('function makePreviewFloraGroundY')
    && portalSource.includes('const PREVIEW_FLORA_BURY = 0.08')
    && portalSource.includes('heightFn(x + fp, z)')
    && portalSource.includes('function isNearPortalPreviewClearance')
    && portalSource.includes('if (isNearPortalPreviewClearance(p.x, p.z, fp, portalAnchor)) continue')
    && portalSource.includes('makeSkyDome')
    && portalSource.includes('previewScene.add')
    && !portalSource.includes('PREVIEW_HERO_FLORA_SPOTS')
    && !portalSource.includes('PREVIEW_HERO_CREATURE_SPOTS')
    && !portalSource.includes('PREVIEW_GRASS_PATCHES')
    && !portalSource.includes('function makePreviewFloraObject')
    && !portalSource.includes('maxDensityMultiplier: 1')
    && !portalSource.includes('initialDensity: 1')
    && !portalSource.includes('makeCaterpillar('),
  'The portal preview should replay the destination seed terrain/layout and render the destination biome with production flora, grass, and creature builders.'
);

assert(
  portalSource.includes('function normalizePortalPreviewSettings')
    && portalSource.includes('function makePreviewGrass')
    && portalSource.includes('function makePreviewCreatures')
    && portalSource.includes('while (placed < targetCount && attempts < targetCount * 10)')
    && portalSource.includes('while (placed < count && attempts < count * 10)')
    && portalSource.includes('if (isInPortalPreviewSightline(p.x, p.z, portalAnchor)) continue')
    && portalSource.includes('function withPreviewWorldState')
    && portalSource.includes('x: portalAnchor.x')
    && portalSource.includes('z: portalAnchor.z')
    && portalSource.includes('nx: portalAnchor.nx')
    && portalSource.includes('nz: portalAnchor.nz')
    && portalSource.includes('const portalClearCapsules = [{')
    && portalSource.includes('halfLength: PORTAL_GRASS_CLEAR_HALF_LENGTH')
    && portalSource.includes('const grass = makeGrassField(targetBiome, heightFn, [], portalShortGrass, portalClearCapsules)')
    && portalSource.includes('makePreviewFloraGroundY(kind, scaleMul, p.x, p.z, heightFn)')
    && portalSource.includes('creature.position.set(p.x, y + 0.18, p.z)')
    && portalSource.includes('if (settings.portalPreviewFlora) previewScene.add(makePreviewFlora')
    && portalSource.includes('if (settings.portalPreviewGrass) previewScene.add(makePreviewGrass')
    && portalSource.includes('if (settings.portalPreviewCreatures) previewScene.add(makePreviewCreatures')
    && portalSource.includes('uFxStrength: { value: settings.portalPreviewFx ? 1 : 0 }')
    && portalSource.includes('export function updatePortalPreviewSettings')
    && portalSource.includes('disposeGroup(portal.previewScene)'),
  'Portal preview settings should gate grass, flora, preview creatures, and lightweight local FX, with live rebuild support.'
);

assert(
  worldSource.includes('createBiomePortal')
    && worldSource.includes('newRandomSeed')
    && worldSource.includes('disposeWorldPortals(worldState)')
    && worldSource.includes('worldState.portals = []')
    && worldSource.includes('function getPortalTargetBiomes')
    && worldSource.includes('worldState.userSettings.portalDoublePlacement === true')
    && worldSource.includes('const portalTargets = getPortalTargetBiomes')
    && worldSource.includes('terrainNoiseFromSeed(seed)')
    && constantsSource.includes('TERRAIN_NOISE_SEED_XOR = 0x5eed5eed')
    && worldSource.includes('for (let portalIndex = 0; portalIndex < portalTargets.length; portalIndex++)')
    && worldSource.includes('const targetBiome = portalTargets[portalIndex]')
    && worldSource.includes('const portalPlacementAnchors = []')
    && worldSource.includes('const portalMinDistSq = worldState.ISLAND_RADIUS * worldState.ISLAND_RADIUS')
    && worldSource.includes('const p = makeSeededPortalPlacement')
    && worldSource.includes('index: portalIndex')
    && worldSource.includes('maxRadiusFrac: worldState.userSettings.portalDoublePlacement === true ? 0.72 : 0.54')
    && worldSource.includes('minRadiusFrac: worldState.userSettings.portalDoublePlacement === true ? 0.48 : 0')
    && worldSource.includes('preferredAngle: portalPlacementAnchors.length')
    && worldSource.includes('isBlocked: (x, z) => blocksFloraPlacement(x, z, 2.2)')
    && worldSource.includes('portalPlacementAnchors.some((anchor) =>')
    && worldSource.includes('portalPlacementAnchors.push({ x: p.x, z: p.z })')
    && worldSource.includes('const portal = createBiomePortal')
    && worldSource.includes('const targetSeed = newRandomSeed({ allowedBiomeIds: [targetBiome.id], excludeBiomeId: biome.id })')
    && worldSource.includes('const portalGroundY = p.y')
    && worldSource.includes('for (const zone of p.flatZones) flattenTerrainCircle(zone.cx, zone.cz, zone.r, zone.flatY)')
    && worldSource.includes('worldState.portals.push(portal)')
    && worldSource.includes('if (worldState.userSettings.portalEnabled !== false)')
    && worldSource.includes('previewSettings: worldState.userSettings')
    && worldSource.includes('targetSeed')
    && worldSource.includes('floraPlacementBlocks.push(portal.blocker)')
    && worldSource.includes('const portalGrassClearances = floraPlacementBlocks')
    && worldSource.includes('const groundCoverExclusions = floraPlacementBlocks')
    && worldSource.includes('.filter(b => b.kind === "fairyring" || b.kind === "portal")')
    && worldSource.includes('.filter(b => b.kind === "portal" && b.grassClearance)')
    && worldSource.includes('makeGrassField(biome, worldState.heightFn, coverExclusions, grassShorteners, portalGrassClearances)')
    && worldSource.includes('makeWildflowerField(biome, worldState.heightFn, groundCoverExclusions)')
    && worldSource.includes('makeVerdantGroveDetails(biome, worldState.heightFn, groundCoverExclusions)')
    && worldSource.includes('worldState.obstacles.push(portal.obstacle)')
    && worldSource.includes('PLACEMENT_BLOCK_KINDS = new Set(["lavafissure", "portal"])')
    && worldSource.includes('"portal", "berrybush"')
    && worldSource.includes('GROUND_CREATURE_BLOCK_KINDS = new Set(["lavafissure", "fairyring", "portal"])')
    && worldSource.includes('CRAWLER_BLOCK_KINDS = new Set(["lavafissure", "fairyring", "portal"])')
    && worldSource.includes('makeSeededPortalPlacement')
    && portalSource.includes('const PORTAL_FLORA_BLOCK_RADIUS = PORTAL_RING_RADIUS + 1.0')
    && portalSource.includes('const PORTAL_GRASS_CLEAR_HALF_LENGTH = 2.08')
    && portalSource.includes('const PORTAL_GRASS_SHORTEN_RADIUS = PORTAL_RING_RADIUS * 1.45')
    && portalSource.includes('const PORTAL_GRASS_SHORTEN_TO = 0.14')
    && portalSource.includes('const PORTAL_PREVIEW_FLATTEN_RADIUS = 4.2')
    && portalSource.includes('const PORTAL_PREVIEW_FLATTEN_SIDE_RADIUS = 2.8')
    && portalSource.includes('const PORTAL_PREVIEW_GROUND_SINK = 0.15')
    && portalSource.includes('r: PORTAL_FLORA_BLOCK_RADIUS')
    && portalSource.includes('halfLength: PORTAL_GRASS_CLEAR_HALF_LENGTH')
    && worldSource.includes('const footprintBase = FLORA_FOOTPRINT[kind] ?? FLORA_FOOTPRINT_DEFAULT')
    && worldSource.includes('let fp = footprintBase * s')
    && worldSource.includes('const giantFp = footprintBase * giantS')
    // ARC-010/QA-014: the grove/verdant giant-flora promotion blocks were
    // consolidated into computeGiantFloraPromotion, shared across biomes via
    // the giantFlora flag instead of duplicated per-biome-id branches.
    && worldSource.includes('function computeGiantFloraPromotion(kind, p, footprintBase, s, placementBlockKinds)')
    && worldSource.includes('blocksFloraPlacement(p.x, p.z, giantFp * 1.2, placementBlockKinds)')
    && worldSource.includes('if (promotion?.tooFar || promotion?.blocked) continue')
    && worldSource.includes('s = promotion.s')
    && worldSource.includes('fp = promotion.fp')
    && grassSource.includes('function pointInExcludedCapsule')
    && grassSource.includes('const along = Math.max(-c.halfLength, Math.min(c.halfLength, dx * c.nx + dz * c.nz))')
    && grassSource.includes('for (const c of excludedCapsules)')
    && portalSource.includes('kind: "portal"'),
  'World generation should dispose prior portals, optionally place two unique-target portals, flatten their terrain pads, sink them, clear grass along their normals, and register them as flora/creature blockers.'
);

assert(
  uiSource.includes('updatePortalPreviewSettings')
    && uiSource.includes('disposePortal')
    && uiSource.includes('function eachPortal')
    && uiSource.includes('function disposeStatePortals')
    && uiSource.includes('setting-portal-details')
    && uiSource.includes('setting-portal-enabled')
    && uiSource.includes('setting-portal-double')
    && uiSource.includes('setting-portal-grass')
    && uiSource.includes('setting-portal-flora')
    && uiSource.includes('setting-portal-creatures')
    && uiSource.includes('setting-portal-fx')
    && uiSource.includes('state.userSettings.portalEnabled = portalEnabledEl.checked')
    && uiSource.includes('state.userSettings.portalDoublePlacement = portalDoubleEl.checked')
    && uiSource.includes('state.obstacles = state.obstacles.filter((o) => o.kind !== "portal")')
    && uiSource.includes('buildObstacleGrid(state.obstacles)')
    && uiSource.includes('void generateWorld(state.currentSeed)')
    && uiSource.includes('eachPortal((portal) => updatePortalPreviewSettings(portal, state.userSettings))')
    && uiSource.includes('state.userSettings.portalPanelOpen'),
  'The settings UI should expose live portal enable/double/preview toggles and persist the portal panel open state.'
);

assert(
  mainSource.includes('updatePortalPreview')
    && mainSource.includes('measurePerfPhase("portalPreview"')
    && mainSource.includes('function getActivePortals()')
    && mainSource.includes('for (const portal of getActivePortals())')
    && mainSource.includes('updatePortalPreview(portal, renderer, camera, rawT)'),
  'The animation loop should update every portal preview in a dedicated measured phase before the main render.'
);
