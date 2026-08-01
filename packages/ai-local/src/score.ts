import type {
  ConstraintMeasurement,
  CriterionScore,
  ScoreBreakdown,
  ScoringCriterion,
  ScoringModel,
  UnavailableCriterion,
} from '@mfd/ai-contract';
import { SCORING_CRITERIA, effectiveWeight, normaliseCriterion } from '@mfd/ai-contract';

import { type MeasureInput, measureAll } from './criteria';

/**
 * The arithmetic.
 *
 * ```
 *   measure          in the criterion's own unit — mm, a count, a fraction, a ratio
 *      ↓
 *   normalise        0…1, against the configured reference
 *      ↓
 *   weight           × the criterion's weight
 *      ↓
 *   divide           ÷ Σ weights of the **whole** model, measured or not
 *      ↓
 *   total + coverage — and no total at all below the model's minimumCoverage
 * ```
 *
 * Every step is reported. `CriterionScore` carries the measurement, the normalised value, the
 * weight and the contribution, so a reader can check the sum rather than take it — which is what
 * the owner's *"never display only a single total score"* requires in practice.
 */

/** How each criterion's measurement is labelled. Not derived from the reference — see below. */
const UNITS: Record<ScoringCriterion, string> = {
  compliance_margin: 'ratio',
  installation_feasibility: 'fraction',
  maintenance_access: 'fraction',
  ro_piping_length: 'mm',
  electrical_routing: 'mm',
  future_expansion: 'count',
  walking_distance: 'mm',
  drain_routing: 'mm',
};

/**
 * The reference key each criterion normalises against.
 *
 * A `Record` rather than "take the first key of `reference`", because that would make the meaning
 * of a data file depend on its key order — and a scoring model whose behaviour changes when
 * somebody reformats the JSON is not reproducible.
 */
const REFERENCE_KEYS: Record<ScoringCriterion, string> = {
  compliance_margin: 'marginRatioTarget',
  installation_feasibility: 'fractionTarget',
  maintenance_access: 'fractionTarget',
  ro_piping_length: 'perStation',
  electrical_routing: 'perStation',
  future_expansion: 'additionalStations',
  walking_distance: 'perStation',
  drain_routing: 'perStation',
};

/** Criteria whose reference is stated **per station**, so the target scales with the layout. */
const PER_STATION: ReadonlySet<ScoringCriterion> = new Set([
  'ro_piping_length',
  'electrical_routing',
  'walking_distance',
  'drain_routing',
]);

export interface ScoreInput extends MeasureInput {
  readonly scoring: ScoringModel;
  /** The count Gate 1 enforced, and the target it came from. Reported, never scored. */
  readonly stationTarget: number | null;
}

export function scoreLayout(input: ScoreInput): ScoreBreakdown {
  const measurements = measureAll(input);
  const stations = input.placements.length;

  const scores: CriterionScore[] = [];
  const missing: UnavailableCriterion[] = [];
  let availableWeight = 0;

  for (const criterion of SCORING_CRITERIA) {
    const config = input.scoring.criteria[criterion];
    const measurement = measurements[criterion];

    if (measurement.kind === 'unavailable') {
      missing.push({ criterion, reasonCode: measurement.reasonCode });
      continue;
    }

    const reference = referenceFor(input.scoring, criterion, stations);
    const normalised = normaliseCriterion(measurement.value, reference, config.direction);
    const weight = effectiveWeight(config);

    availableWeight += weight;
    scores.push({
      criterion,
      measured: measurement.value,
      unit: UNITS[criterion],
      normalised,
      weight: config.weight,
      // Filled in below, once the model's total weight is known.
      contribution: 0,
      measuredOnly: config.measuredOnly === true,
    });
  }

  const totalWeight = SCORING_CRITERIA.reduce(
    (sum, criterion) => sum + effectiveWeight(input.scoring.criteria[criterion]),
    0,
  );

  /*
   * **The divisor is the whole model, not the part of it that could be measured.**
   *
   * > Owner decision D1: *"Do NOT renormalize away unavailable criteria. If coverage is below the
   * > required threshold, suppress the total ranking. … Unknown must never become perfect."*
   *
   * This used to divide by `availableWeight`, and the effect was that **deleting evidence raised
   * the score**. Measured on identical placements with only the reference-point set varied:
   * coverage 0.40 gave 0.7208, coverage 0.25 gave 0.8983, and coverage 0.20 gave **1.0000** — a
   * perfect score for a layout about which almost nothing was known.
   *
   * It reached the ranking, and it rewarded layouts that could not be built. In a room with one
   * L-shaped obstruction the winner scored 0.8750 at coverage 0.6 with `SC-903` — *no route
   * exists* — on RO piping, electrical, walking distance and drain, beating a fully-measured
   * layout at 0.8615. Rank 1 was a layout you cannot run pipe, power, drain or a nurse to.
   * `routing.ts` already refuses to substitute zero for an unroutable distance because "it would
   * make an unroutable layout the best possible one"; renormalising was strictly worse than the
   * zero it refused.
   *
   * With a fixed divisor an unmeasured criterion contributes nothing, so a total can only be
   * *earned*. That makes totals comparable — but only down to a point, which is what
   * the scoring model's `minimumCoverage` and the null total below are for.
   */
  const contributions = scores.map((score) => ({
    ...score,
    contribution: round(
      (score.normalised * (score.measuredOnly ? 0 : score.weight)) / (totalWeight > 0 ? totalWeight : 1),
    ),
  }));

  const constraints: ConstraintMeasurement[] = [
    {
      constraint: 'station_count',
      measured: stations,
      unit: 'count',
      target: input.stationTarget,
    },
  ];

  const coverage = totalWeight > 0 ? round(availableWeight / totalWeight) : 0;

  return {
    scoringModel: { id: input.scoring.id, version: input.scoring.version },
    /*
     * Null below the floor — Owner decision D1's *"suppress the total ranking"*.
     *
     * Not zero, and not a small number: those are scores, and a reader compares scores. Null is the
     * panel and the report being unable to offer one, with `coverage`, `criteria` and `unavailable`
     * beside it saying exactly how much was measured and what was not.
     */
    total: coverage >= input.scoring.minimumCoverage
      ? round(contributions.reduce((sum, score) => sum + score.contribution, 0))
      : null,
    coverage,
    criteria: contributions,
    unavailable: missing,
    constraints,
  };
}

/**
 * The reference a measurement is normalised against.
 *
 * For a per-station criterion this scales with the layout: 8,000 mm of RO pipe *per station* means
 * a twelve-station room is compared against 96 m, not against 8 m. Without that, a bigger layout
 * would score worse on every routing criterion for the sole reason of being bigger — which would
 * reintroduce the emptiest-room bias through the back door, after all the work done to keep station
 * count out of the weighted sum.
 */
function referenceFor(
  scoring: ScoringModel,
  criterion: ScoringCriterion,
  stations: number,
): number {
  const key = REFERENCE_KEYS[criterion];
  const base = scoring.criteria[criterion].reference[key];
  if (base === undefined) {
    throw new Error(
      `scoring model "${scoring.id}" has no "${key}" reference for ${criterion}; a criterion ` +
        `cannot be normalised against a reference that is not there`,
    );
  }
  return PER_STATION.has(criterion) ? base * Math.max(1, stations) : base;
}

/** Nine decimal places: enough that a sum of eight contributions equals the total exactly. */
function round(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}
