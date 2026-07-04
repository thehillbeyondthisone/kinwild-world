import { BEACHCOMB_DENSITY, FLOWER_DENSITY, GRASS_DENSITY, PEBBLE_DENSITY } from "./biomes.js";
import { formatSeed } from "./seed.js";

const CATALOG_METADATA_KEY = "smallworld:catalog:v1";
const CATALOG_DB_NAME = "smallworld-catalog";
const CATALOG_DB_VERSION = 1;
const PHOTO_STORE = "photos";
const fallbackBlobs = new Map();

const LABEL_OVERRIDES = {
  angler: "Angler Fish",
  archstone: "Arch Stone",
  balloontree: "Balloon Tree",
  beachsucculent: "Beach Succulent",
  bigmushroom: "Big Mushroom",
  braincoral: "Brain Coral",
  bumblebee: "Bumblebee",
  cupcoral: "Cup Coral",
  dandylion: "Dandy Lion",
  deadtree: "Dead Tree",
  fairyring: "Fairy Ring",
  flyer_nest: "Flyer Nest",
  grassfield: "Grass Field",
  grassblade: "Grass Blade",
  lavafissure: "Lava Fissure",
  leafballtree: "Leafball Tree",
  limestonerock: "Limestone Rock",
  obsidianglass: "Obsidian Glass",
  obsidianshard: "Obsidian Shard",
  snowpine: "Snow Pine",
  wildflower: "Wildflower",
  willowisp: "Will-o'-wisp",
};

function labelForVariant(variant) {
  if (LABEL_OVERRIDES[variant]) return LABEL_OVERRIDES[variant];
  return String(variant)
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function normalizeCategory(category) {
  return category === "creature" ? "fauna" : category;
}

export function buildCatalogKey({ category, variant, biomeId }) {
  return `${normalizeCategory(category)}:${variant}:${biomeId}`;
}

export function buildCatalogSubject({ category, variant, biomeId, label = null }) {
  const normalizedCategory = normalizeCategory(category);
  return {
    key: buildCatalogKey({ category: normalizedCategory, variant, biomeId }),
    category: normalizedCategory,
    variant,
    biomeId,
    label: label ?? labelForVariant(variant),
  };
}

export function catalogSubjectFromInspect(inspect, biome) {
  if (!inspect?.variant || !biome?.id) return null;
  if (inspect.variant === "water") return null;
  return buildCatalogSubject({
    category: inspect.category,
    variant: inspect.variant,
    biomeId: biome.id,
  });
}

function addSubject(map, subject) {
  if (!subject || map.has(subject.key)) return;
  map.set(subject.key, subject);
}

function nectarCanExist(biome) {
  const flowerDensity = FLOWER_DENSITY[biome.id] ?? 100;
  return flowerDensity > 0 || biome.flora.includes("berrybush") || biome.flora.includes("dandylion");
}

export function getBiomeCatalogEntries(biome) {
  const entries = new Map();

  for (const variant of new Set(biome.flora)) {
    addSubject(entries, buildCatalogSubject({ category: "flora", variant, biomeId: biome.id }));
  }
  if (biome.groveDetails?.fairyRing) {
    addSubject(entries, buildCatalogSubject({ category: "flora", variant: "fairyring", biomeId: biome.id }));
  }
  if (!biome.noFlyerNests && biome.creatureKind !== "fish") {
    addSubject(entries, buildCatalogSubject({ category: "flora", variant: "flyer_nest", biomeId: biome.id }));
  }
  if ((FLOWER_DENSITY[biome.id] ?? 100) > 0) {
    addSubject(entries, buildCatalogSubject({ category: "flora", variant: "wildflower", biomeId: biome.id }));
  }
  if ((GRASS_DENSITY[biome.id] ?? 100) > 0) {
    addSubject(entries, buildCatalogSubject({ category: "flora", variant: "grassfield", biomeId: biome.id }));
  }
  if ((PEBBLE_DENSITY[biome.id] ?? 100) > 0) {
    addSubject(entries, buildCatalogSubject({ category: "flora", variant: "pebble", biomeId: biome.id }));
  }
  if ((BEACHCOMB_DENSITY[biome.id] ?? 0) > 0) {
    addSubject(entries, buildCatalogSubject({ category: "flora", variant: "shell", biomeId: biome.id }));
    addSubject(entries, buildCatalogSubject({ category: "flora", variant: "starfish", biomeId: biome.id }));
  }

  if (biome.creatureKind === "fish") {
    addSubject(entries, buildCatalogSubject({ category: "fauna", variant: "fish", biomeId: biome.id }));
  } else {
    for (const variant of ["walker", "flier", "sleeper", "burrower"]) {
      addSubject(entries, buildCatalogSubject({ category: "fauna", variant, biomeId: biome.id }));
    }
  }
  if (biome.anglerFish) {
    addSubject(entries, buildCatalogSubject({ category: "fauna", variant: "angler", biomeId: biome.id }));
  }
  for (const flyer of biome.flyerVariants ?? []) {
    addSubject(entries, buildCatalogSubject({ category: "fauna", variant: flyer.kind, biomeId: biome.id }));
  }
  if (!biome.noCaterpillars) {
    addSubject(entries, buildCatalogSubject({ category: "fauna", variant: "caterpillar", biomeId: biome.id }));
  }
  if ((biome.snailCountMultiplier ?? 1) > 0) {
    addSubject(entries, buildCatalogSubject({ category: "fauna", variant: "snail", biomeId: biome.id }));
  }
  if (!biome.noButterflies) {
    addSubject(entries, buildCatalogSubject({ category: "fauna", variant: "butterfly", biomeId: biome.id }));
  }
  if (nectarCanExist(biome)) {
    addSubject(entries, buildCatalogSubject({ category: "fauna", variant: "bee", biomeId: biome.id }));
  }
  if (biome.hasWillowisps) {
    addSubject(entries, buildCatalogSubject({ category: "fauna", variant: "willowisp", biomeId: biome.id }));
  }
  addSubject(entries, buildCatalogSubject({ category: "fauna", variant: "bird", biomeId: biome.id }));

  return [...entries.values()].sort((a, b) =>
    a.category.localeCompare(b.category) || a.label.localeCompare(b.label)
  );
}

export function filterCatalogEntriesForWorld(entries, { availableKeys, savedKeys = new Set() }) {
  if (!availableKeys?.size) return entries;
  return entries.filter((entry) => availableKeys.has(entry.key) || savedKeys.has(entry.key));
}

function parseMetadata(raw) {
  if (!raw) return { entries: {} };
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && parsed.entries ? parsed : { entries: {} };
  } catch {
    return { entries: {} };
  }
}

function readMetadata(storage) {
  if (storage instanceof Map) return parseMetadata(storage.get(CATALOG_METADATA_KEY));
  return parseMetadata(storage?.getItem?.(CATALOG_METADATA_KEY));
}

function writeMetadata(storage, metadata) {
  const raw = JSON.stringify(metadata);
  if (storage instanceof Map) storage.set(CATALOG_METADATA_KEY, raw);
  else storage?.setItem?.(CATALOG_METADATA_KEY, raw);
}

function openCatalogDb() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(CATALOG_DB_NAME, CATALOG_DB_VERSION);
    req.onerror = () => resolve(null);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PHOTO_STORE)) db.createObjectStore(PHOTO_STORE);
    };
    req.onsuccess = () => resolve(req.result);
  });
}

async function putBlob(blobStorage, id, blob) {
  if (blobStorage instanceof Map) {
    blobStorage.set(id, blob);
    return;
  }
  const db = await openCatalogDb();
  if (!db) {
    fallbackBlobs.set(id, blob);
    return;
  }
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, "readwrite");
      tx.objectStore(PHOTO_STORE).put(blob, id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error ?? new Error("catalog putBlob transaction failed"));
    });
  } finally {
    db.close();
  }
}

async function deleteBlob(blobStorage, id) {
  if (!id) return;
  if (blobStorage instanceof Map) {
    blobStorage.delete(id);
    return;
  }
  const db = await openCatalogDb();
  if (!db) {
    fallbackBlobs.delete(id);
    return;
  }
  try {
    // Best-effort cleanup: nothing more we can do if this also fails.
    await new Promise((resolve) => {
      const tx = db.transaction(PHOTO_STORE, "readwrite");
      tx.objectStore(PHOTO_STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  } finally {
    db.close();
  }
}

async function getBlob(blobStorage, id) {
  if (!id) return null;
  if (blobStorage instanceof Map) return blobStorage.get(id) ?? null;
  const db = await openCatalogDb();
  if (!db) return fallbackBlobs.get(id) ?? null;
  const value = await new Promise((resolve) => {
    const tx = db.transaction(PHOTO_STORE, "readonly");
    const req = tx.objectStore(PHOTO_STORE).get(id);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => resolve(null);
  });
  db.close();
  return value;
}

function makeEntry({ subject, seed, now, previous = null }) {
  const seedValue = typeof seed === "number" ? formatSeed(seed) : seed;
  return {
    key: subject.key,
    category: subject.category,
    variant: subject.variant,
    label: subject.label,
    biomeId: subject.biomeId,
    discoveredAt: previous?.discoveredAt ?? now,
    updatedAt: now,
    seed: seedValue,
    photoBlobId: subject.key,
    photoCount: (previous?.photoCount ?? 0) + 1,
  };
}

export function makeCatalogStore({
  now = () => Date.now(),
  metadataStorage = typeof localStorage === "undefined" ? new Map() : localStorage,
  blobStorage = null,
} = {}) {
  function read() {
    return readMetadata(metadataStorage);
  }

  function write(metadata) {
    writeMetadata(metadataStorage, metadata);
  }

  return {
    listEntries() {
      return Object.values(read().entries);
    },
    getEntry(key) {
      return read().entries[key] ?? null;
    },
    async getPhotoBlob(key) {
      const entry = this.getEntry(key);
      return getBlob(blobStorage, entry?.photoBlobId);
    },
    async savePhoto({ subject, seed, blob }) {
      const metadata = read();
      const existing = metadata.entries[subject.key];
      if (existing) return { status: "exists", entry: existing };
      const entry = makeEntry({ subject, seed, now: now() });
      // Write the blob first, then the metadata that references it. If the
      // metadata write throws (e.g. localStorage quota), delete the blob we
      // just wrote so it doesn't strand as an unreferenced entry.
      await putBlob(blobStorage, entry.photoBlobId, blob);
      try {
        metadata.entries[subject.key] = entry;
        write(metadata);
      } catch (err) {
        await deleteBlob(blobStorage, entry.photoBlobId);
        throw err;
      }
      return { status: "created", entry };
    },
    async replacePhoto({ subject, seed, blob, now: overrideNow = null }) {
      const metadata = read();
      const existing = metadata.entries[subject.key] ?? null;
      const entry = makeEntry({ subject, seed, now: overrideNow ?? now(), previous: existing });
      // Same ordering as savePhoto. Note: photoBlobId is stable per subject,
      // so on replace the previous blob is already overwritten by the time
      // metadata write could fail — there's no prior blob left to restore,
      // only the newly-written one to roll back when there was no existing entry.
      await putBlob(blobStorage, entry.photoBlobId, blob);
      try {
        metadata.entries[subject.key] = entry;
        write(metadata);
      } catch (err) {
        if (!existing) await deleteBlob(blobStorage, entry.photoBlobId);
        throw err;
      }
      return { status: existing ? "replaced" : "created", entry };
    },
    async keepCurrent(key) {
      return this.getEntry(key);
    },
  };
}
