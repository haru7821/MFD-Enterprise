import type { Bilingual } from '@mfd/rule-engine';

import type { RefWithVersion } from './context';
import type { KnowledgeCorpus } from './requests';
import type { RationaleCode } from './rationale';
import type { ScoreBreakdown } from './scoring';

/** What the AI may return. See docs/architecture/AI_SERVICE_API.md § C. */

export const PROPOSAL_KINDS = ['placement', 'layout', 'adjustment'] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

/**
 * Where a proposal came from, so a heuristic guess cannot read like a solver result.
 */
export const PROPOSAL_SOURCES = ['solver', 'model'] as const;
export type ProposalSource = (typeof PROPOSAL_SOURCES)[number];

export const PROPOSAL_CONFIDENCES = ['deterministic', 'heuristic', 'suggestion'] as const;
export type ProposalConfidence = (typeof PROPOSAL_CONFIDENCES)[number];

/**
 * A command the editor already knows how to apply.
 *
 * Named from `CommandType` in `@mfd/document-model` — the same vocabulary a mouse gesture uses. So
 * an accepted proposal is undoable, appears in the history with a label, and **cannot express
 * anything a hand could not**.
 *
 * `placement.delete` is in the union because a `resolve_finding` proposal may legitimately offer to
 * remove a machine that cannot be placed anywhere. It is *forbidden* to `optimise` proposals, and
 * that is checked at validation rather than left to the type: removal improves nearly every
 * criterion, which makes it the cheapest way for an optimiser to look effective.
 */
export const PROPOSED_COMMAND_TYPES = [
  'placement.create',
  'placement.move',
  'placement.rotate',
  'placement.delete',
] as const;
export type ProposedCommandType = (typeof PROPOSED_COMMAND_TYPES)[number];

export interface ProposedCommand {
  readonly type: ProposedCommandType;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface RationaleItem {
  readonly code: RationaleCode;
  readonly params: Readonly<Record<string, string | number>>;
  /** The finding or rule this refers to, or null for a general statement. */
  readonly refersTo: string | null;
}

export interface SeverityCounts {
  readonly RED: number;
  readonly YELLOW: number;
  readonly GREEN: number;
}

/**
 * What the document would look like if the proposal were applied.
 *
 * **Computed by the editor, not by the service.** The client applies the commands to a copy, runs
 * `evaluate()`, and fills this in before showing anything. A service-supplied evaluation would be a
 * claim about the rule engine made by something that is not the rule engine.
 */
export interface ProposalEvaluation {
  readonly before: SeverityCounts;
  readonly after: SeverityCounts;
  /**
   * What it clears, and what it breaks. **Both, always, and never omitted when empty.**
   *
   * A proposal that lists what it fixes and not what it breaks is the single most misleading thing
   * this feature could produce, and an absent field and an empty one must not look the same.
   */
  readonly resolves: readonly string[];
  readonly introduces: readonly string[];
  readonly score: ScoreBreakdown;
}

export interface AiProposal {
  readonly id: string;
  readonly kind: ProposalKind;
  readonly source: ProposalSource;
  readonly confidence: ProposalConfidence;
  readonly rationale: readonly RationaleItem[];
  readonly commands: readonly ProposedCommand[];
  readonly evaluation: ProposalEvaluation;
}

/* ------------------------------------------------------------------ installation plan */

export interface InstallationStage {
  readonly id: string;
  readonly order: number;
  readonly title: Bilingual;
  /** Stage ids that must complete first. Derived from the standards data, never invented. */
  readonly dependsOn: readonly string[];
  readonly placementIds: readonly string[];
  /**
   * Commissioning items, by **the report engine's own checklist ids**.
   *
   * The planner references rather than authors. A planner with its own commissioning text would
   * give an engineer two lists that can disagree, and the one they followed on site would be the
   * one that is not in the signed report.
   */
  readonly checklistItemIds: readonly string[];
  /**
   * Declared, and always absent.
   *
   * Duration is not ours to state (AD-19), and `?: never` makes that a contract a reviewer can see
   * rather than a decision to be re-argued the next time somebody wants a Gantt chart.
   */
  readonly durationDays?: never;
}

export const PLAN_BLOCKER_KINDS = [
  'open_violation',
  'missing_reference_point',
  'missing_prerequisite',
  'uncalibrated_level',
] as const;
export type PlanBlockerKind = (typeof PLAN_BLOCKER_KINDS)[number];

export interface PlanBlocker {
  readonly kind: PlanBlockerKind;
  /** `RC-` for a finding, a stage id, or a reference-point kind. Language-independent. */
  readonly ref: string;
  readonly stageId: string | null;
}

export interface InstallationPlan {
  readonly sequenceSet: RefWithVersion;
  readonly stages: readonly InstallationStage[];
  readonly blockers: readonly PlanBlocker[];
}

/* ------------------------------------------------------------------ language */

export const CITATION_KINDS = ['rule', 'finding', 'catalogue_field', 'document', 'passage'] as const;
export type CitationKind = (typeof CITATION_KINDS)[number];

export interface Citation {
  readonly kind: CitationKind;
  /**
   * A rule id, a reason code, `vantive_ak98.serviceClearance`, or a `[Pn]` passage label.
   *
   * Every one must resolve to something the request supplied **or to a passage in this response's
   * own `retrieved` array**. A model recalling a real section number it did not read is precisely
   * the case retrieval-first exists to remove.
   */
  readonly ref: string;
  /** Where in the text the claim sits, so the interface can mark it. */
  readonly span: TextSpan | null;
}

export interface TextSpan {
  readonly start: number;
  readonly end: number;
}

export interface SourceLocation {
  readonly document: string;
  readonly revision: string | null;
  readonly section: string | null;
  readonly page: number | null;
}

export interface RetrievedPassage {
  readonly id: string;
  readonly corpus: KnowledgeCorpus;
  /** The text **as indexed**: quoted, never paraphrased into the index. */
  readonly text: string;
  readonly source: SourceLocation;
  /** Retrieval score, for ranking and for a floor below which nothing is returned. */
  readonly relevance: number;
}

export interface RetrievalResult {
  readonly query: string;
  readonly passages: readonly RetrievedPassage[];
  /**
   * True when the corpus holds nothing relevant — **the outcome that ends the request.**
   *
   * No passages means no model call and no answer, only "not in the indexed corpus". A model asked
   * to fill that gap from memory is the exact failure AD-16 forbids.
   */
  readonly empty: boolean;
  /** Corpora actually searched, so an answer cannot imply coverage the index does not have. */
  readonly searched: readonly KnowledgeCorpus[];
}

export interface AiExplanation {
  readonly subject: string;
  readonly text: Bilingual;
  readonly citations: readonly Citation[];
  /**
   * The passages stage ① returned. **Required, and empty means the model was never called.**
   *
   * Carried on the response rather than kept service-side so the editor can show *what was read*
   * beside what was written, and so retrieval-first is checkable by the client instead of being a
   * property the service asserts about itself (AD-16).
   */
  readonly retrieved: readonly RetrievedPassage[];
}

export interface AiAnswer {
  readonly text: Bilingual;
  readonly citations: readonly Citation[];
  /**
   * True when the question could not be answered from what it was given.
   *
   * The field that decides whether this feature is trustworthy. A model that answers everything is
   * a model that invents; this makes "I was not given enough to answer that" a first-class response
   * rather than a failure.
   */
  readonly insufficientGrounding: boolean;
  readonly retrieved: readonly RetrievedPassage[];
}

export interface AiSummary {
  readonly text: Bilingual;
  readonly citations: readonly Citation[];
  /**
   * Report sections the summary drew on.
   *
   * A summary that silently skipped the validation section is the failure mode that matters here,
   * so coverage is stated rather than assumed.
   */
  readonly coveredSections: readonly string[];
  readonly retrieved: readonly RetrievedPassage[];
}

/** Every response that a model contributed prose to. All four checks of § E apply to these. */
export type LanguageResponse = AiExplanation | AiAnswer | AiSummary;
