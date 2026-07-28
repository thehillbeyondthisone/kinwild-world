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
 * The batch budget. A species draws one batch per (structural variant × organ
 * type) plus its stems — a number set by the roster, never by how many plants
 * the field happens to hold. That invariant is the whole point of Stage 2.
 */
const MAX_BATCHES_PER_SPECIES = 14;

function drawnRows(species) {
  const rows = [];
  species.batchRoot.updateMatrixWorld(true);
  const matrix = new THREE.Matrix4();
  for (const mesh of species.batchMeshes()) {
    for (let row = 0; row < mesh.count; row++) {
      mesh.getMatrixAt(row, matrix);
      rows.push({ mesh, row, matrix: matrix.toArray() });
    }
  }
  return rows;
}

function assertRowsInsideSphere(species, sphere, label) {
  const rowMatrix = new THREE.Matrix4();
  const worldMatrix = new THREE.Matrix4();
  const vertex = new THREE.Vector3();
  let vertexCount = 0;
  species.batchRoot.updateMatrixWorld(true);
  for (const mesh of species.batchMeshes()) {
    const positions = mesh.geometry.getAttribute("position");
    for (let row = 0; row < mesh.count; row++) {
      mesh.getMatrixAt(row, rowMatrix);
      // A cleared row is scaled to zero and never rendered.
      if (rowMatrix.elements[0] === 0 && rowMatrix.elements[5] === 0) continue;
      worldMatrix.multiplyMatrices(mesh.matrixWorld, rowMatrix);
      for (let index = 0; index < positions.count; index++) {
        vertex.fromBufferAttribute(positions, index).applyMatrix4(worldMatrix);
        assert(
          vertex.distanceTo(sphere.center) <= sphere.radius + 1e-4,
          `${label} world sphere should contain every rendered vertex`,
        );
        vertexCount++;
      }
    }
  }
  assert(vertexCount > 0, `${label} should render something`);
}

function instrumentDisposal(species) {
  const calls = new Map();
  const resources = new Set();
  for (const mesh of species.batchMeshes()) {
    resources.add(mesh.geometry);
    resources.add(mesh.material);
  }
  for (const resource of resources) {
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
  assert.equal(species.role, ARCHETYPES[archetype].role);
  assert.equal(species.windUniforms, state.windUniforms);
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
  assert(Object.isFrozen(species));
  assert(Object.isFrozen(species.dna));

  // An empty species draws nothing at all: batches exist but hold no rows.
  assert.equal(
    species.batchMeshes().reduce((sum, mesh) => sum + mesh.count, 0),
    0,
    `${archetype} should draw no rows before anything is planted`,
  );

  for (const skeleton of species.skeletons) {
    if (skeleton.nodes.length === 0) continue;
    assert(skeleton.nodes.length <= 40, `${archetype} node budget`);
    const ids = new Set(skeleton.nodes.map((node) => node.id));
    assert.equal(ids.size, skeleton.nodes.length);
    for (const node of skeleton.nodes) {
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
  assert.equal(species.instanceCount, 1);
  assert.equal(first.group.children.length, 0, "a plant is rows, not meshes");
  assert.equal(first.group.userData.generatedFlora.speciesId, species.id);
  assert.deepEqual(
    new Set(first.affordances.map(({ type }) => type)),
    new Set(species.affordanceSchema),
  );

  const sphere = first.getWorldBounds();
  assert(Math.abs(sphere.center.x - 10) < 1e-9);
  assert(Math.abs(sphere.center.y - (2 + species.bounds.center[1] * 1.25)) < 1e-9);
  assert(Math.abs(sphere.center.z + 4) < 1e-9);
  assert(Math.abs(sphere.radius - species.bounds.radius * 1.25) < 1e-9);
  assertRowsInsideSphere(species, sphere, archetype);

  const box = new THREE.Box3();
  const rowMatrix = new THREE.Matrix4();
  for (const mesh of species.batchMeshes()) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    for (let row = 0; row < mesh.count; row++) {
      mesh.getMatrixAt(row, rowMatrix);
      if (rowMatrix.elements[0] === 0 && rowMatrix.elements[5] === 0) continue;
      box.union(mesh.geometry.boundingBox.clone().applyMatrix4(rowMatrix));
    }
  }
  silhouettes.set(archetype, {
    height: box.max.y - box.min.y,
    width: Math.max(box.max.x - box.min.x, box.max.z - box.min.z),
  });

  // Same placement, same plant — batching must not make a plant depend on
  // when it happened to be created.
  const twin = buildSpecies(
    { archetype, name: `${archetype} proof`, seed: `${archetype}-proof` },
    { biome },
  );
  const twinFirst = twin.createInstance(placement);
  assert.equal(first.instanceId, twinFirst.instanceId);
  assert.equal(first.variantIndex, twinFirst.variantIndex);
  assert.deepEqual(
    drawnRows(species).map((entry) => entry.matrix),
    drawnRows(twin).map((entry) => entry.matrix),
    `${archetype}: the same placement must build the same rows`,
  );
  twin.dispose();

  // Wind is still shared, and the touch bend now rides in the same shader.
  const materials = new Set(species.batchMeshes().map((mesh) => mesh.material));
  const windMaterial = [...materials].find(
    (material) => material.userData.windStrength > 0,
  );
  assert(windMaterial, `${archetype} should opt into shared wind`);
  const shader = {
    uniforms: {},
    vertexShader:
      "#include <common>\nvoid main() {\n#include <begin_vertex>\n#include <project_vertex>\n}",
  };
  windMaterial.onBeforeCompile(shader);
  assert.equal(shader.uniforms.uTime, state.windUniforms.uTime);
  assert.equal(shader.uniforms.uFoliageWind, state.windUniforms.uFoliageWind);
  assert.match(shader.vertexShader, /uniform float uFoliageWind/);
  assert.match(shader.vertexShader, /#ifdef USE_INSTANCING/);
  assert.match(shader.vertexShader, /uFloraTouch/, "touch bend should be patched in");
  assert.match(
    shader.vertexShader,
    /attribute float aPlantIndex/,
    "rows must be able to find their plant's motion texel",
  );
  assert(
    shader.vertexShader.indexOf("uFloraTouch, touchUv") >
      shader.vertexShader.indexOf("instanceMatrix * mvPosition"),
    "the bend must run after instanceMatrix, in the batch root's space",
  );

  // Draw calls are a property of the roster, not of the field's density.
  const batchesWithOnePlant = species.batchMeshes().length;
  const crowd = [];
  for (let index = 0; index < 40; index++) {
    crowd.push(species.createInstance({ id: `crowd-${index}`, position: [index, 0, 0] }));
  }
  assert.equal(
    species.batchMeshes().length,
    batchesWithOnePlant,
    `${archetype}: 41 plants must not cost more batches than one`,
  );
  assert(
    batchesWithOnePlant <= MAX_BATCHES_PER_SPECIES,
    `${archetype} spends ${batchesWithOnePlant} batches`,
  );
  assert(
    species.batchMeshes().every((mesh) => mesh.count <= mesh.instanceMatrix.count),
    "a batch must never draw past its allocated rows",
  );

  // Touch: the spring stays on the CPU and its snapshot is unchanged, which
  // is what the observatory's resonance trace reads.
  const started = first.touch(1, { x: 3, z: 4 });
  assert(Math.abs(started.direction.x - 0.6) < 1e-9);
  assert(Math.abs(started.direction.z - 0.8) < 1e-9);
  const stepped = first.update(1 / 60);
  assert.equal(stepped.active, true);
  assert.notEqual(stepped.value, 0);
  first.resetTouch();
  assert.equal(first.touchState().active, false);

  // Disposal frees the plant's rows without touching species-owned resources.
  const disposalCalls = instrumentDisposal(species);
  const victim = crowd.pop();
  victim.dispose();
  assert.equal(victim.disposed, true);
  assert(
    [...disposalCalls.values()].every((count) => count === 0),
    "plant disposal must preserve species-owned geometry and materials",
  );
  victim.dispose();

  species.dispose();
  assert.equal(species.disposed, true);
  assert.equal(first.disposed, true);
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
const veilBatches = veilcrown.batchMeshes();
assert.ok(
  veilBatches.some((mesh) => mesh.count === 7),
  "the seven-lobe radial crown should survive batching",
);
assert.ok(
  veilBatches.filter((mesh) => mesh.count === 17).length >= 2,
  "pendant signals should still hang from their own filaments",
);
assert.ok(
  veilBatches.some((mesh) => mesh.count === 17 && mesh.layers.isEnabled(1)),
  "pendant signals should still enter selective bloom",
);
assertRowsInsideSphere(veilcrown, veilInstance.getWorldBounds(), "Shroudplume");
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
const pulseBatches = pulsebells.batchMeshes().filter((mesh) => mesh.count > 0);
assert.ok(
  pulseBatches.some((mesh) => mesh.geometry.type === "LatheGeometry"),
  "the open lathed hood silhouette should survive",
);
assert.ok(
  pulseBatches.some(
    (mesh) => (mesh.material.emissiveIntensity ?? 0) >= 1 && mesh.layers.isEnabled(1),
  ),
  "the selectively blooming hanging pulse should survive",
);
assertRowsInsideSphere(pulsebells, pulseInstance.getWorldBounds(), "Chimeveil");
pulsebells.dispose();

console.log("generated flora renderer invariants passed");
