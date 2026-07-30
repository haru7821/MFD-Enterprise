import type {
  AiRequestContext,
  EquipmentFacts,
  FindingFacts,
  LevelFacts,
  ObstructionSummary,
  PlacementSummary,
  PolygonSummary,
  ReferencePointSummary,
  RefWithVersion,
  RuleFacts,
} from './context';
import type { ScoringModel } from './scoring';

/** What the AI is given. See docs/architecture/AI_SERVICE_API.md § B. */

export const PROPOSAL_INTENTS = ['place_one', 'fill_room', 'optimise', 'resolve_finding'] as const;
export type ProposalIntent = (typeof PROPOSAL_INTENTS)[number];

export interface ProposalRequest {
  readonly context: AiRequestContext;
  readonly intent: ProposalIntent;
  /** Model-millimetre geometry. No pixels, and never the raster. */
  readonly room: PolygonSummary;
  readonly obstructions: readonly ObstructionSummary[];
  readonly existing: readonly PlacementSummary[];
  readonly equipmentObjectId: string;
  /** For `resolve_finding`: which finding to try to clear. */
  readonly findingRuleId: string | null;
  /**
   * Points criteria measure from. **Empty is a legitimate value.**
   *
   * Four weighted criteria need one — 40 % of the approved model — and without them those criteria
   * report `unavailable` rather than zero. A zero would score an unmeasured pipe run as the best
   * possible one (AD-18).
   */
  readonly referencePoints: readonly ReferencePointSummary[];
  readonly scoring: ScoringModel;
  /**
   * The station-count **constraint**. `null` means "as many as fit".
   *
   * A candidate that misses it is not ranked low, it is not a candidate. See
   * {@link ./scoring.ts} for why this cannot be a weight.
   */
  readonly stationTarget: number | null;
}

/**
 * Score a layout that already exists.
 *
 * Separate from `propose` because an engineer's **own** arrangement deserves the same number.
 * Without this the score is only ever attached to the machine's suggestion, which makes it a sales
 * figure rather than a measurement.
 *
 * No `stationTarget`: scoring measures what is there. A target would imply the engineer's own
 * layout could fail a constraint, which is not the scoring engine's business to say.
 */
export interface ScoreRequest {
  readonly context: AiRequestContext;
  readonly room: PolygonSummary;
  readonly obstructions: readonly ObstructionSummary[];
  readonly placements: readonly PlacementSummary[];
  readonly referencePoints: readonly ReferencePointSummary[];
  readonly scoring: ScoringModel;
}

/**
 * Installation sequence and commissioning plan.
 *
 * Carries no dates and asks for none. Duration depends on crew size, site access, lead times and a
 * contract, none of which this platform holds; a plan stating order and dependency is derivable,
 * a plan stating "2 days" is invented (AD-19).
 */
export interface PlanRequest {
  readonly context: AiRequestContext;
  readonly placements: readonly PlacementSummary[];
  readonly referencePoints: readonly ReferencePointSummary[];
  /** The stage set to sequence against — `standards/sequences/dialysis.json`. */
  readonly sequenceSetRef: RefWithVersion;
  /**
   * Open findings, so a plan can lead with a blocker rather than sequence past one.
   *
   * A commissioning plan for a layout with a RED finding is a plan to commission something that
   * should not be built. It is still produced — an engineer reasonably wants the sequence while
   * resolving findings — but the blocker comes first.
   */
  readonly findings: readonly FindingFacts[];
}

export const KNOWLEDGE_CORPORA = [
  'manufacturer_manual',
  'rule_set',
  'standard',
  'internal_guideline',
] as const;
export type KnowledgeCorpus = (typeof KNOWLEDGE_CORPORA)[number];

/**
 * The knowledge engine's request.
 *
 * Issued by the editor when an engineer searches the manuals, and issued **internally** as stage ①
 * of every language method. One request type for both, so the passages a model reasoned over are
 * the same passages a person could have read.
 */
export interface RetrievalRequest {
  readonly context: AiRequestContext;
  readonly query: string;
  /** Which indexed corpora to search. Empty means all of them. */
  readonly corpora: readonly KnowledgeCorpus[];
  /** How many passages to return. The service caps it; a prompt cannot ask for a whole manual. */
  readonly limit: number;
  /**
   * Restrict to documents the project actually cites.
   *
   * A manual for a machine that is not in this project is not evidence about this project, and an
   * explanation drawing on one would cite a document the reader cannot find in the report.
   */
  readonly restrictToReferenced: boolean;
}

export const EXPLAIN_DEPTHS = ['brief', 'full'] as const;
export type ExplainDepth = (typeof EXPLAIN_DEPTHS)[number];

export type ExplainSubject =
  | { readonly kind: 'rule'; readonly ruleId: string }
  | { readonly kind: 'finding'; readonly finding: FindingFacts };

export interface ExplainRequest {
  readonly context: AiRequestContext;
  readonly subject: ExplainSubject;
  readonly depth: ExplainDepth;
}

/**
 * What the assistant is allowed to know for one question.
 *
 * Assembled by the editor **per request**, so exposure is a decision made at a call site a reviewer
 * can read rather than a property of being connected. A question about clearances does not need the
 * customer's name.
 */
export interface GroundingBundle {
  readonly findings: readonly FindingFacts[] | null;
  readonly rules: readonly RuleFacts[] | null;
  readonly equipment: readonly EquipmentFacts[] | null;
  readonly levelSummary: LevelFacts | null;
  /**
   * Always absent. Declared so its absence is a contract rather than an omission.
   *
   * The type system as documentation: the field cannot be set, and a reviewer reading the interface
   * sees *why* rather than noticing something is missing.
   */
  readonly planImage?: never;
}

export interface QueryRequest {
  readonly context: AiRequestContext;
  readonly question: string;
  readonly grounding: GroundingBundle;
}

export const SUMMARY_AUDIENCES = ['engineer', 'customer'] as const;
export type SummaryAudience = (typeof SUMMARY_AUDIENCES)[number];

export interface SummaryRequest {
  readonly context: AiRequestContext;
  /** Section ids and their text. **Never a raster** — enforced by the shape, not by remembering. */
  readonly report: ReportFactsWithoutRaster;
  readonly audience: SummaryAudience;
  readonly maxWords: number;
}

export interface ReportFactsWithoutRaster {
  readonly reportVersion: number;
  readonly verdict: string;
  readonly sections: readonly ReportSectionFacts[];
  readonly planRaster?: never;
}

export interface ReportSectionFacts {
  readonly sectionId: string;
  readonly title: string;
  readonly lines: readonly string[];
}
