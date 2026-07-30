import { z } from 'zod';

/**
 * Equipment catalogue schema.
 *
 * Implements docs/data-model/OBJECT_MODEL.md.
 *
 * Two rules shape every definition below, and both exist because bad equipment data
 * is indistinguishable from good equipment data until someone measures a room that
 * has already been built:
 *
 * 1. **Every field must be present.** Unknown values are written as an explicit
 *    `null`, never omitted. A missing key is a mistake; `null` is a statement.
 *    That is why nothing here is `.optional()` — only `.nullable()`.
 *
 * 2. **Unknown keys are rejected** (`strictObject`). A record with `dimension`
 *    instead of `designFootprint` fails loudly rather than silently losing its footprint.
 */

const finiteNumber = z.number().refine(Number.isFinite, 'must be a finite number');

/** A positive length in millimetres. */
const millimetres = finiteNumber.refine((value) => value > 0, 'must be greater than zero');

const vec2Schema = z.strictObject({
  x: finiteNumber,
  y: finiteNumber,
});

export const EQUIPMENT_CATEGORIES = [
  'dialysis_machine',
  'treatment_chair',
  'treatment_bed',
  'ro_unit',
  'water_loop_component',
  'sink',
  'storage',
  'other',
] as const;

export const DATA_STATUSES = ['draft', 'verified'] as const;

export const SOURCE_TYPES = [
  'manufacturer_manual',
  'datasheet',
  'field_measurement',
  'estimate',
] as const;

export const CONNECTION_KINDS = ['power', 'roWater', 'drain'] as const;

export const CLEARANCE_SIDES = ['front', 'rear', 'left', 'right'] as const;

/**
 * What the manufacturer says the machine measures.
 *
 * **Immutable reference data.** These are the physical dimensions of the product, and
 * nothing in the application computes with them: they are quoted in the report, checked
 * against a delivery, and used to verify that a design footprint is large enough. They
 * are never adjusted to make a layout work.
 *
 * Every field is nullable, including width and depth. A generic planning object — a
 * dialysis bed, a chair — has a design footprint and no manufacturer at all, and forcing
 * a number here would mean inventing one.
 */
export const manufacturerDimensionsSchema = z.strictObject({
  width: millimetres.nullable(),
  depth: millimetres.nullable(),
  height: millimetres.nullable(),
  /** Kilograms. Feeds floor loading questions in a later version. */
  weight: millimetres.nullable(),
});

/**
 * The area the object occupies in a plan.
 *
 * **This is what the CAD engine uses** — the canvas, placement, collision detection and,
 * when it arrives, auto-layout. Required and non-null, because an object with no
 * footprint cannot be drawn or checked against anything.
 *
 * ## Why this is not the manufacturer's width and depth
 *
 * A 585 × 620 mm machine is not planned at 585 × 620. An installed station needs room for
 * hoses, a chassis that is wider at the base than the top, a footprint that stays valid
 * when the machine is swapped for the next model, and the working space an engineer treats
 * as belonging to the machine rather than to the corridor. So the planning area is a
 * decision, made once, and it is larger.
 *
 * Conflating the two — which this catalogue did until now, with a single `dimensions` —
 * has a specific failure mode: the moment a planner rounds the footprint up to make a
 * layout work, the manufacturer's measurement is gone, and the record can no longer be
 * checked against the machine that arrives on site.
 *
 * ## Why `basis` exists
 *
 * A design footprint has no manual to cite; it is the reviewing organisation's planning
 * standard. But an unsourced number is exactly what the rest of this product refuses, and
 * a report that prints "800 × 800" with no account of where it came from invites a
 * question it cannot answer. `basis` is that account, in one sentence. Null until someone
 * writes it — and a record cannot claim `verified` while it is null.
 */
export const designFootprintSchema = z.strictObject({
  width: millimetres,
  depth: millimetres,
  /** Why this area, in a sentence an engineer can read. Null when not yet recorded. */
  basis: z.string().min(1).nullable(),
});

export const connectionSchema = z.strictObject({
  required: z.boolean(),
  /** Position on the object in local millimetres, or null when not yet known. */
  port: vec2Schema.nullable(),
  /** Voltage/phase, supply pressure, drain diameter… Shape tightens in Sprint 3. */
  specification: z.record(z.string(), z.unknown()).nullable(),
});

export const connectionsSchema = z.strictObject({
  power: connectionSchema,
  roWater: connectionSchema,
  drain: connectionSchema,
});

/**
 * Manufacturer service clearance, per side.
 *
 * Every side may be null. Clearance figures come from the installation manual, and
 * inventing one would defeat the entire point of the product.
 */
export const serviceClearanceSchema = z.strictObject({
  front: millimetres.nullable(),
  rear: millimetres.nullable(),
  left: millimetres.nullable(),
  right: millimetres.nullable(),
});

/**
 * Where the numbers came from.
 *
 * TS Edition specification section 6: every engineering value requires source
 * information. A record claiming `verified` must name its document, revision and
 * section — enforced below in {@link equipmentObjectSchema}.
 */
export const sourceSchema = z.strictObject({
  /** Manual title or document number. */
  document: z.string().min(1).nullable(),
  /** Manual revision. A clearance is true *at a revision*, not in general. */
  revision: z.string().min(1).nullable(),
  /** Where in the document the figures appear. */
  section: z.string().min(1).nullable(),
  type: z.enum(SOURCE_TYPES),
  lastUpdated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date (YYYY-MM-DD)'),
});

/**
 * How the object draws.
 *
 * Kept as data so a new machine needs no code — requirement 6 of the sprint brief:
 * the renderer reads the catalogue and nothing else.
 */
export const symbolSchema = z.strictObject({
  /** Where local (0, 0) sits on the footprint. */
  origin: z.enum(['front-left', 'centre']),
  /** Sprint 2 draws rectangles; explicit polygons widen this later. */
  outline: z.literal('rectangle'),
  /** Which local edge is the front at zero rotation. Drives clearance sides. */
  frontEdge: z.enum(['north', 'south', 'east', 'west']),
});

export const equipmentObjectSchema = z
  .strictObject({
    id: z
      .string()
      .regex(/^[a-z0-9]+(_[a-z0-9]+)*$/, 'must be lower_snake_case'),
    /**
     * Null for a generic planning object. A dialysis bed traced as a 1,000 × 2,100 mm
     * footprint is not a product and has no manufacturer; naming one would be a fiction
     * a report would then repeat.
     */
    manufacturer: z.string().min(1).nullable(),
    model: z.string().min(1),
    category: z.enum(EQUIPMENT_CATEGORIES),
    /** Catalogue record version, bumped whenever a value changes. */
    version: z.string().regex(/^\d+\.\d+\.\d+$/, 'must be semver (e.g. 0.1.0)'),
    dataStatus: z.enum(DATA_STATUSES),
    manufacturerDimensions: manufacturerDimensionsSchema,
    designFootprint: designFootprintSchema,
    connections: connectionsSchema,
    serviceClearance: serviceClearanceSchema,
    source: sourceSchema,
    symbol: symbolSchema,
  })
  .superRefine((object, ctx) => {
    if (object.dataStatus !== 'verified') return;

    // A record may only claim "verified" if it can say where its numbers came from.
    // Without this, "verified" degrades into a field someone set optimistically.
    for (const field of ['document', 'revision', 'section'] as const) {
      if (object.source[field] === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['source', field],
          message: `dataStatus "verified" requires source.${field}; use dataStatus "draft" until the manual reference is known`,
        });
      }
    }

    // The design footprint is what every geometric check actually uses, so a record
    // whose manufacturer figures are sourced but whose footprint is not would let an
    // unaccounted-for number produce GREEN. That is the hole the manufacturer/design
    // split opens, and this is what closes it (AD-6a).
    if (object.designFootprint.basis === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['designFootprint', 'basis'],
        message:
          'dataStatus "verified" requires designFootprint.basis; the footprint is what every clearance and collision check measures, so it needs an account of where it came from',
      });
    }
  });

export type Vec2Data = z.infer<typeof vec2Schema>;
export type ManufacturerDimensions = z.infer<typeof manufacturerDimensionsSchema>;
export type DesignFootprint = z.infer<typeof designFootprintSchema>;
export type Connection = z.infer<typeof connectionSchema>;
export type Connections = z.infer<typeof connectionsSchema>;
export type ServiceClearance = z.infer<typeof serviceClearanceSchema>;
export type EquipmentSource = z.infer<typeof sourceSchema>;
export type EquipmentSymbol = z.infer<typeof symbolSchema>;
export type EquipmentObject = z.infer<typeof equipmentObjectSchema>;

export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number];
export type DataStatus = (typeof DATA_STATUSES)[number];
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];
export type ClearanceSide = (typeof CLEARANCE_SIDES)[number];

/** True when any figure in this record is still a placeholder. */
export function isDraft(object: EquipmentObject): boolean {
  return object.dataStatus === 'draft';
}
