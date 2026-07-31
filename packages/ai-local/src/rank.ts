import type {
  RationaleCode,
  RationaleParams,
  ScoreBreakdown,
  ScoringModel,
} from '@mfd/ai-contract';
import { CRITERION_LABELS } from '@mfd/ai-contract';
import type { Bilingual } from '@mfd/rule-engine';

import type { Candidate } from './candidates';
import { type PipelineInput, type PipelineResult, generateFeasibleCandidates } from './generate';
import { scoreLayout } from './score';
import type { Placement } from '@mfd/document-model';

/**
 * Ranking, and the shape of the answer.
 *
 * > Owner decision, Step 3 § 4: *"Return multiple ranked alternatives. Do not return only one
 * > solution. Minimum: top 3 candidate layouts. Each candidate must include total score,
 * > coverage %, per criterion breakdown, failed / excluded criteria, engineering explanation."*
 *
 * All five are fields on {@link RankedLayout} rather than things a caller assembles, so a renderer
 * cannot show a total without the rest — the same enforcement the contract's schema applies one
 * level down.
 */

export interface RankedLayout {
  readonly rank: number;
  readonly candidateId: string;
  readonly placements: readonly Placement[];
  readonly score: ScoreBreakdown;
  /**
   * What the rule engine says about this layout, separately from what it scores.
   *
   * Every ranked layout passed Gate 2, so `violations` is 0 by construction — and it is reported
   * anyway, because "compliant" and "nothing was checked" look identical on a screen that only
   * shows a score. A layout with no violations and eleven unevaluable findings has established
   * very little, and an engineer deciding whether to build it needs to know which they have.
   */
  readonly compliance: ComplianceSummary;
  /** Language-independent codes. Prose is composed per language, as findings are. */
  readonly explanation: readonly ExplanationItem[];
}

export interface ComplianceSummary {
  /** Always 0 for a ranked layout: a violation is a Gate 2 rejection, not a low score. */
  readonly violations: number;
  /** Findings needing review — overwhelmingly missing data on this product today. */
  readonly review: number;
  /** Findings the rule set could not evaluate at all (`RC-9xx`). */
  readonly unevaluable: number;
}

export interface ExplanationItem {
  readonly code: RationaleCode;
  readonly params: RationaleParams;
}

/** How an arrangement was laid out, in both languages, for `AR-104`. */
const STRATEGY_WORDS: Readonly<Record<Candidate['strategy'], Bilingual>> = {
  rows: { ko: '행 배열', en: 'in rows' },
  columns: { ko: '열 배열', en: 'in columns' },
  perimeter: { ko: '벽면 배열', en: 'around the perimeter' },
};

export interface RankInput extends PipelineInput {
  readonly scoring: ScoringModel;
  /** How many to return. The owner's floor is three; fewer only when fewer are feasible. */
  readonly limit?: number;
}

export interface RankResult {
  readonly resolvedStationCount: number;
  readonly countWasDerived: boolean;
  readonly layouts: readonly RankedLayout[];
  /** Why the discarded ones were discarded — the answer to "why can't I have twelve?". */
  readonly rejected: PipelineResult['rejected'];
}

const DEFAULT_LIMIT = 3;

export function rankLayouts(input: RankInput): RankResult {
  const pipeline = generateFeasibleCandidates(input);

  const scored = pipeline.feasible.map((entry) => ({
    entry,
    score: scoreLayout({
      /*
       * The candidate's own placements, and not `[...input.existing, ...entry.placements]`.
       *
       * > Owner decision, following the standing review: the **gates** judge the whole scene; the
       * > **score** measures only the equipment it was written for.
       *
       * They are different questions. A gate asks whether the drawing is acceptable, and everything
       * on it counts. A criterion asks how good an arrangement of *this* equipment is, and it has
       * one object to measure against: `input.object`. Handing it another kind made
       * `maintenance_access` apply this machine's service clearance to a nurse station,
       * `installation_feasibility` size a crate from this machine's planning footprint, and the
       * routing criteria run an RO line to whatever was nearest. It also made the `station_count`
       * constraint report `existing.length + candidate.length` against a target of the candidate's
       * count — a number that is simply wrong, in a field whose whole purpose is traceability.
       *
       * Comparability is preserved because the incumbent is scored the same way (optimise.ts): both
       * sides exclude `existing`, so the two totals still measure the same thing.
       */
      placements: entry.placements,
      // What is in the way: this candidate *and* everything already on the drawing. The measured
      // population narrows to one kind; the geometry does not — see `MeasureInput.occupants`.
      occupants: [...input.existing, ...entry.placements],
      catalog: input.catalog,
      ruleSet: input.ruleSet,
      boundaries: input.boundaries,
      room: input.room,
      obstructions: input.obstructions,
      referencePoints: input.referencePoints,
      object: input.object,
      planStatus: input.planStatus,
      pitchPadding: input.pitchPadding,
    knowledge: input.knowledge,
      scoring: input.scoring,
      stationTarget: input.stationTarget,
    }),
  }));

  scored.sort((a, b) => compare(a, b));

  const limit = input.limit ?? DEFAULT_LIMIT;
  const layouts = scored.slice(0, limit).map((item, index) => ({
    rank: index + 1,
    candidateId: item.entry.candidate.id,
    placements: item.entry.placements,
    score: item.score,
    compliance: {
      violations: 0,
      review: item.entry.gates.reviewCount,
      unevaluable: item.entry.gates.unevaluableCount,
    },
    explanation: explain(item.entry.candidate, item.score, pipeline),
  }));

  return {
    resolvedStationCount: pipeline.resolvedStationCount,
    countWasDerived: pipeline.countWasDerived,
    layouts,
    rejected: pipeline.rejected,
  };
}

/**
 * A **total** order, in three steps.
 *
 * 1. Higher total wins.
 * 2. Ties break on **compliance margin** — if two layouts score the same, the safer one wins.
 *    That is a policy choice rather than an implementation detail, and it is what the owner's
 *    *"Rule Compliance always has the highest priority"* implies once the gate has done its work.
 * 3. Still tied: candidate id, lexicographically.
 *
 * Step 3 is not decoration. `Array.prototype.sort` is stable, so without it two equal-scoring
 * layouts would come back in *generation* order — reproducible today, and silently dependent on
 * something that has nothing to do with which layout is better. A solver that returns the same
 * three layouts in a different order has failed the determinism requirement as completely as one
 * that returns different layouts.
 */
function compare(
  a: { entry: { candidate: Candidate }; score: ScoreBreakdown },
  b: { entry: { candidate: Candidate }; score: ScoreBreakdown },
): number {
  if (b.score.total !== a.score.total) return b.score.total - a.score.total;

  const marginA = marginOf(a.score);
  const marginB = marginOf(b.score);
  if (marginB !== marginA) return marginB - marginA;

  const idA = a.entry.candidate.id;
  const idB = b.entry.candidate.id;
  return idA < idB ? -1 : idA > idB ? 1 : 0;
}

/** The compliance-margin contribution, or -1 when it could not be measured. */
function marginOf(score: ScoreBreakdown): number {
  const margin = score.criteria.find((entry) => entry.criterion === 'compliance_margin');
  // -1 rather than 0: a layout whose margin is *unmeasurable* must not tie-break ahead of one
  // measured at exactly zero headroom. The two are different statements.
  return margin?.normalised ?? -1;
}

/**
 * Why this layout, in codes.
 *
 * Codes rather than sentences, for the reason findings are: the report is bilingual, so a
 * justification cannot be an English string with a Korean one bolted on later. `AR-` codes live in
 * `@mfd/ai-contract` and each renders per language.
 */
function explain(
  candidate: Candidate,
  score: ScoreBreakdown,
  pipeline: PipelineResult,
): ExplanationItem[] {
  const items: ExplanationItem[] = [];

  items.push({
    code: 'AR-104',
    params: {
      strategy: STRATEGY_WORDS[candidate.strategy],
      count: candidate.positions.length,
    },
  });

  /*
   * The trade this arrangement made, as a pair of criteria.
   *
   * Both ends, and that is the correction: this used to report the *strategy* as what improved —
   * "this improves rows and worsens maintenance access" — which is not a sentence about a trade,
   * because a strategy is not a criterion and cannot be on the other side of one. The strategy is
   * now its own statement above, and AR-401 names the criterion that came out best against the one
   * that came out worst, which is the thing an engineer is being asked to accept.
   *
   * Weighted criteria only: `drain_routing` is measured at weight 0, so calling it the best or the
   * worst part of a layout would be reporting on something that did not affect the ranking.
   */
  const weighted = [...score.criteria]
    .filter((entry) => !entry.measuredOnly && entry.weight > 0)
    .sort((a, b) => a.normalised - b.normalised);
  const weakest = weighted[0];
  const strongest = weighted[weighted.length - 1];

  // Only a trade when the two ends are different criteria *and* actually differ. A layout whose
  // criteria all score alike made no trade, and saying it did would be inventing a justification.
  if (weakest && strongest && weakest.criterion !== strongest.criterion) {
    items.push({
      code: 'AR-401',
      params: {
        gained: CRITERION_LABELS[strongest.criterion],
        lost: CRITERION_LABELS[weakest.criterion],
      },
    });
  }

  if (score.unavailable.length > 0) {
    items.push({
      code: 'AR-402',
      params: {
        count: score.unavailable.length,
        coverage: Math.round(score.coverage * 100),
      },
    });
  }

  const violations = pipeline.rejected.filter((entry) => entry.rejection.code === 'GX-201');
  if (violations.length > 0) {
    items.push({ code: 'AR-301', params: { count: violations.length } });
  }

  const countRejects = pipeline.rejected.filter(
    (entry) => entry.rejection.code === 'GX-101' || entry.rejection.code === 'GX-102',
  );
  if (countRejects.length > 0) {
    items.push({
      code: 'AR-303',
      params: { count: countRejects.length, required: pipeline.resolvedStationCount },
    });
  }

  return items;
}
