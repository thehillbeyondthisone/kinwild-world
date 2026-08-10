// The scrub between a body and the shapes it is made of.
//
// `uShellMix` is what Layer 4b of the tutorial drags: at 1 every vertex sits on
// the smooth-min surface of its influence set, which is the shipping look; at 0
// every vertex stays on its own carrier, which is the animal as a handful of
// overlapping capsules. The claim this file has to protect is that **adding the
// dial changed nothing** — the default path has to be the same geometry it was
// before the uniform existed.
//
// That holds because of one property of `mix`: `mix(a, b, 1.0)` is
// `a * 0.0 + b * 1.0`, which is exactly `b`. So the assertion is that the
// default is precisely 1, not merely close to it.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { LocalBlendShell } from "../src/generated-fauna/shell.js";

const shellSource = readFileSync(new URL("../src/generated-fauna/shell.js", import.meta.url), "utf8");

/** One spec per influence list — the constructor requires them to agree. */
function makeShell(influences = [[1], [0]]) {
  const specs = influences.map((_, index) =>
    index % 2 === 0
      ? { type: "sphere", radius: 0.3, color: "#ffffff", blend: 0.08 }
      : { type: "capsule", radius: 0.1, halfLength: 0.2, color: "#cccccc", blend: 0.08 },
  );
  return new LocalBlendShell(
    specs,
    {
      influences,
      localBounds: new THREE.Box3(
        new THREE.Vector3(-1, -1, -1),
        new THREE.Vector3(1, 1, 1),
      ),
    },
  );
}

// --- the shipping path is untouched ----------------------------------------

const shell = makeShell();
assert.strictEqual(
  shell.uniforms.uShellMix.value,
  1,
  "the default must be exactly 1 — mix(a, b, 1.0) is exactly b, and that is the whole argument that nothing changed",
);

// --- and the dial moves ------------------------------------------------------

assert.equal(shell.setShellMix(0), 0);
assert.equal(shell.uniforms.uShellMix.value, 0);
assert.equal(shell.setShellMix(0.5), 0.5);

// A scrub is a drag. Its endpoints stop rather than throw.
assert.equal(shell.setShellMix(-3), 0);
assert.equal(shell.setShellMix(9), 1);
assert.equal(shell.setShellMix(Number.NaN), 1, "a non-number falls back to the skin");
assert.equal(shell.setShellMix(undefined), 1);

// --- the GLSL actually uses it ----------------------------------------------

assert(
  shellSource.includes("uniform float uShellMix;"),
  "the uniform has to be declared in the shader, not only handed over",
);
assert(
  shellSource.includes("point = mix(carrier, point, uShellMix);"),
  "the mix must be applied to the projected point",
);
// Applied before the normal and colour are read, or the shading would slide off
// the geometry partway through the scrub.
const mixAt = shellSource.indexOf("point = mix(carrier, point, uShellMix);");
const positionAt = shellSource.indexOf("shellPosition = point;");
const normalAt = shellSource.indexOf("shellNormal = gfGradient(");
assert(mixAt > 0 && mixAt < positionAt, "the mix must precede shellPosition");
assert(mixAt < normalAt, "the mix must precede the normal, so shading follows the geometry");
// The tuck is a trick for hiding buried vertices under a skin; with no skin
// there is nothing to hide under.
assert(
  shellSource.includes("float target = -uTuck.x * tuckAmount * uShellMix;"),
  "the tuck depth should fade out with the blend",
);

// --- the blend graph is readable ---------------------------------------------

// It is packed into a uniform, which is write-only from JS. The underdrawing
// draws these as the joins between carriers, so the shell has to keep a copy.
assert.deepEqual(
  shell.influences.map((list) => [...list]),
  [[1], [0]],
  "the influence lists should be readable back off the shell",
);
assert.throws(
  () => {
    shell.influences.push([0]);
  },
  "the graph is frozen — it has already been packed into uPrimInfl",
);
assert.throws(() => {
  shell.influences[0].push(9);
});

shell.dispose();

// A four-primitive body, to be sure the copy is not a two-element special case.
const bigger = makeShell([[1, 2], [0], [0, 3], [2]]);
assert.deepEqual(
  bigger.influences.map((list) => [...list]),
  [[1, 2], [0], [0, 3], [2]],
);
bigger.dispose();

console.log("generated fauna shell mix tests passed");
