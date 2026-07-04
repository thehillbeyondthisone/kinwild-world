// Protected invariant: music volume is hard-capped at MAX_VOLUME (15%) and
// the persisted 0-1 slider value is clamped before being applied to the
// live <audio> element, both by default (disabled, 50%) and via setMusicVolume.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

globalThis.__APP_VERSION__ = "test";

const rafCallbacks = [];
class FakeAudio {
  static instances = [];
  constructor() {
    this.loop = false;
    this.volume = 0;
    this.preload = "";
    this.paused = true;
    this._src = "";
    FakeAudio.instances.push(this);
  }
  get src() {
    return this._src;
  }
  set src(value) {
    this._src = value;
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  load() {}
}
globalThis.Audio = FakeAudio;
globalThis.requestAnimationFrame = (cb) => {
  rafCallbacks.push(cb);
  return rafCallbacks.length;
};

const { state } = await import("../src/state.js");
const { MAX_VOLUME, setMusicVolume, switchMusic } = await import("../src/music.js");

// The volume-slider UI wiring lives in src/ui.js, a DOM-touching module
// owned by another QA-009 agent — kept as a source check here.
const ui = readFileSync("src/ui.js", "utf8");
const html = readFileSync("index.html", "utf8");

assert.equal(state.userSettings.musicVolume, 0.5, "Default persisted music volume should be 50%.");
assert.equal(state.userSettings.musicEnabled, false, "Music should be disabled by default.");
assert.equal(MAX_VOLUME, 0.15, "Music volume should be hard-capped at 15%.");

state.userSettings.musicEnabled = true;
switchMusic({ id: "test-biome", name: "test biome" });
const audio = FakeAudio.instances[0];
assert(audio, "switchMusic should lazily create the audio element.");

setMusicVolume(2); // out-of-range high input
assert.equal(state.userSettings.musicVolume, 1, "setMusicVolume should clamp the persisted slider value to 1.");
assert.equal(audio.volume, MAX_VOLUME, "A slider value of 100% should apply exactly MAX_VOLUME to the audio element.");

setMusicVolume(-3); // out-of-range low input
assert.equal(state.userSettings.musicVolume, 0, "setMusicVolume should clamp the persisted slider value to 0.");
assert.equal(audio.volume, 0, "A slider value of 0% should silence the audio element.");

setMusicVolume(0.5);
assert.equal(audio.volume, MAX_VOLUME * 0.5, "setMusicVolume should scale the audio element by MAX_VOLUME.");

assert.match(ui, /"musicVolume"/);
assert.match(ui, /setMusicVolume\(v \/ 100\)/);
assert.match(html, /id="setting-music-volume"/);
assert.match(html, /id="setting-music-volume-value">50%/);
