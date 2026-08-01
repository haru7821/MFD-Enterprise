import type { Placement } from '@mfd/document-model';
import type { Vec2 } from '@mfd/cad-engine';
import { type Catalog, footprintCentre } from '@mfd/object-library';

/**
 * Where a ghost's own footprint sits, in model space — the arrow's head and the anchor for the
 * ghost's numbered label.
 *
 * > Architecture decision AD-21. In its own module for the same reason as `movedArrowTail.ts`: so
 * > it is testable without a Konva canvas and without breaking `ProposalGhostLayer.tsx`'s Fast
 * > Refresh contract.
 *
 * Never `placement.transform.position`: that is the footprint's corner for every shipped record,
 * and reverting to it here — as the sixth Critical 0 review round found this call site could do
 * with nothing to catch it — would silently repeat the exact mismatched-anchor defect the fourth
 * review round found and fixed for the arrow's *tail*, this time for its head.
 *
 * `null` when the catalogue has nothing for `placement`'s equipment, matching `movedArrowTail`'s
 * convention — the caller already skips the whole ghost in that case, but the seam stays honest
 * about what it actually needs rather than assuming a caller-side guarantee.
 */
export function ghostCentre(placement: Placement, catalog: Catalog): Vec2 | null {
  const object = catalog.get(placement.equipmentObjectId);
  return object ? footprintCentre(object, placement.transform) : null;
}
