// Help panel + biome filter chips + bookmarks (ARC-001 / QA-006 split).
//
// The biome filter feeds regen: pickRandomBiomeSeed / pickSameBiomeSeed are
// exposed on ctx so the regen buttons (in input.js) pick a seed constrained to
// the enabled chips. syncBookmarkButton is exposed so the seed-change watcher
// (also input.js) can refresh the star label on every world change.
import { state } from "../state.js";
import { newRandomSeed, formatSeed } from "../seed.js";
import { generateWorld } from "../world.js";
import { BIOMES } from "../biomes.js";
import { INSPECT } from "../inspect.js";
import { nextEnabledBiomeIdFrom } from "./constants.js";
import {
  shouldUseMobileHud,
  shouldShowFirstVisitHelp,
  loadBookmarks,
  saveBookmarks,
  loadBiomeFilter,
  saveBiomeFilter,
} from "./storage.js";
import { ctx } from "./context.js";

/**
 * Wire up the help panel, biome filter chips, and seed bookmarks. Attaches
 * `ctx.pickRandomBiomeSeed`/`ctx.pickSameBiomeSeed` (consumed by the regen
 * buttons in input.js, constrained to the enabled biome chips) and
 * `ctx.syncBookmarkButton` (consumed by input.js's seed-change watcher to
 * refresh the star label on every world change).
 */
export function initHelpPanel() {
  const helpPanel = document.getElementById("help-panel");
  const helpToggle = document.getElementById("help-toggle");
  const helpClose = document.getElementById("help-close");
  const mobileHelpClose = document.getElementById("help-mobile-close");
  function setHelpOpen(open) {
    helpPanel.classList.toggle("open", open);
    helpPanel.setAttribute("aria-hidden", open ? "false" : "true");
  }
  ctx.setHelpOpen = setHelpOpen;

  helpToggle.addEventListener("click", () => {
    const opening = !helpPanel.classList.contains("open");
    if (opening) { ctx.setSettingsOpen(false); ctx.setLocatorOpen(false); ctx.setCatalogOpen(false); }
    setHelpOpen(opening);
  });
  helpClose.addEventListener("click", () => setHelpOpen(false));
  mobileHelpClose.addEventListener("click", () => setHelpOpen(false));
  if (!INSPECT && !shouldUseMobileHud() && shouldShowFirstVisitHelp()) {
    ctx.setSettingsOpen(false);
    ctx.setLocatorOpen(false);
    ctx.setCatalogOpen(false);
    setHelpOpen(true);
  }

  // Biome filter — restore from storage, build the chip row, and use it
  // to constrain regen below.
  const biomeFilter = loadBiomeFilter();
  const biomeFilterEl = document.getElementById("biome-filter");
  function renderBiomeFilter() {
    biomeFilterEl.innerHTML = "";
    for (const b of BIOMES) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "biome-chip" + (biomeFilter.has(b.id) ? " active" : "");
      chip.style.setProperty("--chip-color", b.sky);
      chip.setAttribute("aria-label", b.name);
      chip.setAttribute("aria-pressed", biomeFilter.has(b.id) ? "true" : "false");
      const tip = document.createElement("span");
      tip.className = "biome-chip-tooltip";
      tip.textContent = b.name;
      chip.appendChild(tip);
      chip.addEventListener("click", () => {
        if (biomeFilter.has(b.id)) {
          // Don't allow disabling the last enabled biome — otherwise regen has
          // nothing to land on. Just re-mark this chip and bail.
          if (biomeFilter.size <= 1) return;
          biomeFilter.delete(b.id);
        } else {
          biomeFilter.add(b.id);
        }
        saveBiomeFilter(biomeFilter);
        renderBiomeFilter();
      });
      biomeFilterEl.appendChild(chip);
    }
  }
  renderBiomeFilter();

  // All / None buttons
  document.getElementById("biome-filter-all").addEventListener("click", () => {
    for (const b of BIOMES) biomeFilter.add(b.id);
    saveBiomeFilter(biomeFilter);
    renderBiomeFilter();
  });
  document.getElementById("biome-filter-none").addEventListener("click", () => {
    // Keep one enabled so regen always has a target
    const first = BIOMES[0].id;
    biomeFilter.clear();
    biomeFilter.add(first);
    saveBiomeFilter(biomeFilter);
    renderBiomeFilter();
  });

  function nextEnabledBiomeId(currentBiomeId) {
    const enabled = BIOMES.filter((biome) => biomeFilter.has(biome.id));
    return nextEnabledBiomeIdFrom(enabled, currentBiomeId);
  }

  ctx.pickRandomBiomeSeed = () => {
    const nextId = nextEnabledBiomeId(state.currentBiome?.id);
    return newRandomSeed({
      allowedBiomeIds: nextId ? [nextId] : undefined,
    });
  };

  ctx.pickSameBiomeSeed = () => newRandomSeed({
    allowedBiomeIds: state.currentBiome ? [state.currentBiome.id] : undefined,
  });

  // Bookmarks ----------------------------------------------------------------
  let bookmarks = loadBookmarks();
  const bookmarkBtn = document.getElementById("setting-bookmark");
  const bookmarkLabel = document.getElementById("setting-bookmark-label");
  const bookmarkHint = document.getElementById("setting-bookmark-hint");
  const bookmarkListEl = document.getElementById("bookmark-list");
  const bookmarkEmptyEl = document.getElementById("bookmark-empty");

  function biomeById(id) {
    return BIOMES.find((b) => b.id === id);
  }

  function isCurrentBookmarked() {
    return bookmarks.some((bm) => bm.seed === state.currentSeed);
  }

  function syncBookmarkButton() {
    const saved = isCurrentBookmarked();
    bookmarkLabel.textContent = saved ? "★ remove bookmark" : "☆ save this seed";
    bookmarkHint.textContent = saved
      ? "stored · click to remove"
      : "store in your browser";
    bookmarkBtn.classList.toggle("active", saved);
  }
  ctx.syncBookmarkButton = syncBookmarkButton;

  function renderBookmarks() {
    bookmarkListEl.innerHTML = "";
    for (const bm of bookmarks) {
      const row = document.createElement("div");
      row.className = "bookmark-row";
      const biome = biomeById(bm.biomeId);
      const swatch = document.createElement("span");
      swatch.className = "bookmark-swatch";
      swatch.style.background = biome ? biome.sky : "#888";
      const text = document.createElement("button");
      text.type = "button";
      text.className = "bookmark-text";
      const bn = document.createElement("span");
      bn.className = "bookmark-biome";
      bn.textContent = bm.biomeName || biome?.name || "—";
      const seed = document.createElement("span");
      seed.className = "bookmark-seed";
      seed.textContent = formatSeed(bm.seed);
      text.appendChild(bn);
      text.appendChild(seed);
      text.addEventListener("click", async () => {
        if (bm.seed === state.currentSeed) return;
        await generateWorld(bm.seed).catch((error) => {
          console.error("World generation failed", error);
        });
        syncBookmarkButton();
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "bookmark-remove";
      remove.setAttribute("aria-label", "remove bookmark");
      remove.textContent = "×";
      remove.addEventListener("click", (e) => {
        e.stopPropagation();
        bookmarks = bookmarks.filter((x) => x.seed !== bm.seed);
        saveBookmarks(bookmarks);
        renderBookmarks();
        syncBookmarkButton();
      });
      row.appendChild(swatch);
      row.appendChild(text);
      row.appendChild(remove);
      bookmarkListEl.appendChild(row);
    }
    bookmarkEmptyEl.classList.toggle("visible", bookmarks.length === 0);
  }

  bookmarkBtn.addEventListener("click", () => {
    if (state.currentSeed == null || !state.currentBiome) return;
    if (isCurrentBookmarked()) {
      bookmarks = bookmarks.filter((x) => x.seed !== state.currentSeed);
    } else {
      bookmarks.push({
        seed: state.currentSeed,
        biomeId: state.currentBiome.id,
        biomeName: state.currentBiome.name,
        ts: Date.now(),
      });
    }
    saveBookmarks(bookmarks);
    renderBookmarks();
    syncBookmarkButton();
  });

  renderBookmarks();
  syncBookmarkButton();
}
