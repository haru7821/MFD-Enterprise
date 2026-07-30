import { polygonArea } from '@mfd/cad-engine';
import type { Level } from '@mfd/document-model';
import { findSpace, obstructionBoundaries, spaceArea } from '@mfd/document-model';
import type { Catalog } from '@mfd/object-library';
import { footprintCorners } from '@mfd/object-library';

import type {
  FloorPlanSection,
  LevelGeometry,
  ObstructionRow,
  PlacementRow,
  Polyline,
  RoomRow,
} from './model';

/**
 * Section 4 — the floor plan, its provenance, and the numbered placement table.
 *
 * ## Numbering is the point of this section
 *
 * Every machine gets a number, and the same number appears on the drawing, in the placement
 * table and against every finding about it. Without that, a reader has a page of circles and
 * a page of rows and has to do the join by eye — which is the difference between a report
 * somebody uses and a report somebody files.
 *
 * Numbers are **per level and stable within a level**: they follow the document's placement
 * order, which is the order the engineer created them in. Not sorted by position, because a
 * machine that moves 200 mm must not renumber the whole room and make an already-issued
 * revision of this report disagree with the next one.
 *
 * ## What "no drawing" and "not calibrated" mean here
 *
 * Both are reported, never elided:
 *
 * | State | The report says |
 * | --- | --- |
 * | No plan imported | The layout was drawn without a floor plan behind it |
 * | Plan, no mapping | **Nothing on this level has been checked against the building** |
 *
 * Those are different situations. An engineer laying a room out in millimetres with no
 * drawing has exact geometry; a half-imported plan looks like a measured drawing and is not.
 */

/** Square metres, two decimals — the unit a room is discussed in. */
function squareMetres(areaSquareMillimetres: number): number {
  return Math.round((areaSquareMillimetres / 1_000_000) * 100) / 100;
}

/** Millidegrees to whole degrees. Storage precision is not a report figure. */
function degrees(millidegrees: number): number {
  return Math.round(millidegrees / 1_000);
}

function geometryOf(level: Level, catalog: Catalog, numbers: Map<string, number>): LevelGeometry {
  const rooms: Polyline[] = [];
  const obstructions: Polyline[] = [];

  for (const boundary of level.boundaries) {
    const polyline = { points: boundary.vertices.map((v) => ({ x: v.x, y: v.y })), label: boundary.label };
    if (boundary.kind === 'space_outline') rooms.push(polyline);
    else obstructions.push(polyline);
  }

  const equipment: Polyline[] = [];
  for (const placement of level.placements) {
    const object = catalog.get(placement.equipmentObjectId);
    if (!object) continue;
    equipment.push({
      points: footprintCorners(object, placement.transform).map((v) => ({ x: v.x, y: v.y })),
      // The number, not the label: the drawing is where space is scarcest, and the
      // placement table carries the name.
      label: String(numbers.get(placement.id) ?? ''),
    });
  }

  const points = [...rooms, ...obstructions, ...equipment].flatMap((line) => line.points);
  const extent =
    points.length === 0
      ? null
      : {
          minX: Math.min(...points.map((p) => p.x)),
          minY: Math.min(...points.map((p) => p.y)),
          maxX: Math.max(...points.map((p) => p.x)),
          maxY: Math.max(...points.map((p) => p.y)),
        };

  return { rooms, obstructions, equipment, extent };
}

/**
 * Placement numbers for one level.
 *
 * Exported because the validation section needs the same map — a finding cites the number
 * the drawing shows, and two independent numberings would be worse than none.
 */
export function placementNumbers(level: Level): Map<string, number> {
  return new Map(level.placements.map((placement, index) => [placement.id, index + 1]));
}

export function buildFloorPlan(level: Level, catalog: Catalog): FloorPlanSection {
  const numbers = placementNumbers(level);

  const placements: PlacementRow[] = level.placements.map((placement) => {
    const object = catalog.get(placement.equipmentObjectId);
    const space = placement.spaceId ? findSpace(level, placement.spaceId) : null;

    return {
      number: numbers.get(placement.id) ?? 0,
      placementId: placement.id,
      label: placement.label,
      // The id rather than a blank: a placement whose record has gone is a data problem
      // the schedule also names, and hiding it here would make the tables disagree.
      model: object?.model ?? placement.equipmentObjectId,
      position: { x: Math.round(placement.transform.position.x), y: Math.round(placement.transform.position.y) },
      rotationDegrees: degrees(placement.transform.rotation),
      mirrored: placement.transform.mirrored,
      room: space?.name ?? null,
    };
  });

  const rooms: RoomRow[] = level.spaces.flatMap((space) => {
    const area = spaceArea(level, space);
    const boundary = level.boundaries.find((candidate) => candidate.id === space.boundaryId);
    if (area === null || !boundary) return [];
    return [
      {
        name: space.name,
        function: space.function,
        areaSquareMetres: squareMetres(area),
        vertexCount: boundary.vertices.length,
      },
    ];
  });

  const obstructions: ObstructionRow[] = obstructionBoundaries(level).map((boundary) => ({
    label: boundary.label,
    obstructionType: boundary.obstructionType ?? 'unknown',
    areaSquareMetres: squareMetres(Math.abs(polygonArea(boundary.vertices))),
  }));

  const { planImage, coordinateMapping } = level;

  return {
    levelId: level.id,
    levelName: level.name,
    elevation: level.elevation,
    drawing: planImage
      ? {
          sourceFileName: planImage.sourceFileName,
          sourceFormat: planImage.sourceFormat,
          pageIndex: planImage.pageIndex,
          pixelWidth: planImage.pixelWidth,
          pixelHeight: planImage.pixelHeight,
          importedAt: planImage.importedAt,
          dataUrl: planImage.dataUrl,
        }
      : null,
    calibration: coordinateMapping
      ? {
          method: coordinateMapping.calibration.method,
          millimetresPerPixel: coordinateMapping.millimetresPerPixel,
          knownDistance: coordinateMapping.calibration.knownDistance,
          statedRatio: coordinateMapping.calibration.statedRatio,
          dotsPerInch: coordinateMapping.calibration.dotsPerInch,
          calibratedAt: coordinateMapping.calibration.calibratedAt,
        }
      : null,
    mapping: coordinateMapping
      ? {
          originPixel: coordinateMapping.origin,
          rotation: coordinateMapping.rotation,
          mappedAt: coordinateMapping.mappedAt,
        }
      : null,
    placements,
    rooms,
    obstructions,
    geometry: geometryOf(level, catalog, numbers),
  };
}

/**
 * A level whose drawing was imported but never calibrated.
 *
 * The one state the report must never present as ordinary. `'none'` — no drawing at all —
 * is not this: that layout's geometry is exact, it simply has no plan behind it.
 */
export function isUncalibrated(level: Level): boolean {
  return level.planImage !== null && level.coordinateMapping === null;
}
