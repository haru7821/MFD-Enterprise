import type { PlacementSummary } from '@mfd/ai-contract';
import type { Catalog } from '@mfd/object-library';
import type { RuleSet } from '@mfd/rule-engine';
import type { Boundary, Placement } from '@mfd/document-model';
import { evaluate } from '@mfd/rule-engine';

/**
 * The two hard gates, applied **before** anything is scored.
 *
 * > Owner decision, Step 3: *"Gate 1: Requested station count — a candidate layout must contain
 * > exactly the requested number of dialysis stations. The solver shall not add or remove stations
 * > automatically. Gate 2: Rule Compliance — any candidate violating mandatory engineering rules
 * > shall be removed before scoring. Rule violations shall never be compensated by optimization
 * > scores."*
 *
 * ## Why these are gates and not heavily-weighted criteria
 *
 * A weighted sum is a mechanism for **trading things off**. Anything inside it can be outvoted by
 * the rest of it, however large its weight: 40 % is still a minority. So a requirement that must
 * never be traded cannot be expressed as a weight at all — it has to be a filter that runs first,
 * over a candidate set the scoring engine never sees the rejects of.
 *
 * The two gates fail in opposite directions and both matter:
 *
 * | Gate | Rejects | The failure it prevents |
 * | --- | --- | --- |
 * | 1 · station count | Too few **and too many** | A solver that "improves" a score by dropping a machine, or quietly adds one nobody asked for |
 * | 2 · compliance | Any mandatory violation | A layout that buys a clearance breach with a shorter pipe run |
 *
 * Gate 1 rejecting *too many* is the half that is easy to leave out. Every scored criterion
 * improves as machines are removed, so a solver told to maximise a total will shed stations if it
 * can; but adding one unasked is the mirror failure and produces a layout an engineer did not
 * request and may not have space to commission.
 */

/** Why a candidate was rejected. Language-independent, so the panel and the report agree. */
export const REJECTION_CODES = {
  'GX-101': 'station count below the requested number',
  'GX-102': 'station count above the requested number',
  'GX-201': 'violates a mandatory engineering rule',
} as const;
export type RejectionCode = keyof typeof REJECTION_CODES;

export interface Rejection {
  readonly code: RejectionCode;
  /** The rule that failed, or the counts that did. Enough to explain without re-deriving. */
  readonly detail: {
    readonly ruleId?: string;
    readonly reasonCode?: string;
    readonly expected?: number;
    readonly actual?: number;
    /**
     * Which placements the finding is about — one for a clearance, two for a collision.
     *
     * Carried because a rejection an engineer is asked to *act on* has to say which machines.
     * "Violates a mandatory engineering rule" is enough for a solver discarding a candidate and
     * useless to a person looking at a drawing with ten machines on it.
     */
    readonly placementIds?: readonly string[];
  };
}

/**
 * The same problem, reported once.
 *
 * The rule engine anchors a collision on **both** machines — `[a, b]` and `[b, a]`, so the panel
 * can highlight either — which is right for a findings list and wrong for a list of things to fix:
 * one collision between two machines is one problem, and printing it twice inflates the count an
 * engineer is being asked to work through.
 *
 * Keyed on the *unordered* set of placements, so the two anchorings of one collision collapse and
 * two genuinely separate collisions do not.
 */
export function distinctViolations(violations: readonly Rejection[]): readonly Rejection[] {
  const seen = new Set<string>();
  const distinct: Rejection[] = [];

  for (const violation of violations) {
    const placements = [...(violation.detail.placementIds ?? [])].sort().join('+');
    const key = `${violation.code}|${violation.detail.ruleId ?? ''}|${violation.detail.reasonCode ?? ''}|${placements}`;
    if (seen.has(key)) continue;
    seen.add(key);
    distinct.push(violation);
  }

  return distinct;
}

export interface GateInput {
  readonly placements: readonly Placement[];
  readonly catalog: Catalog;
  readonly ruleSet: RuleSet;
  readonly boundaries: readonly Boundary[];
  /**
   * Levels with an imported-but-uncalibrated drawing downgrade every GREEN to YELLOW.
   *
   * Passed through rather than assumed, because it changes what "compliant" means: on an
   * uncalibrated level nothing can be GREEN, and a gate that required GREEN would reject every
   * candidate on such a level. Gate 2 rejects **violations**, which is a different question.
   */
  readonly planStatus: 'none' | 'calibrated' | 'uncalibrated';
}

/**
 * Gate 1 — exactly the requested number of stations.
 *
 * `requested` is resolved by the caller before this runs: an explicit target, or the maximum the
 * room turned out to hold when the engineer asked for "as many as fit". Either way it is a
 * **number** here, because "exactly N" is not a statement you can make about null.
 */
export function passesStationCountGate(
  stationCount: number,
  requested: number,
): Rejection | null {
  if (stationCount === requested) return null;
  return {
    code: stationCount < requested ? 'GX-101' : 'GX-102',
    detail: { expected: requested, actual: stationCount },
  };
}

export interface GateOutcome {
  /**
   * Every mandatory violation, in the order the rule engine reported them. Empty means the gates
   * passed.
   *
   * **All of them, not the first.** A candidate is dead at the first one and the solver reads no
   * further — but the same gates are also asked about the layout an engineer has *drawn*
   * ({@link optimiseLayout}), and there the list is the work: they have to fix every one before
   * optimisation is available to them, and being told about them one run at a time is a worse
   * version of the same conversation held four times.
   */
  readonly violations: readonly Rejection[];
  /**
   * Findings that survived, so a caller can say what was *not* checked.
   *
   * A candidate with no RED and eleven YELLOWs has passed the gate and had almost nothing
   * verified. Carrying the count is what lets the proposal say so instead of reading as cleared.
   */
  readonly unevaluableCount: number;
  readonly reviewCount: number;
}

/**
 * Both gates, in the owner's order: count first, then compliance.
 *
 * ## Gate 2 — what counts as a violation, and what does not
 *
 * A **RED** result is a violation: the rule set says this layout is not acceptable.
 *
 * A **YELLOW** is not. Yellow means "review required", and on this product it is overwhelmingly
 * produced by *missing data* rather than by a breach — every clearance finding reads YELLOW today
 * because the AK98 manual has not been supplied (A-1), and every result on an uncalibrated level
 * is downgraded to YELLOW whatever it was. A gate that rejected YELLOW would reject **every**
 * candidate on the projects this product currently has, and report "no layout satisfies the rules"
 * when it means "no threshold has been supplied to check against".
 *
 * That distinction is the whole reason this reads `level === 'RED'` and not `level !== 'GREEN'`.
 * It is also why the caller is told how many YELLOWs survived: a proposal built entirely from
 * unevaluable rules is a proposal whose compliance nobody has actually checked, and the panel says
 * so rather than presenting it as cleared.
 *
 * ## Gate 1 cannot fire on a layout that is already on the drawing
 *
 * `optimiseLayout` passes the drawn station count as **both** `stationCount` and `requested`, so
 * the count gate is structurally satisfied there — the count is not a request on that path, it is a
 * fact read off the drawing, and the owner's first Step 5 constraint makes it immutable. Gate 1 is
 * live only for generated candidates, which is the population it was written for.
 */
export function applyGates(
  input: GateInput,
  stationCount: number,
  requested: number,
): GateOutcome {
  const countRejection = passesStationCountGate(stationCount, requested);
  if (countRejection) {
    // Short-circuit: evaluating rules for a candidate that already fails Gate 1 is work whose
    // answer cannot change the outcome, and the solver runs this thousands of times.
    return { violations: [countRejection], unevaluableCount: 0, reviewCount: 0 };
  }

  const report = evaluate({
    placements: input.placements,
    catalog: input.catalog,
    ruleSet: input.ruleSet,
    spatial: { boundaries: input.boundaries, planStatus: input.planStatus },
  });

  return {
    violations: report.results
      .filter((result) => result.level === 'RED')
      .map((result) => ({
        code: 'GX-201' as const,
        detail: {
          ruleId: result.ruleId,
          reasonCode: result.reasonCode,
          placementIds: result.placementIds,
        },
      })),
    unevaluableCount: report.results.filter((result) => result.reasonCode.startsWith('RC-9'))
      .length,
    reviewCount: report.results.filter((result) => result.level === 'YELLOW').length,
  };
}

/** Station-class placements in a candidate, by catalogue id. */
export function countStations(
  placements: readonly PlacementSummary[],
  equipmentObjectId: string,
): number {
  return placements.filter((placement) => placement.equipmentObjectId === equipmentObjectId).length;
}
