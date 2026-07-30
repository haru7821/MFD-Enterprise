import { Fragment } from 'react';
import { Line, Text } from 'react-konva';

import { type Viewport, worldToScreen } from '@mfd/cad-engine';
import type { Placement } from '@mfd/document-model';
import { type Catalog, footprintCorners } from '@mfd/object-library';

interface ProposalGhostLayerProps {
  readonly placements: readonly Placement[];
  readonly catalog: Catalog;
  readonly viewport: Viewport;
}

/**
 * The previewed layout, drawn as ghosts.
 *
 * ## Why a preview is part of the approval requirement rather than decoration
 *
 * The owner's fourth requirement is that an engineer approves explicitly before a layout is
 * applied. An approval given against a table of numbers is a weaker thing than one given against
 * the drawing: a total of 0.71 says nothing about whether the machines end up in front of the door.
 *
 * So the previewed proposal is drawn where it would go, and **only drawn** — nothing here writes to
 * the document. Dashed and half-transparent, so it cannot be mistaken for what is actually placed:
 * an engineer glancing at the canvas has to be able to tell a proposal from a decision.
 */
export function ProposalGhostLayer({ placements, catalog, viewport }: ProposalGhostLayerProps) {
  return (
    <>
      {placements.map((placement, index) => {
        const object = catalog.get(placement.equipmentObjectId);
        if (!object) return null;

        const corners = footprintCorners(object, placement.transform).map((corner) =>
          worldToScreen(viewport, corner),
        );
        const centre = corners.reduce(
          (sum, corner) => ({
            x: sum.x + corner.x / corners.length,
            y: sum.y + corner.y / corners.length,
          }),
          { x: 0, y: 0 },
        );

        return (
          <Fragment key={placement.id}>
            <Line
              points={corners.flatMap((corner) => [corner.x, corner.y])}
              closed
              stroke="#f59e0b"
              strokeWidth={1.5}
              dash={[6, 4]}
              fill="rgba(245, 158, 11, 0.12)"
              listening={false}
              perfectDrawEnabled={false}
            />
            {/*
              Numbered in proposal order, so the panel's breakdown and the drawing refer to the
              same machine — the same reason the report numbers its placements.
            */}
            <Text
              x={centre.x - 4}
              y={centre.y - 6}
              text={String(index + 1)}
              fontSize={12}
              fontStyle="bold"
              fill="#b45309"
              listening={false}
              perfectDrawEnabled={false}
            />
          </Fragment>
        );
      })}
    </>
  );
}
