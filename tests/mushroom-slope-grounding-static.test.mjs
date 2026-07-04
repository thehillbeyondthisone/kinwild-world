// Behavioral coverage for addGroveMushroomFamily (src/flora/_shared.js):
// baby mushroom stems/caps/undersides must mark surfaceLift = 0 so
// world.js's terrain-conforming pass (grep'd below, owned by another agent)
// knows to snap them to the slope under the host flora instead of leaving
// them floating at their pre-placement offset height.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { BIOMES } from '../src/biomes.js';

globalThis.__APP_VERSION__ = 'test';
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

const { addGroveMushroomFamily } = await import('../src/flora/_shared.js');
const worldSource = ["world.js","world/atmosphere.js","world/flora-placement.js","world/fauna-population.js","world/ground-cover.js","world/portal-placement.js"].map((p) => readFileSync(new URL("../src/" + p, import.meta.url), "utf8")).join("\\n");

const verdant = BIOMES.find((biome) => biome.groveDetails?.mushroomFamilies);
assert(verdant, 'a biome with groveDetails.mushroomFamilies should exist.');

const group = new THREE.Group();
addGroveMushroomFamily(group, verdant);
assert(group.children.length > 0, 'addGroveMushroomFamily should add baby mushroom parts to the group.');

const stems = group.children.filter((c) => c.geometry.type === 'CylinderGeometry');
// SphereGeometry is also used by the (unrelated) glow-spore decoration this
// helper adds when the biome opts into groveDetails.sporeGlow — mushroom cap
// spheres are much larger (radius 0.085 vs. the spores' 0.0195), so filter
// on that instead of just the geometry type.
const caps = group.children.filter((c) => c.geometry.type === 'SphereGeometry' && c.geometry.parameters.radius > 0.05);
assert(stems.length > 0, 'Baby mushroom family should include stem meshes.');
assert(caps.length > 0, 'Baby mushroom family should include cap meshes.');
const undersides = group.children.filter((c) => c.geometry.type === 'BufferGeometry');

assert(
  stems.every((stem) => stem.userData.surfaceLift === 0),
  'Baby mushroom stems should mark their root for terrain conforming on slopes.'
);
assert(
  caps.every((cap) => cap.userData.surfaceLift === 0),
  'Baby mushroom caps should follow the same conformed root height as their stems.'
);
assert(
  undersides.length > 0 && undersides.every((underside) => underside.userData.surfaceLift === 0),
  'Baby mushroom undersides should follow the same conformed root height as their stems.'
);

assert.match(
  worldSource,
  /if \(kind === "lavafissure" \|\| kind === "mushroom" \|\| kind === "bigmushroom"\) conformSurfaceChildrenToTerrain\(f\);/,
  'World generation should terrain-conform offset mushroom family pieces after final placement and scale.'
);

console.log('mushroom-slope-grounding-static.test.mjs passed');
