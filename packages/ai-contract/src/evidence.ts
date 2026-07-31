import type { Bilingual } from '@mfd/rule-engine';

/**
 * What stands behind a number.
 *
 * > Owner decision, Sprint 6 § 4: *"Every recommendation must include its source. Never generate
 * > uncited engineering values. Unknown values remain 'Unknown'. Never infer dimensions or
 * > clearances."*
 * >
 * > Owner decision, Sprint 6 § 5: *"Every recommendation must indicate whether it is Verified,
 * > Draft, Planning or Calculated."*
 *
 * This file is those two requirements expressed as a type. A planner value is not a number — it is
 * a number **with a status and a source**, and the three travel together because the alternative is
 * a document in which "1,200 mm" from a manual and "1,200 mm" from somebody's estimate look
 * identical.
 *
 * ## Why the value may be null and the source may not
 *
 * The asymmetry is the whole design. There is no way to express a figure without saying where it
 * came from, and there *is* a way to express not knowing: `value: null`, `status: 'unknown'`,
 * `source.kind: 'not_supplied'`. An engineer reading a plan can tell a missing labour rate from a
 * zero-hour task, which they could not if the type allowed a bare `number`.
 *
 * The rule engine reached the same conclusion in Sprint 2 about clearances (AD-6a), and the scoring
 * engine in Sprint 6 about criteria (AD-18). This is the third time, in the third package, and the
 * shape is the same each time because the failure it prevents is the same: **an unmeasured quantity
 * silently becoming a measured one.**
 */

/**
 * How much weight a value carries.
 *
 * The owner's four, plus `unknown`. The fifth is not an extra category smuggled in — it is the one
 * the owner's own § 4 requires ("unknown values remain Unknown"), and giving it a name is what
 * stops it being represented as a zero.
 */
export const EVIDENCE_STATUSES = [
  /** A manufacturer's manual or a published standard says so. The only status a signed figure gets. */
  'verified',
  /** A placeholder in the catalogue or the standards data, carried so the gap is visible. */
  'draft',
  /** An engineering planning figure — a stage exists, a connection is needed — not a measurement. */
  'planning',
  /** Computed from other sourced values. Its inputs are named, so the arithmetic can be checked. */
  'calculated',
  /** Nothing supplied it. **Never rendered as a number**, never defaulted, never inferred. */
  'unknown',
] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

/**
 * What kind of thing vouches for a value.
 *
 * Closed, and checked against the status — see {@link EVIDENCE_INVARIANTS}. A `verified` value
 * whose source is `not_supplied` is the exact contradiction this product cannot afford to print,
 * and it is unrepresentable rather than discouraged.
 */
export const EVIDENCE_SOURCE_KINDS = [
  'manufacturer_manual',
  'standard',
  /** A rule in `standards/rules/`, with its own authority block. */
  'rule',
  /** A field group on an object-library record, carrying its own verification state. */
  'catalogue_field',
  /** The installation sequence set — `standards/sequences/dialysis.json`. */
  'sequence_set',
  /** The commissioning checklist set — `standards/checklists/dialysis.json`. */
  'checklist_set',
  /** An evaluation result from the rule engine. */
  'finding',
  /** Measured off the drawing — a routed length, a machine count. */
  'measurement',
  /** Computed from other sourced values. Carries the refs it was computed from. */
  'derived',
  /** Nothing. The only kind an `unknown` may carry, and the only kind that may carry no value. */
  'not_supplied',
] as const;
export type EvidenceSourceKind = (typeof EVIDENCE_SOURCE_KINDS)[number];

export interface EvidenceSource {
  readonly kind: EvidenceSourceKind;
  /**
   * Which one — a rule id, a stage id, a catalogue field group, a standards file id.
   *
   * Language-independent and resolvable: a reader who wants to check a figure must be able to find
   * the thing that stated it. `'not_supplied'` still carries a ref naming *what* was not supplied,
   * because "unknown" is more useful when it says which manual would answer it.
   */
  readonly ref: string;
  /**
   * The refs this was computed from. Non-empty **exactly when** the kind is `derived`.
   *
   * A calculated figure whose inputs are not named is an uncited figure wearing a label that says
   * otherwise, which is worse than an uncited one.
   */
  readonly inputs: readonly string[];
}

/** A quantity with its unit, its status and its source. Never a bare number. */
export interface SourcedNumber {
  /** Null **exactly when** the status is `unknown`. */
  readonly value: number | null;
  /** `'person'`, `'hour'`, `'mm'`, `'each'` — singular, as the rule engine's units are. */
  readonly unit: string;
  readonly status: EvidenceStatus;
  readonly source: EvidenceSource;
}

/** A statement with its status and its source. Bilingual, because it may reach the report. */
export interface SourcedText {
  readonly value: Bilingual | null;
  readonly status: EvidenceStatus;
  readonly source: EvidenceSource;
}

/**
 * The rules relating status to source, in one place so the schema and the prose cannot drift.
 *
 * Written as data rather than as five refinements, because the interesting property is the *table*:
 * a reader should be able to see at a glance which combinations exist, and a reviewer should be
 * able to argue with a row rather than with a validator.
 */
export const EVIDENCE_INVARIANTS = [
  {
    id: 'EV-1',
    statement: 'A value is null if and only if its status is `unknown`.',
    why: 'A null with any other status is a figure that lost its number; a non-null `unknown` is a guess wearing a disclaimer.',
  },
  {
    id: 'EV-2',
    statement: 'The source kind is `not_supplied` if and only if the status is `unknown`.',
    why: 'The owner\'s "never generate uncited engineering values", in the only form that cannot be worked around.',
  },
  {
    id: 'EV-3',
    statement: 'The status is `calculated` if and only if the source kind is `derived`.',
    why: 'Calculated means computed from something. If nothing is named, it was not computed — it was chosen.',
  },
  {
    id: 'EV-4',
    statement: '`source.inputs` is non-empty if and only if the source kind is `derived`.',
    why: 'The arithmetic behind a calculated figure has to be checkable, and nothing else has arithmetic behind it.',
  },
  {
    id: 'EV-5',
    statement: '`verified` requires a source kind of `manufacturer_manual`, `standard`, `rule` or `catalogue_field`.',
    why: 'A measurement off a drawing is a fact about the drawing, not about the equipment. Only a document can verify.',
  },
] as const;

/** Source kinds that can support a `verified` status. See EV-5. */
export const VERIFYING_SOURCE_KINDS: readonly EvidenceSourceKind[] = [
  'manufacturer_manual',
  'standard',
  'rule',
  'catalogue_field',
];

/* ------------------------------------------------------------------ constructors */

/**
 * Not supplied.
 *
 * A function rather than a constant so the ref is mandatory: *what* is unknown is the useful half.
 * "Unknown" tells an engineer nothing; "unknown — no labour rate in `standards/sequences`" tells
 * them which file to edit.
 */
export function unknownNumber(unit: string, ref: string): SourcedNumber {
  return {
    value: null,
    unit,
    status: 'unknown',
    source: { kind: 'not_supplied', ref, inputs: [] },
  };
}

export function unknownText(ref: string): SourcedText {
  return { value: null, status: 'unknown', source: { kind: 'not_supplied', ref, inputs: [] } };
}

/** Computed from named inputs. Throws on an empty input list rather than producing an EV-4 violation. */
export function calculatedNumber(
  value: number,
  unit: string,
  ref: string,
  inputs: readonly string[],
): SourcedNumber {
  if (inputs.length === 0) {
    throw new Error(
      `calculatedNumber(${ref}): a calculated figure with no named inputs is an uncited figure ` +
        `wearing a label that says otherwise`,
    );
  }
  return { value, unit, status: 'calculated', source: { kind: 'derived', ref, inputs } };
}

/** Measured off the drawing — a routed length, a count of machines. */
export function measuredNumber(value: number, unit: string, ref: string): SourcedNumber {
  return { value, unit, status: 'planning', source: { kind: 'measurement', ref, inputs: [] } };
}

/**
 * Stated by a standards file or a catalogue record, carrying that record's own verification state.
 *
 * `draft` is passed through rather than upgraded. A planning figure taken from a draft catalogue
 * field is a draft figure, and a planner that quietly promoted it would undo the one thing the
 * object library's verification status exists to do.
 */
export function statedNumber(
  value: number,
  unit: string,
  kind: EvidenceSourceKind,
  ref: string,
  status: 'verified' | 'draft' | 'planning',
): SourcedNumber {
  return { value, unit, status, source: { kind, ref, inputs: [] } };
}
