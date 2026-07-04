// Photo mode + 3D photo review + reticle catalog capture (ARC-001 / QA-006
// split). Reuses makeFirstPersonMode() / applyStrollVisualComfort() from
// first-person.js, and reaches into ctx.catalogStore / ctx.renderCatalogPanel
// to save framed subjects to the Field Guide.
import * as THREE from "three";
import { state } from "../state.js";
import { formatSeed } from "../seed.js";
import { findPhotoCatalogSubject } from "../photoSubject.js";
import { PHOTO_REVIEW_DIM_RENDER_ORDER, PHOTO_REVIEW_DIM_OPACITY } from "./constants.js";
import { makeFirstPersonMode, applyStrollVisualComfort } from "./first-person.js";
import { ctx } from "./context.js";

export function getPhotoReviewGroup() {
  return ctx.photoReview?.group ?? null;
}

export function isPhotoMode() {
  return document.body.classList.contains("photo-mode");
}

export function initPhotoMode() {
  const { camera, canvas, controls } = ctx;

  const photoHudEl = document.getElementById("photo-hud");
  const photoZoomEl = document.getElementById("photo-zoom");
  const photoSeedEl = document.getElementById("photo-seed");
  const photoSeedValueEl = document.getElementById("photo-seed-value");
  const PHOTO_BASE_FOV = 50;
  const PHOTO_FOV_MIN = PHOTO_BASE_FOV / 5.0; // ×5.0 zoom
  const PHOTO_FOV_MAX = PHOTO_BASE_FOV / 0.5; // ×0.5 zoom

  function _updatePhotoZoom() {
    if (!ctx.photoFP) return;
    const zoom = PHOTO_BASE_FOV / camera.fov;
    photoZoomEl.textContent = `×${Math.min(5.0, Math.max(0.5, zoom)).toFixed(1)}`;
  }

  let _photoSavedAutoRotate = controls.autoRotate;
  function capturePhoto() {
    if (ctx.photoReview || ctx.photoFP?.reviewOpen) return;
    if (ctx.photoFP) {
      ctx.photoFP.reviewOpen = true;
      for (const key of Object.keys(ctx.photoFP.keys)) ctx.photoFP.keys[key] = false;
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    }
    const seedTag = formatSeed(state.currentSeed).replace(/^0x/, "");
    const biomeTag = (state.currentBiome?.id ?? "world").replace(/\s+/g, "-");
    const catalogHit = findPhotoCatalogSubject({ camera, root: state.world });
    const url = canvas.toDataURL("image/png");

    // Shutter flash (0.1s white overlay)
    const flash = document.createElement("div");
    flash.style.cssText =
      "position:fixed;inset:0;background:#fff;z-index:50;pointer-events:none;opacity:0.85;transition:opacity .1s ease;";
    document.body.appendChild(flash);
    requestAnimationFrame(() => (flash.style.opacity = "0"));
    setTimeout(() => flash.remove(), 150);

    // After flash, show the 3D photo review
    setTimeout(() => showPhotoReview(url, biomeTag, seedTag, catalogHit?.subject ?? null), 120);
  }

  async function photoDataUrlToBlob(dataUrl) {
    const res = await fetch(dataUrl);
    return res.blob();
  }

  function loadPhotoImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  async function makeCatalogThumbnailBlob(dataUrl) {
    try {
      const img = await loadPhotoImage(dataUrl);
      const maxW = 360;
      const scale = Math.min(1, maxW / img.naturalWidth);
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      return await new Promise((resolve) => {
        c.toBlob((blob) => resolve(blob), "image/webp", 0.82);
      }) ?? photoDataUrlToBlob(dataUrl);
    } catch {
      return photoDataUrlToBlob(dataUrl);
    }
  }

  async function saveCatalogPhoto(subject, dataUrl, mode, statusEl) {
    statusEl.textContent = "saving catalog photo...";
    const blob = await makeCatalogThumbnailBlob(dataUrl);
    const result = mode === "replace"
      ? await ctx.catalogStore.replacePhoto({ subject, seed: state.currentSeed, blob })
      : await ctx.catalogStore.savePhoto({ subject, seed: state.currentSeed, blob });
    statusEl.textContent = result.status === "exists"
      ? "already in catalog"
      : "saved to catalog";
    if (ctx.catalogOpen) await ctx.renderCatalogPanel();
    return result;
  }

  async function renderPhotoCatalogActions(actions, subject, dataUrl) {
    const catalogEl = document.createElement("div");
    catalogEl.className = "photo-review-catalog";
    actions.prepend(catalogEl);

    if (!subject) {
      const emptyStatus = document.createElement("div");
      emptyStatus.className = "photo-review-catalog-status photo-review-catalog-empty-status";
      emptyStatus.textContent = "no catalog subject in reticle";
      catalogEl.appendChild(emptyStatus);
      return;
    }

    const frameLabel = document.createElement("div");
    frameLabel.className = "photo-review-frame-label";
    frameLabel.textContent = subject.label;
    catalogEl.appendChild(frameLabel);

    const existing = ctx.catalogStore.getEntry(subject.key);
    const status = document.createElement("div");
    status.className = "photo-review-catalog-status";
    status.textContent = existing
      ? `already in catalog · ${subject.label}`
      : `new catalog entry · ${subject.label}`;
    catalogEl.appendChild(status);

    if (existing) {
      const currentBlob = await ctx.catalogStore.getPhotoBlob(subject.key);
      if (currentBlob && ctx.photoReview) {
        const currentUrl = URL.createObjectURL(currentBlob);
        ctx.photoReview.objectUrls.push(currentUrl);
        const compare = document.createElement("div");
        compare.className = "photo-review-compare";
        compare.innerHTML = `
          <figure><img src="${currentUrl}" alt="current catalog photo"><figcaption>current</figcaption></figure>
          <figure><img src="${dataUrl}" alt="new catalog photo"><figcaption>new</figcaption></figure>
        `;
        catalogEl.appendChild(compare);
      }
      const keep = document.createElement("button");
      keep.className = "photo-action photo-review-keep";
      keep.type = "button";
      keep.textContent = "keep current";
      keep.addEventListener("click", () => closePhotoReview());
      const replace = document.createElement("button");
      replace.className = "photo-action photo-review-replace";
      replace.type = "button";
      replace.textContent = "replace";
      replace.addEventListener("click", async () => {
        const priorStatus = status.textContent;
        try {
          await saveCatalogPhoto(subject, dataUrl, "replace", status);
          closePhotoReview();
        } catch (error) {
          // QA-020: an IndexedDB failure would otherwise leave the status
          // label stuck on "saving catalog photo..." forever.
          console.error("Failed to replace catalog photo", error);
          status.textContent = "save failed — try again";
          setTimeout(() => { status.textContent = priorStatus; }, 1800);
        }
      });
      catalogEl.append(keep, replace);
    } else {
      const save = document.createElement("button");
      save.className = "photo-action photo-review-catalog-save";
      save.type = "button";
      save.textContent = "save to catalog";
      save.addEventListener("click", async () => {
        const priorStatus = status.textContent;
        try {
          await saveCatalogPhoto(subject, dataUrl, "save", status);
          closePhotoReview();
        } catch (error) {
          console.error("Failed to save catalog photo", error);
          status.textContent = "save failed — try again";
          setTimeout(() => { status.textContent = priorStatus; }, 1800);
        }
      });
      catalogEl.appendChild(save);
    }
  }

  // ── 3D Photo review ──────────────────────────────────────────────────
  function showPhotoReview(dataUrl, biomeTag, seedTag, catalogSubject = null) {
    if (ctx.photoReview) return;
    const tex = new THREE.TextureLoader().load(dataUrl);
    tex.colorSpace = THREE.SRGBColorSpace;
    const aspect = canvas.width / canvas.height;
    const h = 1.6;
    const w = h * aspect;

    // Photo group: white border plane behind + photo plane in front
    const group = new THREE.Group();
    const borderPad = 0.15;
    const borderGeo = new THREE.PlaneGeometry(w + borderPad * 2, h + borderPad * 2);
    const borderMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
    });
    const borderMesh = new THREE.Mesh(borderGeo, borderMat);
    borderMesh.position.z = -0.01;
    borderMesh.renderOrder = 999;
    group.add(borderMesh);

    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 1000;
    group.add(mesh);

    // Position photo in front of camera
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    // Scale distance and size by FOV so the photo appears at a consistent
    // screen size regardless of zoom level. 50° is the reference FOV.
    const fovScale = camera.fov / 50;
    const dist = 6 * fovScale;
    group.position.copy(camera.position).addScaledVector(dir, dist);
    group.quaternion.copy(camera.quaternion);
    // Scale the group so its screen footprint stays roughly constant
    const screenScale = fovScale;
    group.scale.set(screenScale, screenScale, screenScale);
    // Don't add to scene during main render — see main.js post-fx overlay

    const dimH = (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / screenScale;
    const dimW = dimH * aspect;
    const dimGeo = new THREE.PlaneGeometry(dimW, dimH);
    const dimMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
    });
    const dimMesh = new THREE.Mesh(dimGeo, dimMat);
    dimMesh.position.z = -0.03;
    dimMesh.renderOrder = PHOTO_REVIEW_DIM_RENDER_ORDER;
    group.add(dimMesh);
    dimMat.opacity = PHOTO_REVIEW_DIM_OPACITY;

    // Save / Discard buttons
    const actions = document.createElement("div");
    actions.className = "photo-review-actions";
    actions.innerHTML = `
      <button class="photo-action photo-review-save" type="button">save</button>
      <button class="photo-action photo-review-discard" type="button">discard</button>
    `;
    document.body.appendChild(actions);

    photoSeedEl.setAttribute("aria-hidden", "true");
    photoHudEl.setAttribute("aria-hidden", "true");
    ctx.photoReview = {
      group,
      mesh,
      borderMesh,
      dimMesh,
      tex,
      mat,
      borderMat,
      dimMat,
      actions,
      biomeTag,
      seedTag,
      dataUrl,
      catalogSubject,
      objectUrls: [],
      screenScale,
    };
    void renderPhotoCatalogActions(actions, catalogSubject, dataUrl);

    // Animate photo in
    const start = performance.now();
    const animIn = () => {
      if (!ctx.photoReview) return;
      const t = Math.min(1, (performance.now() - start) / 300);
      mat.opacity = t;
      borderMat.opacity = t;
      const s = (0.85 + 0.15 * t) * screenScale;
      group.scale.set(s, s, s);
      if (t < 1) requestAnimationFrame(animIn);
    };
    requestAnimationFrame(animIn);

    // Wire buttons
    actions.querySelector(".photo-review-save").addEventListener("click", () => {
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `small-world-${biomeTag}-${seedTag}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      closePhotoReview();
    });
    actions.querySelector(".photo-review-discard").addEventListener("click", closePhotoReview);
  }

  function closePhotoReview({ resumePhotoFp = true } = {}) {
    if (!ctx.photoReview) return;
    const { group, mesh, borderMesh, dimMesh, tex, mat, borderMat, dimMat, actions, objectUrls } = ctx.photoReview;
    for (const url of objectUrls ?? []) URL.revokeObjectURL(url);
    mat.opacity = 0;
    borderMat.opacity = 0;
    dimMat.opacity = 0;
    const ss = ctx.photoReview.screenScale;
    group.scale.set(0.9 * ss, 0.9 * ss, 0.9 * ss);
    setTimeout(() => {
      // Group is not in the scene (rendered separately after postfx)
      mesh.geometry.dispose();
      mat.dispose();
      borderMesh.geometry.dispose();
      borderMat.dispose();
      dimMesh.geometry.dispose();
      dimMat.dispose();
      tex.dispose();
    }, 50);
    actions.remove();
    ctx.photoReview = null;
    if (ctx.photoFP) {
      ctx.photoFP.reviewOpen = false;
      if (resumePhotoFp && document.body.classList.contains("photo-mode")) {
        photoSeedEl.setAttribute("aria-hidden", "false");
        photoHudEl.setAttribute("aria-hidden", "false");
        canvas.requestPointerLock?.().catch(() => {});
      }
    }
  }
  const photoModeBtn = document.getElementById("setting-photo");
  const photoModeLabel = document.getElementById("setting-photo-label");
  function syncPhotoModeButton() {
    const on = document.body.classList.contains("photo-mode");
    photoModeBtn.classList.toggle("active", on);
    photoModeLabel.textContent = on ? "exit photo mode" : "photo mode";
  }
  const photoMode = makeFirstPersonMode({
    canvas,
    getFp: () => ctx.photoFP,
    extraKeys: ["e", "q"],
    ignoreLockLossIf: (fp) => fp.reviewOpen,
  });
  photoMode.setExitFn(() => setPhotoMode(false));
  function setPhotoMode(on) {
    if (on) {
      if (ctx.stroll) ctx.exitStroll();
      if (ctx.flyFP) ctx.exitFlyMode();
      if (ctx.tour && ctx.tour.active) ctx.stopTour();
      if (ctx.locatorOpen) ctx.setLocatorOpen(false);
      if (ctx.catalogOpen) ctx.setCatalogOpen(false);
      ctx.setFollowTarget(null);
      ctx.setSelectingCreature(false);
      ctx.setSettingsOpen(false);

      // Auto-pause the sim for still captures; Space toggles for action shots
      if (!ctx.manualPause) ctx.setManualPaused(true);

      // Save orbit state for restore
      _photoSavedAutoRotate = controls.autoRotate;
      controls.autoRotate = false;
      controls.enabled = false;

      // Compute initial yaw and pitch from current camera orientation
      camera.updateMatrixWorld();
      const lookDir = new THREE.Vector3();
      camera.getWorldDirection(lookDir);
      const yaw = Math.atan2(-lookDir.x, -lookDir.z);
      const pitch = Math.asin(Math.max(-1, Math.min(1, lookDir.y)));

      ctx.photoFP = {
        camera,
        controls,
        savedCam: {
          pos: camera.position.clone(),
          target: controls.target.clone(),
          fov: camera.fov,
          autoRotate: _photoSavedAutoRotate,
        },
        yaw,
        pitch,
        fly: true, // free-flight — no terrain lock
        keys: { w: false, a: false, s: false, d: false, shift: false, space: false, ctrl: false, e: false, q: false },
        hasPointerLock: false,
        reviewOpen: false,
      };
      camera.fov = PHOTO_BASE_FOV;
      camera.updateProjectionMatrix();

      document.body.classList.add("photo-mode");
      photoSeedEl.setAttribute("aria-hidden", "false");
      photoHudEl.setAttribute("aria-hidden", "false");
      _updatePhotoZoom();
      photoMode.requestPointerLock();

      const onWheel = (e) => {
        if (!ctx.photoFP) return;
        e.preventDefault();
        const delta = e.deltaY > 0 ? 2 : -2;
        camera.fov = Math.max(PHOTO_FOV_MIN, Math.min(PHOTO_FOV_MAX, camera.fov + delta));
        camera.updateProjectionMatrix();
        _updatePhotoZoom();
      };
      const onClick = (e) => {
        if (!ctx.photoFP) return;
        if (e.button === 0) capturePhoto();
      };
      document.addEventListener("mousemove", photoMode.onMove);
      canvas.addEventListener("wheel", onWheel, { passive: false });
      canvas.addEventListener("mousedown", onClick);
      window.addEventListener("keydown", photoMode.onKeyDown);
      window.addEventListener("keyup", photoMode.onKeyUp);
      document.addEventListener("pointerlockchange", photoMode.onLockChange);
      ctx.photoFP.handlers = { onWheel, onClick };
      applyStrollVisualComfort(true);
    } else {
      // Close any open photo review first
      if (ctx.photoReview) closePhotoReview({ resumePhotoFp: false });
      if (!ctx.photoFP) { syncPhotoModeButton(); return; }
      const { handlers, savedCam } = ctx.photoFP;
      document.removeEventListener("mousemove", photoMode.onMove);
      canvas.removeEventListener("wheel", handlers.onWheel);
      canvas.removeEventListener("mousedown", handlers.onClick);
      window.removeEventListener("keydown", photoMode.onKeyDown);
      window.removeEventListener("keyup", photoMode.onKeyUp);
      document.removeEventListener("pointerlockchange", photoMode.onLockChange);
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();

      camera.position.copy(savedCam.pos);
      controls.target.copy(savedCam.target);
      camera.fov = savedCam.fov;
      camera.updateProjectionMatrix();
      controls.autoRotate = savedCam.autoRotate && state.userSettings.autoRotate;
      controls.enabled = true;
      ctx.photoFP = null;

      // Unpause the sim when exiting photo mode
      ctx.setManualPaused(false);

      document.body.classList.remove("photo-mode");
      photoSeedEl.setAttribute("aria-hidden", "true");
      photoHudEl.setAttribute("aria-hidden", "true");
      applyStrollVisualComfort(false);
    }
    syncPhotoModeButton();
  }
  photoModeBtn.addEventListener("click", () => {
    setPhotoMode(!document.body.classList.contains("photo-mode"));
  });
  document.getElementById("photo-save").addEventListener("click", capturePhoto);
  document.getElementById("photo-exit").addEventListener("click", () => setPhotoMode(false));
  syncPhotoModeButton();

  photoSeedValueEl.textContent = formatSeed(state.currentSeed);
  ctx.syncPhotoSeed = () => {
    photoSeedValueEl.textContent = formatSeed(state.currentSeed);
  };
  ctx.setPhotoMode = setPhotoMode;
  ctx.capturePhoto = capturePhoto;
  ctx.closePhotoReview = closePhotoReview;
}
