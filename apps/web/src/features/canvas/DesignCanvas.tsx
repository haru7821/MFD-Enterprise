import { useEffect, useRef } from 'react';
import { Layer, Stage } from 'react-konva';

import { catalog } from '@mfd/object-library/catalog';
import type { EvaluationReport } from '@mfd/rule-engine';

import { activeLevel, isTracingTool, planDisplayTransform } from '@/editor/editorState';
import { useEditor } from '@/editor/useEditor';
import { EquipmentLayer } from '@/features/equipment/EquipmentLayer';
import { CalibrationOverlay } from '@/features/plan/CalibrationOverlay';
import { PlanLayer } from '@/features/plan/PlanLayer';
import { DraftRoomLayer } from '@/features/space/DraftRoomLayer';
import { SpaceLayer } from '@/features/space/SpaceLayer';
import { ValidationOverlay } from '@/features/validation/ValidationOverlay';

import { GridLayer } from './GridLayer';
import { NavigationHint } from './NavigationHint';
import { OriginMarker } from './OriginMarker';
import { ReferencePointLayer } from './ReferencePointLayer';
import { ScaleBar } from './ScaleBar';
import { useCanvasInteraction } from './useCanvasInteraction';
import { useElementSize } from './useElementSize';

/**
 * The drawing surface.
 *
 * Konva is given screen coordinates only. The Stage is never scaled or translated —
 * zoom and pan live in the viewport held by the editor state, and every position on
 * screen is derived from millimetres by cad-engine. That is what keeps PDF and DXF
 * export possible later: the geometry is not trapped inside the renderer.
 */
export function DesignCanvas({ report }: { readonly report: EvaluationReport }) {
  const { state, dispatch } = useEditor();
  const level = activeLevel(state);
  const containerRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(containerRef);
  const { isSpacePanReady } = useCanvasInteraction(containerRef);

  useEffect(() => {
    dispatch({ type: 'screen/resize', size });
  }, [dispatch, size]);

  const cursor = state.isPanning
    ? 'cursor-grabbing'
    : state.activeTool === 'pan' || isSpacePanReady
      ? 'cursor-grab'
      : 'cursor-crosshair';

  const planTransform = planDisplayTransform(state);

  const isMeasured = size.width > 0 && size.height > 0;

  return (
    <div
      ref={containerRef}
      className={`canvas-surface relative h-full w-full overflow-hidden bg-canvas ${cursor}`}
      role="application"
      aria-label="Design canvas"
    >
      {isMeasured && (
        <Stage width={size.width} height={size.height}>
          {/*
            Layer order is the drawing's reading order: the plan is context, the
            building sits on it, the equipment sits in the building, and the findings
            sit on top of everything because they are what stops an installation.
          */}
          <Layer listening={false}>
            {state.showPlan && (
              <PlanLayer
                planImage={level.planImage}
                transform={planTransform}
                viewport={state.viewport}
                opacity={0.55}
              />
            )}
            {state.showGrid && <GridLayer viewport={state.viewport} screen={size} />}
            <OriginMarker viewport={state.viewport} screen={size} />
            <SpaceLayer
              level={level}
              viewport={state.viewport}
              selectedBoundaryId={state.selectedBoundaryId}
              selectedVertex={state.selectedVertex}
              showHandles={!isTracingTool(state)}
            />
            <EquipmentLayer
              placements={level.placements}
              catalog={catalog}
              viewport={state.viewport}
              screen={size}
              selectedPlacementId={state.selectedPlacementId}
            />
            {/*
              Above the equipment and below the findings. A reference point is context for the
              layout rather than part of it, and it must never sit over a finding — the findings
              are what stop an installation.
            */}
            <ReferencePointLayer
              points={level.referencePoints}
              viewport={state.viewport}
              selectedReferencePointId={state.selectedReferencePointId}
            />
            <ValidationOverlay
              report={report}
              placements={level.placements}
              catalog={catalog}
              viewport={state.viewport}
            />
            <DraftRoomLayer
              vertices={state.draftRoomVertices}
              cursorScreen={state.cursorScreen}
              viewport={state.viewport}
            />
            {state.pick?.kind === 'calibrate' && (
              <CalibrationOverlay
                points={state.pick.points}
                transform={planTransform}
                viewport={state.viewport}
                cursorScreen={state.cursorScreen}
              />
            )}
          </Layer>
        </Stage>
      )}

      <ScaleBar viewport={state.viewport} />
      <NavigationHint />
    </div>
  );
}
