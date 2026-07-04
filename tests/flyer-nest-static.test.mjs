// Behavioral coverage for the flyer_nest flora builder (src/flora/
// structures.js) and the balloontree crown-height metadata it can perch on
// (src/flora/volcanic.js). Protects: nests are never in a biome's random
// flora budget (they're placed from the actual flyer count instead), the
// builder derives its bowl/ring/twig colors from the biome-aware nest
// palette, and it publishes capTopY/perchRadius so world.js can place fliers
// on top of it. world.js placement logic and fauna/creature.js perch
// targeting stay as source-text greps since those files are owned by other
// concurrent agents.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BIOMES } from '../src/biomes.js';

globalThis.__APP_VERSION__ = 'test';
globalThis.window = { location: { search: '' }, matchMedia: () => ({ matches: false }) };
Object.defineProperty(globalThis, 'navigator', { value: { maxTouchPoints: 0 }, configurable: true });
globalThis.document = {
  createElement() {
    return {
      width: 0,
      height: 0,
      getContext() {
        return {
          createImageData(w, h) {
            return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
          },
          putImageData() {},
        };
      },
    };
  },
};

const { FLORA_BUILDERS, withIsolatedFloraPool } = await import('../src/flora.js');
const { getFlyerNestPalette } = await import('../src/flora/_shared.js');
const { INSPECT_FLORA_KINDS } = await import('../src/inspect.js');

const worldSource = readFileSync(new URL('../src/world.js', import.meta.url), 'utf8');
const worldConstantsSource = readFileSync(new URL('../src/world-constants.js', import.meta.url), 'utf8');
const creatureSource = readFileSync(new URL('../src/fauna/creature.js', import.meta.url), 'utf8');

assert.equal(typeof FLORA_BUILDERS.flyer_nest, 'function', 'flyer_nest should be registered as a named flora builder.');

for (const biome of BIOMES) {
  assert(
    !biome.flora.includes('flyer_nest'),
    `${biome.id} should not spend random flora budget on flyer nests; nests are placed from the actual flyer count.`
  );
}

const cloudBiome = BIOMES.find((biome) => biome.id === 'cloud');
assert.equal(
  cloudBiome?.noFlyerNests,
  true,
  'cloud island should keep balloon trees but opt out of flyer nest generation.'
);

// Build a real flyer_nest group and inspect the actual meshes/userData
// instead of grepping the builder's source text.
const golden = BIOMES.find((biome) => biome.id === 'golden');
assert(golden, 'golden steppe biome should exist.');
const nest = withIsolatedFloraPool(() => FLORA_BUILDERS.flyer_nest(golden));

const bowl = nest.children.find((c) => c.geometry.type === 'CircleGeometry');
assert(bowl, 'flyer_nest should build an inner bowl mesh from a circle geometry.');
assert.equal(bowl.material.side, 2 /* THREE.DoubleSide */, 'flyer_nest bowl should render both sides.');

const ring = nest.children.find((c) => c.geometry.type === 'TorusGeometry');
assert(ring, 'flyer_nest should build an outer ring mesh from a torus geometry.');
assert.equal(ring.geometry.parameters.radius, 0.558, 'flyer_nest outer ring radius should be 0.558.');
assert.equal(ring.geometry.parameters.tube, 0.252, 'flyer_nest outer ring tube radius should be 0.252.');

const twigs = nest.children.filter((c) => c !== bowl && c !== ring);
assert.equal(twigs.length, 18, 'flyer_nest should build 18 twigs around the bowl.');
assert(twigs.every((twig) => twig.castShadow), 'flyer_nest twigs should cast shadows.');
const twigMaterials = new Set(twigs.map((twig) => twig.material));
assert.equal(twigMaterials.size, 2, 'flyer_nest twigs should alternate between the base and light-highlight twig materials.');

assert.equal(nest.userData.capTopY, 0.387, 'flyer_nest should publish an explicit perch cap height.');
assert.equal(nest.userData.perchRadius, 0.612, 'flyer_nest should publish an explicit perch radius.');

// makeFlyerNestPBRMaterial resets material.color to white and carries the
// biome-derived palette through a baked color texture instead (see
// src/pbr.js), so the tint itself isn't readable off material.color — assert
// the palette helper produces two distinct biome-derived colors and that the
// bowl material is wired up to render from that color texture.
const palette = getFlyerNestPalette(golden);
assert.notEqual(
  palette.base.getHex(),
  palette.light.getHex(),
  'flyer_nest base and light-highlight palette colors should be biome-derived and distinct.'
);
assert(bowl.material.map?.isTexture, 'flyer_nest bowl should render its biome-derived color from a baked color texture.');

const balloonNest = withIsolatedFloraPool(() => FLORA_BUILDERS.balloontree(cloudBiome));
assert(
  Number.isFinite(balloonNest.userData.capTopY) && balloonNest.userData.capTopY > 0,
  'balloontree should publish a per-instance crown height so hosted flyer nests sit on the puff canopy instead of using the loose obstacle fallback.'
);

assert(
  worldConstantsSource.includes('flyer_nest: 0.612')
    && worldSource.includes('"flyer_nest"')
    && worldSource.includes('function placeFlyerNest()')
    && worldSource.includes('const kind = "flyer_nest"')
    && worldSource.includes('let s = Math.max(1.05, 0.7 + Math.random() * 0.7)')
    && worldSource.includes('kind === "flyer_nest"')
    && worldSource.includes('perchRadius: (f.userData.perchRadius ?? 0.4) * s'),
  'world generation should place flyer_nest as a large obstacle/perch with a scaled landing radius.'
);

assert(
  worldSource.includes('const NEST_HOST_KINDS = new Set(["tree", "leafballtree", "pine", "snowpine", "balloontree", "bigmushroom", "pillar"])')
    && worldSource.includes('const biomeHasNestHosts = biome.flora.some((kind) => NEST_HOST_KINDS.has(kind))')
    && worldSource.includes('const MIN_NEST_HOST_RADIUS')
    && worldSource.includes('const nestHosts = []')
    && worldSource.includes('function blocksNestPlacement')
    && worldSource.includes('if (block === allowedHostBlock) continue')
    && worldSource.includes('function nestTouchesWater(x, z, r)')
    && worldSource.includes('function sampleTerrainFootprint(x, z, r)')
    && worldSource.includes('function getFlyerNestGroundPose(x, z, r, scale)')
    && worldSource.includes('maxY - FLYER_NEST_BASE_CLEARANCE * scale')
    && worldSource.includes('function pickNestHost')
    && worldSource.includes('if (!choices.length) return null')
    && worldSource.includes('if (nestTouchesWater(host.x, host.z, r * 1.2)) continue')
    && worldSource.includes('let nestHost = biomeHasNestHosts ? pickNestHost(fp) : null')
    && worldSource.includes('if (biomeHasNestHosts) return false')
    && worldSource.includes('const candidatePose = getFlyerNestGroundPose(candidate.x, candidate.z, fp, s)')
    && worldSource.includes('if (!candidatePose) continue')
    && worldSource.includes('if (nestTouchesWater(candidate.x, candidate.z, fp * 1.2)) continue')
    && worldSource.includes('kind === "flyer_nest" && nestHost')
    && worldSource.includes('perchKind: "flyer_nest"')
    && worldSource.includes('perchKind: kind')
    && worldSource.includes('nestHosts.push({')
    && worldSource.includes('hostKind: kind'),
  'flyer_nest placement should avoid ground flora, other nests, water overlap, and terrain clipping, using eligible trees, large mushrooms, or wide pillars as hosts.'
);

assert(
  worldSource.includes('const flyerCount = worldState.creatures.filter((c) => c.flies && !c.isFish && !c.isBee).length')
    && worldSource.includes('const flyerNestTarget = biome.noFlyerNests ? 0 : flyerCount < 4 ? flyerCount : Math.ceil(flyerCount / 2)')
    && worldSource.includes('while (flyerNestPlaced < flyerNestTarget')
    && worldSource.includes('if (placeFlyerNest()) flyerNestPlaced++')
    && !worldSource.includes('worldState.bees.filter')
    && !worldSource.includes('worldState.flocks.filter'),
  'world generation should match nest count to perch-using flyers below four, then round up half for larger counts, without counting bees or flocks.'
);

assert(
  creatureSource.includes('function releasePerchForFlier(c)')
    && creatureSource.includes('function claimPerchForFlier(c, perch)')
    && creatureSource.includes('isBee: isBumblebee')
    && creatureSource.includes('if (c.isFish || c.isBee) return')
    && creatureSource.includes('perch.occupant')
    && creatureSource.includes('let nearestNest = null')
    && creatureSource.includes('let nearestOther = null')
    && creatureSource.includes('if (p.perchKind === "flyer_nest")')
    && creatureSource.includes('const nearest = nearestNest ?? nearestOther')
    && creatureSource.includes('claimPerchForFlier(c, nearest)')
    && creatureSource.includes('releasePerchForFlier(c);'),
  'flier perch targeting should reserve and release perches so only one eligible flier occupies a perch target, preferring free nests before other perch types.'
);

assert(
  creatureSource.includes('PERCHED_WING_DOWN_Z')
    && creatureSource.includes('PERCHED_WING_BACK_Y')
    && creatureSource.includes('const restRotZ = sign * PERCHED_WING_DOWN_Z')
    && creatureSource.includes('const restRotY = sign * PERCHED_WING_BACK_Y'),
  'perched fliers should hold wings down and back instead of the old raised/tucked pose.'
);

assert(
  INSPECT_FLORA_KINDS.includes('flyer_nest'),
  'Inspect flora catalog should expose the flyer nest specimen.'
);

console.log('flyer-nest-static.test.mjs passed');
