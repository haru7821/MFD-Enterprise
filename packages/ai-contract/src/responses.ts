import type { Bilingual } from '@mfd/rule-engine';

import type { RefWithVersion } from './context';
import type { SourcedNumber, SourcedText } from './evidence';
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

/** A tool or a material a stage needs. Materials aggregate into the bill of materials. */
export interface PlanResource {
  /** Stable id from the sequence set, so the BOM can aggregate across stages. */
  readonly id: string;
  readonly title: Bilingual;
  /**
   * How many, sourced.
   *
   * Usually `calculated` — "one per machine, twelve machines" — and the inputs name both halves.
   * A quantity nobody can derive is `unknown`, which is a purchasable answer: it tells a buyer to
   * ask rather than letting them order the number a planner guessed.
   */
  readonly quantity: SourcedNumber;
}

export const PLAN_SERVICES = ['power', 'ro_water', 'drain'] as const;
export type PlanService = (typeof PLAN_SERVICES)[number];

/** One machine's connection to one service. */
export interface ConnectionRun {
  /**
   * The machine, by id.
   *
   * By id and **not by label**. A label copied in here is a second copy of a string an engineer can
   * edit, and the two would disagree the moment they renamed a station — the report and the panel
   * already resolve placement ids to labels, and one resolution is better than two strings.
   */
  readonly placementId: string;
  /**
   * Routed length from the service origin, avoiding obstructions. `unknown` when there is no
   * reference point to route from, or no route that avoids what is in the way.
   *
   * **A planning length, never a verified one.** It is measured off a drawing, and a drawing is not
   * a site survey — EV-5 is what stops it being printed as though a manual had said it.
   */
  readonly length: SourcedNumber;
  /** The connection fitting or rating, when the catalogue states one. Usually `unknown` today. */
  readonly requirement: SourcedText;
}

/**
 * The power / RO / drain connection plan, per the owner's § 3.
 *
 * One per service, always all three, even when a service has no origin marked. A plan that omitted
 * drain because nobody placed the point would read as a project with no drain requirement.
 */
export interface ConnectionPlan {
  readonly service: PlanService;
  /** The reference point everything routes from, or null when none is placed. */
  readonly originPointId: string | null;
  readonly runs: readonly ConnectionRun[];
  /** Summed run length, or `unknown` if any run is. A total over a subset is a misleading total. */
  readonly totalLength: SourcedNumber;
}

export const PLAN_RISK_ORIGINS = ['finding', 'data_gap', 'sequence_set', 'unroutable'] as const;
export type PlanRiskOrigin = (typeof PLAN_RISK_ORIGINS)[number];

/**
 * Something that could go wrong, and where the planner learned about it.
 *
 * No severity ranking. The rule engine already grades findings RED / YELLOW / GREEN, and a second
 * scale invented here would be a planner's opinion competing with a rule set's judgement — the
 * thing § C-3 of the architecture exists to prevent. A risk that came from a finding carries the
 * finding's ref, and the reader can look up what the rule engine said about it.
 */
export interface PlanRisk {
  readonly id: string;
  readonly origin: PlanRiskOrigin;
  /** A reason code, a stage id, or a catalogue field group. Language-independent. */
  readonly ref: string;
  readonly title: Bilingual;
  readonly detail: SourcedText;
  readonly stageId: string | null;
}

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
  readonly tools: readonly PlanResource[];
  readonly materials: readonly PlanResource[];
  readonly risks: readonly PlanRisk[];
  /**
   * How many people, and how long.
   *
   * ## AD-19, amended rather than abandoned
   *
   * These fields did not exist. `InstallationStage` declared `durationDays?: never`, and the
   * architecture said plainly that *"duration is not derivable from anything the project holds"*.
   * The owner's Sprint 6 § 3 requires **Required Manpower** and **Estimated Installation Duration**
   * as planner outputs, and their §§ 4–5 say how: cited or `unknown`, and labelled `calculated`
   * when computed.
   *
   * So the refusal moves rather than lifting. It was *"a duration is never stated"*; it is now
   * **"a duration is never invented"** — it is calculated from a rate in the sequence set, with the
   * rate id and the machine count named as its inputs, or it is `unknown`. No rate has been
   * supplied for dialysis, so every figure this ships with today is `unknown` — which is the same
   * answer as before, arrived at by a mechanism that can produce a real one when somebody supplies
   * the rate rather than by a type that forbids it forever.
   */
  readonly manpower: SourcedNumber;
  readonly duration: SourcedNumber;
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

/**
 * What the plan was made from — the owner's § 1, as evidence rather than as a promise.
 *
 * > *"AI Planner receives only validated layouts. Never plan directly from raw user drawings."*
 *
 * `PlanInput.evaluation` being required is what enforces that: a caller with an unevaluated drawing
 * cannot construct an input. This records *which* evaluation, so a plan found on somebody's desk
 * six months later can be checked against the layout it was made for rather than assumed current.
 */
export interface PlanProvenance {
  readonly levelId: string;
  readonly placementCount: number;
  readonly ruleSet: RefWithVersion;
  readonly evaluationVersion: number;
  readonly findingCounts: { readonly red: number; readonly yellow: number; readonly green: number };
  /** The optimisation the layout came from, when it came from one. Null for a hand-drawn layout. */
  readonly optimisation: {
    readonly candidateId: string;
    readonly scoringModel: RefWithVersion;
    readonly total: number;
    readonly coverage: number;
  } | null;
}

export interface InstallationPlan {
  readonly sequenceSet: RefWithVersion;
  readonly stages: readonly InstallationStage[];
  readonly blockers: readonly PlanBlocker[];
  /** All three services, always. See {@link ConnectionPlan}. */
  readonly connections: readonly ConnectionPlan[];
  /** The bill of materials: every stage's materials, aggregated by id. */
  readonly materials: readonly PlanResource[];
  readonly risks: readonly PlanRisk[];
  /** Peak crew across stages, and total duration. `unknown` unless every stage's figure is known. */
  readonly manpower: SourcedNumber;
  readonly duration: SourcedNumber;
  readonly provenance: PlanProvenance;
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
