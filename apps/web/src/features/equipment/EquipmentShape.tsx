import { Circle, Line, Text } from 'react-konva';

import { type Viewport, worldToScreen, worldToScreenLength } from '@mfd/cad-engine';
import type { Placement } from '@mfd/document-model';
import {
  type EquipmentObject,
  clearanceZones,
  footprintCorners,
  portPoints,
} from '@mfd/object-library';

import {
  EQUIPMENT_THEME,
  MIN_PIXELS_FOR_DETAIL,
  MIN_PIXELS_FOR_LABEL,
} from './equipmentTheme';

interface EquipmentShapeProps {
  readonly placement: Placement;
  readonly object: EquipmentObject;
  readonly viewport: Viewport;
  readonly isSelected: boolean;
}

/** Flatten model-space points into the [x, y, x, y, …] Konva wants. */
function toScreenPoints(
  viewport: Viewport,
  points: readonly { x: number; y: number }[],
): number[] {
  return points.flatMap((point) => {
    const screen = worldToScreen(viewport, point);
    return [screen.x, screen.y];
  });
}

/**
 * One placed machine.
 *
 * Every dimension drawn here comes from the catalogue record — nothing about the
 * AK98 is written into this component. Swapping a number in the JSON changes what
 * appears on screen, which is the requirement the whole data-driven design exists
 * to satisfy.
 *
 * Nodes are non-listening: hit testing runs against the model geometry in
 * `useCanvasInteraction`, not against Konva's hit graph. That keeps the scene graph
 * cheap at fifty objects and keeps the authoritative geometry in the engine.
 */
export function EquipmentShape({
  placement,
  object,
  viewport,
  isSelected,
}: EquipmentShapeProps) {
  const isDraft = object.dataStatus === 'draft';
  const tone = isDraft ? EQUIPMENT_THEME.draft : EQUIPMENT_THEME.verified;

  const corners = footprintCorners(object, placement.transform);
  const points = toScreenPoints(viewport, corners);

  const widthPx = worldToScreenLength(viewport, object.dimensions.width);
  const depthPx = worldToScreenLength(viewport, object.dimensions.depth);
  const smallestPx = Math.min(widthPx, depthPx);

  const showDetail = smallestPx >= MIN_PIXELS_FOR_DETAIL;
  const showLabels = smallestPx >= MIN_PIXELS_FOR_LABEL;

  // Label anchor: the topmost corner on screen, so text never sits over the shape.
  const anchor = corners
    .map((corner) => worldToScreen(viewport, corner))
    .reduce((highest, corner) => (corner.y < highest.y ? corner : highest));

  return (
    <>
      {showDetail &&
        clearanceZones(object, placement.transform).map((zone) => (
          <Line
            key={`${placement.id}-clearance-${zone.side}`}
            points={toScreenPoints(viewport, zone.polygon)}
            closed
            fill={EQUIPMENT_THEME.clearance.fill}
            stroke={EQUIPMENT_THEME.clearance.stroke}
            strokeWidth={1}
            dash={[...EQUIPMENT_THEME.clearance.dash]}
            listening={false}
            perfectDrawEnabled={false}
          />
        ))}

      <Line
        points={points}
        closed
        fill={tone.fill}
        stroke={isSelected ? EQUIPMENT_THEME.selected.stroke : tone.stroke}
        strokeWidth={isSelected ? 2 : 1.5}
        // Spread rather than pass undefined: exactOptionalPropertyTypes treats an
        // explicit undefined as a value, not as "absent".
        {...(isDraft ? { dash: [...EQUIPMENT_THEME.draft.dash] } : {})}
        listening={false}
        perfectDrawEnabled={false}
      />

      {showDetail &&
        portPoints(object, placement.transform).map((port) => {
          const screen = worldToScreen(viewport, port.position);
          return (
            <Circle
              key={`${placement.id}-port-${port.kind}`}
              x={screen.x}
              y={screen.y}
              radius={3.5}
              fill={EQUIPMENT_THEME.port[port.kind]}
              listening={false}
              perfectDrawEnabled={false}
            />
          );
        })}

      {showLabels && (
        <>
          <Text
            x={anchor.x}
            y={anchor.y - 38}
            text={placement.label}
            fontSize={11}
            fontStyle="bold"
            fill={tone.label}
            listening={false}
            perfectDrawEnabled={false}
          />
          <Text
            x={anchor.x}
            y={anchor.y - 25}
            text={`${object.dimensions.width} × ${object.dimensions.depth} mm`}
            fontSize={10}
            fontFamily="ui-monospace, monospace"
            fill={EQUIPMENT_THEME.dimension}
            listening={false}
            perfectDrawEnabled={false}
          />
          {isDraft && (
            <Text
              x={anchor.x}
              y={anchor.y - 13}
              text="DRAFT DATA"
              fontSize={9}
              fontStyle="bold"
              fontFamily="ui-monospace, monospace"
              fill={EQUIPMENT_THEME.draft.stroke}
              listening={false}
              perfectDrawEnabled={false}
            />
          )}
        </>
      )}

      {isSelected &&
        corners.map((corner, index) => {
          const screen = worldToScreen(viewport, corner);
          return (
            <Circle
              key={`${placement.id}-handle-${index}`}
              x={screen.x}
              y={screen.y}
              radius={3}
              fill={EQUIPMENT_THEME.selected.handleFill}
              stroke={EQUIPMENT_THEME.selected.stroke}
              strokeWidth={1}
              listening={false}
              perfectDrawEnabled={false}
            />
          );
        })}
    </>
  );
}
