import * as THREE from "three";
import { lowfxScale as _lowfxScale } from "./_shared.js";

// ─── dirt puffs (burrower emerge/sink bursts) ───
//
// Each puff is a small Points cloud of ~12 brown specks that fly outward,
// fall under "gravity," and fade out. Self-contained — the world manager
// adds them to the scene at spawn; stepDirtPuffs removes them at expiry.
const PUFF_PARTICLES = 24;
const PUFF_LIFE = 1.7; // seconds
export function makeDirtPuff(x, y, z, baseColor) {
  const positions = new Float32Array(PUFF_PARTICLES * 3);
  const velocities = new Float32Array(PUFF_PARTICLES * 3);
  for (let i = 0; i < PUFF_PARTICLES; i++) {
    positions[i * 3 + 0] = x;
    positions[i * 3 + 1] = y + 0.05;
    positions[i * 3 + 2] = z;
    const ang = Math.random() * Math.PI * 2;
    const sp = 1.2 + Math.random() * 1.4;
    velocities[i * 3 + 0] = Math.cos(ang) * sp;
    velocities[i * 3 + 1] = 1.6 + Math.random() * 1.2;
    velocities[i * 3 + 2] = Math.sin(ang) * sp;
  }
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", posAttr);
  const mat = new THREE.PointsMaterial({
    color: new THREE.Color(baseColor).offsetHSL(0.04, 0.15, 0.12),
    size: 0.18,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.userData = { velocities, age: 0 };
  return points;
}

export function stepDirtPuffs(puffs, dt) {
  if (!puffs || !puffs.length) return;
  for (let p = puffs.length - 1; p >= 0; p--) {
    const puff = puffs[p];
    const d = puff.userData;
    d.age += dt;
    const pos = puff.geometry.attributes.position.array;
    const v = d.velocities;
    for (let i = 0; i < PUFF_PARTICLES; i++) {
      const ix = i * 3;
      pos[ix + 0] += v[ix + 0] * dt;
      pos[ix + 1] += v[ix + 1] * dt;
      pos[ix + 2] += v[ix + 2] * dt;
      v[ix + 1] -= 6.5 * dt; // gravity
      v[ix + 0] *= 0.94;
      v[ix + 2] *= 0.94;
    }
    puff.geometry.attributes.position.needsUpdate = true;
    puff.material.opacity = Math.max(0, 0.9 * (1 - d.age / PUFF_LIFE));
    if (d.age >= PUFF_LIFE) {
      if (puff.parent) puff.parent.remove(puff);
      puff.geometry.dispose();
      puff.material.dispose();
      puffs.splice(p, 1);
    }
  }
}

// ─── footstep dust kicks ───
const KICK_PARTICLES = 4;
const KICK_LIFE = 0.5;
export function makeDustKick(x, y, z, baseColor, opts = {}) {
  const count = opts.count ?? KICK_PARTICLES;
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const velocityScale = opts.velocityScale ?? 1;
  for (let i = 0; i < count; i++) {
    positions[i * 3 + 0] = x;
    positions[i * 3 + 1] = y + 0.02;
    positions[i * 3 + 2] = z;
    const ang = Math.random() * Math.PI * 2;
    const sp = (0.4 + Math.random() * 0.5) * velocityScale;
    velocities[i * 3 + 0] = Math.cos(ang) * sp;
    velocities[i * 3 + 1] = (0.5 + Math.random() * 0.4) * velocityScale;
    velocities[i * 3 + 2] = Math.sin(ang) * sp;
  }
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", posAttr);
  const mat = new THREE.PointsMaterial({
    color: new THREE.Color(baseColor).offsetHSL(0, -0.1, 0.12),
    size: opts.size ?? 0.08,
    transparent: true,
    opacity: opts.opacity ?? 0.7,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.userData = {
    velocities,
    age: 0,
    count,
    life: opts.life ?? KICK_LIFE,
    opacity: opts.opacity ?? 0.7,
    poof: opts.poof ?? false,
  };
  return points;
}

export function stepDustKicks(kicks, dt) {
  if (!kicks || !kicks.length) return;
  for (let p = kicks.length - 1; p >= 0; p--) {
    const kick = kicks[p];
    const d = kick.userData;
    d.age += dt;
    const pos = kick.geometry.attributes.position.array;
    const v = d.velocities;
    const count = d.count ?? KICK_PARTICLES;
    for (let i = 0; i < count; i++) {
      const ix = i * 3;
      pos[ix + 0] += v[ix + 0] * dt;
      pos[ix + 1] += v[ix + 1] * dt;
      pos[ix + 2] += v[ix + 2] * dt;
      v[ix + 1] -= 3.5 * dt;
      v[ix + 0] *= 0.9;
      v[ix + 2] *= 0.9;
    }
    kick.geometry.attributes.position.needsUpdate = true;
    const life = d.life ?? KICK_LIFE;
    const opacity = d.opacity ?? 0.7;
    kick.material.opacity = Math.max(0, opacity * (1 - d.age / life));
    if (d.age >= life) {
      if (kick.parent) kick.parent.remove(kick);
      kick.geometry.dispose();
      kick.material.dispose();
      kicks.splice(p, 1);
    }
  }
}

// ─── fly swarms (dark specks hovering over a fixed prop) ───
//
// Tiny erratic cloud — each speck orbits a center with phase-offset sinusoids
// so the motion reads as jittery, insect-like buzzing rather than smooth flight.
// Used for the skull flies in the desert biome.
const FLY_COUNT = 9;
export function makeFlySwarm(centerX, centerY, centerZ) {
  const count = _lowfxScale(FLY_COUNT);
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3 + 0] = centerX;
    positions[i * 3 + 1] = centerY;
    positions[i * 3 + 2] = centerZ;
    seeds[i] = Math.random() * 100;
  }
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", posAttr);
  const mat = new THREE.PointsMaterial({
    color: 0x141014,
    size: 0.07,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.userData = { centerX, centerY, centerZ, seeds, count };
  return points;
}

export function stepFlySwarms(swarms, t) {
  if (!swarms || !swarms.length) return;
  for (const sw of swarms) {
    const { centerX, centerY, centerZ, seeds, count } = sw.userData;
    const pos = sw.geometry.attributes.position.array;
    for (let i = 0; i < count; i++) {
      const s = seeds[i];
      // Tight, irregular orbit: a slow circular sweep plus a faster jitter
      // so individual flies dart and pause rather than glide.
      const r = 0.08 + 0.045 * Math.sin(t * 1.7 + s * 1.1);
      const ang = t * (1.5 + (s % 1) * 0.9) + s * 4.1;
      const dx = Math.cos(ang) * r + Math.sin(t * 6.0 + s * 3.3) * 0.018;
      const dy = Math.sin(t * 2.2 + s * 1.7) * 0.055 + Math.sin(t * 5.5 + s * 2.0) * 0.015;
      const dz = Math.sin(ang) * r + Math.cos(t * 5.6 + s * 3.0) * 0.018;
      pos[i * 3 + 0] = centerX + dx;
      pos[i * 3 + 1] = centerY + dy;
      pos[i * 3 + 2] = centerZ + dz;
    }
    sw.geometry.attributes.position.needsUpdate = true;
  }
}
