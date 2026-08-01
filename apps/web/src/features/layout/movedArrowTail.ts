import type { Placement } from '@mfd/document-model';
import type { Vec2 } from '@mfd/cad-engine';
import { type Catalog, footprintCentre } from '@mfd/object-library';

/**
 * Where a "moved" ghost's arrow starts, in model space — the source placement's own footprint
 * centre, or `null` when there is nothing to draw it from.
 *
 * > Architecture decision AD-21. In its own module, not `ProposalGhostLayer.tsx`, so it can be
 * > tested without a Konva canvas and without breaking that file's Fast Refresh contract (a
 * > component file exporting a second, non-component value).
 *
 * Never `source.transform.position`: that is the footprint's corner for every shipped record, and
 * a pure rotation about a shared corner would leave it unmoved even though the ghost's own centre —
 * the head of the same arrow — visibly swept elsewhere.
 *
 * `null`, not the corner, when the catalogue has nothing for `source`: drawing from the corner
 * would be exactly the mismatched anchor this exists to remove, and a caller with no size for the
 * machine has no honest centre to draw it from — AD-18's "unknown must remain unknown," applied to
 * a screen coordinate rather than a criterion.
 */
export function movedArrowTail(source: Placement | null, catalog: Catalog): Vec2 | null {
  if (!source) return null;
  const object = catalog.get(source.equipmentObjectId);
  return object ? footprintCentre(object, source.transform) : null;
}
