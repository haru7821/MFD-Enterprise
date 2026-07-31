import type {
  EvidenceStatus,
  PlanBlockerKind,
  PlanRiskOrigin,
  PlanService,
} from '@mfd/ai-contract';
import type { ReferencePointKind, ReportRenderMode } from '@mfd/document-model';
import type { DataStatus } from '@mfd/object-library';
import type { Bilingual, ReasonCode, ReasonParams } from '@mfd/rule-engine';

import type { LabelKey } from './labels';

/**
 * The report model — a complete, ordered, JSON-safe description of the document a
 * hospital receives.
 *
 * ## Why the model is not the PDF
 *
 * Owner decision: *"Sprint 5 is NOT a PDF export sprint. Sprint 5 is the Engineering
 * Report Engine"*, and the engine must later render PDF, DOCX, HTML and JSON **without
 * changing business logic**. That requirement is met by making this the boundary:
 *
 * ```
 * document + catalogue + rule set ──► ReportModel ──► renderer
 *          business logic                data          typography
 * ```
 *
 * Everything the report *claims* is decided on the left. A renderer chooses fonts, page
 * breaks and colours; it never decides whether a finding is provisional or what the
 * verdict is. So a new output format is a new file in ./render/, not a change here.
 *
 * The practical test of that boundary: `json.ts` is a renderer, and it is three lines.
 * If a format needed a decision the model does not hold, JSON could not be one.
 *
 * ## Bilingual by construction
 *
 * Owner decision: every section title, field label, finding, warning and recommendation
 * exists in Korean and English. Two mechanisms, and the split matters:
 *
 * | | Mechanism | Why |
 * | --- | --- | --- |
 * | Labels, titles, statuses | A `LabelKey` into ./labels.ts | Finite, ours to author, reviewable as one file |
 * | Findings | A `ReasonCode` from the rule engine | Composed per language from the code — never translated prose |
 * | Names, citations, numbers | Plain values, printed once | A room the engineer called 투석실 A is 투석실 A in both |
 *
 * A key rather than a pair of strings: a fixture asserting a *number* must not break when
 * somebody edits a Korean label, and a missing translation must be a compile error rather
 * than a blank cell in a signed document.
 *
 * ## Version
 *
 * `reportVersion` is frozen the way the evaluation contract is. A report is a published
 * artefact — a field present in one build and absent in the next is a report that
 * contradicts its predecessor, and both are in a customer's filing system.
 */

export const REPORT_VERSION = 1;

// ---------------------------------------------------------------------------
// 1. Cover page
// ---------------------------------------------------------------------------

export interface CoverSection {
  readonly hospital: string;
  readonly site: string;
  readonly contact: string;
  readonly projectName: string;
  readonly customerContact: string;
  /** The TS engineer named on the project. Blank when nobody is recorded yet. */
  readonly tsEngineer: string;
  /** ISO date the report was generated. Injected, never read from a clock here. */
  readonly date: string;
  /** The application version, so a reader can tell which build produced this. */
  readonly mfdVersion: string;
}

// ---------------------------------------------------------------------------
// 2. Executive summary
// ---------------------------------------------------------------------------

export type Verdict = 'not_acceptable' | 'review_required' | 'acceptable' | 'inconclusive';

export interface ExecutiveSummarySection {
  readonly totalEquipment: number;
  readonly green: number;
  readonly yellow: number;
  readonly red: number;
  readonly verdict: Verdict;
  /**
   * Why the verdict is what it is, as label keys rather than sentences.
   *
   * `inconclusive` in particular has to explain itself: how many findings had no
   * threshold, how many levels were never calibrated. A verdict a reader cannot account
   * for is a verdict they will either over-trust or ignore.
   */
  readonly grounds: readonly SummaryGround[];
  /** True when any finding rests on a draft field group or a draft rule. */
  readonly hasDraftInputs: boolean;
  /**
   * The three evidence counts the owner requires on the summary.
   *
   * Named figures, not only grounds. The grounds list explains *this* verdict; these three
   * answer "how far is this project from being conclusive?", which is a different question and
   * the one an engineer chasing a manual actually has. They appear whether or not they are
   * zero, because a zero is the answer too.
   */
  readonly evidence: EvidenceCounts;
}

export interface EvidenceCounts {
  /**
   * Findings that could not name a source document.
   *
   * Counted per finding rather than per rule, because that is the size of the hole: five
   * findings resting on one uncited rule are five statements a reader cannot check.
   */
  readonly missingReferences: number;
  /** Equipment field groups in use with no manufacturer citation. Per group, never per record. */
  readonly missingManufacturerCitations: number;
  /**
   * Rules in the set whose own status is draft.
   *
   * The whole set, not only the rules that fired. A draft rule that matched nothing is still an
   * uncited rule, and counting only the ones that produced findings would make the number drop
   * as a drawing emptied — which is backwards.
   */
  readonly draftRuleCount: number;
}

export interface SummaryGround {
  readonly label: LabelKey;
  readonly count: number;
}

// ---------------------------------------------------------------------------
// 3. Equipment schedule
// ---------------------------------------------------------------------------

export interface EquipmentScheduleRow {
  readonly equipmentId: string;
  /** Null for a generic planning object, which has no manufacturer. */
  readonly manufacturer: string | null;
  readonly model: string;
  readonly catalogueVersion: string;
  readonly quantity: number;
  /** Null when the record holds no manufacturer figures at all. */
  readonly manufacturerDimensions: Dimensions | null;
  readonly designFootprint: Footprint;
  /** One entry per verified field group, one per draft group. */
  readonly verification: readonly FieldGroupStatus[];
}

export interface Dimensions {
  readonly width: number | null;
  readonly depth: number | null;
  readonly height: number | null;
  readonly weight: number | null;
}

export interface Footprint {
  readonly width: number;
  readonly depth: number;
  readonly basis: string | null;
}

export interface FieldGroupStatus {
  readonly group: LabelKey;
  readonly status: DataStatus;
  /** The citation, or null when the group is draft. */
  readonly citation: string | null;
}

export interface EquipmentScheduleSection {
  readonly rows: readonly EquipmentScheduleRow[];
  /**
   * Placements pointing at a catalogue record that no longer exists.
   *
   * Surfaced rather than dropped. A machine silently missing from a schedule is a
   * machine somebody does not order.
   */
  readonly unknownEquipmentIds: readonly string[];
}

// ---------------------------------------------------------------------------
// 4. Floor plan
// ---------------------------------------------------------------------------

export interface DrawingInfo {
  readonly sourceFileName: string;
  readonly sourceFormat: string;
  readonly pageIndex: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly importedAt: string;
  /** The underlay itself, so a renderer can place it. Null when no plan was imported. */
  readonly dataUrl: string | null;
}

export interface CalibrationInfo {
  readonly method: string;
  readonly millimetresPerPixel: number;
  readonly knownDistance: number | null;
  readonly statedRatio: string | null;
  readonly dotsPerInch: number | null;
  readonly calibratedAt: string;
}

export interface MappingInfo {
  readonly originPixel: { readonly x: number; readonly y: number };
  /** Millidegrees, as stored. A renderer formats it. */
  readonly rotation: number;
  readonly mappedAt: string;
}

/** One numbered machine on the drawing, keyed to the placement table and the findings. */
export interface PlacementRow {
  readonly number: number;
  readonly placementId: string;
  readonly label: string;
  readonly model: string;
  readonly position: { readonly x: number; readonly y: number };
  /** Degrees, rounded — millidegrees are a storage detail, not a report figure. */
  readonly rotationDegrees: number;
  readonly mirrored: boolean;
  /** The room it sits in, or null. */
  readonly room: string | null;
}

/**
 * Whether this level's geometry can be measured against a building.
 *
 * Three states, not two, and the distinction is load-bearing:
 *
 * | State | Means |
 * | --- | --- |
 * | `none` | No drawing at all. The layout's geometry is **exact** — it was laid out in millimetres. |
 * | `calibrated` | A drawing with a coordinate mapping. Measurements are against the building. |
 * | `uncalibrated` | A drawing with no mapping. **Nothing here has been checked against the building.** |
 *
 * Collapsing `none` into `uncalibrated` was a defect caught by a browser spec: the default
 * project has no plan, and the report warned that it was uncalibrated — which is false, and
 * exactly the kind of false alarm that teaches a reader to ignore the warning that matters.
 */
export type PlanStatus = 'none' | 'calibrated' | 'uncalibrated';

/**
 * Where the scanned drawing sits in model space, so a renderer can place it under the
 * geometry without knowing anything about pixels or calibration.
 *
 * A rectangle plus a rotation rather than four corners: an image *is* a rectangle, and every
 * renderer worth having (SVG `<image>`, `pdf-lib` `drawImage`) takes exactly this. Four corners
 * would make each renderer solve the same rotation problem again.
 *
 * Null when there is no plan, or when the plan has no coordinate mapping — an uncalibrated
 * scan has no millimetres in it, so there is no honest place to put it.
 */
export interface RasterPlacement {
  /** Model millimetres of the image's top-left corner. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Degrees clockwise, about the top-left corner. */
  readonly rotationDegrees: number;
  readonly dataUrl: string;
}

export interface FloorPlanSection {
  readonly levelId: string;
  readonly levelName: string;
  readonly elevation: number;
  readonly planStatus: PlanStatus;
  /** Null when this level has no imported drawing. */
  readonly drawing: DrawingInfo | null;
  /** Null when the drawing was never calibrated — which the report must say. */
  readonly calibration: CalibrationInfo | null;
  readonly mapping: MappingInfo | null;
  readonly placements: readonly PlacementRow[];
  readonly rooms: readonly RoomRow[];
  readonly obstructions: readonly ObstructionRow[];
  /**
   * Where the services enter, equipment is delivered, and staff work from.
   *
   * **Empty is a state the report states rather than omits.** Four of the approved scoring
   * criteria measure distance from one of these, so a level with none recorded cannot be scored
   * on 40 % of the model — and a reader has to be able to see that from the report rather than
   * infer it from a missing table.
   */
  readonly referencePoints: readonly ReferencePointRow[];
  /** Geometry for the drawing page, in model millimetres. */
  readonly geometry: LevelGeometry;
  /**
   * The scan, placed in model space, or null.
   *
   * Present in the model whatever the render mode: the mode decides whether a renderer *draws*
   * it, and a model that omitted the raster in vector mode would make switching mode a
   * different report rather than a different drawing of the same one.
   */
  readonly raster: RasterPlacement | null;
}

export interface ReferencePointRow {
  readonly kind: ReferencePointKind;
  /** The kind's bilingual name, resolved from the label catalogue. */
  readonly kindLabel: LabelKey;
  /** What the engineer called it, or null. Printed verbatim — it is not ours to translate. */
  readonly label: string | null;
  readonly position: { readonly x: number; readonly y: number };
}

export interface RoomRow {
  readonly name: string;
  readonly function: string;
  readonly areaSquareMetres: number;
  readonly vertexCount: number;
}

export interface ObstructionRow {
  readonly label: string;
  readonly obstructionType: string;
  readonly areaSquareMetres: number;
}

export interface Polyline {
  readonly points: readonly { readonly x: number; readonly y: number }[];
  readonly label: string;
}

export interface LevelGeometry {
  readonly rooms: readonly Polyline[];
  readonly obstructions: readonly Polyline[];
  /** Footprint outlines, numbered to match `placements`. */
  readonly equipment: readonly Polyline[];
  /**
   * Reference points as single-point marks, for a renderer to draw a symbol at.
   *
   * Deliberately **not** folded into the extent below: a panel in a corridor outside the traced
   * rooms would otherwise stretch the drawing's bounding box and shrink the layout an engineer
   * came to look at. A mark outside the extent is clipped, which is the right trade — the table
   * still lists it with its coordinates.
   */
  readonly referencePoints: readonly Polyline[];
  /** Bounding box of everything above, so a renderer can fit a page. */
  readonly extent: {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  } | null;
}

// ---------------------------------------------------------------------------
// 5. Validation report
// ---------------------------------------------------------------------------

export interface FindingRow {
  readonly severity: 'RED' | 'YELLOW' | 'GREEN';
  readonly ruleId: string;
  /** From the rule file — both languages, because a rule's name is part of the rule. */
  readonly ruleName: Bilingual;
  /** The finding itself, composed per language from the code at render time. */
  readonly reasonCode: ReasonCode;
  readonly reasonParams: ReasonParams;
  /** A qualification on top of the finding, or null. */
  readonly caveatCode: ReasonCode | null;
  readonly appliedThreshold: number | null;
  readonly unit: string;
  /** Which source supplied the threshold: rule, equipment record, or neither. */
  readonly thresholdOrigin: LabelKey;
  /** The clause behind the threshold, or null when there is none. */
  readonly thresholdSource: string | null;
  readonly measured: number | null;
  readonly verification: DataStatus;
  /** Numbers from the placement table, so a finding points at the drawing. */
  readonly placementNumbers: readonly number[];
  readonly placementLabels: readonly string[];
}

export interface ValidationSection {
  readonly levelId: string;
  readonly levelName: string;
  readonly ruleSetId: string;
  readonly ruleSetVersion: string;
  readonly findings: readonly FindingRow[];
  readonly counts: { readonly GREEN: number; readonly YELLOW: number; readonly RED: number };
}

// ---------------------------------------------------------------------------
// 6. Installation checklist
// ---------------------------------------------------------------------------

export interface ChecklistItem {
  /** Derived from a finding, a data gap, or the checklist template. */
  readonly origin: 'finding' | 'data_gap' | 'calibration' | 'standard';
  /** Free text when it came from the template; a reason code when it came from a finding. */
  readonly reasonCode: ReasonCode | null;
  readonly reasonParams: ReasonParams;
  /** Set when the item came from the template rather than a finding. */
  readonly text: Bilingual | null;
  /** What the engineer has to do about it. */
  readonly action: LabelKey;
  /** The finding this traces back to, or null. */
  readonly ruleId: string | null;
  readonly placementLabel: string | null;
}

export interface ChecklistCategory {
  readonly id: string;
  readonly title: Bilingual;
  readonly items: readonly ChecklistItem[];
}

export interface ChecklistSection {
  readonly categories: readonly ChecklistCategory[];
}

// ---------------------------------------------------------------------------
// 7. Equipment datasheets
// ---------------------------------------------------------------------------

export interface DatasheetField {
  readonly label: LabelKey;
  /** Already formatted — "585 × 620 × 1305 mm", or null when not supplied. */
  readonly value: string | null;
}

/**
 * One equipment record as three separated blocks.
 *
 * Owner decision: *"Never mix manufacturer data with planning data."* So the split is
 * structural rather than a heading convention a renderer might get wrong:
 *
 * | Block | What it holds |
 * | --- | --- |
 * | `manufacturer` | Cited figures. Each group names the document it came from. |
 * | `designFootprint` | The owner's planning decision. **No citation, by design.** |
 * | `draft` | Figures with no manual reference yet. |
 *
 * Three blocks and not two: the design footprint is neither verified nor draft. Printing
 * it under "draft" would read as a figure nobody had got round to sourcing, rather than
 * one that will never have a document behind it.
 */
export interface DatasheetSection {
  readonly equipmentId: string;
  readonly model: string;
  readonly manufacturer: string | null;
  readonly catalogueVersion: string;
  readonly manufacturer_data: readonly DatasheetBlock[];
  readonly designFootprint: readonly DatasheetField[];
  readonly draft_data: readonly DatasheetBlock[];
}

export interface DatasheetBlock {
  readonly group: LabelKey;
  /** Null for a draft block — that is what makes it draft. */
  readonly citation: string | null;
  readonly fields: readonly DatasheetField[];
}

// ---------------------------------------------------------------------------
// 8. Standards
// ---------------------------------------------------------------------------

export interface StandardRow {
  readonly ruleId: string;
  readonly ruleName: Bilingual;
  readonly category: string;
  readonly threshold: number | null;
  readonly unit: string;
  readonly status: DataStatus;
  readonly document: string | null;
  readonly revision: string | null;
  readonly section: string | null;
  readonly sourceType: string;
  readonly lastUpdated: string;
  /** How many findings this rule produced. A rule that fired on nothing is worth seeing. */
  readonly findingCount: number;
}

export interface StandardsSection {
  readonly ruleSetId: string;
  readonly ruleSetVersion: string;
  readonly rules: readonly StandardRow[];
}

// ---------------------------------------------------------------------------
// 9. Liability statement
// ---------------------------------------------------------------------------

export interface NoticeSection {
  /** The owner's wording, verbatim, both languages. Frozen — see ./notice.ts. */
  readonly liability: Bilingual;
  /**
   * Our own caveats, kept **separate** from the owner's wording above so the legal text
   * is never extended, wrapped or edited by something we added later.
   */
  readonly caveats: readonly Bilingual[];
}

// ---------------------------------------------------------------------------
// 9. Installation plan, connections and bill of materials
// ---------------------------------------------------------------------------

/**
 * A figure from the planner, ready to print.
 *
 * `value: null` means **unknown**, and the renderers print the `not_supplied` label for it in both
 * languages. Not `0`, not `'—'`: the owner's *"unknown values remain Unknown"* is only kept if an
 * unknown reads as a statement rather than as a formatting artefact.
 *
 * `status` and `sourceRef` ride along so a reader can see *why* it is what it is, and `inputs`
 * carries the arithmetic behind a `calculated` figure — a signed document should let somebody check
 * the sum rather than take it.
 */
export interface SourcedFigure {
  readonly value: number | null;
  readonly unit: string;
  readonly status: EvidenceStatus;
  readonly sourceRef: string;
  readonly inputs: readonly string[];
}

export interface StageCheckRow {
  readonly id: string;
  /** The checklist item's text, or null when the report's checklist does not have the id. */
  readonly text: Bilingual | null;
}

export interface BomRow {
  readonly id: string;
  readonly title: Bilingual;
  readonly quantity: SourcedFigure;
}

export interface InstallationStageRow {
  readonly id: string;
  readonly order: number;
  readonly title: Bilingual;
  readonly dependsOn: readonly string[];
  /** The numbers the floor plan prints, so the plan and the drawing name the same machines. */
  readonly placementNumbers: readonly number[];
  readonly checks: readonly StageCheckRow[];
  readonly tools: readonly BomRow[];
  readonly materials: readonly BomRow[];
  readonly manpower: SourcedFigure;
  readonly duration: SourcedFigure;
}

export interface ConnectionRunRow {
  readonly placementId: string;
  readonly length: SourcedFigure;
  readonly requirement: {
    readonly value: Bilingual | null;
    readonly status: EvidenceStatus;
    readonly sourceRef: string;
  };
}

export interface ConnectionSectionRow {
  readonly service: PlanService;
  readonly originPointId: string | null;
  readonly runs: readonly ConnectionRunRow[];
  readonly total: SourcedFigure;
}

export interface RiskRow {
  readonly id: string;
  readonly origin: PlanRiskOrigin;
  /** A reason code, a stage id, or a catalogue field group. Look it up; do not restate it. */
  readonly ref: string;
  readonly title: Bilingual;
  /** Null when the detail belongs to another section — a finding's prose is the validation's. */
  readonly detail: Bilingual | null;
  readonly stageId: string | null;
}

export interface InstallationBlockerRow {
  readonly kind: PlanBlockerKind;
  readonly ref: string;
  readonly stageId: string | null;
}

/**
 * The installation plan section.
 *
 * Null on `ReportModel` when no plan was built — which is the normal state of a project whose
 * layout has not been approved yet. A section that materialised an empty plan would say a job needs
 * no work.
 */
export interface InstallationSection {
  readonly sequenceSet: { readonly id: string; readonly version: string };
  readonly stages: readonly InstallationStageRow[];
  readonly connections: readonly ConnectionSectionRow[];
  /** The bill of materials, aggregated across stages by the planner. */
  readonly bom: readonly BomRow[];
  readonly risks: readonly RiskRow[];
  readonly blockers: readonly InstallationBlockerRow[];
  readonly manpower: SourcedFigure;
  readonly duration: SourcedFigure;
  readonly provenance: {
    readonly levelId: string;
    readonly placementCount: number;
    readonly ruleSet: { readonly id: string; readonly version: string };
    readonly optimisationCandidateId: string | null;
  };
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

export interface ProvenanceSection {
  readonly reportVersion: number;
  readonly documentVersion: number;
  readonly evaluationResultVersion: number;
  readonly ruleSetId: string;
  readonly ruleSetVersion: string;
  readonly catalogueVersions: readonly { readonly id: string; readonly version: string }[];
  readonly mfdVersion: string;
  readonly generatedAt: string;
}

// ---------------------------------------------------------------------------
// The whole report
// ---------------------------------------------------------------------------

export interface ReportModel {
  readonly reportVersion: number;
  /** Injected. `buildReport` never reads a clock — see AD-3. */
  readonly generatedAt: string;
  /**
   * How the drawing page is drawn — the project's stored setting, carried into the model.
   *
   * In the model rather than passed to each renderer, for the same reason everything else is:
   * a renderer that had to be *told* the mode is a renderer that could be told a different one
   * than the project recorded, and then two copies of the same report would differ with
   * nothing saying why.
   */
  readonly renderMode: ReportRenderMode;
  readonly cover: CoverSection;
  readonly summary: ExecutiveSummarySection;
  readonly equipmentSchedule: EquipmentScheduleSection;
  /** One per level, in project order. A report that covered one floor silently would omit a floor. */
  readonly floorPlans: readonly FloorPlanSection[];
  readonly validation: readonly ValidationSection[];
  readonly checklist: ChecklistSection;
  /**
   * The installation plan, or null when the layout has not been planned.
   *
   * Null rather than an empty section: a section holding no stages would tell a hospital the job
   * needs no work, and the difference between "not planned yet" and "nothing to do" is the whole
   * point of carrying it as an option.
   */
  readonly installation: InstallationSection | null;
  readonly datasheets: readonly DatasheetSection[];
  readonly standards: StandardsSection;
  readonly notice: NoticeSection;
  readonly provenance: ProvenanceSection;
}

/** The section order the owner specified, as data, so a renderer cannot reorder it. */
export const SECTION_ORDER = [
  'cover',
  'summary',
  'equipmentSchedule',
  'floorPlans',
  'validation',
  'checklist',
  /*
   * After the checklist and before the datasheets. The checklist says *what* must be checked; the
   * plan says *when*, and referencing items the reader has just read is easier than referring them
   * forward. See docs/architecture/AI_SYSTEM_ARCHITECTURE.md § C-3.
   */
  'installation',
  'datasheets',
  'standards',
  'notice',
] as const satisfies readonly (keyof ReportModel)[];

export type SectionName = (typeof SECTION_ORDER)[number];
