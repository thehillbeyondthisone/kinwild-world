// Field Guide catalog panel (ARC-001 / QA-006 split): the per-biome checklist
// of photographed fauna/flora subjects, its IndexedDB/localStorage-backed store
// (makeCatalogStore), and the object-URL bookkeeping. Photo mode reaches back
// in via ctx.catalogStore / ctx.renderCatalogPanel to save shots and refresh
// the panel after a save.
import { state } from "../state.js";
import { generateWorld } from "../world.js";
import { BIOMES } from "../biomes.js";
import { filterCatalogEntriesForWorld, getBiomeCatalogEntries, makeCatalogStore } from "../catalog.js";
import { LIVING_WORLD_STYLE_ID } from "../living-world/style.js";
import { LOCATOR_HIDDEN_FLORA_VARIANTS } from "./constants.js";
import { ctx } from "./context.js";

const catalogStore = makeCatalogStore();

/**
 * Wire up the Field Guide catalog panel: the per-biome checklist of
 * photographed fauna/flora subjects, its IndexedDB/localStorage-backed store
 * (`makeCatalogStore`), and object-URL bookkeeping for rendered photo
 * thumbnails. Attaches `ctx.catalogStore`/`ctx.renderCatalogPanel`/
 * `ctx.toggleCatalogPanel`/`ctx.setCatalogOpen` so photo mode can save shots
 * and refresh the panel after a save.
 */
export function initCatalogPanel() {
  const catalogPanel = document.getElementById("catalog-panel");
  const catalogToggle = document.getElementById("catalog-toggle");
  const catalogButton = document.getElementById("setting-catalog");
  const catalogClose = document.getElementById("catalog-close");
  const catalogList = document.getElementById("catalog-list");
  const catalogEmpty = document.getElementById("catalog-empty");

  function clearCatalogObjectUrls() {
    for (const url of ctx.catalogObjectUrls) URL.revokeObjectURL(url);
    ctx.catalogObjectUrls = [];
  }

  async function renderCatalogPanel() {
    // QA-022: renderCatalogPanel is async with a per-entry await inside its loop
    // (blob fetch); bumped on every call and checked after each await so an
    // overlapping run (panel re-opened, or a save triggering a re-render
    // mid-fetch) bails out instead of interleaving DOM clears/appends and
    // object-URL revokes with a stale run.
    const myGen = ++ctx.catalogRenderGen;
    clearCatalogObjectUrls();
    catalogList.innerHTML = "";
    const livingMode =
      state.currentBiome?.presentation?.mode === "living-world";
    const currentId = livingMode
      ? LIVING_WORLD_STYLE_ID
      : (state.currentBiome?.id ?? null);
    const currentCatalogKeys = new Set();
    const currentCatalogSubjects = new Map();
    state.world?.traverse((object) => {
      const inspect = object.userData?.inspect;
      if (inspect?.category === "flora" && LOCATOR_HIDDEN_FLORA_VARIANTS.has(inspect.variant)) return;
      const subject = object.userData?.catalog;
      if (subject?.key) {
        currentCatalogKeys.add(subject.key);
        currentCatalogSubjects.set(subject.key, subject);
      }
    });
    if (livingMode) {
      for (const saved of catalogStore.listEntries()) {
        if (
          saved.biomeId === LIVING_WORLD_STYLE_ID &&
          !currentCatalogSubjects.has(saved.key)
        ) {
          currentCatalogSubjects.set(saved.key, {
            key: saved.key,
            category: saved.category,
            variant: saved.variant,
            biomeId: saved.biomeId,
            label: saved.label,
          });
        }
      }
    }
    const biomes = livingMode
      ? [{ id: LIVING_WORLD_STYLE_ID, name: "kinwild" }]
      : [...BIOMES].sort((a, b) => {
          if (a.id === currentId) return -1;
          if (b.id === currentId) return 1;
          return a.name.localeCompare(b.name);
        });
    let rendered = 0;

    async function loadCatalogBiome(biome) {
      setCatalogOpen(false);
      if (livingMode) return;
      await generateWorld(state.currentSeed, undefined, { biomeId: biome.id }).catch((error) => {
        console.warn("Failed to load catalog biome", error);
      });
    }

    for (const biome of biomes) {
      const baseEntries = livingMode
        ? [...currentCatalogSubjects.values()]
        : getBiomeCatalogEntries(biome);
      if (biome.id === currentId) {
        for (const subject of currentCatalogSubjects.values()) {
          if (!baseEntries.some((entry) => entry.key === subject.key)) {
            baseEntries.push(subject);
          }
        }
        baseEntries.sort((a, b) =>
          a.category.localeCompare(b.category) || a.label.localeCompare(b.label)
        );
      }
      const savedKeys = new Set(baseEntries
        .filter((entry) => catalogStore.getEntry(entry.key))
        .map((entry) => entry.key));
      const entries = biome.id === currentId
        ? filterCatalogEntriesForWorld(baseEntries, {
            availableKeys: currentCatalogKeys,
            savedKeys,
          })
        : baseEntries;
      const biomeEl = document.createElement("section");
      biomeEl.className = "catalog-biome";
      const title = document.createElement("button");
      title.type = "button";
      title.className = "catalog-biome-title";
      title.textContent = biome.name;
      if (livingMode) {
        title.disabled = true;
      } else {
        title.addEventListener("click", () => {
          void loadCatalogBiome(biome);
        });
      }
      biomeEl.appendChild(title);

      for (const category of ["fauna", "flora"]) {
        const categoryEntries = entries.filter((entry) => entry.category === category);
        if (!categoryEntries.length) continue;
        const sectionTitle = document.createElement("div");
        sectionTitle.className = "catalog-section-title";
        sectionTitle.textContent = category;
        biomeEl.appendChild(sectionTitle);
        const grid = document.createElement("div");
        grid.className = "catalog-grid";

        for (const entry of categoryEntries) {
          const saved = catalogStore.getEntry(entry.key);
          const card = document.createElement("button");
          card.type = "button";
          card.className = `catalog-card ${saved ? "unlocked" : "locked"}`;

          if (saved) {
            const blob = await catalogStore.getPhotoBlob(entry.key);
            if (myGen !== ctx.catalogRenderGen) return;
            if (blob) {
              const url = URL.createObjectURL(blob);
              ctx.catalogObjectUrls.push(url);
              const img = document.createElement("img");
              img.className = "catalog-thumb";
              img.alt = entry.label;
              img.src = url;
              card.appendChild(img);
            }
          } else {
            const placeholder = document.createElement("div");
            placeholder.className = "catalog-thumb catalog-thumb-placeholder";
            placeholder.textContent = "?";
            card.appendChild(placeholder);
          }

          const label = document.createElement("div");
          label.className = "catalog-card-label";
          label.textContent = entry.label;
          card.appendChild(label);

          const meta = document.createElement("div");
          meta.className = "catalog-card-meta";
          meta.textContent = saved
            ? `${saved.seed} · ${new Date(saved.updatedAt).toLocaleDateString()}`
            : "undiscovered";
          card.appendChild(meta);

          if (saved) {
            const action = document.createElement("div");
            action.className = "catalog-card-action";
            action.textContent = "visit seed";
            card.appendChild(action);
            card.addEventListener("click", async () => {
              const seed = Number.parseInt(String(saved.seed).replace(/^0x/i, ""), 16);
              if (Number.isFinite(seed)) {
                setCatalogOpen(false);
                const options = livingMode
                  ? undefined
                  : { biomeId: saved.biomeId };
                await generateWorld(seed, undefined, options).catch((error) => {
                  console.warn("Failed to load catalog seed", error);
                });
              }
            });
          } else {
            if (!livingMode) {
              card.addEventListener("click", () => {
                void loadCatalogBiome(biome);
              });
            }
          }

          grid.appendChild(card);
        }
        biomeEl.appendChild(grid);
      }

      catalogList.appendChild(biomeEl);
      rendered += entries.length;
    }

    catalogEmpty.classList.toggle("visible", rendered === 0);
  }

  function setCatalogOpen(open) {
    ctx.catalogOpen = open;
    catalogPanel.classList.toggle("open", open);
    catalogToggle.classList.toggle("active", open);
    catalogPanel.setAttribute("aria-hidden", open ? "false" : "true");
    if (open) void renderCatalogPanel();
    else clearCatalogObjectUrls();
  }

  function toggleCatalogPanel() {
    const opening = !ctx.catalogOpen;
    ctx.setSettingsOpen(false);
    ctx.setHelpOpen(false);
    ctx.setLocatorOpen(false);
    setCatalogOpen(opening);
  }

  catalogButton.addEventListener("click", () => toggleCatalogPanel());
  catalogToggle.addEventListener("click", () => toggleCatalogPanel());
  catalogClose.addEventListener("click", () => setCatalogOpen(false));

  ctx.catalogStore = catalogStore;
  ctx.setCatalogOpen = setCatalogOpen;
  ctx.toggleCatalogPanel = toggleCatalogPanel;
  ctx.renderCatalogPanel = renderCatalogPanel;
}
