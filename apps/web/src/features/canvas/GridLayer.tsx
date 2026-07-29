import { useMemo } from 'react';
import { Shape } from 'react-konva';
import type { Context } from 'konva/lib/Context';
import type { Shape as KonvaShape } from 'konva/lib/Shape';

import {
  type Millimetres,
  type ScreenSize,
  type Viewport,
  computeGridLines,
  worldToScreen,
} from '@mfd/cad-engine';

import { CANVAS_THEME } from './canvasTheme';

interface GridLayerProps {
  readonly viewport: Viewport;
  readonly screen: ScreenSize;
}

/**
 * Draws the millimetre grid.
 *
 * Two Konva shapes — one for minor lines, one for major — each painting every line
 * in a single path. The obvious alternative (one <Line> per grid line) creates
 * hundreds of scene-graph nodes that are re-diffed on every pan; this stays flat
 * regardless of zoom.
 *
 * Note what this component does *not* do: it never decides where a line goes. The
 * positions come from cad-engine in millimetres and are converted here, which is
 * architecture decision AD-2 in practice.
 */
export function GridLayer({ viewport, screen }: GridLayerProps) {
  const lines = useMemo(() => computeGridLines(viewport, screen), [viewport, screen]);

  const paint =
    (xs: readonly Millimetres[], ys: readonly Millimetres[]) =>
    (context: Context, shape: KonvaShape) => {
      context.beginPath();

      for (const worldX of xs) {
        // Whole pixel + 0.5 keeps a 1 px line on a single device pixel row.
        const x = Math.round(worldToScreen(viewport, { x: worldX, y: 0 }).x) + 0.5;
        context.moveTo(x, 0);
        context.lineTo(x, screen.height);
      }

      for (const worldY of ys) {
        const y = Math.round(worldToScreen(viewport, { x: 0, y: worldY }).y) + 0.5;
        context.moveTo(0, y);
        context.lineTo(screen.width, y);
      }

      context.strokeShape(shape);
    };

  return (
    <>
      <Shape
        sceneFunc={paint(lines.minorX, lines.minorY)}
        stroke={CANVAS_THEME.gridMinor}
        strokeWidth={1}
        listening={false}
        perfectDrawEnabled={false}
      />
      <Shape
        sceneFunc={paint(lines.majorX, lines.majorY)}
        stroke={CANVAS_THEME.gridMajor}
        strokeWidth={1}
        listening={false}
        perfectDrawEnabled={false}
      />
    </>
  );
}
