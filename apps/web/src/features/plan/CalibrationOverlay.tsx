import { Circle, Line, Text } from 'react-konva';

import {
  type PlanTransform,
  type Vec2,
  type Viewport,
  pixelToModel,
  worldToScreen,
} from '@mfd/cad-engine';

import { SPACE_THEME } from '@/features/space/spaceTheme';

/**
 * The two points being picked for scale calibration.
 *
 * Points are held in **image pixels**, not millimetres, because that is what a
 * calibration is: a statement about the drawing, made before the drawing has any
 * millimetres in it. They are converted through the current display transform only in
 * order to be shown.
 */

export interface CalibrationOverlayProps {
  readonly points: readonly Vec2[];
  readonly transform: PlanTransform;
  readonly viewport: Viewport;
  readonly cursorScreen: Vec2 | null;
}

export function CalibrationOverlay({
  points,
  transform,
  viewport,
  cursorScreen,
}: CalibrationOverlayProps) {
  const screen = points.map((pixel) =>
    worldToScreen(viewport, pixelToModel(transform, pixel)),
  );

  const from = screen[0];
  const to = screen[1] ?? cursorScreen;

  return (
    <>
      {from && to && (
        <Line
          points={[from.x, from.y, to.x, to.y]}
          stroke={SPACE_THEME.draft.stroke}
          strokeWidth={2}
          dash={[8, 5]}
          listening={false}
        />
      )}

      {screen.map((point, index) => (
        <Circle
          key={index}
          x={point.x}
          y={point.y}
          radius={5}
          fill={SPACE_THEME.draft.vertex}
          stroke="#0b1017"
          strokeWidth={1.5}
          listening={false}
        />
      ))}

      {cursorScreen && points.length < 2 && (
        <Text
          x={cursorScreen.x + 14}
          y={cursorScreen.y + 14}
          text={points.length === 0 ? 'click the first point' : 'click the second point'}
          fontSize={11}
          fontFamily="ui-monospace, monospace"
          fill={SPACE_THEME.draft.stroke}
          listening={false}
        />
      )}
    </>
  );
}
