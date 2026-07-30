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
 * Where a group of figures came from.
 *
 * TS Edition specification section 6: every engineering value requires source
 * information. A group claiming `verified` must name its document, revision and section —
 * enforced in {@link fieldVerificationSchema}.
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
 * Verification of **one group of fields**, not of the whole record.
 *
 * ## Why per group
 *
 * A manual arrives in pieces. The dimensions come off a datasheet months before anyone
 * pins down the service clearances, and the electrical specification may be settled
 * before either. A single record-level status forces the whole object down to the level
 * of its weakest field, which means a dimension somebody carefully sourced gets reported
 * as provisional because a clearance is still unknown.
 *
 * That is not caution, it is noise: it tells an engineer nothing about *which* figure to
 * chase, and it makes the report say "provisional" about numbers that are not.
 *
 * So each group carries its own status and its own citation, and **a verified group is
 * never downgraded because another group is unknown**. A finding is provisional only when
 * a group it actually used is.
 *
 * ## What is not verified this way
 *
 * `designFootprint`. It is an owner-defined planning property with no manufacturer
 * citation — see {@link designFootprintSchema}.
 */
export const fieldVerificationSchema = z
  .strictObject({
    status: z.enum(DATA_STATUSES),
    source: sourceSchema,
  })
  .superRefine((verification, ctx) => {
    if (verification.status !== 'verified') return;

    // A group may only claim "verified" if it can say where its numbers came from.
    // Without this, "verified" degrades into a field someone set optimistically.
    for (const field of ['document', 'revision', 'section'] as const) {
      if (verification.source[field] === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['source', field],
          message: `status "verified" requires source.${field}; use "draft" until the manual reference is known`,
        });
      }
    }
  });

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
  verification: fieldVerificationSchema,
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
 * ## It carries no verification, by design
 *
 * Owner decision: the design footprint is an **owner-defined planning property with no
 * manufacturer citation**. There is no manual to cite, because the owner is the authority
 * — the same way a hospital's own stricter standard is authoritative without being a
 * manufacturer document.
 *
 * So it has no `verification` block, and it never makes a finding provisional. `basis` is
 * a plain-language account of the decision, for the report; it is not a citation and
 * nothing is gated on it. An earlier version required it before a record could be
 * `verified`, which was over-cautious in exactly the way this decision corrects: it
 * treated an owner decision as unsourced data.
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
  /** Voltage/phase, supply pressure, drain diameter… Deliberately loose; see below. */
  specification: z.record(z.string(), z.unknown()).nullable(),
  /** Each service is verified separately — power is often settled before drain. */
  verification: fieldVerificationSchema,
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
 *
 * Verified as one group rather than per side: a manual states its clearances together, in
 * one section, and a record claiming the front is sourced while the rear is not would be
 * describing a document that does not exist.
 */
export const serviceClearanceSchema = z.strictObject({
  front: millimetres.nullable(),
  rear: millimetres.nullable(),
  left: millimetres.nullable(),
  right: millimetres.nullable(),
  verification: fieldVerificationSchema,
});

/**
 * Environmental requirements — operating temperature, humidity, heat output, noise.
 *
 * `specification` is a loose record for the same reason `connectionSchema`'s is: the real
 * figures have not arrived, and inventing a rigid shape before seeing them would mean
 * rewriting it. It tightens once a datasheet exists.
 *
 * Present as its own group because the owner's decision names it as one, and because a
 * datasheet's environmental page is typically citable well before the installation
 * clearances are.
 */
export const environmentalSchema = z.strictObject({
  specification: z.record(z.string(), z.unknown()).nullable(),
  verification: fieldVerificationSchema,
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
    manufacturerDimensions: manufacturerDimensionsSchema,
    designFootprint: designFootprintSchema,
    connections: connectionsSchema,
    serviceClearance: serviceClearanceSchema,
    environmental: environmentalSchema,
    symbol: symbolSchema,
  })
  ;

export type ManufacturerDimensions = z.infer<typeof manufacturerDimensionsSchema>;
export type DesignFootprint = z.infer<typeof designFootprintSchema>;
export type FieldVerification = z.infer<typeof fieldVerificationSchema>;
export type Environmental = z.infer<typeof environmentalSchema>;
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

/**
 * The field groups that carry their own verification.
 *
 * `designFootprint` is deliberately absent: it is an owner-defined planning property with
 * no manufacturer citation, and it never makes a finding provisional.
 */
export const VERIFIED_FIELD_GROUPS = [
  'manufacturerDimensions',
  'serviceClearance',
  'power',
  'roWater',
  'drain',
  'environmental',
] as const;

export type VerifiedFieldGroup = (typeof VERIFIED_FIELD_GROUPS)[number];

/** Human wording for a group, for the report and the palette. */
export const FIELD_GROUP_LABELS: Readonly<Record<VerifiedFieldGroup, string>> = {
  manufacturerDimensions: 'Manufacturer dimensions',
  serviceClearance: 'Service clearance',
  power: 'Electrical specification',
  roWater: 'RO water specification',
  drain: 'Drain specification',
  environmental: 'Environmental specification',
};

/** The verification block for one group. */
export function fieldVerification(
  object: EquipmentObject,
  group: VerifiedFieldGroup,
): FieldVerification {
  switch (group) {
    case 'manufacturerDimensions':
      return object.manufacturerDimensions.verification;
    case 'serviceClearance':
      return object.serviceClearance.verification;
    case 'power':
      return object.connections.power.verification;
    case 'roWater':
      return object.connections.roWater.verification;
    case 'drain':
      return object.connections.drain.verification;
    case 'environmental':
      return object.environmental.verification;
  }
}

export function fieldStatus(object: EquipmentObject, group: VerifiedFieldGroup): DataStatus {
  return fieldVerification(object, group).status;
}

export function groupsWithStatus(
  object: EquipmentObject,
  status: DataStatus,
): VerifiedFieldGroup[] {
  return VERIFIED_FIELD_GROUPS.filter((group) => fieldStatus(object, group) === status);
}

/**
 * True when **any** group is still a placeholder.
 *
 * For marking a record in the interface, not for deciding a verdict. A verdict looks at
 * the groups it actually used — that is the whole point of per-group verification, and
 * reaching for this in an evaluator would put the record-level behaviour back.
 */
export function hasDraftFields(object: EquipmentObject): boolean {
  return VERIFIED_FIELD_GROUPS.some((group) => fieldStatus(object, group) === 'draft');
}

/** True when every group is sourced. */
export function isFullyVerified(object: EquipmentObject): boolean {
  return !hasDraftFields(object);
}
