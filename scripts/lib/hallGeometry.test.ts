import type { PrintedDimension, Segment } from '../../packages/layout-knowledge/src/index';
import { describe, expect, it } from 'vitest';

import { MAX_WALL_THICKNESS_MM, MIN_WALL_THICKNESS_MM, measureRoomWidth } from './hallGeometry';

/**
 * `measureRoomWidth` — the first tests this file has ever had.
 *
 * It produces the **7,402 mm** treatment-room width that reaches `knowledge/`, the verification
 * record and `HOSPITAL_044_VERIFICATION.md`. The audit forced it to `return null` unconditionally
 * and the entire suite stayed green, because `scripts/**` was not in vitest's `include` — a test
 * here would not have been collected even if somebody had written one.
 *
 * The rule under test is the one the module's own doc comment sets out: a wall is a **pair of
 * parallel lines of the same colour** at plausible thickness, and the **outermost** pair on each
 * side bounds the room. Both halves have a counterexample below, because both were put there to
 * stop a specific wrong answer the reference drawing produces without them.
 *
 * ## The fixture's geometry
 *
 * The axis runs along +x from (0, 0) to (100, 0), so the cross-section is taken at x = 50 and
 * "offset across the room" is `-y`. At 1:100 a page point is 25.4 × 100 / 72 = 35.2778 mm.
 */

const SCALE = 100;
const MM_PER_PT = (SCALE * 25.4) / 72;

/** A dimension running along the room: the direction to measure across, and where to cut. */
const AXIS: PrintedDimension = {
  label: '10,000',
  statedMm: 10_000,
  measuredPt: 100,
  impliedScale: SCALE,
  labelAt: { x: 50, y: 0 },
  from: { x: 0, y: 0 },
  to: { x: 100, y: 0 },
};

/** A line parallel to the axis, spanning the cross-section, at the given offset across the room. */
function line(offset: number, stroke: string): Segment {
  const y = -offset;
  return { x1: 0, y1: y, x2: 100, y2: y, stroke, length: 100, angle: 0 };
}

/** Two parallel lines a wall's thickness apart, on one CAD layer. */
function wall(nearOffset: number, farOffset: number, stroke: string): Segment[] {
  return [line(nearOffset, stroke), line(farOffset, stroke)];
}

describe('measureRoomWidth', () => {
  it('measures face to face between the two walls', () => {
    /*
     * Walls at offsets 0-4 and 60-64. The room-facing faces are 4 and 60, so the width is 56 pt.
     * Wall thickness is 4 pt = 141 mm, inside the 90…350 mm band the module accepts.
     */
    const segments = [...wall(0, 4, '#333333'), ...wall(60, 64, '#333333')];

    const measurement = measureRoomWidth(segments, AXIS, SCALE);

    expect(measurement).not.toBeNull();
    expect(measurement?.widthMm).toBeCloseTo(56 * MM_PER_PT, 6);
    // Not wall centres and not outer faces: the number an engineer would get by clicking twice.
    expect(measurement?.widthMm).toBeCloseTo(1_975.6, 1);
    expect(measurement?.wallThicknessMm[0]).toBeCloseTo(4 * MM_PER_PT, 6);
    expect(measurement?.station).toEqual({ x: 50, y: 0 });
  });

  it('returns null when a side is a single line rather than a pair', () => {
    // A lone line crossing a room is furniture, a zone boundary, a grid or a dimension. The module
    // reports nothing rather than treating it as a wall face.
    const segments = [...wall(0, 4, '#333333'), line(60, '#333333')];

    expect(measureRoomWidth(segments, AXIS, SCALE)).toBeNull();
  });

  it('refuses to pair two lines of different colours', () => {
    /*
     * Safeguard 1 from the module's doc comment, and it exists because of a real wrong answer: on
     * the reference drawing a grey setting-out line and a red grid line 201 mm apart pair into a
     * "wall" where there is nothing at all. CAD layers survive plotting as colours; the two faces
     * of one wall are one object on one layer.
     */
    const segments = [line(0, '#333333'), line(4, '#cc0000'), ...wall(60, 64, '#333333')];

    expect(measureRoomWidth(segments, AXIS, SCALE)).toBeNull();
  });

  it('takes the outermost pair, not the nearest — furniture is never the room edge', () => {
    /*
     * Safeguard 2. The reference drawing has bed frames drawn as a double line 202 mm across, which
     * is a plausible wall pair by every local test. Adding one inside the room must not narrow the
     * measurement.
     */
    const furniture = wall(20, 25, '#0000ff');
    const segments = [...wall(0, 4, '#333333'), ...furniture, ...wall(60, 64, '#333333')];

    const measurement = measureRoomWidth(segments, AXIS, SCALE);

    expect(measurement?.widthMm).toBeCloseTo(56 * MM_PER_PT, 6);
  });

  it('ignores a gap too thin or too thick to be a wall', () => {
    /*
     * Both sides of the plausible-thickness band, each paired with one genuine wall. The genuine
     * wall alone leaves `walls.length < 2`, so a `null` here is the bad pair being rejected rather
     * than the measurement failing for some other reason — the first test in this file is the
     * control showing the same fixture measures once the near pair is a real thickness.
     */
    const thin = (MIN_WALL_THICKNESS_MM / MM_PER_PT) * 0.5;
    const thick = (MAX_WALL_THICKNESS_MM / MM_PER_PT) * 1.5;

    // Too thin to be a wall: a hatch, or one line drawn twice.
    expect(
      measureRoomWidth([...wall(0, thin, '#333333'), ...wall(60, 64, '#333333')], AXIS, SCALE),
    ).toBeNull();
    // Too thick to be one wall: that is two walls with a room between them.
    expect(
      measureRoomWidth([...wall(0, thick, '#333333'), ...wall(60, 64, '#333333')], AXIS, SCALE),
    ).toBeNull();
  });

  it('ignores lines that do not cross the section, and lines running the wrong way', () => {
    const offToTheSide: Segment = { x1: 200, y1: -60, x2: 300, y2: -60, stroke: '#333333', length: 100, angle: 0 };
    const perpendicular: Segment = { x1: 50, y1: -60, x2: 50, y2: -64, stroke: '#333333', length: 4, angle: 90 };
    const segments = [...wall(0, 4, '#333333'), offToTheSide, perpendicular];

    // Neither can complete the far wall, so there is still only one pair.
    expect(measureRoomWidth(segments, AXIS, SCALE)).toBeNull();
  });

  it('returns null for a zero-length axis rather than dividing by it', () => {
    const degenerate: PrintedDimension = { ...AXIS, to: { x: 0, y: 0 } };

    expect(measureRoomWidth([...wall(0, 4, '#333333'), ...wall(60, 64, '#333333')], degenerate, SCALE)).toBeNull();
  });
});
