// Settings panel wiring (ARC-001 / QA-006 split): atmosphere (scale, auto-
// rotate, day/night, fog, ambient), the reset-camera button, wind, grass,
// ground-mark lifetime, portal preview, post-FX, music, FPS, auto-regenerate,
// and share/copy-link. Also owns the ARC-005 "world-ready" re-baseline of the
// wind/grass shader uniforms after every regen.
import { state, GRASS_DENSITY_BASE, GRASS_HEIGHT_BASE } from "../state.js";
import { generateWorld } from "../world.js";
import { buildObstacleGrid } from "../fauna.js";
import { LOWFX } from "../lowfx.js";
import {
  AVAILABLE_MUSIC_TRACKS,
  defaultTrackForBiome,
  selectedTrackForBiome,
  setMusicEnabled,
  setMusicTrackOverride,
  setMusicVolume,
  switchMusic,
  tryResumeOnGesture,
} from "../music.js";
import { disposePortal, updatePortalPreviewSettings } from "../portal.js";
import { SETTINGS_KEY, saveSettings } from "./storage.js";
import { ctx } from "./context.js";

function eachPortal(fn) {
  for (const portal of state.portals ?? []) fn(portal);
}

function disposeStatePortals() {
  eachPortal((portal) => {
    portal.group?.parent?.remove(portal.group);
    disposePortal(portal);
  });
  state.portals = [];
  state.obstacles = state.obstacles.filter((o) => o.kind !== "portal");
  buildObstacleGrid(state.obstacles);
}

export function initSettingsPanel() {
  const { controls } = ctx;
  const settingsPanel = document.getElementById("settings-panel");
  const settingsToggle = document.getElementById("settings-toggle");
  const settingsClose = document.getElementById("settings-close");
  const settingsResetDefaults = document.getElementById("setting-reset-defaults");

  function setSettingsOpen(open) {
    settingsPanel.classList.toggle("open", open);
    settingsPanel.setAttribute("aria-hidden", open ? "false" : "true");
  }
  ctx.setSettingsOpen = setSettingsOpen;

  // Settings and help share the same bottom-right corner — opening one
  // closes the other so the back panel isn't hidden behind the front one.
  settingsToggle.addEventListener("click", () => {
    const opening = !settingsPanel.classList.contains("open");
    if (opening) { ctx.setHelpOpen(false); ctx.setLocatorOpen(false); ctx.setCatalogOpen(false); }
    setSettingsOpen(opening);
  });
  settingsClose.addEventListener("click", () => setSettingsOpen(false));
  settingsResetDefaults.addEventListener("click", () => {
    localStorage.removeItem(SETTINGS_KEY);
    window.location.reload();
  });

  document.getElementById("setting-reset-camera").addEventListener("click", () => {
    ctx.setFollowTarget(null);
    ctx.setSelectingCreature(false);
    controls.target.set(0, 1.5, 0);
  });

  const scaleSlider = document.getElementById("setting-scale");
  const scaleValue = document.getElementById("setting-scale-value");
  scaleSlider.value = String(Math.round((state.userSettings.worldScale ?? 1) * 100));
  scaleValue.textContent = scaleSlider.value + "%";
  state.world.scale.setScalar(state.userSettings.worldScale ?? 1);
  scaleSlider.addEventListener("input", () => {
    const v = Number(scaleSlider.value);
    state.userSettings.worldScale = v / 100;
    state.world.scale.setScalar(state.userSettings.worldScale);
    scaleValue.textContent = v + "%";
    saveSettings();
  });

  const autoRotateInput = document.getElementById("setting-auto-rotate");
  autoRotateInput.checked = state.userSettings.autoRotate;
  autoRotateInput.addEventListener("change", () => {
    controls.autoRotate = autoRotateInput.checked;
    state.userSettings.autoRotate = autoRotateInput.checked;
    saveSettings();
  });

  const autoCycleInput = document.getElementById("setting-auto-cycle");
  autoCycleInput.checked = state.userSettings.autoCycle;
  const timeSlider = document.getElementById("setting-time");
  timeSlider.value = String(Math.round(state.userSettings.manualDayFactor * 1000));
  const timeValue = document.getElementById("setting-time-value");
  function timeLabel(f) {
    if (f < 0.08) return "midnight";
    if (f < 0.28) return "dawn";
    if (f < 0.72) return "day";
    if (f < 0.92) return "dusk";
    return "night";
  }
  function syncTimeUi() {
    const f = state.userSettings.manualDayFactor;
    timeValue.textContent = state.userSettings.autoCycle ? "auto" : timeLabel(f);
    timeSlider.disabled = state.userSettings.autoCycle;
    timeSlider.style.opacity = state.userSettings.autoCycle ? "0.4" : "";
  }
  autoCycleInput.addEventListener("change", () => {
    state.userSettings.autoCycle = autoCycleInput.checked;
    syncTimeUi();
    saveSettings();
  });
  timeSlider.addEventListener("input", () => {
    state.userSettings.manualDayFactor = Number(timeSlider.value) / 1000;
    syncTimeUi();
    saveSettings();
  });

  const fogSlider = document.getElementById("setting-fog");
  const fogValue = document.getElementById("setting-fog-value");
  fogSlider.value = String(Math.round(state.userSettings.fogMultiplier * 100));
  fogValue.textContent = fogSlider.value + "%";
  fogSlider.addEventListener("input", () => {
    const v = Number(fogSlider.value);
    state.userSettings.fogMultiplier = v / 100;
    fogValue.textContent = v + "%";
    saveSettings();
  });

  const ambientSlider = document.getElementById("setting-ambient");
  const ambientValue = document.getElementById("setting-ambient-value");
  ambientSlider.value = String(Math.round(state.userSettings.ambientBoost * 100));
  ambientValue.textContent = ambientSlider.value + "%";
  ambientSlider.addEventListener("input", () => {
    const v = Number(ambientSlider.value);
    state.userSettings.ambientBoost = v / 100;
    ambientValue.textContent = v + "%";
    saveSettings();
  });

  syncTimeUi();

  // Wind controls -----------------------------------------------------------
  // Live multipliers on the grass shader's wind uniforms. Disabling wind
  // freezes the shared windUniforms.uTime (advanced in animate()) AND zeros
  // out the grass strength so blades stand fully upright — handy when
  // verifying the creature-push bend without wind motion confounding it.
  // Other foliage that uses applyWindSway shares uTime, so freezing it also
  // settles trees/ferns into a still pose.
  const windDetailsEl = document.getElementById("setting-wind-details");
  const windEnabledEl = document.getElementById("setting-wind-enabled");
  const windStrengthEl = document.getElementById("setting-wind-strength");
  const windStrengthValueEl = document.getElementById("setting-wind-strength-value");
  const windNoiseEl = document.getElementById("setting-wind-noise");
  const windNoiseValueEl = document.getElementById("setting-wind-noise-value");
  const foliageWindEl = document.getElementById("setting-foliage-wind");

  // Base grass uniform values, snapshotted on first apply so sliders compose
  // against the engine's per-LOWFX defaults rather than overwriting them.
  let _grassWindBase = null;

  function applyWindSettings() {
    const on = !!state.userSettings.windEnabled;
    // Trees / mushrooms / other applyWindSway foliage share one multiplier.
    // Master windEnabled also freezes uTime in main.js — this just zeroes the
    // bend amplitude so they read upright instead of stuck mid-sway.
    const foliageOn = on && !!state.userSettings.foliageWindEnabled;
    state.windUniforms.uFoliageWind.value = foliageOn ? 1 : 0;
    const g = state.grass;
    if (!g) return;
    if (_grassWindBase === null) {
      _grassWindBase = {
        strength: g.uniforms.uWindStrength.value,
        scale: g.uniforms.uWindScale.value,
      };
    }
    const ks = on ? (state.userSettings.windStrength ?? 1) : 0;
    const kn = state.userSettings.windNoiseScale ?? 1;
    g.uniforms.uWindStrength.value = _grassWindBase.strength * ks;
    // Larger "noise size" = coarser pattern = lower frequency. Slider scales
    // an inverse multiplier so the % feels intuitive (higher = bigger gusts).
    g.uniforms.uWindScale.value = _grassWindBase.scale / Math.max(0.01, kn);
  }

  // Re-apply wind settings whenever the world rebuilds (state.grass is reset
  // by generateWorld). The first regen after page load is what populates
  // state.grass, so reset the snapshot baseline on world change too.
  state.userSettings.windEnabled =
    state.userSettings.windEnabled !== undefined ? state.userSettings.windEnabled : true;

  windDetailsEl.open = !!state.userSettings.windPanelOpen;
  windEnabledEl.checked = !!state.userSettings.windEnabled;
  foliageWindEl.checked = state.userSettings.foliageWindEnabled !== false;
  windStrengthEl.value = String(Math.round((state.userSettings.windStrength ?? 1) * 100));
  windStrengthValueEl.textContent = windStrengthEl.value + "%";
  windNoiseEl.value = String(Math.round((state.userSettings.windNoiseScale ?? 1) * 100));
  windNoiseValueEl.textContent = windNoiseEl.value + "%";
  function syncWindSliderEnabledState() {
    const dis = !state.userSettings.windEnabled;
    windStrengthEl.disabled = dis;
    windNoiseEl.disabled = dis;
    foliageWindEl.disabled = dis;
    windStrengthEl.style.opacity = dis ? "0.4" : "";
    windNoiseEl.style.opacity = dis ? "0.4" : "";
    foliageWindEl.style.opacity = dis ? "0.4" : "";
  }
  syncWindSliderEnabledState();

  windDetailsEl.addEventListener("toggle", () => {
    state.userSettings.windPanelOpen = windDetailsEl.open;
    saveSettings();
  });
  windEnabledEl.addEventListener("change", () => {
    state.userSettings.windEnabled = windEnabledEl.checked;
    syncWindSliderEnabledState();
    applyWindSettings();
    saveSettings();
  });
  windStrengthEl.addEventListener("input", () => {
    const v = Number(windStrengthEl.value);
    state.userSettings.windStrength = v / 100;
    windStrengthValueEl.textContent = v + "%";
    applyWindSettings();
    saveSettings();
  });
  windNoiseEl.addEventListener("input", () => {
    const v = Number(windNoiseEl.value);
    state.userSettings.windNoiseScale = v / 100;
    windNoiseValueEl.textContent = v + "%";
    applyWindSettings();
    saveSettings();
  });
  foliageWindEl.addEventListener("change", () => {
    state.userSettings.foliageWindEnabled = foliageWindEl.checked;
    applyWindSettings();
    saveSettings();
  });

  // Expose so the "world-ready" listener below can re-apply after
  // generateWorld rebuilds state.grass.uniforms on every regen (ARC-005).
  state._reapplyWindSettings = () => {
    _grassWindBase = null;
    applyWindSettings();
  };
  applyWindSettings();

  // Grass controls ----------------------------------------------------------
  // Density scales `mesh.count` between 0 and the pre-allocated maxPlaced —
  // a live show/hide of placed blades, no regen needed. Height multiplies
  // the per-vertex Y in the grass shader via a uniform.
  const grassDetailsEl = document.getElementById("setting-grass-details");
  const grassEnabledEl = document.getElementById("setting-grass-enabled");
  const grassDensityEl = document.getElementById("setting-grass-density");
  const grassDensityValueEl = document.getElementById("setting-grass-density-value");
  const grassHeightEl = document.getElementById("setting-grass-height");
  const grassHeightValueEl = document.getElementById("setting-grass-height-value");

  function applyGrassSettings() {
    const g = state.grass;
    if (!g) return;
    const enabled = state.userSettings.grassEnabled !== false;
    const density = state.userSettings.grassDensity ?? 1.0;
    const height = state.userSettings.grassHeight ?? 1.0;
    // Disabled = mesh.count 0, but the saved density value is left
    // intact so re-enabling restores the user's previous setting.
    const target = enabled
      ? Math.round((g.stockCount ?? g.mesh.count) * density)
      : 0;
    g.mesh.count = Math.max(0, Math.min(g.maxPlaced ?? g.mesh.count, target));
    g.uniforms.uHeightMul.value = height;
  }
  function syncGrassControls() {
    const grassAvailable = !!state.grass;
    const enabled = grassAvailable && state.userSettings.grassEnabled !== false;
    grassEnabledEl.checked = enabled;
    grassEnabledEl.disabled = !grassAvailable;
    const dis = !enabled;
    grassDensityEl.disabled = dis;
    grassHeightEl.disabled = dis;
    grassDensityEl.style.opacity = dis ? "0.4" : "";
    grassHeightEl.style.opacity = dis ? "0.4" : "";
  }

  // Both sliders are rebased so "100%" matches the user's preferred look.
  // Internal grassDensity / grassHeight stay in their natural "× biome
  // stock" / "× blade height" units, so persisted values remain meaningful
  // — only the slider display is rescaled. Conversion:
  //   sliderValue = internalValue / BASE * 100
  //   internalValue = sliderValue / 100 * BASE
  grassDetailsEl.open = !!state.userSettings.grassPanelOpen;
  grassEnabledEl.checked = state.userSettings.grassEnabled !== false;
  grassDensityEl.value = String(
    Math.round(((state.userSettings.grassDensity ?? GRASS_DENSITY_BASE) / GRASS_DENSITY_BASE) * 100)
  );
  grassDensityValueEl.textContent = grassDensityEl.value + "%";
  grassHeightEl.value = String(
    Math.round(((state.userSettings.grassHeight ?? GRASS_HEIGHT_BASE) / GRASS_HEIGHT_BASE) * 100)
  );
  grassHeightValueEl.textContent = grassHeightEl.value + "%";
  syncGrassControls();

  grassDetailsEl.addEventListener("toggle", () => {
    state.userSettings.grassPanelOpen = grassDetailsEl.open;
    saveSettings();
  });
  grassEnabledEl.addEventListener("change", () => {
    state.userSettings.grassEnabled = grassEnabledEl.checked;
    syncGrassControls();
    applyGrassSettings();
    saveSettings();
  });
  grassDensityEl.addEventListener("input", () => {
    const v = Number(grassDensityEl.value);
    state.userSettings.grassDensity = (v / 100) * GRASS_DENSITY_BASE;
    state.userSettings.grassDensityBase = GRASS_DENSITY_BASE;
    grassDensityValueEl.textContent = v + "%";
    applyGrassSettings();
    saveSettings();
  });
  grassHeightEl.addEventListener("input", () => {
    const v = Number(grassHeightEl.value);
    state.userSettings.grassHeight = (v / 100) * GRASS_HEIGHT_BASE;
    grassHeightValueEl.textContent = v + "%";
    applyGrassSettings();
    saveSettings();
  });

  // Ground mark lifetime control
  const groundMarkLifeEl = document.getElementById("setting-ground-mark-life");
  const groundMarkLifeValueEl = document.getElementById("setting-ground-mark-life-value");
  if (groundMarkLifeEl) {
    const groundMarkLifeScale = state.userSettings.groundMarkLifeScale ?? 1.0;
    groundMarkLifeEl.value = String(Math.round(groundMarkLifeScale * 100));
    groundMarkLifeValueEl.textContent = groundMarkLifeEl.value + "%";
    groundMarkLifeEl.addEventListener("input", () => {
      const v = Number(groundMarkLifeEl.value);
      state.userSettings.groundMarkLifeScale = v / 100;
      groundMarkLifeValueEl.textContent = v + "%";
      saveSettings();
    });
  }

  state._reapplyGrassSettings = () => {
    applyGrassSettings();
    syncGrassControls();
  };
  applyGrassSettings();
  syncGrassControls();

  // ARC-005: re-baseline wind/grass settings on every regen via the
  // "world-ready" event generateWorld dispatches at the end of every build
  // (initial load and regen alike), instead of world.js reaching into ui.js
  // state directly. dispatchEvent is synchronous, so this still runs within
  // the same tick as the old direct calls from world.js — no visible delay.
  window.addEventListener("world-ready", () => {
    if (state._reapplyWindSettings) state._reapplyWindSettings();
    if (state._reapplyGrassSettings) state._reapplyGrassSettings();
  });

  grassDetailsEl.insertAdjacentHTML("afterend", `
      <details class="fx-details" id="setting-portal-details">
        <summary class="settings-section-label fx-summary">portal preview</summary>

        <label class="setting setting-checkbox">
          <input type="checkbox" id="setting-portal-enabled" checked />
          <span class="setting-label">portals enabled</span>
        </label>

        <label class="setting setting-checkbox">
          <input type="checkbox" id="setting-portal-double" />
          <span class="setting-label">two portals</span>
        </label>

        <label class="setting setting-checkbox">
          <input type="checkbox" id="setting-portal-grass" />
          <span class="setting-label">target grass</span>
        </label>

        <label class="setting setting-checkbox">
          <input type="checkbox" id="setting-portal-flora" />
          <span class="setting-label">target flora</span>
        </label>

        <label class="setting setting-checkbox">
          <input type="checkbox" id="setting-portal-creatures" />
          <span class="setting-label">preview creatures</span>
        </label>

        <label class="setting setting-checkbox">
          <input type="checkbox" id="setting-portal-fx" />
          <span class="setting-label">local portal FX</span>
        </label>
      </details>
    `);
  const portalDetailsEl = document.getElementById("setting-portal-details");
  const portalEnabledEl = document.getElementById("setting-portal-enabled");
  const portalDoubleEl = document.getElementById("setting-portal-double");
  const portalGrassEl = document.getElementById("setting-portal-grass");
  const portalFloraEl = document.getElementById("setting-portal-flora");
  const portalCreaturesEl = document.getElementById("setting-portal-creatures");
  const portalFxEl = document.getElementById("setting-portal-fx");
  portalDetailsEl.open = !!state.userSettings.portalPanelOpen;
  portalEnabledEl.checked = state.userSettings.portalEnabled !== false;
  portalDoubleEl.checked = state.userSettings.portalDoublePlacement === true;
  portalGrassEl.checked = !!state.userSettings.portalPreviewGrass;
  portalFloraEl.checked = state.userSettings.portalPreviewFlora !== false;
  portalCreaturesEl.checked = !!state.userSettings.portalPreviewCreatures;
  portalFxEl.checked = state.userSettings.portalPreviewFx !== false;
  portalDetailsEl.addEventListener("toggle", () => {
    state.userSettings.portalPanelOpen = portalDetailsEl.open;
    saveSettings();
  });
  portalEnabledEl.addEventListener("change", () => {
    state.userSettings.portalEnabled = portalEnabledEl.checked;
    if (!portalEnabledEl.checked) {
      disposeStatePortals();
    } else if (!state.portals?.length && !state.isGeneratingWorld) {
      void generateWorld(state.currentSeed);
    }
    saveSettings();
  });
  portalDoubleEl.addEventListener("change", () => {
    state.userSettings.portalDoublePlacement = portalDoubleEl.checked;
    if (state.userSettings.portalEnabled !== false && !state.isGeneratingWorld) {
      void generateWorld(state.currentSeed);
    }
    saveSettings();
  });
  for (const [el, key] of [
    [portalGrassEl, "portalPreviewGrass"],
    [portalFloraEl, "portalPreviewFlora"],
    [portalCreaturesEl, "portalPreviewCreatures"],
    [portalFxEl, "portalPreviewFx"],
  ]) {
    el.addEventListener("change", () => {
      state.userSettings[key] = el.checked;
      eachPortal((portal) => updatePortalPreviewSettings(portal, state.userSettings));
      saveSettings();
    });
  }

  const fxDetailsEl = document.getElementById("setting-fx-details");
  const bloomEl = document.getElementById("setting-bloom");
  const tiltEl = document.getElementById("setting-tiltshift");
  const outlineEl = document.getElementById("setting-outline");
  const aoEl = document.getElementById("setting-ao");
  const depthFogEl = document.getElementById("setting-depthfog");
  const bloomRadiusEl = document.getElementById("setting-bloom-radius");
  const bloomRadiusValueEl = document.getElementById("setting-bloom-radius-value");
  const lowfxHint = document.getElementById("setting-lowfx-hint");

  fxDetailsEl.open = !!state.userSettings.fxPanelOpen;
  bloomEl.checked = state.userSettings.bloom;
  // Slider 0-300% feeds postfx.setBloomRadius, which maps it to the bloom
  // mip chain's per-step upsample weight ("scatter") — higher values let the
  // deeper, blurrier mips contribute more, widening the halo smoothly with
  // no sample-grid artifacts at any slider value.
  const bloomRadius = state.userSettings.bloomRadius ?? 0.5;
  bloomRadiusEl.value = String(Math.round(bloomRadius * 100));
  bloomRadiusValueEl.textContent = bloomRadiusEl.value + "%";
  tiltEl.checked = state.userSettings.tiltShift;
  outlineEl.checked = state.userSettings.outline;
  aoEl.checked = state.userSettings.ao;
  depthFogEl.checked = state.userSettings.depthFog;
  function syncBiomeOverrideSettings() {
    const bloomOverridden = state.currentBiome?.bloom === false;
    bloomEl.parentElement.hidden = bloomOverridden;
    bloomRadiusEl.parentElement.hidden = bloomOverridden;
  }
  ctx.syncBiomeOverrideSettings = syncBiomeOverrideSettings;
  syncBiomeOverrideSettings();

  if (LOWFX) {
    // The depth pre-pass and composer are stubbed out under LOWFX, so every
    // FX in this section is a no-op there.
    for (const el of [bloomEl, bloomRadiusEl, tiltEl, outlineEl, aoEl, depthFogEl]) {
      el.disabled = true;
    }
    lowfxHint.hidden = false;
  }

  fxDetailsEl.addEventListener("toggle", () => {
    state.userSettings.fxPanelOpen = fxDetailsEl.open;
    saveSettings();
  });

  bloomEl.addEventListener("change", () => {
    state.userSettings.bloom = bloomEl.checked;
    if (state.postfx) state.postfx.setBloom(bloomEl.checked && state.currentBiome?.bloom !== false);
    saveSettings();
  });
  bloomRadiusEl.addEventListener("input", () => {
    const v = Number(bloomRadiusEl.value);
    state.userSettings.bloomRadius = v / 100;
    bloomRadiusValueEl.textContent = v + "%";
    if (state.postfx && state.postfx.setBloomRadius) {
      state.postfx.setBloomRadius(state.userSettings.bloomRadius);
    }
    saveSettings();
  });
  tiltEl.addEventListener("change", () => {
    state.userSettings.tiltShift = tiltEl.checked;
    if (state.postfx) state.postfx.setTiltShift(tiltEl.checked);
    saveSettings();
  });

  // ── Music controls ------------------------------------------------------
  const musicBtn = document.getElementById("music-toggle");
  const musicGlyph = musicBtn.querySelector(".music-glyph");
  const musicTrackEl = document.getElementById("setting-music-track");
  const musicVolumeEl = document.getElementById("setting-music-volume");
  const musicVolumeValueEl = document.getElementById("setting-music-volume-value");
  function formatTrackLabel(track) {
    return track.replace(/\.mp3$/i, "").replace(/([a-z])([A-Z])/g, "$1 $2");
  }
  function refreshMusicTrackSelect() {
    if (!state.currentBiome) return;
    const defaultTrack = defaultTrackForBiome(state.currentBiome);
    musicTrackEl.innerHTML = "";
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = `biome default (${formatTrackLabel(defaultTrack)})`;
    musicTrackEl.appendChild(defaultOption);
    for (const track of AVAILABLE_MUSIC_TRACKS) {
      const option = document.createElement("option");
      option.value = track;
      option.textContent = formatTrackLabel(track);
      musicTrackEl.appendChild(option);
    }
    const override = state.userSettings.musicTrackOverrides?.[state.currentBiome.id];
    musicTrackEl.value = AVAILABLE_MUSIC_TRACKS.includes(override) ? selectedTrackForBiome(state.currentBiome) : "";
  }
  ctx.refreshMusicTrackSelect = refreshMusicTrackSelect;
  function updateMusicButton() {
    musicBtn.classList.toggle("active", !!state.userSettings.musicEnabled);
    musicGlyph.textContent = state.userSettings.musicEnabled ? "♫" : "🔇";
    musicBtn.setAttribute("aria-label", state.userSettings.musicEnabled ? "music on" : "music off");
    musicBtn.title = state.userSettings.musicEnabled ? "music on" : "music off";
  }
  updateMusicButton();
  refreshMusicTrackSelect();
  musicVolumeEl.value = String(Math.round((state.userSettings.musicVolume ?? 0.5) * 100));
  musicVolumeValueEl.textContent = musicVolumeEl.value + "%";
  musicBtn.addEventListener("click", () => {
    state.userSettings.musicEnabled = !state.userSettings.musicEnabled;
    setMusicEnabled(state.userSettings.musicEnabled);
    updateMusicButton();
    saveSettings();
  });
  function applyMusicTrackSelection() {
    setMusicTrackOverride(state.currentBiome?.id, musicTrackEl.value);
    if (state.currentBiome) switchMusic(state.currentBiome);
    refreshMusicTrackSelect();
    saveSettings();
  }
  musicTrackEl.addEventListener("input", applyMusicTrackSelection);
  musicTrackEl.addEventListener("change", applyMusicTrackSelection);
  musicVolumeEl.addEventListener("input", () => {
    const v = Number(musicVolumeEl.value);
    setMusicVolume(v / 100);
    musicVolumeValueEl.textContent = v + "%";
    saveSettings();
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== SETTINGS_KEY || !event.newValue) return;
    try {
      const saved = JSON.parse(event.newValue);
      if ("musicEnabled" in saved && saved.musicEnabled !== state.userSettings.musicEnabled) {
        state.userSettings.musicEnabled = !!saved.musicEnabled;
        setMusicEnabled(state.userSettings.musicEnabled);
        updateMusicButton();
      }
      if ("musicVolume" in saved && saved.musicVolume !== state.userSettings.musicVolume) {
        state.userSettings.musicVolume = saved.musicVolume;
        setMusicVolume(saved.musicVolume);
        musicVolumeEl.value = String(Math.round((state.userSettings.musicVolume ?? 0.5) * 100));
        musicVolumeValueEl.textContent = musicVolumeEl.value + "%";
      }
    } catch {
      // Ignore malformed settings written by older tabs or manual edits.
    }
  });
  // Resume audio on first user gesture (autoplay policy).
  document.addEventListener(
    "click",
    () => tryResumeOnGesture(),
    { once: true },
  );
  outlineEl.addEventListener("change", () => {
    state.userSettings.outline = outlineEl.checked;
    if (state.postfx) state.postfx.setOutline(outlineEl.checked);
    saveSettings();
  });
  aoEl.addEventListener("change", () => {
    state.userSettings.ao = aoEl.checked;
    if (state.postfx) state.postfx.setAo(aoEl.checked);
    saveSettings();
  });
  depthFogEl.addEventListener("change", () => {
    state.userSettings.depthFog = depthFogEl.checked;
    if (state.postfx) state.postfx.setDepthFog(depthFogEl.checked);
    saveSettings();
  });

  const fpsToggleEl = document.getElementById("setting-show-fps");
  const fpsCounterEl = document.getElementById("fps-counter");
  fpsToggleEl.checked = !!state.userSettings.showFps;
  fpsCounterEl.hidden = !state.userSettings.showFps;
  fpsToggleEl.addEventListener("change", () => {
    state.userSettings.showFps = fpsToggleEl.checked;
    fpsCounterEl.hidden = !fpsToggleEl.checked;
    saveSettings();
  });

  // Auto-regenerate timer — fires the regen button on an interval so the
  // world cycles itself without user input. Persisted via userSettings.
  const autoRegenInput = document.getElementById("setting-auto-regen");
  const autoRegenMins = document.getElementById("setting-auto-regen-mins");
  const autoRegenMinsValue = document.getElementById("setting-auto-regen-mins-value");
  autoRegenInput.checked = !!state.userSettings.autoRegen;
  autoRegenMins.value = String(state.userSettings.autoRegenMinutes ?? 2);
  autoRegenMinsValue.textContent = autoRegenMins.value + " min";
  let _autoRegenAt = performance.now() + (state.userSettings.autoRegenMinutes ?? 2) * 60000;
  function resetAutoRegenClock() {
    _autoRegenAt =
      performance.now() + (state.userSettings.autoRegenMinutes ?? 2) * 60000;
  }
  autoRegenInput.addEventListener("change", () => {
    state.userSettings.autoRegen = autoRegenInput.checked;
    resetAutoRegenClock();
    saveSettings();
  });
  autoRegenMins.addEventListener("input", () => {
    const v = Math.max(1, Number(autoRegenMins.value));
    state.userSettings.autoRegenMinutes = v;
    autoRegenMinsValue.textContent = v + " min";
    resetAutoRegenClock();
    saveSettings();
  });
  // poll every 5s — cheap, no need to thread the timer through animate()
  setInterval(() => {
    if (!state.userSettings.autoRegen) return;
    if (document.body.classList.contains("photo-mode")) return;
    if (performance.now() < _autoRegenAt) return;
    resetAutoRegenClock();
    document.getElementById("regen-random-biome").click();
  }, 5000);

  // Share — copy current URL (which always reflects the current seed)
  const copyBtn = document.getElementById("setting-copy-link");
  const copyHint = document.getElementById("setting-copy-hint");
  const _copyDefault = copyHint.textContent;
  let _copyResetTimer = 0;
  copyBtn.addEventListener("click", async () => {
    const url = window.location.href;
    // Not initialized here: every path below (both try branches and the
    // catch) assigns before `ok` is read, so a starting value would be dead.
    let ok;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        ok = true;
      } else {
        // fallback for older browsers / non-secure contexts
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.cssText = "position:fixed;opacity:0;pointer-events:none;";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        ta.remove();
      }
    } catch {
      ok = false;
    }
    copyHint.textContent = ok ? "copied to clipboard" : "copy failed";
    clearTimeout(_copyResetTimer);
    _copyResetTimer = setTimeout(() => {
      copyHint.textContent = _copyDefault;
    }, 1800);
  });
}
