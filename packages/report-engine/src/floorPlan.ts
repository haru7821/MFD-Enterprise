import { pixelToModel, polygonArea } from '@mfd/cad-engine';
import type { Level, Placement } from '@mfd/document-model';
import { findSpace, obstructionBoundaries, planTransformOf, spaceArea } from '@mfd/document-model';
import type { Catalog, EquipmentObject } from '@mfd/object-library';
import { footprintCentre, footprintCorners } from '@mfd/object-library';

import type { LabelKey } from './labels';
import type {
  FloorPlanSection,
  LevelGeometry,
  RasterPlacement,
  ObstructionRow,
  PlacementRow,
  Polyline,
  ReferencePointRow,
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

  /*
   * A reference point is a single-point polyline — a mark, not an outline. Modelling it as a
   * degenerate Polyline rather than adding a Point type keeps every renderer's geometry handling
   * uniform: they already know how to transform a list of points into page space.
   */
  const referencePoints: Polyline[] = level.referencePoints.map((point) => ({
    points: [{ x: point.position.x, y: point.position.y }],
    label: point.label ?? '',
  }));

  /*
   * The extent covers rooms, obstructions and equipment — **not** reference points. A panel in a
   * corridor outside the traced rooms would otherwise stretch the bounding box and shrink the
   * layout the reader came to see. A clipped mark is the better trade, and the table below lists
   * every point with its coordinates regardless.
   */
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

  return { rooms, obstructions, equipment, referencePoints, extent };
}

/** Kind → label key. A `Record` rather than a template literal, so a new kind fails to compile. */
const REFERENCE_POINT_LABELS = {
  ro_supply: 'ref_ro_supply',
  ro_return: 'ref_ro_return',
  drain: 'ref_drain',
  electrical_panel: 'ref_electrical_panel',
  data: 'ref_data',
  access_entry: 'ref_access_entry',
  staff_base: 'ref_staff_base',
} as const satisfies Record<ReferencePointRow['kind'], LabelKey>;

function referencePointRows(level: Level): ReferencePointRow[] {
  return level.referencePoints.map((point) => ({
    kind: point.kind,
    kindLabel: REFERENCE_POINT_LABELS[point.kind],
    label: point.label,
    position: { x: point.position.x, y: point.position.y },
  }));
}

/**
 * Where the scan sits in model millimetres.
 *
 * The image's top-left pixel through the plan transform gives the origin; its pixel dimensions
 * scaled by mm/px give the size. Rotation comes straight from the mapping, because the transform
 * rotates *about the origin pixel* and so does an SVG or PDF image placed at that point — which
 * is why this returns a rectangle and an angle rather than four corners.
 *
 * Null without a mapping: an uncalibrated scan has no millimetres in it, so there is no honest
 * place to put it. The report says the level is uncalibrated instead.
 */
function rasterPlacement(level: Level): RasterPlacement | null {
  const { planImage, coordinateMapping } = level;
  if (!planImage || !coordinateMapping) return null;

  const transform = planTransformOf(level);
  if (!transform) return null;

  const topLeft = pixelToModel(transform, { x: 0, y: 0 });

  return {
    x: topLeft.x,
    y: topLeft.y,
    width: planImage.pixelWidth * coordinateMapping.millimetresPerPixel,
    height: planImage.pixelHeight * coordinateMapping.millimetresPerPixel,
    rotationDegrees: coordinateMapping.rotation / 1_000,
    dataUrl: planImage.dataUrl,
  };
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

/**
 * The schedule's position column — the footprint's true centre, rounded, or the raw
 * `transform.position` when the catalogue has nothing for this placement, since a schedule row
 * still needs a number even for equipment the catalogue does not describe.
 *
 * > Owner decision, AD-21 routing/report anchor follow-up.
 */
function scheduledPosition(
  placement: Placement,
  object: EquipmentObject | undefined,
): { readonly x: number; readonly y: number } {
  const point = object ? footprintCentre(object, placement.transform) : placement.transform.position;
  return { x: Math.round(point.x), y: Math.round(point.y) };
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
      position: scheduledPosition(placement, object),
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
    // Three states, not two. A level with no drawing is not "uncalibrated" — its geometry is
    // exact, it simply has no plan behind it. Collapsing the two made the report warn about
    // the default project, which is how a reader learns to ignore warnings.
    planStatus:
      planImage === null ? 'none' : coordinateMapping === null ? 'uncalibrated' : 'calibrated',
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
    referencePoints: referencePointRows(level),
    geometry: geometryOf(level, catalog, numbers),
    raster: rasterPlacement(level),
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
