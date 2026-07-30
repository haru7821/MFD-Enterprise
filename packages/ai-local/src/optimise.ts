import type { ProposedCommand, ScoreBreakdown, ScoringCriterion } from '@mfd/ai-contract';
import type { Placement } from '@mfd/document-model';

import { type RankInput, type RankedLayout, rankLayouts } from './rank';
import { scoreLayout } from './score';

/**
 * Layout optimisation.
 *
 * > Owner decision, Step 5:
 * > 1. *"`optimise_layout` must never create `placement.delete` operations. The requested station
 * >    count is immutable."*
 * > 2. *"A candidate layout must contain the requested number of placements before scoring. Empty
 * >    layouts are not valid optimization candidates."*
 * > 5. *"Find the best layout among feasible engineering layouts. Do not maximize mathematical
 * >    score without constraint filtering."*
 *
 * ## What makes this different from proposing a layout
 *
 * `rankLayouts` answers *"what would a good layout look like?"* on an empty room. This answers
 * *"is the arrangement I already have improvable?"*, and the difference is not cosmetic:
 *
 * | | Propose | Optimise |
 * | --- | --- | --- |
 * | Starting point | An empty room | **An engineer's decision** |
 * | Station count | The target, or as many as fit | **Immutable — the count already placed** |
 * | Commands | `placement.create` | `placement.move` / `.rotate` only |
 * | Answer when nothing is better | Three layouts | **"Nothing improves on this"** |
 *
 * The last row matters most. An optimiser that always returns something teaches an engineer that
 * its suggestions are noise; one that can say *"your layout is already the best of the arrangements
 * I can construct"* is worth reading when it does speak.
 *
 * ## Why `placement.delete` is impossible rather than merely forbidden
 *
 * Removing a machine improves nearly every criterion — clearance margin, maintenance access, every
 * routing distance, expansion room. It is the cheapest way for an optimiser to look effective, and
 * the resulting proposal is a layout with fewer stations than the hospital asked for.
 *
 * So the count is fixed by construction: candidates are generated at exactly the count already
 * placed, and the commands are produced by **assigning existing placements to new positions** —
 * a permutation, which has no room for a deletion to appear in. {@link assertNoDeletions} then
 * checks the output anyway, because a structural guarantee that nothing asserts is a guarantee
 * until somebody refactors it.
 */

export interface OptimiseInput extends Omit<RankInput, 'stationTarget'> {
  /**
   * The arrangement to improve. **Never empty**: optimising nothing is not a question.
   *
   * Its length is the station count, and that count is immutable — it is not read from
   * `stationTarget`, because a target is a request and this is a fact about what is on the drawing.
   */
  readonly current: readonly Placement[];
}

export interface OptimisationProposal {
  readonly rank: number;
  readonly candidateId: string;
  readonly placements: readonly Placement[];
  readonly score: ScoreBreakdown;
  /** `placement.move` and `.rotate` only. Never `.create`, never `.delete`. */
  readonly commands: readonly ProposedCommand[];
  /** What it gains and what it costs, per criterion, against the current layout. */
  readonly deltas: readonly CriterionDelta[];
  readonly explanation: RankedLayout['explanation'];
}

export interface CriterionDelta {
  readonly criterion: ScoringCriterion;
  readonly before: number;
  readonly after: number;
  /** `after - before`, on the normalised 0…1 scale so criteria are comparable. */
  readonly change: number;
}

export const OPTIMISATION_OUTCOMES = [
  'improved',
  'already_best',
  'no_feasible_candidate',
  'not_optimisable',
] as const;
export type OptimisationOutcome = (typeof OPTIMISATION_OUTCOMES)[number];

export interface OptimiseResult {
  readonly outcome: OptimisationOutcome;
  /** The layout as it stands, scored on the same model — so a comparison is like for like. */
  readonly current: ScoreBreakdown | null;
  readonly proposals: readonly OptimisationProposal[];
  readonly stationCount: number;
}

export function optimiseLayout(input: OptimiseInput): OptimiseResult {
  /*
   * Owner constraint 2, at the door. An empty arrangement is not a layout with a low score, it is
   * not a candidate at all — and letting one through would ask the scoring engine to rank the
   * emptiest possible room, which is the failure the whole constraint/criterion split exists to
   * prevent.
   */
  if (input.current.length === 0) {
    return { outcome: 'not_optimisable', current: null, proposals: [], stationCount: 0 };
  }

  const stationCount = input.current.length;

  const currentScore = scoreLayout({
    placements: input.current,
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
    stationTarget: stationCount,
  });

  /*
   * Owner constraint 5. Candidates come through `rankLayouts`, which runs both gates first — so
   * what is being maximised is a score **over feasible layouts**, never a score in the abstract.
   *
   * `existing: []` and not `input.current`: the machines being rearranged cannot also be
   * obstructions to themselves, or Gate 2 would reject every candidate for colliding with the
   * layout it is replacing.
   */
  const ranked = rankLayouts({
    ...input,
    existing: [],
    stationTarget: stationCount,
    limit: input.limit ?? 3,
  });

  if (ranked.layouts.length === 0) {
    return {
      outcome: 'no_feasible_candidate',
      current: currentScore,
      proposals: [],
      stationCount,
    };
  }

  const better = ranked.layouts.filter((layout) => layout.score.total > currentScore.total);

  if (better.length === 0) {
    /*
     * A real answer, and the one an optimiser is most tempted to avoid giving. Returning the
     * best-of-a-worse-bunch would make every run produce a suggestion, and an engineer who accepts
     * one of those has been talked into a worse layout by a tool that had nothing to offer.
     */
    return { outcome: 'already_best', current: currentScore, proposals: [], stationCount };
  }

  const proposals = better.map((layout, index) => {
    const commands = commandsFor(input.current, layout.placements);
    assertNoDeletions(commands);

    return {
      rank: index + 1,
      candidateId: layout.candidateId,
      placements: layout.placements,
      score: layout.score,
      commands,
      deltas: deltasBetween(currentScore, layout.score),
      explanation: layout.explanation,
    };
  });

  return { outcome: 'improved', current: currentScore, proposals, stationCount };
}

/**
 * Turn "these machines are here, they should be there" into moves.
 *
 * A **permutation**, assigned nearest-first: each existing placement keeps its id, its label and
 * its catalogue reference, and only its transform changes. So an accepted proposal reads as
 * *"station 4 moved 300 mm"* in the history rather than as a machine vanishing and a different one
 * appearing — which is what an engineer would see if this emitted delete-and-create pairs, and
 * would also lose every label they had typed.
 *
 * Deterministic by construction: candidates are considered in id order, and each takes the nearest
 * unclaimed target. A greedy assignment is not the minimum-total-distance one, and does not need to
 * be — it needs to be stable and to produce short, individually sensible moves.
 */
export function commandsFor(
  current: readonly Placement[],
  target: readonly Placement[],
): ProposedCommand[] {
  const ordered = [...current].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const unclaimed = [...target];
  const commands: ProposedCommand[] = [];

  for (const placement of ordered) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const [index, candidate] of unclaimed.entries()) {
      const distance =
        Math.abs(candidate.transform.position.x - placement.transform.position.x) +
        Math.abs(candidate.transform.position.y - placement.transform.position.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }

    const [claimed] = unclaimed.splice(bestIndex, 1);
    if (!claimed) continue;

    // A machine already in the right place needs no command. An optimisation that emitted a move
    // for every machine would show as twelve changes when it made two.
    if (bestDistance > 0) {
      commands.push({
        type: 'placement.move',
        payload: { placementId: placement.id, position: claimed.transform.position },
      });
    }
    if (claimed.transform.rotation !== placement.transform.rotation) {
      commands.push({
        type: 'placement.rotate',
        payload: { placementId: placement.id, rotation: claimed.transform.rotation },
      });
    }
  }

  return commands;
}

/**
 * Owner constraint 1, checked rather than assumed.
 *
 * `commandsFor` cannot produce a deletion — it walks a permutation and emits moves. This throws if
 * one ever appears anyway, because the constraint is about what reaches an engineer, and a
 * structural guarantee nothing asserts survives exactly until the next refactor.
 */
export function assertNoDeletions(commands: readonly ProposedCommand[]): void {
  const deletion = commands.find((command) => command.type === 'placement.delete');
  if (deletion) {
    throw new Error(
      'optimiseLayout produced a placement.delete: the requested station count is immutable, and ' +
        'removing a machine improves nearly every criterion — which makes it the cheapest way for ' +
        'an optimiser to look effective',
    );
  }
}

/** Per-criterion change, on the normalised scale so a pipe run and a fraction are comparable. */
function deltasBetween(before: ScoreBreakdown, after: ScoreBreakdown): CriterionDelta[] {
  const previous = new Map(before.criteria.map((entry) => [entry.criterion, entry.normalised]));

  return after.criteria
    .filter((entry) => previous.has(entry.criterion))
    .map((entry) => {
      const was = previous.get(entry.criterion) ?? 0;
      return {
        criterion: entry.criterion,
        before: was,
        after: entry.normalised,
        change: round(entry.normalised - was),
      };
    })
    // Biggest change first, either direction — an engineer wants to see what moved, and a trade is
    // as informative as a gain. Tie-broken on the criterion name for a total order.
    .sort((a, b) => {
      const magnitude = Math.abs(b.change) - Math.abs(a.change);
      if (magnitude !== 0) return magnitude;
      return a.criterion < b.criterion ? -1 : a.criterion > b.criterion ? 1 : 0;
    });
}

function round(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}
