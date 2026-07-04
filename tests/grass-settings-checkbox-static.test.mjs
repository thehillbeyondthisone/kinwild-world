import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";

const ui = readFileSync("src/ui/settings-panel.js", "utf8");
const world = readFileSync("src/world.js", "utf8");

assert.match(
  ui,
  /function syncGrassControls\(\) \{[\s\S]*?const grassAvailable = !!state\.grass;[\s\S]*?const enabled = grassAvailable && state\.userSettings\.grassEnabled !== false;[\s\S]*?grassEnabledEl\.checked = enabled;[\s\S]*?grassEnabledEl\.disabled = !grassAvailable;/,
  "Grass enabled checkbox should reflect the actual grass mesh availability, not only the persisted preference."
);

assert.match(
  ui,
  /state\._reapplyGrassSettings = \(\) => \{[\s\S]*?applyGrassSettings\(\);[\s\S]*?syncGrassControls\(\);[\s\S]*?\};/,
  "Grass control state should resync after the initial world build and every regeneration."
);

assert.match(
  world,
  /const grass = makeGrassField\(biome, worldState\.heightFn, coverExclusions, grassShorteners(?:, \w+)?\);\s+if \(grass\) worldState\.world\.add\(grass\);/,
  "World generation should establish whether grass exists (state.grass) before the end-of-build \"world-ready\" event resyncs grass controls."
);

assert.match(
  ui,
  /window\.addEventListener\("world-ready", \(\) => \{[\s\S]*?state\._reapplyWindSettings[\s\S]*?state\._reapplyGrassSettings[\s\S]*?\}\);/,
  "ARC-005: wind/grass settings should be re-applied via the world-ready event generateWorld dispatches, not a direct call from world.js."
);
