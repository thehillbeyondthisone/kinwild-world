/**
 * Species-level batching.
 *
 * Stage 1 gave a plant its own meshes: one merged stem plus one instanced
 * mesh per organ type. That is affordable for the 34-plant clearing and not
 * for an island — 250 plants would be several hundred draw calls before any
 * new archetype adds organs.
 *
 * So plants stop being groups of meshes and become *rows*. One
 * `InstancedMesh` per (species × organ type), and one per (species × stem
 * variant), holds every plant of that species; draw calls scale with the
 * roster, not with the field.
 *
 * The cost of that is per-plant motion, which used to be a pivot rotation on
 * a group that no longer exists. Two things replace it:
 *
 * - **Static pose** — placement, yaw, surface alignment and rest lean are
 *   folded into the row's matrix once, and rewritten only when the plant's
 *   own transform actually changes.
 * - **Touch** — a per-plant spring that stays on the CPU (it is small, and
 *   the observatory reads its snapshot), publishing one texel per plant into
 *   a shared data texture. The vertex shader reads that texel and rotates the
 *   vertex about the plant's base. One texel write per touched plant per
 *   frame, whatever its row count, instead of one matrix write per row.
 *
 * The bend is injected into `project_vertex` rather than `begin_vertex`
 * deliberately: after `instanceMatrix` has been applied the vertex is already
 * in the batch root's space, which is the space the plant base is expressed
 * in. Bending in `begin_vertex` would mean inverse-rotating a world-space
 * displacement through each row's own basis — the trap `src/grass.js`
 * documents.
 */
import * as THREE from "three";

/** Texels per row of the touch field. Height grows; width does not. */
const TOUCH_FIELD_WIDTH = 64;

/**
 * Camera position in the world group's space, shared by every flora material
 * so the distance LOD has something to measure against. The host updates it
 * once per frame; a material never reads the camera itself.
 */
export const FLORA_VIEWER = { value: new THREE.Vector3() };

/**
 * A per-plant motion channel shared by every batch of one species.
 *
 * Layout per texel: `(directionX, directionZ, leanValue, impact)`.
 */
export function createTouchField(initialCapacity = TOUCH_FIELD_WIDTH) {
  let height = Math.max(1, Math.ceil(initialCapacity / TOUCH_FIELD_WIDTH));
  let data = new Float32Array(TOUCH_FIELD_WIDTH * height * 4);
  let texture = makeTexture(data, height);

  function makeTexture(source, rows) {
    const created = new THREE.DataTexture(
      source,
      TOUCH_FIELD_WIDTH,
      rows,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    created.magFilter = THREE.NearestFilter;
    created.minFilter = THREE.NearestFilter;
    created.generateMipmaps = false;
    created.needsUpdate = true;
    return created;
  }

  const size = { value: new THREE.Vector2(TOUCH_FIELD_WIDTH, height) };
  const sampler = { value: texture };

  return {
    get texture() {
      return texture;
    },
    uniforms: { uFloraTouch: sampler, uFloraTouchSize: size },
    get capacity() {
      return TOUCH_FIELD_WIDTH * height;
    },
    ensureCapacity(count) {
      if (count <= TOUCH_FIELD_WIDTH * height) return;
      const rows = Math.max(height * 2, Math.ceil(count / TOUCH_FIELD_WIDTH));
      const grown = new Float32Array(TOUCH_FIELD_WIDTH * rows * 4);
      grown.set(data);
      const previous = texture;
      data = grown;
      height = rows;
      texture = makeTexture(data, rows);
      // The uniform objects are shared by every compiled material, so the
      // swap has to happen in place — reassigning them would leave the
      // shaders pointing at the freed texture.
      sampler.value = texture;
      size.value.set(TOUCH_FIELD_WIDTH, rows);
      previous.dispose();
    },
    write(index, directionX, directionZ, value, impact) {
      const offset = index * 4;
      if (offset + 3 >= data.length) return;
      data[offset] = directionX;
      data[offset + 1] = directionZ;
      data[offset + 2] = value;
      data[offset + 3] = impact;
      texture.needsUpdate = true;
    },
    dispose() {
      texture.dispose();
    },
  };
}

const TOUCH_UNIFORM_DECLARATIONS = `
uniform sampler2D uFloraTouch;
uniform vec2 uFloraTouchSize;
uniform float uFloraMaxLean;
uniform float uFloraSquash;
uniform float uFloraLodDistance;
uniform vec3 uFloraViewer;
// Guarded because applyWindSway's plant-relative variant declares the same
// attribute, and the two patches are installed in either order.
#ifndef KW_PLANT_BASE_DECLARED
#define KW_PLANT_BASE_DECLARED
attribute vec4 aPlantBase;
#endif
attribute float aPlantIndex;
`;

const TOUCH_PROJECT_VERTEX = `
vec4 mvPosition = vec4( transformed, 1.0 );

#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;

  {
    vec2 touchUv = vec2(
      ( mod( aPlantIndex, uFloraTouchSize.x ) + 0.5 ) / uFloraTouchSize.x,
      ( floor( aPlantIndex / uFloraTouchSize.x ) + 0.5 ) / uFloraTouchSize.y
    );
    vec4 touch = texture2D( uFloraTouch, touchUv );
    vec3 rel = mvPosition.xyz - aPlantBase.xyz;

    // Squash on impact, matching the pivot scale the group pose used to apply.
    float impact = touch.w * uFloraSquash;
    rel.y *= 1.0 - impact;
    rel.xz *= 1.0 + impact * 0.4;

    float push = length( touch.xy );
    if ( push > 1e-4 ) {
      vec3 axis = normalize( vec3( touch.y, 0.0, -touch.x ) );
      float angle = touch.z * uFloraMaxLean;
      float c = cos( angle );
      float s = sin( angle );
      rel = rel * c + cross( axis, rel ) * s + axis * dot( axis, rel ) * ( 1.0 - c );
    }

    mvPosition.xyz = aPlantBase.xyz + rel;

    // Distance LOD: small detail organs collapse into the plant's base
    // rather than being culled per row on the CPU, which would mean
    // rewriting matrices every time the camera moved.
    if ( uFloraLodDistance > 0.0 ) {
      float viewerDistance = distance( aPlantBase.xyz, uFloraViewer );
      if ( viewerDistance > uFloraLodDistance ) {
        mvPosition.xyz = aPlantBase.xyz;
      }
    }
  }
#endif

mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;

/**
 * Patch a material so its rows read the species' touch field.
 *
 * Chains any previously installed `onBeforeCompile` (the wind sway patch is
 * normally already there) the same way `applyWindSway` does.
 */
export function applyTouchBend(material, {
  field,
  maxLean,
  squash = 0.035,
  lodDistance = 0,
  viewer,
}) {
  const previous = material.onBeforeCompile;
  const leanUniform = { value: maxLean };
  const squashUniform = { value: squash };
  const lodUniform = { value: lodDistance };
  material.onBeforeCompile = (shader) => {
    if (previous) previous(shader);
    shader.uniforms.uFloraTouch = field.uniforms.uFloraTouch;
    shader.uniforms.uFloraTouchSize = field.uniforms.uFloraTouchSize;
    shader.uniforms.uFloraMaxLean = leanUniform;
    shader.uniforms.uFloraSquash = squashUniform;
    shader.uniforms.uFloraLodDistance = lodUniform;
    shader.uniforms.uFloraViewer = viewer;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>${TOUCH_UNIFORM_DECLARATIONS}`)
      .replace("#include <project_vertex>", TOUCH_PROJECT_VERTEX);
  };
  material.userData.floraTouch = {
    lean: leanUniform,
    squash: squashUniform,
    lod: lodUniform,
  };
  material.needsUpdate = true;
  return material;
}

const IDENTITY_ROW = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * One instanced batch: a geometry, a material, and a pool of `stride` rows
 * per plant.
 *
 * Capacity grows by doubling. Growth builds a fresh `InstancedMesh` and swaps
 * it into the same parent, because an `InstancedMesh`'s count is fixed at
 * construction — the geometry and material are species-owned and survive.
 */
export function createBatch({ name, geometry, material, stride, capacity = 16 }) {
  let plantCapacity = Math.max(1, capacity);
  let activePlants = 0;
  let mesh = null;
  let parent = null;

  function build(previous) {
    const created = new THREE.InstancedMesh(
      geometry,
      material,
      plantCapacity * stride,
    );
    created.name = name;
    created.frustumCulled = false;
    created.castShadow = previous ? previous.castShadow : false;
    created.receiveShadow = previous ? previous.receiveShadow : true;
    created.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const rows = plantCapacity * stride;
    const base = new THREE.InstancedBufferAttribute(new Float32Array(rows * 4), 4);
    const index = new THREE.InstancedBufferAttribute(new Float32Array(rows), 1);
    created.userData.plantBase = base;
    created.userData.plantIndex = index;
    // The per-plant attributes live on the geometry, which is why every batch
    // owns its own: two batches sharing one geometry would overwrite each
    // other's plant lookup and bend the wrong rows.
    geometry.setAttribute("aPlantBase", base);
    geometry.setAttribute("aPlantIndex", index);

    if (previous) {
      created.instanceMatrix.array.set(previous.instanceMatrix.array);
      base.array.set(previous.userData.plantBase.array);
      index.array.set(previous.userData.plantIndex.array);
      if (previous.instanceColor) {
        created.instanceColor = new THREE.InstancedBufferAttribute(
          new Float32Array(rows * 3),
          3,
        );
        created.instanceColor.array.set(previous.instanceColor.array);
        created.instanceColor.needsUpdate = true;
      }
      created.layers.mask = previous.layers.mask;
    } else {
      for (let row = 0; row < rows; row++) created.setMatrixAt(row, IDENTITY_ROW);
    }
    created.instanceMatrix.needsUpdate = true;
    // Rows past the high-water mark are never drawn. Without this an empty
    // batch would still rasterise a full pool of degenerate rows, which is
    // most of the cost batching was meant to remove.
    created.count = activePlants * stride;
    return created;
  }

  mesh = build(null);

  const api = {
    get mesh() {
      return mesh;
    },
    stride,
    get plantCapacity() {
      return plantCapacity;
    },
    attachTo(target) {
      parent = target;
      target.add(mesh);
    },
    ensureCapacity(plantCount) {
      if (plantCount <= plantCapacity) return;
      while (plantCount > plantCapacity) plantCapacity *= 2;
      const previous = mesh;
      mesh = build(previous);
      if (parent) {
        parent.remove(previous);
        parent.add(mesh);
      }
      previous.dispose();
    },
    /** Row range owned by one plant. */
    rowsFor(plantIndex) {
      return plantIndex * stride;
    },
    setActivePlants(count) {
      activePlants = Math.min(plantCapacity, Math.max(activePlants, count));
      mesh.count = activePlants * stride;
    },
    /** `span` is the plant's height, which the wind shader needs to normalize. */
    setRow(row, matrix, plantIndex, base, span) {
      mesh.setMatrixAt(row, matrix);
      const attribute = mesh.userData.plantBase;
      attribute.array[row * 4] = base.x;
      attribute.array[row * 4 + 1] = base.y;
      attribute.array[row * 4 + 2] = base.z;
      attribute.array[row * 4 + 3] = span;
      attribute.needsUpdate = true;
      mesh.userData.plantIndex.array[row] = plantIndex;
      mesh.userData.plantIndex.needsUpdate = true;
    },
    clearRow(row) {
      mesh.setMatrixAt(row, IDENTITY_ROW);
    },
    setColor(row, color) {
      mesh.setColorAt(row, color);
    },
    flush() {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    dispose() {
      mesh.removeFromParent();
      mesh.dispose();
    },
  };
  return api;
}
