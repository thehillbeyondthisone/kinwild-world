/**
 * The onboarding's paper: margin notes, hand-drawn leader lines, and the seed
 * stamp that opens the first visit.
 *
 * This module is the view. What to say lives in `src/tutorial/copy.js`, when
 * to say it in `src/tutorial/progress.js` and the wiring in `observatory.js`;
 * everything here only knows how to *show* — a note with a leader that draws
 * itself onto a live subject, a ring around two kin, the stamped seed sheet.
 *
 * The leaders reuse the observatory's callout geometry
 * (`observatory-callouts.js`) so a tutorial pointer is the same drawn line the
 * field already uses, not a second visual dialect.
 */
import { leaderPoints, placeCallout } from "./observatory-callouts.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/** How long the ring sight holds before it lifts. */
const RING_HOLD_MS = 2600;
/** The stamped sheet never outstays its welcome even untouched. */
const STAMP_AUTO_DISMISS_MS = 9000;

function reducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function element(id) {
  return document.getElementById(id);
}

/**
 * Wire the tutorial overlay. The markup lives in index.html
 * (`#tutorial-layer` and children), as with every other panel.
 */
export function initTutorialNotes() {
  const svg = element("tutorial-leaders");
  const note = element("tutorial-note");
  const noteText = element("tutorial-note-text");
  const noteHint = element("tutorial-note-hint");
  const aside = element("tutorial-aside");
  const sheet = element("tutorial-stamp-sheet");
  const stampSeed = element("tutorial-stamp-seed");
  const stampName = element("tutorial-stamp-name");
  const stampCaption = element("tutorial-stamp-caption");
  const stampDismiss = element("tutorial-stamp-dismiss");

  let raf = 0;
  let anchor = null;
  let leaderPath = null;
  let rings = [];
  let asideTimer = 0;

  function loop() {
    raf = 0;
    reposition();
    if (anchor || rings.length > 0) raf = window.requestAnimationFrame(loop);
  }
  function kick() {
    if (!raf) raf = window.requestAnimationFrame(loop);
  }

  /** Follow a moving subject; hide the leader when it leaves the frame. */
  function reposition() {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    if (anchor && leaderPath) {
      const point = anchor();
      if (!point) {
        leaderPath.setAttribute("d", "");
      } else {
        const placed = placeCallout(
          point,
          { width: note.offsetWidth || 220, height: note.offsetHeight || 64, gap: 26 },
          [],
          viewport,
        );
        if (placed) {
          note.style.left = `${placed.left}px`;
          note.style.top = `${placed.top}px`;
        }
        const rect = note.getBoundingClientRect();
        const leader = leaderPoints(
          point,
          { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
          viewport,
        );
        leaderPath.setAttribute("d", leader.path);
      }
    }
    for (const ring of rings) {
      const point = ring.anchor();
      if (!point) {
        ring.node.setAttribute("visibility", "hidden");
        continue;
      }
      ring.node.removeAttribute("visibility");
      ring.node.setAttribute("cx", point.x.toFixed(1));
      ring.node.setAttribute("cy", point.y.toFixed(1));
    }
  }

  return {
    /**
     * The cold open: a paper sheet over the field, the seed stamped onto it
     * digit by digit, the island's name underneath. Any press steps through;
     * it also lifts itself after a while. `onDone` fires exactly once.
     */
    showSeedStamp({ seedText, islandName, caption, dismiss, onDone }) {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        window.clearTimeout(autoTimer);
        sheet.classList.remove("is-open");
        sheet.hidden = true;
        onDone?.();
      };

      stampName.textContent = islandName;
      stampCaption.textContent = caption;
      stampDismiss.textContent = dismiss;
      sheet.hidden = false;
      // Double rAF so `hidden` removal paints before the press transition.
      window.requestAnimationFrame(() =>
        window.requestAnimationFrame(() => sheet.classList.add("is-open")),
      );

      const digits = String(seedText);
      if (reducedMotion()) {
        stampSeed.textContent = digits;
        stampSeed.classList.add("settled");
      } else {
        // seed-settle: every position flickers, then fixes left to right —
        // a number stopping being arbitrary one digit at a time.
        const start = performance.now();
        const flicker = window.setInterval(() => {
          const settledCount = Math.floor((performance.now() - start) / 260);
          if (settledCount >= digits.length) {
            window.clearInterval(flicker);
            stampSeed.textContent = digits;
            stampSeed.classList.add("settled");
            return;
          }
          stampSeed.textContent =
            digits.slice(0, settledCount) +
            [...digits.slice(settledCount)]
              .map((c) => (/[0-9a-f]/i.test(c) ? "0123456789abcdef"[(Math.random() * 16) | 0] : c))
              .join("");
        }, 50);
      }

      sheet.addEventListener("pointerdown", finish, { once: true });
      window.addEventListener("keydown", finish, { once: true });
      const autoTimer = window.setTimeout(finish, STAMP_AUTO_DISMISS_MS);
    },

    /**
     * A margin note. With `anchor` (a function returning screen-space
     * `{x, y}` or null) it floats beside its subject with a leader line that
     * draws itself on; without one it sits in the lower-left margin.
     */
    showNote({ text, hint = "", anchor: nextAnchor = null }) {
      this.hideNote();
      noteText.textContent = text;
      noteHint.textContent = hint;
      noteHint.hidden = !hint;
      note.hidden = false;
      anchor = nextAnchor;
      if (anchor) {
        leaderPath = document.createElementNS(SVG_NS, "path");
        leaderPath.setAttribute("class", "tutorial-leader");
        svg.appendChild(leaderPath);
        note.classList.add("has-leader");
        // Draw-on: the path length is only known once the first frame lays it
        // out, so the class goes on after the first reposition.
        window.requestAnimationFrame(() => {
          reposition();
          try {
            const length = leaderPath.getTotalLength();
            leaderPath.style.setProperty("--leader-length", String(Math.ceil(length)));
            leaderPath.classList.add("drawing");
          } catch {
            // A zero-length path simply appears.
          }
        });
      } else {
        note.classList.remove("has-leader");
        note.style.left = "";
        note.style.top = "";
      }
      note.classList.remove("rising");
      window.requestAnimationFrame(() => note.classList.add("rising"));
      kick();
    },

    /** A small unsigned margin line that fades on its own. */
    showAside(text) {
      window.clearTimeout(asideTimer);
      aside.textContent = text;
      aside.hidden = false;
      aside.classList.remove("fading");
      asideTimer = window.setTimeout(() => aside.classList.add("fading"), 5200);
    },

    /**
     * The sight a layer ends on: hand-drawn rings around the subjects the
     * player just connected, held for a beat, then lifted.
     */
    ringSubjects(anchors) {
      for (const ringAnchor of anchors ?? []) {
        const node = document.createElementNS(SVG_NS, "circle");
        node.setAttribute("class", "tutorial-ring");
        node.setAttribute("r", "26");
        svg.appendChild(node);
        rings.push({ node, anchor: ringAnchor });
      }
      kick();
      window.setTimeout(() => {
        for (const ring of rings) ring.node.classList.add("lifting");
        window.setTimeout(() => this.clearRings(), 700);
      }, RING_HOLD_MS);
    },

    clearRings() {
      for (const ring of rings) ring.node.remove();
      rings = [];
    },

    hideNote() {
      note.hidden = true;
      anchor = null;
      leaderPath?.remove();
      leaderPath = null;
    },

    /** World regen: everything pointing into the old field comes down. */
    clear() {
      this.hideNote();
      this.clearRings();
      window.clearTimeout(asideTimer);
      aside.hidden = true;
      sheet.hidden = true;
      sheet.classList.remove("is-open");
    },
  };
}
