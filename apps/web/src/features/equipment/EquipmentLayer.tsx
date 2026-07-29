import { useMemo } from 'react';

import {
  type Rect,
  type ScreenSize,
  type Viewport,
  expandRect,
  visibleWorldRect,
} from '@mfd/cad-engine';
import type { Placement } from '@mfd/document-model';
import { type Catalog, footprintBounds } from '@mfd/object-library';

import { EquipmentShape } from './EquipmentShape';

interface EquipmentLayerProps {
  readonly placements: readonly Placement[];
  readonly catalog: Catalog;
  readonly viewport: Viewport;
  readonly screen: ScreenSize;
  readonly selectedPlacementId: string | null;
}

/** Do these two model-space rectangles touch at all? */
function overlaps(a: Rect, b: Rect): boolean {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

/**
 * All placed equipment.
 *
 * Objects outside the view are skipped before any Konva node is built. The
 * specification asks for fifty objects; culling keeps the cost proportional to what
 * is actually on screen rather than to what is in the project, which is what makes
 * the number stop mattering.
 */
export function EquipmentLayer({
  placements,
  catalog,
  viewport,
  screen,
  selectedPlacementId,
}: EquipmentLayerProps) {
  const visible = useMemo(() => {
    // A margin keeps labels and clearance zones of just-offscreen objects drawn,
    // so nothing pops in at the edge while panning.
    const bounds = expandRect(visibleWorldRect(viewport, screen), 2_000);

    return placements.flatMap((placement) => {
      const object = catalog.get(placement.equipmentObjectId);
      // A placement referencing a catalogue object that no longer exists is a data
      // problem, not a drawing problem. It is skipped here and surfaced in the
      // status bar rather than crashing the canvas.
      if (!object) return [];

      return overlaps(footprintBounds(object, placement.transform), bounds)
        ? [{ placement, object }]
        : [];
    });
  }, [placements, catalog, viewport, screen]);

  return (
    <>
      {visible.map(({ placement, object }) => (
        <EquipmentShape
          key={placement.id}
          placement={placement}
          object={object}
          viewport={viewport}
          isSelected={placement.id === selectedPlacementId}
        />
      ))}
    </>
  );
}
