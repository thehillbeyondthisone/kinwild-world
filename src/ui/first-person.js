// First-person camera modes (ARC-001 / QA-006 split): the shared
// makeFirstPersonMode() factory (QA-007), the stepStroll() per-frame
// integrator, and the stroll + main-view fly enter/exit wiring (including the
// mobile fly touch controls). Photo mode reuses makeFirstPersonMode() and
// applyStrollVisualComfort() from here.
import * as THREE from "three";
import { state } from "../state.js";
import { islandFalloff, nearestCenter } from "../terrain.js";
import { ctx } from "./context.js";

export function isStrolling() {
  return ctx.stroll !== null;
}

export function isPhotoFP() {
  return ctx.photoFP !== null;
}

export function isFlyMode() {
  return ctx.flyFP !== null;
}

export function isAnyFP() {
  return ctx.stroll !== null || ctx.flyFP !== null || ctx.photoFP !== null;
}

export function applyStrollVisualComfort(on) {
  // Big surrounding cloud halos look lovely from orbit but wash out the view
  // when the camera is inside them. Hide them only during first-person stroll;
  // ground-level cloud puffs still provide close-up texture.
  if (state.currentBiome?.cloudlike && state.cloudSwirl) {
    state.cloudSwirl.visible = !on;
  }
  if (state.currentBiome?.cloudlike && state.mountains) {
    state.mountains.visible = !on;
  }
}

export function clampFirstPersonPitch(fp) {
  const lim = Math.PI / 2 - 0.05;
  if (fp.pitch > lim) fp.pitch = lim;
  if (fp.pitch < -lim) fp.pitch = -lim;
}

// QA-007: stroll, main-view fly, and photo mode each re-implemented the same
// mouse-look handler (identical sensitivity constant + pitch clamp), WASD(+
// extra) key-mapping bookkeeping, and pointer-lock state machine (including
// the retry-on-next-click fallback needed when pointer lock is requested
// outside a user gesture, e.g. portal arrival). One factory instance per
// mode keeps each mode's own extras — stroll's ground snap + eye height, fly's
// touch joystick, photo's review-mode lock-loss guard — in that mode's own
// enter/exit function; only the genuinely duplicated plumbing lives here, so
// a fix to it (like the pointer-lock retry) reaches all three automatically.
// `getFp` reads the mode's own ctx state field (`ctx.stroll` / `ctx.flyFP` /
// `ctx.photoFP`) so this factory never needs to be told when a mode starts or
// stops — the enter/exit functions just assign that field as they already did.
export function makeFirstPersonMode({ canvas, getFp, extraKeys = [], ignoreLockLossIf, sens = 0.0022 }) {
  const knownKeys = new Set(["w", "a", "s", "d", "shift", ...extraKeys]);
  let exitFn = () => {};

  function onMove(e) {
    const fp = getFp();
    if (!fp) return;
    if (document.pointerLockElement !== canvas) return;
    fp.yaw -= e.movementX * sens;
    fp.pitch -= e.movementY * sens;
    clampFirstPersonPitch(fp);
  }
  function makeKeyHandler(down) {
    return (e) => {
      const fp = getFp();
      if (!fp) return;
      const k = e.key.toLowerCase();
      if (!knownKeys.has(k)) return;
      fp.keys[k] = down;
      e.preventDefault();
    };
  }
  const onKeyDown = makeKeyHandler(true);
  const onKeyUp = makeKeyHandler(false);
  function onLockChange() {
    const fp = getFp();
    if (!fp) return;
    if (document.pointerLockElement === canvas) {
      fp.hasPointerLock = true;
      return;
    }
    if (ignoreLockLossIf?.(fp)) return;
    if (fp.hasPointerLock) exitFn();
  }
  function requestPointerLock(armRetry = false) {
    canvas.requestPointerLock?.().catch(() => {});
    if (!armRetry) return;
    const retryPointerLock = () => {
      const fp = getFp();
      if (fp && document.pointerLockElement !== canvas) {
        canvas.requestPointerLock?.().catch(() => {});
      }
    };
    canvas.addEventListener("pointerdown", retryPointerLock, { once: true });
  }

  return {
    onMove,
    onKeyDown,
    onKeyUp,
    onLockChange,
    requestPointerLock,
    setExitFn(fn) {
      exitFn = fn;
    },
  };
}

export function setStrollLocalPose(localX, localZ, yaw) {
  if (!ctx.stroll) return false;
  const ws = state.userSettings.worldScale ?? 1;
  const groundY = state.heightFn(localX, localZ) * ws;
  ctx.stroll.camera.position.set(localX * ws, groundY + 1.9 * ws, localZ * ws);
  ctx.stroll.yaw = yaw;
  ctx.stroll.pitch = 0;
  ctx.stroll.keys = { w: false, a: false, s: false, d: false, shift: false };
  const target = ctx.stroll.savedTarget || ctx.controls?.target;
  if (target) {
    target.set(
      ctx.stroll.camera.position.x - Math.sin(yaw) * 8,
      ctx.stroll.camera.position.y,
      ctx.stroll.camera.position.z - Math.cos(yaw) * 8
    );
  }
  return true;
}

export function enterStrollFromPortal(localX, localZ, yaw) {
  if (!ctx.stroll) ctx.enterStroll();
  const positioned = setStrollLocalPose(localX, localZ, yaw);
  if (positioned) ctx.requestStrollPointerLock(true);
  return positioned;
}

// Advance the first-person camera using accumulated WASD keys and current
// yaw/pitch. Caller (main.js) calls this in lieu of controls.update() each
// frame while stroll mode is active.
export function stepStroll(dt) {
  if (!ctx.stroll && !ctx.flyFP && !ctx.photoFP) return;
  const fp = ctx.stroll || ctx.flyFP || ctx.photoFP;
  applyStrollVisualComfort(true);
  if (fp.reviewOpen) return;
  const { camera: cam, keys } = fp;
  const fly = fp.fly === true;
  // Move speed scales with the world — at higher worldScale the island is
  // bigger in world coords, so a fixed-units speed feels slower. Multiply
  // by ws so traversal time stays roughly constant across scales.
  const wsMove = state.userSettings.worldScale ?? 1;
  const speed = (keys.shift ? 12 : 6) * wsMove * dt;
  if (fly && (fp.lookX || fp.lookY)) {
    const lookSpeed = 0.95;
    fp.yaw -= fp.lookX * lookSpeed * dt;
    fp.pitch -= fp.lookY * lookSpeed * dt;
    clampFirstPersonPitch(fp);
  }
  let fx = 0;
  let fz = 0;
  if (keys.w) fz -= 1;
  if (keys.s) fz += 1;
  if (keys.a) fx -= 1;
  if (keys.d) fx += 1;
  const moving = fx !== 0 || fz !== 0;
  if (moving) {
    const len = Math.hypot(fx, fz);
    fx /= len;
    fz /= len;
    // World-space movement: forward at yaw y is (-sin y, 0, -cos y); right
    // is (cos y, 0, -sin y). With fz=-1 for W (forward) and fx=+1 for D
    // (right), Δp = fx·right + (-fz)·forward, which simplifies to:
    const cy = Math.cos(fp.yaw);
    const sy = Math.sin(fp.yaw);
    const dx = (fx * cy + fz * sy) * speed;
    const dz = (-fx * sy + fz * cy) * speed;
    cam.position.x += dx;
    cam.position.z += dz;
    // Fly mode: also move along the pitch axis so W follows the look direction
    if (fly) cam.position.y -= fz * Math.sin(fp.pitch) * speed;
  }

  if (fly) {
    // Fly mode: E rises, Q descends
    if (keys.e) cam.position.y += speed;
    if (keys.q) cam.position.y -= speed;
  } else {
    // Ground mode: lock camera to terrain height + eye offset
    const ws = state.userSettings.worldScale ?? 1;
    const wsi = 1 / ws;
    const cx = cam.position.x * wsi;
    const cz = cam.position.z * wsi;
    const probe = 0.45 * wsi;
    const hC = state.heightFn(cx, cz);
    const hN = state.heightFn(cx, cz + probe);
    const hS = state.heightFn(cx, cz - probe);
    const hE = state.heightFn(cx + probe, cz);
    const hW = state.heightFn(cx - probe, cz);
    const groundY = Math.max(hC, hN, hS, hE, hW) * ws;
    const targetY = groundY + 1.9 * ws;
    const next = cam.position.y + (targetY - cam.position.y) * Math.min(1, dt * 8);
    cam.position.y = Math.max(next, groundY + 1.0 * ws);
  }

  // Apply yaw / pitch as a quaternion so the camera doesn't roll.
  cam.rotation.order = "YXZ";
  cam.rotation.y = fp.yaw;
  cam.rotation.x = fp.pitch;
  cam.rotation.z = 0;

  // Keep OrbitControls' target far ahead so when we exit, the orbit
  // anchor lands somewhere sensible (avoids snapping the camera back).
  const st = fp.savedTarget || fp.controls.target;
  st.set(
    cam.position.x - Math.sin(fp.yaw) * 8,
    cam.position.y - Math.sin(fp.pitch) * 8,
    cam.position.z - Math.cos(fp.yaw) * 8
  );
}

export function initFirstPerson() {
  const { camera, canvas, controls } = ctx;

  // First-person stroll ----------------------------------------------------
  const strollBtn = document.getElementById("setting-stroll");
  const strollToggle = document.getElementById("stroll-toggle");
  const flyModeBtn = document.getElementById("setting-fly-mode");
  const flyToggle = document.getElementById("fly-toggle");
  const flyTouchControls = document.getElementById("fly-touch-controls");
  const flyTouchJoystick = document.getElementById("fly-touch-look");
  const flyTouchJoystickKnob = flyTouchJoystick?.querySelector(".fly-touch-joystick-knob");
  const flyTouchButtons = [...flyTouchControls.querySelectorAll("[data-fly-key]")];
  let flyTouchJoystickPointer = null;
  let flyTouchLookPointer = null;
  let flyTouchLookX = 0;
  let flyTouchLookY = 0;

  function setFlyTouchKey(key, down) {
    if (!ctx.flyFP || !(key in ctx.flyFP.keys)) return;
    ctx.flyFP.keys[key] = down;
    const button = flyTouchButtons.find((btn) => btn.dataset.flyKey === key);
    if (button) button.classList.toggle("pressed", down);
  }
  function resetFlyTouchKeys() {
    for (const button of flyTouchButtons) {
      const key = button.dataset.flyKey;
      if (ctx.flyFP && key in ctx.flyFP.keys) ctx.flyFP.keys[key] = false;
      button.classList.remove("pressed");
    }
  }
  function setFlyTouchJoystick(x, y) {
    if (ctx.flyFP) {
      ctx.flyFP.lookX = x;
      ctx.flyFP.lookY = y;
    }
    flyTouchJoystick?.classList.toggle("pressed", x !== 0 || y !== 0);
    if (flyTouchJoystickKnob) {
      flyTouchJoystickKnob.style.transform = `translate(calc(-50% + ${x * 32}px), calc(-50% + ${y * 32}px))`;
    }
  }
  function resetFlyTouchJoystick() {
    flyTouchJoystickPointer = null;
    setFlyTouchJoystick(0, 0);
  }
  function syncFlyTouchControls() {
    const shown = isFlyMode() && document.body.classList.contains("mobile");
    flyTouchControls.classList.toggle("active", shown);
    flyTouchControls.setAttribute("aria-hidden", shown ? "false" : "true");
  }
  ctx.syncFlyTouchControls = syncFlyTouchControls;
  function syncStrollButton() {
    const on = isStrolling();
    strollBtn.classList.toggle("active", on);
    strollBtn.querySelector(".setting-button-label").textContent = on
      ? "exit stroll mode"
      : "first-person stroll";
    strollBtn.querySelector(".setting-button-hint").textContent = "wasd · mouse-look · esc to exit";
    strollToggle.classList.toggle("active", on);
    strollToggle.setAttribute("aria-pressed", on ? "true" : "false");
    strollToggle.setAttribute("aria-label", on ? "exit first-person stroll" : "enter first-person stroll");
    strollToggle.title = on ? "return to global POV" : "first-person POV";
  }
  function syncFlyModeButton() {
    const on = isFlyMode();
    flyModeBtn.classList.toggle("active", on);
    flyModeBtn.querySelector(".setting-button-label").textContent = on
      ? "exit fly camera"
      : "fly camera";
    flyModeBtn.querySelector(".setting-button-hint").textContent = on
      ? "wasd · e/q · mouse-look · esc to exit"
      : "v · wasd · e/q · mouse-look";
    flyToggle.classList.toggle("active", on);
    flyToggle.setAttribute("aria-pressed", on ? "true" : "false");
    flyToggle.setAttribute("aria-label", on ? "exit fly camera" : "enter fly camera");
    flyToggle.title = on ? "return to orbit" : "orbit / fly";
    flyToggle.dataset.mode = on ? "fly" : "orbit";
    document.body.classList.toggle("fly-mode", on);
    syncFlyTouchControls();
  }
  const strollMode = makeFirstPersonMode({ canvas, getFp: () => ctx.stroll });
  strollMode.setExitFn(() => exitStroll());
  function requestStrollPointerLock(armRetry = false) {
    strollMode.requestPointerLock(armRetry);
  }
  function enterStroll() {
    if (ctx.stroll) return;
    if (ctx.flyFP) exitFlyMode();
    // Preserve any follow target: first-person + follow becomes creature POV.
    if (ctx.tour && ctx.tour.active) ctx.stopTour();
    ctx.setSelectingCreature(false);
    if (ctx.locatorOpen) ctx.setLocatorOpen(false);
    // Get the settings panel out of the way so the player can actually see.
    ctx.setSettingsOpen(false);
    const savedAutoRotate = controls.autoRotate;
    controls.autoRotate = false;
    controls.enabled = false;
    // Remember the look target for yaw — computed AFTER any XZ snap below so
    // the player still faces what they were looking at, even if we moved them.
    const lookX = controls.target.x;
    const lookZ = controls.target.z;
    // Pitch resets to 0 (horizontal) — the orbit camera is usually angled
    // downward, which makes for an awful first-person starting view.
    const pitch = 0;
    // If the camera is currently over the void (off-island), walk it toward
    // the nearest island center until it hits solid ground — so the player
    // lands at the edge from their viewing direction rather than dropping
    // straight down into nothing. heightFn isn't reliable for this check
    // (it returns negative inside the island wherever noise dips below 0),
    // so detect off-island via islandFalloff across all layout centers.
    const onIsland = (x, z) => {
      for (const c of state.currentLayout.centers) {
        if (islandFalloff(c, x, z) > 0.15) return true;
      }
      return false;
    };
    if (!onIsland(camera.position.x, camera.position.z)) {
      const c = nearestCenter(camera.position.x, camera.position.z);
      let tx = camera.position.x;
      let tz = camera.position.z;
      const ddx = c.cx - tx;
      const ddz = c.cz - tz;
      const dist = Math.hypot(ddx, ddz);
      if (dist > 0.01) {
        const step = Math.max(0.5, c.radius * 0.05);
        const ux = ddx / dist;
        const uz = ddz / dist;
        for (let i = 0; i < 200 && !onIsland(tx, tz); i++) {
          tx += ux * step;
          tz += uz * step;
        }
      } else {
        tx = c.cx;
        tz = c.cz;
      }
      camera.position.x = tx;
      camera.position.z = tz;
    }
    // Initial yaw from the (possibly snapped) camera position toward the
    // original look-target, so the player faces what they were viewing.
    const dx = lookX - camera.position.x;
    const dz = lookZ - camera.position.z;
    const yaw = Math.atan2(-dx, -dz);
    // Drop the camera to creature-eye height on the terrain at its XZ.
    // Account for state.world's scale — heightFn is mesh-local.
    const ws0 = state.userSettings.worldScale ?? 1;
    const groundY = state.heightFn(
      camera.position.x / ws0,
      camera.position.z / ws0
    ) * ws0;
    ctx.stroll = {
      camera,
      keys: { w: false, a: false, s: false, d: false, shift: false },
      yaw,
      pitch,
      savedCam: {
        pos: camera.position.clone(),
        target: controls.target.clone(),
        autoRotate: savedAutoRotate,
      },
      savedTarget: controls.target,
      hasPointerLock: false,
    };
    camera.position.y = groundY + 1.9 * ws0;

    // Pointer lock so the mouse can move infinitely without leaving the
    // canvas. Browsers require this from a user gesture (button click).
    strollMode.requestPointerLock();

    document.addEventListener("mousemove", strollMode.onMove);
    window.addEventListener("keydown", strollMode.onKeyDown);
    window.addEventListener("keyup", strollMode.onKeyUp);
    document.addEventListener("pointerlockchange", strollMode.onLockChange);
    applyStrollVisualComfort(true);
    syncStrollButton();
  }
  function exitStroll() {
    if (!ctx.stroll) return;
    const { savedCam } = ctx.stroll;
    document.removeEventListener("mousemove", strollMode.onMove);
    window.removeEventListener("keydown", strollMode.onKeyDown);
    window.removeEventListener("keyup", strollMode.onKeyUp);
    document.removeEventListener("pointerlockchange", strollMode.onLockChange);
    if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    // Restore the orbit anchor and camera. Re-enable orbit controls so the
    // user can rotate again from where they left off.
    camera.position.copy(savedCam.pos);
    controls.target.copy(savedCam.target);
    controls.autoRotate = savedCam.autoRotate && state.userSettings.autoRotate;
    controls.enabled = true;
    ctx.stroll = null;
    applyStrollVisualComfort(false);
    syncStrollButton();
  }
  strollBtn.addEventListener("click", () => {
    if (ctx.stroll) exitStroll();
    else enterStroll();
  });
  strollToggle.addEventListener("click", () => {
    if (ctx.stroll) exitStroll();
    else enterStroll();
  });
  syncStrollButton();

  const flyMode = makeFirstPersonMode({ canvas, getFp: () => ctx.flyFP, extraKeys: ["e", "q"] });
  flyMode.setExitFn(() => exitFlyMode());
  function enterFlyMode() {
    if (ctx.flyFP) return;
    if (ctx.stroll) exitStroll();
    if (ctx.tour && ctx.tour.active) ctx.stopTour();
    if (ctx.locatorOpen) ctx.setLocatorOpen(false);
    ctx.setFollowTarget(null);
    ctx.setSelectingCreature(false);
    ctx.setSettingsOpen(false);

    const savedAutoRotate = controls.autoRotate;
    controls.autoRotate = false;
    controls.enabled = false;

    camera.updateMatrixWorld();
    const lookDir = new THREE.Vector3();
    camera.getWorldDirection(lookDir);
    const yaw = Math.atan2(-lookDir.x, -lookDir.z);
    const pitch = Math.asin(Math.max(-1, Math.min(1, lookDir.y)));

    ctx.flyFP = {
      camera,
      controls,
      keys: { w: false, a: false, s: false, d: false, shift: false, e: false, q: false },
      lookX: 0,
      lookY: 0,
      yaw,
      pitch,
      fly: true,
      savedCam: { autoRotate: savedAutoRotate },
      savedTarget: controls.target,
      hasPointerLock: false,
    };

    flyMode.requestPointerLock();

    document.addEventListener("mousemove", flyMode.onMove);
    window.addEventListener("keydown", flyMode.onKeyDown);
    window.addEventListener("keyup", flyMode.onKeyUp);
    document.addEventListener("pointerlockchange", flyMode.onLockChange);
    applyStrollVisualComfort(true);
    syncFlyModeButton();
  }
  function exitFlyMode() {
    if (!ctx.flyFP) return;
    const { savedCam } = ctx.flyFP;
    document.removeEventListener("mousemove", flyMode.onMove);
    window.removeEventListener("keydown", flyMode.onKeyDown);
    window.removeEventListener("keyup", flyMode.onKeyUp);
    document.removeEventListener("pointerlockchange", flyMode.onLockChange);
    if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    controls.autoRotate = savedCam.autoRotate && state.userSettings.autoRotate;
    controls.enabled = true;
    resetFlyTouchKeys();
    resetFlyTouchJoystick();
    flyTouchLookPointer = null;
    ctx.flyFP = null;
    applyStrollVisualComfort(false);
    syncFlyModeButton();
  }
  flyModeBtn.addEventListener("click", () => {
    if (ctx.flyFP) exitFlyMode();
    else enterFlyMode();
  });
  flyToggle.addEventListener("click", () => {
    if (ctx.flyFP) exitFlyMode();
    else enterFlyMode();
  });
  for (const button of flyTouchButtons) {
    const key = button.dataset.flyKey;
    const press = (e) => {
      if (!ctx.flyFP) return;
      e.preventDefault();
      e.stopPropagation();
      button.setPointerCapture?.(e.pointerId);
      setFlyTouchKey(key, true);
    };
    const release = (e) => {
      e.preventDefault();
      e.stopPropagation();
      setFlyTouchKey(key, false);
    };
    button.addEventListener("pointerdown", press);
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("lostpointercapture", () => setFlyTouchKey(key, false));
  }
  flyTouchJoystick?.addEventListener("pointerdown", (e) => {
    if (!ctx.flyFP) return;
    e.preventDefault();
    e.stopPropagation();
    flyTouchJoystickPointer = e.pointerId;
    flyTouchJoystick.setPointerCapture?.(e.pointerId);
    updateFlyTouchJoystick(e);
  });
  flyTouchJoystick?.addEventListener("pointermove", (e) => {
    if (!ctx.flyFP || flyTouchJoystickPointer !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    updateFlyTouchJoystick(e);
  });
  const clearFlyTouchJoystick = (e) => {
    if (flyTouchJoystickPointer === e.pointerId) resetFlyTouchJoystick();
  };
  flyTouchJoystick?.addEventListener("pointerup", clearFlyTouchJoystick);
  flyTouchJoystick?.addEventListener("pointercancel", clearFlyTouchJoystick);
  flyTouchJoystick?.addEventListener("lostpointercapture", resetFlyTouchJoystick);
  function updateFlyTouchJoystick(e) {
    const rect = flyTouchJoystick.getBoundingClientRect();
    const radius = Math.max(1, Math.min(rect.width, rect.height) * 0.5);
    const dx = e.clientX - (rect.left + rect.width * 0.5);
    const dy = e.clientY - (rect.top + rect.height * 0.5);
    const mag = Math.hypot(dx, dy);
    const limited = mag > radius ? radius / mag : 1;
    setFlyTouchJoystick((dx * limited) / radius, (dy * limited) / radius);
  }
  canvas.addEventListener("pointerdown", (e) => {
    if (!ctx.flyFP || !document.body.classList.contains("mobile")) return;
    if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
    if (e.target.closest?.(".fly-touch-controls")) return;
    flyTouchLookPointer = e.pointerId;
    flyTouchLookX = e.clientX;
    flyTouchLookY = e.clientY;
    canvas.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener("pointermove", (e) => {
    if (!ctx.flyFP || flyTouchLookPointer !== e.pointerId) return;
    const sens = 0.004;
    ctx.flyFP.yaw -= (e.clientX - flyTouchLookX) * sens;
    ctx.flyFP.pitch -= (e.clientY - flyTouchLookY) * sens;
    clampFirstPersonPitch(ctx.flyFP);
    flyTouchLookX = e.clientX;
    flyTouchLookY = e.clientY;
    e.preventDefault();
  }, { passive: false });
  const clearFlyTouchLook = (e) => {
    if (flyTouchLookPointer === e.pointerId) flyTouchLookPointer = null;
  };
  canvas.addEventListener("pointerup", clearFlyTouchLook);
  canvas.addEventListener("pointercancel", clearFlyTouchLook);
  syncFlyModeButton();

  // Expose for sibling modules (photo mode, portal arrival, the keydown glue).
  ctx.enterStroll = enterStroll;
  ctx.exitStroll = exitStroll;
  ctx.enterFlyMode = enterFlyMode;
  ctx.exitFlyMode = exitFlyMode;
  ctx.requestStrollPointerLock = requestStrollPointerLock;
}
