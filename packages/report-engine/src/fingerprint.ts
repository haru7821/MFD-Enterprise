import {
  type PlanFingerprint,
  equipmentLibraryRevisionOf,
  layoutRevisionOf,
  ruleSetRevisionOf,
} from '@mfd/ai-contract';
import type { Level, MfdDocument } from '@mfd/document-model';
import { isCalibrated } from '@mfd/document-model';
import type { Catalog } from '@mfd/object-library';
import type { RuleSet } from '@mfd/rule-engine';

/**
 * The project's fingerprint *right now* — Hardening decision 1.
 *
 * > *"An installation plan must never appear valid after the layout changes … Plan provenance
 * > tracking: document revision, layout revision, equipment library revision, rule set revision."*
 *
 * A plan records what it was made from; this computes what the project *is*, and `planStaleness`
 * compares them. **One implementation, two callers** — `buildReport`, so a stale plan cannot reach
 * a signed PDF unwarned, and the editor panel, so an engineer sees it before they export. Two
 * implementations would eventually disagree, and the one that said "current" would be the one
 * somebody believed.
 *
 * It lives here rather than in `@mfd/ai-contract` because it needs a document, a catalogue and a
 * rule set — and the contract package deliberately knows about none of them. The report engine
 * already receives all three.
 *
 * ## `project.updatedAt` is not the document revision
 *
 * The obvious implementation, and it does not work: `updatedAt` is stamped by `saveDocument`, so it
 * moves when a project is **saved** and not when it is edited. A plan checked against it would look
 * current through an afternoon of drawing and go stale the moment somebody pressed Save — exactly
 * backwards. Found by reading `serialize.ts` rather than by assuming.
 *
 * So the document revision is derived from **content**: the things a plan depends on that are not
 * placements. Two consequences worth stating:
 *
 * - It is correct under undo. Undoing back to the state a plan was made from makes the plan current
 *   again, because the content is the same content. A counter would have said "stale" forever.
 * - It ignores the things that cannot affect a plan. The project name, the customer contact and the
 *   report render mode are not in it — a plan does not become wrong because somebody corrected a
 *   spelling, and a warning that fires on that is a warning engineers learn to dismiss.
 */
export function projectFingerprint(
  document: MfdDocument,
  levelId: string,
  catalog: Catalog,
  ruleSet: RuleSet,
): PlanFingerprint {
  const level = document.project.levels.find((entry) => entry.id === levelId);

  return {
    documentRevision: documentRevisionOf(document, level),
    layoutRevision: layoutRevisionOf(
      (level?.placements ?? []).map((placement) => ({
        placementId: placement.id,
        equipmentObjectId: placement.equipmentObjectId,
        position: placement.transform.position,
        rotation: placement.transform.rotation,
        spaceId: placement.spaceId,
      })),
    ),
    equipmentLibraryRevision: equipmentLibraryRevisionOf(catalog.objects),
    ruleSetRevision: ruleSetRevisionOf({ id: ruleSet.id, version: ruleSet.version }),
  };
}

/**
 * Everything a plan depends on except the placements.
 *
 * | In | Why a plan depends on it |
 * | --- | --- |
 * | Boundaries | The room a plan is of, and the obstructions its routing goes around |
 * | Spaces | Which boundary is a room, and what it is called |
 * | Reference points | Where each service enters — the origin of every connection run |
 * | Calibration | An uncalibrated plan makes every routed length a number of pixels |
 * | The level list | A plan for a level that has been deleted is not a plan of this project |
 *
 * Everything else is deliberately absent — see the note above about warnings engineers learn to
 * dismiss.
 */
function documentRevisionOf(document: MfdDocument, level: Level | undefined): string {
  if (!level) {
    // The planned level is gone. A revision that cannot collide with any real one, so a plan made
    // for a deleted level always reads stale.
    return 'level-absent';
  }

  const parts = [
    `levels:${document.project.levels.map((entry) => entry.id).sort().join(',')}`,
    `calibrated:${level.planImage === null ? 'none' : isCalibrated(level) ? 'yes' : 'no'}`,
    ...level.boundaries
      .map(
        (boundary) =>
          `boundary:${boundary.id}:${boundary.obstructionType ?? ''}:${boundary.vertices
            .map((vertex) => `${Math.round(vertex.x)},${Math.round(vertex.y)}`)
            .join(';')}`,
      )
      .sort(),
    ...level.spaces
      .map((space) => `space:${space.id}:${space.boundaryId}:${space.function}`)
      .sort(),
    ...level.referencePoints
      .map(
        (point) =>
          `point:${point.id}:${point.kind}:${Math.round(point.position.x)},${Math.round(
            point.position.y,
          )}`,
      )
      .sort(),
  ];

  return `${parts.length}:${hash(parts.join('\n'))}`;
}

/** FNV-1a, 32-bit. Stable across runs and machines — see `@mfd/ai-contract`'s note. */
function hash(value: string): string {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193) >>> 0;
  }
  return result.toString(16).padStart(8, '0');
}
