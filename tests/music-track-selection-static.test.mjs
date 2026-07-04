// Protected invariant: every biome resolves to a registered per-biome music
// track by default, and a saved override can select the same track for a
// different biome, falling back to the default when the override names an
// unregistered track.
import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { BIOMES } from "../src/biomes.js";

globalThis.__APP_VERSION__ = "test";

const { state } = await import("../src/state.js");
const {
  AVAILABLE_MUSIC_TRACKS,
  BIOME_TRACKS,
  defaultTrackForBiome,
  selectedTrackForBiome,
  setMusicTrackOverride,
} = await import("../src/music.js");

const music = readFileSync("src/music.js", "utf8");
// The UI wiring (select element, PERSISTED_KEYS) lives in src/ui.js and
// src/ui/storage.js, both DOM-touching modules owned by another QA-009
// agent — kept as source checks here.
const ui = readFileSync("src/ui/settings-panel.js", "utf8");
const storage = readFileSync("src/ui/storage.js", "utf8");
const html = readFileSync("index.html", "utf8");
const gitignore = readFileSync(".gitignore", "utf8");

function nameToTrack(name) {
  return `${name
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("")}.mp3`;
}

for (const biome of BIOMES) {
  const expectedTrack = nameToTrack(biome.name);
  assert(!/\s/.test(expectedTrack), `Expected ${expectedTrack} to be space-free.`);
  assert(
    AVAILABLE_MUSIC_TRACKS.includes(expectedTrack),
    `Expected biome music track ${expectedTrack} to be registered in AVAILABLE_MUSIC_TRACKS.`,
  );
  assert.equal(
    defaultTrackForBiome(biome),
    expectedTrack,
    `defaultTrackForBiome should map ${biome.name} to ${expectedTrack}.`,
  );
}

state.userSettings.musicTrackOverrides = {};
const goldenBiome = BIOMES.find((b) => b.id === "golden");
assert(goldenBiome, "golden steppe biome should exist for override test.");

setMusicTrackOverride(goldenBiome.id, "FrozenVale.mp3");
assert.equal(
  selectedTrackForBiome(goldenBiome),
  "FrozenVale.mp3",
  "A registered override should be selected over the biome default.",
);

setMusicTrackOverride(goldenBiome.id, "not-a-real-track.mp3");
assert.equal(
  selectedTrackForBiome(goldenBiome),
  defaultTrackForBiome(goldenBiome),
  "An override naming an unregistered track should be dropped, falling back to the biome default.",
);

for (const [key, track] of Object.entries(BIOME_TRACKS)) {
  assert(
    AVAILABLE_MUSIC_TRACKS.includes(track),
    `BIOME_TRACKS["${key}"] should resolve to a track registered in AVAILABLE_MUSIC_TRACKS.`,
  );
}

assert.match(music, /const MUSIC_BASE_URL = "https:\/\/static\.pardev\.net\/small-world\/music"/);
assert.match(music, /const src = `\$\{MUSIC_BASE_URL\}\/\$\{track\}`/);
assert.match(storage, /"musicTrackOverrides"/);
assert.match(ui, /getElementById\("setting-music-track"\)/);
assert.match(ui, /refreshMusicTrackSelect/);
assert.match(ui, /setMusicTrackOverride\(state\.currentBiome\?\.id, musicTrackEl\.value\)/);
assert.match(html, /id="setting-music-track"/);
assert.match(gitignore, /public\/music\//);
