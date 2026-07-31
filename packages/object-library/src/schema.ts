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
 *    instead of `planningFootprint` fails loudly rather than silently losing its footprint.
 */

const finiteNumber = z.number().refine(Number.isFinite, 'must be a finite number');

/** A positive length in millimetres. */
const millimetres = finiteNumber.refine((value) => value > 0, 'must be greater than zero');

/** A positive mass in kilograms. Separate from {@link millimetres} so the unit is not a comment. */
const kilograms = finiteNumber.refine((value) => value > 0, 'must be greater than zero');

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

/**
 * How well sourced a group of figures is.
 *
 * | Status | Meaning |
 * | --- | --- |
 * | `draft` | No citation. Provisional; a finding that used it says so. |
 * | `datasheet_verified` | Cited to the manufacturer's **datasheet**. |
 * | `verified` | Cited to the authoritative document for that group. |
 *
 * ## The two sourced statuses are equally firm
 *
 * `datasheet_verified` is **not** a weaker `verified`. Both require a document, a revision and a
 * section, and neither makes a finding provisional. The distinction is *provenance, not
 * confidence*: it records that a figure came off the datasheet rather than off the authoritative
 * document for its group, which for an installation requirement is a TS installation standard and
 * not any manufacturer publication at all.
 *
 * > Owner decision, AK98 source clarification: the AK98 datasheet supplies dimensions, weight,
 * > electrical requirements, water consumption and operating conditions — *"Status:
 * > datasheet_verified"*.
 *
 * A group may only claim `datasheet_verified` when its source type is `datasheet`
 * ({@link verificationSchemaFor}), which is why no installation group can ever hold this status:
 * {@link INSTALLATION_SOURCE_TYPES} does not contain `datasheet`.
 */
export const DATA_STATUSES = ['draft', 'datasheet_verified', 'verified'] as const;

/**
 * Where a **specification** figure may come from.
 *
 * A specification is what the equipment *is*: how big it is, what it weighs, what supply it needs,
 * what conditions it runs in. The manufacturer is the authority on all of it.
 */
export const SPECIFICATION_SOURCE_TYPES = [
  'manufacturer_manual',
  'datasheet',
  'field_measurement',
  'estimate',
] as const;

/**
 * Where an **installation requirement** may come from — and this list is the decision.
 *
 * > Owner decision, AK98 source clarification: *"Do not populate: service clearance, maintenance
 * > access, RO port location, drain location, installation routing — from the equipment manual.
 * > Those values must come from: TS installation standards, hospital design standards,
 * > installation drawings, field validated data."*
 *
 * ## Neither `manufacturer_manual` nor `datasheet` appears here, and that is the enforcement
 *
 * A service clearance citing the AK98 manual is not a policy violation somebody has to notice in
 * review — it is a **schema error**, because `serviceClearance.verification.source.type` is typed
 * against this enum and `"manufacturer_manual"` is not one of its members. The prohibition is
 * mechanical rather than documentary, which is the only kind that survives a deadline.
 *
 * `estimate` is on both lists. It is the honest label for a figure nobody has sourced yet, and it
 * can never be mistaken for a citation: `verificationSchemaFor` refuses any sourced status without
 * a document, revision and section, so an `estimate` is always `draft`.
 */
export const INSTALLATION_SOURCE_TYPES = [
  'ts_installation_standard',
  'hospital_design_standard',
  'installation_drawing',
  'field_validated',
  'estimate',
] as const;

export const CONNECTION_KINDS = ['power', 'roWater', 'drain'] as const;

export const CLEARANCE_SIDES = ['front', 'rear', 'left', 'right'] as const;

/**
 * Which side of the product a group of figures describes.
 *
 * > Owner decision, AK98 source clarification: *"Update the data model so equipment specification
 * > and installation requirements are independent sources."*
 *
 * Independence is expressed as two disjoint source vocabularies rather than two nested objects.
 * The value of the decision is that *neither side can cite the other's documents*, and that is a
 * property of the source enum, not of where a key sits in a tree.
 */
export const FIELD_GROUP_ORIGINS = ['specification', 'installation'] as const;

const sourceFields = {
  /** Manual title or document number. */
  document: z.string().min(1).nullable(),
  /** Manual revision. A clearance is true *at a revision*, not in general. */
  revision: z.string().min(1).nullable(),
  /** Where in the document the figures appear. */
  section: z.string().min(1).nullable(),
  lastUpdated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date (YYYY-MM-DD)'),
};

/**
 * Where a group of specification figures came from.
 *
 * TS Edition specification section 6: every engineering value requires source information. A group
 * claiming a sourced status must name its document, revision and section — enforced in
 * {@link verificationSchemaFor}.
 */
export const specificationSourceSchema = z.strictObject({
  ...sourceFields,
  type: z.enum(SPECIFICATION_SOURCE_TYPES),
});

/** Where a group of installation requirements came from. Never a manufacturer publication. */
export const installationSourceSchema = z.strictObject({
  ...sourceFields,
  type: z.enum(INSTALLATION_SOURCE_TYPES),
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
 * `planningFootprint`. It is an owner-defined planning property with no manufacturer
 * citation — see {@link planningFootprintSchema}.
 */
interface VerificationShape {
  readonly status: DataStatus;
  readonly source: {
    readonly document: string | null;
    readonly revision: string | null;
    readonly section: string | null;
    readonly type: string;
  };
}

/**
 * The citation rules, shared by both sides.
 *
 * Written against a structural minimum rather than as a generic over the two source schemas, so
 * that `source.type` stays a readable string here while remaining a closed enum in each schema.
 */
function refineVerification(verification: VerificationShape, ctx: z.RefinementCtx): void {
  if (verification.status === 'draft') return;

  // A group may only claim a sourced status if it can say where its numbers came from.
  // Without this, "verified" degrades into a field someone set optimistically.
  for (const field of ['document', 'revision', 'section'] as const) {
    if (verification.source[field] === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['source', field],
        message: `status "${verification.status}" requires source.${field}; use "draft" until the reference is known`,
      });
    }
  }

  /*
   * `datasheet_verified` names the document class it came from, so the source has to agree.
   * Without this the status would be a free-text claim: a clearance sourced to a TS standard could
   * call itself datasheet_verified and the report would print a provenance that never happened. It
   * is also what makes the status unreachable for installation groups, whose source vocabulary has
   * no `datasheet` member at all.
   */
  if (verification.status === 'datasheet_verified' && verification.source.type !== 'datasheet') {
    ctx.addIssue({
      code: 'custom',
      path: ['source', 'type'],
      message: `status "datasheet_verified" requires source.type "datasheet", not "${verification.source.type}"`,
    });
  }
}

export const specificationVerificationSchema = z
  .strictObject({ status: z.enum(DATA_STATUSES), source: specificationSourceSchema })
  .superRefine(refineVerification);

export const installationVerificationSchema = z
  .strictObject({ status: z.enum(DATA_STATUSES), source: installationSourceSchema })
  .superRefine(refineVerification);

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
  weight: kilograms.nullable(),
  verification: specificationVerificationSchema,
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
 *
 * ## Named `planningFootprint`, not `designFootprint`
 *
 * > Owner decision, AK98 source clarification: *"Planning footprint는 설치 검토용이며 manufacturer
 * > dimension을 대체하지 않는다"* — the planning footprint is for installation review and does not
 * > replace the manufacturer dimension.
 *
 * The rename is the owner's word, and it earns its churn: `design` invited the reading that this
 * *is* the machine's design size, which is the exact confusion the split exists to prevent.
 */
export const planningFootprintSchema = z.strictObject({
  width: millimetres,
  depth: millimetres,
  /** Why this area, in a sentence an engineer can read. Null when not yet recorded. */
  basis: z.string().min(1).nullable(),
});

/**
 * What supply one service needs — **not** where it connects.
 *
 * The port *location* used to live here, and it has moved to {@link portLocationsSchema} on the
 * installation side. That split is the owner's: a machine's electrical requirement is a fact the
 * manufacturer states, and where the RO tail and drain actually land is a fact about the
 * installation, established from a TS standard or a validated drawing.
 */
export const connectionSchema = z.strictObject({
  required: z.boolean(),
  /** Voltage/phase, supply pressure, drain diameter, water consumption… Deliberately loose. */
  specification: z.record(z.string(), z.unknown()).nullable(),
  /** Each service is verified separately — power is often settled before drain. */
  verification: specificationVerificationSchema,
});

export const connectionsSchema = z.strictObject({
  power: connectionSchema,
  roWater: connectionSchema,
  drain: connectionSchema,
});

/**
 * Service clearance, per side — **an installation requirement, not equipment data.**
 *
 * > Owner decision, AK98 source clarification: *"Do not populate service clearance … from the
 * > equipment manual."*
 *
 * Every side may be null, and inventing one would defeat the entire point of the product. What has
 * changed is *where a figure is allowed to come from*: `installationVerificationSchema` restricts
 * the citation to a TS installation standard, a hospital design standard, an installation drawing
 * or field-validated data. The AK98 manual is not an available answer.
 *
 * Verified as one group rather than per side: a standard states its clearances together, in one
 * section, and a record claiming the front is sourced while the rear is not would be describing a
 * document that does not exist.
 */
export const serviceClearanceSchema = z.strictObject({
  front: millimetres.nullable(),
  rear: millimetres.nullable(),
  left: millimetres.nullable(),
  right: millimetres.nullable(),
  verification: installationVerificationSchema,
});

/**
 * Room a service engineer needs to withdraw a module, per side.
 *
 * Distinct from {@link serviceClearanceSchema}, which is the standing gap around an operating
 * machine. Maintenance access is transient — the space needed once, with the machine open — and
 * a layout can legitimately borrow a corridor for it where it may not borrow one for a clearance.
 * Folding the two together would mean either over-spacing every station or losing the maintenance
 * figure entirely.
 *
 * All null today. Named by the owner as installation data, so it exists as a group with nothing in
 * it rather than as a field nobody has thought about: an empty group states that the figures are
 * outstanding, which is the A-1 blocker made visible in the catalogue.
 */
export const maintenanceAccessSchema = z.strictObject({
  front: millimetres.nullable(),
  rear: millimetres.nullable(),
  left: millimetres.nullable(),
  right: millimetres.nullable(),
  verification: installationVerificationSchema,
});

/**
 * Where each service physically lands on the machine, in local millimetres.
 *
 * Moved off `connections[].port` by the owner's decision — *"Do not populate … RO port location,
 * drain location … from the equipment manual"*. A port location determines pipe runs and therefore
 * the routing lengths the planner reports, so sourcing it from a manual that describes a different
 * installation would put an invented number into a bill of materials.
 */
export const portLocationsSchema = z.strictObject({
  power: vec2Schema.nullable(),
  roWater: vec2Schema.nullable(),
  drain: vec2Schema.nullable(),
  verification: installationVerificationSchema,
});

/**
 * How services are run to the machine — overhead, in-floor, wall-chase, and what that implies.
 *
 * `specification` is a loose record for the same reason the connection specification is: the real
 * figures have not arrived, and inventing a rigid shape before seeing a TS standard would mean
 * rewriting it.
 */
export const installationRoutingSchema = z.strictObject({
  specification: z.record(z.string(), z.unknown()).nullable(),
  verification: installationVerificationSchema,
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
  verification: specificationVerificationSchema,
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
    planningFootprint: planningFootprintSchema,
    connections: connectionsSchema,
    environmental: environmentalSchema,
    serviceClearance: serviceClearanceSchema,
    maintenanceAccess: maintenanceAccessSchema,
    portLocations: portLocationsSchema,
    installationRouting: installationRoutingSchema,
    symbol: symbolSchema,
  })
  ;

export type ManufacturerDimensions = z.infer<typeof manufacturerDimensionsSchema>;
export type PlanningFootprint = z.infer<typeof planningFootprintSchema>;
export type SpecificationVerification = z.infer<typeof specificationVerificationSchema>;
export type InstallationVerification = z.infer<typeof installationVerificationSchema>;
/** Either side's verification block. Both carry `{status, source}`; the source vocabularies differ. */
export type FieldVerification = SpecificationVerification | InstallationVerification;
export type Environmental = z.infer<typeof environmentalSchema>;
export type Connection = z.infer<typeof connectionSchema>;
export type Connections = z.infer<typeof connectionsSchema>;
export type ServiceClearance = z.infer<typeof serviceClearanceSchema>;
export type MaintenanceAccess = z.infer<typeof maintenanceAccessSchema>;
export type PortLocations = z.infer<typeof portLocationsSchema>;
export type InstallationRouting = z.infer<typeof installationRoutingSchema>;
export type SpecificationSource = z.infer<typeof specificationSourceSchema>;
export type InstallationSource = z.infer<typeof installationSourceSchema>;
export type EquipmentSource = SpecificationSource | InstallationSource;
export type EquipmentSymbol = z.infer<typeof symbolSchema>;
export type EquipmentObject = z.infer<typeof equipmentObjectSchema>;

export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number];
export type DataStatus = (typeof DATA_STATUSES)[number];
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];
export type ClearanceSide = (typeof CLEARANCE_SIDES)[number];
export type FieldGroupOrigin = (typeof FIELD_GROUP_ORIGINS)[number];

/** Groups describing what the equipment *is*. Sourced from the manufacturer. */
export const SPECIFICATION_FIELD_GROUPS = [
  'manufacturerDimensions',
  'power',
  'roWater',
  'drain',
  'environmental',
] as const;

/**
 * Groups describing what *installing* it requires. Never sourced from the manufacturer.
 *
 * These four are the owner's list verbatim — service clearance, maintenance access, port locations
 * (RO and drain), installation routing — and together they are the new A-1: not a missing manual,
 * but missing installation planning standards and validated installation data.
 */
export const INSTALLATION_FIELD_GROUPS = [
  'serviceClearance',
  'maintenanceAccess',
  'portLocations',
  'installationRouting',
] as const;

/**
 * The field groups that carry their own verification.
 *
 * `planningFootprint` is deliberately absent: it is an owner-defined planning property with
 * no manufacturer citation, and it never makes a finding provisional.
 */
export const VERIFIED_FIELD_GROUPS = [
  ...SPECIFICATION_FIELD_GROUPS,
  ...INSTALLATION_FIELD_GROUPS,
] as const;

export type SpecificationFieldGroup = (typeof SPECIFICATION_FIELD_GROUPS)[number];
export type InstallationFieldGroup = (typeof INSTALLATION_FIELD_GROUPS)[number];
export type VerifiedFieldGroup = (typeof VERIFIED_FIELD_GROUPS)[number];

/**
 * Which side each group belongs to.
 *
 * Exhaustive by type: adding a group to either list without adding it here is a compile error, so
 * a new field cannot quietly arrive with no declared origin.
 */
export const FIELD_GROUP_ORIGIN: Readonly<Record<VerifiedFieldGroup, FieldGroupOrigin>> = {
  manufacturerDimensions: 'specification',
  power: 'specification',
  roWater: 'specification',
  drain: 'specification',
  environmental: 'specification',
  serviceClearance: 'installation',
  maintenanceAccess: 'installation',
  portLocations: 'installation',
  installationRouting: 'installation',
};

/** Human wording for a group, for the report and the palette. */
export const FIELD_GROUP_LABELS: Readonly<Record<VerifiedFieldGroup, string>> = {
  manufacturerDimensions: 'Manufacturer dimensions',
  power: 'Electrical specification',
  roWater: 'RO water specification',
  drain: 'Drain specification',
  environmental: 'Environmental specification',
  serviceClearance: 'Service clearance',
  maintenanceAccess: 'Maintenance access',
  portLocations: 'Service port locations',
  installationRouting: 'Installation routing',
};

/** The verification block for one group. */
export function fieldVerification(
  object: EquipmentObject,
  group: VerifiedFieldGroup,
): FieldVerification {
  switch (group) {
    case 'manufacturerDimensions':
      return object.manufacturerDimensions.verification;
    case 'power':
      return object.connections.power.verification;
    case 'roWater':
      return object.connections.roWater.verification;
    case 'drain':
      return object.connections.drain.verification;
    case 'environmental':
      return object.environmental.verification;
    case 'serviceClearance':
      return object.serviceClearance.verification;
    case 'maintenanceAccess':
      return object.maintenanceAccess.verification;
    case 'portLocations':
      return object.portLocations.verification;
    case 'installationRouting':
      return object.installationRouting.verification;
  }
}

export function fieldStatus(object: EquipmentObject, group: VerifiedFieldGroup): DataStatus {
  return fieldVerification(object, group).status;
}

/**
 * Whether a status carries a citation.
 *
 * The predicate every consumer should ask, in place of `status === 'verified'`. `draft` is the only
 * unsourced status; `datasheet_verified` and `verified` both name a document, a revision and a
 * section, and neither makes a finding provisional.
 *
 * Written as a helper rather than left inline because `=== 'verified'` was correct when there were
 * two statuses and became a silent bug the moment there were three: a datasheet-sourced dimension
 * would have been reported as provisional, which is exactly the noise per-group verification exists
 * to remove.
 */
export function isSourced(status: DataStatus): boolean {
  return status !== 'draft';
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
