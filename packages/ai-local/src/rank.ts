import type { RationaleCode, ScoreBreakdown, ScoringModel } from '@mfd/ai-contract';

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
  /** Language-independent codes. Prose is composed per language, as findings are. */
  readonly explanation: readonly ExplanationItem[];
}

export interface ExplanationItem {
  readonly code: RationaleCode;
  readonly params: Readonly<Record<string, string | number>>;
}

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
      placements: [...input.existing, ...entry.placements],
      catalog: input.catalog,
      ruleSet: input.ruleSet,
      boundaries: input.boundaries,
      room: input.room,
      obstructions: input.obstructions,
      referencePoints: input.referencePoints,
      object: input.object,
      planStatus: input.planStatus,
      pitchPadding: input.pitchPadding,
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

  const weakest = [...score.criteria]
    .filter((entry) => !entry.measuredOnly && entry.weight > 0)
    .sort((a, b) => a.normalised - b.normalised)[0];

  if (weakest) {
    items.push({
      code: 'AR-401',
      params: { gained: candidate.strategy, lost: weakest.criterion },
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
