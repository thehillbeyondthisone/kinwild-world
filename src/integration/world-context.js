import { Vector3 } from "three";
import { WATER_SURFACE_Y } from "../world-constants.js";

const DEFAULT_NORMAL_SAMPLE_DISTANCE = 0.15;

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function requireFiniteCoordinate(value, name) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number.`);
  }
}

/**
 * Read-only, live facade over the subset of Small World's mutable state that a
 * generated creature or flora implementation may observe.
 *
 * Coordinates are local to `state.world`, matching `state.heightFn`, creature
 * anchors, obstacles, and flora placement. The facade intentionally exposes no
 * mutation methods and no entropy source.
 */
export class WorldContext {
  #state;
  #waterSurfaceY;
  #normalSampleDistance;

  /**
   * Stable height-function callback for legacy update functions.
   *
   * The callback resolves `state.heightFn` on every invocation, so it remains
   * valid across world regeneration.
   *
   * @type {(x: number, z: number) => number}
   */
  heightFn;

  /**
   * @param {object} worldState Small World's state object (or a scoped state).
   * @param {object} [options]
   * @param {number} [options.waterSurfaceY=WATER_SURFACE_Y]
   * @param {number} [options.normalSampleDistance=0.15]
   */
  constructor(worldState, {
    waterSurfaceY = WATER_SURFACE_Y,
    normalSampleDistance = DEFAULT_NORMAL_SAMPLE_DISTANCE,
  } = {}) {
    if (!worldState || typeof worldState !== "object") {
      throw new TypeError("WorldContext requires a world-state object.");
    }
    if (typeof worldState.heightFn !== "function") {
      throw new TypeError("WorldContext state.heightFn must be a function.");
    }
    if (!Number.isFinite(waterSurfaceY)) {
      throw new TypeError("WorldContext waterSurfaceY must be finite.");
    }
    if (!Number.isFinite(normalSampleDistance) || normalSampleDistance <= 0) {
      throw new RangeError("WorldContext normalSampleDistance must be greater than zero.");
    }

    this.#state = worldState;
    this.#waterSurfaceY = waterSurfaceY;
    this.#normalSampleDistance = normalSampleDistance;
    this.heightFn = (x, z) => this.groundHeightAt(x, z);
    Object.freeze(this);
  }

  /** @returns {object|null} the current live biome descriptor. */
  get biome() {
    return this.#state.currentBiome ?? null;
  }

  /** @returns {number} current world seed, without applying another mask. */
  get seed() {
    return finiteNumber(this.#state.currentSeed);
  }

  /** @returns {number} current simulation time in seconds. */
  get time() {
    return finiteNumber(this.#state.lastSimT);
  }

  /** @returns {number} day/night blend factor in the inclusive 0..1 range. */
  get nightFactor() {
    return Math.min(1, Math.max(0, finiteNumber(this.#state.nightFactor)));
  }

  /**
   * The exact shared foliage-wind uniform object used by Small World.
   * Consumers may bind its uniforms into materials, but should not replace the
   * object or advance its time independently.
   *
   * @returns {object|null}
   */
  get windUniforms() {
    return this.#state.windUniforms ?? null;
  }

  /** @returns {number} shared foliage-wind time, falling back to sim time. */
  get windTime() {
    return finiteNumber(this.#state.windUniforms?.uTime?.value, this.time);
  }

  /** @returns {number} configured water-plane height in world-local units. */
  get waterSurfaceY() {
    return this.#waterSurfaceY;
  }

  /** @returns {object|null} current water mesh, if this biome has one. */
  get waterMesh() {
    return this.#state.waterMesh ?? null;
  }

  /** @returns {object|null} current terrain mesh. */
  get terrainMesh() {
    return this.#state.terrainMesh ?? null;
  }

  /**
   * @param {number} x
   * @param {number} z
   * @returns {number} terrain height, excluding any water plane.
   */
  groundHeightAt(x, z) {
    requireFiniteCoordinate(x, "x");
    requireFiniteCoordinate(z, "z");
    const heightFn = this.#state.heightFn;
    if (typeof heightFn !== "function") {
      throw new TypeError("WorldContext state.heightFn must remain a function.");
    }
    const height = heightFn(x, z);
    if (!Number.isFinite(height)) {
      throw new RangeError(`state.heightFn returned a non-finite height at (${x}, ${z}).`);
    }
    return height;
  }

  /**
   * Whether the visible surface at this XZ coordinate is the active water
   * plane rather than terrain.
   *
   * @param {number} x
   * @param {number} z
   * @param {number} [groundHeight] optional already-sampled terrain height.
  * @returns {boolean}
  */
  isWaterAt(x, z, groundHeight = this.groundHeightAt(x, z)) {
    requireFiniteCoordinate(x, "x");
    requireFiniteCoordinate(z, "z");
    requireFiniteCoordinate(groundHeight, "groundHeight");
    return Boolean(this.waterMesh) && groundHeight < this.#waterSurfaceY;
  }

  /**
   * @param {number} x
   * @param {number} z
   * @returns {number} top visible surface height (water or terrain).
   */
  surfaceHeightAt(x, z) {
    const groundHeight = this.groundHeightAt(x, z);
    return this.isWaterAt(x, z, groundHeight) ? this.#waterSurfaceY : groundHeight;
  }

  /**
   * Sample the top visible surface normal using deterministic central
   * differences. Water normals are flat; shader turbulence remains a purely
   * presentational displacement.
   *
   * @param {number} x
   * @param {number} z
   * @param {Vector3} [out]
   * @returns {Vector3}
   */
  surfaceNormalAt(x, z, out = new Vector3()) {
    const groundHeight = this.groundHeightAt(x, z);
    return this.#writeSurfaceNormal(x, z, groundHeight, out);
  }

  #writeSurfaceNormal(x, z, groundHeight, out) {
    if (!out || typeof out.set !== "function" || typeof out.normalize !== "function") {
      throw new TypeError("surfaceNormalAt out must be a Vector3-compatible object.");
    }
    if (this.isWaterAt(x, z, groundHeight)) return out.set(0, 1, 0);

    const d = this.#normalSampleDistance;
    const hXp = this.groundHeightAt(x + d, z);
    const hXm = this.groundHeightAt(x - d, z);
    const hZp = this.groundHeightAt(x, z + d);
    const hZm = this.groundHeightAt(x, z - d);
    return out.set(hXm - hXp, 2 * d, hZm - hZp).normalize();
  }

  /**
   * @param {number} x
   * @param {number} z
   * @returns {object|object[]|null} active Three.js material at the surface.
   */
  surfaceMaterialAt(x, z) {
    const groundHeight = this.groundHeightAt(x, z);
    return this.isWaterAt(x, z, groundHeight)
      ? (this.waterMesh?.material ?? null)
      : (this.terrainMesh?.material ?? null);
  }

  /**
   * Fill a reusable complete surface sample.
   *
   * @param {number} x
   * @param {number} z
   * @param {object} [out]
   * @param {Vector3} [out.normal]
   * @returns {{
   *   x: number,
   *   z: number,
   *   kind: "terrain"|"water",
   *   height: number,
   *   groundHeight: number,
   *   normal: Vector3,
   *   material: object|object[]|null,
   *   hasWater: boolean,
   *   waterDepth: number,
   *   waterSurfaceY: number,
   * }}
   */
  sampleSurface(x, z, out = {}) {
    const groundHeight = this.groundHeightAt(x, z);
    const hasWater = this.isWaterAt(x, z, groundHeight);
    const normal = out.normal ?? new Vector3();

    out.x = x;
    out.z = z;
    out.kind = hasWater ? "water" : "terrain";
    out.height = hasWater ? this.#waterSurfaceY : groundHeight;
    out.groundHeight = groundHeight;
    out.normal = this.#writeSurfaceNormal(x, z, groundHeight, normal);
    out.material = hasWater
      ? (this.waterMesh?.material ?? null)
      : (this.terrainMesh?.material ?? null);
    out.hasWater = hasWater;
    out.waterDepth = hasWater ? this.#waterSurfaceY - groundHeight : 0;
    out.waterSurfaceY = this.#waterSurfaceY;
    return out;
  }

  /**
   * Fill a reusable per-frame environment view for render/animation systems.
   * References (`biome`, `wind.uniforms`) remain live by design.
   *
   * @param {object} [out]
   * @returns {object}
   */
  readEnvironment(out = {}) {
    const settings = this.#state.userSettings ?? {};
    const wind = out.wind ?? {};
    wind.enabled = settings.windEnabled !== false;
    wind.foliageEnabled = settings.foliageWindEnabled !== false;
    wind.strength = finiteNumber(settings.windStrength, 1);
    wind.noiseScale = finiteNumber(settings.windNoiseScale, 1);
    wind.time = this.windTime;
    wind.uniforms = this.windUniforms;

    out.seed = this.seed;
    out.time = this.time;
    out.nightFactor = this.nightFactor;
    out.biome = this.biome;
    out.wind = wind;
    return out;
  }
}

/**
 * Functional constructor for callers that prefer factories over classes.
 *
 * @param {object} worldState
 * @param {object} [options]
 * @returns {WorldContext}
 */
export function createWorldContext(worldState, options) {
  return new WorldContext(worldState, options);
}
