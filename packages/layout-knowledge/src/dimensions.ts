import { angleGap, type Segment, type TextRun } from './geometry';

/**
 * Reading the dimensions a drawing prints on itself.
 *
 * `OBSERVATION_METHODS` ranks `dimension_line` first because the drawing *states* the number. This
 * is the mechanism behind that word: given the vector content of a CAD-exported sheet, pair each
 * printed dimension text with the dimension line it labels, and measure that line.
 *
 * Pure. Segments and text runs arrive as plain data, so the whole thing is testable without a PDF
 * and nothing here pulls a parser into a browser bundle. `scripts/lib/pdfGeometry.ts` does the
 * reading; this decides what was read.
 *
 * ## Why the measurement is not the length of the drawn line
 *
 * A dimension in CAD is three things: a line, two ticks or arrowheads at the points being measured,
 * and the text. The **drawn line is not the measurement** — it stops short of each tick by the
 * width of the tick, and on a chained dimension string it is broken again around the text. On
 * Hospital_044 that trim is about 3.6 pt, which is 0.7 % of a 500 pt overall dimension and 6 % of a
 * 53 pt bed pitch. Measuring the line instead of the ticks produces a scale error that grows as the
 * dimension gets smaller, which is the worst possible shape for the error to have: it is invisible
 * on the dimension you calibrate from and largest on the ones you care about.
 *
 * So the measurement is taken between the **measure points** — where the perpendicular members of
 * the dimension layer (extension lines on long dimensions, oblique ticks on short ones) meet the
 * dimension line. Those are the points the draftsman placed; the line between them is decoration.
 *
 * ## Why the layer is found rather than configured
 *
 * CAD layers survive plotting as stroke colours. Which colour carries dimensions differs per office
 * and per sheet, so it is discovered by asking which colour's geometry actually hosts the dimension
 * texts. That keeps the reader working on a drawing nobody has configured it for, which is every
 * drawing after the first.
 */

/** A dimension the drawing prints, and what its geometry actually measures. */
export interface PrintedDimension {
  /** The text exactly as printed, e.g. `"17,600"` or `"3000"`. */
  readonly label: string;
  /** The value the label states, millimetres. */
  readonly statedMm: number;
  /** Distance between the two measure points, page points. */
  readonly measuredPt: number;
  /** Denominator of the scale this dimension implies: 100.03 means 1 : 100.03. */
  readonly impliedScale: number;
  /** Where the label sits, page points — enough to find it again on the sheet. */
  readonly labelAt: { readonly x: number; readonly y: number };
  /** The two measure points in page points, which are the two an engineer would click. */
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
}

/** Points per millimetre of paper. A PDF point is 1/72 inch by definition. */
const POINTS_PER_MM = 72 / 25.4;

/**
 * Tuning, gathered so it can be argued with in one place.
 *
 * Every value is in page points on a sheet plotted at its natural size, and every one was chosen
 * against a real drawing rather than in the abstract.
 */
export interface DimensionReadOptions {
  /** Below this the text is a room number, a door tag or a level, not a dimension. */
  readonly minimumStatedMm?: number;
  /** How far a label may sit from the line it labels. Text is drawn above the line, not on it. */
  readonly labelOffsetPt?: number;
  /** How far out of parallel a line may be from its label and still be its dimension line. */
  readonly angleTolerance?: number;
  /**
   * How close a perpendicular member must come to the dimension line to count as a measure point.
   *
   * Extension lines cross it; oblique ticks are centred on it. Both land inside 3 pt, and a wall
   * that happens to run perpendicular nearby does not.
   */
  readonly measurePointReachPt?: number;
  /**
   * Shortest perpendicular member that can be a measure point.
   *
   * Two points, because the smallest real tick on the reference sheet is 3.4 pt and the plotter
   * also emits sub-point fragments around every arrowhead. Those fragments sit within a point of
   * the true measure point, so admitting them would not move the answer far — but it would make the
   * answer depend on which fragment sorted first, and a measurement that changes with sort order is
   * not a measurement.
   */
  readonly minimumMeasurePt?: number;
  /**
   * How far past the drawn line's end a measure point may sit.
   *
   * The trim this exists to undo. Four points covers the tick widths seen in practice without
   * reaching the neighbouring dimension in a chain, whose measure point is a whole dimension away.
   */
  readonly measurePointSlackPt?: number;
}

const DEFAULTS = {
  minimumStatedMm: 500,
  labelOffsetPt: 14,
  angleTolerance: 2,
  measurePointReachPt: 3,
  minimumMeasurePt: 2,
  measurePointSlackPt: 4,
} as const satisfies Required<DimensionReadOptions>;

/** `"17,600"` → 17600. Thousands separators are used on about half of a sheet's dimensions. */
function statedValueOf(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d[\d,]*$/.test(trimmed)) return null;
  const value = Number(trimmed.replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

interface Axis {
  readonly ox: number;
  readonly oy: number;
  readonly ux: number;
  readonly uy: number;
}

function axisOf(segment: Segment): Axis {
  return {
    ox: segment.x1,
    oy: segment.y1,
    ux: (segment.x2 - segment.x1) / segment.length,
    uy: (segment.y2 - segment.y1) / segment.length,
  };
}

/** Distance along the axis. */
function along(axis: Axis, x: number, y: number): number {
  return (x - axis.ox) * axis.ux + (y - axis.oy) * axis.uy;
}

/** Signed distance across the axis. */
function across(axis: Axis, x: number, y: number): number {
  return (x - axis.ox) * axis.uy - (y - axis.oy) * axis.ux;
}

/**
 * Which stroke colour carries the dimensions.
 *
 * Scored by how many dimension labels each colour can account for — a colour is the dimension layer
 * if its geometry runs parallel to the labels and passes under them. Returns null when no colour
 * accounts for any label, which is the correct answer for a sheet that prints no dimensions.
 */
export function findDimensionLayer(
  segments: readonly Segment[],
  texts: readonly TextRun[],
  options: DimensionReadOptions = {},
): string | null {
  const settings = { ...DEFAULTS, ...options };
  const labels = texts.filter((text) => {
    const value = statedValueOf(text.text);
    return value !== null && value >= settings.minimumStatedMm;
  });
  if (labels.length === 0) return null;

  const scores = new Map<string, number>();
  for (const stroke of new Set(segments.map((segment) => segment.stroke))) {
    const candidates = segments.filter(
      (segment) => segment.stroke === stroke && segment.length >= settings.minimumMeasurePt,
    );
    let hits = 0;
    for (const label of labels) {
      if (hostFor(label, candidates, settings)) hits += 1;
    }
    if (hits > 0) scores.set(stroke, hits);
  }

  let best: string | null = null;
  let bestScore = 0;
  for (const [stroke, score] of scores) {
    // Ties broken by colour name so the answer does not depend on Set iteration order.
    if (score > bestScore || (score === bestScore && best !== null && stroke < best)) {
      best = stroke;
      bestScore = score;
    }
  }
  return best;
}

/**
 * The dimension line a label belongs to: the **shortest** same-angle run it sits on.
 *
 * Shortest, not longest. A dimension line and the chain line it belongs to are separate runs, so
 * the shortest run containing the label is the most specific claim about what that label measures.
 * Preferring the longest instead pairs a room-size annotation with whatever long dimension happens
 * to pass beneath it — on the companion sheet of the reference drawing that turned a `2200` room
 * note into an 11.6 m measurement, which is the kind of confident nonsense this reader exists to
 * avoid producing.
 */
function hostFor(
  label: TextRun,
  candidates: readonly Segment[],
  settings: Required<DimensionReadOptions>,
): Segment | null {
  let best: Segment | null = null;
  for (const segment of candidates) {
    if (angleGap(segment.angle, label.angle) > settings.angleTolerance) continue;
    const axis = axisOf(segment);
    if (Math.abs(across(axis, label.x, label.y)) > settings.labelOffsetPt) continue;
    const t = along(axis, label.x, label.y);
    // The label lies within the run it labels, give or take the text's own overhang.
    if (t < -settings.labelOffsetPt || t > segment.length + settings.labelOffsetPt) continue;
    if (!best || segment.length < best.length) best = segment;
  }
  return best;
}

/** The crossing closest to `target`, or null when the closest is further away than `slack`. */
function nearestTo(crossings: readonly number[], target: number, slack: number): number | null {
  let best: number | null = null;
  for (const t of crossings) {
    if (Math.abs(t - target) > slack) continue;
    if (best === null || Math.abs(t - target) < Math.abs(best - target)) best = t;
  }
  return best;
}

/**
 * Read every dimension the sheet prints, with what its geometry actually measures.
 *
 * A label whose dimension line or measure points cannot be found is **omitted**, not guessed at.
 * A sheet where that happens to every label yields an empty array, which is the honest report that
 * this drawing's dimensions could not be read.
 */
export function readPrintedDimensions(
  segments: readonly Segment[],
  texts: readonly TextRun[],
  options: DimensionReadOptions = {},
): PrintedDimension[] {
  const settings = { ...DEFAULTS, ...options };
  const layer = findDimensionLayer(segments, texts, options);
  if (layer === null) return [];

  const onLayer = segments.filter(
    (segment) => segment.stroke === layer && segment.length >= settings.minimumMeasurePt,
  );
  const found: PrintedDimension[] = [];

  for (const label of texts) {
    const statedMm = statedValueOf(label.text);
    if (statedMm === null || statedMm < settings.minimumStatedMm) continue;

    const host = hostFor(label, onLayer, settings);
    if (!host) continue;

    const axis = axisOf(host);
    const crossings: number[] = [];
    for (const segment of onLayer) {
      /*
       * Any member of the dimension layer that is **not parallel** to the line and reaches it.
       *
       * Not "perpendicular", which was the first rule and was too narrow: extension lines meet the
       * dimension line at a right angle but the tick styles do not. AutoCAD's architectural tick is
       * a 45° slash, and offices vary. What every measure point has in common is that it crosses
       * the line rather than running along it, so that is what is tested. Walls and furniture cross
       * dimension lines constantly and are excluded already, by being on a different layer.
       */
      if (angleGap(segment.angle, host.angle) <= settings.angleTolerance) continue;
      const a = across(axis, segment.x1, segment.y1);
      const b = across(axis, segment.x2, segment.y2);
      // Reaches the dimension line: an extension line crosses it, a tick straddles it.
      if (Math.min(a, b) > settings.measurePointReachPt) continue;
      if (Math.max(a, b) < -settings.measurePointReachPt) continue;
      crossings.push(
        (along(axis, segment.x1, segment.y1) + along(axis, segment.x2, segment.y2)) / 2,
      );
    }

    /*
     * A measure point sits *at* the end of the drawn line, within the tick width that was trimmed
     * off it. Taking the nearest crossing to each end and then requiring it to be that close is
     * what keeps a dimension whose tick was not found from silently borrowing the neighbouring
     * dimension's, which on the reference drawing's companion sheet turned a 59 pt dimension into a
     * 329 pt one. Where either end has no measure point the dimension is omitted: unread is a
     * result an engineer can act on, a fabricated span is not.
     */
    const from = nearestTo(crossings, 0, settings.measurePointSlackPt);
    const to = nearestTo(crossings, host.length, settings.measurePointSlackPt);
    if (from === null || to === null) continue;

    const measuredPt = to - from;
    if (measuredPt <= 0) continue;

    found.push({
      label: label.text.trim(),
      statedMm,
      measuredPt,
      impliedScale: statedMm / (measuredPt / POINTS_PER_MM),
      labelAt: { x: label.x, y: label.y },
      from: { x: axis.ox + axis.ux * from, y: axis.oy + axis.uy * from },
      to: { x: axis.ox + axis.ux * to, y: axis.oy + axis.uy * to },
    });
  }

  // Longest first: the overall dimension is the one to calibrate from, and it is the one whose
  // measure points a click can land on most accurately.
  return found.sort((a, b) => b.measuredPt - a.measuredPt);
}

/** A dimension's standing once the sheet's scale has been agreed. */
export interface ScaleAgreement {
  /** The scale the consistent dimensions agree on: 100.02 means 1 : 100.02. */
  readonly scale: number;
  /** The dimension the scale was taken from — the longest of the consistent set. */
  readonly primary: PrintedDimension;
  /** Dimensions whose geometry agrees with `scale`. */
  readonly consistent: readonly PrintedDimension[];
  /**
   * Dimensions whose geometry does not.
   *
   * **Not repaired, not dropped, not averaged in.** A label that disagrees with the line beneath it
   * is a fact about the drawing, and it belongs in a verification report where an engineer can go
   * and look at that dimension. Silently reconciling it would delete the only evidence that the
   * sheet has something wrong with it.
   */
  readonly inconsistent: readonly PrintedDimension[];
}

/**
 * Find the scale the sheet's dimensions agree on, and name the ones that do not.
 *
 * The agreed scale is the **median** implied scale, not the mean: a single overridden dimension
 * text — a draftsman typing a round number over an awkward one — would drag a mean towards itself
 * and then look less anomalous for having done so. A median is unmoved by it, so the outlier stays
 * an outlier.
 *
 * Returns null when there is nothing to agree on. One dimension is not agreement, and calling it
 * agreement would report a lone possibly-overridden number as a verified scale.
 */
export function reconcileScale(
  dimensions: readonly PrintedDimension[],
  toleranceFraction = 0.005,
): ScaleAgreement | null {
  if (dimensions.length < 2) return null;

  const scales = dimensions.map((dimension) => dimension.impliedScale).sort((a, b) => a - b);
  // The lower middle reading, never a computed midpoint: a median must be a number the drawing
  // actually produced, the same rule the aggregator applies to observations.
  const scale = scales[Math.floor((scales.length - 1) / 2)]!;

  const consistent: PrintedDimension[] = [];
  const inconsistent: PrintedDimension[] = [];
  for (const dimension of dimensions) {
    const deviation = Math.abs(dimension.impliedScale - scale) / scale;
    (deviation <= toleranceFraction ? consistent : inconsistent).push(dimension);
  }
  if (consistent.length < 2) return null;

  const primary = consistent.reduce((best, next) =>
    next.measuredPt > best.measuredPt ? next : best,
  );

  return { scale, primary, consistent, inconsistent };
}
