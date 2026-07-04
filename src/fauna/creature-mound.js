import * as THREE from "three";
import { state } from "../state.js";
import { jitterGeo } from "../util.js";
import { nearestCenter } from "../terrain.js";
import { makeDirtPuff } from "../environment.js";
import { WATER_AVOID_Y, sampleTerrainNormal } from "./shared.js";

// ── burrower dirt mound ──
// A small flattened sphere placed where the creature went underground.
// Created on demand, reused across burrow cycles, removed when creature
// is disposed.
const MOUND_GEO = jitterGeo(new THREE.IcosahedronGeometry(0.22, 1), 0.04);
const MOUND_SCALE_Y = 0.35;
const MOUND_SCALE_XZ = 2.0;
const MOUND_SINK_SPEED = 1.25; // rate per second (~0.8s duration)
const MOUND_RISE_SPEED = 1.5;  // rate per second (~0.67s duration)

// Ensure c.moundMesh exists, with correct material and shadow flags.
function ensureMoundMesh(c) {
  if (!c.moundMesh) {
    const mat = new THREE.MeshStandardMaterial({
      color: c.dirtColor.clone().offsetHSL(0.03, 0.1, 0.12),
      flatShading: true,
      roughness: 0.95,
    });
    c.moundMesh = new THREE.Mesh(MOUND_GEO, mat);
    c.moundMesh.castShadow = true;
    c.moundMesh.receiveShadow = true;
  }
}

// Position and orient a mound at (x, z) aligned to terrain normal.
const _UP = new THREE.Vector3(0, 1, 0);
function placeMoundAt(c, x, z, heightFn) {
  ensureMoundMesh(c);
  const y = heightFn(x, z);
  const normal = sampleTerrainNormal(x, z, heightFn);
  c.moundMesh.quaternion.setFromUnitVectors(_UP, normal);
  c.moundMesh.position.set(x, y - 0.02, z);
}

// Show a fully-formed mound at the creature's current position.
export function showMound(c, heightFn) {
  c.moundSinkT = -1;
  c.moundRiseT = -1;
  ensureMoundMesh(c);
  c.moundMesh.scale.set(MOUND_SCALE_XZ, MOUND_SCALE_Y, MOUND_SCALE_XZ);
  const pos = c.group.position;
  placeMoundAt(c, pos.x, pos.z, heightFn);
  // Store terrain normal for creature sink animation
  const normal = sampleTerrainNormal(pos.x, pos.z, heightFn);
  c.moundEmergeNormal = { x: normal.x, y: normal.y, z: normal.z };
  c.moundEmergeDist = 0.8 + 0.4 * c.scale;
  c.moundEmergeX = pos.x;
  c.moundEmergeZ = pos.z;
  c.moundMesh.visible = true;
  state.world.add(c.moundMesh);
}

// Show a flat mound at (x, z) that will rise via stepMoundRise.
export function showMoundRising(c, x, z, heightFn) {
  c.moundSinkT = -1;
  ensureMoundMesh(c);
  c.moundMesh.scale.set(MOUND_SCALE_XZ, 0, MOUND_SCALE_XZ);
  placeMoundAt(c, x, z, heightFn);
  // Store terrain normal and sink distance for creature emerge animation
  const normal = sampleTerrainNormal(x, z, heightFn);
  c.moundEmergeNormal = { x: normal.x, y: normal.y, z: normal.z };
  c.moundEmergeDist = 0.8 + 0.4 * c.scale;
  c.moundEmergeX = x;
  c.moundEmergeZ = z;
  c.moundMesh.visible = true;
  state.world.add(c.moundMesh);
  c.moundRiseT = 0;
}

// Start sinking the mound; animation driven by stepMoundSink.
export function hideMound(c) {
  if (c.moundMesh && c.moundMesh.visible) {
    c.moundSinkT = 0;
    c.moundSinkBaseY = c.moundMesh.position.y;
    c.moundSinkBaseScaleY = c.moundMesh.scale.y;
  }
}

// Advance the rise animation. Returns true when complete.
export function stepMoundRise(c, dt) {
  if (c.moundRiseT < 0) return true;
  c.moundRiseT += dt * MOUND_RISE_SPEED;
  const t = Math.min(c.moundRiseT, 1);
  if (c.moundMesh) c.moundMesh.scale.y = MOUND_SCALE_Y * t;
  if (t >= 1) { c.moundRiseT = -1; return true; }
  return false;
}

// Advance the sink animation. Returns true when complete (mound removed).
export function stepMoundSink(c, dt) {
  if (c.moundSinkT < 0) return true;
  c.moundSinkT += dt * MOUND_SINK_SPEED;
  const t = Math.min(c.moundSinkT, 1);
  if (c.moundMesh) {
    c.moundMesh.position.y = c.moundSinkBaseY - t * 0.25;
    c.moundMesh.scale.y = c.moundSinkBaseScaleY * (1 - t);
  }
  if (t >= 1) {
    c.moundSinkT = -1;
    if (c.moundMesh) {
      c.moundMesh.visible = false;
      state.world.remove(c.moundMesh);
    }
    return true;
  }
  return false;
}

// Find a valid emerge point near the creature. Returns {x, z} or null.
export function findEmergePoint(c, heightFn) {
  const pos = c.group.position;
  const cr = 0.25 * c.scale; // creature collision radius
  for (let attempt = 0; attempt < 8; attempt++) {
    const ang = Math.random() * Math.PI * 2;
    const dist = 2.5 + Math.random() * 4;
    let nx = pos.x + Math.cos(ang) * dist;
    let nz = pos.z + Math.sin(ang) * dist;
    // Must be on solid ground above waterline
    if (heightFn(nx, nz) < WATER_AVOID_Y) continue;
    // Must be well inside the island plateau (same check as walker edge avoidance)
    const near = nearestCenter(nx, nz);
    const dx = nx - near.cx, dz = nz - near.cz;
    if (Math.sqrt(dx * dx + dz * dz) > near.radius * 0.9) continue;
    // Must not overlap obstacles
    let blocked = false;
    for (const obs of state.obstacles) {
      const minD = obs.r + cr;
      const odx = nx - obs.x, odz = nz - obs.z;
      if (odx * odx + odz * odz < minD * minD) { blocked = true; break; }
    }
    if (blocked) continue;
    return { x: nx, z: nz };
  }
  // Fallback: nudge toward nearest island center
  const near = nearestCenter(pos.x, pos.z);
  const fx = near.cx, fz = near.cz;
  if (heightFn(fx, fz) >= WATER_AVOID_Y) return { x: fx, z: fz };
  return null;
}

// ── burrower mode ─────────────────────────────────────────────────────────
// Alternating above-ground / burrowed life. Runs the 8-state FSM + mound
// animations. Returns true while fully underground (burrowed/sinking/
// moundRising) — those states skip all motion/animation, so the dispatcher
// early-exits. Extracted from stepCreature (QA-001).
export function stepBurrower(c, dt, heightFn) {
  c.burrowTimer -= dt;
  if (c.burrowState === "surface" && c.burrowTimer <= 0) {
    c.burrowState = "descending";
    c.burrowTimer = 0.6;
    // Dirt spray + mound appear together when the creature starts digging
    const pos = c.group.position;
    const gy = heightFn(pos.x, pos.z);
    const puff = makeDirtPuff(pos.x, gy, pos.z, c.dirtColor);
    state.world.add(puff);
    state.dirtPuffs.push(puff);
    showMound(c, heightFn);
  } else if (c.burrowState === "descending") {
    c.burrowDepth = Math.min(1, c.burrowDepth + dt * 1.6);
    if (c.burrowDepth >= 1) {
      c.burrowState = "burrowed";
      c.group.visible = false;
      c.burrowTimer = 3 + Math.random() * 4;
    }
  } else if (c.burrowState === "burrowed" && c.burrowTimer <= 0) {
    // Start sinking the mound before emerging
    c.burrowState = "sinking";
    hideMound(c);
    // If no mound exists (e.g. first cycle or inspect), skip straight to emerging
    if (c.moundSinkT < 0) {
      c.burrowState = "moundGone";
    }
  } else if (c.burrowState === "sinking") {
    // Wait for mound sink animation to finish (driven by moundSinkT below)
    if (c.moundSinkT < 0) {
      c.burrowState = "moundGone";
    }
  } else if (c.burrowState === "moundGone") {
    // Pick a fresh nearby ground point for re-emergence
    const ep = findEmergePoint(c, heightFn);
    if (ep) {
      c.burrowState = "moundRising";
      showMoundRising(c, ep.x, ep.z, heightFn);
    }
    // If no valid point found, stay in moundGone and retry next frame
  } else if (c.burrowState === "moundRising") {
    // Wait for mound rise animation (driven by moundRiseT below)
    if (c.moundRiseT < 0) {
      // Rise complete — move creature to mound position, show it
      const mp = c.moundMesh.position;
      c.group.position.set(mp.x, mp.y, mp.z);
      c.group.visible = true;
      c.burrowState = "emerging";
      c.moundHideTimer = 1;
      const pos = c.group.position;
      const puff = makeDirtPuff(pos.x, heightFn(pos.x, pos.z), pos.z, c.dirtColor);
      state.world.add(puff);
      state.dirtPuffs.push(puff);
    }
  } else if (c.burrowState === "emerging") {
    c.burrowDepth = Math.max(0, c.burrowDepth - dt * 1.8);
    if (c.burrowDepth <= 0) {
      c.burrowState = "surface";
      c.burrowTimer = 5 + Math.random() * 6;
    }
  }
  // mound hide timer — counts down during emerging/surface, triggers sink
  if (c.moundHideTimer > 0 && (c.burrowState === "emerging" || c.burrowState === "surface")) {
    c.moundHideTimer -= dt;
    if (c.moundHideTimer <= 0) {
      c.moundHideTimer = -1;
      hideMound(c);
    }
  }
  // ── mound animations (must run before early-return) ──
  stepMoundRise(c, dt);
  stepMoundSink(c, dt);

  // while burrowed, sinking, or mound rising, skip all motion/animation
  return c.burrowState === "burrowed" || c.burrowState === "sinking" || c.burrowState === "moundRising";
}
