import { useMemo } from 'react';
import { Line } from 'react-konva';

import { type Viewport, worldToScreen } from '@mfd/cad-engine';
import type { Placement } from '@mfd/document-model';
import { type Catalog, footprintCorners } from '@mfd/object-library';
import type { EvaluationReport, ResultLevel } from '@mfd/rule-engine';

import { LEVEL_ORDER, RESULT_THEME } from './validationTheme';

interface ValidationOverlayProps {
  readonly report: EvaluationReport;
  readonly placements: readonly Placement[];
  readonly catalog: Catalog;
  readonly viewport: Viewport;
}

/**
 * Marks placements that carry a finding.
 *
 * A placement can appear in several results — four clearance sides plus a
 * collision — so it is drawn at its **worst** level. Showing the average, or the
 * first, would let a RED hide behind a YELLOW.
 *
 * GREEN is deliberately not drawn. Outlining everything that passes turns the
 * canvas into a colour chart and buries the two objects that need attention.
 *
 * The outline carries no fill. The equipment already fills its own footprint to
 * show whether its data is provisional, and a second translucent layer in a
 * near-identical amber turned that into mud — the YELLOW of a finding and the
 * amber of draft data are hard enough to tell apart without stacking them.
 */
export function ValidationOverlay({
  report,
  placements,
  catalog,
  viewport,
}: ValidationOverlayProps) {
  const worstByPlacement = useMemo(() => {
    const worst = new Map<string, ResultLevel>();

    for (const result of report.results) {
      if (result.level === 'GREEN') continue;

      for (const placementId of result.placementIds) {
        const current = worst.get(placementId);
        if (!current || LEVEL_ORDER[result.level] < LEVEL_ORDER[current]) {
          worst.set(placementId, result.level);
        }
      }
    }

    return worst;
  }, [report]);

  return (
    <>
      {placements.map((placement) => {
        const level = worstByPlacement.get(placement.id);
        if (!level) return null;

        const object = catalog.get(placement.equipmentObjectId);
        if (!object) return null;

        const points = footprintCorners(object, placement.transform).flatMap((corner) => {
          const screen = worldToScreen(viewport, corner);
          return [screen.x, screen.y];
        });

        return (
          <Line
            key={`validation-${placement.id}`}
            points={points}
            closed
            stroke={RESULT_THEME[level].stroke}
            strokeWidth={2.5}
            listening={false}
            perfectDrawEnabled={false}
          />
        );
      })}
    </>
  );
}
