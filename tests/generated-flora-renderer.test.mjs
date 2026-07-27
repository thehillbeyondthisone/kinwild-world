import assert from "node:assert/strict";
import * as THREE from "three";

globalThis.__APP_VERSION__ = "test";

const {
  FLORA_ROLES,
  buildSpecies,
} = await import("../src/generated-flora/index.js");
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

const inputs = [
  {
    role: "hero-mushroom",
    name: "Lantern Crown",
    seed: "hero-proof",
    shape: { spotCount: 9, satelliteCount: 3 },
  },
  {
    role: "mid-flower-cluster",
    name: "Honey Bells",
    seed: "flower-proof",
    shape: { flowerCount: 8, petalCount: 7, leafPairs: 2 },
  },
  {
    role: "groundcover",
    name: "Whisper Tuft",
    seed: "ground-proof",
    shape: { count: 96, clumpiness: 0.78 },
  },
];

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
    const instanceCount = object.isInstancedMesh ? object.count : 1;
    for (let instanceIndex = 0; instanceIndex < instanceCount; instanceIndex++) {
      if (object.isInstancedMesh) {
        object.getMatrixAt(instanceIndex, instanceMatrix);
        worldMatrix.multiplyMatrices(object.matrixWorld, instanceMatrix);
      } else {
        worldMatrix.copy(object.matrixWorld);
      }
      for (let vertexIndex = 0; vertexIndex < positions.count; vertexIndex++) {
        const vertex = new THREE.Vector3().fromBufferAttribute(
          positions,
          vertexIndex
        );
        vertex.applyMatrix4(worldMatrix);
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
  for (const resource of [
    ...resources.geometries,
    ...resources.materials,
  ]) {
    const original = resource.dispose.bind(resource);
    calls.set(resource, 0);
    resource.dispose = () => {
      calls.set(resource, calls.get(resource) + 1);
      original();
    };
  }
  return calls;
}

for (const [index, input] of inputs.entries()) {
  const species = buildSpecies(input, { biome });
  assert.equal(species.role, FLORA_ROLES[index]);
  assert.equal(species.dna.role, input.role);
  assert.equal(species.windUniforms, state.windUniforms);
  assert.equal(species.disposed, false);
  assert.equal(species.instanceCount, 0);
  assert(species.bounds.radius > 0);
  assert(species.bounds.height > 0);
  assert(species.bounds.footprintRadius > 0);
  assert(species.bounds.dynamicMargin >= 0);
  assert(species.affordanceSchema.length >= 2);
  assert(species.resourceCounts.geometries > 0);
  assert(species.resourceCounts.materials > 0);
  assert(Object.isFrozen(species));
  assert(Object.isFrozen(species.dna));

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
  assert.deepEqual(snapshotScene(first.group), snapshotScene(second.group));
  assert.equal(first.group.userData.generatedFlora.speciesId, species.id);
  assert.equal(first.group.userData.generatedFlora.role, species.role);
  assert.deepEqual(
    first.affordances.map(({ type }) => type),
    second.affordances.map(({ type }) => type)
  );
  assert.deepEqual(
    new Set(first.affordances.map(({ type }) => type)),
    new Set(species.affordanceSchema)
  );

  const firstRenderables = collectRenderables(first.group);
  const secondRenderables = collectRenderables(second.group);
  assert.equal(firstRenderables.length, secondRenderables.length);
  for (let i = 0; i < firstRenderables.length; i++) {
    assert.equal(
      firstRenderables[i].geometry,
      secondRenderables[i].geometry,
      `${species.role} instances should share geometry`
    );
    assert.equal(
      firstRenderables[i].material,
      secondRenderables[i].material,
      `${species.role} instances should share material`
    );
  }

  const instanced = firstRenderables.filter((mesh) => mesh.isInstancedMesh);
  if (species.role === "hero-mushroom") {
    assert(firstRenderables.some((mesh) => !mesh.isInstancedMesh));
    assert(instanced.length >= 3);
  } else if (species.role === "mid-flower-cluster") {
    assert.equal(firstRenderables.length, 4);
    assert.equal(instanced.length, 4);
    assert.equal(
      instanced.reduce((sum, mesh) => sum + mesh.count, 0),
      species.dna.shape.flowerCount *
        (2 + species.dna.shape.petalCount + species.dna.shape.leafPairs * 2)
    );
  } else {
    assert.equal(firstRenderables.length, 1);
    assert.equal(instanced.length, 1);
    assert.equal(instanced[0].count, species.dna.shape.count);
    assert(instanced[0].instanceColor);
    const restPivot = first.group.children[0];
    assert.equal(restPivot.rotation.x, 0);
    assert.equal(restPivot.rotation.z, 0);
  }

  const resources = collectResources(first.group);
  assert.equal(resources.geometries.size, species.resourceCounts.geometries);
  assert.equal(resources.materials.size, species.resourceCounts.materials);

  const windMaterial = [...resources.materials].find(
    (material) => material.userData.windStrength > 0
  );
  assert(windMaterial, `${species.role} should opt into shared wind`);
  const shader = {
    uniforms: {},
    vertexShader:
      "#include <common>\nvoid main() {\n#include <begin_vertex>\n}",
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
  const touchStepB = second.update(1 / 60);
  assert.deepEqual(touchStepA, touchStepB);
  assert.equal(touchStepA.active, true);
  assert.notEqual(touchStepA.value, 0);
  const touchPivot = first.group.children[0].children[0];
  assert.notEqual(touchPivot.rotation.x, 0);
  assert.notEqual(touchPivot.rotation.z, 0);
  first.resetTouch();
  second.resetTouch();
  assert.equal(first.touchState().active, false);

  const sphere = first.getWorldBounds();
  assert(Math.abs(sphere.center.x - 10) < 1e-9);
  assert(Math.abs(sphere.center.y - (2 + species.bounds.center[1] * 1.25)) < 1e-9);
  assert(Math.abs(sphere.center.z + 4) < 1e-9);
  assert(Math.abs(sphere.radius - species.bounds.radius * 1.25) < 1e-9);
  assertGeometryInsideSphere(first.group, sphere, species.role);

  const worldAffordances = first.getWorldAffordances();
  assert.equal(worldAffordances.length, first.affordances.length);
  assert(worldAffordances.every((entry) => entry.space === "world"));
  assert(worldAffordances.every((entry) => entry.position.isVector3));
  assert(
    worldAffordances.every(
      (entry, affordanceIndex) =>
        Math.abs(
          entry.radius - first.affordances[affordanceIndex].radius * 1.25
        ) < 1e-9
    )
  );

  const disposalCalls = instrumentDisposal(resources);
  first.dispose();
  assert.equal(first.disposed, true);
  assert.equal(species.instanceCount, 1);
  assert(
    [...disposalCalls.values()].every((count) => count === 0),
    "instance disposal must preserve species-owned geometry and materials"
  );
  first.dispose();

  species.dispose();
  assert.equal(species.disposed, true);
  assert.equal(second.disposed, true);
  assert.equal(species.instanceCount, 0);
  assert(
    [...disposalCalls.values()].every((count) => count === 1),
    "species disposal must release every shared resource exactly once"
  );
  species.dispose();
  assert(
    [...disposalCalls.values()].every((count) => count === 1),
    "species disposal must be idempotent"
  );
  assert.throws(
    () => species.createInstance({ id: "too-late" }),
    /has been disposed/
  );
}

const veilcrown = buildSpecies(
  {
    role: "hero-mushroom",
    name: "Veilcrown",
    seed: "veilcrown-topology",
    shape: {
      height: 4.25,
      stemRadius: 0.5,
      capRadius: 1.72,
      capDepth: 0.62,
      spotCount: 17,
      satelliteCount: 2,
    },
  },
  { biome },
);
const veilInstance = veilcrown.createInstance({ id: "veil-proof" });
const veilRenderables = collectRenderables(veilInstance.group);
const veilInstances = veilRenderables.filter((mesh) => mesh.isInstancedMesh);
assert.ok(
  veilInstances.some((mesh) => mesh.count === 7),
  "Veilcrown should use a separated seven-lobe radial crown",
);
assert.ok(
  veilInstances.filter((mesh) => mesh.count === 17).length >= 2,
  "Veilcrown signals should hang from individual instanced filaments",
);
assert.ok(
  veilRenderables.every(
    (mesh) =>
      mesh.geometry.parameters?.thetaLength === undefined ||
      Math.abs(mesh.geometry.parameters.thetaLength - Math.PI * 0.5) > 1e-6,
  ),
  "Veilcrown must not contain the legacy hemisphere-cap silhouette",
);
assert.ok(
  veilRenderables.some(
    (mesh) => (mesh.material.emissiveIntensity ?? 0) >= 0.3,
  ),
  "Veilcrown pendant signals should carry a controlled emissive accent",
);
assert.ok(
  veilRenderables.some(
    (mesh) => mesh.count === 17 && mesh.layers.isEnabled(1),
  ),
  "Veilcrown pendant signals should enter selective bloom",
);
const veilBox = new THREE.Box3().setFromObject(
  veilInstance.group,
  true,
);
assert.ok(
  veilcrown.bounds.height >= veilBox.max.y - 1e-4,
  "Veilcrown height should include its raised crown lobes",
);
veilcrown.dispose();

const pulsebells = buildSpecies(
  {
    role: "mid-flower-cluster",
    name: "Pulsebells",
    seed: "pulsebell-topology",
    shape: {
      clusterRadius: 0.92,
      flowerCount: 6,
      stemHeight: 1.1,
      bloomRadius: 0.23,
      petalCount: 5,
      leafPairs: 1,
    },
  },
  { biome },
);
const pulseInstance = pulsebells.createInstance({
  id: "pulsebell-proof",
});
const pulseRenderables = collectRenderables(pulseInstance.group);
assert.equal(
  pulseRenderables.length,
  5,
  "Pulsebells should replace the generic petal disc with a five-part bell kit",
);
assert.ok(
  pulseRenderables.some(
    (mesh) => mesh.geometry.type === "LatheGeometry",
  ),
  "Pulsebells should use an open, lathed hood silhouette",
);
assert.ok(
  pulseRenderables.some(
    (mesh) =>
      (mesh.material.emissiveIntensity ?? 0) >= 1 &&
      mesh.layers.isEnabled(1),
  ),
  "Pulsebells should expose a selectively blooming hanging pulse",
);
assert.ok(
  pulseRenderables.every(
    (mesh) =>
      mesh.count !==
      pulsebells.dna.shape.flowerCount *
        pulsebells.dna.shape.petalCount,
  ),
  "Pulsebells must not fall back to a radial daisy-petal mesh",
);
const pulseSphere = pulseInstance.getWorldBounds();
assertGeometryInsideSphere(
  pulseInstance.group,
  pulseSphere,
  "Pulsebells",
);
pulsebells.dispose();

console.log("generated flora renderer invariants passed");
