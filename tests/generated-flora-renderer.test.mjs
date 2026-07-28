import assert from "node:assert/strict";
import * as THREE from "three";

globalThis.__APP_VERSION__ = "test";

const { FLORA_ARCHETYPES, buildSpecies } = await import(
  "../src/generated-flora/index.js"
);
const { ARCHETYPES } = await import("../src/generated-flora/archetypes.js");
const { state } = await import("../src/state.js");

const biome = {
  ground: ["#31442e", "#6a934d", "#abc978"],
  accent: "#f48668",
  sun: "#fff2b5",
  cliff: "#29332b",
  leafballTreePalette: {
    trunk: "#775139",
    leaves: ["#41613a", "#6f9c50", "#aecb78"],
  },
};

/**
 * The budget that makes island-wide density possible at all. One merged stem
 * plus one instanced mesh per organ type — not one mesh per organ.
 */
const MAX_MESHES_PER_PLANT = 6;

function collectRenderables(group) {
  const result = [];
  group.traverse((object) => {
    if (object.isMesh) result.push(object);
  });
  return result;
}

function collectResources(group) {
  const geometries = new Set();
  const materials = new Set();
  for (const mesh of collectRenderables(group)) {
    geometries.add(mesh.geometry);
    const meshMaterials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const material of meshMaterials) materials.add(material);
  }
  return { geometries, materials };
}

function snapshotScene(group) {
  group.updateMatrixWorld(true);
  const result = [];
  group.traverse((object) => {
    object.updateMatrix();
    const entry = {
      type: object.type,
      matrix: object.matrix.toArray(),
    };
    if (object.isInstancedMesh) {
      entry.count = object.count;
      entry.instanceMatrix = Array.from(object.instanceMatrix.array);
      entry.instanceColor = object.instanceColor
        ? Array.from(object.instanceColor.array)
        : null;
    }
    result.push(entry);
  });
  return result;
}

function assertGeometryInsideSphere(group, sphere, label) {
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group, true);
  assert.equal(box.isEmpty(), false, `${label} should have renderable bounds`);
  group.traverse((object) => {
    if (!object.isMesh) return;
    const positions = object.geometry.getAttribute("position");
    const instanceMatrix = new THREE.Matrix4();
    const worldMatrix = new THREE.Matrix4();
    const vertex = new THREE.Vector3();
    const instanceCount = object.isInstancedMesh ? object.count : 1;
    for (let instanceIndex = 0; instanceIndex < instanceCount; instanceIndex++) {
      if (object.isInstancedMesh) {
        object.getMatrixAt(instanceIndex, instanceMatrix);
        worldMatrix.multiplyMatrices(object.matrixWorld, instanceMatrix);
      } else {
        worldMatrix.copy(object.matrixWorld);
      }
      for (let vertexIndex = 0; vertexIndex < positions.count; vertexIndex++) {
        vertex.fromBufferAttribute(positions, vertexIndex).applyMatrix4(worldMatrix);
        assert(
          vertex.distanceTo(sphere.center) <= sphere.radius + 1e-4,
          `${label} world sphere should contain every rendered vertex`
        );
      }
    }
  });
}

function instrumentDisposal(resources) {
  const calls = new Map();
  for (const resource of [...resources.geometries, ...resources.materials]) {
    const original = resource.dispose.bind(resource);
    calls.set(resource, 0);
    resource.dispose = () => {
      calls.set(resource, calls.get(resource) + 1);
      original();
    };
  }
  return calls;
}

const silhouettes = new Map();

for (const archetype of FLORA_ARCHETYPES) {
  const species = buildSpecies(
    { archetype, name: `${archetype} proof`, seed: `${archetype}-proof` },
    { biome },
  );
  assert.equal(species.archetype, archetype);
  assert.equal(species.dna.archetype, archetype);
  assert.equal(species.role, ARCHETYPES[archetype].role);
  assert.equal(species.windUniforms, state.windUniforms);
  assert.equal(species.disposed, false);
  assert.equal(species.instanceCount, 0);
  assert(species.bounds.radius > 0, `${archetype} bounds radius`);
  assert(species.bounds.height > 0, `${archetype} bounds height`);
  assert(species.bounds.footprintRadius > 0);
  assert(species.bounds.dynamicMargin >= 0);
  assert.deepEqual(
    [...species.affordanceSchema].sort(),
    [...ARCHETYPES[archetype].affordances].sort(),
    `${archetype} should advertise exactly the affordances it declares`,
  );
  assert(species.resourceCounts.geometries > 0);
  assert(species.resourceCounts.materials > 0);
  assert(Object.isFrozen(species));
  assert(Object.isFrozen(species.dna));

  // A skeleton is a graph with path-derived ids, inside budget, or absent —
  // `cover` is a patch rather than a structure and legitimately has none.
  if (species.skeleton.nodes.length > 0) {
    assert(species.skeleton.nodes.length <= 40, `${archetype} node budget`);
    const ids = new Set(species.skeleton.nodes.map((node) => node.id));
    assert.equal(ids.size, species.skeleton.nodes.length);
    for (const node of species.skeleton.nodes) {
      if (node.parent !== null) {
        assert(ids.has(node.parent), `${archetype}: ${node.id} lost its parent`);
      }
    }
  }

  const placement = {
    id: "stable-placement",
    position: [10, 2, -4],
    rotationY: 0.37,
    scale: 1.25,
  };
  const first = species.createInstance(placement);
  const second = species.createInstance(placement);
  assert.equal(species.instanceCount, 2);
  assert.equal(first.instanceId, second.instanceId);
  assert.deepEqual(
    snapshotScene(first.group),
    snapshotScene(second.group),
    `${archetype}: the same placement must build the same plant`,
  );
  assert.equal(first.group.userData.generatedFlora.speciesId, species.id);
  assert.deepEqual(
    new Set(first.affordances.map(({ type }) => type)),
    new Set(species.affordanceSchema),
  );

  const firstRenderables = collectRenderables(first.group);
  const secondRenderables = collectRenderables(second.group);
  assert.ok(firstRenderables.length > 0, `${archetype} should render something`);
  assert.ok(
    firstRenderables.length <= MAX_MESHES_PER_PLANT,
    `${archetype} spends ${firstRenderables.length} meshes per plant`,
  );
  assert.equal(firstRenderables.length, secondRenderables.length);
  for (let i = 0; i < firstRenderables.length; i++) {
    assert.equal(
      firstRenderables[i].geometry,
      secondRenderables[i].geometry,
      `${archetype} instances should share geometry`,
    );
    assert.equal(
      firstRenderables[i].material,
      secondRenderables[i].material,
      `${archetype} instances should share material`,
    );
  }

  const resources = collectResources(first.group);
  assert.equal(resources.geometries.size, species.resourceCounts.geometries);
  assert.equal(resources.materials.size, species.resourceCounts.materials);

  const windMaterial = [...resources.materials].find(
    (material) => material.userData.windStrength > 0,
  );
  assert(windMaterial, `${archetype} should opt into shared wind`);
  const shader = {
    uniforms: {},
    vertexShader: "#include <common>\nvoid main() {\n#include <begin_vertex>\n}",
  };
  windMaterial.onBeforeCompile(shader);
  assert.equal(shader.uniforms.uTime, state.windUniforms.uTime);
  assert.equal(shader.uniforms.uFoliageWind, state.windUniforms.uFoliageWind);
  assert.match(shader.vertexShader, /uniform float uFoliageWind/);
  assert.match(shader.vertexShader, /#ifdef USE_INSTANCING/);

  const touchStartA = first.touch(1, { x: 3, z: 4 });
  const touchStartB = second.touch(1, { x: 3, z: 4 });
  assert.deepEqual(touchStartA, touchStartB);
  const touchStepA = first.update(1 / 60);
  assert.deepEqual(touchStepA, second.update(1 / 60));
  assert.equal(touchStepA.active, true);
  assert.notEqual(touchStepA.value, 0);
  const touchPivot = first.group.children[0].children[0];
  assert.notEqual(touchPivot.rotation.x, 0);
  assert.notEqual(touchPivot.rotation.z, 0);
  if (species.role === "ground") {
    const restPivot = first.group.children[0];
    assert.equal(Math.abs(restPivot.rotation.x), 0, "groundcover has no rest lean");
    assert.equal(Math.abs(restPivot.rotation.z), 0);
  }
  first.resetTouch();
  second.resetTouch();
  assert.equal(first.touchState().active, false);

  const sphere = first.getWorldBounds();
  assert(Math.abs(sphere.center.x - 10) < 1e-9);
  assert(Math.abs(sphere.center.y - (2 + species.bounds.center[1] * 1.25)) < 1e-9);
  assert(Math.abs(sphere.center.z + 4) < 1e-9);
  assert(Math.abs(sphere.radius - species.bounds.radius * 1.25) < 1e-9);
  assertGeometryInsideSphere(first.group, sphere, archetype);

  const worldAffordances = first.getWorldAffordances();
  assert.equal(worldAffordances.length, first.affordances.length);
  assert(worldAffordances.every((entry) => entry.space === "world"));
  assert(worldAffordances.every((entry) => entry.position.isVector3));

  const box = new THREE.Box3().setFromObject(first.group, true);
  silhouettes.set(archetype, {
    height: box.max.y - box.min.y,
    width: Math.max(box.max.x - box.min.x, box.max.z - box.min.z),
  });

  const disposalCalls = instrumentDisposal(resources);
  first.dispose();
  assert.equal(first.disposed, true);
  assert.equal(species.instanceCount, 1);
  assert(
    [...disposalCalls.values()].every((count) => count === 0),
    "instance disposal must preserve species-owned geometry and materials",
  );
  first.dispose();

  species.dispose();
  assert.equal(species.disposed, true);
  assert.equal(second.disposed, true);
  assert.equal(species.instanceCount, 0);
  assert(
    [...disposalCalls.values()].every((count) => count === 1),
    "species disposal must release every shared resource exactly once",
  );
  species.dispose();
  assert(
    [...disposalCalls.values()].every((count) => count === 1),
    "species disposal must be idempotent",
  );
  assert.throws(() => species.createInstance({ id: "too-late" }), /has been disposed/);
}

// The complaint this rework answers: the three hero families were three sets
// of numbers inside one mushroom renderer. Their proportions must now differ.
const heroes = ["canopy", "spire", "cap"].map((key) => ({
  key,
  ...silhouettes.get(key),
}));
const aspect = (entry) => entry.height / Math.max(entry.width, 1e-6);
assert.ok(
  aspect(heroes[1]) > aspect(heroes[2]) * 1.5,
  "a spire should read as far taller than wide against a cap",
);
assert.ok(
  heroes[0].width > heroes[1].width,
  "a canopy should spread wider than a spire",
);

// The Veilcrown's separated crown and pendant signals survive as organ counts
// rather than a `dna.name === "Veilcrown"` branch in the compiler.
const veilcrown = buildSpecies(
  {
    archetype: "cap",
    name: "Shroudplume",
    seed: "veilcrown-topology",
    shape: {
      height: 4.25,
      stemCount: 4,
      stemRadius: 0.5,
      taper: 0.9,
      capRadius: 1.72,
      capDepth: 0.62,
      lobeCount: 7,
      spotCount: 12,
      pendantCount: 17,
    },
  },
  { biome },
);
const veilInstance = veilcrown.createInstance({ id: "veil-proof" });
const veilInstanced = collectRenderables(veilInstance.group).filter(
  (mesh) => mesh.isInstancedMesh,
);
assert.ok(
  veilInstanced.some((mesh) => mesh.count === 7),
  "the seven-lobe radial crown should survive the archetype rewrite",
);
assert.ok(
  veilInstanced.filter((mesh) => mesh.count === 17).length >= 2,
  "pendant signals should still hang from their own filaments",
);
assert.ok(
  veilInstanced.some(
    (mesh) => mesh.count === 17 && mesh.layers.isEnabled(1),
  ),
  "pendant signals should still enter selective bloom",
);
assertGeometryInsideSphere(
  veilInstance.group,
  veilInstance.getWorldBounds(),
  "Shroudplume",
);
veilcrown.dispose();

// So does the Pulsebell's lathed hood and its hanging glow.
const pulsebells = buildSpecies(
  {
    archetype: "bell",
    name: "Chimeveil",
    seed: "pulsebell-topology",
    shape: {
      clusterRadius: 0.92,
      stemCount: 6,
      stemHeight: 1.1,
      bloomRadius: 0.23,
      leafPairs: 1,
    },
  },
  { biome },
);
const pulseInstance = pulsebells.createInstance({ id: "pulsebell-proof" });
const pulseRenderables = collectRenderables(pulseInstance.group);
assert.ok(
  pulseRenderables.some((mesh) => mesh.geometry.type === "LatheGeometry"),
  "the open lathed hood silhouette should survive",
);
assert.ok(
  pulseRenderables.some(
    (mesh) => (mesh.material.emissiveIntensity ?? 0) >= 1 && mesh.layers.isEnabled(1),
  ),
  "the selectively blooming hanging pulse should survive",
);
assertGeometryInsideSphere(
  pulseInstance.group,
  pulseInstance.getWorldBounds(),
  "Chimeveil",
);
pulsebells.dispose();

console.log("generated flora renderer invariants passed");
