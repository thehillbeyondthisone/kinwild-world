import * as THREE from "three";
import {
  terrainNoiseFromSeed,
  terrainAmpFor,
  WATER_SURFACE_Y,
  applyWaterWetDepth,
} from "../world-constants.js";
import {
  NIGHT_SKY,
  NIGHT_FOG,
  NIGHT_SUN,
  NIGHT_HEMI_GROUND,
} from "../state.js";
import { switchMusic } from "../music.js";
import { makeHeightFn, makeTerrain } from "../terrain.js";
import { makeWaterPlane } from "../environment.js";
import {
  makeSkyDome,
  makeMountainBackdrop,
  makeCloudLayer,
  makeStarfield,
  makeAurora,
  makeCloudSwirl,
  makeIslandEdgeMist,
} from "../sky.js";
import { makeWaterReflection } from "../reflection.js";

// Biome-switch atmosphere (music, postfx tint, scene background/fog, lights,
// sky backdrop, day/night palette snapshot) plus terrain + optional water
// plane. Extracted verbatim from generateWorld's atmosphere/terrain/water
// section (QA-008) — the two `yieldIfNeeded(true)` calls inside preserve the
// exact seeded-PRNG-window positions generateWorld awaited at before the
// split, since this function is itself awaited at that same point.
export async function buildAtmosphereAndTerrain({ worldState, worldScene, biome, seed, layout, yieldIfNeeded }) {
  worldState.currentBiome = biome;
  worldState.currentSeed = seed;

  // Switch background music to match the biome (streams on demand).
  switchMusic(biome);

  // Bloom is purely additive in the custom composite (base + bloom*uStrength,
  // see _bloomCompositeShader). It can only brighten the frame, so darkBiomes
  // can keep bloom on — and the obsidian shard / glow eye / ember halos are
  // exactly the visual feature those moody biomes benefit from.
  if (worldState.postfx) worldState.postfx.setBloom(worldState.userSettings.bloom && biome.bloom !== false);
  // depth-fog post pass tints distant pixels toward the same atmosphere color
  // as the in-scene FogExp2, just with a more painterly far-field falloff.
  if (worldState.postfx && worldState.postfx.setDepthFogColor) {
    worldState.postfx.setDepthFogColor(new THREE.Color(biome.fog));
  }

  // atmosphere — Color/Fog instances are mutated by updateDayNight()
  worldScene.background = new THREE.Color(biome.sky);
  worldScene.fog = new THREE.FogExp2(new THREE.Color(biome.fog), biome.fogDensity);

  // darkBiome biomes need extra lift: their sky/ground/cliff hexes are
  // near-black, so even strong lights still multiply against tiny material
  // colours. Boost hemi/sun/accent + nudge tone-mapping exposure to lift
  // the whole frame without changing the moody palette.
  const dark = !!biome.darkBiome;
  if (worldState.renderer) worldState.renderer.toneMappingExposure = dark ? 2.6 : 1.05;

  const hemi = new THREE.HemisphereLight(
    new THREE.Color(biome.sky),
    new THREE.Color(biome.ground[0]),
    dark ? 2.2 : 0.65
  );
  worldState.world.add(hemi);
  worldState.hemiLight = hemi;

  const sun = new THREE.DirectionalLight(new THREE.Color(biome.sun), (dark ? 2.0 : 1.25) * (biome.sunIntensity ?? 1));
  sun.position.set(18, 28, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -worldState.ISLAND_SIZE / 2;
  sun.shadow.camera.right = worldState.ISLAND_SIZE / 2;
  sun.shadow.camera.top = worldState.ISLAND_SIZE / 2;
  sun.shadow.camera.bottom = -worldState.ISLAND_SIZE / 2;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 80;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 3.5;
  worldState.world.add(sun);
  worldState.sunLight = sun;

  const accent = new THREE.PointLight(
    new THREE.Color(biome.accent),
    dark ? 1.8 : 0.6,
    dark ? 50 : 35,
    1.6
  );
  accent.position.set(0, 8, 0);
  worldState.world.add(accent);

  // Sky backdrop — dome (gradient) + two-layer mountain silhouette + drifting
  // cloud sprites. Day/night re-tints them via updateSkyColors each frame.
  const skyDome = makeSkyDome(biome);
  worldState.world.add(skyDome);
  worldState.skyDome = skyDome;

  const mountains = makeMountainBackdrop(biome);
  worldState.world.add(mountains);
  worldState.mountains = mountains;
  worldState.mountainBasePos = mountains.position.clone();

  worldState.clouds = makeCloudLayer(biome);
  if (worldState.clouds) worldState.world.add(worldState.clouds);

  // Starfield + aurora — drawn always, faded by night-amount in updateDayNight.
  worldState.starfield = makeStarfield();
  worldState.world.add(worldState.starfield);

  worldState.aurora = makeAurora(biome);
  if (worldState.aurora) worldState.world.add(worldState.aurora);

  worldState.cloudSwirl = makeCloudSwirl(biome);
  if (worldState.cloudSwirl) worldState.world.add(worldState.cloudSwirl);

  const edgeMist = makeIslandEdgeMist(biome);
  if (edgeMist) worldState.world.add(edgeMist);

  const nightP = biome.night ?? {};
  const duskP = biome.dusk ?? null;
  worldState.dayNight = {
    sky: new THREE.Color(biome.sky),
    skyForHemi: new THREE.Color(biome.sky),
    fog: new THREE.Color(biome.fog),
    sun: new THREE.Color(biome.sun),
    ground: new THREE.Color(biome.ground[0]),
    nightSky: new THREE.Color(nightP.sky ?? NIGHT_SKY),
    nightFog: new THREE.Color(nightP.fog ?? NIGHT_FOG),
    nightSun: new THREE.Color(nightP.sun ?? NIGHT_SUN),
    nightGround: new THREE.Color(nightP.ground ?? NIGHT_HEMI_GROUND),
    duskSky: duskP ? new THREE.Color(duskP.sky) : null,
    duskFog: duskP ? new THREE.Color(duskP.fog) : null,
    duskSun: duskP ? new THREE.Color(duskP.sun) : null,
    duskGround: duskP ? new THREE.Color(duskP.ground) : null,
    fogDensity: biome.fogDensity,
  };

  await yieldIfNeeded(true);

  // terrain
  const noise2D = terrainNoiseFromSeed(seed);
  const terrainAmp = terrainAmpFor(biome);
  const baseHeightFn = makeHeightFn(noise2D, layout, terrainAmp);
  worldState.heightFn = biome.water
    ? applyWaterWetDepth(baseHeightFn, WATER_SURFACE_Y)
    : baseHeightFn;
  const terrain = makeTerrain(biome, worldState.heightFn, worldState);
  worldState.world.add(terrain);
  worldState.terrainMesh = terrain;
  terrain.material.flatShading = false;
  terrain.material.needsUpdate = true;

  // water plane (biomes that opt in)
  if (biome.water) {
    worldState.waterMesh = makeWaterPlane(biome);
    worldState.world.add(worldState.waterMesh);
    // Build the reflection only after the sky dome / starfield / aurora are
    // in place. Sky elements were added a few lines above this block, so they
    // exist already.
    worldState.waterReflection = makeWaterReflection(biome);
    // Hand the RT to the water material.
    const u = worldState.waterMesh.material.userData.reflectionUniforms;
    if (u) {
      u.uReflTex.value = worldState.waterReflection.rt.texture;
      u.uReflMix.value = 0.3; // 30% blend
    }
  }

  await yieldIfNeeded(true);
}
