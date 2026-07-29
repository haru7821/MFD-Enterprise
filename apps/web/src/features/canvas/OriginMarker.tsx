import { Circle, Line, Text } from 'react-konva';

import { ORIGIN, type ScreenSize, type Viewport, worldToScreen } from '@mfd/cad-engine';

import { CANVAS_THEME } from './canvasTheme';

interface OriginMarkerProps {
  readonly viewport: Viewport;
  readonly screen: ScreenSize;
}

/**
 * The model origin (0, 0) and its axes.
 *
 * Every dimension in a facility drawing is ultimately measured from a datum. Making
 * that datum visible from the first sprint means later features — room boundaries,
 * equipment placement, clearance envelopes — never have to invent one.
 */
export function OriginMarker({ viewport, screen }: OriginMarkerProps) {
  const origin = worldToScreen(viewport, ORIGIN);

  const xAxisVisible = origin.y >= 0 && origin.y <= screen.height;
  const yAxisVisible = origin.x >= 0 && origin.x <= screen.width;

  const x = Math.round(origin.x) + 0.5;
  const y = Math.round(origin.y) + 0.5;

  return (
    <>
      {xAxisVisible && (
        <Line
          points={[0, y, screen.width, y]}
          stroke={CANVAS_THEME.axisX}
          strokeWidth={1}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
      {yAxisVisible && (
        <Line
          points={[x, 0, x, screen.height]}
          stroke={CANVAS_THEME.axisY}
          strokeWidth={1}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
      {xAxisVisible && yAxisVisible && (
        <>
          <Circle
            x={origin.x}
            y={origin.y}
            radius={3}
            fill={CANVAS_THEME.originDot}
            listening={false}
            perfectDrawEnabled={false}
          />
          <Text
            x={origin.x + 8}
            y={origin.y + 6}
            text="0, 0"
            fontSize={11}
            fontFamily="ui-monospace, monospace"
            fill={CANVAS_THEME.originLabel}
            listening={false}
            perfectDrawEnabled={false}
          />
        </>
      )}
    </>
  );
}
