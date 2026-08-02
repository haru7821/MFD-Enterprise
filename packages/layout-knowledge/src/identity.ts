/**
 * Three independent identity concepts — **owner decision D17, revised**.
 *
 * > *"Keep sha256 as drawing identity. Do not replace drawingId with a semantic identifier. However,
 * > separate identity from aggregation."*
 *
 * | Concept | Answers | Derived from |
 * | --- | --- | --- |
 * | **Drawing identity** | *is this the same file evidence?* | `sha256` — the bytes |
 * | **Facility identity** | *which site is this?* | An explicitly recorded `facilityId` |
 * | **Plan identity** | *which design plan is this an export of?* | An explicitly recorded `planId` |
 *
 * **The two aggregation identities may not be derived from the drawing identity, and may not be
 * inferred from a filename.** That is the whole point of the decision, and this module exists so
 * there is one place where it is true rather than a rule everyone is asked to remember.
 *
 * ## What went wrong without it
 *
 * `facilityOf(drawingId)` returned everything before the first `/`, and `planOf(drawingId)` stripped
 * the file extension. Both read a *string* to answer a question about the *world*. They worked only
 * because the corpus happened to be filed as `Hospital_NNN/sheet.ext`, and they fail silently the
 * moment an id stops carrying that structure — which is precisely what content-derived identity
 * does. Under a bare hash, `facilityOf` returns the whole hash and every drawing becomes its own
 * facility: D6's inflation guard inverted into an inflation source.
 *
 * ## Abstention, not a fallback
 *
 * When a record does not carry a facility or a plan, these functions return `null`. **They do not
 * fall back to parsing the id**, because a fallback would be the forbidden inference wearing a
 * safety label, and it would be invisible: a wrong facility grouping looks exactly like a right one.
 *
 * A `null` here has to be handled by the caller the same way an unmeasurable criterion is — as
 * *unknown*, never as *its own group*. Counting an unknown facility as a distinct facility is the
 * same error as scoring an unmeasured criterion as zero.
 */

/** Where a recorded identity came from. An identity with no stated source is not recorded. */
export const IDENTITY_SOURCES = [
  /** Declared by the dataset provider — e.g. `hospital_id` in the dataset's own metadata. */
  'dataset-metadata',
  /** Stated by a person, who can say what they checked. */
  'human-recorded',
  /**
   * Carried over from the pre-D17 scheme, where the id string encoded the grouping.
   *
   * Present so a migrated record says out loud that its grouping came from a parsed path, rather
   * than looking like a recorded fact. It is never *produced* here — only read.
   */
  'legacy-path-derived',
] as const;

export type IdentitySource = (typeof IDENTITY_SOURCES)[number];

/** An identity that was recorded, with the source that recorded it. */
export interface RecordedIdentity {
  readonly id: string;
  readonly source: IdentitySource;
}

/**
 * The identity fields a catalogued drawing may carry.
 *
 * Structural rather than importing `DrawingRecord`, so this module stays usable against a corpus
 * row, a dataset entry or an uploaded file's metadata without three near-identical functions.
 */
export interface IdentityBearing {
  readonly facilityId?: string | null;
  readonly facilitySource?: IdentitySource | null;
  readonly planId?: string | null;
  readonly planSource?: IdentitySource | null;
}

/**
 * The facility this drawing belongs to, or `null` when nothing recorded one.
 *
 * Note what is **not** a parameter: `drawingId`. It cannot be, or the rule could be broken by
 * accident.
 */
export function resolveFacility(record: IdentityBearing): RecordedIdentity | null {
  return recorded(record.facilityId, record.facilitySource);
}

/** The design plan this drawing is an export of, or `null` when nothing recorded one. */
export function resolvePlan(record: IdentityBearing): RecordedIdentity | null {
  return recorded(record.planId, record.planSource);
}

/**
 * An id and a source, or nothing.
 *
 * **Both or neither.** An id without a source is not a recorded identity — it is a value somebody
 * put there, and the whole reason `facilitySource` exists is that a reader must be able to tell a
 * declared fact from a guess. Returning it anyway would let an inferred grouping enter through the
 * one door built to keep it out.
 */
function recorded(
  id: string | null | undefined,
  source: IdentitySource | null | undefined,
): RecordedIdentity | null {
  if (id === null || id === undefined || id === '') return null;
  if (source === null || source === undefined) return null;
  return { id, source };
}

/**
 * Count distinct facilities across records — **owner decision D6**, without the string parsing.
 *
 * Returns the count **and** how many records could not state a facility, because those two numbers
 * answer different questions and collapsing them is how `support` overstated its evidence in the
 * first place. A caller that reports `facilities` without reporting `unknown` is claiming every
 * record was placed.
 */
export function countFacilities(records: readonly IdentityBearing[]): {
  readonly facilities: number;
  readonly unknown: number;
} {
  const known = new Set<string>();
  let unknown = 0;
  for (const record of records) {
    const facility = resolveFacility(record);
    if (facility === null) unknown += 1;
    else known.add(facility.id);
  }
  return { facilities: known.size, unknown };
}

/**
 * Count distinct plans — **owner decision D15**, same shape and the same warning.
 *
 * An unrecorded plan is **not** its own plan. Two exports of one design with no recorded `planId`
 * are one unknown, not two plans, and a caller must not add `unknown` to `plans` to get a total.
 */
export function countPlans(records: readonly IdentityBearing[]): {
  readonly plans: number;
  readonly unknown: number;
} {
  const known = new Set<string>();
  let unknown = 0;
  for (const record of records) {
    const plan = resolvePlan(record);
    if (plan === null) unknown += 1;
    else known.add(plan.id);
  }
  return { plans: known.size, unknown };
}
