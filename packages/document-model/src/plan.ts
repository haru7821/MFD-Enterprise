import type { PlanTransform, Vec2 } from '@mfd/cad-engine';
import {
  millimetresPerPixelFromRatio,
  millimetresPerPixelFromTwoPoints,
  parseStatedRatio,
} from '@mfd/cad-engine';

import { requireLevel } from './document';
import type {
  CalibrationMethod,
  CoordinateMapping,
  Level,
  MfdDocument,
  PlanImage,
  ScaleCalibration,
} from './schema';

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

/**
 * Which calibration route to use for this drawing.
 *
 * > Owner decision, Q-4: *"Implement both calibration methods: dimension-line calibration
 * > (preferred), printed drawing scale calibration (fallback). The application should
 * > automatically recommend the most reliable method available for each drawing."*
 *
 * ## What the application can and cannot work out for itself
 *
 * It **cannot** tell whether a drawing carries a dimension line. A PDF is rasterised and its vector
 * content is never read, so nothing in the file tells us. That is a question for the engineer, and
 * `hasDimensionLine` is how they answer it — `null` until they have looked.
 *
 * It **can** tell whether the printed-scale route is even possible, and this is the useful half.
 * Converting "1:100" into millimetres per pixel needs the resolution the image is stored at, and we
 * only know that for a PDF we rasterised ourselves. A scanned PNG carries no trustworthy statement
 * of the size it was scanned at, so the ratio cannot be converted at all — and offering the route
 * anyway would produce a mapping that measures nothing while looking calibrated.
 *
 * ## Why dimension-line is preferred whenever it exists
 *
 * It measures the drawing **as it actually is**. A printed scale describes the sheet as the author
 * intended it, before somebody printed it at 94 % to fit A3 or a scanner cropped a margin. Those
 * changes are invisible and they are common, so a stated ratio is a claim about a document's
 * history rather than a measurement of the file in front of us.
 *
 * ## The fourth outcome is the important one
 *
 * A raster scan with no dimension line has **no method at all**, and this returns exactly that
 * rather than nudging the engineer towards the weaker route. Uncalibrated is a state the whole
 * application already handles honestly — every rule YELLOW, never GREEN — and it is a better answer
 * than a scale derived from a resolution nobody recorded.
 */
export const CALIBRATION_ADVICE_CODES = [
  /** A dimension line was reported; measure against it. */
  'prefer_two_point',
  /** No dimension line, but the image's resolution is known, so the printed ratio converts. */
  'fallback_stated_ratio',
  /** No dimension line and an unknown resolution: neither route can produce a true scale. */
  'no_method_available',
  /** Nobody has said yet whether the drawing carries a dimension line. */
  'awaiting_dimension_line_answer',
  /** There is no drawing to calibrate. */
  'no_plan_image',
  /**
   * The title block names a paper size the file is not — Owner decision, calibration safety rule.
   *
   * The printed-scale route is refused outright, not merely ranked second. See
   * {@link paperSizeDisagrees}.
   */
  'paper_size_mismatch',
] as const;

export type CalibrationAdviceCode = (typeof CALIBRATION_ADVICE_CODES)[number];

export interface CalibrationAdvice {
  /** The method to offer first, or null when none can produce a true scale. */
  readonly recommended: CalibrationMethod | null;
  /** Every method that could be completed for this drawing, strongest first. */
  readonly available: readonly CalibrationMethod[];
  readonly code: CalibrationAdviceCode;
}

/**
 * Does the title block claim a paper size the file is not?
 *
 * > Owner decision: *"If a title block specifies a paper size, compare it against the actual PDF
 * > page size. If they do not match, the printed-scale calibration path must be rejected
 * > automatically and the application should recommend dimension-line calibration instead."*
 *
 * ## Why this is a refusal and not a warning
 *
 * Found by measuring the hospital dataset: of the six sheets whose title block names a paper size,
 * **three name one the file is not.** `Hospital_026`'s drawings print `A3 : 1/200` and are A4 —
 * plotted down to about 71 % of their stated size at some point in their history.
 *
 * Calibrating those from `1/200` produces every measurement roughly **41 % too large**, and nothing
 * on the drawing contradicts it: the plan looks right, the scale bar looks right, and a clearance
 * that is actually 850 mm reads as 1,200. A warning would be dismissed by the third drawing. The
 * conversion is arithmetic on a premise the file has already disproved, so it is refused.
 *
 * Both arguments are what the *drawing* and the *file* say. Neither is inferred: the claim comes
 * from a title block a person read, and the actual size from the page itself.
 */
export function paperSizeDisagrees(
  claimedSheetSize: string | null,
  actualSheetSize: string | null,
): boolean {
  // No claim, or a page that matches no standard size, is not a disagreement — it is silence, and
  // silence is the ordinary case on 212 of the 229 analysed sheets.
  if (claimedSheetSize === null || actualSheetSize === null) return false;
  return claimedSheetSize.trim().toUpperCase() !== actualSheetSize.trim().toUpperCase();
}

export interface CalibrationAdviceInput {
  readonly planImage: PlanImage | null;
  /**
   * Whether the drawing carries a printed dimension with a stated value.
   *
   * Null until an engineer has looked. Not inferred, because it cannot be: the vector content of a
   * PDF is never read, and guessing would decide the calibration route on no evidence.
   */
  readonly hasDimensionLine: boolean | null;
  /**
   * The paper size the title block claims, when it names one — e.g. `"A3"`.
   *
   * Read off the drawing by whoever imported it. Null when the title block is silent, which it is
   * on the overwhelming majority of real sheets.
   */
  readonly claimedSheetSize?: string | null;
  /**
   * The paper size the file actually is, from its page dimensions.
   *
   * Null when the page matches no standard size within tolerance — trimmed, custom or a fold-out.
   * Null is not a mismatch: an unrecognised page size is unknown, not contradictory.
   */
  readonly actualSheetSize?: string | null;
}

export function recommendCalibration(input: CalibrationAdviceInput): CalibrationAdvice {
  if (input.planImage === null) {
    return { recommended: null, available: [], code: 'no_plan_image' };
  }

  /*
   * Two independent reasons the printed ratio may be unusable, and both are hard refusals.
   *
   * 1. We do not know the resolution the image is stored at, so the ratio cannot be converted.
   * 2. The title block claims a paper size the file is not, so the ratio describes a different
   *    sheet from the one in front of us. See `paperSizeDisagrees`.
   */
  const mismatch = paperSizeDisagrees(
    input.claimedSheetSize ?? null,
    input.actualSheetSize ?? null,
  );
  const ratioConvertible = input.planImage.renderDpi !== null && !mismatch;

  if (input.hasDimensionLine === true) {
    return {
      recommended: 'two-point',
      available: ratioConvertible ? ['two-point', 'stated-ratio'] : ['two-point'],
      /*
       * The mismatch is reported even though two-point was going to be recommended anyway. An
       * engineer who can see that this sheet's printed scale is wrong knows something about the
       * drawing they would otherwise find out by trusting it somewhere else.
       */
      code: mismatch ? 'paper_size_mismatch' : 'prefer_two_point',
    };
  }

  if (input.hasDimensionLine === false) {
    if (mismatch) {
      // No dimension to measure, and the printed scale is disproved by the page it is printed on.
      // Nothing here can produce a true scale, and saying so beats offering a wrong one.
      return { recommended: null, available: [], code: 'paper_size_mismatch' };
    }
    return ratioConvertible
      ? { recommended: 'stated-ratio', available: ['stated-ratio'], code: 'fallback_stated_ratio' }
      : { recommended: null, available: [], code: 'no_method_available' };
  }

  /*
   * Unanswered. Two-point leads because it is the better method and because an engineer who has not
   * yet looked for a dimension line is being asked to go and look — but the ratio route is listed
   * when it is possible, so they can see there is a fallback before they conclude the drawing is
   * unusable.
   */
  return {
    recommended: 'two-point',
    available: ratioConvertible ? ['two-point', 'stated-ratio'] : ['two-point'],
    code: mismatch ? 'paper_size_mismatch' : 'awaiting_dimension_line_answer',
  };
}
