import * as THREE from "three";
import { state } from "../state.js";
import { BLOOM_LAYER } from "../postfx.js";
import { lowfxScale as _lowfxScale } from "./_shared.js";

// ─── particles ───
const PARTICLE_KIND_ID = {
  pollen: 0, dust: 1, snow: 2, firefly: 3, ember: 4,
  lichenmote: 5, feather: 6, bubble: 7, leaf: 8, spark: 9, rain: 10,
  sand: 11, cinder: 12,
};

// Pre-filter+flatten the lavafissure obstacles once per particle-system build
// (instead of re-scanning + re-deriving `radius` from every obstacle for
// every cinder particle every frame) and compare squared distances so the
// common "well outside every fissure" case skips the sqrt entirely.
function _buildCinderFissureObstacles() {
  const out = [];
  for (const obstacle of state.obstacles) {
    if (obstacle.kind !== "lavafissure") continue;
    const radius = Math.max(0.35, (obstacle.r ?? 0.24) * 3.8);
    out.push({ x: obstacle.x, z: obstacle.z, radius, radius2: radius * radius });
  }
  return out;
}

function cinderFissureLiftAt(fissureObstacles, x, z) {
  let lift = 0;
  for (const obstacle of fissureObstacles) {
    const dx = x - obstacle.x;
    const dz = z - obstacle.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= obstacle.radius2) continue;
    const influence = 1 - Math.sqrt(d2) / obstacle.radius;
    lift = Math.max(lift, influence * influence * (3 - 2 * influence));
  }
  return lift;
}

// Coarse bilinear-sampled height lookup for particle ground clamping — sand
// and cinder particles used to call the full three-octave heightFn directly
// (~10k noise evals/frame combined). Particles are fuzzy points, so a coarse
// grid sampled once per particle-system build is visually indistinguishable.
const PARTICLE_HEIGHT_GRID_RES = 64;

function _buildParticleHeightGrid(heightFn, radius) {
  if (!heightFn) return null;
  const res = PARTICLE_HEIGHT_GRID_RES;
  // Covers a bit past the widest particle-wrap bound (ISLAND_RADIUS * ~1.15)
  // so in-bounds samples never fall back to clamped edge values.
  const half = radius * 1.3;
  const heights = new Float32Array(res * res);
  for (let iz = 0; iz < res; iz++) {
    const z = (iz / (res - 1) - 0.5) * half * 2;
    for (let ix = 0; ix < res; ix++) {
      const x = (ix / (res - 1) - 0.5) * half * 2;
      heights[iz * res + ix] = heightFn(x, z);
    }
  }
  return { heights, res, half };
}

function _sampleParticleHeightGrid(grid, x, z) {
  if (!grid) return 0;
  const { heights, res, half } = grid;
  const size = half * 2;
  let u = ((x + half) / size) * (res - 1);
  let v = ((z + half) / size) * (res - 1);
  u = Math.max(0, Math.min(res - 1, u));
  v = Math.max(0, Math.min(res - 1, v));
  const x0 = Math.floor(u), x1 = Math.min(res - 1, x0 + 1);
  const z0 = Math.floor(v), z1 = Math.min(res - 1, z0 + 1);
  const fx = u - x0, fz = v - z0;
  const h00 = heights[z0 * res + x0];
  const h10 = heights[z0 * res + x1];
  const h01 = heights[z1 * res + x0];
  const h11 = heights[z1 * res + x1];
  const h0 = h00 + (h10 - h00) * fx;
  const h1 = h01 + (h11 - h01) * fx;
  return h0 + (h1 - h0) * fz;
}

const _particleVS = `
attribute float aSeed;
attribute float aLife;
varying float vLife;
varying float vSeed;
uniform float uTime;
uniform float uPixelRatio;
uniform float uBaseSize;
void main() {
  vLife = aLife;
  vSeed = aSeed;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float size = uBaseSize;
  #if PARTICLE_KIND == 11
    size *= (0.80 + 1.80 * fract(aSeed * 11.317)) * (0.82 + 0.18 * sin(aLife * 6.2831));
  #elif PARTICLE_KIND == 12
    size *= (0.45 + 1.35 * fract(aSeed * 17.173)) * (1.0 - aLife * 0.7);
  #elif PARTICLE_KIND == 4 || PARTICLE_KIND == 9
    size *= 1.0 - aLife * 0.7;
  #elif PARTICLE_KIND == 2
    size *= 0.7 + 0.3 * fract(aSeed);
  #endif
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * uPixelRatio * (300.0 / max(0.001, -mv.z));
}
`;

const _particleFS = `
precision highp float;
uniform vec3 uColor;
uniform vec3 uColor2;
uniform float uOpacity;
uniform float uTime;
varying float vLife;
varying float vSeed;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  #if PARTICLE_KIND == 10
    float a = smoothstep(0.5, 0.0, abs(c.x) * 2.0) * smoothstep(0.5, 0.0, abs(c.y));
  #elif PARTICLE_KIND == 11
    // broader low dune streaks: wide along wind, narrow vertically
    float a = smoothstep(0.5, 0.0, abs(c.x)) * smoothstep(0.5, 0.0, abs(c.y) * 2.0);
    a *= 0.72 + 0.28 * sin(vLife * 6.2831 + vSeed);
  #elif PARTICLE_KIND == 12
    // horizontal streak — stretched in x, tight in y
    float a = smoothstep(0.5, 0.0, abs(c.x)) * smoothstep(0.5, 0.0, abs(c.y) * 2.6);
    // gust pulse: vary alpha by life so individual grains breathe
    a *= 0.55 + 0.45 * sin(vLife * 6.2831);
  #else
    float a = smoothstep(0.5, 0.0, d);
  #endif
  vec3 col = uColor;
  #if PARTICLE_KIND == 11
    col = mix(uColor, uColor2, vLife * 0.45);
  #elif PARTICLE_KIND == 4 || PARTICLE_KIND == 9 || PARTICLE_KIND == 12
    col = mix(uColor, uColor2, vLife);
    a *= 1.0 - vLife;
  #elif PARTICLE_KIND == 3
    float pulse = 0.5 + 0.5 * sin(uTime * 2.0 + vSeed * 18.0);
    col *= 0.6 + 0.4 * pulse;
    a *= pulse;
  #elif PARTICLE_KIND == 5
    a *= 0.6 + 0.3 * sin(uTime * 1.4 + vSeed * 9.0);
  #endif
  gl_FragColor = vec4(col, a * uOpacity);
}
`;

const _sandParticleVS = `
attribute float aSeed;
attribute float aLife;
varying float vLife;
varying float vSeed;
uniform float uPixelRatio;
uniform float uBaseSize;
void main() {
  vLife = aLife;
  vSeed = aSeed;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uBaseSize * uPixelRatio * (300.0 / max(0.001, -mv.z));
}
`;

const _sandParticleFS = `
precision highp float;
uniform vec3 uColor;
uniform float uOpacity;
varying float vLife;
varying float vSeed;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  if (length(c) > 0.34) discard;
  float a = 0.62 + 0.28 * fract(vSeed * 0.173 + vLife);
  gl_FragColor = vec4(uColor, a * uOpacity);
}
`;

export function makeParticles(biome) {
  const kind = biome.particle;
  const baseCount = {
    pollen: 240, dust: 320, snow: 900, firefly: 90, ember: 180,
    lichenmote: 140, feather: 120, bubble: 140, leaf: 120, spark: 240, rain: 520,
    sand: 3120, cinder: 260,
  }[kind] || 200;
  const count = _lowfxScale(baseCount);

  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const lifes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const r = Math.sqrt(Math.random()) * state.ISLAND_RADIUS * 1.1;
    const a = Math.random() * Math.PI * 2;
    positions[i * 3 + 0] = Math.cos(a) * r;
    // Sand/cinders hug the ground — sample low so grains read as wind-swept, not airborne.
    if (kind === "sand") {
      const groundY = state.heightFn ? state.heightFn(positions[i * 3 + 0], positions[i * 3 + 2]) : 0;
      positions[i * 3 + 1] = Math.max(0.05, groundY + 0.08) + Math.random() * 0.38;
    } else {
      positions[i * 3 + 1] = kind === "cinder" ? 0.1 + Math.random() * 5.6 : Math.random() * 14;
    }
    positions[i * 3 + 2] = Math.sin(a) * r;
    velocities[i * 3 + 0] = (Math.random() - 0.5) * 0.4;
    velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.4;
    velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
    seeds[i] = Math.random() * 100;
    lifes[i] = Math.random();
  }

  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  const lifeAttr = new THREE.BufferAttribute(lifes, 1);
  // position + aLife are rewritten every frame in stepParticles — declare
  // streaming usage so the driver picks the right upload path immediately.
  posAttr.setUsage(THREE.DynamicDrawUsage);
  lifeAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", posAttr);
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  geo.setAttribute("aLife", lifeAttr);

  const colorMap = {
    pollen: biome.sun, dust: biome.fog, snow: "#ffffff",
    firefly: biome.accent, ember: biome.accent, lichenmote: biome.accent,
    feather: "#ffffff", bubble: biome.water || biome.sky,
    leaf: biome.accent, spark: biome.sun, rain: biome.sun,
    sand: "#d89a4f",
    cinder: biome.sun,
  };
  // Ember/spark/cinder fade toward a smokier secondary colour over life.
  const color2Map = {
    sand: "#edbd72", ember: "#3a2018", spark: "#fff2b3", cinder: "#4a2018",
  };
  const sizeMap = {
    firefly: 0.16,
    snow: 0.16,
    lichenmote: 0.12,
    feather: 0.18,
    bubble: 0.13,
    leaf: 0.16,
    spark: 0.08,
    rain: 0.06,
    pollen: 0.08,
    dust: 0.09,
    ember: 0.12,
    sand: 0.28,
    cinder: 0.95,
  };
  const opacityMap = {
    dust: 0.35, feather: 0.7, bubble: 0.55, leaf: 0.85, spark: 0.95, rain: 0.55,
    pollen: 0.85, snow: 0.85, firefly: 0.85, ember: 0.85, lichenmote: 0.85,
    sand: 0.58, cinder: 0.95,
  };
  const additive = new Set(["firefly", "ember", "lichenmote", "spark", "cinder"]);

  const renderer = state.renderer; // set by main.js after init
  const pixelRatio = renderer ? renderer.getPixelRatio() : 1;
  const cinderBloomBoost = kind === "cinder" ? 3.2 : 1.0;

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: pixelRatio },
      uBaseSize: { value: sizeMap[kind] ?? 0.07 },
      uColor: { value: new THREE.Color(colorMap[kind]).multiplyScalar(cinderBloomBoost) },
      uColor2: { value: new THREE.Color(color2Map[kind] ?? colorMap[kind]).multiplyScalar(cinderBloomBoost) },
      uOpacity: { value: opacityMap[kind] ?? 0.85 },
    },
    defines: { PARTICLE_KIND: PARTICLE_KIND_ID[kind] ?? 0 },
    vertexShader: kind === "sand" ? _sandParticleVS : _particleVS,
    fragmentShader: kind === "sand" ? _sandParticleFS : _particleFS,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: additive.has(kind) ? THREE.AdditiveBlending : THREE.NormalBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.userData = {
    kind,
    velocities,
    seeds,
    lifes,
    count,
    // Built once per particle system (regen) rather than re-sampled per
    // particle per frame — see _buildParticleHeightGrid/_buildCinderFissureObstacles.
    heightGrid: (kind === "sand" || kind === "cinder")
      ? _buildParticleHeightGrid(state.heightFn, state.ISLAND_RADIUS)
      : null,
    fissureObstacles: kind === "cinder" ? _buildCinderFissureObstacles() : null,
  };
  if (kind === "cinder") points.layers.enable(BLOOM_LAYER);
  return points;
}

export function stepParticles(points, dt, t) {
  if (!points) return;
  const { kind, seeds, lifes, count, heightGrid, fissureObstacles } = points.userData;
  const pos = points.geometry.attributes.position.array;

  for (let i = 0; i < count; i++) {
    const ix = i * 3;
    let x = pos[ix], y = pos[ix + 1], z = pos[ix + 2];
    const s = seeds[i];

    if (kind === "snow") {
      y -= (0.6 + (s % 1) * 0.6) * dt;
      x += Math.sin(t * 0.6 + s) * 0.1 * dt;
      z += Math.cos(t * 0.5 + s) * 0.1 * dt;
      if (y < -2) y = 14;
    } else if (kind === "ember") {
      y += (0.5 + (s % 1) * 0.5) * dt;
      x += Math.sin(t * 1.4 + s) * 0.2 * dt;
      z += Math.cos(t * 1.1 + s) * 0.2 * dt;
      if (y > 12) {
        y = 0;
        const r = Math.random() * state.ISLAND_RADIUS * 0.8;
        const a = Math.random() * Math.PI * 2;
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
      }
    } else if (kind === "firefly") {
      x += Math.sin(t * 0.7 + s * 1.7) * 0.5 * dt;
      y += Math.sin(t * 1.1 + s) * 0.25 * dt;
      z += Math.cos(t * 0.6 + s * 1.3) * 0.5 * dt;
      // keep in bounds
      const r = Math.sqrt(x * x + z * z);
      if (r > state.ISLAND_RADIUS) {
        x *= 0.95;
        z *= 0.95;
      }
      if (y < 0.5) y = 0.5 + Math.random();
      if (y > 6) y = 6;
    } else if (kind === "lichenmote") {
      // ground-hugging motes — drift slowly, occasionally rise then sink
      x += Math.sin(t * 0.5 + s * 1.3) * 0.25 * dt;
      y += Math.sin(t * 0.8 + s) * 0.15 * dt;
      z += Math.cos(t * 0.45 + s * 1.1) * 0.25 * dt;
      // keep them low — between 0.2 and 1.6
      if (y < 0.2) y = 0.2 + Math.random() * 0.2;
      if (y > 1.6) y = 1.6;
      const rr = Math.sqrt(x * x + z * z);
      if (rr > state.ISLAND_RADIUS) { x *= 0.95; z *= 0.95; }
    } else if (kind === "feather") {
      // slow downward drift with horizontal wobble — like a stray puff
      y -= (0.18 + (s % 1) * 0.12) * dt;
      x += Math.sin(t * 0.45 + s * 1.7) * 0.45 * dt;
      z += Math.cos(t * 0.35 + s * 1.3) * 0.45 * dt;
      if (y < -1) {
        y = 14;
        const r = Math.sqrt(Math.random()) * state.ISLAND_RADIUS * 1.1;
        const a = Math.random() * Math.PI * 2;
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
      }
    } else if (kind === "dust") {
      x += Math.sin(t * 0.3 + s) * 0.4 * dt + 0.3 * dt;
      y += Math.sin(t * 0.4 + s * 2) * 0.1 * dt;
      z += Math.cos(t * 0.35 + s) * 0.3 * dt;
      const r = Math.sqrt(x * x + z * z);
      if (r > state.ISLAND_RADIUS * 1.2) {
        const a = Math.random() * Math.PI * 2;
        const nr = Math.random() * state.ISLAND_RADIUS * 0.4;
        x = Math.cos(a) * nr;
        z = Math.sin(a) * nr;
      }
    } else if (kind === "sand") {
      // Dominant horizontal wind sweeping across the dunes, with gusts and
      // small per-grain wobble. Grains stay near the surface; when blown past
      // the downwind edge they wrap back to the upwind side so the stream is
      // continuous.
      const gust = 0.95 + 0.70 * Math.sin(t * 0.35 + s * 0.07);
      const windBand = 0.65 + 0.35 * Math.sin(z * 0.23 + t * 0.8 + s * 0.05);
      // Slight cross-wind on Z so the grit doesn't move in ruler-straight rows.
      const cross = 0.18 * Math.sin(t * 0.5 + s * 0.13);
      x += (7.8 * gust * windBand + Math.sin(t * 1.6 + s) * 0.45) * dt;
      z += (cross + Math.cos(t * 0.9 + s * 1.3) * 0.24) * dt;
      // Tiny vertical wobble — sand grains don't really climb, they skip.
      y += Math.sin(t * 2.0 + s * 1.7) * 0.08 * dt - 0.01 * dt;
      // Sample the coarse baked height grid (not the full noise heightFn) to
      // clamp grains close to the ground so they hug dunes.
      const groundY = _sampleParticleHeightGrid(heightGrid, x, z);
      const floor = Math.max(0.05, groundY + 0.08);
      const ceil = floor + 0.42 + windBand * 0.18;
      if (y < floor) y = floor;
      else if (y > ceil) y = ceil;
      // Wrap from downwind edge back to upwind edge.
      if (x > state.ISLAND_RADIUS * 1.1) {
        x = -state.ISLAND_RADIUS * 1.05 + Math.random() * 1.0;
        z = (Math.random() - 0.5) * state.ISLAND_RADIUS * 2.0;
        const gy = _sampleParticleHeightGrid(heightGrid, x, z);
        y = Math.max(0.05, gy + 0.08) + Math.random() * 0.38;
      } else if (Math.abs(z) > state.ISLAND_RADIUS * 1.15) {
        z = -Math.sign(z) * state.ISLAND_RADIUS * 1.05;
      }
    } else if (kind === "cinder") {
      // Glowing ash: loose horizontal drift, rising over hot fissures and
      // settling elsewhere.
      const fissureLift = cinderFissureLiftAt(fissureObstacles, x, z);
      const wander = 0.26 + fissureLift * 0.16;
      x += (Math.sin(t * 0.55 + s * 1.7) + Math.sin(t * 0.21 + s * 0.31) * 0.5) * wander * dt;
      z += (Math.cos(t * 0.48 + s * 1.3) + Math.sin(t * 0.27 + s * 0.47) * 0.45) * wander * dt;
      const verticalDrift = -0.18 + fissureLift * 0.74;
      y += (verticalDrift + Math.sin(t * 1.1 + s * 1.6) * 0.12) * dt;
      const groundY = _sampleParticleHeightGrid(heightGrid, x, z);
      const ceil = groundY + 5.8;
      if (y > ceil) y = ceil;
      const rr = Math.sqrt(x * x + z * z);
      if (rr > state.ISLAND_RADIUS * 1.12) {
        x *= 0.92;
        z *= 0.92;
      }
    } else if (kind === "bubble") {
      // slow upward drift with a soft wobble — pops at the top
      y += (0.35 + (s % 1) * 0.25) * dt;
      x += Math.sin(t * 1.1 + s * 1.4) * 0.18 * dt;
      z += Math.cos(t * 0.95 + s * 1.2) * 0.18 * dt;
      if (y > 8) {
        y = -0.2;
        const r = Math.sqrt(Math.random()) * state.ISLAND_RADIUS * 1.05;
        const a = Math.random() * Math.PI * 2;
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
      }
    } else if (kind === "leaf") {
      // drifting fall, slower than dust, with horizontal flutter that emulates tumbling
      y -= (0.32 + (s % 1) * 0.18) * dt;
      x += Math.sin(t * 1.6 + s * 2.1) * 0.55 * dt;
      z += Math.cos(t * 1.3 + s * 1.7) * 0.55 * dt;
      if (y < -1) {
        y = 12 + Math.random() * 3;
        const r = Math.sqrt(Math.random()) * state.ISLAND_RADIUS * 1.05;
        const a = Math.random() * Math.PI * 2;
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
      }
    } else if (kind === "spark") {
      // hotter, faster-rising, smaller than ember
      y += (1.1 + (s % 1) * 0.8) * dt;
      x += Math.sin(t * 2.2 + s) * 0.3 * dt;
      z += Math.cos(t * 1.9 + s) * 0.3 * dt;
      if (y > 11) {
        y = 0;
        const r = Math.random() * state.ISLAND_RADIUS * 0.85;
        const a = Math.random() * Math.PI * 2;
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
      }
    } else if (kind === "rain") {
      // near-vertical streaks with a hint of horizontal drift
      y -= (8.5 + (s % 1) * 2.5) * dt;
      x += Math.sin(t * 0.4 + s) * 0.06 * dt;
      z += Math.cos(t * 0.35 + s) * 0.06 * dt;
      if (y < -1.5) {
        y = 12 + Math.random() * 4;
        const r = Math.sqrt(Math.random()) * state.ISLAND_RADIUS * 1.1;
        const a = Math.random() * Math.PI * 2;
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
      }
    } else {
      // pollen — gentle float
      x += Math.sin(t * 0.5 + s) * 0.15 * dt;
      y += (0.15 + Math.sin(t + s) * 0.1) * dt;
      z += Math.cos(t * 0.45 + s) * 0.15 * dt;
      if (y > 9) {
        y = 0;
      }
    }

    pos[ix] = x;
    pos[ix + 1] = y;
    pos[ix + 2] = z;
  }

  points.geometry.attributes.position.needsUpdate = true;

  // aLife — drives shader-side size/opacity ramps. Infinite-loop kinds use a
  // (t * speed + seed) % 1 cycle; recycle kinds use real elapsed-life
  // progress. We treat all kinds identically here (cheap one-pass loop).
  for (let i = 0; i < count; i++) {
    const s = seeds[i];
    if (kind === "ember" || kind === "spark") {
      lifes[i] = Math.min(1, (lifes[i] ?? 0) + dt * 0.6);
      if (lifes[i] >= 1) lifes[i] = 0;
    } else if (kind === "cinder") {
      const cinderLifeRate = 0.16;
      lifes[i] = Math.min(1, (lifes[i] ?? 0) + dt * cinderLifeRate);
      if (lifes[i] >= 1) lifes[i] = 0;
    } else if (kind === "firefly" || kind === "lichenmote") {
      lifes[i] = (t * 0.3 + s * 0.01) % 1.0;
    } else if (kind === "rain" || kind === "snow" || kind === "leaf" || kind === "feather" || kind === "bubble") {
      // recycle handlers reset y; tie aLife to vertical position so it ramps
      // back to 0 naturally when wrapped.
      lifes[i] = Math.max(0, Math.min(1, 1 - (points.geometry.attributes.position.array[i * 3 + 1] / 14)));
    } else {
      lifes[i] = (t * 0.5 + s * 0.013) % 1.0;
    }
  }
  points.geometry.attributes.aLife.needsUpdate = true;

  // shader-side uTime
  if (points.material.uniforms && points.material.uniforms.uTime) {
    points.material.uniforms.uTime.value = t;
  }
}
