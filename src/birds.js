import * as THREE from "three";
import { state } from "./state.js";
import { jitterGeo } from "./util.js";
import { buildCatalogSubject } from "./catalog.js";
import { integrateVelocity, capVelocitySpeed, orientToVelocity } from "./fauna/shared.js";

// ─────────────────────────────────────────────────────────────────────────────
// Birds — small bodies + flapping wings, flocking with boid behaviour
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Build a single bird body with two hinged wing pivots for flap animation.
 * @param {THREE.ColorRepresentation} color - shared body/wing material color.
 * @returns {{group: THREE.Group, body: THREE.Mesh, wings: THREE.Group[], velocity: THREE.Vector3, flapPhase: number, flapSpeed: number}}
 *   `wings` are the two pivot groups (`stepFlock` rotates `.rotation.z` on each to flap).
 */
export function makeBird(color) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color,
    flatShading: true,
    roughness: 0.6,
    side: THREE.DoubleSide,
  });

  // body — elongated along Z; lookAt() makes -Z the forward direction
  const bodyGeo = jitterGeo(new THREE.IcosahedronGeometry(0.1, 0), 0.015);
  bodyGeo.scale(0.85, 0.78, 2.0);
  const body = new THREE.Mesh(bodyGeo, mat);
  body.castShadow = true;
  group.add(body);

  // shared wing geometry — flat ellipsoid centred at origin
  const wingGeo = new THREE.IcosahedronGeometry(0.12, 0);
  wingGeo.scale(2.2, 0.06, 1.2);

  const wings = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.025, 0);
    group.add(pivot);

    const w = new THREE.Mesh(wingGeo, mat);
    w.position.x = side * 0.16;
    w.castShadow = true;
    pivot.add(w);
    wings.push(pivot);
  }

  return {
    group,
    body,
    wings,
    velocity: new THREE.Vector3(),
    flapPhase: Math.random() * Math.PI * 2,
    flapSpeed: 22 + Math.random() * 10,
  };
}

/**
 * Randomly pick a bird color: 50% near-black, 30% the biome's accent color,
 * 20% the biome's sun color darkened.
 * @param {object} biome - biome config; uses `accent`, `sun`.
 * @returns {THREE.Color} the chosen color.
 */
export function pickBirdColor(biome) {
  const r = Math.random();
  if (r < 0.5) return new THREE.Color(0x1a1a22);
  if (r < 0.8) return new THREE.Color(biome.accent);
  return new THREE.Color(biome.sun).offsetHSL(0, 0, -0.25);
}

/**
 * Build one flock of 5-9 same-colored birds at a random altitude and heading.
 * Unlike every other entity module, the returned object has no `.group` — a
 * flock is a loose collection of individually-grouped birds (`flock.birds`),
 * not one parented `THREE.Group` — so `stepFlock` and any disposal code must
 * walk `flock.birds` directly rather than expecting a single top-level group.
 * @param {object} biome - biome config; uses `id`, `accent`, `sun` (via `pickBirdColor`).
 * @returns {{birds: Array, waypoint: THREE.Vector3, waypointTimer: number, altitude: number}}
 *   `birds` is the array of objects returned by `makeBird`, each pre-positioned near the flock center.
 */
export function makeFlock(biome) {
  const size = 5 + Math.floor(Math.random() * 5); // 5–9
  const color = pickBirdColor(biome);
  const birds = [];

  const cx = (Math.random() - 0.5) * state.ISLAND_SIZE * 0.5;
  const cz = (Math.random() - 0.5) * state.ISLAND_SIZE * 0.5;
  const altitude = 7 + Math.random() * 5;

  const dir = Math.random() * Math.PI * 2;
  const initVel = new THREE.Vector3(Math.cos(dir), 0, Math.sin(dir))
    .multiplyScalar(2.5);

  for (let i = 0; i < size; i++) {
    const b = makeBird(color);
    b.group.userData.catalog = buildCatalogSubject({
      category: "fauna",
      variant: "bird",
      biomeId: biome.id,
    });
    b.group.position.set(
      cx + (Math.random() - 0.5) * 3,
      altitude + (Math.random() - 0.5) * 1.5,
      cz + (Math.random() - 0.5) * 3
    );
    b.velocity.copy(initVel).add(
      new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5
      ).multiplyScalar(0.4)
    );
    birds.push(b);
  }

  return {
    birds,
    waypoint: new THREE.Vector3(cx, altitude, cz),
    waypointTimer: 0,
    altitude,
  };
}

const _flockTarget = new THREE.Vector3();
/**
 * Advance one flock's boid simulation (alignment/cohesion/separation/waypoint
 * seeking, ground-avoidance floor, wing flap) for one frame. O(N²) over the
 * flock's own birds — fine at the current flock sizes (N ≤ ~9); a spatial
 * structure would only be worth it above N ≈ 15. Because `makeFlock` returns
 * no `.group`, this walks `flock.birds` directly rather than a parented group.
 * @param {ReturnType<typeof makeFlock>} flock - a flock returned by `makeFlock`, mutated in place.
 * @param {number} dt - elapsed time in seconds since the last call.
 * @param {number} t - total elapsed simulation time in seconds (drives wing-flap phase).
 */
export function stepFlock(flock, dt, t) {
  flock.waypointTimer -= dt;
  if (flock.waypointTimer <= 0) {
    flock.waypoint.set(
      (Math.random() - 0.5) * state.ISLAND_SIZE * 0.7,
      flock.altitude + (Math.random() - 0.5) * 2.5,
      (Math.random() - 0.5) * state.ISLAND_SIZE * 0.7
    );
    flock.waypointTimer = 4 + Math.random() * 4;
  }

  const birds = flock.birds;
  const N = birds.length;

  // boid weights — tuned for tight but loose-looking flocks
  const PERCEPTION = 4.5;
  const SEP_RADIUS = 1.4;
  const MAX_SPEED  = 4.5;
  const MIN_SPEED  = 2.0;
  const W_ALIGN = 1.4;
  const W_COH   = 0.9;
  const W_SEP   = 2.6;
  const W_WAY   = 0.5;

  // O(N²) boid pairs — fine for the current flock sizes (N ≤ ~9). A spatial
  // structure is only worth it above N ≈ 15; revisit before raising flock
  // counts in biomes.js.
  for (let i = 0; i < N; i++) {
    const b = birds[i];
    const pos = b.group.position;
    let ax = 0, ay = 0, az = 0;
    let cx = 0, cy = 0, cz = 0;
    let sx = 0, sy = 0, sz = 0;
    let nN = 0, nS = 0;

    for (let j = 0; j < N; j++) {
      if (i === j) continue;
      const o = birds[j];
      const dx = o.group.position.x - pos.x;
      const dy = o.group.position.y - pos.y;
      const dz = o.group.position.z - pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;

      if (d2 < PERCEPTION * PERCEPTION) {
        ax += o.velocity.x; ay += o.velocity.y; az += o.velocity.z;
        cx += o.group.position.x;
        cy += o.group.position.y;
        cz += o.group.position.z;
        nN++;
      }
      if (d2 < SEP_RADIUS * SEP_RADIUS && d2 > 1e-4) {
        const d = Math.sqrt(d2);
        sx -= dx / d; sy -= dy / d; sz -= dz / d;
        nS++;
      }
    }

    let fx = 0, fy = 0, fz = 0;
    if (nN > 0) {
      fx += (ax / nN) * W_ALIGN;
      fy += (ay / nN) * W_ALIGN;
      fz += (az / nN) * W_ALIGN;
      fx += (cx / nN - pos.x) * W_COH;
      fy += (cy / nN - pos.y) * W_COH;
      fz += (cz / nN - pos.z) * W_COH;
    }
    if (nS > 0) {
      fx += sx * W_SEP; fy += sy * W_SEP; fz += sz * W_SEP;
    }
    fx += (flock.waypoint.x - pos.x) * 0.06 * W_WAY;
    fy += (flock.waypoint.y - pos.y) * 0.15 * W_WAY;
    fz += (flock.waypoint.z - pos.z) * 0.06 * W_WAY;

    // soft boundary — gently pull back toward the island when too far
    const r2 = pos.x * pos.x + pos.z * pos.z;
    if (r2 > state.ISLAND_RADIUS * state.ISLAND_RADIUS * 1.4) {
      fx -= pos.x * 0.4;
      fz -= pos.z * 0.4;
    }

    b.velocity.x += fx * dt;
    b.velocity.y += fy * dt;
    b.velocity.z += fz * dt;

    const sp = b.velocity.length();
    capVelocitySpeed(b.velocity, MAX_SPEED, MIN_SPEED);

    integrateVelocity(pos, b.velocity, dt);

    // Ground avoidance — keep birds well clear of the terrain. heightFn drops
    // to large negatives in the void beyond the islands, so we also clamp to
    // an absolute minimum altitude so flocks can't dive off the edge into the
    // abyss and visually disappear.
    const groundY = state.heightFn(pos.x, pos.z);
    const floor = Math.max(groundY + 2.5, 3.5);
    if (pos.y < floor) {
      pos.y = floor;
      if (b.velocity.y < 0) b.velocity.y *= -0.25;
      // nudge upward so they don't graze the ground next frame either
      b.velocity.y += 1.2 * dt;
    }

    orientToVelocity(b.group, pos, b.velocity, _flockTarget);

    // flap — left/right wings mirrored
    const flapRate = b.flapSpeed + sp * 1.5;
    const flap = Math.sin(t * flapRate + b.flapPhase);
    b.wings[0].rotation.z = -flap * 0.85 + 0.15;
    b.wings[1].rotation.z =  flap * 0.85 - 0.15;
  }
}
