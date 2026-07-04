import * as THREE from "three";
import { state } from "../state.js";
import { jitterGeo, applyWindSway } from "../util.js";
import { pickGroundPoint } from "../terrain.js";
import {
  WILDFLOWER_PALETTES,
  FLOWER_DENSITY,
  PEBBLE_DENSITY,
  BEACHCOMB_DENSITY,
} from "../biomes.js";
import { LOWFX } from "../lowfx.js";
import { BLOOM_LAYER } from "../postfx.js";
import { coverScale as _coverScale } from "./_shared.js";

// ─── ground cover ───
export function placeInstanced(geo, mat, count, heightFn, opts = {}) {
  const {
    yOffset = 0,
    maxRadiusFrac = 0.88,
    minScale = 0.6,
    maxScale = 1.3,
    minHeight = -0.15,
    maxHeight = Infinity,
    tilt = 0.25,
    fullRotation = true,
    avoidObstacleKinds = null,
    avoidRadius = 0,
    visualRadius = false,
    excludedCircles = [],
  } = opts;
  const avoidObstacleKindSet = avoidObstacleKinds
    ? (avoidObstacleKinds instanceof Set ? avoidObstacleKinds : new Set(avoidObstacleKinds))
    : null;

  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.frustumCulled = false;

  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const e = new THREE.Euler();

  const positions = [];

  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < count * 5) {
    attempts++;
    const p = pickGroundPoint(maxRadiusFrac, { visualRadius });
    const x = p.x;
    const z = p.z;
    if (avoidObstacleKindSet) {
      let blocked = false;
      for (const obstacle of state.obstacles) {
        if (!avoidObstacleKindSet.has(obstacle.kind)) continue;
        const minD = obstacle.r + avoidRadius;
        const dx = x - obstacle.x;
        const dz = z - obstacle.z;
        if (dx * dx + dz * dz < minD * minD) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
    }
    let excluded = false;
    for (const c of excludedCircles) {
      const dx = x - c.x, dz = z - c.z;
      if (dx * dx + dz * dz < c.r * c.r) { excluded = true; break; }
    }
    if (excluded) continue;
    const y = heightFn(x, z);
    if (y < minHeight || y > maxHeight) continue;

    v.set(x, y + yOffset, z);
    s.setScalar(minScale + Math.random() * (maxScale - minScale));
    e.set(
      (Math.random() - 0.5) * tilt,
      fullRotation ? Math.random() * Math.PI * 2 : 0,
      (Math.random() - 0.5) * tilt
    );
    q.setFromEuler(e);
    m.compose(v, q, s);
    mesh.setMatrixAt(placed, m);
    positions.push({ x, y: y + yOffset, z });
    placed++;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.userData.positions = positions;
  return mesh;
}

// ─── wildflower geometries (pooled, shared across all calls) ───

// Thin tapered stem.
const _wfStemGeo = /* @__PURE__ */ (() => {
  const geo = new THREE.CylinderGeometry(0.006, 0.012, 0.44, 5, 3).translate(0, 0.22, 0);
  // slight organic curve
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = y / 0.44;
    pos.setX(i, pos.getX(i) + Math.sin(t * Math.PI * 0.8) * 0.008);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
})();

// Small pistil (flower center) — flattened yellow sphere.
const _wfPistilGeo = /* @__PURE__ */ (() => {
  const geo = new THREE.SphereGeometry(0.018, 6, 5);
  geo.scale(1, 0.55, 1);
  return geo;
})();
const _wfPistilMat = /* @__PURE__ */ new THREE.MeshStandardMaterial({
  color: "#ffe135",
  flatShading: true,
  roughness: 0.5,
});

// Small petal — a shorter, wider version of the leafball teardrop.
const _wfPetalGeo = /* @__PURE__ */ (() => {
  const lengthSegs = 4;
  const widthSegs = 3;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let iy = 0; iy <= lengthSegs; iy++) {
    const v = iy / lengthSegs;
    const halfWidth = Math.max(0.004, 0.045 * Math.sin(Math.PI * v) ** 0.6);
    for (let ix = 0; ix <= widthSegs; ix++) {
      const u = ix / widthSegs;
      const side = u * 2 - 1;
      const centerLift = (1 - Math.abs(side)) * 0.006 * (1 - v * 0.4);
      const tipCurl = 0.025 * v ** 1.3;
      positions.push(side * halfWidth, v * 0.08, tipCurl + centerLift);
      uvs.push(u, v);
    }
  }
  for (let iy = 0; iy < lengthSegs; iy++) {
    for (let ix = 0; ix < widthSegs; ix++) {
      const a = iy * (widthSegs + 1) + ix;
      const b = a + 1;
      const c = a + widthSegs + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
})();

// Small leaf — reused from leafballtree shape but miniaturised.
const _wfLeafGeo = /* @__PURE__ */ (() => {
  const lengthSegs = 5;
  const widthSegs = 3;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let iy = 0; iy <= lengthSegs; iy++) {
    const v = iy / lengthSegs;
    const halfWidth = Math.max(0.003, 0.045 * Math.sin(Math.PI * v) ** 0.72 * (1 - v * 0.16));
    for (let ix = 0; ix <= widthSegs; ix++) {
      const u = ix / widthSegs;
      const side = u * 2 - 1;
      const centerLift = (1 - Math.abs(side)) * 0.005 * (1 - v * 0.35);
      const tipCurl = 0.030 * v ** 1.45;
      const edgeCurl = -Math.abs(side) * 0.005 * Math.sin(Math.PI * v);
      positions.push(side * halfWidth, -v * 0.15, tipCurl + centerLift + edgeCurl);
      uvs.push(u, v);
    }
  }
  for (let iy = 0; iy < lengthSegs; iy++) {
    for (let ix = 0; ix < widthSegs; ix++) {
      const a = iy * (widthSegs + 1) + ix;
      const b = a + 1;
      const c = a + widthSegs + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
})();

// Pooled materials (green stem/leaf, per-color petal).
const _wfStemMat = /* @__PURE__ */ applyWindSway(
  new THREE.MeshStandardMaterial({
    color: "#2d5a1e",
    flatShading: true,
    roughness: 0.85,
  }),
  1.0
);
const _wfLeafMat = /* @__PURE__ */ applyWindSway(
  new THREE.MeshStandardMaterial({
    color: "#3a7228",
    side: THREE.DoubleSide,
    flatShading: true,
    roughness: 0.80,
  }),
  1.0
);

function _wfPetalMat(color, glow) {
  const baseCol = new THREE.Color(color);
  return applyWindSway(
    new THREE.MeshStandardMaterial({
      color: baseCol,
      emissive: glow ? baseCol.clone() : 0x000000,
      emissiveIntensity: glow ? 1.1 : 0,
      side: THREE.DoubleSide,
      flatShading: true,
      roughness: 0.4,
    }),
    1.2
  );
}

// Helper: create an InstancedMesh from pre-computed matrices (same as flora.js).
function _makeInstancedBatch(geometry, material, matrices) {
  if (!matrices.length) return null;
  const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
  for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]);
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

// Pick a ground position using the same rejection sampling as placeInstanced,
// but return just { x, y, z } instead of building an InstancedMesh.
function _pickWildflowerPos(heightFn, opts) {
  const {
    maxRadiusFrac = 0.88,
    minHeight = -0.15,
    maxHeight = Infinity,
    avoidObstacleKindSet = null,
    avoidRadius = 0,
    visualRadius = false,
    excludedCircles = [],
  } = opts;
  let attempts = 0;
  while (attempts < 20) {
    attempts++;
    const p = pickGroundPoint(maxRadiusFrac, { visualRadius });
    const x = p.x, z = p.z;
    if (avoidObstacleKindSet) {
      let blocked = false;
      for (const obstacle of state.obstacles) {
        if (!avoidObstacleKindSet.has(obstacle.kind)) continue;
        const minD = obstacle.r + avoidRadius;
        const dx = x - obstacle.x, dz = z - obstacle.z;
        if (dx * dx + dz * dz < minD * minD) { blocked = true; break; }
      }
      if (blocked) continue;
    }
    let excluded = false;
    for (const c of excludedCircles) {
      const dx = x - c.x, dz = z - c.z;
      if (dx * dx + dz * dz < c.r * c.r) { excluded = true; break; }
    }
    if (excluded) continue;
    const y = heightFn(x, z);
    if (y < minHeight || y > maxHeight) continue;
    return { x, y, z };
  }
  return null;
}

export function makeWildflowerField(biome, heightFn, excludedCircles = []) {
  const palette = WILDFLOWER_PALETTES[biome.id] ?? ["#ffffff"];
  const total = _coverScale(FLOWER_DENSITY[biome.id] ?? 100, 1.6);
  if (total <= 0) return [];
  const perColor = Math.max(3, Math.floor(total / palette.length / 3));
  const glow = !!biome.glowFlowers;
  const meshes = [];

  const placeOpts = {
    maxRadiusFrac: 0.88,
    minHeight: -0.15,
    avoidObstacleKindSet: new Set(["lavafissure"]),
    avoidRadius: 0.12,
    visualRadius: true,
    excludedCircles,
  };

  // Pre-compute petal materials per palette colour.
  const petalMats = palette.map(c => _wfPetalMat(c, glow));

  // We build all matrices first, then batch into InstancedMeshes per type.
  // For each colour: stem matrices, leaf matrices, petal matrices.
  const stemMatrices = [];
  const leafMatrices = [];
  const pistilMatrices = [];
  const petalMatrices = palette.map(() => []);
  const allPositions = []; // flowerSpots

  const _m = new THREE.Matrix4();
  const _v = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _e = new THREE.Euler();
  const _q2 = new THREE.Quaternion();
  const _axis = new THREE.Vector3();
  const _q3 = new THREE.Quaternion();

  for (let ci = 0; ci < palette.length; ci++) {
    for (let fi = 0; fi < perColor; fi++) {
      const pos = _pickWildflowerPos(heightFn, placeOpts);
      if (!pos) continue;

      const { x, y, z } = pos;
      // Cluster of 2-4 flowers around this spot.
      const clusterSize = 2 + Math.floor(Math.random() * 3);
      for (let cf = 0; cf < clusterSize; cf++) {
        // Small offset within the cluster.
        const co = (cf / clusterSize) * Math.PI * 2 + Math.random() * 0.5;
        const cr = 0.02 + Math.random() * 0.03;
        const fx = x + Math.sin(co) * cr;
        const fz = z + Math.cos(co) * cr;
        const flowerScale = (0.9 + Math.random() * 1.0) * 1.25; // 25% larger
        const heightMul = 0.80 + Math.random() * 0.25 / 0.44; // 20% shorter min, up to +0.25 extra stem height
        const stemH = 0.44 * heightMul; // effective stem height
        const yRot = Math.random() * Math.PI * 2;
        const lean = Math.random() * 0.22;

        // stem — yaw to lean direction, then pitch in local space.
        _v.set(fx, y + 0.08, fz);
        _e.set(0, yRot, 0);
        _q.setFromEuler(_e);
        _q2.setFromAxisAngle(_axis.set(1, 0, 0), lean);
        _q.multiply(_q2);
        _s.set(flowerScale, flowerScale * heightMul, flowerScale);
        _m.compose(_v, _q, _s);
        stemMatrices.push(_m.clone());

        // 1-2 leaves attached partway up the leaned stem
        const leafCount = Math.random() < 0.6 ? 2 : 1;
        for (let li = 0; li < leafCount; li++) {
          const leafAngle = yRot + (li === 0 ? Math.PI * 0.5 : -Math.PI * 0.5) + (Math.random() - 0.5) * 0.5;
          const leafDroop = (Math.random() - 0.5) * 0.4;
          const stemFrac = 0.4 + Math.random() * 0.4;
          const stemLocal = new THREE.Vector3(0, stemH * stemFrac * flowerScale, 0);
          stemLocal.applyQuaternion(_q);
          _v.set(fx + stemLocal.x, y + 0.08 + stemLocal.y, fz + stemLocal.z);
          _e.set(0, leafAngle, 0);
          _q2.setFromEuler(_e);
          const leafQ = _q2.clone()
            .multiply(_q3.setFromAxisAngle(_axis.set(1, 0, 0), -Math.PI / 2 + leafDroop))
            .multiply(_q3.setFromAxisAngle(_axis.set(0, 0, 1), (Math.random() - 0.5) * 0.6))
            .multiply(_q3.setFromAxisAngle(_axis.set(0, 1, 0), (Math.random() - 0.5) * 0.4));
          _s.setScalar(flowerScale * (0.6 + Math.random() * 0.3));
          _m.compose(_v, leafQ, _s);
          leafMatrices.push(_m.clone());
        }

        // 4-6 petals at the stem tip, fanning outward.
        const petalCount = 4 + Math.floor(Math.random() * 3);
        const stemTipLocal = new THREE.Vector3(0, stemH * flowerScale, 0);
        stemTipLocal.applyQuaternion(_q);
        const stemTipX = fx + stemTipLocal.x;
        const stemTipY = y + 0.08 + stemTipLocal.y;
        const stemTipZ = fz + stemTipLocal.z;
        for (let pi = 0; pi < petalCount; pi++) {
          const pa = (pi / petalCount) * Math.PI * 2;
          _v.set(stemTipX, stemTipY + (Math.random() - 0.5) * 0.005, stemTipZ);
          _q2.setFromAxisAngle(_axis.set(0, 1, 0), pa);
          const petalQ = _q.clone().multiply(_q2);
          _q3.setFromAxisAngle(_axis.set(1, 0, 0), 1.15 + Math.random() * 0.35);
          petalQ.multiply(_q3);
          _s.setScalar(flowerScale * (0.8 + Math.random() * 0.4));
          _m.compose(_v, petalQ, _s);
          petalMatrices[ci].push(_m.clone());
        }

        // Pistil (yellow center) at stem tip, oriented with stem.
        _v.set(stemTipX, stemTipY, stemTipZ);
        _m.compose(_v, _q, _s.setScalar(flowerScale));
        pistilMatrices.push(_m.clone());
      } // end cluster

      allPositions.push({ x, y: y + 0.08, z });
    }
  }

  // Build InstancedMeshes.
  const stemMesh = _makeInstancedBatch(_wfStemGeo, _wfStemMat, stemMatrices);
  if (stemMesh) {
    stemMesh.userData.inspect = { category: "flora", variant: "wildflower" };
    meshes.push(stemMesh);
  }

  const leafMesh = _makeInstancedBatch(_wfLeafGeo, _wfLeafMat, leafMatrices);
  if (leafMesh) {
    leafMesh.userData.inspect = { category: "flora", variant: "wildflower" };
    meshes.push(leafMesh);
  }

  const pistilMesh = _makeInstancedBatch(_wfPistilGeo, _wfPistilMat, pistilMatrices);
  if (pistilMesh) {
    pistilMesh.userData.inspect = { category: "flora", variant: "wildflower" };
    meshes.push(pistilMesh);
  }

  let positionsAttached = false;
  for (let ci = 0; ci < palette.length; ci++) {
    const petalMesh = _makeInstancedBatch(_wfPetalGeo, petalMats[ci], petalMatrices[ci]);
    if (petalMesh) {
      if (glow) petalMesh.layers.enable(BLOOM_LAYER);
      // Only attach positions to the first petal mesh so world.js doesn't
      // duplicate flowerSpots when iterating all returned meshes.
      if (!positionsAttached) {
        petalMesh.userData.positions = allPositions;
        positionsAttached = true;
      }
      petalMesh.userData.inspect = { category: "flora", variant: "wildflower" };
      meshes.push(petalMesh);
    }
  }

  // Fallback: ensure flowerSpots are available on at least one mesh.
  if (!positionsAttached && meshes.length > 0) {
    meshes[0].userData.positions = allPositions;
  }

  return meshes;
}

export function makeVerdantGroveDetails(biome, heightFn, excludedCircles = []) {
  if (!biome.groveDetails?.groundCover) return null;

  const group = new THREE.Group();
  group.name = "verdant-grove-details";

  const dewGeo = new THREE.SphereGeometry(0.032, 6, 5);
  const dewMat = new THREE.MeshStandardMaterial({
    color: "#f2fff0",
    emissive: new THREE.Color("#d6ffd0").multiplyScalar(0.18),
    flatShading: false,
    roughness: 0.18,
    metalness: 0.08,
  });
  const dew = placeInstanced(dewGeo, dewMat, _coverScale(38), heightFn, {
    yOffset: 0.085,
    minScale: 0.45,
    maxScale: 0.95,
    tilt: 0,
    maxRadiusFrac: 0.78,
    minHeight: -0.12,
    avoidObstacleKinds: ["lavafissure"],
    avoidRadius: 0.12,
    visualRadius: true,
    excludedCircles,
  });
  dew.name = "dew-beads";
  dew.userData.inspect = { category: "flora", variant: "wildflower" };
  group.add(dew);

  group.userData.inspect = { category: "flora", variant: "grassblade" };
  return group;
}

export function makeCloudPuffField(biome, heightFn, excludedCircles = []) {
  if (!biome.cloudlike) return null;

  const geo = new THREE.IcosahedronGeometry(0.34, 1);
  geo.scale(1.15, 0.95, 1.05);
  const glow = new THREE.Color(0xffffff);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(biome.fog).lerp(glow, 0.82),
    emissive: new THREE.Color(biome.sky).lerp(glow, 0.68),
    emissiveIntensity: 0.14,
    flatShading: false,
    roughness: 0.82,
    metalness: 0,
  });
  const group = new THREE.Group();
  group.name = "cloud-puff-field";
  const floatingCloudlets = placeInstanced(geo, mat, _coverScale(LOWFX ? 14 : 24), heightFn, {
    yOffset: 0.16,
    minScale: 0.22,
    maxScale: 0.56,
    tilt: 0.18,
    maxRadiusFrac: 0.72,
    minHeight: -0.25,
    excludedCircles,
  });
  floatingCloudlets.name = "floatingCloudlets";
  floatingCloudlets.castShadow = false;
  floatingCloudlets.receiveShadow = false;
  group.add(floatingCloudlets);
  return group;
}

export function makePebbleField(biome, heightFn, excludedCircles = []) {
  const count = _coverScale(PEBBLE_DENSITY[biome.id] ?? 80);
  if (count <= 0) return null;
  const g = jitterGeo(new THREE.IcosahedronGeometry(0.08, 0), 0.025);
  g.scale(1.3, 0.45, 1.3);
  const col = new THREE.Color(biome.cliff).offsetHSL(
    0, -0.05, 0.08 + Math.random() * 0.1
  );
  const m = new THREE.MeshStandardMaterial({
    color: col,
    flatShading: true,
    roughness: 1,
  });
  const mesh = placeInstanced(g, m, count, heightFn, {
    yOffset: 0.02,
    minScale: 0.4,
    maxScale: 1.1,
    tilt: 0.5,
    avoidObstacleKinds: ["lavafissure"],
    avoidRadius: 0.12,
    visualRadius: true,
    excludedCircles,
  });
  mesh.userData.inspect = { category: "flora", variant: "pebble" };
  return mesh;
}

function makeStarfishGeometry() {
  const shape = new THREE.Shape();
  const points = 10;
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? 0.13 : 0.045;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

export function makeBeachcombField(biome, heightFn, excludedCircles = []) {
  const total = BEACHCOMB_DENSITY[biome.id] ?? 0;
  if (total <= 0) return null;

  const group = new THREE.Group();
  const shellCount = _coverScale(Math.round(total * 0.78));
  const starCount = _coverScale(Math.round(total * 0.22));

  const shellGeo = new THREE.SphereGeometry(0.08, 8, 6);
  shellGeo.scale(1.25, 0.28, 0.72);
  const shellMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(biome.ground[0]).lerp(new THREE.Color("#fff8e8"), 0.55),
    flatShading: true,
    roughness: 0.9,
  });
  const shells = placeInstanced(shellGeo, shellMat, shellCount, heightFn, {
    yOffset: 0.025,
    maxRadiusFrac: 0.96,
    minScale: 0.55,
    maxScale: 1.25,
    minHeight: -0.08,
    maxHeight: 0.32,
    tilt: 0.35,
    excludedCircles,
  });
  shells.userData.inspect = { category: "flora", variant: "shell" };
  group.add(shells);

  const starGeo = makeStarfishGeometry();
  const starMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(biome.accent).lerp(new THREE.Color("#ffd89a"), 0.35),
    side: THREE.DoubleSide,
    flatShading: true,
    roughness: 0.82,
  });
  const stars = placeInstanced(starGeo, starMat, starCount, heightFn, {
    yOffset: 0.035,
    maxRadiusFrac: 0.96,
    minScale: 0.45,
    maxScale: 0.9,
    minHeight: -0.12,
    maxHeight: 0.22,
    tilt: 0.12,
    excludedCircles,
  });
  stars.userData.inspect = { category: "flora", variant: "starfish" };
  group.add(stars);

  group.userData.inspect = { category: "flora", variant: "shell" };
  return group;
}
