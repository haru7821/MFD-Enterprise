import { useEffect, useRef } from 'react';
import { Layer, Stage } from 'react-konva';

import { catalog } from '@mfd/object-library/catalog';
import type { EvaluationReport } from '@mfd/rule-engine';

import { useEditor } from '@/editor/useEditor';
import { EquipmentLayer } from '@/features/equipment/EquipmentLayer';
import { ValidationOverlay } from '@/features/validation/ValidationOverlay';

import { GridLayer } from './GridLayer';
import { NavigationHint } from './NavigationHint';
import { OriginMarker } from './OriginMarker';
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
          <Layer listening={false}>
            {state.showGrid && <GridLayer viewport={state.viewport} screen={size} />}
            <OriginMarker viewport={state.viewport} screen={size} />
            <EquipmentLayer
              placements={state.placements}
              catalog={catalog}
              viewport={state.viewport}
              screen={size}
              selectedPlacementId={state.selectedPlacementId}
            />
            <ValidationOverlay
              report={report}
              placements={state.placements}
              catalog={catalog}
              viewport={state.viewport}
            />
          </Layer>
        </Stage>
      )}

      <ScaleBar viewport={state.viewport} />
      <NavigationHint />
    </div>
  );
}
