import { z } from 'zod';

/**
 * The MFD-E project document.
 *
 * Implements docs/data-model/PROJECT_MODEL.md.
 *
 * ## Why this package exists
 *
 * Everything the product is going to do next reads this shape: saving a review,
 * generating a report, sharing a project between engineers, letting a design
 * assistant propose a layout, and eventually keeping a facility twin in step with
 * what was actually installed. They differ in what they *do* with the document and
 * agree on what the document *is*. So the definition lives in one package that the
 * editor, the report generator and the server all import, and nothing here knows
 * about React, Konva, a filesystem or a clock.
 *
 * ## The three rules the schema is built on
 *
 * 1. **Every field is present.** Unknown values are an explicit `null`, never an
 *    omitted key. Nothing here is `.optional()` — only `.nullable()`. A forgotten
 *    field and a recorded unknown must not look the same.
 * 2. **Unknown keys are rejected** (`strictObject`), so a document written by a newer
 *    version fails loudly instead of silently dropping the part this version does not
 *    understand.
 * 3. **Everything is JSON-safe.** No `Date`, no `Map`, no `undefined`. Timestamps are
 *    ISO 8601 strings. A document is a file before it is anything else.
 *
 * ## Hierarchy
 *
 * ```
 * Project
 *  └ Level                       a floor: owns its plan image and calibration
 *      ├ boundaries[]            traced geometry: room outlines, walls, obstructions
 *      ├ spaces[]                named rooms, each referring to a boundary
 *      └ placements[]            machines, each optionally assigned to a space
 * ```
 *
 * Two departures from the hierarchy as first written, both deliberate:
 *
 * **Placements hang off the Level, with a `spaceId`, rather than off the Space.**
 * An engineer places a machine and then draws the room around it at least as often as
 * the reverse, and a machine that cannot exist until its room does would block that.
 * A machine also has to remain on the drawing when its room is deleted — losing
 * equipment because a room outline was redrawn is not a recoverable mistake. So room
 * assignment is a reference that can be null, not an ownership chain.
 *
 * **Boundary is its own entity, not a field on Space.** A structural column, a duct
 * riser or a fixed partition is a real obstruction with no room-hood at all. Folding
 * boundaries into Space would mean either inventing a fake room for every column or
 * having no way to represent one.
 */

const finiteNumber = z.number().refine(Number.isFinite, 'must be a finite number');

/** A positive length in millimetres. */
const positiveMillimetres = finiteNumber.refine(
  (value) => value > 0,
  'must be greater than zero',
);

const vec2Schema = z.strictObject({
  x: finiteNumber,
  y: finiteNumber,
});

/** ISO 8601 with a timezone, e.g. `2026-07-29T09:15:00.000Z`. */
const timestampSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
    'must be an ISO 8601 timestamp',
  );

const identifierSchema = z.string().min(1);

/**
 * Current document schema version.
 *
 * Versioning exists from the first saved file, not from the first file that needed
 * it. Adding it later means either abandoning real project documents or writing the
 * migration you skipped, under pressure, against files you cannot inspect.
 */
export const DOCUMENT_VERSION = 5;

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

export const transformSchema = z.strictObject({
  position: vec2Schema,
  /** Millidegrees, so a quarter turn survives a JSON round trip exactly. */
  rotation: finiteNumber,
  mirrored: z.boolean(),
});

export const placementSchema = z.strictObject({
  id: identifierSchema,
  /**
   * Reference into the catalogue — never a copy of it. Twenty AK98 units share one
   * set of dimensions, so a manual revision updates all twenty at once. Copied
   * dimensions would drift, and drifted equipment data looks exactly like correct
   * equipment data.
   */
  equipmentObjectId: identifierSchema,
  /**
   * The catalogue version placed, so a report can state which data produced its
   * numbers even after the catalogue has moved on.
   */
  equipmentObjectVersion: z.string().min(1),
  transform: transformSchema,
  label: z.string(),
  /** The room this machine is assigned to, or null when it sits in no named room. */
  spaceId: identifierSchema.nullable(),
});

// ---------------------------------------------------------------------------
// Spatial model
// ---------------------------------------------------------------------------

export const BOUNDARY_KINDS = [
  /** The outline of a room. Equipment belongs inside it. */
  'space_outline',
  /** A wall, partition or other linear structure equipment must stay clear of. */
  'wall',
  /** A column, riser or fixed obstruction. Equipment must not overlap it. */
  'obstruction',
] as const;

export type BoundaryKind = (typeof BOUNDARY_KINDS)[number];

/**
 * What kind of obstruction this is.
 *
 * Descriptive, not behavioural. The rule engine asks only "is this a room outline or
 * something equipment must not overlap" — which is `kind`. This field exists because a
 * report that says "overlaps Column C4" is useful and one that says "overlaps
 * obstruction 3" is not, and because an engineer scanning a floor needs to tell a
 * structural column from a duct riser.
 *
 * Keeping the two apart matters: if the type drove the check, adding a type would mean
 * touching the evaluator, and an unrecognised type would silently stop being checked.
 */
export const OBSTRUCTION_TYPES = [
  /** Structural column. */
  'column',
  /** Vertical shaft — lift, stair, service riser. */
  'shaft',
  /** Duct, pipe run or bulkhead. */
  'duct',
  /** Fixed equipment or furniture that cannot be moved. */
  'fixed_equipment',
  'other',
] as const;

export type ObstructionType = (typeof OBSTRUCTION_TYPES)[number];

/**
 * A traced polygon in model space.
 *
 * At least three vertices, because fewer encloses nothing. The ring is closed
 * implicitly — the closing edge is never stored, so "is this ring closed" has one
 * answer rather than two.
 */
export const boundarySchema = z
  .strictObject({
    id: identifierSchema,
    kind: z.enum(BOUNDARY_KINDS),
    /** Closed polygon, model millimetres. */
    vertices: z.array(vec2Schema).min(3, 'a boundary needs at least three vertices'),
    label: z.string(),
    /** Set only when `kind` is `obstruction`. Null otherwise. */
    obstructionType: z.enum(OBSTRUCTION_TYPES).nullable(),
  })
  .superRefine((boundary, ctx) => {
    // Enforced both ways. An obstruction with no type produces a report row an
    // engineer cannot act on; a room outline carrying one is a record that two
    // different things were meant, with no way to tell which.
    if (boundary.kind === 'obstruction' && boundary.obstructionType === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['obstructionType'],
        message: 'kind "obstruction" requires an obstructionType',
      });
    }
    if (boundary.kind !== 'obstruction' && boundary.obstructionType !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['obstructionType'],
        message: `obstructionType belongs to kind "obstruction", not "${boundary.kind}"`,
      });
    }
  });

export const SPACE_FUNCTIONS = [
  'hemodialysis_treatment',
  'isolation_treatment',
  'water_treatment',
  'clean_utility',
  'soiled_utility',
  'staff_station',
  'storage',
  'corridor',
  'other',
] as const;

export type SpaceFunction = (typeof SPACE_FUNCTIONS)[number];

/**
 * A room.
 *
 * `function` is a controlled vocabulary rather than free text because rules select on
 * it. Free text would let "Treatment Rm" and "treatment room" become two different
 * things that no rule matches — and a rule that silently matches nothing looks
 * exactly like a rule everything passes.
 */
export const spaceSchema = z.strictObject({
  id: identifierSchema,
  name: z.string(),
  function: z.enum(SPACE_FUNCTIONS),
  /** The boundary that gives this room its shape. */
  boundaryId: identifierSchema,
});

// ---------------------------------------------------------------------------
// Reference point
// ---------------------------------------------------------------------------

/**
 * Where a service enters the level, where equipment is delivered, and where staff work from.
 *
 * Five utilities and two circulation points. The list is a controlled vocabulary for the same
 * reason `SPACE_FUNCTIONS` is: the scoring engine selects on it, and a criterion that silently
 * matches nothing looks exactly like a criterion that everything satisfies.
 */
export const REFERENCE_POINT_KINDS = [
  'ro_supply',
  'ro_return',
  'drain',
  'electrical_panel',
  'data',
  /** Where equipment is delivered onto the level. Installation feasibility measures from it. */
  'access_entry',
  /** Nurse station or staff base. Walking distance measures from it. */
  'staff_base',
] as const;

/**
 * A named point on a level that an engineering criterion measures **from**.
 *
 * New in version 4, for Sprint 6's weighted scoring engine. Four of the criteria the owner
 * approved in B-5a — installation feasibility, RO piping, electrical routing and walking distance —
 * are distances *from* one of these points, and that is **40 % of the scoring model**.
 *
 * ## Why this is in the document rather than held by the solver
 *
 * A distance from a position nobody recorded is not a measurement. These belong beside the
 * geometry they are measured against, in the file an engineer saves and a report cites, and they
 * are placed with an undoable command like every other edit.
 *
 * ## An empty array is correct, not incomplete
 *
 * The v3 → v4 migration gives every existing level `[]`, and that is the honest value: no engineer
 * has placed a point, so those criteria report **unavailable** rather than a distance from an
 * assumed origin. Guessing a panel location — the nearest wall, the room centroid — would put a
 * number in a report that came from an invention, and for a criterion that *minimises*, an assumed
 * short run is the best possible score (AD-18).
 *
 * ## Why it is not called `UtilityOrigin`
 *
 * It was, in the Sprint 6 architecture through revision 2, when every kind was a service. B-5a
 * added installation feasibility and walking distance, which measure from a goods entrance and a
 * nurse base — neither of which is a utility. Renamed before anything was built, because a name
 * describing five of its seven values is the kind of small inaccuracy that survives into a
 * migration and then cannot be fixed cheaply.
 */
export const referencePointSchema = z.strictObject({
  id: identifierSchema,
  kind: z.enum(REFERENCE_POINT_KINDS),
  /** Model millimetres, like all geometry. */
  position: vec2Schema,
  /**
   * e.g. "Panel DB-3F-2". **Nullable rather than an empty string**, so an unnamed point and one
   * an engineer deliberately named with nothing cannot look alike — the same rule every other
   * unknown in this schema follows.
   */
  label: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// Plan image and calibration
// ---------------------------------------------------------------------------

export const PLAN_SOURCE_FORMATS = ['pdf', 'png', 'jpg'] as const;

/**
 * The imported drawing, as pixels. Carries no notion of real-world size — that is
 * entirely the job of {@link coordinateMappingSchema}.
 *
 * The image is embedded as a data URL rather than referenced by path. A project file
 * an engineer emails to a colleague has to arrive with its drawing; a path into
 * someone else's filesystem is not a floor plan. External asset storage is a later
 * decision, and embedding is the one that keeps the document self-contained until
 * then.
 */
export const planImageSchema = z.strictObject({
  sourceFormat: z.enum(PLAN_SOURCE_FORMATS),
  /** Shown in the report, so a reviewer knows which drawing was assessed. */
  sourceFileName: z.string().min(1),
  /** PDF only; 0 for raster imports. */
  pageIndex: z.number().int().min(0),
  pixelWidth: z.number().int().positive(),
  pixelHeight: z.number().int().positive(),
  /** `data:image/png;base64,…` — the rendered page or the imported raster. */
  dataUrl: z.string().startsWith('data:', 'must be a data URL'),
  /**
   * Pixels per inch of the stored image, when it is known. Version 5.
   *
   * Known for a PDF, because **we** rasterised it and chose the resolution. Null for an imported
   * PNG or JPG, because a raster file carries no reliable statement of the size it was scanned at —
   * and a wrong DPI turns a printed "1:100" into a scale that is confidently wrong.
   *
   * This is what makes the printed-scale calibration route possible at all: converting a ratio into
   * millimetres per pixel needs the resolution, and inventing one would produce a mapping that
   * measures nothing. Where it is null, that route is not offered — see `recommendCalibration`.
   */
  renderDpi: positiveMillimetres.nullable(),
  importedAt: timestampSchema,
});

export const CALIBRATION_METHODS = ['two-point', 'stated-ratio'] as const;

/**
 * The evidence behind `millimetresPerPixel`, kept so a reviewer can see how the scale
 * was established rather than having to trust it.
 */
export const scaleCalibrationSchema = z.strictObject({
  method: z.enum(CALIBRATION_METHODS),
  /** The two points the engineer picked, in image pixels. Null for a stated ratio. */
  pointA: vec2Schema.nullable(),
  pointB: vec2Schema.nullable(),
  /** The real distance the engineer typed, millimetres. Null for a stated ratio. */
  knownDistance: positiveMillimetres.nullable(),
  /** e.g. "1:100", when the drawing declares its own scale. */
  statedRatio: z.string().nullable(),
  /** Resolution the stated ratio was applied at. Null for two-point. */
  dotsPerInch: finiteNumber.nullable(),
  calibratedAt: timestampSchema,
});

/**
 * The complete transform between image pixel space and model millimetre space.
 *
 * ```
 * model_mm = rotate(image_px − origin, rotation) × millimetresPerPixel
 * ```
 *
 * All three parts are required together. Scale alone is not a coordinate system:
 * without an origin there is nothing to measure *from*, and without a rotation a plan
 * scanned three degrees off square puts every clearance three degrees off. Hospital
 * floor plans do not arrive square to the page.
 *
 * The maths lives in `@mfd/cad-engine` as `PlanTransform`; this record is that
 * transform plus its provenance.
 */
export const coordinateMappingSchema = z.strictObject({
  millimetresPerPixel: positiveMillimetres,
  /** The image pixel that is model (0, 0). */
  origin: vec2Schema,
  /** Millidegrees. */
  rotation: finiteNumber,
  calibration: scaleCalibrationSchema,
  mappedAt: timestampSchema,
});

// ---------------------------------------------------------------------------
// Level and Project
// ---------------------------------------------------------------------------

export const levelSchema = z.strictObject({
  id: identifierSchema,
  name: z.string(),
  /** Height above project datum, millimetres. 0 for a single-level project. */
  elevation: finiteNumber,
  planImage: planImageSchema.nullable(),
  /**
   * **Null until calibrated**, and everything downstream is required to notice.
   * A rule evaluated against a level with no mapping returns YELLOW, never GREEN:
   * measuring screen distance and calling it a clearance is the single most damaging
   * thing this application could do, so it is blocked structurally rather than by a
   * warning somebody can dismiss.
   */
  coordinateMapping: coordinateMappingSchema.nullable(),
  boundaries: z.array(boundarySchema),
  spaces: z.array(spaceSchema),
  placements: z.array(placementSchema),
  /**
   * Named points that engineering criteria measure **from**. Sprint 6, version 4.
   *
   * **An empty array is a correct state, not an incomplete one** — see {@link referencePointSchema}.
   */
  referencePoints: z.array(referencePointSchema),
});

/**
 * How the report draws a level.
 *
 * Owner decision, after Sprint 5: the report stays **vector-first**, and the raster underlay
 * is opt-in rather than embedded by default.
 *
 * | Mode | Draws |
 * | --- | --- |
 * | `vector` | Traced geometry only. **The default.** |
 * | `vector_raster` | The scanned drawing beneath the traced geometry |
 * | `raster` | The scan alone — a debug mode, for checking a trace against the original |
 *
 * Why this is a stored project setting rather than a checkbox on the download dialogue: the
 * mode changes what the document *is* when it reaches a hospital. A report issued as
 * `vector_raster` and re-issued a month later as `vector` would differ in a way nobody chose,
 * and neither copy would record which was intended.
 *
 * `raster` is labelled debug in the report itself, because a page carrying a scan with no
 * traced geometry over it shows what was imported rather than what was assessed.
 */
export const REPORT_RENDER_MODES = ['vector', 'vector_raster', 'raster'] as const;

export const projectSettingsSchema = z.strictObject({
  reportRenderMode: z.enum(REPORT_RENDER_MODES),
});

export const customerSchema = z.strictObject({
  hospital: z.string(),
  site: z.string(),
  contact: z.string(),
});

export const ruleSetRefSchema = z.strictObject({
  id: z.string(),
  version: z.string(),
});

export const projectSchema = z.strictObject({
  id: identifierSchema,
  name: z.string(),
  customer: customerSchema,
  /** The TS engineer. Appears on the report. */
  reviewedBy: z.string(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  /**
   * Which rule set produced the verdicts.
   *
   * Not bookkeeping: a report that says "compliant" without recording which rules and
   * which manual revision produced that verdict cannot be defended six months later
   * when the manual has been revised.
   */
  ruleSetRef: ruleSetRefSchema,
  /**
   * Choices that belong to the project rather than to the session.
   *
   * Required and complete, not optional: an absent setting and a chosen default look the same
   * on disk, and a report is not a place for "whatever the application happened to do".
   * Version 3's migration fills it in for older files.
   */
  settings: projectSettingsSchema,
  levels: z.array(levelSchema).min(1, 'a project has at least one level'),
});

/**
 * The saved file.
 *
 * `documentVersion` is the outermost field so a loader can read it before trusting
 * anything else in the file.
 */
export const documentSchema = z.strictObject({
  documentVersion: z.number().int().positive(),
  project: projectSchema,
});

export type Vec2Data = z.infer<typeof vec2Schema>;
export type PlacementTransform = z.infer<typeof transformSchema>;
export type Placement = z.infer<typeof placementSchema>;
export type Boundary = z.infer<typeof boundarySchema>;
export type Space = z.infer<typeof spaceSchema>;
export type ReferencePoint = z.infer<typeof referencePointSchema>;
export type ReferencePointKind = (typeof REFERENCE_POINT_KINDS)[number];
export type PlanImage = z.infer<typeof planImageSchema>;
export type ScaleCalibration = z.infer<typeof scaleCalibrationSchema>;
export type CoordinateMapping = z.infer<typeof coordinateMappingSchema>;
export type Level = z.infer<typeof levelSchema>;
export type Customer = z.infer<typeof customerSchema>;
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;
export type ReportRenderMode = (typeof REPORT_RENDER_MODES)[number];

/** The default settings a new project gets, and what version 2 files are migrated to. */
export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = { reportRenderMode: 'vector' };
export type RuleSetRef = z.infer<typeof ruleSetRefSchema>;
export type Project = z.infer<typeof projectSchema>;
export type MfdDocument = z.infer<typeof documentSchema>;
export type CalibrationMethod = (typeof CALIBRATION_METHODS)[number];
export type PlanSourceFormat = (typeof PLAN_SOURCE_FORMATS)[number];
