import { z } from 'zod';

import { observationSourceSchema, supportSchema } from './provenance';

/**
 * The nine kinds of knowledge, as observations and as aggregates.
 *
 * > Owner decision: *"Generate normalized JSON knowledge files for: room types, equipment
 * > placements, station layouts, circulation paths, RO room patterns, drain routing, electrical
 * > routing, common dimensions, repeated geometric patterns."*
 *
 * ## Two shapes per kind, and the difference matters
 *
 * An **observation** is one reading from one drawing: *"sheet A-201 of the Ilsan unit spaces its
 * stations at 1,850 mm, read off a printed dimension."* It is a fact about a drawing.
 *
 * A **derived entry** is what many observations amount to: *"station pitch across 14 drawings runs
 * 1,700–2,100 mm, median 1,850."* It is a fact about practice.
 *
 * Keeping them apart is what makes the base auditable. Observations are written by engineers and
 * only ever appended; derived entries are computed from them by {@link aggregate}, so a derived
 * file can be deleted and rebuilt byte for byte, and no number can enter the derived layer without
 * an observation underneath it.
 *
 * ## Controlled vocabularies, and what requirement 5 does and does not mean
 *
 * > *"Future drawings should enrich the knowledge base without requiring code changes."*
 *
 * Adding drawings needs no code: an observation file is JSON, it names an existing measurement, and
 * the aggregation picks it up. That is the requirement and it holds.
 *
 * Adding a genuinely new *kind* of measurement — something no vocabulary below names — takes one
 * line in an array, and it should. `DIMENSION_NAMES` is a closed enum for the reason `SPACE_FUNCTIONS`
 * is: the solver selects on it, and free text lets "aisle width" and "aisle_width" become two
 * things that no query matches. A query that silently matches nothing looks exactly like a query
 * everything satisfies.
 */

const finiteNumber = z.number().refine(Number.isFinite, 'must be a finite number');
const positive = finiteNumber.refine((value) => value > 0, 'must be greater than zero');

export const KNOWLEDGE_KINDS = [
  'room_type',
  'equipment_placement',
  'station_layout',
  'circulation_path',
  'ro_room_pattern',
  'drain_routing',
  'electrical_routing',
  'common_dimension',
  'geometric_pattern',
] as const;

export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

/**
 * Rooms, by what happens in them.
 *
 * Deliberately the same vocabulary as the document model's `SPACE_FUNCTIONS`. A knowledge base that
 * classified rooms its own way would need a translation table between what a drawing showed and
 * what a project models, and a translation table is where two vocabularies quietly diverge.
 */
export const ROOM_FUNCTIONS = [
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

/** How stations are arranged in a treatment room. */
export const STATION_ARRANGEMENTS = ['rows', 'islands', 'perimeter', 'mixed'] as const;

/** Who or what uses a route. Dialysis units separate these deliberately. */
export const CIRCULATION_KINDS = ['staff', 'patient', 'goods', 'soiled'] as const;

/** How a service is run to the stations. */
export const ROUTING_STRATEGIES = [
  'in_floor',
  'floor_trench',
  'wall_chase',
  'skirting_trunking',
  'overhead_tray',
  'overhead_ceiling_void',
] as const;

/**
 * Measurements a drawing can state, and the solver can ask for.
 *
 * Closed on purpose — see the note above. Each entry is a length in millimetres unless its name
 * says otherwise, and each is something that appears on real dialysis drawings rather than
 * something that would be nice to have.
 */
export const DIMENSION_NAMES = [
  /** Centre to centre between adjacent stations. */
  'station_pitch',
  /** Clear gap between adjacent station footprints. */
  'station_clear_gap',
  /** Clear width of the aisle serving a run of stations. */
  'aisle_width',
  /**
   * Between two rows of stations, as the drawings annotate it (`베드 열 간격`).
   *
   * Added when the hospital dataset was read: 43 drawings dimension it and no existing name meant
   * it. Not `aisle_width` — the drawings distinguish the two, and a row-to-row figure includes the
   * depth the stations themselves occupy where an aisle width does not. Collapsing them would
   * produce a single range describing neither.
   */
  'station_row_spacing',
  /** Clear width of a circulation corridor. */
  'corridor_width',
  /**
   * Wall face to wall face across a treatment room.
   *
   * Added by the Hospital_044 verification, which needed it and found no name for it. It is the
   * figure that decides whether a hall can hold two rows of stations facing each other or only one,
   * so it is worth carrying across drawings — and it is the one dimension that hall did **not**
   * print, which is why every reading of it so far carries `calibrated_measurement` rather than
   * `dimension_line`.
   */
  'treatment_room_width',
  /** Clear opening of the door equipment is delivered through. */
  'door_clear_width',
  /** Allowance around a machine's footprint for its delivery crate. */
  'delivery_crate_allowance',
  /** Centre to centre between adjacent beds. */
  'bed_pitch',
  /** Drain pipe bore. */
  'drain_diameter',
  /** Run from the electrical panel to the furthest station it serves. */
  'panel_to_station_run',
  /** Run from the RO plant to the furthest station it serves. */
  'ro_to_station_run',
] as const;

export type RoomFunction = (typeof ROOM_FUNCTIONS)[number];
export type StationArrangement = (typeof STATION_ARRANGEMENTS)[number];
export type CirculationKind = (typeof CIRCULATION_KINDS)[number];
export type RoutingStrategy = (typeof ROUTING_STRATEGIES)[number];
export type DimensionName = (typeof DIMENSION_NAMES)[number];

// ---------------------------------------------------------------------------
// Observation payloads — one reading, from one drawing
// ---------------------------------------------------------------------------

/*
 * Every measurement below is nullable, and that is the shape of the whole dataset: drawings state
 * some things and not others. A room outline with no printed area gives a room type and no area,
 * and recording `0` or omitting the room entirely would both be worse than recording what the
 * drawing actually showed.
 */

const roomTypeSchema = z.strictObject({
  kind: z.literal('room_type'),
  function: z.enum(ROOM_FUNCTIONS),
  /** As labelled on the drawing, in whatever language it was drawn. */
  label: z.string().min(1).nullable(),
  areaSquareMetres: positive.nullable(),
  widthMm: positive.nullable(),
  depthMm: positive.nullable(),
  /** Stations counted in this room, where it is a treatment room. */
  stationCount: z.number().int().nonnegative().nullable(),
});

const equipmentPlacementSchema = z.strictObject({
  kind: z.literal('equipment_placement'),
  /** What was placed, in the drawing's own words — "AK98", "dialysis machine", "RO unit". */
  equipmentLabel: z.string().min(1),
  roomFunction: z.enum(ROOM_FUNCTIONS),
  /** Rotation as drawn, degrees clockwise from the room's long axis. */
  orientationDegrees: finiteNumber.nullable(),
  /** Clear distance from the machine to the wall behind it. */
  distanceToWallMm: positive.nullable(),
  /** Whether the machine sits against a wall, in a bay, or free-standing. */
  relation: z.enum(['against_wall', 'in_bay', 'free_standing', 'unknown']),
});

const stationLayoutSchema = z.strictObject({
  kind: z.literal('station_layout'),
  arrangement: z.enum(STATION_ARRANGEMENTS),
  stationCount: z.number().int().positive(),
  pitchMm: positive.nullable(),
  rowCount: z.number().int().positive().nullable(),
  aisleWidthMm: positive.nullable(),
  /** The room this arrangement fills, where the drawing gives its size. */
  roomWidthMm: positive.nullable(),
  roomDepthMm: positive.nullable(),
});

const circulationPathSchema = z.strictObject({
  kind: z.literal('circulation_path'),
  circulation: z.enum(CIRCULATION_KINDS),
  widthMm: positive.nullable(),
  /** What it runs between, by room function. Two entries: from and to. */
  connects: z.tuple([z.enum(ROOM_FUNCTIONS), z.enum(ROOM_FUNCTIONS)]),
  /** Whether clean and soiled routes are kept apart on this drawing. */
  separatedFromSoiled: z.boolean().nullable(),
});

const roRoomPatternSchema = z.strictObject({
  kind: z.literal('ro_room_pattern'),
  areaSquareMetres: positive.nullable(),
  /** Room functions this RO room shares a wall with. */
  adjacentTo: z.array(z.enum(ROOM_FUNCTIONS)),
  /** Plant drawn in the room, in the drawing's words. */
  components: z.array(z.string().min(1)),
  /** Distance from the RO room to the treatment room it serves. */
  distanceToTreatmentMm: positive.nullable(),
  /** Whether a standby loop or second train is drawn. */
  redundancy: z.enum(['none', 'standby_unit', 'dual_train', 'unknown']),
});

const drainRoutingSchema = z.strictObject({
  kind: z.literal('drain_routing'),
  strategy: z.enum(ROUTING_STRATEGIES),
  diameterMm: positive.nullable(),
  /** Fall in millimetres per metre of run, where the drawing states it. */
  fallPerMetreMm: positive.nullable(),
  /** Where the run discharges, in the drawing's words. */
  dischargeTo: z.string().min(1).nullable(),
});

const electricalRoutingSchema = z.strictObject({
  kind: z.literal('electrical_routing'),
  strategy: z.enum(ROUTING_STRATEGIES),
  socketsPerStation: z.number().int().positive().nullable(),
  /** Whether each station is drawn on its own circuit. */
  dedicatedCircuitPerStation: z.boolean().nullable(),
  panelToFurthestStationMm: positive.nullable(),
});

const commonDimensionSchema = z.strictObject({
  kind: z.literal('common_dimension'),
  name: z.enum(DIMENSION_NAMES),
  millimetres: positive,
  /** Where it applies, when the drawing scopes it to one room. */
  roomFunction: z.enum(ROOM_FUNCTIONS).nullable(),
});

/**
 * Something the same appearing across drawings that is not a single number.
 *
 * The catch-all, and it is deliberately weak: a free-text `name` cannot be queried by the solver,
 * only read by an engineer. That is the right trade — a pattern nobody has named precisely enough
 * to put in a vocabulary is not something the solver should be acting on, but it is exactly what a
 * person reviewing the dataset wants to see written down.
 */
const geometricPatternSchema = z.strictObject({
  kind: z.literal('geometric_pattern'),
  name: z.string().min(1),
  description: z.string().min(1),
  /** How many times it occurs on this drawing. */
  occurrences: z.number().int().positive(),
});

export const observationValueSchema = z.discriminatedUnion('kind', [
  roomTypeSchema,
  equipmentPlacementSchema,
  stationLayoutSchema,
  circulationPathSchema,
  roRoomPatternSchema,
  drainRoutingSchema,
  electricalRoutingSchema,
  commonDimensionSchema,
  geometricPatternSchema,
]);

export type ObservationValue = z.infer<typeof observationValueSchema>;

export const observationSchema = z.strictObject({
  id: z.string().min(1),
  source: observationSourceSchema,
  value: observationValueSchema,
});

export type Observation = z.infer<typeof observationSchema>;

/** One file of observations, all from the same drawing set. */
export const observationFileSchema = z.strictObject({
  datasetId: z.string().min(1),
  observations: z.array(observationSchema),
});

export type ObservationFile = z.infer<typeof observationFileSchema>;

// ---------------------------------------------------------------------------
// Derived knowledge — what many observations amount to
// ---------------------------------------------------------------------------

/**
 * The spread of a measured quantity across drawings.
 *
 * **Median, not mean.** One unit built to an unusual brief moves a mean and barely moves a median,
 * and "typical practice" is what this is for. `minimum` and `maximum` are carried beside it because
 * the spread is often the useful part: a pitch running 1,700–2,100 tells an engineer that the
 * number is a choice, where 1,795–1,805 tells them it is effectively fixed.
 */
export const distributionSchema = z.strictObject({
  minimum: finiteNumber,
  median: finiteNumber,
  maximum: finiteNumber,
  unit: z.enum(['mm', 'm2', 'count', 'degrees']),
});

export type Distribution = z.infer<typeof distributionSchema>;

/** How often each value of a categorical quantity was seen. */
export const frequencySchema = z.strictObject({
  value: z.string().min(1),
  /** Distinct drawings showing this value. */
  /**
   * Distinct **plans** showing this value — owner decision D15, the same unit as `Support.plans`.
   *
   * Counted `drawingId` before, so a plan exported as both `.dwg` and `.pdf` voted twice for its own
   * value. Latent today because no entry ships a frequency table, and fixed now for that reason: it
   * feeds which value is presented as commonest practice, and an export format must not decide that.
   */
  plans: z.number().int().positive(),
});

export type Frequency = z.infer<typeof frequencySchema>;

/**
 * One derived entry: a claim about practice, with what it rests on.
 *
 * `support` is required and non-nullable. There is no way to write an entry without saying how many
 * drawings are behind it, which is the point — a range with no support count is a number pretending
 * to be a pattern.
 */
export const knowledgeEntrySchema = z.strictObject({
  /** Stable, derived from the kind and the thing being described. */
  id: z.string().min(1),
  kind: z.enum(KNOWLEDGE_KINDS),
  /** What this entry is about — a dimension name, a room function, a routing strategy. */
  subject: z.string().min(1),
  /** Scope, when the entry is about one kind of room. */
  roomFunction: z.enum(ROOM_FUNCTIONS).nullable(),
  /** For a measured quantity. Null for a purely categorical entry. */
  distribution: distributionSchema.nullable(),
  /** For a categorical quantity, commonest first. Empty for a purely measured entry. */
  /**
   * How many distinct drawings support each distinct value — **absent when there is none**.
   *
   * > Owner decision: *"Do not emit an empty `frequencies` field. `[]` currently means two different
   * > things: no observations exist, and this observation type never collects frequencies. Those are
   * > different states. Until frequencies carries real information, remove it from generated
   * > artifacts rather than emitting `[]`. Unknown must not masquerade as measured zero."*
   *
   * Measured before the decision: every entry in every derived file carried `frequencies: []`, for
   * two unrelated reasons — the `common_dimension` branch passes a literal `[]` at the call site,
   * and every branch that does compute frequencies belongs to a kind with no observations at all.
   * An empty array read as *"we counted and found nothing"* in both cases.
   *
   * Optional rather than nullable on purpose: `null` would be a third spelling of the same
   * ambiguity. An absent key is the only encoding that says nothing at all.
   */
  frequencies: z.array(frequencySchema).optional(),
  support: supportSchema,
});

export type KnowledgeEntry = z.infer<typeof knowledgeEntrySchema>;

/**
 * A derived file: every entry of one kind.
 *
 * `generatedFrom` names the observation files it was built from, so a stale derived file is
 * detectable rather than merely suspected — the same reasoning as the installation plan's
 * fingerprint one package over.
 */
export const knowledgeFileSchema = z.strictObject({
  kind: z.enum(KNOWLEDGE_KINDS),
  /** Bumped when the derived shape changes, so a consumer can refuse a file it cannot read. */
  knowledgeVersion: z.number().int().positive(),
  generatedFrom: z.array(z.string().min(1)),
  entries: z.array(knowledgeEntrySchema),
});

export type KnowledgeFile = z.infer<typeof knowledgeFileSchema>;

/** The derived contract this build writes and reads. */
/**
 * Bumped to 2 when `frequencies` stopped being emitted empty.
 *
 * The shape widened rather than broke — the field is optional, so a file still carrying
 * `frequencies: []` parses. The *meaning* changed, which is the part a version number exists to
 * identify: in a version 1 file an empty array was written for entries nobody had counted, and a
 * reader that treated it as "counted, found none" would be wrong about every one of them.
 */
export const KNOWLEDGE_VERSION = 3;

// ---------------------------------------------------------------------------
// The dataset itself
// ---------------------------------------------------------------------------

/**
 * The dataset repository, referenced rather than vendored.
 *
 * > Owner decision: *"I will provide a GitHub repository containing a large collection of dialysis
 * > unit drawings (PDF/DWG/JPG). Treat this repository as a long-term engineering dataset, not as
 * > project source code."*
 *
 * `commit` is what makes an observation reproducible. "The Ilsan drawing" is not a reference if the
 * dataset has moved on; "the Ilsan drawing at commit abc1234" is. Nullable only so a dataset can be
 * declared before it is first pinned.
 */
/**
 * How usable a drawing is, from `docs/verification/DRAWING_IMPORT_VERIFICATION.md`.
 *
 * Assigned by the ingester from what the file itself says, never by hand. Two of them are
 * deliberately provisional: `photograph_suspected` is a flag for a human to confirm, because
 * perspective distortion cannot be detected from a raster, and `unknown` is what an unreadable
 * file gets rather than a guess.
 */
export const DRAWING_CLASSES = [
  /** Born-digital PDF from CAD. Selectable text, crisp lines. */
  'vector_cad_export',
  /** A raster image wrapped in a PDF — a scan. */
  'scanned_pdf',
  /** A raster file. May be a scan or a photograph; `photograph_suspected` narrows it. */
  'raster_image',
  /** A JPG large enough to be a camera photograph. Perspective cannot be corrected — refuse. */
  'photograph_suspected',
  /** Native CAD. Not read by this application, by decision. */
  'native_cad',
  /** Encrypted, corrupt, or otherwise unopenable. */
  'unreadable',
  'unknown',
] as const;

export type DrawingClass = (typeof DRAWING_CLASSES)[number];

/** What the ingester could read off a sheet without a human opening it. */
export const drawingMetadataSchema = z.strictObject({
  /** Page width and height in PDF points (1/72 inch), first page. Null for a raster. */
  pageWidthPt: positive.nullable(),
  pageHeightPt: positive.nullable(),
  /** Nearest ISO sheet size, e.g. "A1". Null when it matches none within tolerance. */
  sheetSize: z.string().min(1).nullable(),
  /**
   * Effective resolution the importer will actually rasterise this page at.
   *
   * Below 150 means the 4,096 px cap bites and detail is lost — gap G-4 in the verification
   * document, computed per sheet rather than assumed.
   */
  effectiveDpi: positive.nullable(),
  /** Characters of extractable text on the first page. Near zero means a scan. */
  textCharacters: z.number().int().nonnegative().nullable(),
  /** From the PDF's info dictionary, where present. */
  title: z.string().min(1).nullable(),
  producer: z.string().min(1).nullable(),
  /** Bytes on disk. */
  fileBytes: z.number().int().nonnegative(),
});

export type DrawingMetadata = z.infer<typeof drawingMetadataSchema>;

/**
 * What a sheet is *for*, as the dataset's own index states it.
 *
 * Taken from the dataset rather than inferred, and it is the field that decides which drawings are
 * worth reading: a `3d_view` or an `interior_detail` carries no plan geometry, and a `base_plan` is
 * the shell before any dialysis equipment was laid out.
 */
export const DRAWING_ROLES = [
  'dialysis_layout',
  'ro_room',
  'base_plan',
  'peritoneal_dialysis',
  'interior_detail',
  '3d_view',
  'template',
  'unknown',
] as const;

export type DrawingRole = (typeof DRAWING_ROLES)[number];

export const drawingRecordSchema = z.strictObject({
  drawingId: z.string().min(1),
  /** Which `Hospital_NNN` folder it came from. */
  hospitalId: z.string().min(1),
  path: z.string().min(1),
  format: z.enum(['pdf', 'dwg', 'dxf', 'jpg', 'png', 'other']),
  role: z.enum(DRAWING_ROLES),
  pageCount: z.number().int().positive().nullable(),
  sheet: z.string().min(1).nullable(),
  revision: z.string().min(1).nullable(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  classification: z.enum(DRAWING_CLASSES),
  metadata: drawingMetadataSchema,
  /** Whether this drawing has been read yet. */
  status: z.enum(['catalogued', 'observed', 'unreadable']),
});

export type DrawingRecord = z.infer<typeof drawingRecordSchema>;

export const datasetSchema = z.strictObject({
  id: z.string().min(1),
  /** e.g. "haru7821/dialysis-drawings". */
  repository: z.string().min(1).nullable(),
  /** The commit observations were read against. */
  commit: z.string().min(1).nullable(),
  description: z.string().min(1),
  /** What may be published from it. Real hospital drawings are not ours to redistribute. */
  redistribution: z.enum(['none', 'derived_knowledge_only', 'open']),
  drawings: z.array(drawingRecordSchema),
});

export type Dataset = z.infer<typeof datasetSchema>;
