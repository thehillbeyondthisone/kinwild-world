/**
 * One genome, described as controls.
 *
 * A genome is a short JSON document whose every numeric field already has a
 * declared range — `ARCHETYPE_SHAPE_LIMITS` for a plant's silhouette,
 * `WALKER_CLAMPS` for a creature's body. This module turns those tables into
 * a description of what an editor should draw, so the editor is generated
 * from the schema rather than written against it. Add a field to either
 * schema and it becomes editable, and heritable, with no UI change.
 *
 * That is also the lesson the tutorial is built to teach: the controls are
 * procedural for the same reason the creature is.
 *
 * Deliberately free of DOM and three.js — this is data about data, and it is
 * consumed by the editor, by the mutation operator, and by tests.
 */

import {
  ARCHETYPE_SHAPE_DEFAULTS,
  ARCHETYPE_SHAPE_LIMITS,
} from "../generated-flora/archetypes.js";
import {
  FLORA_ARCHETYPES,
  FLORA_ROLES,
  MOTION_LIMITS,
  PALETTE_ROLES,
  VARIATION_LIMITS,
} from "../generated-flora/dna.js";
import {
  LEG_COUNTS,
  LOCOMOTIONS,
  WALKER_CLAMPS,
  WALKER_HEAD_OFFSET_CLAMPS,
  WALKER_RELATIONS,
  WALKER_WING_CLAMPS,
} from "../generated-fauna/dna.js";

/** Read a dotted path; numeric segments index arrays. */
export function readGenomePath(target, path) {
  return path.split(".").reduce((cursor, key) => cursor?.[key], target);
}

/** "stemRadius" -> "stem radius", "eyeRadius" -> "eye radius". */
function humanize(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
}

/**
 * A slider step fine enough to reach the interesting values without letting
 * a drag land on noise. Integers step by one; everything else gets a
 * hundredth of its own range, rounded to something a person would type.
 */
function stepFor(lo, hi, integer) {
  if (integer) return 1;
  const span = hi - lo;
  if (span <= 0) return 0.01;
  const raw = span / 100;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const nice = normalized < 1.5 ? 1 : normalized < 3.5 ? 2 : normalized < 7.5 ? 5 : 10;
  return Number((nice * magnitude).toPrecision(2));
}

function numericField(path, label, value, limit, boundBy) {
  const [lo, hi, integer = false] = limit;
  return {
    path,
    label,
    value,
    control: integer ? "stepper" : "slider",
    lo,
    hi,
    step: stepFor(lo, hi, integer),
    integer,
    ...(boundBy ? { boundBy } : {}),
  };
}

/** Every numeric field in one block, from that block's limits table. */
function numericSection(dna, blockPath, label, limits, relationsByField) {
  const block = readGenomePath(dna, blockPath) ?? {};
  const fields = [];
  for (const key of Object.keys(limits)) {
    const path = `${blockPath}.${key}`;
    fields.push(
      numericField(path, humanize(key), block[key], limits[key], relationsByField?.get(path)),
    );
  }
  return { path: blockPath, label, fields };
}

function choiceField(path, label, value, options) {
  return { path, label, value, control: "choice", options: [...options] };
}

function textField(path, label, value) {
  return { path, label, value, control: "text" };
}

/**
 * Relational ceilings, keyed by the field they bound.
 *
 * A control that knows only its own `[lo, hi]` will happily offer a leg
 * thicker than it is long and let the normalizer take it back afterwards.
 * Carrying the relation lets the editor shade the part of the track that is
 * currently unreachable, which teaches the rule instead of just enforcing it.
 */
const WALKER_RELATIONS_BY_FIELD = new Map(
  WALKER_RELATIONS.map((relation) => [
    relation.field,
    { path: relation.boundedBy, factor: relation.factor, note: relation.note },
  ]),
);

function describeFauna(dna) {
  const flier = dna.locomotion === "flier";
  const sections = [
    {
      path: "",
      label: "identity",
      fields: [
        textField("name", "name", dna.name),
        textField("speciesId", "species id", dna.speciesId),
        choiceField("locomotion", "locomotion", dna.locomotion, LOCOMOTIONS),
      ],
    },
    {
      path: "palette",
      label: "palette",
      fields: Object.keys(dna.palette ?? {}).map((slot) => ({
        path: `palette.${slot}`,
        label: humanize(slot),
        value: dna.palette[slot],
        control: "swatch",
      })),
    },
    numericSection(dna, "body", "body", WALKER_CLAMPS.body, WALKER_RELATIONS_BY_FIELD),
  ];

  // The head carries a vec3 among its scalars, so it is assembled rather
  // than taken wholesale from the clamp table.
  const headFields = [
    numericField(
      "head.radius",
      "radius",
      dna.head?.radius,
      WALKER_CLAMPS.head.radius,
      WALKER_RELATIONS_BY_FIELD.get("head.radius"),
    ),
  ];
  ["x", "y", "z"].forEach((axis, index) => {
    headFields.push(
      numericField(
        `head.offset.${index}`,
        `offset ${axis}`,
        dna.head?.offset?.[index],
        WALKER_HEAD_OFFSET_CLAMPS[index],
      ),
    );
  });
  headFields.push(
    numericField(
      "head.eyeRadius",
      "eye radius",
      dna.head?.eyeRadius,
      WALKER_CLAMPS.head.eyeRadius,
      WALKER_RELATIONS_BY_FIELD.get("head.eyeRadius"),
    ),
  );
  sections.push({ path: "head", label: "head", fields: headFields });

  const legs = numericSection(
    dna,
    "legs",
    "legs",
    WALKER_CLAMPS.legs,
    WALKER_RELATIONS_BY_FIELD,
  );
  // Leg count is not a range: it is the three body plans the gait engine
  // knows, and the renderer budget decides which of them a flier may have.
  legs.fields.unshift(
    choiceField("legs.count", "count", dna.legs?.count, flier ? [2, 4] : LEG_COUNTS),
  );
  sections.push(legs);

  sections.push(
    numericSection(dna, "motion", "motion", WALKER_CLAMPS.motion, WALKER_RELATIONS_BY_FIELD),
  );
  if (flier) {
    sections.push(
      numericSection(dna, "wings", "wings", WALKER_WING_CLAMPS, WALKER_RELATIONS_BY_FIELD),
    );
  }
  return sections;
}

function describeFlora(dna) {
  const archetype = dna.archetype;
  return [
    {
      path: "",
      label: "identity",
      fields: [
        textField("name", "name", dna.name),
        // Changing the archetype rekeys the whole shape block: a groundcover
        // has no trunk fields to offer, so it cannot be asked for them.
        choiceField("archetype", "archetype", archetype, FLORA_ARCHETYPES),
        choiceField("role", "role", dna.role, FLORA_ROLES),
      ],
    },
    {
      path: "paletteRoles",
      label: "palette roles",
      fields: Object.keys(dna.paletteRoles ?? {}).map((slot) =>
        choiceField(
          `paletteRoles.${slot}`,
          humanize(slot),
          dna.paletteRoles[slot],
          PALETTE_ROLES,
        ),
      ),
    },
    numericSection(dna, "shape", "shape", ARCHETYPE_SHAPE_LIMITS[archetype] ?? {}),
    numericSection(dna, "motion", "motion", MOTION_LIMITS),
    numericSection(dna, "variation", "variation", VARIATION_LIMITS),
  ];
}

/** Which schema a normalized genome belongs to. */
export function genomeKind(dna) {
  if (!dna || typeof dna !== "object") return null;
  if (typeof dna.locomotion === "string") return "fauna";
  if (typeof dna.archetype === "string") return "flora";
  return null;
}

/**
 * Describe a normalized genome as sections of controls.
 *
 * @param {object} dna a genome that has already been through its normalizer
 * @returns {{kind: string, label: string, sections: Array}}
 */
export function describeGenome(dna) {
  const kind = genomeKind(dna);
  if (!kind) throw new TypeError("describeGenome: not a recognised genome");
  return {
    kind,
    label: dna.name ?? "",
    sections: kind === "fauna" ? describeFauna(dna) : describeFlora(dna),
  };
}

/**
 * Every numeric field of a genome, flattened.
 *
 * The mutation operator walks this so that it and the editor can never
 * disagree about what is editable — one schema, two consumers.
 */
export function numericFields(dna) {
  const fields = [];
  for (const section of describeGenome(dna).sections) {
    for (const field of section.fields) {
      if (field.control === "slider" || field.control === "stepper") fields.push(field);
    }
  }
  return fields;
}
