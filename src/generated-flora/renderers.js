import * as THREE from "three";
import { applyWindSway } from "../util.js";
import { BLOOM_LAYER } from "../postfx.js";
import { createTouchEnvelope } from "./touch.js";
import { varyColor } from "./palette.js";

const UP = new THREE.Vector3(0, 1, 0);
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function makeResourceTracker() {
  const geometries = new Set();
  const materials = new Set();
  let disposed = false;

  return {
    geometry(geometry) {
      geometries.add(geometry);
      return geometry;
    },
    material(material) {
      materials.add(material);
      return material;
    },
    counts() {
      return Object.freeze({
        geometries: geometries.size,
        materials: materials.size,
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}

function makeMaterial(resources, color, {
  wind = 0,
  vertexColors = false,
  side = THREE.FrontSide,
  roughness = 0.88,
  emissive = 0x000000,
  emissiveIntensity = 0,
} = {}) {
  const material = new THREE.MeshStandardMaterial({
    color: vertexColors ? 0xffffff : color,
    emissive,
    emissiveIntensity,
    roughness,
    metalness: 0,
    flatShading: false,
    vertexColors,
    side,
  });
  material.userData.generatedFlora = true;
  material.userData.windStrength = wind;
  if (wind > 0) applyWindSway(material, wind);
  return resources.material(material);
}

function setMeshPresentation(object, { castShadow = false, receiveShadow = true } = {}) {
  object.castShadow = castShadow;
  object.receiveShadow = receiveShadow;
  return object;
}

function freezeBounds({
  centerY,
  radius,
  height,
  footprintRadius,
  dynamicMargin = 0,
}) {
  return Object.freeze({
    type: "sphere-with-footprint",
    center: Object.freeze([0, centerY, 0]),
    radius,
    height,
    footprintRadius,
    dynamicMargin,
  });
}

function createAnimatedRoot(dna, rng, mode) {
  const group = new THREE.Group();
  const restPivot = new THREE.Group();
  const touchPivot = new THREE.Group();
  group.add(restPivot);
  restPivot.add(touchPivot);

  const restAngle = rng.range(0, Math.PI * 2);
  const restLean =
    mode === "groundcover" ? 0 : dna.variation.lean;
  restPivot.rotation.x = Math.cos(restAngle) * restLean;
  restPivot.rotation.z = Math.sin(restAngle) * restLean;

  const fallbackAngle = rng.range(0, Math.PI * 2);
  const envelope = createTouchEnvelope({
    strength: dna.motion.touchStrength,
    stiffness: dna.motion.touchStiffness,
    damping: dna.motion.touchDamping,
    maxValue: 0.75,
    fallbackDirection: {
      x: Math.cos(fallbackAngle),
      z: Math.sin(fallbackAngle),
    },
  });

  const applyPose = (snapshot) => {
    const lean = snapshot.value * dna.motion.maxLean;
    touchPivot.rotation.x = snapshot.direction.z * lean;
    touchPivot.rotation.z = -snapshot.direction.x * lean;
    const impact = Math.min(Math.abs(snapshot.value), 0.6);
    if (mode === "groundcover") {
      touchPivot.scale.set(1 + impact * 0.07, 1 - impact * 0.18, 1 + impact * 0.07);
    } else if (mode === "flower") {
      touchPivot.scale.set(1 + impact * 0.025, 1 - impact * 0.055, 1 + impact * 0.025);
    } else {
      touchPivot.scale.set(1 + impact * 0.012, 1 - impact * 0.035, 1 + impact * 0.012);
    }
  };

  return {
    group,
    content: touchPivot,
    touch(amount, direction) {
      return envelope.trigger(amount, direction);
    },
    update(dt) {
      const snapshot = envelope.update(dt);
      applyPose(snapshot);
      return snapshot;
    },
    resetTouch() {
      const snapshot = envelope.reset();
      applyPose(snapshot);
      return snapshot;
    },
    touchState() {
      return envelope.snapshot();
    },
  };
}

function matrixFrom(position, rotation, scale) {
  return new THREE.Matrix4().compose(position, rotation, scale);
}

function makeVeilcrownRenderer(dna, colors, resources) {
  const s = dna.shape;
  const crownY = s.height;
  const lobeCount = 7;
  const signalCount = Math.max(7, s.spotCount);
  const spotRadius = Math.max(0.05, s.capRadius * 0.055);

  const stemGeometry = resources.geometry(
    new THREE.CylinderGeometry(0.72, 1, 1, 10, 3)
      .translate(0, 0.5, 0),
  );
  const coreGeometry = resources.geometry(
    new THREE.SphereGeometry(s.capRadius * 0.38, 20, 12)
      .scale(1, 0.72, 1),
  );
  const lobeGeometry = resources.geometry(
    new THREE.SphereGeometry(1, 16, 9)
      .scale(
        s.capRadius * 0.56,
        Math.max(0.13, s.capDepth * 0.34),
        s.capRadius * 0.18,
      )
      .translate(s.capRadius * 0.43, 0, 0),
  );
  const filamentGeometry = resources.geometry(
    new THREE.CylinderGeometry(
      spotRadius * 0.13,
      spotRadius * 0.2,
      1,
      6,
      1,
    ).translate(0, -0.5, 0),
  );
  const signalGeometry = resources.geometry(
    new THREE.OctahedronGeometry(spotRadius, 1)
      .scale(0.86, 1.55, 0.86),
  );
  const budGeometry = resources.geometry(
    new THREE.DodecahedronGeometry(s.capRadius * 0.13, 1)
      .scale(0.82, 1.18, 0.82),
  );

  const stemMaterial = makeMaterial(resources, colors.structure, {
    wind: dna.motion.wind * 0.45,
    roughness: 0.9,
  });
  const coreMaterial = makeMaterial(resources, colors.detail, {
    wind: dna.motion.wind * 0.76,
    roughness: 0.82,
    emissive: colors.detail,
    emissiveIntensity: 0.08,
  });
  const lobeMaterial = makeMaterial(resources, colors.body, {
    wind: dna.motion.wind,
    vertexColors: true,
    roughness: 0.78,
    emissive: colors.body,
    emissiveIntensity: 0.12,
  });
  const filamentMaterial = makeMaterial(resources, colors.structure, {
    wind: dna.motion.wind,
    roughness: 0.92,
  });
  const signalMaterial = makeMaterial(resources, colors.signal, {
    wind: dna.motion.wind,
    vertexColors: true,
    roughness: 0.64,
    emissive: colors.signal,
    emissiveIntensity: 0.32,
  });
  const budMaterial = makeMaterial(resources, colors.highlight, {
    wind: dna.motion.wind * 0.8,
    vertexColors: true,
    roughness: 0.76,
    emissive: colors.signal,
    emissiveIntensity: 0.24,
  });

  const crownRise = Math.max(
    s.capDepth,
    s.capRadius * 0.75,
  );
  const totalHeight = s.height + crownRise + spotRadius;
  const satelliteFootprint =
    s.satelliteCount > 0 ? s.capRadius * 1.48 : 0;
  const staticFootprint = Math.max(
    s.capRadius * 1.18 + spotRadius,
    satelliteFootprint,
  );
  const dynamicMargin =
    totalHeight * Math.sin(dna.motion.maxLean + dna.variation.lean);
  const footprint = staticFootprint + dynamicMargin;
  const centerY = totalHeight * 0.5;
  const bounds = freezeBounds({
    centerY,
    radius:
      Math.hypot(staticFootprint, totalHeight * 0.5) + dynamicMargin,
    height: totalHeight,
    footprintRadius: footprint,
    dynamicMargin,
  });

  return {
    bounds,
    affordanceSchema: Object.freeze(["landmark", "perch", "shelter"]),
    create(rng) {
      const animated = createAnimatedRoot(
        dna,
        rng.fork("touch"),
        "hero",
      );
      const content = animated.content;
      const stems = setMeshPresentation(
        new THREE.InstancedMesh(stemGeometry, stemMaterial, 5),
        { castShadow: true },
      );
      const stemRng = rng.fork("stem-bundle");
      for (let index = 0; index < 5; index++) {
        const angle =
          (index / 5) * Math.PI * 2 +
          stemRng.range(-0.18, 0.18);
        const bottom = new THREE.Vector3(
          Math.cos(angle) * s.stemRadius * 0.74,
          0,
          Math.sin(angle) * s.stemRadius * 0.74,
        );
        const topAngle =
          angle + Math.PI + stemRng.range(-0.4, 0.4);
        const top = new THREE.Vector3(
          Math.cos(topAngle) * s.stemRadius * 0.22,
          crownY,
          Math.sin(topAngle) * s.stemRadius * 0.22,
        );
        const direction = top.clone().sub(bottom);
        const length = direction.length();
        const rotation = new THREE.Quaternion().setFromUnitVectors(
          UP,
          direction.normalize(),
        );
        const radius = s.stemRadius * stemRng.range(0.31, 0.43);
        stems.setMatrixAt(
          index,
          matrixFrom(
            bottom,
            rotation,
            new THREE.Vector3(radius, length, radius),
          ),
        );
      }
      stems.instanceMatrix.needsUpdate = true;
      const core = setMeshPresentation(
        new THREE.Mesh(coreGeometry, coreMaterial),
        { castShadow: true },
      );
      core.position.y = crownY;
      content.add(stems, core);

      const lobes = setMeshPresentation(
        new THREE.InstancedMesh(
          lobeGeometry,
          lobeMaterial,
          lobeCount,
        ),
        { castShadow: true },
      );
      const lobeRng = rng.fork("veil-lobes");
      for (let index = 0; index < lobeCount; index++) {
        const yaw =
          (index / lobeCount) * Math.PI * 2 +
          lobeRng.range(-0.08, 0.08);
        const posture = [0.62, -0.42, 0.24, -0.54, 0.48, -0.31, 0.12][
          index
        ];
        const droop = posture + lobeRng.range(-0.035, 0.035);
        const position = new THREE.Vector3(
          lobeRng.range(-0.045, 0.045),
          crownY + lobeRng.range(-0.055, 0.055),
          lobeRng.range(-0.045, 0.045),
        );
        const rotation = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(0, yaw, droop, "YZX"),
        );
        const radialScale = lobeRng.range(0.9, 1.13);
        const scale = new THREE.Vector3(
          radialScale,
          lobeRng.range(0.82, 1.08),
          lobeRng.range(0.82, 1.12),
        );
        lobes.setMatrixAt(
          index,
          matrixFrom(position, rotation, scale),
        );
        const base =
          index % 3 === 0
            ? colors.signal
            : index % 2 === 0
              ? colors.detail
              : colors.body;
        lobes.setColorAt(
          index,
          varyColor(base, lobeRng.range(-1, 1), 0.06),
        );
      }
      lobes.instanceMatrix.needsUpdate = true;
      if (lobes.instanceColor) lobes.instanceColor.needsUpdate = true;
      content.add(lobes);

      const stemFins = setMeshPresentation(
        new THREE.InstancedMesh(lobeGeometry, lobeMaterial, 5),
        { castShadow: false },
      );
      const finRng = rng.fork("stem-fins");
      for (let index = 0; index < 5; index++) {
        const yaw =
          index * GOLDEN_ANGLE +
          finRng.range(-0.18, 0.18);
        const position = new THREE.Vector3(
          0,
          crownY * (0.28 + index * 0.105),
          0,
        );
        const rotation = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            0,
            yaw,
            finRng.range(-0.34, 0.22),
            "YZX",
          ),
        );
        const finScale = finRng.range(0.15, 0.25);
        stemFins.setMatrixAt(
          index,
          matrixFrom(
            position,
            rotation,
            new THREE.Vector3(
              finScale,
              finScale * 0.75,
              finScale,
            ),
          ),
        );
        stemFins.setColorAt(
          index,
          varyColor(
            index % 2 === 0 ? colors.detail : colors.body,
            finRng.range(-1, 1),
            0.055,
          ),
        );
      }
      stemFins.instanceMatrix.needsUpdate = true;
      if (stemFins.instanceColor) {
        stemFins.instanceColor.needsUpdate = true;
      }
      content.add(stemFins);

      const filaments = setMeshPresentation(
        new THREE.InstancedMesh(
          filamentGeometry,
          filamentMaterial,
          signalCount,
        ),
        { castShadow: false },
      );
      const signals = setMeshPresentation(
        new THREE.InstancedMesh(
          signalGeometry,
          signalMaterial,
          signalCount,
        ),
        { castShadow: false },
      );
      const signalRng = rng.fork("pendant-signals");
      for (let index = 0; index < signalCount; index++) {
        const angle =
          (index / signalCount) * Math.PI * 2 +
          signalRng.range(-0.11, 0.11);
        const radial =
          s.capRadius * signalRng.range(0.5, 0.97);
        const length = signalRng.range(
          s.capDepth * 0.45,
          s.capDepth * 1.42,
        );
        const top = new THREE.Vector3(
          Math.cos(angle) * radial,
          crownY - signalRng.range(0.04, s.capDepth * 0.24),
          Math.sin(angle) * radial,
        );
        const filamentScale = new THREE.Vector3(
          signalRng.range(0.75, 1.18),
          length,
          signalRng.range(0.75, 1.18),
        );
        filaments.setMatrixAt(
          index,
          matrixFrom(
            top,
            new THREE.Quaternion(),
            filamentScale,
          ),
        );
        const dropPosition = top.clone();
        dropPosition.y -= length + spotRadius * 0.3;
        const dropRotation =
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(
              signalRng.range(-0.15, 0.15),
              angle,
              signalRng.range(-0.15, 0.15),
            ),
          );
        const dropScale = signalRng.range(0.72, 1.22);
        signals.setMatrixAt(
          index,
          matrixFrom(
            dropPosition,
            dropRotation,
            new THREE.Vector3(
              dropScale,
              dropScale,
              dropScale,
            ),
          ),
        );
        signals.setColorAt(
          index,
          varyColor(
            index % 4 === 0 ? colors.highlight : colors.signal,
            signalRng.range(-1, 1),
            0.05,
          ),
        );
      }
      filaments.instanceMatrix.needsUpdate = true;
      signals.instanceMatrix.needsUpdate = true;
      if (signals.instanceColor) signals.instanceColor.needsUpdate = true;
      signals.layers.enable(BLOOM_LAYER);
      content.add(filaments, signals);

      if (s.satelliteCount > 0) {
        const shoots = setMeshPresentation(
          new THREE.InstancedMesh(
            stemGeometry,
            stemMaterial,
            s.satelliteCount,
          ),
          { castShadow: true },
        );
        const buds = setMeshPresentation(
          new THREE.InstancedMesh(
            budGeometry,
            budMaterial,
            s.satelliteCount,
          ),
          { castShadow: true },
        );
        const shootRng = rng.fork("satellite-shoots");
        for (let index = 0; index < s.satelliteCount; index++) {
          const angle =
            (index / s.satelliteCount) * Math.PI * 2 +
            shootRng.range(-0.4, 0.4);
          const radial = shootRng.range(
            s.capRadius * 0.88,
            s.capRadius * 1.15,
          );
          const position = new THREE.Vector3(
            Math.cos(angle) * radial,
            0,
            Math.sin(angle) * radial,
          );
          const size = shootRng.range(0.17, 0.27);
          const rotation =
            new THREE.Quaternion().setFromEuler(
              new THREE.Euler(
                Math.cos(angle) * 0.08,
                angle,
                -Math.sin(angle) * 0.08,
              ),
            );
          shoots.setMatrixAt(
            index,
            matrixFrom(
              position,
              rotation,
              new THREE.Vector3(
                s.stemRadius * size,
                s.height * size,
                s.stemRadius * size,
              ),
            ),
          );
          const budPosition = position.clone();
          budPosition.y = s.height * size;
          buds.setMatrixAt(
            index,
            matrixFrom(
              budPosition,
              rotation,
              new THREE.Vector3(
                shootRng.range(0.78, 1.08),
                shootRng.range(0.78, 1.14),
                shootRng.range(0.78, 1.08),
              ),
            ),
          );
          buds.setColorAt(
            index,
            varyColor(
              index % 2 === 0 ? colors.highlight : colors.signal,
              shootRng.range(-1, 1),
              0.045,
            ),
          );
        }
        shoots.instanceMatrix.needsUpdate = true;
        buds.instanceMatrix.needsUpdate = true;
        if (buds.instanceColor) buds.instanceColor.needsUpdate = true;
        content.add(shoots, buds);
      }

      const affordances = [
        {
          type: "landmark",
          position: [0, centerY, 0],
          radius: s.capRadius,
          capacity: 1,
        },
        {
          type: "perch",
          position: [
            0,
            crownY + s.capRadius * 0.28,
            0,
          ],
          radius: s.capRadius * 0.42,
          capacity: Math.max(1, Math.round(s.capRadius)),
        },
        {
          type: "shelter",
          position: [0, s.stemRadius * 0.45, 0],
          radius: s.capRadius * 0.72,
          capacity: 3,
        },
      ];
      return { ...animated, affordances };
    },
  };
}

function makeHeroRenderer(dna, colors, resources) {
  if (dna.name === "Veilcrown") {
    return makeVeilcrownRenderer(dna, colors, resources);
  }
  const s = dna.shape;
  const undersideHeight = s.capDepth * 0.18;
  const spotRadius = Math.max(0.055, s.capRadius * 0.095);

  const stemGeometry = resources.geometry(
    new THREE.CylinderGeometry(s.stemRadius * 0.62, s.stemRadius, s.height, 18, 4)
      .translate(0, s.height * 0.5, 0)
  );
  const capGeometry = resources.geometry(
    new THREE.SphereGeometry(s.capRadius, 28, 12, 0, Math.PI * 2, 0, Math.PI * 0.5)
      .scale(1, s.capDepth / s.capRadius, 1)
      .translate(0, s.height, 0)
  );
  const undersideGeometry = resources.geometry(
    new THREE.CylinderGeometry(
      s.capRadius * 0.82,
      s.capRadius * 0.97,
      undersideHeight,
      28,
      1
    ).translate(0, s.height - undersideHeight * 0.5, 0)
  );
  const spotGeometry = resources.geometry(
    new THREE.SphereGeometry(spotRadius, 10, 7)
  );

  const stemMaterial = makeMaterial(resources, colors.structure, {
    wind: dna.motion.wind * 0.45,
  });
  const capMaterial = makeMaterial(resources, colors.body, {
    wind: dna.motion.wind,
    roughness: 0.82,
  });
  const undersideMaterial = makeMaterial(resources, colors.detail, {
    wind: dna.motion.wind * 0.75,
    roughness: 0.94,
  });
  const spotMaterial = makeMaterial(resources, colors.signal, {
    wind: dna.motion.wind,
    vertexColors: true,
  });

  const spotMargin = s.spotCount > 0 ? spotRadius * 0.55 : 0;
  const totalHeight = s.height + s.capDepth + spotMargin;
  const satelliteFootprint =
    s.satelliteCount > 0 ? s.capRadius * 1.48 : 0;
  const staticFootprint = Math.max(
    s.capRadius + spotMargin,
    satelliteFootprint
  );
  const dynamicMargin =
    totalHeight * Math.sin(dna.motion.maxLean + dna.variation.lean);
  const footprint = staticFootprint + dynamicMargin;
  const centerY = totalHeight * 0.5;
  const bounds = freezeBounds({
    centerY,
    radius: Math.hypot(staticFootprint, totalHeight * 0.5) + dynamicMargin,
    height: totalHeight,
    footprintRadius: footprint,
    dynamicMargin,
  });

  return {
    bounds,
    affordanceSchema: Object.freeze(["landmark", "perch", "shelter"]),
    create(rng) {
      const animated = createAnimatedRoot(dna, rng.fork("touch"), "hero");
      const content = animated.content;

      const stem = setMeshPresentation(
        new THREE.Mesh(stemGeometry, stemMaterial),
        { castShadow: true }
      );
      const cap = setMeshPresentation(
        new THREE.Mesh(capGeometry, capMaterial),
        { castShadow: true }
      );
      const underside = setMeshPresentation(
        new THREE.Mesh(undersideGeometry, undersideMaterial),
        { castShadow: true }
      );
      content.add(stem, underside, cap);

      if (s.spotCount > 0) {
        const spots = setMeshPresentation(
          new THREE.InstancedMesh(spotGeometry, spotMaterial, s.spotCount),
          { castShadow: false }
        );
        const spotRng = rng.fork("spots");
        for (let i = 0; i < s.spotCount; i++) {
          const angle = spotRng.range(0, Math.PI * 2);
          const radialUnit = Math.sqrt(spotRng.range(0.04, 0.72));
          const radial = radialUnit * s.capRadius;
          const dome = Math.sqrt(Math.max(0, 1 - radialUnit * radialUnit));
          const position = new THREE.Vector3(
            Math.cos(angle) * radial,
            s.height + s.capDepth * dome + spotRadius * 0.15,
            Math.sin(angle) * radial
          );
          const normal = new THREE.Vector3(
            position.x / Math.max(s.capRadius, 1e-4),
            dome * s.capRadius / Math.max(s.capDepth, 1e-4),
            position.z / Math.max(s.capRadius, 1e-4)
          ).normalize();
          const rotation = new THREE.Quaternion().setFromUnitVectors(UP, normal);
          const spotScale = spotRng.range(0.68, 1.28);
          const scale = new THREE.Vector3(spotScale, spotScale * 0.28, spotScale);
          spots.setMatrixAt(i, matrixFrom(position, rotation, scale));
          const base = i % 4 === 0 ? colors.highlight : colors.signal;
          spots.setColorAt(i, varyColor(base, spotRng.range(-1, 1), 0.055));
        }
        spots.instanceMatrix.needsUpdate = true;
        if (spots.instanceColor) spots.instanceColor.needsUpdate = true;
        content.add(spots);
      }

      if (s.satelliteCount > 0) {
        const stems = setMeshPresentation(
          new THREE.InstancedMesh(stemGeometry, stemMaterial, s.satelliteCount),
          { castShadow: true }
        );
        const caps = setMeshPresentation(
          new THREE.InstancedMesh(capGeometry, capMaterial, s.satelliteCount),
          { castShadow: true }
        );
        const satelliteRng = rng.fork("satellites");
        for (let i = 0; i < s.satelliteCount; i++) {
          const angle = satelliteRng.range(0, Math.PI * 2);
          const radial = satelliteRng.range(s.capRadius * 0.72, s.capRadius * 1.08);
          const position = new THREE.Vector3(
            Math.cos(angle) * radial,
            0,
            Math.sin(angle) * radial
          );
          const rotation = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(0, satelliteRng.range(0, Math.PI * 2), 0)
          );
          const size = satelliteRng.range(0.16, 0.3);
          const scale = new THREE.Vector3(
            size * satelliteRng.range(0.86, 1.12),
            size * satelliteRng.range(0.75, 1.08),
            size * satelliteRng.range(0.86, 1.12)
          );
          const matrix = matrixFrom(position, rotation, scale);
          stems.setMatrixAt(i, matrix);
          caps.setMatrixAt(i, matrix);
        }
        stems.instanceMatrix.needsUpdate = true;
        caps.instanceMatrix.needsUpdate = true;
        content.add(stems, caps);
      }

      const affordances = [
        {
          type: "landmark",
          position: [0, centerY, 0],
          radius: s.capRadius,
          capacity: 1,
        },
        {
          type: "perch",
          position: [0, s.height + s.capDepth, 0],
          radius: s.capRadius * 0.62,
          capacity: Math.max(1, Math.round(s.capRadius)),
        },
        {
          type: "shelter",
          position: [0, s.stemRadius * 0.45, 0],
          radius: s.capRadius * 0.72,
          capacity: 3,
        },
      ];
      return { ...animated, affordances };
    },
  };
}

function makePulsebellRenderer(dna, colors, resources) {
  const s = dna.shape;
  const stemRadius = Math.max(0.018, s.bloomRadius * 0.09);
  const bellProfile = [
    new THREE.Vector2(0, s.bloomRadius * 0.62),
    new THREE.Vector2(s.bloomRadius * 0.18, s.bloomRadius * 0.54),
    new THREE.Vector2(s.bloomRadius * 0.42, s.bloomRadius * 0.26),
    new THREE.Vector2(s.bloomRadius * 0.68, -s.bloomRadius * 0.2),
    new THREE.Vector2(s.bloomRadius * 0.88, -s.bloomRadius * 0.58),
  ];

  const stemGeometry = resources.geometry(
    new THREE.CylinderGeometry(
      stemRadius * 0.68,
      stemRadius,
      s.stemHeight,
      7,
      2,
    ).translate(0, s.stemHeight * 0.5, 0),
  );
  const hoodGeometry = resources.geometry(
    new THREE.LatheGeometry(bellProfile, 14)
      .translate(0, s.stemHeight, 0),
  );
  const rimGeometry = resources.geometry(
    new THREE.TorusGeometry(
      s.bloomRadius * 0.78,
      s.bloomRadius * 0.075,
      6,
      16,
    )
      .rotateX(Math.PI * 0.5)
      .translate(
        0,
        s.stemHeight - s.bloomRadius * 0.58,
        0,
      ),
  );
  const pulseGeometry = resources.geometry(
    new THREE.OctahedronGeometry(s.bloomRadius * 0.24, 1)
      .scale(0.72, 1.38, 0.72)
      .translate(
        0,
        s.stemHeight - s.bloomRadius * 0.92,
        0,
      ),
  );
  const leafGeometry = resources.geometry(
    new THREE.SphereGeometry(1, 9, 6)
      .scale(
        s.bloomRadius * 0.82,
        s.bloomRadius * 0.13,
        s.bloomRadius * 0.3,
      )
      .translate(
        s.bloomRadius * 0.54,
        s.stemHeight * 0.43,
        0,
      ),
  );

  const stemMaterial = makeMaterial(resources, colors.structure, {
    wind: dna.motion.wind * 0.8,
    roughness: 0.9,
  });
  const hoodMaterial = makeMaterial(resources, colors.body, {
    wind: dna.motion.wind,
    vertexColors: true,
    roughness: 0.7,
    emissive: colors.body,
    emissiveIntensity: 0.19,
    side: THREE.DoubleSide,
  });
  const rimMaterial = makeMaterial(resources, colors.signal, {
    wind: dna.motion.wind,
    roughness: 0.58,
    emissive: colors.signal,
    emissiveIntensity: 0.46,
  });
  const pulseMaterial = makeMaterial(resources, colors.highlight, {
    wind: dna.motion.wind,
    vertexColors: true,
    roughness: 0.48,
    emissive: colors.signal,
    emissiveIntensity: 1.18,
  });
  const leafMaterial = makeMaterial(resources, colors.detail, {
    wind: dna.motion.wind * 0.9,
    vertexColors: true,
    roughness: 0.84,
  });

  const internalScaleMax = 1.2;
  const tiltMargin = s.stemHeight * 0.36;
  const totalHeight =
    (s.stemHeight + s.bloomRadius * 0.68) * internalScaleMax;
  const staticFootprint =
    (
      s.clusterRadius * 0.9 +
      s.bloomRadius * 0.94 +
      tiltMargin
    ) * internalScaleMax;
  const dynamicMargin =
    totalHeight * Math.sin(dna.motion.maxLean + dna.variation.lean);
  const footprint = staticFootprint + dynamicMargin;
  const bounds = freezeBounds({
    centerY: totalHeight * 0.5,
    radius:
      Math.hypot(staticFootprint, totalHeight * 0.5) +
      dynamicMargin,
    height: totalHeight,
    footprintRadius: footprint,
    dynamicMargin,
  });

  return {
    bounds,
    affordanceSchema: Object.freeze(["nectar", "pollen"]),
    create(rng) {
      const animated = createAnimatedRoot(
        dna,
        rng.fork("touch"),
        "flower",
      );
      const content = animated.content;
      const flowers = [];
      const layoutRng = rng.fork("pulsebell-layout");

      for (let index = 0; index < s.flowerCount; index++) {
        const angle =
          index === 0
            ? layoutRng.range(0, Math.PI * 2)
            : index * GOLDEN_ANGLE + layoutRng.range(-0.22, 0.22);
        const radial =
          index === 0
            ? s.clusterRadius * 0.12
            : Math.sqrt(layoutRng.next()) * s.clusterRadius * 0.9;
        flowers.push({
          x: Math.cos(angle) * radial,
          z: Math.sin(angle) * radial,
          yaw: angle + layoutRng.range(-0.45, 0.45),
          scale: layoutRng.range(0.82, 1.18),
          heightScale: layoutRng.range(0.76, 1.18),
          tilt: layoutRng.range(0.18, 0.36),
        });
      }

      const stems = setMeshPresentation(
        new THREE.InstancedMesh(
          stemGeometry,
          stemMaterial,
          flowers.length,
        ),
      );
      const hoods = setMeshPresentation(
        new THREE.InstancedMesh(
          hoodGeometry,
          hoodMaterial,
          flowers.length,
        ),
        { castShadow: false },
      );
      const rims = setMeshPresentation(
        new THREE.InstancedMesh(
          rimGeometry,
          rimMaterial,
          flowers.length,
        ),
      );
      const pulses = setMeshPresentation(
        new THREE.InstancedMesh(
          pulseGeometry,
          pulseMaterial,
          flowers.length,
        ),
      );
      const leaves = setMeshPresentation(
        new THREE.InstancedMesh(
          leafGeometry,
          leafMaterial,
          flowers.length * s.leafPairs * 2,
        ),
      );

      let leafIndex = 0;
      const affordances = [];
      for (let index = 0; index < flowers.length; index++) {
        const flower = flowers[index];
        const radialLength =
          Math.hypot(flower.x, flower.z) || 1;
        const direction = new THREE.Vector3(
          (flower.x / radialLength) * flower.tilt,
          1,
          (flower.z / radialLength) * flower.tilt,
        ).normalize();
        const baseRotation =
          new THREE.Quaternion().setFromUnitVectors(UP, direction);
        baseRotation.multiply(
          new THREE.Quaternion().setFromAxisAngle(UP, flower.yaw),
        );
        const position = new THREE.Vector3(
          flower.x,
          0,
          flower.z,
        );
        const stemScale = new THREE.Vector3(
          flower.scale,
          flower.heightScale,
          flower.scale,
        );
        const matrix = matrixFrom(
          position,
          baseRotation,
          stemScale,
        );
        stems.setMatrixAt(index, matrix);
        hoods.setMatrixAt(index, matrix);
        rims.setMatrixAt(index, matrix);
        pulses.setMatrixAt(index, matrix);

        const hoodBase =
          index % 3 === 0
            ? colors.signal
            : index % 2 === 0
              ? colors.detail
              : colors.body;
        hoods.setColorAt(
          index,
          varyColor(
            hoodBase,
            layoutRng.range(-1, 1),
            0.055,
          ),
        );
        pulses.setColorAt(
          index,
          varyColor(
            index % 2 === 0 ? colors.highlight : colors.signal,
            layoutRng.range(-1, 1),
            0.045,
          ),
        );

        for (let pair = 0; pair < s.leafPairs; pair++) {
          for (const side of [-1, 1]) {
            const leafRotation = baseRotation.clone().multiply(
              new THREE.Quaternion().setFromAxisAngle(
                UP,
                side * Math.PI * 0.5 + pair * 1.42,
              ),
            );
            const leafScale = stemScale
              .clone()
              .multiplyScalar(0.7 + pair * 0.13);
            leaves.setMatrixAt(
              leafIndex,
              matrixFrom(position, leafRotation, leafScale),
            );
            leaves.setColorAt(
              leafIndex,
              varyColor(
                index % 2 === 0 ? colors.detail : colors.body,
                layoutRng.range(-1, 1),
                0.05,
              ),
            );
            leafIndex++;
          }
        }

        affordances.push({
          type: "nectar",
          position: [
            flower.x,
            s.stemHeight * flower.heightScale -
              s.bloomRadius * 0.74,
            flower.z,
          ],
          radius: s.bloomRadius * 1.2,
          capacity: 1,
        });
      }
      affordances.push({
        type: "pollen",
        position: [0, s.stemHeight * 0.7, 0],
        radius: footprint,
        capacity: flowers.length,
      });

      for (const mesh of [stems, hoods, rims, pulses, leaves]) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        content.add(mesh);
      }
      pulses.layers.enable(BLOOM_LAYER);
      return { ...animated, affordances };
    },
  };
}

function makeFlowerRenderer(dna, colors, resources) {
  if (dna.name === "Pulsebells") {
    return makePulsebellRenderer(dna, colors, resources);
  }
  const s = dna.shape;
  const stemRadius = Math.max(0.018, s.bloomRadius * 0.1);

  const stemGeometry = resources.geometry(
    new THREE.CylinderGeometry(
      stemRadius * 0.72,
      stemRadius,
      s.stemHeight,
      8,
      2
    ).translate(0, s.stemHeight * 0.5, 0)
  );
  const petalGeometry = resources.geometry(
    new THREE.SphereGeometry(1, 10, 7)
      .scale(s.bloomRadius * 0.86, s.bloomRadius * 0.22, s.bloomRadius * 0.42)
      .translate(s.bloomRadius * 0.67, s.stemHeight, 0)
  );
  const centerGeometry = resources.geometry(
    new THREE.SphereGeometry(s.bloomRadius * 0.4, 10, 7)
      .translate(0, s.stemHeight, 0)
  );
  const leafGeometry = resources.geometry(
    new THREE.SphereGeometry(1, 9, 6)
      .scale(s.bloomRadius * 0.78, s.bloomRadius * 0.14, s.bloomRadius * 0.32)
      .translate(s.bloomRadius * 0.52, s.stemHeight * 0.48, 0)
  );

  const stemMaterial = makeMaterial(resources, colors.structure, {
    wind: dna.motion.wind * 0.78,
  });
  const petalMaterial = makeMaterial(resources, colors.body, {
    wind: dna.motion.wind,
    vertexColors: true,
    roughness: 0.86,
    emissive: colors.body,
    emissiveIntensity: 0.11,
  });
  const centerMaterial = makeMaterial(resources, colors.signal, {
    wind: dna.motion.wind,
    emissive: colors.signal,
    emissiveIntensity: 0.68,
  });
  const leafMaterial = makeMaterial(resources, colors.detail, {
    wind: dna.motion.wind * 0.88,
    vertexColors: true,
  });

  const internalScaleMax = 1.18;
  const totalHeight =
    (s.stemHeight + s.bloomRadius * 0.45) * internalScaleMax;
  const staticFootprint =
    (s.clusterRadius * 0.9 + s.bloomRadius * 1.65) * internalScaleMax;
  const dynamicMargin =
    totalHeight * Math.sin(dna.motion.maxLean + dna.variation.lean);
  const footprint = staticFootprint + dynamicMargin;
  const bounds = freezeBounds({
    centerY: totalHeight * 0.5,
    radius: Math.hypot(staticFootprint, totalHeight * 0.5) + dynamicMargin,
    height: totalHeight,
    footprintRadius: footprint,
    dynamicMargin,
  });

  return {
    bounds,
    affordanceSchema: Object.freeze(["nectar", "pollen"]),
    create(rng) {
      const animated = createAnimatedRoot(dna, rng.fork("touch"), "flower");
      const content = animated.content;
      const flowers = [];
      const layoutRng = rng.fork("layout");

      for (let i = 0; i < s.flowerCount; i++) {
        const angle = i === 0 ? 0 : layoutRng.range(0, Math.PI * 2);
        const radial = i === 0
          ? 0
          : Math.sqrt(layoutRng.next()) * s.clusterRadius * 0.9;
        flowers.push({
          x: Math.cos(angle) * radial,
          z: Math.sin(angle) * radial,
          yaw: layoutRng.range(0, Math.PI * 2),
          scale: layoutRng.range(0.82, 1.18),
          heightScale: layoutRng.range(0.76, 1.18),
        });
      }

      const stems = setMeshPresentation(
        new THREE.InstancedMesh(stemGeometry, stemMaterial, flowers.length)
      );
      const centers = setMeshPresentation(
        new THREE.InstancedMesh(centerGeometry, centerMaterial, flowers.length)
      );
      const petals = setMeshPresentation(
        new THREE.InstancedMesh(
          petalGeometry,
          petalMaterial,
          flowers.length * s.petalCount
        )
      );
      const leaves = setMeshPresentation(
        new THREE.InstancedMesh(
          leafGeometry,
          leafMaterial,
          flowers.length * s.leafPairs * 2
        )
      );

      let petalIndex = 0;
      let leafIndex = 0;
      const affordances = [];
      for (let i = 0; i < flowers.length; i++) {
        const flower = flowers[i];
        const position = new THREE.Vector3(flower.x, 0, flower.z);
        const baseRotation = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(0, flower.yaw, 0)
        );
        const stemScale = new THREE.Vector3(
          flower.scale,
          flower.heightScale,
          flower.scale
        );
        stems.setMatrixAt(i, matrixFrom(position, baseRotation, stemScale));
        centers.setMatrixAt(i, matrixFrom(position, baseRotation, stemScale));

        for (let p = 0; p < s.petalCount; p++) {
          const rotation = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(
              layoutRng.range(-0.08, 0.08),
              flower.yaw + (p / s.petalCount) * Math.PI * 2,
              layoutRng.range(-0.08, 0.08)
            )
          );
          petals.setMatrixAt(
            petalIndex,
            matrixFrom(position, rotation, stemScale)
          );
          const petalBase = p % 3 === 0 ? colors.signal : colors.body;
          petals.setColorAt(
            petalIndex,
            varyColor(petalBase, layoutRng.range(-1, 1), 0.07)
          );
          petalIndex++;
        }

        for (let pair = 0; pair < s.leafPairs; pair++) {
          for (const side of [-1, 1]) {
            const rotation = new THREE.Quaternion().setFromEuler(
              new THREE.Euler(
                0,
                flower.yaw + side * Math.PI * 0.5 + pair * 1.4,
                side * layoutRng.range(-0.14, 0.14)
              )
            );
            const leafScale = stemScale.clone().multiplyScalar(
              0.72 + pair * 0.12
            );
            leaves.setMatrixAt(
              leafIndex,
              matrixFrom(position, rotation, leafScale)
            );
            leaves.setColorAt(
              leafIndex,
              varyColor(colors.detail, layoutRng.range(-1, 1), 0.055)
            );
            leafIndex++;
          }
        }

        affordances.push({
          type: "nectar",
          position: [
            flower.x,
            s.stemHeight * flower.heightScale + s.bloomRadius * 0.16,
            flower.z,
          ],
          radius: s.bloomRadius * 1.3,
          capacity: 1,
        });
      }
      affordances.push({
        type: "pollen",
        position: [0, s.stemHeight * 0.72, 0],
        radius: footprint,
        capacity: flowers.length,
      });

      for (const mesh of [stems, centers, petals, leaves]) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        content.add(mesh);
      }
      return { ...animated, affordances };
    },
  };
}

function makeBladeGeometry(height, width) {
  const levels = 5;
  const positions = [];
  const indices = [];
  for (let i = 0; i < levels; i++) {
    const t = i / (levels - 1);
    const halfWidth = width * 0.5 * (1 - t * 0.92);
    const curve = Math.sin(t * Math.PI * 0.5) * height * 0.11;
    positions.push(-halfWidth, t * height, curve);
    positions.push(halfWidth, t * height, curve);
    if (i < levels - 1) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makeGroundcoverRenderer(dna, colors, resources) {
  const s = dna.shape;
  const bladeGeometry = resources.geometry(
    makeBladeGeometry(s.bladeHeight, s.bladeWidth)
  );
  const bladeMaterial = makeMaterial(resources, colors.body, {
    wind: dna.motion.wind,
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.92,
    emissive: colors.signal,
    emissiveIntensity: 0.07,
  });
  const totalHeight = s.bladeHeight * (1 + s.heightVariance);
  const dynamicMargin =
    totalHeight * Math.sin(dna.motion.maxLean + dna.variation.lean);
  const footprint = s.patchRadius + s.bladeWidth + dynamicMargin;
  const bounds = freezeBounds({
    centerY: totalHeight * 0.5,
    radius:
      Math.hypot(s.patchRadius + s.bladeWidth, totalHeight * 0.5) +
      dynamicMargin,
    height: totalHeight,
    footprintRadius: footprint,
    dynamicMargin,
  });

  return {
    bounds,
    affordanceSchema: Object.freeze(["forage", "soft-cover"]),
    create(rng) {
      const animated = createAnimatedRoot(dna, rng.fork("touch"), "groundcover");
      const content = animated.content;
      const blades = setMeshPresentation(
        new THREE.InstancedMesh(bladeGeometry, bladeMaterial, s.count),
        { castShadow: false }
      );
      const layoutRng = rng.fork("layout");
      const clusterCount = 3 + Math.round(s.clumpiness * 5);
      const clusters = [];
      for (let i = 0; i < clusterCount; i++) {
        const angle = layoutRng.range(0, Math.PI * 2);
        const radial = Math.sqrt(layoutRng.next()) * s.patchRadius * 0.72;
        clusters.push({
          x: Math.cos(angle) * radial,
          z: Math.sin(angle) * radial,
        });
      }

      for (let i = 0; i < s.count; i++) {
        let x;
        let z;
        if (layoutRng.next() < s.clumpiness) {
          const cluster = clusters[layoutRng.int(0, clusters.length - 1)];
          const angle = layoutRng.range(0, Math.PI * 2);
          const radial =
            Math.sqrt(layoutRng.next()) *
            s.patchRadius *
            (0.08 + (1 - s.clumpiness) * 0.28);
          x = cluster.x + Math.cos(angle) * radial;
          z = cluster.z + Math.sin(angle) * radial;
        } else {
          const angle = layoutRng.range(0, Math.PI * 2);
          const radial = Math.sqrt(layoutRng.next()) * s.patchRadius;
          x = Math.cos(angle) * radial;
          z = Math.sin(angle) * radial;
        }

        const radialDistance = Math.hypot(x, z);
        if (radialDistance > s.patchRadius) {
          const correction = s.patchRadius / Math.max(radialDistance, 1e-6);
          x *= correction;
          z *= correction;
        }

        const yaw = layoutRng.range(0, Math.PI * 2);
        const lean = layoutRng.range(-dna.variation.lean, dna.variation.lean);
        const rotation = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(lean, yaw, -lean * 0.55)
        );
        const heightScale = 1 + layoutRng.range(
          -s.heightVariance,
          s.heightVariance
        );
        const scale = new THREE.Vector3(
          layoutRng.range(0.78, 1.28),
          Math.max(0.35, heightScale),
          layoutRng.range(0.82, 1.18)
        );
        blades.setMatrixAt(
          i,
          matrixFrom(new THREE.Vector3(x, 0, z), rotation, scale)
        );
        const base = i % 5 === 0 ? colors.detail : colors.body;
        blades.setColorAt(
          i,
          varyColor(base, layoutRng.range(-1, 1), 0.065)
        );
      }
      blades.instanceMatrix.needsUpdate = true;
      if (blades.instanceColor) blades.instanceColor.needsUpdate = true;
      content.add(blades);

      const affordances = [
        {
          type: "forage",
          position: [0, s.bladeHeight * 0.35, 0],
          radius: s.patchRadius,
          capacity: Math.max(1, Math.round(s.patchRadius * 2)),
        },
        {
          type: "soft-cover",
          position: [0, s.bladeHeight * 0.5, 0],
          radius: s.patchRadius * 0.82,
          capacity: Math.max(1, Math.round(s.patchRadius)),
        },
      ];
      return { ...animated, affordances };
    },
  };
}

/**
 * Compile one normalized DNA object into immutable shared GPU resources plus
 * a role-specific instance factory.
 *
 * @param {object} dna
 * @param {Record<string, THREE.Color>} colors
 */
export function compileRoleRenderer(dna, colors) {
  const resources = makeResourceTracker();
  let renderer;
  switch (dna.role) {
    case "hero-mushroom":
      renderer = makeHeroRenderer(dna, colors, resources);
      break;
    case "mid-flower-cluster":
      renderer = makeFlowerRenderer(dna, colors, resources);
      break;
    case "groundcover":
      renderer = makeGroundcoverRenderer(dna, colors, resources);
      break;
    default:
      throw new Error(`unsupported generated-flora role: ${dna.role}`);
  }
  return {
    ...renderer,
    resourceCounts: resources.counts(),
    dispose: () => resources.dispose(),
  };
}
