// Locator panel + follow mode + cinematic tour (ARC-001 / QA-006 split).
//
// setFollowTarget, stepTour and isTouring are module-scope (not initUi
// closures) because main.js imports the first two and steps the tour each
// frame; they read the shared ctx rather than closing over local `let`s.
import * as THREE from "three";
import { state } from "../state.js";
import { setFollowReleaseCallback } from "../world.js";
import { LOCATOR_HIDDEN_FLORA_VARIANTS } from "./constants.js";
import { ctx } from "./context.js";

/** The currently-followed creature/caterpillar struct, or null if none. */
export function getFollowTarget() {
  return ctx.followTarget;
}

/** Whether the cinematic tour (T key) is currently active. */
export function isTouring() {
  return ctx.tour !== null && ctx.tour.active;
}

/**
 * Set (or clear) the followed creature and update the follow button's label/hint.
 *
 * @param {Object|null} creatureOrNull - creature/caterpillar struct to follow, or null to release
 */
export function setFollowTarget(creatureOrNull) {
  ctx.followTarget = creatureOrNull;
  if (!ctx.followButton) return;
  ctx.followButton.classList.toggle("active", !!ctx.followTarget);
  const label = ctx.followTarget ? "release follow" : "follow a creature";
  const hint = ctx.followTarget ? "tracking · click to release" : "click to select";
  ctx.followButton.querySelector(".setting-button-label").textContent = label;
  ctx.followButton.querySelector(".setting-button-hint").textContent = hint;
}

function updateTourButtonLabel(active) {
  if (!ctx.tourButton) return;
  const label = ctx.tourButton.querySelector(".setting-button-label");
  const hint = ctx.tourButton.querySelector(".setting-button-hint");
  if (active) {
    label.textContent = "stop tour";
    hint.textContent = "touring · t or esc to stop";
  } else {
    label.textContent = "cinematic tour";
    hint.textContent = "t · orbits and follows creatures · esc to stop";
  }
}

/**
 * Advance the cinematic tour state machine (slow auto-orbit, periodically
 * cutting to follow a random creature for a few seconds). No-op if no tour
 * is active. Caller (main.js) invokes this every frame.
 *
 * @param {number} dt - frame delta time in seconds
 */
export function stepTour(dt) {
  const tour = ctx.tour;
  if (!tour || !tour.active) return;
  const controls = ctx.controls;
  tour.timer -= dt;

  if (tour.phase === "orbit") {
    if (tour.timer <= 0) {
      const candidates = [...state.creatures, ...state.caterpillars].filter(
        (c) => (c.group && c.group.parent) || (c.segments && c.segments[0])
      );
      if (candidates.length > 0) {
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        setFollowTarget(pick);
        tour.phase = "follow";
        tour.timer = 4 + Math.random() * 4;
        if (controls) controls.autoRotateSpeed = 0.05;
      } else {
        tour.timer = 8 + Math.random() * 7;
      }
    }
  } else if (tour.phase === "follow") {
    if (!ctx.followTarget || tour.timer <= 0) {
      setFollowTarget(null);
      tour.phase = "orbit";
      tour.timer = 8 + Math.random() * 7;
      if (controls) {
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.22;
      }
    }
  }
}

function startTour() {
  const controls = ctx.controls;
  if (ctx.tour && ctx.tour.active) return;
  ctx.tour = {
    active: true,
    phase: "orbit",
    timer: 2,
    savedAutoRotate: controls ? controls.autoRotate : false,
    savedAutoRotateSpeed: controls ? controls.autoRotateSpeed : 0.22,
  };
  if (controls) {
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.22;
  }
  ctx.tourButton?.classList.add("active");
  updateTourButtonLabel(true);
  ctx.tourBanner?.classList.add("visible");
  ctx.tourBanner?.setAttribute("aria-hidden", "false");
}

function stopTour() {
  const controls = ctx.controls;
  if (!ctx.tour) return;
  if (controls) {
    controls.autoRotate = ctx.tour.savedAutoRotate && state.userSettings.autoRotate;
    controls.autoRotateSpeed = ctx.tour.savedAutoRotateSpeed;
  }
  if (ctx.followTarget) setFollowTarget(null);
  ctx.tour = null;
  ctx.tourButton?.classList.remove("active");
  updateTourButtonLabel(false);
  ctx.tourBanner?.classList.remove("visible");
  ctx.tourBanner?.setAttribute("aria-hidden", "true");
}

function toggleTour() {
  if (ctx.tour && ctx.tour.active) stopTour();
  else startTour();
}

const LOCATOR_NAMES = {
  walker: "Walker", flier: "Flier", sleeper: "Sleeper", burrower: "Burrower",
  kinling: "Kinling",
  fish: "Fish", angler: "Angler", bumblebee: "Bumblebee",
  caterpillar: "Caterpillar", snail: "Snail", butterfly: "Butterfly",
  bee: "Bee", bird: "Bird", willowisp: "Will-o'-Wisp",
  leafballtree: "Leafball Tree", mushroom: "Mushroom", bigmushroom: "Big Mushroom",
  berrybush: "Berry Bush", fern: "Fern", rock: "Rock", cactus: "Cactus",
  skull: "Skull", pillar: "Pillar", crystal: "Crystal", tree: "Tree",
  pine: "Pine", snowpine: "Snow Pine", reed: "Reed", lantern: "Lantern",
  deadtree: "Dead Tree", grass: "Tall Grass", balloontree: "Balloon Tree",
  coral: "Coral", braincoral: "Brain Coral", cupcoral: "Cup Coral",
  seaweed: "Seaweed", lavafissure: "Lava Fissure", obsidianshard: "Obsidian Shard",
  obsidianglass: "Obsidian Glass",
  archstone: "Arch Stone", limestonerock: "Limestone", beachsucculent: "Beach Succulent",
  fairyring: "Fairy Ring",
  veilcrown: "Veilcrown", pulsebell: "Pulsebells",
};

/**
 * Wire up the locator panel (L key): the entity-type list, fly-to-nearest +
 * follow-mode entry, Tab-to-cycle through instances of the last-located type,
 * and the cinematic tour toggle. `setFollowReleaseCallback` (world.js) is
 * hooked here so `generateWorld` releases any followed creature on regen.
 */
export function initLocatorPanel() {
  const { camera, canvas, controls } = ctx;
  const locatorPanel = document.getElementById("locator-panel");
  const locatorEyebrow = document.getElementById("locator-eyebrow");
  const followBanner = document.getElementById("follow-banner");
  ctx.followButton = document.getElementById("setting-follow");
  ctx.tourBanner = document.getElementById("tour-banner");
  ctx.tourButton = document.getElementById("setting-tour");

  // Hand world.js a release callback so generateWorld() can drop a stale follow.
  setFollowReleaseCallback(() => setFollowTarget(null));

  function setSelectingCreature(on) {
    ctx.selectingCreature = on;
    followBanner.classList.toggle("visible", on);
    followBanner.setAttribute("aria-hidden", on ? "false" : "true");
    canvas.style.cursor = on ? "crosshair" : "";
  }

  ctx.followButton.addEventListener("click", () => {
    if (ctx.followTarget) {
      setFollowTarget(null);
      return;
    }
    if (ctx.tour && ctx.tour.active) stopTour();
    setSelectingCreature(!ctx.selectingCreature);
  });

  if (ctx.tourButton) {
    ctx.tourButton.addEventListener("click", () => toggleTour());
  }

  function locatorEntityPos(e) {
    // Caterpillars/snails keep their group at origin; the head segment is the
    // moving anchor — same pattern as the follow camera in main.js.
    const anchor = e.trackingAnchor ?? (e.segments ? e.segments[0] : e.group);
    anchor.updateWorldMatrix(true, false);
    return anchor.getWorldPosition(new THREE.Vector3());
  }

  function locatorObjectPos(object) {
    object.updateWorldMatrix(true, false);
    return object.getWorldPosition(new THREE.Vector3());
  }

  function locatorSortByProximity(entities, getPos) {
    const tx = controls.target.x;
    const tz = controls.target.z;
    return [...entities].sort((a, b) => {
      const pa = getPos(a), pb = getPos(b);
      return ((pa.x - tx) ** 2 + (pa.z - tz) ** 2) - ((pb.x - tx) ** 2 + (pb.z - tz) ** 2);
    });
  }

  function locatorNavigateTo(pos, entity, isCreature) {
    // Set orbit target to the entity, slightly above ground.
    controls.target.set(pos.x, pos.y + 0.6, pos.z);
    // Zoom to a nice viewing distance if the camera is currently far away.
    const dist = camera.position.distanceTo(controls.target);
    if (dist > 18) {
      const dir = new THREE.Vector3()
        .subVectors(camera.position, controls.target)
        .normalize();
      camera.position.copy(controls.target).addScaledVector(dir, 15);
    }
    // Creatures enter tracking / follow mode.
    if (isCreature && entity) {
      setFollowTarget(entity);
    }
  }

  function populateLocator() {
    const list = document.getElementById("locator-list");
    const emptyEl = document.getElementById("locator-empty");
    list.innerHTML = "";

    // Collect entity types present in the current world.
    const creatureGroups = new Map(); // variant → [entity]

    // Walkers, fliers, sleepers, burrowers, fish, angler, bumblebee
    for (const c of state.creatures) {
      const variant = c.group.userData?.inspect?.variant ?? "walker";
      if (!creatureGroups.has(variant)) creatureGroups.set(variant, []);
      creatureGroups.get(variant).push(c);
    }

    // Caterpillars and snails
    for (const c of state.caterpillars) {
      const variant = c.group.userData?.inspect?.variant ?? "caterpillar";
      if (!creatureGroups.has(variant)) creatureGroups.set(variant, []);
      creatureGroups.get(variant).push(c);
    }

    // Butterflies
    if (state.butterflies.length) creatureGroups.set("butterfly", [...state.butterflies]);
    // Bees
    if (state.bees.length) creatureGroups.set("bee", [...state.bees]);
    // Will-o-wisps
    if (state.willowisps.length) creatureGroups.set("willowisp", [...state.willowisps]);
    // Birds
    const allBirds = [];
    for (const f of state.flocks) allBirds.push(...f.birds);
    if (allBirds.length) creatureGroups.set("bird", allBirds);

    // Flora — scan world children for inspect-tagged groups.
    // Exclude instanced ground cover (grass, wildflowers, pebbles) that blanket
    // the island — navigating to them isn't meaningful.
    const GROUND_COVER = LOCATOR_HIDDEN_FLORA_VARIANTS;
    const floraGroups = new Map(); // variant → [mesh]
    for (const child of state.world.children) {
      const inspect = child.userData?.inspect;
      if (!inspect || inspect.category !== "flora") continue;
      const v = inspect.variant;
      if (GROUND_COVER.has(v)) continue;
      if (!floraGroups.has(v)) floraGroups.set(v, []);
      floraGroups.get(v).push(child);
    }

    const hasContent = creatureGroups.size > 0 || floraGroups.size > 0;
    emptyEl.classList.toggle("visible", !hasContent);

    // Render creature section
    if (creatureGroups.size > 0) {
      const cat = document.createElement("div");
      cat.className = "locator-category";
      cat.textContent = "creatures";
      list.appendChild(cat);
      for (const [variant, entities] of creatureGroups) {
        const label = LOCATOR_NAMES[variant] ?? variant;
        const count = entities.length;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "locator-item";
        btn.innerHTML =
          `<span class="locator-item-label">${label}</span>` +
          `<span class="locator-item-count">${count}</span>`;
        btn.addEventListener("click", () => {
          setLocatorOpen(false);
          const sorted = locatorSortByProximity(entities, locatorEntityPos);
          ctx.locatorCycle = { entities: sorted, getPos: locatorEntityPos, isCreature: true, index: 0 };
          if (sorted[0]) locatorNavigateTo(locatorEntityPos(sorted[0]), sorted[0], true);
        });
        list.appendChild(btn);
      }
    }

    // Render flora section
    if (floraGroups.size > 0) {
      const cat = document.createElement("div");
      cat.className = "locator-category";
      cat.textContent = "flora";
      list.appendChild(cat);
      for (const [variant, meshes] of floraGroups) {
        const label = LOCATOR_NAMES[variant] ?? variant;
        const count = meshes.length;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "locator-item";
        btn.innerHTML =
          `<span class="locator-item-label">${label}</span>` +
          `<span class="locator-item-count">${count}</span>`;
        btn.addEventListener("click", () => {
          setLocatorOpen(false);
          // Sort flora by proximity to current camera target.
          const sorted = locatorSortByProximity(meshes, locatorObjectPos);
          ctx.locatorCycle = { entities: sorted, getPos: locatorObjectPos, isCreature: false, index: 0 };
          if (sorted[0]) locatorNavigateTo(locatorObjectPos(sorted[0]), null, false);
        });
        list.appendChild(btn);
      }
    }
  }

  function setLocatorOpen(open) {
    ctx.locatorOpen = open;
    locatorPanel.classList.toggle("open", open);
    locatorPanel.setAttribute("aria-hidden", open ? "false" : "true");
    if (open) {
      // Close other panels.
      ctx.setSettingsOpen(false);
      ctx.setHelpOpen(false);
      ctx.locatorCycle = null;
      populateLocator();
    }
  }

  document.getElementById("locator-close").addEventListener("click", () => setLocatorOpen(false));
  locatorEyebrow?.addEventListener("click", () => setLocatorOpen(!ctx.locatorOpen));

  ctx.setLocatorOpen = setLocatorOpen;
  ctx.setSelectingCreature = setSelectingCreature;
  ctx.setFollowTarget = setFollowTarget;
  ctx.locatorNavigateTo = locatorNavigateTo;
  ctx.stopTour = stopTour;
  ctx.toggleTour = toggleTour;
}
