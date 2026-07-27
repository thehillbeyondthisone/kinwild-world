// Global input + lifecycle glue (ARC-001 / QA-006 split): manual pause, the
// regenerate buttons, the 250ms seed-change watcher, canvas click-to-pick /
// portal-entry / shift-click-inspect, hover-to-wake, resize, popstate, the
// mobile header fade, and the master keyboard handler that routes shortcuts to
// every other panel/mode via ctx. This is the cross-cutting glue that ties the
// sub-modules together, so it initialises last.
import * as THREE from "three";
import { state } from "../state.js";
import { readSeedFromUrl, readBiomeFromUrl } from "../seed.js";
import { generateWorld } from "../world.js";
import { wakeCreature, lookAtCreature } from "../fauna.js";
import { getPortalSideEntryPose } from "../portal.js";
import { rendererPixelRatioCap } from "../lowfx.js";
import { shouldUseMobileHud } from "./storage.js";
import { enterStrollFromPortal } from "./first-person.js";
import { ctx } from "./context.js";

const _portalClickCam = new THREE.Vector3();
function getPortalClickSide(portal, camera) {
  const center = portal.group.position;
  const cameraLocal = state.world.worldToLocal(_portalClickCam.copy(camera.position));
  const yaw = portal.group.rotation.y;
  const nx = Math.sin(yaw);
  const nz = Math.cos(yaw);
  const side = (cameraLocal.x - center.x) * nx + (cameraLocal.z - center.z) * nz;
  return side >= 0 ? 1 : -1;
}

function setManualPaused(on) {
  ctx.manualPause = on;
  const banner = document.getElementById("pause-banner");
  if (banner) {
    banner.classList.toggle("visible", on);
    banner.setAttribute("aria-hidden", on ? "false" : "true");
  }
}

/**
 * Wire up global input and lifecycle glue: manual pause, the regenerate
 * buttons, the 250ms seed-change watcher, canvas click-to-pick /
 * portal-entry / shift-click-inspect, hover-to-wake, resize, popstate, the
 * mobile header fade, and the master keyboard handler that routes shortcuts
 * to every other panel/mode via `ctx`. This is the cross-cutting glue that
 * ties the sub-modules together, so `initUi` calls it last.
 */
export function initInput() {
  const { camera, canvas, renderer } = ctx;
  ctx.setManualPaused = setManualPaused;

  const helpPanel = document.getElementById("help-panel");
  const settingsPanel = document.getElementById("settings-panel");

  // Regenerate world buttons — guarded so a rapid double-click can't queue a
  // second rebuild while the fade-out + generateWorld pass is still in flight.
  let _regenInFlight = false;
  function wireRegenButton(id, pickSeed) {
    document.getElementById(id).addEventListener("click", () => {
      if (_regenInFlight) return;
      _regenInFlight = true;
      const overlay = document.createElement("div");
      overlay.style.cssText = `
        position:fixed; inset:0; background:#000; z-index:50; pointer-events:none;
        opacity:0; transition:opacity .35s ease;`;
      document.body.appendChild(overlay);
      requestAnimationFrame(() => (overlay.style.opacity = "0.7"));
      setTimeout(async () => {
        try {
          await generateWorld(pickSeed());
        } catch (error) {
          console.error("World generation failed", error);
        }
        overlay.style.opacity = "0";
        setTimeout(() => {
          overlay.remove();
          _regenInFlight = false;
        }, 400);
      }, 360);
    });
  }
  wireRegenButton("regen-same-biome", () => ctx.pickSameBiomeSeed());
  wireRegenButton("regen-random-biome", () => ctx.pickRandomBiomeSeed());

  // Refresh seed-dependent HUD/panels whenever the world changes (regen via
  // button, popstate, or bookmark click). The simplest hook is a polling
  // watcher on state.currentSeed — it changes rarely and the cost is trivial.
  // Wind/grass re-baselining happens via the "world-ready" listener in
  // settings-panel.js (ARC-005); this poll catches the other seed-change side
  // effects (bookmark label, photo HUD seed, biome overrides, music track
  // select, locator reset).
  let _lastSeenSeed = state.currentSeed;
  setInterval(() => {
    if (state.currentSeed !== _lastSeenSeed) {
      _lastSeenSeed = state.currentSeed;
      ctx.syncBookmarkButton();
      ctx.syncPhotoSeed();
      ctx.syncBiomeOverrideSettings();
      ctx.refreshMusicTrackSelect();
      // Close the locator on regen — entity references are stale.
      if (ctx.locatorOpen) ctx.setLocatorOpen(false);
      ctx.locatorCycle = null;
    }
  }, 250);

  // Also regenerate when seed changes via back/forward navigation.
  window.addEventListener("popstate", () => {
    const s = readSeedFromUrl();
    if (s !== null) {
      void generateWorld(s, undefined, { biomeId: readBiomeFromUrl() }).catch((error) => {
        console.error("World generation failed", error);
      });
    }
  });

  function handleResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, rendererPixelRatioCap()));
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener("resize", handleResize);
  window.addEventListener("orientationchange", handleResize);

  // On mobile/touch devices, fade out the header 5 seconds after world loads.
  // Touching the header area brings it back temporarily.
  // Override: ?mobile=1 forces mobile, ?mobile=0 forces desktop.
  // Auto-detect: touch input + small viewport or physical screen.
  const _isMobile = shouldUseMobileHud();
  if (_isMobile) {
    document.body.classList.add("mobile");
    const header = document.querySelector(".hud-top");
    header.classList.add("mobile");
    ctx.syncFlyTouchControls();
    const keepHeader =
      document.body.classList.contains("living-world-mode");
    if (keepHeader) {
      header.style.opacity = "1";
      header.style.pointerEvents = "auto";
    } else {
      let _headerTimer = null;
      function scheduleHeaderFade() {
        clearTimeout(_headerTimer);
        header.style.animation = 'none'; // release hudIn fill hold
        header.style.transition = '';
        header.style.opacity = '1';
        header.style.pointerEvents = 'auto';
        _headerTimer = setTimeout(() => {
          header.style.transition = 'opacity 1.5s ease';
          header.style.opacity = '0';
          header.style.pointerEvents = 'none';
        }, 5000);
      }
      window.addEventListener("world-ready", scheduleHeaderFade);
      // If the world is already loaded (e.g. late registration), start now
      if (state.currentBiome) scheduleHeaderFade();
      // Tap header area to temporarily reveal it
      header.addEventListener("pointerdown", () => {
        scheduleHeaderFade();
      });
    }
  }

  // Click-to-pick a creature. Selection mode pauses the sim and shows the
  // crosshair, but any creature hit now promotes to persistent follow so the
  // camera keeps tracking until the user releases it. Drags are distinguished
  // from clicks by motion threshold so OrbitControls can still rotate freely.
  const _raycaster = new THREE.Raycaster();
  const _ndc = new THREE.Vector2();
  let _downX = 0;
  let _downY = 0;
  let _downT = 0;
  canvas.addEventListener("pointerdown", (e) => {
    _downX = e.clientX;
    _downY = e.clientY;
    _downT = performance.now();
  });
  canvas.addEventListener("pointerup", (e) => {
    const moved = Math.hypot(e.clientX - _downX, e.clientY - _downY);
    const dur = performance.now() - _downT;
    if (moved > 6 || dur > 400) return; // a drag, not a click
    const rect = canvas.getBoundingClientRect();
    _ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _ndc.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    _raycaster.setFromCamera(_ndc, camera);
    // Shift-click: open the inspector view in a new tab for whatever the
    // ray hits (creatures, caterpillars, flora, ground cover). We walk up
    // each hit's parent chain looking for an ancestor tagged with
    // userData.inspect, so non-inspectable hits (terrain, sky) get skipped
    // naturally as we move to the next-closest hit.
    if (e.shiftKey) {
      const hits = _raycaster.intersectObject(state.world, true);
      for (const h of hits) {
        let n = h.object;
        while (n && !n.userData?.inspect) n = n.parent;
        if (!n) continue;
        // Generated living-world subjects do not map to the legacy inspector's
        // fixed variant catalogue. Keep them in-world until their own
        // generative presentation exists instead of opening a broken view.
        if (n.userData?.livingWorld) return;
        const { category, variant } = n.userData.inspect;
        if (category === "flora" && variant === "water") continue;
        const biomeId = state.currentBiome?.id;
        if (!biomeId) return;
        const sp = new URLSearchParams();
        sp.set("inspect", "1");
        sp.set("category", category);
        sp.set("biome", biomeId);
        sp.set("variant", variant);
        if (n.userData.inspect.fur != null) sp.set("fur", n.userData.inspect.fur);
        if (n.userData.inspect.color != null) sp.set("color", n.userData.inspect.color);
        const pi = n.userData.inspect;
        if (pi.patternType) sp.set("patternType", pi.patternType);
        if (pi.patternColor) sp.set("patternColor", pi.patternColor);
        if (pi.stripeBandCount != null) sp.set("stripeBandCount", pi.stripeBandCount);
        if (pi.stripeBandWidth != null) sp.set("stripeBandWidth", pi.stripeBandWidth);
        if (pi.stripeOffset != null) sp.set("stripeOffset", pi.stripeOffset);
        if (pi.patternScale != null) sp.set("patternScale", pi.patternScale);
        const url = window.location.pathname + "?" + sp.toString();
        window.open(url, "_blank", "noopener,noreferrer");
        return;
      }
      return;
    }
    if (!ctx.photoFP && !ctx.flyFP) {
      const portals = state.portals ?? [];
      const portalHits = _raycaster.intersectObjects(portals.map((portal) => portal.group), true);
      if (portalHits.length) {
        let portalRoot = portalHits[0].object;
        while (portalRoot && !portals.some((portal) => portal.group === portalRoot)) portalRoot = portalRoot.parent;
        const portal = portals.find((candidate) => candidate.group === portalRoot);
        if (portal) {
          const side = getPortalClickSide(portal, camera);
          const pose = getPortalSideEntryPose(portal, side);
          enterStrollFromPortal(pose.x, pose.z, pose.yaw);
          return;
        }
      }
    }
    const birds = [];
    for (const f of state.flocks) for (const b of f.birds) birds.push(b);
    const targets = [
      ...state.creatures.map((c) => c.group),
      ...state.caterpillars.map((c) => c.group),
      ...birds.map((b) => b.group),
    ];
    const hits = _raycaster.intersectObjects(targets, true);
    // Only creature/bird hits count. Clicks on terrain, trees, water, or
    // empty sky are ignored so the user can freely look around / drag the
    // camera while selection mode is active without accidentally cancelling.
    if (hits.length === 0) return;
    let hitRoot = hits[0].object;
    while (hitRoot && !targets.includes(hitRoot)) hitRoot = hitRoot.parent;
    if (!hitRoot) return;
    const creature =
      state.creatures.find((c) => c.group === hitRoot) ||
      state.caterpillars.find((c) => c.group === hitRoot) ||
      birds.find((b) => b.group === hitRoot);
    if (!creature) return;
    // brief look-at-camera response — applies to creatures, not caterpillars/birds
    if (state.creatures.includes(creature)) lookAtCreature(creature);
    ctx.setFollowTarget(creature);
    if (ctx.selectingCreature) ctx.setSelectingCreature(false);
  });

  // Hover behavior — wakes sleepers, and triggers a brief look-at-camera
  // response on any awake creature the cursor lingers over. Throttled and
  // gated on a "different creature than last frame" check so a stationary
  // cursor doesn't continually re-trigger the same look.
  let _lastHoverTs = 0;
  let _lastLookedAt = null;
  canvas.addEventListener("mousemove", (e) => {
    const now = performance.now();
    if (now - _lastHoverTs < 60) return; // throttle to ~16Hz
    _lastHoverTs = now;
    if (state.creatures.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    _ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _ndc.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    _raycaster.setFromCamera(_ndc, camera);
    const groups = state.creatures.map((c) => c.group);
    const hits = _raycaster.intersectObjects(groups, true);
    if (!hits.length) {
      _lastLookedAt = null;
      return;
    }
    const hitObj = hits[0].object;
    let root = hitObj;
    while (root && !groups.includes(root)) root = root.parent;
    if (!root) return;
    const c = state.creatures.find((s) => s.group === root);
    if (!c) return;
    // Fur shells extend the body's raycast silhouette outward, which would
    // wake fuzzy sleepers from cursor positions that aren't actually over the
    // visible body. Treat a fur-shell-only hit as a passive look-at.
    const furOnly = !!hitObj?.userData?.isFurShell;
    const looksAsleep =
      c.isSleeper ||
      (!c.flies && c.sleepiness > 0.4) ||
      (c.flies && !c.isFish && c.sleepiness > 0.4);
    if (looksAsleep) {
      if (!furOnly) wakeCreature(c);
    } else if (c !== _lastLookedAt) {
      lookAtCreature(c);
      _lastLookedAt = c;
    }
  });

  window.addEventListener("keydown", (e) => {
    // Ignore keys when a form control or editable element has focus (e.g. the
    // music dropdown) so its own key handling (or plain typing) isn't
    // hijacked by regen/pause/etc. shortcuts. `initUi` is only called when
    // `!INSPECT` (see main.js), so an `if (INSPECT) return` guard here would
    // be unreachable dead code.
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable) return;
    if (e.key === "Escape") {
      if (ctx.photoReview) { ctx.closePhotoReview({ resumePhotoFp: false }); ctx.setPhotoMode(false); }
      else if (ctx.tour && ctx.tour.active) ctx.stopTour();
      else if (ctx.stroll) ctx.exitStroll();
      else if (ctx.flyFP) ctx.exitFlyMode();
      else if (document.body.classList.contains("photo-mode")) ctx.setPhotoMode(false);
      else if (ctx.catalogOpen) ctx.setCatalogOpen(false);
      else if (ctx.locatorOpen) ctx.setLocatorOpen(false);
      else if (ctx.selectingCreature) ctx.setSelectingCreature(false);
      else if (ctx.followTarget) ctx.setFollowTarget(null);
      else if (helpPanel.classList.contains("open")) ctx.setHelpOpen(false);
      else if (settingsPanel.classList.contains("open")) ctx.setSettingsOpen(false);
    } else if (e.key === "p" || e.key === "P") {
      ctx.setPhotoMode(!document.body.classList.contains("photo-mode"));
    } else if (e.key === "f" || e.key === "F") {
      e.preventDefault();
      if (ctx.stroll) ctx.exitStroll();
      else ctx.enterStroll();
    } else if (e.key === "v" || e.key === "V") {
      e.preventDefault();
      if (document.body.classList.contains("photo-mode")) return;
      if (ctx.flyFP) ctx.exitFlyMode();
      else ctx.enterFlyMode();
    } else if (e.key === "l" || e.key === "L") {
      e.preventDefault();
      if (ctx.stroll || ctx.flyFP || document.body.classList.contains("photo-mode")) return;
      ctx.setLocatorOpen(!ctx.locatorOpen);
    } else if (e.key === "g" || e.key === "G") {
      e.preventDefault();
      if (ctx.stroll || ctx.flyFP || document.body.classList.contains("photo-mode")) return;
      ctx.toggleCatalogPanel();
    } else if (e.key === "t" || e.key === "T") {
      e.preventDefault();
      ctx.toggleTour();
    } else if (e.key === "Tab" && ctx.locatorCycle) {
      e.preventDefault();
      const { isCreature } = ctx.locatorCycle;
      // Skip entities removed by regen (group no longer in the scene).
      while (ctx.locatorCycle.entities.length > 0) {
        const candidate = ctx.locatorCycle.entities[ctx.locatorCycle.index];
        const stillValid = candidate.group ? candidate.group.parent !== null : candidate.parent !== null;
        if (stillValid) break;
        ctx.locatorCycle.entities.splice(ctx.locatorCycle.index, 1);
        if (ctx.locatorCycle.index >= ctx.locatorCycle.entities.length) ctx.locatorCycle.index = 0;
      }
      if (ctx.locatorCycle.entities.length === 0) { ctx.locatorCycle = null; return; }
      ctx.locatorCycle.index = (ctx.locatorCycle.index + 1) % ctx.locatorCycle.entities.length;
      const entity = ctx.locatorCycle.entities[ctx.locatorCycle.index];
      const pos = ctx.locatorCycle.getPos(entity);
      ctx.locatorNavigateTo(pos, isCreature ? entity : null, isCreature);
    } else if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      document.getElementById("regen-random-biome").click();
    } else if (e.key === ",") {
      e.preventDefault();
      const opening = !settingsPanel.classList.contains("open");
      if (opening) { ctx.setHelpOpen(false); ctx.setLocatorOpen(false); }
      ctx.setSettingsOpen(opening);
    } else if (e.key === " " || e.code === "Space") {
      // Spacebar toggles a manual sim pause. Stroll / selection freeze
      // the sim on their own so skip in those modes. In photo mode the sim
      // is frozen by default; Space unfreezes it for action shots.
      if (ctx.stroll || ctx.flyFP || ctx.selectingCreature) return;
      e.preventDefault();
      setManualPaused(!ctx.manualPause);
    }
  });
}
