import type { PlanTransform, Vec2 } from '@mfd/cad-engine';
import {
  millimetresPerPixelFromRatio,
  millimetresPerPixelFromTwoPoints,
  parseStatedRatio,
} from '@mfd/cad-engine';

import { requireLevel } from './document';
import type { CoordinateMapping, Level, MfdDocument, PlanImage, ScaleCalibration } from './schema';

/**
 * Plan import and calibration.
 *
 * ## Why these are not undo commands
 *
 * Owner decision, recorded here because it will look like an omission otherwise:
 * importing a plan and calibrating it sit outside the undo stack.
 *
 * Undoing a calibration would leave every placement at a millimetre position derived
 * from a mapping that no longer exists — geometry silently reinterpreted, which is
 * the exact failure this product exists to prevent. Both acts are explicit and
 * deliberate, both are re-doable by repeating them, and neither happens by accident
 * mid-drag the way a move does.
 *
 * ## The four steps
 *
 * | | Step | Produces |
 * | --- | --- | --- |
 * | 1 | Import the drawing | `PlanImage` |
 * | 2 | Set the scale | `millimetresPerPixel` |
 * | 3 | Set the origin | `origin` |
 * | 4 | Square the drawing | `rotation` |
 *
 * **Step 2 cannot be skipped.** Until a mapping exists the level is uncalibrated, and
 * every rule evaluated against it returns YELLOW with "plan not calibrated" rather
 * than GREEN. Steps 3 and 4 default to the top-left pixel and no rotation, which are
 * honest defaults: a plan measured from its own corner is still correctly measured.
 */

function updateLevel(
  document: MfdDocument,
  levelId: string,
  update: (level: Level) => Level,
): MfdDocument {
  requireLevel(document, levelId);

  return {
    ...document,
    project: {
      ...document.project,
      levels: document.project.levels.map((level) =>
        level.id === levelId ? update(level) : level,
      ),
    },
  };
}

/**
 * Attach an imported drawing to a level.
 *
 * Any existing calibration is discarded. A mapping describes a specific image: keeping
 * it across a re-import would apply one drawing's scale to another's pixels, and every
 * measurement taken afterwards would be wrong while looking entirely normal.
 */
export function setPlanImage(
  document: MfdDocument,
  levelId: string,
  planImage: PlanImage,
): MfdDocument {
  return updateLevel(document, levelId, (level) => ({
    ...level,
    planImage,
    coordinateMapping: null,
  }));
}

export function clearPlanImage(document: MfdDocument, levelId: string): MfdDocument {
  return updateLevel(document, levelId, (level) => ({
    ...level,
    planImage: null,
    coordinateMapping: null,
  }));
}

export function setCoordinateMapping(
  document: MfdDocument,
  levelId: string,
  mapping: CoordinateMapping | null,
): MfdDocument {
  return updateLevel(document, levelId, (level) => ({ ...level, coordinateMapping: mapping }));
}

/** Move the model origin without disturbing the scale or rotation. */
export function setMappingOrigin(
  document: MfdDocument,
  levelId: string,
  origin: Vec2,
): MfdDocument {
  return updateLevel(document, levelId, (level) =>
    level.coordinateMapping
      ? { ...level, coordinateMapping: { ...level.coordinateMapping, origin } }
      : level,
  );
}

/** Square the drawing to the model axes without disturbing the scale or origin. */
export function setMappingRotation(
  document: MfdDocument,
  levelId: string,
  rotation: number,
): MfdDocument {
  return updateLevel(document, levelId, (level) =>
    level.coordinateMapping
      ? { ...level, coordinateMapping: { ...level.coordinateMapping, rotation } }
      : level,
  );
}

export interface TwoPointCalibrationInput {
  readonly pointA: Vec2;
  readonly pointB: Vec2;
  /** The real-world distance between the two picked points, millimetres. */
  readonly knownDistance: number;
  readonly now: string;
  readonly origin?: Vec2;
  readonly rotation?: number;
}

/**
 * Build a mapping from two picked points and a typed distance.
 *
 * Returns null when the input cannot produce a usable scale — two identical points,
 * or a distance of zero. Returning a degenerate mapping would leave the level looking
 * calibrated while every measurement taken from it was meaningless, which is strictly
 * worse than leaving it uncalibrated and saying so.
 */
export function calibrateFromTwoPoints(
  input: TwoPointCalibrationInput,
): CoordinateMapping | null {
  const millimetresPerPixel = millimetresPerPixelFromTwoPoints(
    input.pointA,
    input.pointB,
    input.knownDistance,
  );
  if (millimetresPerPixel === null) return null;

  const calibration: ScaleCalibration = {
    method: 'two-point',
    pointA: input.pointA,
    pointB: input.pointB,
    knownDistance: input.knownDistance,
    statedRatio: null,
    dotsPerInch: null,
    calibratedAt: input.now,
  };

  return {
    millimetresPerPixel,
    origin: input.origin ?? { x: 0, y: 0 },
    rotation: input.rotation ?? 0,
    calibration,
    mappedAt: input.now,
  };
}

export interface StatedRatioCalibrationInput {
  /** As written on the drawing, e.g. "1:100". */
  readonly statedRatio: string;
  /** Resolution the drawing was rasterised at. */
  readonly dotsPerInch: number;
  readonly now: string;
  readonly origin?: Vec2;
  readonly rotation?: number;
}

/**
 * Build a mapping from the scale printed on the drawing.
 *
 * Weaker evidence than two-point: a plan is often printed or scanned at a size other
 * than the one its title block claims. The calibration record keeps the ratio and the
 * resolution so a reviewer can see which of the two methods was used.
 */
export function calibrateFromStatedRatio(
  input: StatedRatioCalibrationInput,
): CoordinateMapping | null {
  const ratio = parseStatedRatio(input.statedRatio);
  if (ratio === null) return null;

  const millimetresPerPixel = millimetresPerPixelFromRatio(ratio, input.dotsPerInch);
  if (millimetresPerPixel === null) return null;

  const calibration: ScaleCalibration = {
    method: 'stated-ratio',
    pointA: null,
    pointB: null,
    knownDistance: null,
    statedRatio: input.statedRatio,
    dotsPerInch: input.dotsPerInch,
    calibratedAt: input.now,
  };

  return {
    millimetresPerPixel,
    origin: input.origin ?? { x: 0, y: 0 },
    rotation: input.rotation ?? 0,
    calibration,
    mappedAt: input.now,
  };
}

/**
 * The bare geometric transform, for `@mfd/cad-engine`.
 *
 * A `CoordinateMapping` is the transform plus its provenance; nothing that computes
 * needs the provenance, so it is dropped at the boundary rather than threaded through
 * every geometry call.
 */
export function planTransformOf(level: Level): PlanTransform | null {
  const mapping = level.coordinateMapping;
  if (!mapping) return null;
  return {
    millimetresPerPixel: mapping.millimetresPerPixel,
    origin: mapping.origin,
    rotation: mapping.rotation,
  };
}
