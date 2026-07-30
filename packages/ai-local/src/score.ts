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
 *   renormalise      ÷ Σ weights that could be measured
 *      ↓
 *   total + coverage
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
      // Filled in below: the divisor is not known until every criterion has been measured.
      contribution: 0,
      measuredOnly: config.measuredOnly === true,
    });
  }

  /*
   * Renormalise by the weight that was actually available.
   *
   * Two layouts scored with different criteria available are **not comparable**, even though both
   * totals read 0…1 — which is exactly why `coverage` is carried beside the total rather than left
   * for a reader to infer.
   *
   * A zero divisor is possible and is not an error: it means nothing weighted could be measured.
   * With the approved model that is a level with no reference points *and* no thresholds, which is
   * every project this product has today. The total is 0 and the coverage is 0, and the two
   * together say "nothing was scored" rather than "this layout scored badly".
   */
  const divisor = availableWeight > 0 ? availableWeight : 1;
  const contributions = scores.map((score) => ({
    ...score,
    contribution: round(
      (score.normalised * (score.measuredOnly ? 0 : score.weight)) / divisor,
    ),
  }));

  const totalWeight = SCORING_CRITERIA.reduce(
    (sum, criterion) => sum + effectiveWeight(input.scoring.criteria[criterion]),
    0,
  );

  const constraints: ConstraintMeasurement[] = [
    {
      constraint: 'station_count',
      measured: stations,
      unit: 'count',
      target: input.stationTarget,
    },
  ];

  return {
    scoringModel: { id: input.scoring.id, version: input.scoring.version },
    total: round(contributions.reduce((sum, score) => sum + score.contribution, 0)),
    coverage: totalWeight > 0 ? round(availableWeight / totalWeight) : 0,
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
