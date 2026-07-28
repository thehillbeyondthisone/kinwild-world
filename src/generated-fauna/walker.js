import * as THREE from "three";
import {
  CURATED_WALKER_DNA,
  normalizeWalkerDNA,
  seededUnit,
} from "./dna.js";
import { LocalBlendShell } from "./shell.js";

const CONTRACT_VERSION = 1;
const EPSILON = 1e-6;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Make Small World's height function satisfy the generated-fauna surface
 * contract. Samples and returned coordinates are local to the walker's parent.
 *
 * @param {(x: number, z: number) => number} heightFn
 * @param {{
 *   normalStep?: number,
 *   materialAt?: ((x: number, z: number) => unknown)|unknown
 * }} [options]
 */
export function createHeightFunctionSurfaceSampler(heightFn, options = {}) {
  if (typeof heightFn !== "function") {
    throw new TypeError("heightFn must be a function");
  }
  const normalStep = positiveFinite(options.normalStep, 0.08);
  const materialAt = options.materialAt ?? "terrain";
  const normal = new THREE.Vector3();

  return Object.freeze({
    coordinateSpace: "root-parent-local",
    heightAt(x, z) {
      return finiteHeight(heightFn(x, z), x, z);
    },
    sample(x, z, out) {
      requireSampleOut(out);
      const height = finiteHeight(heightFn(x, z), x, z);
      const left = finiteHeight(heightFn(x - normalStep, z), x - normalStep, z);
      const right = finiteHeight(heightFn(x + normalStep, z), x + normalStep, z);
      const back = finiteHeight(heightFn(x, z - normalStep), x, z - normalStep);
      const front = finiteHeight(heightFn(x, z + normalStep), x, z + normalStep);
      normal
        .set(left - right, normalStep * 2, back - front)
        .normalize();
      out.height = height;
      copyVector(out.normal, normal, "surface sample normal");
      out.material =
        typeof materialAt === "function" ? materialAt(x, z) : materialAt;
      return out;
    },
  });
}

/** @param {number} [height] */
export function createFlatSurfaceSampler(
  height = 0,
  material = "ground",
) {
  const safeHeight = finiteHeight(height, 0, 0);
  return Object.freeze({
    coordinateSpace: "root-parent-local",
    heightAt() {
      return safeHeight;
    },
    sample(_x, _z, out) {
      requireSampleOut(out);
      out.height = safeHeight;
      out.normal.set(0, 1, 0);
      out.material = material;
      return out;
    },
  });
}

/**
 * Externally driven SDF-shell walker. The host owns planar movement by
 * supplying an intent position; this runtime only poses the actor and plants
 * its feet against the supplied surface.
 */
export class GeneratedFaunaWalker {
  /**
   * @param {{
   *   dna?: unknown,
   *   surface?: {sample: Function},
   *   intent?: object,
   *   position?: THREE.Vector3|{x: number, z: number},
   *   heading?: number,
   *   maxPrimitives?: number,
   *   maxInfluences?: number,
   *   quality?: "low"|"medium"|"high"
   * }} [options]
   */
  constructor(options = {}) {
    const normalized = normalizeWalkerDNA(
      options.dna ?? CURATED_WALKER_DNA,
      {
        maxPrimitives: options.maxPrimitives,
        maxInfluences: options.maxInfluences,
      },
    );
    this.dna = normalized.dna;
    this.repairs = Object.freeze([...normalized.repairs]);
    this.genomeHash = normalized.genomeHash;
    this.contractVersion = CONTRACT_VERSION;
    this._disposed = false;
    this._surface = options.surface ?? null;
    if (this._surface !== null) assertSurfaceSampler(this._surface);

    this.root = new THREE.Group();
    this.root.name = `generated-fauna:${this.dna.speciesId}`;
    this.group = this.root;
    this.root.userData.generatedFauna = {
      speciesId: this.dna.speciesId,
      genomeHash: this.genomeHash,
      schemaVersion: this.dna.schemaVersion,
    };

    const layout = makeLayout(this.dna);
    this._layout = layout;
    const qualityDetail =
      options.quality === "low"
        ? 0.65
        : options.quality === "high"
          ? 1.35
          : 1;
    const { specs, influences, wingBase } = makeShellDefinition(
      this.dna,
      layout,
      qualityDetail,
    );
    this._wingBase = wingBase;
    this._flier = this.dna.locomotion === "flier";
    this.shell = new LocalBlendShell(specs, {
      influences,
      localBounds: layout.localBounds,
      iterations: options.quality === "low" ? 1 : 2,
    });
    this.root.add(this.shell.mesh);

    const eyes = makeEyes(this.dna);
    this._eyes = eyes;
    this.root.add(eyes.root);
    this.eyeParts = eyes.parts;

    this._anchorsRoot = new THREE.Group();
    this._anchorsRoot.name = "generated-fauna-anchors";
    this._anchorsRoot.visible = false;
    this.root.add(this._anchorsRoot);
    this.anchors = makeAnchors(this._anchorsRoot, this.dna.legs.count);

    this._interactionGeometry = new THREE.SphereGeometry(1, 8, 6);
    this._interactionMaterial = new THREE.MeshBasicMaterial({
      visible: false,
    });
    this.interactionRoot = new THREE.Mesh(
      this._interactionGeometry,
      this._interactionMaterial,
    );
    this.interactionRoot.name = "generated-fauna-interaction-proxy";
    this.interactionRoot.visible = false;
    this.interactionRoot.position.copy(layout.localSphere.center);
    this.interactionRoot.scale.setScalar(layout.localSphere.radius);
    this.interactionRoot.userData.generatedFaunaInteractionProxy = true;
    this.root.add(this.interactionRoot);

    this.flies = this._flier;
    this.landState = "landed";
    // Height above the sampled surface. Zero is planted; the host raises it.
    this._hover = finiteNonNegativeOr(options.hover, 0);
    this._bank = 0;
    this.heading = finiteNumber(options.heading, 0);
    this._intent = {
      position: new THREE.Vector3(
        finiteNumber(options.position?.x, 0),
        0,
        finiteNumber(options.position?.z, 0),
      ),
      velocity: new THREE.Vector3(),
      heading: this.heading,
      lookTarget: null,
      action: "idle",
      hover: this._hover,
    };
    this._lookTarget = new THREE.Vector3();
    if (options.intent) this.setIntent(options.intent);

    this._phase = Object.freeze({
      breathe: seededUnit(this.dna.seed, "breathe") * Math.PI * 2,
      blink: seededUnit(this.dna.seed, "blink") * 5,
      gait: seededUnit(this.dna.seed, "gait") *
        this.dna.motion.stepDuration * 2,
      gazeX: seededUnit(this.dna.seed, "gaze-x") * Math.PI * 2,
      gazeY: seededUnit(this.dna.seed, "gaze-y") * Math.PI * 2,
    });
    this._feet = makeFeet(this.dna, layout);
    this._initialized = false;
    this._previousPosition = this._intent.position.clone();
    this._previousHeading = this.heading;
    this._noticeAmount = 0;
    this._footfalls = [];
    this._legacyFrame = {
      dt: 0,
      time: 0,
      surface: null,
      intent: null,
    };
    this._frameResult = {
      footfalls: this._footfalls,
      surfaceMaterial: null,
    };
    this._blinkPeriod =
      3.4 + seededUnit(this.dna.seed, "blink-period") * 2.2;
    this._surfaceHit = {
      height: 0,
      normal: new THREE.Vector3(0, 1, 0),
      material: null,
    };
    this._scratchHit = {
      height: 0,
      normal: new THREE.Vector3(0, 1, 0),
      material: null,
    };
    this._scratch = makeScratch();

    const actor = this;
    const traits = {};
    Object.defineProperties(traits, {
      speciesId: {
        enumerable: true,
        value: this.dna.speciesId,
      },
      genomeHash: {
        enumerable: true,
        value: this.genomeHash,
      },
      generated: {
        enumerable: true,
        value: true,
      },
      mode: {
        enumerable: true,
        value: this.dna.locomotion,
      },
      locomotion: {
        enumerable: true,
        value: this.dna.locomotion,
      },
      airborne: {
        enumerable: true,
        value: this._flier,
      },
      aquatic: {
        enumerable: true,
        value: false,
      },
      scale: {
        enumerable: true,
        get() {
          return maxScale(actor.root.scale);
        },
      },
      radius: {
        enumerable: true,
        get() {
          return layout.localSphere.radius * maxScale(actor.root.scale);
        },
      },
    });
    this.traits = Object.freeze(traits);

    this.debug = Object.freeze({
      phases: this._phase,
      primitiveSnapshot: () => this.shell.primitiveSnapshot(),
      feet: () =>
        this._feet.map((foot) => ({
          planted: foot.position.toArray(),
          target: foot.target.toArray(),
          stepping: foot.stepping,
          gaitGroup: foot.gaitGroup,
        })),
      resources: () => [
        ...this.shell.resources(),
        ...eyes.resources,
        this._interactionGeometry,
        this._interactionMaterial,
      ],
    });

    this._applyPose(0, 0, this._surface ?? null);
  }

  /**
   * Update only the externally owned command. No target seeking or planar
   * integration happens here.
   *
   * @param {{
   *   position?: THREE.Vector3|{x: number, z: number},
   *   velocity?: THREE.Vector3|{x: number, z: number},
   *   heading?: number,
   *   lookTarget?: THREE.Vector3|{x: number, y: number, z: number}|null,
   *   action?: string
   * }} intent
   */
  setIntent(intent) {
    this._requireAlive();
    if (!intent || typeof intent !== "object") {
      throw new TypeError("generated fauna intent must be an object");
    }
    if (intent.position !== undefined) {
      requirePlanar(intent.position, "intent.position");
      this._intent.position.x = intent.position.x;
      this._intent.position.z = intent.position.z;
    }
    if (intent.velocity !== undefined) {
      requirePlanar(intent.velocity, "intent.velocity");
      this._intent.velocity.x = intent.velocity.x;
      this._intent.velocity.z = intent.velocity.z;
    }
    if (intent.heading !== undefined) {
      if (!Number.isFinite(intent.heading)) {
        throw new TypeError("intent.heading must be finite");
      }
      this._intent.heading = intent.heading;
    } else if (
      intent.velocity !== undefined &&
      this._intent.velocity.lengthSq() > EPSILON
    ) {
      this._intent.heading = Math.atan2(
        this._intent.velocity.x,
        this._intent.velocity.z,
      );
    }
    if (intent.lookTarget !== undefined) {
      if (intent.lookTarget === null) {
        this._intent.lookTarget = null;
      } else {
        requireVector(intent.lookTarget, "intent.lookTarget");
        this._lookTarget.copy(intent.lookTarget);
        this._intent.lookTarget = this._lookTarget;
      }
    }
    if (intent.action !== undefined) {
      this._intent.action = String(intent.action).slice(0, 32);
    }
    if (intent.hover !== undefined) {
      if (!Number.isFinite(intent.hover) || intent.hover < 0) {
        throw new TypeError("intent.hover must be a non-negative finite number");
      }
      this._intent.hover = intent.hover;
    }
    return this;
  }

  /**
   * Supports the Small World agent signature `(dt, time, inputs)` and a
   * standalone object form `{dt, time, surface, intent}`.
   *
   * @returns {{footfalls: ReadonlyArray<object>, surfaceMaterial: unknown}}
   */
  update(dtOrFrame, timeValue, inputsValue) {
    this._requireAlive();
    let frame = dtOrFrame;
    if (!dtOrFrame || typeof dtOrFrame !== "object") {
      frame = this._legacyFrame;
      frame.dt = dtOrFrame;
      frame.time = timeValue;
      frame.surface = inputsValue?.surface;
      frame.intent = inputsValue?.intent;
    }
    const dt = finiteNonNegative(frame.dt, "update dt");
    const time = finiteNumberRequired(frame.time, "update time");
    if (frame.intent !== undefined) this.setIntent(frame.intent);
    const surface = frame.surface ?? this._surface;
    assertSurfaceSampler(surface);
    this._surface = surface;

    this._footfalls.length = 0;
    this._applyPose(dt, time, surface);
    this._frameResult.surfaceMaterial = this._surfaceHit.material;
    return this._frameResult;
  }

  /**
   * Write a named anchor in root-parent-local coordinates. Host-compatible
   * shorthand is `anchor(out)`; named form is `anchor("head", out, index)`.
   */
  anchor(nameOrOut, outOrName, maybeIndex = 0) {
    this._requireAlive();
    let name = "center";
    let out = nameOrOut;
    let index = maybeIndex;
    if (typeof nameOrOut === "string") {
      name = nameOrOut;
      out = outOrName;
    } else if (typeof outOrName === "string") {
      name = outOrName;
    } else if (Number.isInteger(outOrName)) {
      index = outOrName;
    }
    const anchorObject = this._anchorObject(name, index);
    if (!out || typeof out !== "object") {
      throw new TypeError("anchor out must be an object");
    }
    this.root.updateWorldMatrix(true, true);
    anchorObject.getWorldPosition(this._scratch.vectorA);
    if (this.root.parent) {
      this.root.parent.worldToLocal(this._scratch.vectorA);
    }
    return writeVector(out, this._scratch.vectorA);
  }

  /**
   * Host-contract bound: writes center in root-parent-local coordinates and
   * returns a conservative radius.
   */
  bounds(out) {
    this._requireAlive();
    if (!out || typeof out !== "object") {
      throw new TypeError("bounds out must be an object");
    }
    this.root.updateMatrix();
    this._scratch.vectorA
      .copy(this._layout.localSphere.center)
      .applyMatrix4(this.root.matrix);
    writeVector(out, this._scratch.vectorA);
    return this._layout.localSphere.radius * maxScale(this.root.scale);
  }

  /** Write a conservative world-space AABB. */
  worldBounds(out) {
    this._requireAlive();
    if (!out?.copy || !out?.applyMatrix4) {
      throw new TypeError("worldBounds out must be a THREE.Box3-like object");
    }
    this.root.updateWorldMatrix(true, false);
    return out
      .copy(this._layout.localBounds)
      .applyMatrix4(this.root.matrixWorld);
  }

  /** Write the CPU interaction sphere in root-parent-local coordinates. */
  interactionSphere(out) {
    this._requireAlive();
    if (!out?.center || !Number.isFinite(out.radius)) {
      throw new TypeError(
        "interactionSphere out must be a THREE.Sphere-like object",
      );
    }
    out.radius = this.bounds(out.center);
    return out;
  }

  /** Intersect a root-parent-local ray with the conservative CPU proxy. */
  intersectRay(ray, outPoint) {
    this._requireAlive();
    if (!ray?.intersectSphere) {
      throw new TypeError("intersectRay ray must be a THREE.Ray-like object");
    }
    this.interactionSphere(this._scratch.sphere);
    return ray.intersectSphere(this._scratch.sphere, outPoint);
  }

  dispose() {
    if (this._disposed) return false;
    this._disposed = true;
    this.root.removeFromParent();
    this.shell.dispose();
    disposeUnique(this._eyes.resources);
    this._interactionGeometry.dispose();
    this._interactionMaterial.dispose();
    this.root.clear();
    return true;
  }

  _requireAlive() {
    if (this._disposed) {
      throw new Error("generated fauna walker has been disposed");
    }
  }

  _anchorObject(name, index) {
    if (name === "foot" || name === "feet") {
      const foot = this.anchors.feet[index];
      if (!foot) throw new RangeError(`unknown foot anchor ${index}`);
      return foot;
    }
    const result = this.anchors[name];
    if (!result || Array.isArray(result)) {
      throw new RangeError(`unknown generated fauna anchor "${name}"`);
    }
    return result;
  }

  _applyPose(dt, time, surface) {
    const scratch = this._scratch;
    const targetPosition = this._intent.position;
    const movedDistance = this._previousPosition.distanceTo(targetPosition);
    const planarScale = Math.max(
      Math.abs(this.root.scale.x),
      Math.abs(this.root.scale.z),
      EPSILON,
    );
    const teleported =
      this._initialized &&
      movedDistance >
        Math.max(
          0.75 * planarScale,
          this.dna.legs.length * 1.7 * planarScale,
        );

    // Airborne is a blend, not a switch: it drives how much the body ignores
    // the ground's tilt, how far the legs tuck, and how hard the wings beat,
    // so a landing eases through all three at once instead of snapping.
    const hoverTarget = this._flier ? this._intent.hover : 0;
    this._hover += (hoverTarget - this._hover) * (1 - Math.exp(-dt * 4.5));
    if (dt <= EPSILON) this._hover = hoverTarget;
    const airborne = this._flier
      ? THREE.MathUtils.smoothstep(this._hover, 0.05, 0.55)
      : 0;

    if (surface) {
      sampleSurface(surface, targetPosition.x, targetPosition.z, this._surfaceHit);
      this.root.position.set(
        targetPosition.x,
        this._surfaceHit.height + this._hover,
        targetPosition.z,
      );
      this.heading = this._intent.heading;
      // In the air the body stops caring about the slope beneath it.
      scratch.normal
        .copy(this._surfaceHit.normal)
        .lerp(Y_AXIS, airborne)
        .normalize();
      orientRoot(this.root, this.heading, scratch.normal, scratch);
    } else {
      this.root.position.set(targetPosition.x, this._hover, targetPosition.z);
      this.heading = this._intent.heading;
      this.root.rotation.set(0, this.heading, 0);
    }

    // Bank into the turn. Reading it off the heading the host already
    // committed to keeps the roll consistent with the path actually flown.
    if (this._flier) {
      const turn =
        dt > EPSILON
          ? shortAngle(this.heading - this._previousHeading) / dt
          : 0;
      const bankTarget = THREE.MathUtils.clamp(turn * 0.38, -0.6, 0.6) * airborne;
      this._bank += (bankTarget - this._bank) * (1 - Math.exp(-dt * 6));
      if (Math.abs(this._bank) > 1e-4) {
        this.root.quaternion.multiply(
          scratch.bankRoll.setFromAxisAngle(
            scratch.bankAxis.set(0, 0, 1),
            -this._bank,
          ),
        );
      }
    }

    const inferredSpeed =
      dt > EPSILON ? Math.min(4, movedDistance / dt) : 0;
    const commandSpeed = this._intent.velocity.length();
    const speed = Math.max(inferredSpeed, commandSpeed);
    const moveStrength = THREE.MathUtils.smoothstep(speed, 0.02, 0.7);
    const breathe =
      Math.sin(time * 2.35 + this._phase.breathe) * 0.006;
    const gaitWave =
      Math.sin(
        ((time + this._phase.gait) /
          Math.max(this.dna.motion.stepDuration * 2, 0.01)) *
          Math.PI *
          2,
      );
    const bob = gaitWave * this.dna.motion.bob * moveStrength;
    const noticeTarget = this._intent.action === "notice" ? 1 : 0;
    const noticeBlend = 1 - Math.exp(-dt * 8);
    this._noticeAmount +=
      (noticeTarget - this._noticeAmount) * noticeBlend;
    const bodyY =
      this._layout.bodyY +
      breathe +
      bob +
      this._noticeAmount * 0.04;

    const body = this.shell.primitives[0];
    body.position.set(0, bodyY, 0);
    body.quaternion.setFromAxisAngle(scratch.vectorA.set(1, 0, 0), Math.PI / 2);
    body.scale.set(
      1 + breathe * 1.8,
      1 - breathe * 1.2,
      1 + breathe * 1.8,
    );

    const head = this.shell.primitives[1];
    head.position
      .set(...this.dna.head.offset)
      .add(body.position);
    head.position.y += this._noticeAmount * 0.035;
    head.position.z += this._noticeAmount * 0.055;
    head.quaternion.identity();
    head.scale.setScalar(1 + breathe * 1.1);

    if (surface && airborne < 0.999) {
      this._updateFeet(
        dt,
        time,
        surface,
        teleported || !this._initialized,
        speed,
      );
    } else {
      this._poseFeetAtLocalHomes();
    }
    if (airborne > 0.001) this._tuckFeet(bodyY, airborne);
    this._solveLegs(bodyY);
    if (this._wingBase >= 0) this._poseWings(time, bodyY, airborne, speed);
    this._updateFace(time, head.position);
    this._updateAnchors(bodyY, head.position);
    this.shell.sync();

    this._previousPosition.copy(targetPosition);
    this._previousHeading = this.heading;
    this._initialized = this._initialized || Boolean(surface);
  }

  /**
   * Draw the feet up under the body as the creature leaves the ground.
   *
   * The feet are tracked in world space, so the tuck is applied there too:
   * lift toward the body's height and pull in toward its centre line, which
   * the existing two-bone solver then folds the legs to reach.
   */
  _tuckFeet(bodyY, amount) {
    const scale = this.root.scale;
    for (const foot of this._feet) {
      this._scratch.footLocal
        .set(foot.homeX * 0.45, bodyY * 0.62, foot.homeZ * 0.5)
        .multiply(scale)
        .applyQuaternion(this.root.quaternion)
        .add(this.root.position);
      foot.position.lerp(this._scratch.footLocal, amount);
      foot.target.copy(foot.position);
    }
  }

  /**
   * Beat the wings, folding them against the body when landed.
   *
   * A wing is one capsule from shoulder to tip, so the beat is just where the
   * tip is: swept up and down around the body's forward axis, with a little
   * rearward sweep so the silhouette reads as a wing rather than a paddle.
   */
  _poseWings(time, bodyY, airborne, speed) {
    const wings = this.dna.wings;
    const scratch = this._scratch;
    const restLength = wings.span * 0.5;
    // Folded wings still shiver a little; a hovering one beats fully.
    const amplitude = 0.12 + airborne * 0.95;
    const beat = Math.sin(time * wings.beat * Math.PI * 2) * amplitude;
    const sweep = -0.12 - airborne * 0.1 - Math.min(speed, 1.2) * 0.08;
    for (let index = 0; index < 2; index++) {
      const side = index === 0 ? 1 : -1;
      const angle = wings.dihedral * (0.35 + airborne * 0.65) + beat;
      scratch.wingStart.set(
        side * this.dna.body.radius * 0.72,
        bodyY + this.dna.body.radius * 0.22,
        this.dna.body.halfLength * 0.08,
      );
      scratch.wingEnd
        .set(side * Math.cos(angle), Math.sin(angle), sweep)
        .normalize()
        .multiplyScalar(wings.span)
        .add(scratch.wingStart);
      placeCapsule(
        this.shell.primitives[this._wingBase + index],
        scratch.wingStart,
        scratch.wingEnd,
        restLength,
        scratch,
      );
    }
  }

  _poseFeetAtLocalHomes() {
    for (const foot of this._feet) {
      foot.position
        .set(foot.homeX, 0, foot.homeZ)
        .multiply(this.root.scale)
        .applyQuaternion(this.root.quaternion)
        .add(this.root.position);
      foot.target.copy(foot.position);
    }
  }

  _updateFeet(dt, time, surface, reset, speed) {
    const scratch = this._scratch;
    const stepDuration = this.dna.motion.stepDuration;
    const planarScale = Math.max(
      Math.abs(this.root.scale.x),
      Math.abs(this.root.scale.z),
      EPSILON,
    );
    const liftScale = Math.max(Math.abs(this.root.scale.y), EPSILON);
    const gaitCycle =
      positiveModulo(time + this._phase.gait, stepDuration * 2) /
      stepDuration;
    const leadTime = Math.min(0.22, stepDuration * 0.7);

    for (let index = 0; index < this._feet.length; index++) {
      const foot = this._feet[index];
      scratch.vectorA
        .set(foot.homeX, 0, foot.homeZ)
        .multiply(this.root.scale)
        .applyQuaternion(this.root.quaternion)
        .add(this.root.position);
      scratch.vectorA.addScaledVector(this._intent.velocity, leadTime);
      sampleSurfaceHeight(
        surface,
        scratch.vectorA.x,
        scratch.vectorA.z,
        this._scratchHit,
      );
      scratch.vectorA.y = this._scratchHit.height;
      foot.home.copy(scratch.vectorA);

      if (reset) {
        foot.position.copy(foot.home);
        foot.start.copy(foot.home);
        foot.target.copy(foot.home);
        foot.progress = 1;
        foot.stepping = false;
        continue;
      }

      if (!foot.stepping) {
        const deltaX = foot.home.x - foot.position.x;
        const deltaZ = foot.home.z - foot.position.z;
        const distance = Math.hypot(deltaX, deltaZ);
        const groupAllowed =
          foot.gaitGroup === 0 ? gaitCycle < 1 : gaitCycle >= 1;
        const headingChanged =
          Math.abs(shortAngle(this.heading - this._previousHeading)) > 0.035;
        if (
          groupAllowed &&
          distance >
            this.dna.motion.stepTrigger *
              planarScale *
              (headingChanged ? 0.72 : 1)
        ) {
          foot.stepping = true;
          foot.progress = 0;
          foot.start.copy(foot.position);
          foot.target.copy(foot.home);
        }
      }

      if (foot.stepping) {
        foot.progress = Math.min(1, foot.progress + dt / stepDuration);
        const blend =
          foot.progress *
          foot.progress *
          (3 - 2 * foot.progress);
        foot.position.lerpVectors(foot.start, foot.target, blend);
        sampleSurfaceHeight(
          surface,
          foot.position.x,
          foot.position.z,
          this._scratchHit,
        );
        const speedLift = 0.72 + Math.min(0.38, speed * 0.2);
        foot.position.y =
          this._scratchHit.height +
          Math.sin(foot.progress * Math.PI) *
            this.dna.motion.lift *
            foot.liftScale *
            speedLift *
            liftScale;
        if (foot.progress >= 1) {
          foot.stepping = false;
          foot.position.copy(foot.target);
          sampleSurface(
            surface,
            foot.position.x,
            foot.position.z,
            this._scratchHit,
          );
          foot.position.y = this._scratchHit.height;
          this._footfalls.push({
            foot: index,
            position: foot.position.clone(),
            material: this._scratchHit.material,
          });
        }
      } else {
        sampleSurfaceHeight(
          surface,
          foot.position.x,
          foot.position.z,
          this._scratchHit,
        );
        foot.position.y = this._scratchHit.height;
      }
    }
  }

  _solveLegs(bodyY) {
    const scratch = this._scratch;
    const segmentLength = this.dna.legs.length * 0.5;
    for (let index = 0; index < this._feet.length; index++) {
      const foot = this._feet[index];
      const primitiveIndex = 2 + index * 2;
      scratch.hip.set(foot.hipX, bodyY + foot.hipY, foot.hipZ);
      parentToActor(this.root, foot.position, scratch.footLocal, scratch);
      scratch.bend
        .set(
          Math.sign(foot.homeX) * 0.38,
          -0.08,
          foot.homeZ >= 0 ? 0.92 : -0.92,
        )
        .normalize();
      solveTwoBone(
        scratch.hip,
        scratch.footLocal,
        segmentLength,
        segmentLength,
        scratch.bend,
        scratch.knee,
        scratch,
      );
      placeCapsule(
        this.shell.primitives[primitiveIndex],
        scratch.hip,
        scratch.knee,
        segmentLength,
        scratch,
      );
      placeCapsule(
        this.shell.primitives[primitiveIndex + 1],
        scratch.knee,
        scratch.footLocal,
        segmentLength,
        scratch,
      );
    }
  }

  _updateFace(time, headPosition) {
    this._eyes.root.position.copy(headPosition);
    const target = this._intent.lookTarget;
    let lookX;
    let lookY;
    if (target) {
      parentToActor(this.root, target, this._scratch.vectorA, this._scratch);
      this._scratch.vectorA.sub(headPosition);
      const safeZ = Math.max(0.18, Math.abs(this._scratch.vectorA.z));
      lookX = THREE.MathUtils.clamp(
        this._scratch.vectorA.x / safeZ,
        -1,
        1,
      );
      lookY = THREE.MathUtils.clamp(
        this._scratch.vectorA.y / safeZ,
        -0.8,
        0.8,
      );
    } else {
      lookX = Math.sin(time * 0.57 + this._phase.gazeX) * 0.34;
      lookY = Math.sin(time * 0.43 + this._phase.gazeY) * 0.2;
    }
    const blinkTime = positiveModulo(
      time + this._phase.blink,
      this._blinkPeriod,
    );
    const blink =
      blinkTime < 0.13
        ? Math.max(0.06, Math.abs(blinkTime / 0.065 - 1))
        : 1;
    this._eyes.setExpression(lookX, lookY, blink);
  }

  _updateAnchors(bodyY, headPosition) {
    this.anchors.center.position.set(0, bodyY, 0);
    this.anchors.head.position.copy(headPosition);
    this.anchors.eyes.position
      .copy(headPosition)
      .add(this._eyes.eyeCenter);
    this.anchors.mouth.position
      .copy(headPosition)
      .add(this._layout.mouthOffset);
    this.anchors.tail.position.set(
      0,
      bodyY,
      -this.dna.body.halfLength - this.dna.body.radius * 0.78,
    );
    for (let index = 0; index < this._feet.length; index++) {
      parentToActor(
        this.root,
        this._feet[index].position,
        this.anchors.feet[index].position,
        this._scratch,
      );
    }
  }
}

/** @returns {GeneratedFaunaWalker} */
export function createGeneratedFaunaWalker(options = {}) {
  return new GeneratedFaunaWalker(options);
}

function makeLayout(dna) {
  const bodyY = dna.legs.length * 0.9 + dna.body.radius * 0.22;
  const pairCount = dna.legs.count / 2;
  const rowExtent = dna.body.halfLength + dna.body.radius * 0.42;
  const rows = [];
  for (let row = 0; row < pairCount; row++) {
    rows.push(
      pairCount === 1
        ? 0
        : THREE.MathUtils.lerp(
            rowExtent,
            -rowExtent,
            row / (pairCount - 1),
          ),
    );
  }

  const wings = dna.wings ?? null;
  const xExtent =
    Math.max(
      dna.legs.spread,
      dna.body.radius,
      wings ? dna.body.radius * 0.72 + wings.span + wings.chord : 0,
    ) +
    dna.legs.thickness +
    0.08;
  const headCenterY = bodyY + dna.head.offset[1];
  const headCenterZ = dna.head.offset[2];
  const zExtent = Math.max(
    rowExtent + dna.legs.thickness + 0.08,
    dna.body.halfLength + dna.body.radius + 0.08,
    headCenterZ + dna.head.radius + 0.08,
  );
  // The upstroke lifts a wing tip above the head, so the shell's local bounds
  // have to allow for it or the blend field is evaluated in too small a box.
  const wingTop = wings ? bodyY + wings.span * 0.92 + wings.chord : 0;
  const localBounds = new THREE.Box3(
    new THREE.Vector3(-xExtent, -0.1, -zExtent),
    new THREE.Vector3(
      xExtent,
      Math.max(headCenterY + dna.head.radius + 0.08, wingTop),
      zExtent,
    ),
  );
  const localSphere = localBounds.getBoundingSphere(new THREE.Sphere());
  return {
    bodyY,
    rows,
    wings,
    localBounds,
    localSphere,
    mouthOffset: new THREE.Vector3(
      0,
      -dna.head.radius * 0.2,
      dna.head.radius * 0.92,
    ),
  };
}

function makeShellDefinition(dna, layout, detail) {
  const segmentLength = dna.legs.length * 0.5;
  const specs = [
    {
      type: "capsule",
      radius: dna.body.radius,
      halfLength: dna.body.halfLength,
      color: dna.palette.body,
      blend: Math.min(0.13, dna.body.radius * 0.34),
      detail,
    },
    {
      type: "sphere",
      radius: dna.head.radius,
      color: dna.palette.head,
      blend: Math.min(0.11, dna.head.radius * 0.42),
      detail: detail * 1.15,
    },
  ];
  for (let index = 0; index < dna.legs.count; index++) {
    specs.push(
      {
        type: "capsule",
        radius: dna.legs.thickness,
        halfLength: segmentLength * 0.5,
        color: dna.palette.limb,
        blend: Math.min(0.055, dna.legs.thickness * 0.72),
        detail: detail * 0.75,
      },
      {
        type: "capsule",
        radius: dna.legs.thickness * 0.9,
        halfLength: segmentLength * 0.5,
        color: dna.palette.limb,
        blend: Math.min(0.05, dna.legs.thickness * 0.65),
        detail: detail * 0.75,
      },
    );
  }

  const wingBase = specs.length;
  if (dna.wings) {
    for (let index = 0; index < 2; index++) {
      specs.push({
        type: "capsule",
        radius: dna.wings.chord,
        halfLength: dna.wings.span * 0.5,
        color: dna.palette.limb,
        blend: Math.min(0.09, dna.wings.chord * 0.8),
        detail: detail * 0.9,
      });
    }
  }

  const upperIndices = Array.from(
    { length: dna.legs.count },
    (_, index) => 2 + index * 2,
  );
  const wingIndices = dna.wings ? [wingBase, wingBase + 1] : [];
  const influences = [[1, ...upperIndices, ...wingIndices], [0]];
  for (let index = 0; index < dna.legs.count; index++) {
    const upper = 2 + index * 2;
    const lower = upper + 1;
    influences.push([0, lower], [upper]);
  }
  // A wing blends only into the body, so a beat never drags a leg with it.
  for (let index = 0; index < wingIndices.length; index++) influences.push([0]);
  return { specs, influences, wingBase: dna.wings ? wingBase : -1 };
}

function makeFeet(dna, layout) {
  const feet = [];
  for (let row = 0; row < layout.rows.length; row++) {
    for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
      const side = sideIndex === 0 ? -1 : 1;
      const index = feet.length;
      feet.push({
        homeX: side * dna.legs.spread,
        homeZ: layout.rows[row],
        hipX: side * dna.body.radius * 0.68,
        hipY: -dna.body.radius * 0.46,
        hipZ: layout.rows[row] * 0.68,
        gaitGroup: (row + sideIndex) % 2,
        liftScale: 0.9 + seededUnit(dna.seed, `foot-${index}`) * 0.2,
        home: new THREE.Vector3(),
        position: new THREE.Vector3(),
        start: new THREE.Vector3(),
        target: new THREE.Vector3(),
        stepping: false,
        progress: 1,
      });
    }
  }
  return feet;
}

function makeEyes(dna) {
  const root = new THREE.Group();
  root.name = "generated-fauna-face";
  const eyeGeometry = new THREE.SphereGeometry(dna.head.eyeRadius, 12, 8);
  const pupilGeometry = new THREE.SphereGeometry(
    dna.head.eyeRadius * 0.43,
    10,
    7,
  );
  const eyeMaterial = new THREE.MeshToonMaterial({
    color: dna.palette.eye,
  });
  const pupilMaterial = new THREE.MeshToonMaterial({
    color: dna.palette.pupil,
  });
  const parts = [];
  const pupils = [];
  const eyes = [];
  const eyeCenter = new THREE.Vector3(
    0,
    dna.head.radius * 0.08,
    dna.head.radius * 0.79,
  );
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    eye.name = "generated-fauna-eye";
    eye.position.set(
      side * dna.head.radius * 0.45,
      eyeCenter.y,
      eyeCenter.z,
    );
    root.add(eye);
    const pupil = new THREE.Mesh(pupilGeometry, pupilMaterial);
    pupil.name = "generated-fauna-pupil";
    pupil.position.set(
      eye.position.x,
      eye.position.y,
      dna.head.radius * 0.96,
    );
    root.add(pupil);
    eyes.push(eye);
    pupils.push(pupil);
    parts.push(eye, pupil);
  }
  return {
    root,
    parts,
    eyeCenter,
    resources: [
      eyeGeometry,
      pupilGeometry,
      eyeMaterial,
      pupilMaterial,
    ],
    setExpression(lookX, lookY, blink) {
      const pupilShift = dna.head.eyeRadius * 0.48;
      for (let index = 0; index < eyes.length; index++) {
        eyes[index].scale.set(1, blink, 1);
        pupils[index].scale.set(1, blink, 1);
        pupils[index].position.x =
          eyes[index].position.x + lookX * pupilShift;
        pupils[index].position.y =
          eyes[index].position.y + lookY * pupilShift;
      }
    },
  };
}

function makeAnchors(parent, footCount) {
  const anchors = {
    center: makeAnchor("center", parent),
    head: makeAnchor("head", parent),
    eyes: makeAnchor("eyes", parent),
    mouth: makeAnchor("mouth", parent),
    tail: makeAnchor("tail", parent),
    feet: [],
  };
  for (let index = 0; index < footCount; index++) {
    anchors.feet.push(makeAnchor(`foot-${index}`, parent));
  }
  return Object.freeze(anchors);
}

function makeAnchor(name, parent) {
  const anchor = new THREE.Object3D();
  anchor.name = `generated-fauna-anchor:${name}`;
  parent.add(anchor);
  return anchor;
}

function makeScratch() {
  return {
    vectorA: new THREE.Vector3(),
    vectorB: new THREE.Vector3(),
    vectorC: new THREE.Vector3(),
    hip: new THREE.Vector3(),
    footLocal: new THREE.Vector3(),
    knee: new THREE.Vector3(),
    bend: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    // orientRoot consumes vectorA/B/C, so the blended normal and the bank
    // roll need scratch of their own.
    normal: new THREE.Vector3(),
    bankAxis: new THREE.Vector3(),
    bankRoll: new THREE.Quaternion(),
    wingStart: new THREE.Vector3(),
    wingEnd: new THREE.Vector3(),
    matrix: new THREE.Matrix4(),
    sphere: new THREE.Sphere(),
  };
}

function orientRoot(root, heading, normal, scratch) {
  const forward = scratch.vectorA.set(
    Math.sin(heading),
    0,
    Math.cos(heading),
  );
  forward.addScaledVector(normal, -forward.dot(normal));
  if (forward.lengthSq() < EPSILON) {
    forward.set(0, 0, 1);
    forward.addScaledVector(normal, -forward.dot(normal));
  }
  forward.normalize();
  const right = scratch.vectorB.crossVectors(normal, forward).normalize();
  const correctedForward = scratch.vectorC
    .crossVectors(right, normal)
    .normalize();
  scratch.matrix.makeBasis(right, normal, correctedForward);
  root.quaternion.setFromRotationMatrix(scratch.matrix).normalize();
}

function parentToActor(root, parentPoint, out, scratch) {
  out.copy(parentPoint).sub(root.position);
  scratch.quaternion.copy(root.quaternion).invert();
  out.applyQuaternion(scratch.quaternion);
  out.x /= safeScale(root.scale.x);
  out.y /= safeScale(root.scale.y);
  out.z /= safeScale(root.scale.z);
  return out;
}

function solveTwoBone(
  hip,
  foot,
  upperLength,
  lowerLength,
  bendDirection,
  out,
  scratch,
) {
  const axis = scratch.vectorA.subVectors(foot, hip);
  const distance = THREE.MathUtils.clamp(
    axis.length(),
    Math.abs(upperLength - lowerLength) + 0.0001,
    upperLength + lowerLength - 0.0001,
  );
  axis.normalize();
  const along =
    (upperLength * upperLength -
      lowerLength * lowerLength +
      distance * distance) /
    (2 * distance);
  const height = Math.sqrt(
    Math.max(0, upperLength * upperLength - along * along),
  );
  const bend = scratch.vectorB.copy(bendDirection);
  bend.addScaledVector(axis, -bend.dot(axis));
  if (bend.lengthSq() < EPSILON) {
    bend.crossVectors(axis, Y_AXIS);
    if (bend.lengthSq() < EPSILON) bend.set(1, 0, 0);
  }
  bend.normalize();
  return out
    .copy(hip)
    .addScaledVector(axis, along)
    .addScaledVector(bend, height);
}

function placeCapsule(primitive, start, end, restLength, scratch) {
  scratch.vectorA.subVectors(end, start);
  const length = Math.max(0.001, scratch.vectorA.length());
  primitive.position.copy(start).add(end).multiplyScalar(0.5);
  primitive.quaternion.setFromUnitVectors(
    Y_AXIS,
    scratch.vectorA.multiplyScalar(1 / length),
  );
  primitive.scale.set(1, length / restLength, 1);
}

function sampleSurface(surface, x, z, out) {
  const result = surface.sample(x, z, out) ?? out;
  if (!result || !Number.isFinite(result.height)) {
    throw new RangeError(
      `surface sampler returned an invalid height at (${x}, ${z})`,
    );
  }
  if (
    !result.normal ||
    !Number.isFinite(result.normal.x) ||
    !Number.isFinite(result.normal.y) ||
    !Number.isFinite(result.normal.z)
  ) {
    throw new RangeError(
      `surface sampler returned an invalid normal at (${x}, ${z})`,
    );
  }
  out.height = result.height;
  copyVector(out.normal, result.normal, "surface normal");
  if (out.normal.lengthSq() < EPSILON) {
    throw new RangeError("surface sampler normal must be non-zero");
  }
  out.normal.normalize();
  out.material = result.material ?? null;
  return out;
}

function sampleSurfaceHeight(surface, x, z, out) {
  if (typeof surface.heightAt !== "function") {
    return sampleSurface(surface, x, z, out);
  }
  out.height = finiteHeight(surface.heightAt(x, z), x, z);
  return out;
}

function assertSurfaceSampler(surface) {
  if (!surface || typeof surface.sample !== "function") {
    throw new TypeError(
      "generated fauna update requires an explicit surface sampler",
    );
  }
  return surface;
}

function requireSampleOut(out) {
  if (!out || typeof out !== "object" || !out.normal?.set) {
    throw new TypeError(
      "surface sample out must contain a mutable normal vector",
    );
  }
}

function copyVector(out, source, label) {
  if (!out || typeof out.copy !== "function") {
    throw new TypeError(`${label} must support copy()`);
  }
  return out.copy(source);
}

function writeVector(out, source) {
  if (typeof out.copy === "function") return out.copy(source);
  if (typeof out.set === "function") {
    out.set(source.x, source.y, source.z);
    return out;
  }
  out.x = source.x;
  out.y = source.y;
  out.z = source.z;
  return out;
}

function requirePlanar(value, label) {
  if (
    !value ||
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.z)
  ) {
    throw new TypeError(`${label} must contain finite x/z values`);
  }
}

function requireVector(value, label) {
  if (
    !value ||
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.y) ||
    !Number.isFinite(value.z)
  ) {
    throw new TypeError(`${label} must contain finite x/y/z values`);
  }
}

function finiteHeight(value, x, z) {
  if (!Number.isFinite(value)) {
    throw new RangeError(`terrain height must be finite at (${x}, ${z})`);
  }
  return value;
}

function finiteNonNegativeOr(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function finiteNonNegative(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative finite number`);
  }
  return value;
}

function finiteNumberRequired(value, label) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite`);
  }
  return value;
}

function finiteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function positiveFinite(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function safeScale(value) {
  return Math.abs(value) > EPSILON ? value : EPSILON;
}

function maxScale(scale) {
  return Math.max(
    Math.abs(scale.x),
    Math.abs(scale.y),
    Math.abs(scale.z),
  );
}

function positiveModulo(value, modulus) {
  return ((value % modulus) + modulus) % modulus;
}

function shortAngle(value) {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function disposeUnique(resources) {
  const unique = new Set(resources);
  for (const resource of unique) resource.dispose();
}
