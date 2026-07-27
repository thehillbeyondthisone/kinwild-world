import assert from "node:assert/strict";
import * as THREE from "three";
import { assertCreatureAgent } from "../src/integration/provider-contracts.js";
import {
  createGeneratedFaunaWalker,
  createHeightFunctionSurfaceSampler,
} from "../src/generated-fauna/index.js";

const surface = createHeightFunctionSurfaceSampler(
  (x, z) => 0.4 + x * 0.25 - z * 0.1,
  {
    normalStep: 0.05,
    materialAt: (x) => (x > 4 ? "moss" : "sand"),
  },
);
const walker = createGeneratedFaunaWalker({
  surface,
  position: { x: 5, z: -3 },
  heading: Math.PI / 3,
});

assert.equal(assertCreatureAgent(walker), walker);
assert.equal(walker.traits.mode, "walker");
assert.equal(walker.traits.airborne, false);
assert.equal(walker.flies, false);
assert.equal(walker.landState, "landed");
assert.equal(walker.shell.mesh.frustumCulled, true);
assert(walker.shell.geometry.boundingBox);
assert(walker.shell.geometry.boundingSphere);
assert.equal(
  walker.root.children.filter((child) => /outline/i.test(child.name)).length,
  0,
  "the proof relies on Small World's depth outline, not a second hull",
);

walker.update(0, 2, {
  surface,
  intent: {
    position: { x: 5, z: -3 },
    velocity: { x: 0, z: 0 },
    heading: Math.PI / 3,
  },
});
const expectedHeight = 0.4 + 5 * 0.25 - -3 * 0.1;
assert.equal(walker.root.position.x, 5);
assert.equal(walker.root.position.z, -3);
assert(Math.abs(walker.root.position.y - expectedHeight) < 1e-9);

const actorUp = new THREE.Vector3(0, 1, 0)
  .applyQuaternion(walker.root.quaternion)
  .normalize();
const expectedNormal = new THREE.Vector3(-0.25, 1, 0.1).normalize();
assert(actorUp.distanceTo(expectedNormal) < 1e-6);

const primitives = walker.debug.primitiveSnapshot();
assert(
  Math.abs(primitives[0].position[0]) < 1e-9 &&
    Math.abs(primitives[0].position[2]) < 1e-9,
  "body primitives must stay actor-local instead of baking root translation",
);
assert(
  Math.abs(primitives[1].position[2]) < 1,
  "head primitive should remain in the actor-local envelope",
);
const mockShader = {
  uniforms: {},
  vertexShader: [
    "void main() {",
    "#include <beginnormal_vertex>",
    "#include <begin_vertex>",
    "}",
  ].join("\n"),
  fragmentShader: [
    "void main() {",
    "#include <color_fragment>",
    "}",
  ].join("\n"),
};
walker.shell.material.onBeforeCompile(mockShader);
assert.match(
  mockShader.vertexShader,
  /actorPoint - uPrimPosK\[index\]\.xyz/,
  "shader primitive transforms should subtract actor-local primitive origins",
);
assert.match(mockShader.vertexShader, /vec3 transformed = gfShellPosition/);
assert.match(mockShader.fragmentShader, /vGeneratedFaunaColor/);

walker.update(0.016, 2.016, { surface });
assert.equal(
  walker.root.position.x,
  5,
  "runtime must not self-integrate planar movement",
);
assert.equal(walker.root.position.z, -3);
const headBeforeNotice = walker.debug.primitiveSnapshot()[1].position;
walker.update({
  dt: 0.1,
  time: 2.116,
  surface,
  intent: {
    action: "notice",
    lookTarget: { x: 5, y: expectedHeight + 2, z: 2 },
  },
});
const headAfterNotice = walker.debug.primitiveSnapshot()[1].position;
assert.ok(
  headAfterNotice[1] > headBeforeNotice[1] &&
    headAfterNotice[2] > headBeforeNotice[2],
  "notice intent should lift and lead the head instead of remaining semantic-only",
);

const center = new THREE.Vector3();
const radius = walker.bounds(center);
assert(radius > 0);
assert(Math.abs(center.x - 5) < 1);
assert(Math.abs(center.z - -3) < 1);
assert.equal(walker.interactionRoot.userData.generatedFaunaInteractionProxy, true);
const sphere = walker.interactionSphere(new THREE.Sphere());
const ray = new THREE.Ray(
  sphere.center.clone().add(new THREE.Vector3(0, radius * 2, 0)),
  new THREE.Vector3(0, -1, 0),
);
assert(walker.intersectRay(ray, new THREE.Vector3()));

const head = walker.anchor("head", new THREE.Vector3());
assert(head.y > walker.root.position.y);
for (let index = 0; index < walker.dna.legs.count; index++) {
  const foot = walker.anchor("foot", new THREE.Vector3(), index);
  const terrainHeight = 0.4 + foot.x * 0.25 - foot.z * 0.1;
  assert(
    foot.y >= terrainHeight - 1e-6,
    `foot ${index} should be planted on or above terrain`,
  );
}

const worldBox = walker.worldBounds(new THREE.Box3());
assert(worldBox.containsPoint(head));

const resources = walker.debug.resources();
const disposeCounts = new Map();
for (const resource of resources) {
  disposeCounts.set(resource, 0);
  resource.addEventListener("dispose", () => {
    disposeCounts.set(resource, disposeCounts.get(resource) + 1);
  });
}
const parent = new THREE.Group();
parent.add(walker.root);
assert.equal(walker.dispose(), true);
assert.equal(walker.root.parent, null);
assert.equal(walker.dispose(), false);
for (const [resource, count] of disposeCounts) {
  assert.equal(count, 1, `${resource.type ?? "resource"} should dispose once`);
}
assert.throws(() => walker.update(0, 3, { surface }), /disposed/);

const missingSurface = createGeneratedFaunaWalker();
assert.throws(
  () => missingSurface.update(0, 0),
  /explicit surface sampler/,
);
missingSurface.dispose();

let heightCalls = 0;
const countedSurface = createHeightFunctionSurfaceSampler(() => {
  heightCalls += 1;
  return 0;
});
const countedWalker = createGeneratedFaunaWalker({ surface: countedSurface });
heightCalls = 0;
countedWalker.update(0.016, 1, { surface: countedSurface });
assert.ok(
  heightCalls <= 13,
  `stationary four-legged update should reuse height-only samples (got ${heightCalls})`,
);
countedWalker.dispose();

console.log("generated fauna runtime tests passed");
