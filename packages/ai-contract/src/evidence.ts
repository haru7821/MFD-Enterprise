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
  /**
   * An {@link InstallationRate} from a referenced installation standard.
   *
   * > Owner decision, B-7: *"Every value must come from a referenced installation standard.
   * > Planning calculations may use only sourced installation rates."*
   *
   * Its own kind rather than `sequence_set`, because a rate is the one thing in that file that
   * carries an outside citation — and EV-7 requires one of exactly these kinds.
   */
  'installation_rate',
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
   * The published document this rests on — *"KS B ISO 1234:2024 § 7.3"*.
   *
   * > Owner decision, B-7: *"Every value must come from a referenced installation standard."*
   *
   * Null for a measurement off a drawing or a value nobody supplied, because those cite nothing and
   * a fabricated citation would be worse than none. **Required** for a standard, a manufacturer's
   * manual and an installation rate — EV-7 — which is what stops a rate being typed into the
   * sequence file with nothing behind it.
   */
  readonly citation: string | null;
}

/**
 * One number that went into a calculation, with its value.
 *
 * > Owner decision, B-7: *"Every calculated value must expose: calculation formula, input values,
 * > rate id, source citation."*
 *
 * The **value**, not only the name. A reader holding a printed plan can check
 * `2 + (1.5 × 12) = 20` without opening a data file, which is the difference between a figure that
 * can be argued with and one that has to be trusted.
 */
export interface CalculationInput {
  /** As it appears in the formula: `hoursFixed`, `hoursPerStation`, `stationCount`. */
  readonly name: string;
  readonly value: number;
  readonly unit: string;
  /** Where this number came from — a rate id, a measurement, a catalogue field group. */
  readonly ref: string;
}

/**
 * How a calculated figure was arrived at.
 *
 * All four of the owner's disclosures in one object, so a `calculated` value cannot carry some of
 * them: the formula, the input values, the rate id and the citation. EV-3 makes this non-null
 * exactly when the status is `calculated`, and EV-6 makes the rate id and the citation stand or
 * fall together — a rate without a citation is precisely what B-7 forbids.
 */
export interface Calculation {
  /** The arithmetic as written in the decision: `hoursFixed + (hoursPerStation × stationCount)`. */
  readonly formula: string;
  readonly inputs: readonly CalculationInput[];
  /**
   * The installation rate this used, or null for arithmetic that used none.
   *
   * A summed pipe length is calculated and uses no rate; a duration uses one and must name it.
   */
  readonly rateId: string | null;
  /** The standard the rate is cited from. Non-null **exactly when** `rateId` is (EV-6). */
  readonly citation: string | null;
}

/** A quantity with its unit, its status and its source. Never a bare number. */
export interface SourcedNumber {
  /** Null **exactly when** the status is `unknown`. */
  readonly value: number | null;
  /** `'person'`, `'hour'`, `'mm'`, `'each'` — singular, as the rule engine's units are. */
  readonly unit: string;
  readonly status: EvidenceStatus;
  readonly source: EvidenceSource;
  /** Non-null **exactly when** the status is `calculated` (EV-3). */
  readonly calculation: Calculation | null;
}

/**
 * A crew size, as the two figures B-7 defines it with.
 *
 * > Owner decision, B-7: *"Manpower = minimumPersons, recommendedPersons."*
 *
 * A range rather than a number, and read straight from an {@link InstallationRate} — never
 * calculated, never inferred from the work. Both figures are null together: a rate that stated only
 * one of them would leave a reader unable to tell a floor from a recommendation.
 */
export interface SourcedRange {
  readonly minimum: number | null;
  readonly recommended: number | null;
  readonly unit: string;
  readonly status: EvidenceStatus;
  readonly source: EvidenceSource;
}

/**
 * A planning rate from a referenced installation standard — the owner's B-7 model, verbatim.
 *
 * ```
 *   Duration = hoursFixed + (hoursPerStation × stationCount)
 *   Manpower = minimumPersons, recommendedPersons
 * ```
 *
 * Every field is required and `source` is a citation, so a rate that reaches the planner has an
 * outside document behind it. **A rate with any field missing is not a partial rate — it is not a
 * rate**, and the planner reports Unknown rather than evaluating half a formula. That is the whole
 * decision: *"Never interpolate. Never estimate. Never infer."*
 */
export interface InstallationRate {
  readonly id: string;
  /** The stage this rate applies to. */
  readonly stage: string;
  readonly hoursFixed: number;
  readonly hoursPerStation: number;
  readonly minimumPersons: number;
  readonly recommendedPersons: number;
  /** The published installation standard — document, revision and section. */
  readonly source: string;
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
    statement: 'The status is `calculated` if and only if the source kind is `derived` and a `calculation` is present.',
    why: 'Calculated means computed from something. If no arithmetic is attached, it was not computed — it was chosen.',
  },
  {
    id: 'EV-4',
    statement: 'A calculation states a non-empty formula and at least one input, each with its value.',
    why: 'B-7 requires the formula and the input values. A reader holding a printed plan has to be able to check the sum without opening a data file.',
  },
  {
    id: 'EV-5',
    statement: '`verified` requires a source kind of `manufacturer_manual`, `standard`, `rule`, `catalogue_field` or `installation_rate`.',
    why: 'A measurement off a drawing is a fact about the drawing, not about the equipment. Only a document can verify.',
  },
  {
    id: 'EV-6',
    statement: 'A calculation names a rate id if and only if it names that rate\'s citation.',
    why: 'B-7: "Planning calculations may use only sourced installation rates." A rate with no citation is the uncited figure the whole decision forbids.',
  },
  {
    id: 'EV-7',
    statement: 'A source of kind `installation_rate`, `standard` or `manufacturer_manual` carries a citation.',
    why: 'These are the three kinds whose authority *is* an outside document. One without a reference is a claim about a document nobody can find.',
  },
] as const;

/** Source kinds that can support a `verified` status. See EV-5. */
export const VERIFYING_SOURCE_KINDS: readonly EvidenceSourceKind[] = [
  'manufacturer_manual',
  'standard',
  'rule',
  'catalogue_field',
  'installation_rate',
];

/** Source kinds whose authority is an outside document, so a citation is mandatory. See EV-7. */
export const CITING_SOURCE_KINDS: readonly EvidenceSourceKind[] = [
  'manufacturer_manual',
  'standard',
  'installation_rate',
];

/* ------------------------------------------------------------------ constructors */

/**
 * Not supplied.
 *
 * A function rather than a constant so the ref is mandatory: *what* is unknown is the useful half.
 * "Unknown" tells an engineer nothing; "unknown — no installation rate for `equipment_set`" tells
 * them which file to edit and which standard to go and find.
 */
export function unknownNumber(unit: string, ref: string): SourcedNumber {
  return {
    value: null,
    unit,
    status: 'unknown',
    source: { kind: 'not_supplied', ref, citation: null },
    calculation: null,
  };
}

export function unknownText(ref: string): SourcedText {
  return { value: null, status: 'unknown', source: { kind: 'not_supplied', ref, citation: null } };
}

/** A crew size nobody has supplied. Both figures absent together — see {@link SourcedRange}. */
export function unknownRange(unit: string, ref: string): SourcedRange {
  return {
    minimum: null,
    recommended: null,
    unit,
    status: 'unknown',
    source: { kind: 'not_supplied', ref, citation: null },
  };
}

/**
 * Computed, with the whole arithmetic attached.
 *
 * Throws rather than producing an EV-4 or EV-6 violation, because the caller is in a better
 * position to say what went wrong than a schema error two layers up is. Both throws describe a
 * figure that would be *presented as* checkable and not be.
 */
export function calculatedNumber(
  value: number,
  unit: string,
  ref: string,
  calculation: Calculation,
): SourcedNumber {
  if (calculation.inputs.length === 0 || calculation.formula.length === 0) {
    throw new Error(
      `calculatedNumber(${ref}): a calculated figure needs its formula and its input values — ` +
        `without them it is an uncited figure wearing a label that says otherwise`,
    );
  }
  if ((calculation.rateId === null) !== (calculation.citation === null)) {
    throw new Error(
      `calculatedNumber(${ref}): a planning rate must be named together with its citation. ` +
        `B-7: planning calculations may use only sourced installation rates`,
    );
  }
  return {
    value,
    unit,
    status: 'calculated',
    source: { kind: 'derived', ref, citation: calculation.citation },
    calculation,
  };
}

/** Measured off the drawing — a routed length, a count of machines. */
export function measuredNumber(value: number, unit: string, ref: string): SourcedNumber {
  return {
    value,
    unit,
    status: 'planning',
    source: { kind: 'measurement', ref, citation: null },
    calculation: null,
  };
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
  citation: string | null = null,
): SourcedNumber {
  return { value, unit, status, source: { kind, ref, citation }, calculation: null };
}

/**
 * A crew size read straight from an installation rate.
 *
 * Read, never derived: B-7 defines manpower as the rate's own two figures, so there is no arithmetic
 * to show and `SourcedRange` has no `calculation` field to put one in.
 */
export function statedRange(
  minimum: number,
  recommended: number,
  unit: string,
  ref: string,
  citation: string,
): SourcedRange {
  return {
    minimum,
    recommended,
    unit,
    status: 'planning',
    source: { kind: 'installation_rate', ref, citation },
  };
}
