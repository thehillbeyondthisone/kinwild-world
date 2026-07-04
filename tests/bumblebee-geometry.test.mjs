// Behavioral regression test (audit QA-009) for bumblebee-specific geometry.
// Protects the invariant that the bumblebee flier variant gets distinct
// geometry (larger eyes/pupils, taller forward-tilted antennae, a stinger
// cone oriented rearward) while `addAntennae`'s shared defaults — used by
// every other antenna-bearing creature — stay untilted and unchanged.

import assert from 'node:assert/strict';
import * as THREE from 'three';

globalThis.__APP_VERSION__ = 'test';
globalThis.window = {
  location: { search: '' },
  matchMedia: () => ({ matches: false }),
};
Object.defineProperty(globalThis, 'navigator', {
  value: { maxTouchPoints: 0 },
  configurable: true,
});

const { BIOMES } = await import('../src/biomes.js');
const { makeCreature } = await import('../src/fauna/creature.js');
const { addAntennae } = await import('../src/fauna/shared.js');

const biome = BIOMES.find((b) => b.id === 'verdant') ?? BIOMES[0];

const bee = makeCreature(biome, {
  variant: 'bumblebee',
  stripeColors: ['#111111', '#ffd13b'],
});

// Eyes/pupils scale up 1.1x for bumblebees; eyeParts alternates eye, pupil.
for (const part of bee.eyeParts) {
  assert.equal(part.scale.x, 1.1, 'bumblebee eyes/pupils should be scaled up 1.1x');
}

// Antennae are always grown for bumblebees, taller and tilted forward.
assert.equal(bee.antennae.length, 2, 'bumblebee should always grow a pair of antennae');
for (const stalk of bee.antennae) {
  assert.ok(
    Math.abs(stalk.geometry.parameters.height - 0.4608) < 1e-9,
    'bumblebee antenna stalk height should be 0.4608'
  );
  assert.ok(
    Math.abs(stalk.rotation.x - THREE.MathUtils.degToRad(20)) < 1e-9,
    'bumblebee antennae should tilt forward 20deg'
  );
  assert.ok(
    Math.abs(stalk.position.z - 0.22) < 1e-9,
    'bumblebee antenna base should sit forward at z=0.22'
  );
}

// Stinger — a thin black cone at the rear, present only on bumblebees.
const stinger = bee.group.children.find((child) => child.geometry?.type === 'ConeGeometry');
assert.ok(stinger, 'bumblebee should have a stinger cone mesh');
assert.equal(stinger.geometry.parameters.radius, 0.045, 'stinger cone radius');
assert.equal(stinger.geometry.parameters.height, 0.45, 'stinger cone height');
assert.equal(stinger.geometry.parameters.radialSegments, 5, 'stinger cone segments');

// The stinger cone is authored pointing along Y then rotated -90deg about X
// and pushed to the rear (z=-0.55) — verify the baked geometry actually
// ended up long along Z (not Y) and sitting behind the body.
stinger.geometry.computeBoundingBox();
const box = stinger.geometry.boundingBox;
const sizeY = box.max.y - box.min.y;
const sizeZ = box.max.z - box.min.z;
assert.ok(sizeZ > sizeY, 'stinger cone should be rotated to run along Z, not Y');
assert.ok(box.max.z < 0, 'stinger cone should be translated behind the body (negative z)');

// The shared addAntennae() defaults (used by every non-bee antenna-bearing
// creature) must stay untilted and at the original stalk height/baseZ.
const scratchParent = new THREE.Group();
const [defaultStalk] = addAntennae(scratchParent, biome, new THREE.Color(0x336633));
assert.equal(defaultStalk.rotation.x, 0, 'default antennae should have no forward tilt');
assert.equal(defaultStalk.geometry.parameters.height, 0.32, 'default antenna stalk height');
assert.equal(defaultStalk.position.z, 0.1, 'default antenna base z offset');
