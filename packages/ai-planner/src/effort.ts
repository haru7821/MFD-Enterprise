import type { SourcedNumber } from '@mfd/ai-contract';
import { calculatedNumber, unknownNumber } from '@mfd/ai-contract';

import type { SequenceStage } from './sequenceSet';

/**
 * Manpower and duration — the owner's Sprint 6 § 3, under their §§ 4–5.
 *
 * ## AD-19, amended rather than abandoned
 *
 * The architecture said plainly that a plan must not carry durations, because *"nobody has supplied
 * labour rates or crew sizes, and a plan with invented durations is a schedule somebody would
 * resource against"*. `InstallationStage` enforced it with `durationDays?: never`.
 *
 * The owner now requires both as outputs, and in the same decision says how: **cited or unknown**,
 * and labelled `calculated` when computed. Those two requirements do not conflict — they relocate
 * the refusal:
 *
 * | | Before | Now |
 * | --- | --- | --- |
 * | A duration may be stated | Never | When a rate in the sequence set supports it |
 * | A duration may be invented | Never | **Never** |
 * | Nothing supplies a rate | The field cannot exist | The field says `unknown`, naming the file that would answer it |
 *
 * So this file computes hours from rates and reports `unknown` when there are none — and the shipped
 * `standards/sequences/dialysis.json` has none, so **every figure this produces today is unknown**.
 * That is the same answer AD-19 gave, reached by a mechanism that can produce a real one when
 * somebody supplies a rate with a source, instead of by a type that forbids it forever.
 *
 * ## Totals are unknown if any part is
 *
 * A total over the stages that happened to have rates is the most dangerous number here: it is
 * smaller than the truth, it looks complete, and it is the one somebody quotes. Partial knowledge
 * produces `unknown`, and the per-stage rows show which stages are missing.
 */

/** One stage's crew size, straight from the file — never inferred from the work. */
export function manpowerFor(stage: SequenceStage): SourcedNumber {
  const ref = `sequence_set:${stage.id}.manpower`;
  if (stage.manpower.persons === null) return unknownNumber('person', ref);

  return {
    value: stage.manpower.persons,
    unit: 'person',
    status: 'planning',
    source: { kind: 'sequence_set', ref, inputs: [] },
  };
}

/**
 * One stage's duration: a fixed part plus a per-station part.
 *
 * **Both null means unknown; one null means the other is used alone.** A stage with only a
 * per-station rate is a stage whose fixed overhead nobody stated, not a stage with no overhead —
 * but treating a missing component as zero is precisely the AD-18 failure ("an untaken measurement
 * is `unavailable`, never zero"), so a stage that declares *neither* reports unknown rather than
 * zero hours.
 */
export function durationFor(stage: SequenceStage, stationCount: number): SourcedNumber {
  const ref = `sequence_set:${stage.id}.duration`;
  const { hoursFixed, hoursPerStation } = stage.rate;

  if (hoursFixed === null && hoursPerStation === null) return unknownNumber('hour', ref);

  const inputs: string[] = [];
  let hours = 0;

  if (hoursFixed !== null) {
    hours += hoursFixed;
    inputs.push(`sequence_set:${stage.id}.rate.hoursFixed`);
  }
  if (hoursPerStation !== null) {
    hours += hoursPerStation * stationCount;
    inputs.push(`sequence_set:${stage.id}.rate.hoursPerStation`, 'measurement:placement_count');
  }

  return calculatedNumber(round(hours), 'hour', ref, inputs);
}

/**
 * The peak crew across the plan — the largest number of people needed at once.
 *
 * The maximum rather than the sum: stages run in sequence, so the crew a job needs is the biggest
 * any one stage needs, not everybody added together. Unknown if any stage is unknown, because a
 * stage with no stated crew could be the largest one.
 */
export function peakManpower(perStage: readonly SourcedNumber[]): SourcedNumber {
  const ref = 'plan:manpower';
  if (perStage.length === 0) return unknownNumber('person', ref);
  if (perStage.some((entry) => entry.value === null)) {
    return unknownNumber('person', `${ref}:incomplete`);
  }

  const peak = Math.max(...perStage.map((entry) => entry.value ?? 0));
  return calculatedNumber(
    peak,
    'person',
    ref,
    perStage.map((entry) => entry.source.ref),
  );
}

/** Total duration: the sum, or unknown if any stage is unknown. */
export function totalDuration(perStage: readonly SourcedNumber[]): SourcedNumber {
  const ref = 'plan:duration';
  if (perStage.length === 0) return unknownNumber('hour', ref);
  if (perStage.some((entry) => entry.value === null)) {
    return unknownNumber('hour', `${ref}:incomplete`);
  }

  const total = perStage.reduce((sum, entry) => sum + (entry.value ?? 0), 0);
  return calculatedNumber(
    round(total),
    'hour',
    ref,
    perStage.map((entry) => entry.source.ref),
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
