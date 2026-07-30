import { Fragment } from 'react';
import { Circle, Line, Text } from 'react-konva';

import { type Viewport, worldToScreen } from '@mfd/cad-engine';
import type { ReferencePoint } from '@mfd/document-model';

import { CANVAS_THEME } from './canvasTheme';
import { REFERENCE_POINT_LABELS } from './referencePointLabels';

interface ReferencePointLayerProps {
  readonly points: readonly ReferencePoint[];
  readonly viewport: Viewport;
  readonly selectedReferencePointId: string | null;
}

/**
 * Where services enter, equipment is delivered, and staff work from.
 *
 * Drawn as a **screen-sized** crosshair rather than a model-sized one, deliberately. A reference
 * point has no extent — it is a coordinate, not an object with dimensions — so scaling its mark
 * with the zoom would either make it invisible on a whole-floor view or turn it into a target the
 * size of a room close up. The same reasoning as the origin marker.
 *
 * The symbol matches the one the report prints, so the drawing on screen and the drawing in the
 * PDF do not have to be mentally translated into each other.
 */
export function ReferencePointLayer({
  points,
  viewport,
  selectedReferencePointId,
}: ReferencePointLayerProps) {
  return (
    <>
      {points.map((point) => {
        const at = worldToScreen(viewport, point.position);
        const selected = point.id === selectedReferencePointId;
        const colour = selected ? CANVAS_THEME.referencePointSelected : CANVAS_THEME.referencePoint;
        const arm = 9;

        return (
          <Fragment key={point.id}>
            <Line
              points={[at.x - arm, at.y, at.x + arm, at.y]}
              stroke={colour}
              strokeWidth={selected ? 2 : 1.5}
              listening={false}
              perfectDrawEnabled={false}
            />
            <Line
              points={[at.x, at.y - arm, at.x, at.y + arm]}
              stroke={colour}
              strokeWidth={selected ? 2 : 1.5}
              listening={false}
              perfectDrawEnabled={false}
            />
            <Circle
              x={at.x}
              y={at.y}
              radius={arm * 0.55}
              stroke={colour}
              strokeWidth={selected ? 2 : 1.5}
              listening={false}
              perfectDrawEnabled={false}
            />
            <Text
              x={at.x + arm + 4}
              y={at.y - 5}
              // The engineer's own name when they gave one; otherwise the kind, because an
              // unlabelled crosshair on a drawing tells a reader nothing about what it is.
              text={point.label ?? REFERENCE_POINT_LABELS[point.kind]}
              fontSize={10}
              fontFamily="ui-monospace, monospace"
              fill={colour}
              listening={false}
              perfectDrawEnabled={false}
            />
          </Fragment>
        );
      })}
    </>
  );
}
