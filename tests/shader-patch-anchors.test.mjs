// The anchors the shader patches splice into, checked against the real three.js.
//
// Three of this project's hottest effects are installed by finding a string in
// three's generated shader source and replacing it: the SDF blend shell, the
// batched-flora touch bend, and the wind sway. A miss is not an error — the
// shader still compiles, and the effect simply is not there:
//
// - shell/begin_vertex missing ships the raw carrier capsules, unprojected. The
//   animal comes apart into the shapes it is made of.
// - shell/beginnormal_vertex missing lights a smooth body with primitive normals.
// - flora-touch/project_vertex missing means plants stop reacting to being brushed.
// - wind-sway/begin_vertex missing reads as a calm day.
//
// `replaceOrWarn` makes each of those noisy at runtime. This file is the other
// half: it fails the build when an anchor stops existing at all, which is what
// a three.js upgrade does. The pre-existing guard in
// generated-flora-renderer.test.mjs patches a *mock* shader string containing
// the anchors by construction, so it cannot see a real break — this one reads
// three's own source.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { LocalBlendShell } from "../src/generated-fauna/shell.js";

const shellSource = readFileSync(new URL("../src/generated-fauna/shell.js", import.meta.url), "utf8");
const batchSource = readFileSync(new URL("../src/generated-flora/batch.js", import.meta.url), "utf8");
const utilSource = readFileSync(new URL("../src/util.js", import.meta.url), "utf8");

// --- the chunks the patches name still exist -------------------------------

for (const chunk of [
  "common",
  "begin_vertex",
  "beginnormal_vertex",
  "project_vertex",
  "color_fragment",
]) {
  assert(
    typeof THREE.ShaderChunk[chunk] === "string",
    `three r${THREE.REVISION} no longer has a "${chunk}" shader chunk`,
  );
}

// --- and the materials being patched still include them --------------------

// Which ShaderLib entry backs each material the project patches. The shell
// patches a toon material plus the custom depth and distance materials it hangs
// on the mesh for shadows; flora and donor foliage are standard/physical.
const EXPECTED = [
  ["toon", "MeshToonMaterial — the generated-fauna beauty pass", ["common", "beginnormal_vertex", "begin_vertex", "project_vertex"]],
  ["depth", "MeshDepthMaterial — the shell's custom depth material", ["begin_vertex", "project_vertex"]],
  ["distance", "MeshDistanceMaterial — the shell's custom distance material", ["begin_vertex"]],
  ["standard", "MeshStandardMaterial — flora touch bend and wind sway", ["common", "begin_vertex", "project_vertex"]],
  ["physical", "MeshPhysicalMaterial — PBR flora", ["common", "begin_vertex", "project_vertex"]],
];

for (const [libName, label, chunks] of EXPECTED) {
  const lib = THREE.ShaderLib[libName];
  assert(lib, `three r${THREE.REVISION} no longer has ShaderLib.${libName} (${label})`);
  assert(
    lib.vertexShader.includes("void main() {"),
    `${label}: the shell splices its compute step after "void main() {"`,
  );
  for (const chunk of chunks) {
    assert(
      lib.vertexShader.includes(`#include <${chunk}>`),
      `${label}: vertex shader no longer includes <${chunk}>`,
    );
  }
}

// The shell's colour multiply rides the fragment side of the toon material.
assert(
  THREE.ShaderLib.toon.fragmentShader.includes("#include <color_fragment>"),
  "the toon fragment shader no longer includes <color_fragment>",
);

// --- and every patch site actually warns rather than no-oping ---------------

// A raw String.replace on shader source is the bug this file exists for. These
// pin the three sites the 2026-07-29 audit found, so a regression to `.replace`
// fails here rather than in a player's browser.
const sites = [
  [shellSource, "src/generated-fauna/shell.js (injectShell)", 4],
  [batchSource, "src/generated-flora/batch.js (applyTouchBend)", 2],
  [utilSource, "src/util.js (applyWindSway)", 2],
];

for (const [source, label, expected] of sites) {
  const uses = (source.match(/replaceOrWarn\(/g) ?? []).length;
  assert.equal(uses, expected, `${label} should route ${expected} anchors through replaceOrWarn`);
  assert(
    !/\n\s*\.replace\(\s*\n?\s*"#include </.test(source),
    `${label} still patches a shader include with a raw String.replace`,
  );
}

// --- the shell really does splice into three's real shader ------------------

// The checks above prove the anchors exist and that the code asks for them
// politely. This proves the whole thing actually lands: a real LocalBlendShell's
// onBeforeCompile is run against three's own unmodified toon shader, and the
// result is inspected. No mock source anywhere — feeding it a hand-written
// string containing the anchors is the exact mistake that let the old guard
// pass through a real break.
const shell = new LocalBlendShell(
  [
    { type: "sphere", radius: 0.3, color: "#ffffff", blend: 0.08 },
    { type: "capsule", radius: 0.1, halfLength: 0.2, color: "#cccccc", blend: 0.08 },
  ],
  {
    influences: [[1], [0]],
    localBounds: new THREE.Box3(
      new THREE.Vector3(-1, -1, -1),
      new THREE.Vector3(1, 1, 1),
    ),
  },
);

const compiled = {
  uniforms: {},
  vertexShader: THREE.ShaderLib.toon.vertexShader,
  fragmentShader: THREE.ShaderLib.toon.fragmentShader,
};
shell.material.onBeforeCompile(compiled);

// The compute step runs at the top of main, before anything reads the result.
assert(
  compiled.vertexShader.includes("gfBlendShell(position,"),
  "the shell's compute step was not spliced into main()",
);
// And the two lines that actually make a body a body.
assert(
  compiled.vertexShader.includes("vec3 transformed = gfShellPosition;"),
  "begin_vertex was not replaced — the carriers would ship unprojected",
);
assert(
  compiled.vertexShader.includes("vec3 objectNormal = gfShellNormal;"),
  "beginnormal_vertex was not replaced — a smooth body lit by primitive normals",
);
// The originals are gone, so nothing downstream overwrites the projected values.
assert(
  !compiled.vertexShader.includes("#include <begin_vertex>"),
  "the original begin_vertex include survived and would overwrite `transformed`",
);
assert(
  !compiled.vertexShader.includes("#include <beginnormal_vertex>"),
  "the original beginnormal_vertex include survived",
);
// The uniforms the spliced GLSL reads have to be handed over, or it compiles
// against nothing.
for (const uniform of ["uPrimPosK", "uPrimInfl", "uTuck", "uGradEps", "uIters"]) {
  assert(uniform in compiled.uniforms, `the shell did not hand over ${uniform}`);
}
assert(
  compiled.fragmentShader.includes("diffuseColor.rgb *= vGeneratedFaunaColor;"),
  "the per-vertex blended colour never reaches the fragment stage",
);

shell.dispose();

console.log("shader patch anchor tests passed");
