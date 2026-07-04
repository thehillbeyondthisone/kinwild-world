import * as THREE from "three";
import { state } from "../state.js";
import { replaceOrWarn } from "../util.js";
import { LOWFX } from "../lowfx.js";
import { WATER_AVOID_Y } from "../fauna/shared.js";

// ─── soft-ground creature marks (terrain shader painted) ───
const GROUND_MARK_TEX_SIZE = LOWFX ? 256 : 512;
const GROUND_MARK_MAX_MARKS = LOWFX ? 192 : 512;
// Full-canvas repaints are throttled to this cadence; marks fade over several
// seconds so the up-to-this-long staleness between repaints reads as
// invisible while cutting per-frame canvas rasterization + texture upload.
const GROUND_MARK_REPAINT_INTERVAL = 0.1; // seconds (~10Hz)

const _groundMarkPaint = `
vec2 groundMarkUv = vGroundMarkXZ * uGroundMarkInvSize + 0.5;
float groundMarkAlpha = texture2D(uGroundMarkTex, groundMarkUv).a;
diffuseColor.rgb = mix(diffuseColor.rgb, uGroundMarkColor, clamp(groundMarkAlpha, 0.0, 0.85));
`;

function _makeGroundMarkTexture(size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  // The stamp-drawing transform (translate/rotate/scale) already sizes and
  // positions each stamp, so a single unit-radius gradient is reusable for
  // every stamp — per-stamp opacity is applied via ctx.globalAlpha instead of
  // baking it into a freshly allocated gradient each call.
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0.00, "rgba(255,255,255,1)");
  gradient.addColorStop(0.45, "rgba(255,255,255,0.72)");
  gradient.addColorStop(1.00, "rgba(255,255,255,0)");
  return { canvas, ctx, texture, gradient };
}

function installGroundMarkShader(system) {
  const mat = state.terrainMesh?.material;
  if (!mat || mat.userData.groundMarkSystem === system) return;

  const d = system.userData;
  const uniforms = d.uniforms;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader) => {
    if (prev) prev(shader);
    shader.uniforms.uGroundMarkColor = uniforms.uGroundMarkColor;
    shader.uniforms.uGroundMarkTex = uniforms.uGroundMarkTex;
    shader.uniforms.uGroundMarkInvSize = uniforms.uGroundMarkInvSize;
    shader.vertexShader = replaceOrWarn(
      replaceOrWarn(
        shader.vertexShader,
        "#include <common>",
        `#include <common>
         varying vec2 vGroundMarkXZ;`,
        "groundMark.vertex.common"
      ),
      "#include <begin_vertex>",
      `#include <begin_vertex>
         vGroundMarkXZ = transformed.xz;`,
      "groundMark.vertex.begin_vertex"
    );
    shader.fragmentShader = replaceOrWarn(
      replaceOrWarn(
        shader.fragmentShader,
        "#include <common>",
        `#include <common>
         uniform vec3 uGroundMarkColor;
         uniform sampler2D uGroundMarkTex;
         uniform float uGroundMarkInvSize;
         varying vec2 vGroundMarkXZ;`,
        "groundMark.fragment.common"
      ),
      "vec4 diffuseColor = vec4( diffuse, opacity );",
      `vec4 diffuseColor = vec4( diffuse, opacity );
         ${_groundMarkPaint}`,
      "groundMark.fragment.diffuseColor"
    );
  };
  mat.userData.groundMarkSystem = system;
  mat.userData.groundMarkUniforms = uniforms;
  mat.needsUpdate = true;
}

function _toGroundMarkPixel(d, x, z) {
  return {
    x: (x * d.invWorldSize + 0.5) * d.size,
    y: (z * d.invWorldSize + 0.5) * d.size,
  };
}

function _drawGroundMarkStamp(d, x, z, heading, width, length, opacity) {
  const p = _toGroundMarkPixel(d, x, z);
  const pad = Math.max(width, length) * d.pxPerWorld * 1.4;
  if (p.x < -pad || p.x > d.size + pad || p.y < -pad || p.y > d.size + pad) return;

  const ctx = d.ctx;
  const w = Math.max(1, width * d.pxPerWorld);
  const h = Math.max(1, length * d.pxPerWorld);
  ctx.save();
  ctx.globalAlpha = Math.min(1, opacity);
  ctx.translate(p.x, p.y);
  ctx.rotate(heading);
  ctx.scale(w, h);
  ctx.fillStyle = d.gradient;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function _paintGroundMark(system, mark, opacity) {
  const d = system.userData;
  const x = mark.x;
  const z = mark.z;
  if (Number.isFinite(mark.fromX) && Number.isFinite(mark.fromZ)) {
    const dx = x - mark.fromX;
    const dz = z - mark.fromZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const spacing = Math.max(0.04, Math.min(mark.width, mark.length) * 0.42);
    const steps = Math.max(1, Math.ceil(dist / spacing));
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      _drawGroundMarkStamp(
        d,
        mark.fromX + dx * u,
        mark.fromZ + dz * u,
        mark.heading,
        mark.width,
        mark.length,
        opacity
      );
    }
  } else {
    _drawGroundMarkStamp(d, x, z, mark.heading, mark.width, mark.length, opacity);
  }
}

function _groundMarkLife(mark) {
  const scale = state.userSettings.groundMarkLifeScale ?? 1;
  return mark.baseLife * Math.max(0.01, scale);
}

function _repaintGroundMarks(system) {
  const d = system.userData;
  d.ctx.clearRect(0, 0, d.size, d.size);
  for (const mark of d.marks) {
    const u = mark.age / Math.max(0.001, _groundMarkLife(mark));
    const fade = 1 - u * u * (3 - 2 * u);
    _paintGroundMark(system, mark, mark.opacity * fade);
  }
  d.texture.needsUpdate = true;
  d.active[0] = d.marks.length > 0 ? 1 : 0;
}

export function makeGroundMarks(biome) {
  const cfg = biome.groundMarks;
  if (!cfg) return null;

  const size = cfg.textureSize ?? GROUND_MARK_TEX_SIZE;
  const { canvas, ctx, texture, gradient } = _makeGroundMarkTexture(size);
  const system = new THREE.Object3D();
  system.name = "terrain-painted-ground-marks";
  system.visible = false;
  // disposeGroup() only knows about geometry/material, so provide a tiny
  // material-like disposer for the CanvasTexture owned by this Object3D.
  system.material = { dispose: () => texture.dispose() };
  system.userData = {
    canvas,
    ctx,
    texture,
    gradient,
    size,
    invWorldSize: 1 / state.ISLAND_SIZE,
    pxPerWorld: size / state.ISLAND_SIZE,
    marks: [],
    maxMarks: cfg.maxMarks ?? GROUND_MARK_MAX_MARKS,
    active: new Uint8Array(1),
    // Full-canvas repaints are throttled — see GROUND_MARK_REPAINT_INTERVAL.
    repaintTimer: 0,
    uniforms: {
      uGroundMarkColor: { value: new THREE.Color(cfg.color) },
      uGroundMarkTex: { value: texture },
      uGroundMarkInvSize: { value: 1 / state.ISLAND_SIZE },
    },
    cfg,
  };

  installGroundMarkShader(system);
  return system;
}

export function emitGroundMark(system, opts = {}) {
  if (!system || !system.userData) return;
  installGroundMarkShader(system);
  const d = system.userData;
  const x = opts.x;
  const z = opts.z;
  const y = opts.y ?? (state.heightFn ? state.heightFn(x, z) : 0);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
  if (state.waterMesh && y < WATER_AVOID_Y) return;

  const softness = d.cfg.softness ?? 1;
  const mark = {
    x,
    z,
    fromX: opts.fromX,
    fromZ: opts.fromZ,
    heading: opts.heading ?? 0,
    width: Math.max(0.01, (opts.width ?? 0.18) * softness),
    length: Math.max(0.01, (opts.length ?? 0.32) * softness),
    opacity: opts.opacity ?? d.cfg.opacity ?? 0.2,
    baseLife: opts.life ?? d.cfg.life ?? 6,
    age: 0,
  };
  if (d.marks.length >= d.maxMarks) d.marks.shift();
  d.marks.push(mark);
  _paintGroundMark(system, mark, mark.opacity);
  d.texture.needsUpdate = true;
  d.active[0] = 1;
}

export function stepGroundMarks(system, dt) {
  if (!system || !system.userData || dt <= 0) return;
  installGroundMarkShader(system);
  const d = system.userData;
  if (!d.marks.length) return;
  let expired = false;
  for (let i = d.marks.length - 1; i >= 0; i--) {
    const mark = d.marks[i];
    mark.age += dt;
    if (mark.age >= _groundMarkLife(mark)) {
      d.marks.splice(i, 1);
      expired = true;
    }
  }
  // Throttle the full clear+redraw to ~10Hz — marks fade over several
  // seconds, so up to one interval of staleness is visually invisible.
  // Always repaint immediately on expiry so a mark's final disappearance
  // (and the canvas fully clearing once none remain) isn't delayed.
  d.repaintTimer += dt;
  if (expired || d.repaintTimer >= GROUND_MARK_REPAINT_INTERVAL) {
    d.repaintTimer = 0;
    _repaintGroundMarks(system);
  }
}
