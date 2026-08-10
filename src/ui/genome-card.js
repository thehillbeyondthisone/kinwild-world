/**
 * The genome card — a leaf out of the field notebook.
 *
 * One face is the pressed page: every field of the genome as a row of
 * notebook ruling, generated from the schema rather than written out here. The
 * other face is the writing those rows were generated from — the real JSON,
 * set in ink on paper. Turning the card over is the whole lesson, so it is a
 * turn and not a tab.
 *
 * Three rules shaped nearly every decision in this file:
 *
 * - **It is a page, not a panel.** No monospace gutters, no syntax colouring,
 *   no red. Figures are set in the same face the specimen table already uses
 *   for measurements, which is a field table's convention rather than a code
 *   editor's.
 * - **The control is drawn, not styled.** Each numeric field is a surveyor's
 *   rule with a nib on it. A real `<input type="range">` lies invisibly on top
 *   so that keyboard, touch, drag and assistive technology all work exactly as
 *   they should, and nothing about the native widget is ever seen.
 * - **The normalizer has the last word, live.** While a drag is in flight the
 *   nib shows where the value *settled*, not where the pointer is. Push a leg
 *   past what its length allows and the nib simply stops, with the reason
 *   appearing in the margin. Letting the rule physically refuse is worth more
 *   than any amount of explaining.
 *
 * The card owns a draft and nothing else. It never touches the runtime: it
 * hands a settled genome to `onCommit` and the host decides what that means.
 */

import {
  createGenomeDraft,
  editGenomeDraft,
  fieldRange,
  genomeDocument,
  spellNumber,
  trackFraction,
} from "./genome-draft.js";
import { readGenomePath } from "./genome-schema.js";

/** How long the card waits after the last input before rebuilding the world. */
const COMMIT_DELAY_MS = 120;
/** Long enough to read as a deliberate turn, short enough not to be a wait. */
const FLIP_MS = 700;
/** Options beyond this many stop being a row of tabs and become a list. */
const MAX_SEGMENTED_OPTIONS = 4;

const element = (id) => document.getElementById(id);

/** Fixed decimals from the control's own step, so a column of figures lines up. */
function decimalsFor(step) {
  if (!Number.isFinite(step) || step <= 0) return 2;
  return Math.max(0, Math.min(4, Math.ceil(-Math.log10(step))));
}

function formatValue(value, field) {
  if (!Number.isFinite(value)) return "—";
  if (field.integer) return String(Math.round(value));
  return value.toFixed(decimalsFor(field.step));
}

function makeElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Build one field's row.
 *
 * Returns the row element plus the handful of nodes that get patched as the
 * genome changes, so an edit never has to rebuild the row it is being made
 * from — which would destroy the very input the pointer is holding.
 */
function buildRow(field, onEdit) {
  const row = makeElement("div", "genome-row");
  row.dataset.path = field.path;
  row.dataset.control = field.control;
  row.append(makeElement("div", "genome-row-label", field.label));

  const body = makeElement("div", "genome-row-body");
  const parts = { row, body, note: null, value: null, input: null };

  if (field.control === "slider" || field.control === "stepper") {
    const value = makeElement("output", "genome-row-value");
    const rule = makeElement("div", "genome-rule");
    const track = makeElement("div", "genome-rule-track");
    const fill = makeElement("span", "genome-rule-fill");
    const beyond = makeElement("span", "genome-rule-beyond");
    const nib = makeElement("span", "genome-rule-nib");
    track.append(beyond, fill, nib);

    const input = document.createElement("input");
    input.type = "range";
    input.className = "genome-dial";
    input.min = String(field.lo);
    input.max = String(field.hi);
    input.step = String(field.step);
    input.value = String(field.value);
    input.setAttribute("aria-label", field.label);
    rule.append(track, input);
    body.append(rule, value);

    // `input` fires per pointer sample and drives the live rebuild; `change`
    // fires once the drag is let go and is where the native widget is pulled
    // back into line with whatever the normalizer decided.
    input.addEventListener("input", () => onEdit(field.path, Number(input.value), false));
    input.addEventListener("change", () => onEdit(field.path, Number(input.value), true));

    Object.assign(parts, { value, fill, beyond, nib, input });
  } else if (field.control === "choice") {
    const options = field.options ?? [];
    if (options.length <= MAX_SEGMENTED_OPTIONS) {
      const group = makeElement("div", "genome-choice");
      group.setAttribute("role", "radiogroup");
      group.setAttribute("aria-label", field.label);
      const buttons = new Map();
      for (const option of options) {
        const button = makeElement("button", "genome-choice-option", String(option));
        button.type = "button";
        button.setAttribute("role", "radio");
        button.addEventListener("click", () => onEdit(field.path, option, true));
        buttons.set(option, button);
        group.append(button);
      }
      body.append(group);
      parts.buttons = buttons;
    } else {
      const select = document.createElement("select");
      select.className = "genome-select";
      select.setAttribute("aria-label", field.label);
      for (const option of options) {
        const item = makeElement("option", null, String(option));
        item.value = String(option);
        select.append(item);
      }
      select.addEventListener("change", () => onEdit(field.path, select.value, true));
      body.append(select);
      parts.select = select;
    }
  } else if (field.control === "swatch") {
    // A creature's colours are part of what it is, so they are shown; they are
    // not offered as controls, because a colour picker is an operating-system
    // panel and this is a page.
    const swatch = makeElement("div", "genome-swatch");
    const dot = makeElement("i", "genome-swatch-dot");
    const hex = makeElement("span", "genome-swatch-hex");
    swatch.append(dot, hex);
    body.append(swatch);
    Object.assign(parts, { dot, hex });
  } else if (field.path === "name") {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "genome-text";
    input.maxLength = 64;
    input.spellcheck = false;
    input.setAttribute("aria-label", field.label);
    input.addEventListener("input", () => onEdit(field.path, input.value, false));
    input.addEventListener("change", () => onEdit(field.path, input.value, true));
    body.append(input);
    parts.input = input;
    parts.isText = true;
  } else {
    const value = makeElement("div", "genome-row-static");
    body.append(value);
    parts.value = value;
  }

  row.append(body);
  parts.note = makeElement("p", "genome-row-note");
  row.append(parts.note);
  return parts;
}

/** Patch one already-built row to match the genome as it now stands. */
function syncRow(parts, field, draft, holding) {
  const notes = draft.marginalia.get(field.path);
  parts.note.textContent = notes ? notes.join(" ") : "";
  parts.row.classList.toggle("has-note", Boolean(notes));
  parts.row.classList.toggle("touched", draft.edited.has(field.path));
  parts.row.classList.toggle("moved", draft.moved.includes(field.path));

  if (parts.fill) {
    const range = fieldRange(field, draft.dna);
    const at = trackFraction(field.value, range.lo, range.hi);
    const reach = trackFraction(range.ceiling, range.lo, range.hi);
    parts.value.textContent = formatValue(field.value, field);
    parts.fill.style.width = `${(at * 100).toFixed(2)}%`;
    parts.nib.style.left = `${(at * 100).toFixed(2)}%`;
    // The stretch of rule the genome cannot currently reach, hatched off. It
    // moves as its governing field moves, which is the point: the rule is not
    // disabled, it is *this creature's* rule.
    parts.beyond.style.left = `${(reach * 100).toFixed(2)}%`;
    parts.beyond.style.width = `${((1 - reach) * 100).toFixed(2)}%`;
    parts.row.classList.toggle("bounded", range.bounded);
    // Never fight a pointer that is still down — the native value is allowed
    // to run past the ceiling while the drawn nib stays where the genome
    // settled, and is corrected when the drag ends.
    if (!holding && parts.input.value !== String(field.value)) {
      parts.input.value = String(field.value);
    }
    return;
  }
  if (parts.buttons) {
    for (const [option, button] of parts.buttons) {
      const active = option === field.value;
      button.classList.toggle("active", active);
      button.setAttribute("aria-checked", String(active));
    }
    return;
  }
  if (parts.select) {
    if (!holding) parts.select.value = String(field.value);
    return;
  }
  if (parts.dot) {
    parts.dot.style.background = String(field.value);
    parts.hex.textContent = String(field.value);
    return;
  }
  if (parts.isText) {
    if (!holding && parts.input.value !== String(field.value ?? "")) {
      parts.input.value = String(field.value ?? "");
    }
    return;
  }
  parts.value.textContent = String(field.value ?? "—");
}

/**
 * Create the genome card.
 *
 * @param {object} options
 * @param {(dna: object, draft: object) => void} [options.onCommit] called,
 *   debounced, with a settled genome whenever the player changes one
 * @param {() => void} [options.onClose]
 */
/**
 * @param {object} [hooks]
 * @param {(dna: object, draft: object) => void} [hooks.onCommit]
 * @param {() => void} [hooks.onClose]
 * @param {(amount: number) => void} [hooks.onUnderdraw] how far the body should
 *   be taken apart, 0 (whole) to 1 (bare carriers). The card cannot do this
 *   itself — it is forbidden the runtime, and taking a body apart means
 *   reaching a live agent — so it only reports the dial and lets the host act.
 */
export function createGenomeCard({ onCommit, onClose, onUnderdraw } = {}) {
  const root = element("genome-card");
  if (!root) return null;
  const scrim = element("genome-card-scrim");
  const faces = element("genome-leaf-faces");
  const pageFace = element("genome-face-page");
  const writingFace = element("genome-face-writing");
  const sectionHost = element("genome-sections");
  const nameNode = element("genome-card-name");
  const writingName = element("genome-writing-name");
  const kicker = element("genome-card-kicker");
  const caption = element("genome-card-caption");
  const cardNotes = element("genome-card-notes");
  const writingHost = element("genome-writing");
  const linesCaption = element("genome-lines-caption");
  const stamps = [element("genome-stamp-page"), element("genome-stamp-writing")];
  const underdraw = element("genome-underdraw");
  const underdrawLabel = element("genome-underdraw-label");
  const underdrawFill = element("genome-underdraw-fill");
  const underdrawNib = element("genome-underdraw-nib");
  const underdrawDial = element("genome-underdraw-dial");

  let draft = null;
  let rows = new Map();
  let signature = "";
  let editable = true;
  let flipped = false;
  let open = false;
  let commitTimer = 0;
  let lastStamped = "";
  let writingStale = true;
  let stampBusy = false;
  let stampPending = false;

  /** The set of paths on screen — a change means the schema itself moved. */
  function schemaSignature(current) {
    return current.sections
      .map((section) => `${section.label}:${section.fields.map((field) => field.path).join(",")}`)
      .join("|");
  }

  function scheduleCommit() {
    if (!onCommit || !editable) return;
    window.clearTimeout(commitTimer);
    const pending = draft;
    commitTimer = window.setTimeout(() => {
      commitTimer = 0;
      if (open && pending) onCommit(pending.dna, pending);
    }, COMMIT_DELAY_MS);
  }

  function applyEdit(path, value, settle) {
    if (!editable || !draft) return;
    // A drag ends by firing `change` carrying the value `input` already
    // applied. Re-applying it would renormalize an already-canonical genome —
    // silent by design, since idempotence is what lets marginalia be trusted —
    // and the empty answer would take the repair notes and the moved marks down
    // with it, erasing the relational-bound lesson at the exact moment the
    // player stops dragging and looks up. Settling on an unchanged value is a
    // redraw, not an edit.
    //
    // A drag that ended *past* a ceiling is a different case and still an edit:
    // the native value is the overshoot, the draft holds the settled figure, so
    // they differ and the normalizer gets asked again — which is what snaps the
    // nib to truth and re-states why.
    if (settle && Object.is(readGenomePath(draft.dna, path), value)) {
      render();
      return;
    }
    draft = editGenomeDraft(draft, path, value);
    render({ holdingPath: settle ? null : path });
    scheduleCommit();
  }

  function buildSections() {
    rows = new Map();
    const host = document.createDocumentFragment();
    for (const section of draft.sections) {
      const block = makeElement("section", "genome-section");
      block.append(makeElement("h3", "genome-section-title", section.label));
      for (const field of section.fields) {
        const parts = buildRow(field, applyEdit);
        if (!editable) {
          for (const control of parts.row.querySelectorAll("input, button, select")) {
            control.disabled = true;
          }
        }
        rows.set(field.path, parts);
        block.append(parts.row);
      }
      host.append(block);
    }
    sectionHost.replaceChildren(host);
  }

  /**
   * Redraw everything that depends on the draft.
   *
   * Rows are patched rather than rebuilt so a drag survives its own effects.
   * They are only rebuilt when the schema itself changed shape — becoming a
   * flier grows a wing section, and a groundcover has no trunk to offer.
   */
  function render({ holdingPath = null } = {}) {
    const next = schemaSignature(draft);
    if (next !== signature) {
      signature = next;
      buildSections();
    }
    for (const section of draft.sections) {
      for (const field of section.fields) {
        const parts = rows.get(field.path);
        if (parts) syncRow(parts, field, draft, field.path === holdingPath);
      }
    }
    nameNode.textContent = draft.label || "unnamed";
    writingName.textContent = draft.label || "unnamed";
    cardNotes.textContent = draft.notes.join(" ");
    cardNotes.classList.toggle("visible", draft.notes.length > 0);
    // The writing face is forty-odd elements and is facing away while the
    // rules are being moved, so it is rebuilt when it is turned to rather than
    // on every pointer sample of a drag.
    writingStale = true;
    if (flipped) renderWriting();
    renderStamp();
  }

  function renderWriting() {
    writingStale = false;
    const document_ = genomeDocument(draft.dna);
    const fragment = document.createDocumentFragment();
    for (const line of document_.lines) {
      const node = makeElement("div", "genome-line");
      node.style.setProperty("--indent", String(line.indent));
      if (line.numeric) {
        // A number on this face is the same fact as a nib on the other one,
        // so it takes you there.
        const button = makeElement("button", "genome-line-link", line.text);
        button.type = "button";
        button.dataset.path = line.path;
        button.addEventListener("click", () => revealField(line.path));
        node.append(button);
      } else {
        node.textContent = line.text;
        if (line.kind !== "leaf") node.classList.add("genome-line-brace");
      }
      fragment.append(node);
    }
    writingHost.replaceChildren(fragment);
    linesCaption.textContent = `${spellNumber(document_.count)} lines`;
  }

  /**
   * The hash is a stamp, and a stamp that changed re-settles on the paper.
   *
   * The characters change on every sample of a drag — that is the proof, and
   * it should be continuous. The ink pulse is not: restarting a half-second
   * animation sixty times a second renders it as a jitter and never once as a
   * stamp coming down. So the pulse is allowed to finish, and only re-fires if
   * the genome moved again while it was running.
   */
  function pressStamp() {
    stampBusy = true;
    stampPending = false;
    for (const stamp of stamps) {
      stamp.classList.remove("settling");
      // Reading offsetWidth restarts the animation; without it a stamp that
      // has run once would never replay.
      void stamp.offsetWidth;
      stamp.classList.add("settling");
    }
  }

  function renderStamp() {
    const changed = lastStamped !== "" && draft.genomeHash !== lastStamped;
    lastStamped = draft.genomeHash;
    for (const stamp of stamps) {
      const text = stamp.querySelector(".genome-stamp-hash");
      if (text) text.textContent = draft.genomeHash;
    }
    if (!changed) return;
    if (stampBusy) stampPending = true;
    else pressStamp();
  }

  // One listener, not one per face: both stamps run the same animation, and
  // two `animationend` handlers would clear the flag twice.
  stamps[0]?.addEventListener("animationend", () => {
    stampBusy = false;
    for (const stamp of stamps) stamp.classList.remove("settling");
    if (stampPending) pressStamp();
  });

  function revealField(path) {
    setFlipped(false);
    const parts = rows.get(path);
    if (!parts) return;
    window.setTimeout(() => {
      parts.row.scrollIntoView({ block: "center", behavior: "smooth" });
      parts.row.classList.remove("revealed");
      void parts.row.offsetWidth;
      parts.row.classList.add("revealed");
      parts.input?.focus({ preventScroll: true });
    }, FLIP_MS * 0.55);
  }

  function setFlipped(next) {
    if (flipped === next) return;
    flipped = next;
    if (flipped && writingStale) renderWriting();
    faces.classList.toggle("flipped", flipped);
    // The face turned away must leave the tab order, or focus walks onto a
    // page nobody can see.
    pageFace.toggleAttribute("inert", flipped);
    writingFace.toggleAttribute("inert", !flipped);
    window.setTimeout(() => {
      const target = flipped ? element("genome-flip-to-page") : element("genome-flip-to-writing");
      if (open) target?.focus({ preventScroll: true });
    }, FLIP_MS);
  }

  function setOpen(next) {
    if (open === next) return;
    open = next;
    root.classList.toggle("open", open);
    root.setAttribute("aria-hidden", String(!open));
    root.toggleAttribute("inert", !open);
    document.body.classList.toggle("genome-card-open", open);
    if (!open) {
      window.clearTimeout(commitTimer);
      commitTimer = 0;
      // Put the body back together before letting go of it. A creature left
      // scattered because its page was closed would be a bug the player
      // could not undo without finding the same card again.
      resetUnderdraw();
      onClose?.();
    }
  }

  // ── The underdrawing dial ────────────────────────────────────────────────
  //
  // The card reports the value and nothing else. Everything it means — which
  // agent, what a carrier is, where the marks go — belongs to the host, which
  // is why this is a callback and not an import.

  /** Redraw the rule, and put the card into (or out of) looking-through. */
  function syncUnderdraw(amount) {
    const percent = `${(amount * 100).toFixed(1)}%`;
    underdrawFill.style.width = percent;
    underdrawNib.style.left = percent;
    // Derived from the value rather than from the gesture, so a keyboard arrow
    // opens the page up exactly as a drag does.
    root.classList.toggle("looking-through", amount > 0.001);
  }

  function readUnderdraw() {
    const amount = Number(underdrawDial.value);
    return Number.isFinite(amount) ? Math.min(1, Math.max(0, amount)) : 0;
  }

  /** Put the body back together and close the slip. */
  function resetUnderdraw() {
    underdrawDial.value = "0";
    syncUnderdraw(0);
    onUnderdraw?.(0);
  }

  underdrawDial.addEventListener("input", () => {
    const amount = readUnderdraw();
    syncUnderdraw(amount);
    onUnderdraw?.(amount);
  });

  element("genome-flip-to-writing").addEventListener("click", () => setFlipped(true));
  element("genome-flip-to-page").addEventListener("click", () => setFlipped(false));
  scrim.addEventListener("click", () => setOpen(false));

  // The card is modal, so no key pressed inside it should also reach the
  // field's own shortcuts — space would pause the simulation underneath while
  // pressing a button on top of it.
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setOpen(false);
      event.preventDefault();
    }
    event.stopPropagation();
  });

  return {
    root,
    get isOpen() {
      return open;
    },
    get genomeHash() {
      return draft?.genomeHash ?? null;
    },
    /** How far the body is currently taken apart, 0..1. */
    get underdrawAmount() {
      return readUnderdraw();
    },
    /**
     * Put a genome on the card.
     *
     * @param {object} dna a genome, canonical or not
     * @param {object} [meta]
     * @param {boolean} [meta.editable] false for a read-only reading
     * @param {string} [meta.kicker] the line above the name
     * @param {string} [meta.caption] the line below it
     */
    show(dna, meta = {}) {
      draft = createGenomeDraft(dna);
      editable = meta.editable !== false;
      lastStamped = "";
      signature = "";
      root.classList.toggle("read-only", !editable);
      kicker.textContent =
        meta.kicker ?? (draft.kind === "flora" ? "Specimen genome · plant" : "Specimen genome · kin");
      caption.textContent =
        meta.caption ??
        (editable
          ? "Everything this one is, written down. Move a rule and it changes where it stands."
          : "Everything this one is, written down.");
      // The slip is offered only when there is a blend shell to take apart, and
      // it names the real number of primitives — a plant has none, and an
      // invented count would be the same mistake this document made once
      // already about its own line count.
      const shapes = Number(meta.underdrawShapes);
      const hasShapes = Number.isInteger(shapes) && shapes > 0;
      underdraw.hidden = !hasShapes || !editable;
      if (hasShapes) {
        underdrawLabel.textContent = `${spellNumber(shapes)} shapes underneath`;
      }
      resetUnderdraw();
      setFlipped(false);
      render();
      setOpen(true);
      return draft;
    },
    close() {
      setOpen(false);
    },
    /** Re-read the genome from outside — used when the host rebuilt it. */
    refresh() {
      if (draft) render();
    },
  };
}
