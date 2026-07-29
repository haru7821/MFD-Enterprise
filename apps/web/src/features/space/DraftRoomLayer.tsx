import { Circle, Line, Text } from 'react-konva';

import {
  type Vec2,
  type Viewport,
  formatLength,
  polygonArea,
  screenToWorld,
  worldToScreen,
} from '@mfd/cad-engine';

import { CLOSE_TARGET_RADIUS_PX, SPACE_THEME } from './spaceTheme';

/**
 * The room being traced.
 *
 * Shows three things an engineer needs while drawing and cannot get afterwards: where
 * the ring will close, how long the segment they are currently drawing is, and what
 * the enclosed area comes to. Without the running length, tracing a wall from a plan
 * is guesswork with a mouse.
 */

export interface DraftRoomLayerProps {
  readonly vertices: readonly Vec2[];
  readonly cursorScreen: Vec2 | null;
  readonly viewport: Viewport;
}

export function DraftRoomLayer({ vertices, cursorScreen, viewport }: DraftRoomLayerProps) {
  const first = vertices[0];
  if (!first) return null;

  const screenVertices = vertices.map((vertex) => worldToScreen(viewport, vertex));
  const firstScreen = worldToScreen(viewport, first);
  const last = vertices[vertices.length - 1];

  const cursorWorld = cursorScreen ? screenToWorld(viewport, cursorScreen) : null;
  const canClose = vertices.length >= 3;
  const isOverClose =
    canClose &&
    cursorScreen !== null &&
    Math.hypot(cursorScreen.x - firstScreen.x, cursorScreen.y - firstScreen.y) <=
      CLOSE_TARGET_RADIUS_PX;

  const traced: number[] = screenVertices.flatMap((point) => [point.x, point.y]);

  // The provisional ring, including the pointer, so the area readout is live.
  const provisional = cursorWorld && !isOverClose ? [...vertices, cursorWorld] : vertices;
  const area = provisional.length >= 3 ? polygonArea(provisional) : 0;

  const segmentLength =
    last && cursorWorld ? Math.hypot(cursorWorld.x - last.x, cursorWorld.y - last.y) : null;

  return (
    <>
      {traced.length >= 4 && (
        <Line
          points={traced}
          stroke={SPACE_THEME.draft.stroke}
          strokeWidth={1.5}
          listening={false}
        />
      )}

      {cursorScreen && last && (
        <Line
          points={[
            worldToScreen(viewport, last).x,
            worldToScreen(viewport, last).y,
            isOverClose ? firstScreen.x : cursorScreen.x,
            isOverClose ? firstScreen.y : cursorScreen.y,
          ]}
          stroke={SPACE_THEME.draft.guide}
          strokeWidth={1.5}
          dash={[6, 4]}
          listening={false}
        />
      )}

      {/* The closing edge, shown once the ring could be closed. */}
      {canClose && cursorScreen && !isOverClose && (
        <Line
          points={[cursorScreen.x, cursorScreen.y, firstScreen.x, firstScreen.y]}
          stroke={SPACE_THEME.draft.guide}
          strokeWidth={1}
          dash={[3, 5]}
          opacity={0.6}
          listening={false}
        />
      )}

      {screenVertices.map((point, index) => (
        <Circle
          key={index}
          x={point.x}
          y={point.y}
          radius={index === 0 && canClose ? CLOSE_TARGET_RADIUS_PX / 2 + 1 : 3}
          fill={index === 0 && canClose ? SPACE_THEME.draft.closeTarget : SPACE_THEME.draft.vertex}
          listening={false}
        />
      ))}

      {cursorScreen && (segmentLength !== null || area > 0) && (
        <Text
          x={cursorScreen.x + 14}
          y={cursorScreen.y + 14}
          text={
            [
              segmentLength !== null ? formatLength(segmentLength) : null,
              area > 0 ? `${(area / 1_000_000).toFixed(2)} m²` : null,
              isOverClose ? 'click to close' : null,
            ]
              .filter((line): line is string => line !== null)
              .join('\n')
          }
          fontSize={11}
          fontFamily="ui-monospace, monospace"
          fill={SPACE_THEME.draft.stroke}
          listening={false}
        />
      )}
    </>
  );
}
