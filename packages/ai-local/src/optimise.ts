import type { ProposedCommand, ScoreBreakdown, ScoringCriterion } from '@mfd/ai-contract';
import type { Placement } from '@mfd/document-model';

import { type Rejection, applyGates, distinctViolations } from './gates';
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
  /**
   * The engineer's explicit permission for existing machines to move.
   *
   * > Owner decision, Step 6B: *"Existing placements are immutable unless the engineer explicitly
   * > allows movement."*
   *
   * Optimisation *is* moving existing machines — that is the whole operation — so this is not a
   * mode, it is a precondition. Structural rather than a disabled button: a UI can forget to
   * disable something, and `optimiseLayout` returning `movement_not_permitted` cannot.
   */
  readonly allowMovingExisting: boolean;
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
  /** What the rule engine established about it, separately from what the model scored. */
  readonly compliance: RankedLayout['compliance'];
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
  'movement_not_permitted',
  /**
   * The layout on the drawing breaks a mandatory rule. Nothing is proposed and nothing is scored.
   *
   * > Owner decision, D1: *"When the current layout fails a gate, do NOT generate an optimized
   * > recommendation. Return an explicit blocked state: no ranked proposals, no baseline
   * > comparison, no 'best candidate'. Display blocking rule violations first. Optimisation is
   * > available only after the current layout satisfies all mandatory gates."*
   */
  'blocked',
] as const;
export type OptimisationOutcome = (typeof OPTIMISATION_OUTCOMES)[number];

export interface OptimiseResult {
  readonly outcome: OptimisationOutcome;
  /**
   * The layout as it stands, scored on the same model — so a comparison is like for like.
   *
   * **Null when `outcome` is `blocked`**, and that is the point of D1 rather than an omission: a
   * layout that breaks a mandatory rule has no score worth showing, and putting one on screen
   * invites the comparison the decision exists to prevent.
   */
  readonly current: ScoreBreakdown | null;
  readonly proposals: readonly OptimisationProposal[];
  readonly stationCount: number;
  /**
   * The mandatory rules the drawn layout breaks. Empty unless `outcome` is `blocked`.
   *
   * Every one of them, because they are all the engineer's work before optimisation is available
   * to them again.
   */
  readonly blocking: readonly Rejection[];
}

export function optimiseLayout(input: OptimiseInput): OptimiseResult {
  /*
   * Owner constraint 2, at the door. An empty arrangement is not a layout with a low score, it is
   * not a candidate at all — and letting one through would ask the scoring engine to rank the
   * emptiest possible room, which is the failure the whole constraint/criterion split exists to
   * prevent.
   */
  if (input.current.length === 0) {
    return {
      outcome: 'not_optimisable',
      current: null,
      proposals: [],
      stationCount: 0,
      blocking: [],
    };
  }

  const stationCount = input.current.length;

  /*
   * Owner constraint, Step 6B. Checked before any work is done, so an engineer who has not opted in
   * cannot even be shown a proposal to be tempted by.
   */
  if (!input.allowMovingExisting) {
    return {
      outcome: 'movement_not_permitted',
      current: null,
      proposals: [],
      stationCount,
      blocking: [],
    };
  }

  /*
   * Owner decision D1, and the reason it is here rather than further down.
   *
   * Candidates have always gone through both gates — `rankLayouts` sees only layouts that pass
   * them. The layout on the *drawing* did not. It was scored directly and used as the number every
   * proposal had to beat, so a layout breaking a mandatory rule could score 0.94 and suppress
   * candidates that broke none: the optimiser reported "nothing improves on what you have drawn"
   * about an arrangement the rule engine had already called unacceptable.
   *
   * That is a comparison between a filtered set and an unfiltered incumbent, and no ordering of it
   * is meaningful. So there is no ordering: the run stops, and what comes back is the list of rules
   * to fix.
   *
   * Gated on `input.current` alone, and not on `input.existing` too, because that is exactly the
   * population `rankLayouts` gates its candidates on (`existing: []`, below). Judging the incumbent
   * against a wider one would block it for violations no candidate is ever checked for.
   */
  const gates = applyGates(
    {
      placements: input.current,
      catalog: input.catalog,
      ruleSet: input.ruleSet,
      boundaries: input.boundaries,
      planStatus: input.planStatus,
    },
    stationCount,
    stationCount,
  );

  if (gates.violations.length > 0) {
    return {
      outcome: 'blocked',
      current: null,
      proposals: [],
      stationCount,
      // Deduplicated, because this list is a list of things to fix rather than a findings list —
      // see `distinctViolations`. One collision between two machines is one problem.
      blocking: distinctViolations(gates.violations),
    };
  }

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
    knowledge: input.knowledge,
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
      blocking: [],
    };
  }

  const better = ranked.layouts.filter((layout) => layout.score.total > currentScore.total);

  if (better.length === 0) {
    /*
     * A real answer, and the one an optimiser is most tempted to avoid giving. Returning the
     * best-of-a-worse-bunch would make every run produce a suggestion, and an engineer who accepts
     * one of those has been talked into a worse layout by a tool that had nothing to offer.
     */
    return {
      outcome: 'already_best',
      current: currentScore,
      proposals: [],
      stationCount,
      blocking: [],
    };
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
      compliance: layout.compliance,
      explanation: layout.explanation,
    };
  });

  return { outcome: 'improved', current: currentScore, proposals, stationCount, blocking: [] };
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
  const commands: ProposedCommand[] = [];

  for (const { source, target: claimed, distance } of assignNearest(current, target)) {
    // A machine already in the right place needs no command. An optimisation that emitted a move
    // for every machine would show as twelve changes when it made two.
    if (distance > 0) {
      commands.push({
        type: 'placement.move',
        payload: { placementId: source.id, position: claimed.transform.position },
      });
    }
    if (claimed.transform.rotation !== source.transform.rotation) {
      commands.push({
        type: 'placement.rotate',
        payload: { placementId: source.id, rotation: claimed.transform.rotation },
      });
    }
  }

  return commands;
}

interface Assignment {
  /** Where a machine is now. */
  readonly source: Placement;
  /** Where the proposal would put it. */
  readonly target: Placement;
  /** Its index in the proposal, so a caller can report in proposal order. */
  readonly targetIndex: number;
  /** Manhattan distance between the two, in mm. Zero means it does not move. */
  readonly distance: number;
}

/**
 * Which existing machine becomes which proposed one.
 *
 * The single answer to that question, shared by {@link commandsFor} and {@link diffPlacements}.
 * They used to walk it separately — and in opposite directions, existing→proposed against
 * proposed→existing, which a greedy assignment does not promise to answer the same way. The
 * highlight and the commands disagreeing about which machine went where is the one thing neither
 * is allowed to do, so there is now only one walk to disagree with.
 *
 * Deterministic: existing placements are considered in id order and each takes the nearest
 * unclaimed target. Greedy, not minimum-total-distance, and deliberately so — it needs to be
 * stable and to produce short, individually sensible moves, not to solve an assignment problem.
 */
function assignNearest(
  current: readonly Placement[],
  target: readonly Placement[],
): Assignment[] {
  const ordered = [...current].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const unclaimed = target.map((placement, index) => ({ placement, index }));
  const assignments: Assignment[] = [];

  for (const source of ordered) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const [index, candidate] of unclaimed.entries()) {
      const distance =
        Math.abs(candidate.placement.transform.position.x - source.transform.position.x) +
        Math.abs(candidate.placement.transform.position.y - source.transform.position.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }

    const [claimed] = unclaimed.splice(bestIndex, 1);
    if (!claimed) break;

    assignments.push({
      source,
      target: claimed.placement,
      targetIndex: claimed.index,
      distance: bestDistance,
    });
  }

  return assignments;
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


/**
 * What changes if a proposal is applied, per machine.
 *
 * > Owner decision, Step 6B: *"Highlight added, moved and unchanged placements before Apply."*
 *
 * A ghosted layout shows where machines *would* be; it does not show which of them are actually
 * changing. On a twelve-station room where an optimisation moves two, an engineer looking at twelve
 * ghosts has to work out which two by eye — and approving a change you have not located is not much
 * of an approval.
 *
 * Computed from the same nearest-first assignment `commandsFor` uses, so the highlight and the
 * commands cannot disagree about which machine went where.
 */
export const PLACEMENT_CHANGES = ['added', 'moved', 'unchanged'] as const;
export type PlacementChange = (typeof PLACEMENT_CHANGES)[number];

export interface PlacementDiffEntry {
  /** The proposed placement. */
  readonly placement: Placement;
  readonly change: PlacementChange;
  /**
   * The machine on the drawing that becomes this one. Null for `added`.
   *
   * The whole placement rather than just its position, because this is what a caller needs to turn
   * the diff into commands: a move names an **existing id**, and an id is the one thing a position
   * cannot be turned back into. So the highlight and the edit are read off the same assignment
   * instead of each deriving their own — see {@link assignNearest}.
   */
  readonly source: Placement | null;
}

export function diffPlacements(
  current: readonly Placement[],
  proposed: readonly Placement[],
): PlacementDiffEntry[] {
  /*
   * `added` covers generation, where there is nothing to move from; `moved` and `unchanged` cover
   * optimisation, where the count is immutable. One function for both, because the panel and the
   * canvas should not need to know which operation produced the proposal they are showing.
   */
  const byTarget = new Map(
    assignNearest(current, proposed).map((assignment) => [assignment.targetIndex, assignment]),
  );

  return proposed.map((placement, index) => {
    const assignment = byTarget.get(index);
    // Nothing was assigned to it, so nothing is moving into it: a machine that was not there before.
    if (!assignment) return { placement, change: 'added', source: null };

    return {
      placement,
      change: assignment.distance === 0 ? 'unchanged' : 'moved',
      source: assignment.source,
    };
  });
}
