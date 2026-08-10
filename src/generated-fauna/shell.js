import * as THREE from "three";
import { replaceOrWarn } from "../shaders/patch.js";
import {
  GENERATED_FAUNA_MAX_INFLUENCES,
  GENERATED_FAUNA_MAX_PRIMITIVES,
} from "./dna.js";

const SHELL_GLSL = /* glsl */ `
attribute float aPrim;

uniform vec4 uPrimPosK[${GENERATED_FAUNA_MAX_PRIMITIVES}];
uniform vec4 uPrimQuat[${GENERATED_FAUNA_MAX_PRIMITIVES}];
uniform vec4 uPrimScale[${GENERATED_FAUNA_MAX_PRIMITIVES}];
uniform vec4 uPrimParams[${GENERATED_FAUNA_MAX_PRIMITIVES}];
uniform vec4 uPrimColor[${GENERATED_FAUNA_MAX_PRIMITIVES}];
uniform ivec4 uPrimInfl[${GENERATED_FAUNA_MAX_PRIMITIVES * 2}];
uniform vec3 uTuck;
uniform float uGradEps;
uniform int uIters;

varying vec3 vGeneratedFaunaColor;

vec3 gfQRot(vec4 q, vec3 v) {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}

vec3 gfQRotInv(vec4 q, vec3 v) {
  return gfQRot(vec4(-q.xyz, q.w), v);
}

int gfIvec4At(ivec4 value, int index) {
  if (index == 0) return value.x;
  if (index == 1) return value.y;
  if (index == 2) return value.z;
  return value.w;
}

float gfPrimLocal(vec4 shape, vec3 p) {
  int type = int(shape.w + 0.5);
  if (type == 0) return length(p) - shape.x;
  p.y -= clamp(p.y, -shape.x, shape.x);
  return length(p) - shape.y;
}

// Primitive transforms and the projected result are actor-local. Three's
// normal model/view pipeline applies the movable root transform afterwards.
float gfPrimDist(int index, vec3 actorPoint) {
  vec3 scale = max(uPrimScale[index].xyz, vec3(1e-4));
  vec3 localPoint =
    gfQRotInv(uPrimQuat[index], actorPoint - uPrimPosK[index].xyz) / scale;
  return gfPrimLocal(uPrimParams[index], localPoint)
    * min(scale.x, min(scale.y, scale.z));
}

float gfField(vec3 p, ivec4 first, ivec4 second, float selfBlend) {
  float distanceValue = gfPrimDist(first.x, p);
  for (int i = 1; i < ${GENERATED_FAUNA_MAX_INFLUENCES}; i++) {
    int other =
      i < 4
        ? gfIvec4At(first, i)
        : gfIvec4At(second, i - 4);
    if (other < 0) break;
    float otherDistance = gfPrimDist(other, p);
    float blend = max(min(selfBlend, uPrimPosK[other].w), 1e-4);
    float weight = clamp(
      0.5 + 0.5 * (otherDistance - distanceValue) / blend,
      0.0,
      1.0
    );
    distanceValue =
      mix(otherDistance, distanceValue, weight)
      - blend * weight * (1.0 - weight);
  }
  return distanceValue;
}

float gfFieldColor(
  vec3 p,
  ivec4 first,
  ivec4 second,
  float selfBlend,
  out vec3 colorValue
) {
  float distanceValue = gfPrimDist(first.x, p);
  colorValue = uPrimColor[first.x].rgb;
  for (int i = 1; i < ${GENERATED_FAUNA_MAX_INFLUENCES}; i++) {
    int other =
      i < 4
        ? gfIvec4At(first, i)
        : gfIvec4At(second, i - 4);
    if (other < 0) break;
    float otherDistance = gfPrimDist(other, p);
    float blend = max(min(selfBlend, uPrimPosK[other].w), 1e-4);
    float weight = clamp(
      0.5 + 0.5 * (otherDistance - distanceValue) / blend,
      0.0,
      1.0
    );
    distanceValue =
      mix(otherDistance, distanceValue, weight)
      - blend * weight * (1.0 - weight);
    colorValue = mix(uPrimColor[other].rgb, colorValue, weight);
  }
  return distanceValue;
}

vec3 gfGradient(vec3 p, ivec4 first, ivec4 second, float selfBlend) {
  vec2 e = vec2(1.0, -1.0);
  vec3 gradient =
      e.xyy * gfField(p + e.xyy * uGradEps, first, second, selfBlend)
    + e.yyx * gfField(p + e.yyx * uGradEps, first, second, selfBlend)
    + e.yxy * gfField(p + e.yxy * uGradEps, first, second, selfBlend)
    + e.xxx * gfField(p + e.xxx * uGradEps, first, second, selfBlend);
  float gradientLength = length(gradient);
  return gradientLength > 1e-6
    ? gradient / gradientLength
    : vec3(0.0, 1.0, 0.0);
}

float gfOtherDistance(vec3 p, ivec4 first, ivec4 second) {
  float distanceValue = 1e5;
  for (int i = 1; i < ${GENERATED_FAUNA_MAX_INFLUENCES}; i++) {
    int other =
      i < 4
        ? gfIvec4At(first, i)
        : gfIvec4At(second, i - 4);
    if (other < 0) break;
    distanceValue = min(distanceValue, gfPrimDist(other, p));
  }
  return distanceValue;
}

void gfBlendShell(
  vec3 carrierPosition,
  out vec3 shellPosition,
  out vec3 shellNormal,
  out vec3 shellColor
) {
  int base = int(aPrim + 0.5);
  ivec4 first = uPrimInfl[base * 2];
  ivec4 second = uPrimInfl[base * 2 + 1];
  float selfBlend = uPrimPosK[base].w;

  vec3 point =
    gfQRot(uPrimQuat[base], carrierPosition * uPrimScale[base].xyz)
    + uPrimPosK[base].xyz;
  float burial = max(0.0, -gfOtherDistance(point, first, second));
  float tuckAmount = smoothstep(uTuck.y, uTuck.z, burial);
  float target = -uTuck.x * tuckAmount;

#ifdef GENERATED_FAUNA_FAST
  float fastFieldValue =
    gfField(point, first, second, selfBlend) - target;
  point -=
    gfGradient(point, first, second, selfBlend) * fastFieldValue;
#else
  int iterations = clamp(uIters, 1, 3);
  for (int i = 0; i < 3; i++) {
    if (i >= iterations) break;
    float fieldValue = gfField(point, first, second, selfBlend) - target;
    point -= gfGradient(point, first, second, selfBlend) * fieldValue;
  }
#endif

  shellPosition = point;
#ifdef GENERATED_FAUNA_NO_NORMAL
  shellNormal = vec3(0.0, 1.0, 0.0);
#else
  shellNormal = gfGradient(point, first, second, selfBlend);
#endif
#ifdef GENERATED_FAUNA_NO_COLOR
  shellColor = vec3(1.0);
#else
  shellColor = vec3(1.0);
  gfFieldColor(point, first, second, selfBlend, shellColor);
#endif
}

vec3 gfShellPosition;
vec3 gfShellNormal;
vec3 gfShellColor;
`;

const SHELL_COMPUTE_GLSL = /* glsl */ `
gfBlendShell(position, gfShellPosition, gfShellNormal, gfShellColor);
vGeneratedFaunaColor = gfShellColor;
`;

/**
 * Actor-local SDF blend shell. No hull outline is created; Small World's
 * existing depth-outline pass sees the projected beauty geometry directly.
 */
export class LocalBlendShell {
  /**
   * @param {Array<{
   *   type: "sphere"|"capsule",
   *   radius: number,
   *   halfLength?: number,
   *   color: THREE.ColorRepresentation,
   *   blend: number,
   *   detail?: number
   * }>} specs
   * @param {{
   *   influences: number[][],
   *   localBounds: THREE.Box3,
   *   iterations?: number,
   *   gradEps?: number
   * }} options
   */
  constructor(specs, options) {
    if (
      !Array.isArray(specs) ||
      specs.length === 0 ||
      specs.length > GENERATED_FAUNA_MAX_PRIMITIVES
    ) {
      throw new RangeError(
        `generated fauna shell requires 1-${GENERATED_FAUNA_MAX_PRIMITIVES} primitives`,
      );
    }
    validateInfluences(options.influences, specs.length);

    this.specs = specs;
    this.primitives = specs.map(() => ({
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(1, 1, 1),
    }));
    this._disposed = false;

    this._positions = new Float32Array(GENERATED_FAUNA_MAX_PRIMITIVES * 4);
    this._quaternions = new Float32Array(
      GENERATED_FAUNA_MAX_PRIMITIVES * 4,
    );
    this._scales = new Float32Array(GENERATED_FAUNA_MAX_PRIMITIVES * 4);
    const parameters = new Float32Array(
      GENERATED_FAUNA_MAX_PRIMITIVES * 4,
    );
    const colors = new Float32Array(GENERATED_FAUNA_MAX_PRIMITIVES * 4);
    const color = new THREE.Color();

    for (let index = 0; index < specs.length; index++) {
      const spec = specs[index];
      const offset = index * 4;
      if (spec.type === "sphere") {
        parameters.set([spec.radius, 0, 0, 0], offset);
      } else {
        parameters.set(
          [spec.halfLength ?? 0.1, spec.radius, 0, 1],
          offset,
        );
      }
      color.set(spec.color);
      colors.set([color.r, color.g, color.b, 1], offset);
      this._positions[offset + 3] = spec.blend;
      this._quaternions[offset + 3] = 1;
      this._scales.set([1, 1, 1, 0], offset);
    }

    this.uniforms = {
      uPrimPosK: { value: this._positions },
      uPrimQuat: { value: this._quaternions },
      uPrimScale: { value: this._scales },
      uPrimParams: { value: parameters },
      uPrimColor: { value: colors },
      uPrimInfl: {
        value: packInfluences(
          options.influences,
          GENERATED_FAUNA_MAX_PRIMITIVES,
        ),
      },
      uTuck: { value: new THREE.Vector3(0.012, 0.003, 0.025) },
      uGradEps: { value: options.gradEps ?? 0.006 },
      uIters: {
        value: THREE.MathUtils.clamp(
          Math.round(options.iterations ?? 2),
          1,
          3,
        ),
      },
    };

    const carriers = specs.map(makeCarrierGeometry);
    this.geometry = mergeCarriers(carriers);
    for (const carrier of carriers) carrier.dispose();
    this.geometry.boundingBox = options.localBounds.clone();
    this.geometry.boundingSphere = options.localBounds.getBoundingSphere(
      new THREE.Sphere(),
    );

    this.gradientMap = makeToonGradient();
    this.material = new THREE.MeshToonMaterial({
      color: 0xffffff,
      gradientMap: this.gradientMap,
    });
    injectShell(this.material, this.uniforms, {
      colored: true,
      cacheKey: "generated-fauna-local-toon-v1",
    });

    const fastDefines = [
      "GENERATED_FAUNA_FAST",
      "GENERATED_FAUNA_NO_NORMAL",
      "GENERATED_FAUNA_NO_COLOR",
    ];
    this.depthMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
    });
    injectShell(this.depthMaterial, this.uniforms, {
      defines: fastDefines,
      cacheKey: "generated-fauna-local-depth-v1",
    });
    this.distanceMaterial = new THREE.MeshDistanceMaterial();
    injectShell(this.distanceMaterial, this.uniforms, {
      defines: fastDefines,
      cacheKey: "generated-fauna-local-distance-v1",
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = "generated-fauna-sdf-shell";
    this.mesh.customDepthMaterial = this.depthMaterial;
    this.mesh.customDistanceMaterial = this.distanceMaterial;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = true;
    this.mesh.userData.generatedFaunaShell = true;
  }

  sync() {
    for (let index = 0; index < this.primitives.length; index++) {
      const primitive = this.primitives[index];
      const offset = index * 4;
      this._positions[offset] = primitive.position.x;
      this._positions[offset + 1] = primitive.position.y;
      this._positions[offset + 2] = primitive.position.z;
      this._quaternions[offset] = primitive.quaternion.x;
      this._quaternions[offset + 1] = primitive.quaternion.y;
      this._quaternions[offset + 2] = primitive.quaternion.z;
      this._quaternions[offset + 3] = primitive.quaternion.w;
      this._scales[offset] = primitive.scale.x;
      this._scales[offset + 1] = primitive.scale.y;
      this._scales[offset + 2] = primitive.scale.z;
    }
  }

  /** Test/inspection snapshot; positions remain actor-local as root moves. */
  primitiveSnapshot() {
    return this.primitives.map((primitive) => ({
      position: primitive.position.toArray(),
      quaternion: primitive.quaternion.toArray(),
      scale: primitive.scale.toArray(),
    }));
  }

  resources() {
    return [
      this.geometry,
      this.material,
      this.depthMaterial,
      this.distanceMaterial,
      this.gradientMap,
    ];
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.depthMaterial.dispose();
    this.distanceMaterial.dispose();
    this.gradientMap.dispose();
  }
}

function makeCarrierGeometry(spec) {
  const detail = THREE.MathUtils.clamp(spec.detail ?? 1, 0.5, 2);
  const radialSegments = Math.max(8, Math.round(12 * detail));
  let geometry;
  if (spec.type === "sphere") {
    geometry = new THREE.SphereGeometry(
      spec.radius,
      radialSegments,
      Math.max(6, Math.round(8 * detail)),
    );
  } else {
    geometry = new THREE.CapsuleGeometry(
      spec.radius,
      Math.max(0.001, (spec.halfLength ?? 0.1) * 2),
      Math.max(3, Math.round(5 * detail)),
      radialSegments,
    );
  }
  geometry.deleteAttribute("normal");
  geometry.deleteAttribute("uv");
  return geometry;
}

function mergeCarriers(carriers) {
  let vertexCount = 0;
  let indexCount = 0;
  for (const carrier of carriers) {
    vertexCount += carrier.attributes.position.count;
    indexCount += carrier.index
      ? carrier.index.count
      : carrier.attributes.position.count;
  }
  const positions = new Float32Array(vertexCount * 3);
  const primitiveIds = new Float32Array(vertexCount);
  const IndexArray = vertexCount > 65535 ? Uint32Array : Uint16Array;
  const indices = new IndexArray(indexCount);

  let vertexOffset = 0;
  let indexOffset = 0;
  carriers.forEach((carrier, primitiveIndex) => {
    const position = carrier.attributes.position;
    positions.set(position.array, vertexOffset * 3);
    primitiveIds.fill(
      primitiveIndex,
      vertexOffset,
      vertexOffset + position.count,
    );
    if (carrier.index) {
      for (let index = 0; index < carrier.index.count; index++) {
        indices[indexOffset + index] =
          carrier.index.getX(index) + vertexOffset;
      }
      indexOffset += carrier.index.count;
    } else {
      for (let index = 0; index < position.count; index++) {
        indices[indexOffset + index] = index + vertexOffset;
      }
      indexOffset += position.count;
    }
    vertexOffset += position.count;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3),
  );
  geometry.setAttribute(
    "aPrim",
    new THREE.BufferAttribute(primitiveIds, 1),
  );
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

function packInfluences(lists, maxPrimitives) {
  const packed = new Int32Array(
    maxPrimitives * GENERATED_FAUNA_MAX_INFLUENCES,
  ).fill(-1);
  lists.forEach((neighbors, primitiveIndex) => {
    const entries = [
      primitiveIndex,
      ...neighbors.filter((neighbor) => neighbor !== primitiveIndex),
    ];
    for (let index = 0; index < entries.length; index++) {
      packed[
        primitiveIndex * GENERATED_FAUNA_MAX_INFLUENCES + index
      ] = entries[index];
    }
  });
  return packed;
}

function validateInfluences(lists, primitiveCount) {
  if (!Array.isArray(lists) || lists.length !== primitiveCount) {
    throw new RangeError("one generated-fauna influence list is required per primitive");
  }
  lists.forEach((neighbors, primitiveIndex) => {
    if (!Array.isArray(neighbors)) {
      throw new TypeError(`influences[${primitiveIndex}] must be an array`);
    }
    const unique = new Set([primitiveIndex, ...neighbors]);
    if (unique.size > GENERATED_FAUNA_MAX_INFLUENCES) {
      throw new RangeError(
        `primitive ${primitiveIndex} exceeds the influence budget`,
      );
    }
    for (const neighbor of neighbors) {
      if (
        !Number.isInteger(neighbor) ||
        neighbor < 0 ||
        neighbor >= primitiveCount
      ) {
        throw new RangeError(
          `primitive ${primitiveIndex} has invalid influence ${neighbor}`,
        );
      }
    }
  });
}

function makeToonGradient() {
  const values = new Uint8Array([96, 158, 214, 255]);
  const texture = new THREE.DataTexture(
    values,
    values.length,
    1,
    THREE.RedFormat,
  );
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Splice the blend shell into a three.js material's generated vertex shader.
 *
 * Every anchor goes through `replaceOrWarn`. A raw `String.replace` that misses
 * is a silent no-op that still compiles: `begin_vertex` not matching would ship
 * the raw carrier capsules, unprojected — the animal would come apart into the
 * shapes it is made of, with no error anywhere. `beginnormal_vertex` missing
 * would light a smooth body with primitive normals. Both are exactly the class
 * of breakage a three.js upgrade causes, and the reason `replaceOrWarn` exists.
 */
function injectShell(material, uniforms, options) {
  const label = options.cacheKey ?? "generated-fauna-shell";
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    const defines = (options.defines ?? [])
      .map((define) => `#define ${define}`)
      .join("\n");
    let vertex = `${defines}\n${SHELL_GLSL}\n${shader.vertexShader}`;
    vertex = replaceOrWarn(
      vertex,
      "void main() {",
      `void main() {\n${SHELL_COMPUTE_GLSL}`,
      `${label}/main`,
    );
    vertex = replaceOrWarn(
      vertex,
      "#include <beginnormal_vertex>",
      "vec3 objectNormal = gfShellNormal;",
      `${label}/beginnormal_vertex`,
    );
    vertex = replaceOrWarn(
      vertex,
      "#include <begin_vertex>",
      "vec3 transformed = gfShellPosition;",
      `${label}/begin_vertex`,
    );
    shader.vertexShader = vertex;
    if (options.colored) {
      shader.fragmentShader =
        "varying vec3 vGeneratedFaunaColor;\n" +
        replaceOrWarn(
          shader.fragmentShader,
          "#include <color_fragment>",
          "#include <color_fragment>\n  diffuseColor.rgb *= vGeneratedFaunaColor;",
          `${label}/color_fragment`,
        );
    }
  };
  material.customProgramCacheKey = () => options.cacheKey;
}
