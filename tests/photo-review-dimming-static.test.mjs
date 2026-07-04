// QA-009: the numeric dim-overlay contract (render order + opacity) now
// lives in the DOM-free src/ui/constants.js module and is asserted by
// importing it, instead of grepping literal numbers out of ui.js. The
// remaining checks (no DOM overlay div, vignette CSS shape) only exist as
// wiring inside ui.js's initUi()/showPhotoReview() closures and CSS, which
// require a full browser DOM to exercise — those stay as source-text
// assertions.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

const { PHOTO_REVIEW_DIM_RENDER_ORDER, PHOTO_REVIEW_DIM_OPACITY } = await import('../src/ui/constants.js');

// Protected invariant: the photo-review dim plane renders behind the
// postcard mesh (renderOrder 998, below the mesh/border) and darkens the
// scene by a fixed, moderate amount.
assert.equal(PHOTO_REVIEW_DIM_RENDER_ORDER, 998, 'Photo review dimming should render behind the postcard in the 3D review group.');
assert.equal(PHOTO_REVIEW_DIM_OPACITY, 0.45, 'Photo review dimming should darken the scene by a fixed, moderate amount.');

const vignetteBlock = cssSource.match(/\.vignette\s*\{[^}]*\}/)?.[0] ?? '';

assert(
  !vignetteBlock.includes('radial-gradient'),
  'The global vignette overlay should not add a center halo or dark camera-edge falloff.'
);

assert(
  !uiSource.includes('const dim = document.createElement("div");'),
  'Photo review dimming should not use a DOM overlay above the canvas because it darkens the postcard preview.'
);

assert(
  uiSource.includes('dimMesh.renderOrder = PHOTO_REVIEW_DIM_RENDER_ORDER')
    && uiSource.includes('dimMat.opacity = PHOTO_REVIEW_DIM_OPACITY'),
  'ui.js should apply the shared dim render-order/opacity constants rather than re-declaring the numbers.'
);
