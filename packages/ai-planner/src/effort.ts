import type { InstallationRate, SourcedNumber, SourcedRange } from '@mfd/ai-contract';
import { calculatedNumber, statedRange, unknownNumber, unknownRange } from '@mfd/ai-contract';

import type { SequenceSet, SequenceStage } from './sequenceSet';

/**
 * Manpower and duration — owner decision **B-7**.
 *
 * > *"Do not estimate manpower or installation duration. Every value must come from a referenced
 * > installation standard. Planning calculations may use only sourced installation rates … If any
 * > required rate is missing: Duration = Unknown, Manpower = Unknown. Never interpolate. Never
 * > estimate. Never infer. Unknown is always preferred over an unsupported value."*
 *
 * ```
 *   Duration = hoursFixed + (hoursPerStation × stationCount)
 *   Manpower = minimumPersons, recommendedPersons
 * ```
 *
 * ## There is no partial rate
 *
 * The earlier version of this file computed from whichever rate fields happened to be present — a
 * stage with only a per-station figure produced a duration as though its fixed overhead were zero.
 * B-7 closes that: `InstallationRate` requires all six fields at the schema, and a stage with no
 * rate gets `unknown` rather than an evaluation of half the formula. **Treating a missing component
 * as zero is interpolation**, and it is the specific thing the decision forbids.
 *
 * ## Every figure carries its whole arithmetic
 *
 * The owner's four disclosures — formula, input values, rate id, source citation — travel on the
 * figure itself as a {@link Calculation}, so a printed plan can be checked without opening a data
 * file. EV-6 makes the rate id and the citation stand or fall together, which is what stops a rate
 * being typed into the sequence file with nothing behind it.
 *
 * ## Totals refuse partial knowledge
 *
 * A duration summed over the stages that happened to have rates is smaller than the truth, looks
 * complete, and is the one somebody quotes. Any unknown part makes the total unknown, and the
 * per-stage rows show which.
 */

/** The rate for a stage, or null. Null is a complete answer, not a missing one. */
export function rateFor(set: SequenceSet, stageId: string): InstallationRate | null {
  return set.installationRates.find((rate) => rate.stage === stageId) ?? null;
}

/**
 * Whether every applicable stage has a rate.
 *
 * > Owner decision, B-7: *"The report must explicitly state 'Planning rate data not available.'
 * > instead of displaying calculated numbers."*
 *
 * **Every stage, not some.** A plan with rates for four stages of eight can state no total, so
 * printing four figures and three blanks would be a document a reader has to reconcile themselves.
 * One flag, one sentence, and the per-stage rows still show what is known.
 */
export function ratesAvailableFor(
  set: SequenceSet,
  stages: readonly SequenceStage[],
): boolean {
  return stages.length > 0 && stages.every((stage) => rateFor(set, stage.id) !== null);
}

/**
 * One stage's crew, read straight from its rate.
 *
 * Read, never derived: B-7 defines manpower as the rate's own two figures, so there is no
 * arithmetic and `SourcedRange` has nowhere to put one.
 */
export function manpowerFor(set: SequenceSet, stage: SequenceStage): SourcedRange {
  const rate = rateFor(set, stage.id);
  if (!rate) return unknownRange('person', `installation_rate:${stage.id}`);
  return statedRange(rate.minimumPersons, rate.recommendedPersons, 'person', rate.id, rate.source);
}

/** One stage's duration, by B-7's formula, with the formula attached. */
export function durationFor(
  set: SequenceSet,
  stage: SequenceStage,
  stationCount: number,
): SourcedNumber {
  const rate = rateFor(set, stage.id);
  if (!rate) return unknownNumber('hour', `installation_rate:${stage.id}`);

  const hours = rate.hoursFixed + rate.hoursPerStation * stationCount;

  return calculatedNumber(round(hours), 'hour', `${stage.id}.duration`, {
    formula: 'hoursFixed + (hoursPerStation × stationCount)',
    inputs: [
      { name: 'hoursFixed', value: rate.hoursFixed, unit: 'hour', ref: rate.id },
      { name: 'hoursPerStation', value: rate.hoursPerStation, unit: 'hour', ref: rate.id },
      {
        name: 'stationCount',
        value: stationCount,
        unit: 'count',
        ref: 'measurement:placement_count',
      },
    ],
    rateId: rate.id,
    citation: rate.source,
  });
}

/**
 * The peak crew across the plan — the largest number of people needed at once.
 *
 * The maximum rather than the sum: stages run in sequence, so the crew a job needs is the biggest
 * any one stage needs, not everybody added together. Unknown if any stage is unknown, because a
 * stage with no stated crew could be the largest one.
 *
 * The **citation** of a peak is the rate it came from, so a reader can see which stage set the
 * figure — a maximum with a general reference would be the least checkable number in the document.
 */
export function peakManpower(perStage: readonly SourcedRange[]): SourcedRange {
  const ref = 'installation_rate:peak';
  if (perStage.length === 0) return unknownRange('person', ref);
  if (perStage.some((entry) => entry.recommended === null)) {
    return unknownRange('person', `${ref}:incomplete`);
  }

  const peak = perStage.reduce((highest, entry) =>
    (entry.recommended ?? 0) > (highest.recommended ?? 0) ? entry : highest,
  );
  return peak;
}

/** Total duration: the sum, or unknown if any stage is unknown. */
export function totalDuration(perStage: readonly SourcedNumber[]): SourcedNumber {
  const ref = 'installation_rate:total';
  if (perStage.length === 0) return unknownNumber('hour', ref);
  if (perStage.some((entry) => entry.value === null)) {
    return unknownNumber('hour', `${ref}:incomplete`);
  }

  const total = perStage.reduce((sum, entry) => sum + (entry.value ?? 0), 0);
  const rateIds = [
    ...new Set(perStage.flatMap((entry) => (entry.calculation?.rateId ? [entry.calculation.rateId] : []))),
  ];
  const citations = [
    ...new Set(perStage.flatMap((entry) => (entry.calculation?.citation ? [entry.calculation.citation] : []))),
  ];

  return calculatedNumber(round(total), 'hour', 'plan.duration', {
    formula: 'Σ stage durations',
    inputs: perStage.map((entry, index) => ({
      name: entry.calculation?.rateId ?? `stage_${index + 1}`,
      value: entry.value ?? 0,
      unit: 'hour',
      ref: entry.source.ref,
    })),
    /*
     * A total drawn from several rates names them all, joined — and its citation names every
     * standard behind it. One rate id would be a lie about where the other hours came from, and
     * EV-6 would not catch it because the field would be populated.
     */
    rateId: rateIds.length > 0 ? rateIds.join(' + ') : null,
    citation: citations.length > 0 ? citations.join(' · ') : null,
  });
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
