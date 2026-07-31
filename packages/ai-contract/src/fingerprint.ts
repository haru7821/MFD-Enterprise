import type { PlacementSummary, RefWithVersion } from './context';

/**
 * What an installation plan depends on, and how to tell when it has moved.
 *
 * > Owner decision, Hardening 1: *"An installation plan must never appear valid after the layout
 * > changes … When any dependency changes: mark plan as stale. Do not silently update. Do not
 * > automatically regenerate. The engineer must approve regeneration."*
 *
 * A plan is a derived document. It describes one layout, judged by one rule set, using one
 * equipment library, at one moment — and it keeps describing that after the drawing moves on. The
 * danger is not that it becomes wrong; it is that it goes on **looking right**, which is how a
 * superseded bill of materials reaches a purchasing department.
 *
 * ## Revisions, not equality
 *
 * Each dependency reduces to a short string that changes when the dependency does. Comparing
 * strings rather than deep-comparing documents means the check is cheap enough to run on every
 * render — and, more importantly, that a plan carries what it was made from **inside itself**, so a
 * plan found in a saved file six months later can still be checked against the project it is in.
 *
 * ## Why the whole document counts, not only the layout
 *
 * The owner's requirement names the layout, and `layoutRevision` is the one that catches it
 * precisely. `documentRevision` is broader — it moves when anything in the project does, including
 * a rename that cannot affect a plan. That is deliberately the conservative direction for a
 * document somebody signs: over-warning costs a regeneration, under-warning costs a wrong bill of
 * materials. {@link planStaleness} reports **which** dependencies moved, so the warning can say
 * what changed rather than being a mystery an engineer learns to dismiss.
 */

export const PLAN_DEPENDENCIES = [
  /** Anything in the project file. The broadest signal, and the coarsest. */
  'document',
  /** The planned level's placements — ids, positions, rotations, equipment. The precise one. */
  'layout',
  /** The catalogue: a new revision of a machine changes what its connections require. */
  'equipment_library',
  /** The rule set: a new threshold changes which findings block the plan. */
  'rule_set',
] as const;
export type PlanDependency = (typeof PLAN_DEPENDENCIES)[number];

export interface PlanFingerprint {
  readonly documentRevision: string;
  readonly layoutRevision: string;
  readonly equipmentLibraryRevision: string;
  readonly ruleSetRevision: string;
}

/**
 * Which dependencies have moved since the plan was made. Empty means the plan is current.
 *
 * An array rather than a boolean, because *"the layout changed"* and *"the rule set was updated"*
 * call for different things from an engineer, and a plan that says only "outdated" makes them go
 * and find out which.
 */
export function planStaleness(
  made: PlanFingerprint,
  current: PlanFingerprint,
): readonly PlanDependency[] {
  const changed: PlanDependency[] = [];
  if (made.documentRevision !== current.documentRevision) changed.push('document');
  if (made.layoutRevision !== current.layoutRevision) changed.push('layout');
  if (made.equipmentLibraryRevision !== current.equipmentLibraryRevision) {
    changed.push('equipment_library');
  }
  if (made.ruleSetRevision !== current.ruleSetRevision) changed.push('rule_set');
  return changed;
}

/**
 * The layout, as a short string.
 *
 * Every field that can change what an installation involves: which machine, where, facing which
 * way, in which room. **Sorted by placement id**, so the revision is a property of the layout and
 * not of the order the placements happen to be stored in — otherwise re-saving a project would
 * mark every plan stale.
 *
 * Positions are rounded to the millimetre before hashing. The document holds millimetres and the
 * canvas snaps to them, so this changes nothing today; it is here so that a future sub-millimetre
 * coordinate cannot make a plan stale because a float drifted in the last decimal place.
 */
export function layoutRevisionOf(placements: readonly PlacementSummary[]): string {
  const parts = [...placements]
    .map(
      (placement) =>
        `${placement.placementId}|${placement.equipmentObjectId}|${Math.round(
          placement.position.x,
        )}|${Math.round(placement.position.y)}|${Math.round(placement.rotation)}|${
          placement.spaceId ?? ''
        }`,
    )
    .sort();
  return `${parts.length}:${hash(parts.join('\n'))}`;
}

/**
 * The equipment library, as a short string.
 *
 * Id and version of every record, sorted. A catalogue that gains a machine nobody placed still
 * changes the revision — which is the conservative direction again: the alternative is deciding
 * *here* which catalogue changes can affect a plan, and that judgement would have to be revisited
 * every time the planner learned to read a new field.
 */
export function equipmentLibraryRevisionOf(
  objects: readonly { readonly id: string; readonly version: string }[],
): string {
  const parts = objects.map((object) => `${object.id}@${object.version}`).sort();
  return `${parts.length}:${hash(parts.join('\n'))}`;
}

export function ruleSetRevisionOf(ruleSet: RefWithVersion): string {
  return `${ruleSet.id}@${ruleSet.version}`;
}

/**
 * FNV-1a, 32-bit, as eight hex digits.
 *
 * Not a security hash and not trying to be. What it needs is to be **stable across runs and
 * machines** — a plan saved on one engineer's laptop is checked on another's — which rules out
 * anything seeded, and to be short enough to sit in a document without bloating it. The same
 * function and the same reasoning as the solver's candidate ids.
 */
function hash(value: string): string {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193) >>> 0;
  }
  return result.toString(16).padStart(8, '0');
}
