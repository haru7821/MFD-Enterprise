import { Fragment } from 'react';
import { Circle, Line, Text } from 'react-konva';

import {
  type Vec2,
  type Viewport,
  polygonBounds,
  polygonCentroid,
  worldToScreen,
  worldToScreenLength,
} from '@mfd/cad-engine';
import type { Boundary, Level } from '@mfd/document-model';

import { MIN_PIXELS_FOR_ROOM_LABEL, SPACE_THEME } from './spaceTheme';

/**
 * Rooms, walls and obstructions.
 *
 * Drawn beneath the equipment: the building is context, the machines are the subject
 * of the review.
 *
 * Every coordinate here goes through `worldToScreen`. Konva is handed pixels and never
 * a model coordinate, so a room outline and a machine footprint cannot end up placed
 * by two different rules (AD-2).
 */

function flatten(vertices: readonly Vec2[], viewport: Viewport): number[] {
  const points: number[] = [];
  for (const vertex of vertices) {
    const screen = worldToScreen(viewport, vertex);
    points.push(screen.x, screen.y);
  }
  return points;
}

export interface SpaceLayerProps {
  readonly level: Level;
  readonly viewport: Viewport;
  /**
   * Drives every highlight, including a room's.
   *
   * Room selection is not passed separately: selecting a room selects its boundary, so
   * a second source of "which thing is highlighted" could only ever disagree with this
   * one.
   */
  readonly selectedBoundaryId: string | null;
  readonly selectedVertex: { readonly boundaryId: string; readonly index: number } | null;
  /**
   * Whether the editing handles are drawn.
   *
   * False while a tracing tool is active, because a click then starts the next ring
   * rather than grabbing a handle. Drawing handles that cannot be grabbed is a UI that
   * lies about what a click will do — worse than no handles at all.
   */
  readonly showHandles: boolean;
}

function BoundaryShape({
  boundary,
  viewport,
  isSelected,
}: {
  readonly boundary: Boundary;
  readonly viewport: Viewport;
  readonly isSelected: boolean;
}) {
  const isObstruction = boundary.kind !== 'space_outline';
  const palette = isObstruction
    ? SPACE_THEME.obstruction
    : isSelected
      ? SPACE_THEME.selected
      : SPACE_THEME.outline;

  return (
    <Line
      points={flatten(boundary.vertices, viewport)}
      closed
      fill={palette.fill}
      stroke={palette.stroke}
      strokeWidth={isSelected ? 2 : 1.25}
      {...(isObstruction ? { dash: [...SPACE_THEME.obstruction.dash] } : {})}
      listening={false}
    />
  );
}

export function SpaceLayer({
  level,
  viewport,
  selectedBoundaryId,
  selectedVertex,
  showHandles,
}: SpaceLayerProps) {
  const boundaryById = new Map(level.boundaries.map((boundary) => [boundary.id, boundary]));
  const editing =
    !showHandles || selectedBoundaryId === null ? null : boundaryById.get(selectedBoundaryId);

  return (
    <>
      {level.boundaries.map((boundary) => (
        <BoundaryShape
          key={boundary.id}
          boundary={boundary}
          viewport={viewport}
          isSelected={boundary.id === selectedBoundaryId}
        />
      ))}

      {level.spaces.map((space) => {
        const boundary = boundaryById.get(space.boundaryId);
        if (!boundary) return null;

        const bounds = polygonBounds(boundary.vertices);
        const centre = polygonCentroid(boundary.vertices);
        if (!bounds || !centre) return null;

        // A label wider than the room it names is noise, not information.
        const widthOnScreen = worldToScreenLength(viewport, bounds.width);
        if (widthOnScreen < MIN_PIXELS_FOR_ROOM_LABEL) return null;

        const anchor = worldToScreen(viewport, centre);
        return (
          <Fragment key={space.id}>
            <Text
              x={anchor.x - widthOnScreen / 2}
              y={anchor.y - 8}
              width={widthOnScreen}
              align="center"
              text={space.name}
              fontSize={12}
              fontFamily="ui-sans-serif, system-ui, sans-serif"
              fill={SPACE_THEME.outline.label}
              listening={false}
            />
            <Text
              x={anchor.x - widthOnScreen / 2}
              y={anchor.y + 6}
              width={widthOnScreen}
              align="center"
              text={space.function.replace(/_/g, ' ')}
              fontSize={10}
              fontFamily="ui-monospace, monospace"
              fill={SPACE_THEME.outline.label}
              opacity={0.6}
              listening={false}
            />
          </Fragment>
        );
      })}

      {/*
        Editing handles on the selected boundary.
        Midpoints first, so a vertex handle overlapping one is the shape drawn on top —
        which matches the hit-testing order in useCanvasInteraction. Handles that looked
        one way and hit-tested another would be worse than none.
      */}
      {editing?.vertices.map((vertex, index) => {
        const next = editing.vertices[(index + 1) % editing.vertices.length];
        if (!next) return null;
        const midpoint = worldToScreen(viewport, {
          x: (vertex.x + next.x) / 2,
          y: (vertex.y + next.y) / 2,
        });

        return (
          <Circle
            key={`mid-${editing.id}-${index}`}
            x={midpoint.x}
            y={midpoint.y}
            radius={3}
            stroke={SPACE_THEME.vertexHandle.fill}
            strokeWidth={1}
            listening={false}
          />
        );
      })}

      {editing?.vertices.map((vertex, index) => {
        const screen = worldToScreen(viewport, vertex);
        const isActive =
          selectedVertex?.boundaryId === editing.id && selectedVertex.index === index;

        return (
          <Circle
            key={`vertex-${editing.id}-${index}`}
            x={screen.x}
            y={screen.y}
            radius={isActive ? 5.5 : 4}
            fill={isActive ? SPACE_THEME.selected.stroke : SPACE_THEME.vertexHandle.fill}
            stroke={SPACE_THEME.vertexHandle.stroke}
            strokeWidth={1}
            listening={false}
          />
        );
      })}
    </>
  );
}
