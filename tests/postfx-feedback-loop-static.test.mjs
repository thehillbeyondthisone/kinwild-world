// Protected invariant: InputPass (the composer's entry point) reads
// directly from whatever source texture it's given via setSourceTexture —
// there is no intermediate soft-particle colorRT copy in the pipeline.
// initPostFX itself needs a real WebGL renderer to construct its
// EffectComposer/render-target chain, which isn't available under plain
// node, so the depth-pre-pass wiring and pass ordering (an explicitly
// allowed QA-009 "postfx passes" exception) stay source-text checks.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.__APP_VERSION__ = 'test';

const { InputPass } = await import('../src/postfx.js');

const sourceA = {};
const sourceB = {};
const pass = new InputPass(sourceA);
pass.setSourceTexture(sourceB);

const renderCalls = [];
const fakeRenderer = {
  setRenderTarget: (rt) => renderCalls.push(['setRenderTarget', rt]),
  render: (scene, cam) => renderCalls.push(['render', scene, cam]),
};
const fakeWriteBuffer = {};
pass.render(fakeRenderer, fakeWriteBuffer);

assert.equal(
  pass.uniforms.tDiffuse.value,
  sourceB,
  'InputPass should render directly from the texture set via setSourceTexture (no intermediate colorRT copy).'
);
assert.deepEqual(
  renderCalls[0],
  ['setRenderTarget', fakeWriteBuffer],
  'InputPass should write into the composer write buffer directly.'
);

const postfxSource = readFileSync(new URL('../src/postfx.js', import.meta.url), 'utf8');

assert(
  !postfxSource.includes('const colorRT = new THREE.WebGLRenderTarget')
    && !postfxSource.includes('particleDepthUniform')
    && !postfxSource.includes('particleSoftUniform'),
  'Post-FX should not keep the removed soft-particle feedback-loop workaround.'
);

assert(
  postfxSource.includes('renderer.setRenderTarget(depthRT);')
    && postfxSource.includes('renderer.render(s, cam);')
    && postfxSource.includes('inputPass.setSourceTexture(depthRT.texture);'),
  'The depth pre-pass render should feed the composer directly after soft-particle removal.'
);

const inputAdd = postfxSource.indexOf('composer.addPass(inputPass)');
const depthFXAdd = postfxSource.indexOf('composer.addPass(depthFXPass)');
const bloomAdd = postfxSource.indexOf('composer.addPass(bloomCompositePass)');

assert(
  inputAdd >= 0
    && depthFXAdd > inputAdd
    && bloomAdd > depthFXAdd,
  'Depth outlines/AO/fog should be composited before bloom so bloom can soften bright edges instead of outlines drawing over the halo.'
);
