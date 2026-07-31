import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  angleGap,
  readPrintedDimensions,
  reconcileScale,
  type Segment,
} from '../packages/layout-knowledge/src/index';

import { measureRoomWidth } from './lib/hallGeometry';
import { readPageGeometry } from './lib/pdfGeometry';

/**
 * Can a treatment room be found deterministically? Measured, across the corpus.
 *
 * > Owner decision: *"The next engineering milestone is automatic room understanding … Do not
 * > implement machine-learning models unless deterministic approaches have been exhausted first."*
 *
 * Exhausting deterministic approaches means trying them and reporting what they do, not asserting
 * that they were considered. This runs the candidate signals over every sheet that gets far enough
 * to have a scale, and prints how often each one discriminates.
 *
 * ```
 * pnpm study:rooms
 * ```
 *
 * It writes nothing. Its output is the evidence behind
 * `docs/roadmap/ROOM_UNDERSTANDING_FEASIBILITY.md`, and it is kept rather than deleted so the next
 * signal can be added beside these and measured the same way.
 *
 * ## The signals
 *
 * | Signal | The idea | What it would give |
 * | --- | --- | --- |
 * | **wall pairs** | Two parallel same-colour lines a wall's thickness apart | Wall classification |
 * | **free-space fill** | Flood the space between barriers from a point inside the room | Boundary extraction |
 * | **erosion sweep** | Erode the free space until narrow necks sever, then fill | Rooms separated at doorways |
 * | **room labels** | Text runs that name a room, and where they sit | Which region is which |
 *
 * Each is scored against what the drawing's own dimensions say the room is, so "it worked" is a
 * measurement rather than an impression.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const DATASET_ROOT = argument('dataset', '/workspace/mfd-hospital-dataset');

/** Grid resolution for the fill. Fine enough to resolve a 100 mm partition. */
const CELL_MM = 60;
/** Erosion radii tried, millimetres. A door is 900–1,200 mm, so severing wants 450–600. */
const EROSION_MM = [0, 180, 300, 420, 540, 660];
/**
 * How close an extent must come to the measured room before the signal counts as having found it.
 *
 * Ten per cent. Generous — a room boundary good to 10 % is not good enough to place equipment
 * against — and the point is to find out whether any signal is even in the right neighbourhood.
 */
const TOLERANCE = 0.1;

/** Room names the corpus actually uses, for the label signal. */
const ROOM_WORDS = [
  '정수실',
  '탈의실',
  '창고',
  '물품실',
  '준비실',
  '폐기물',
  '간호사실',
  '처치실',
  '휴게실',
  '상담실',
  '화장실',
  '투석실',
];

interface DatasetDrawing {
  drawingId: string;
  path: string;
  format: string;
  role: string;
  classification: string;
}

const dataset = JSON.parse(readFileSync(join(REPO, 'knowledge', 'dataset.json'), 'utf8')) as {
  drawings: DatasetDrawing[];
};

function wallPairCount(segments: readonly Segment[], mmPerPt: number): number {
  const minimum = 90 / mmPerPt;
  const maximum = 350 / mmPerPt;
  const long = segments.filter((segment) => segment.length * mmPerPt > 600);
  const byColour = new Map<string, Segment[]>();
  for (const segment of long) {
    byColour.set(segment.stroke, [...(byColour.get(segment.stroke) ?? []), segment]);
  }

  let pairs = 0;
  for (const group of byColour.values()) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const a = group[i]!;
        const b = group[j]!;
        if (angleGap(a.angle, b.angle) > 1.5) continue;
        const ux = (a.x2 - a.x1) / a.length;
        const uy = (a.y2 - a.y1) / a.length;
        const perpendicular = Math.abs((b.x1 - a.x1) * uy - (b.y1 - a.y1) * ux);
        if (perpendicular < minimum || perpendicular > maximum) continue;
        const t1 = (b.x1 - a.x1) * ux + (b.y1 - a.y1) * uy;
        const t2 = (b.x2 - a.x1) * ux + (b.y2 - a.y1) * uy;
        const overlap = Math.min(Math.max(t1, t2), a.length) - Math.max(Math.min(t1, t2), 0);
        if (overlap * mmPerPt > 600) pairs += 1;
      }
    }
  }
  return pairs;
}

const summary = {
  attempted: 0,
  wallPairsUsable: 0,
  fillWithinTolerance: 0,
  erosionWithinTolerance: 0,
  labelled: 0,
};

for (const drawing of dataset.drawings) {
  if (drawing.format !== 'pdf' || drawing.classification !== 'vector_cad_export') continue;
  if (drawing.role !== 'dialysis_layout') continue;

  let page;
  try {
    page = await readPageGeometry(join(DATASET_ROOT, drawing.path));
  } catch {
    continue;
  }
  const agreement = reconcileScale(readPrintedDimensions(page.segments, page.texts));
  if (!agreement) continue;
  const readable = agreement.consistent.length + agreement.inconsistent.length;
  if (agreement.consistent.length < 4 || agreement.inconsistent.length / readable > 0.2) continue;

  const measured = measureRoomWidth(page.segments, agreement.primary, agreement.scale);
  if (!measured) continue;
  const widthMm = measured.widthMm;
  if (widthMm < 2_500 || widthMm > 15_000) continue;

  summary.attempted += 1;
  const mmPerPt = (agreement.scale * 25.4) / 72;
  const lengthMm = agreement.primary.statedMm;

  // ── wall pairs ─────────────────────────────────────────────────────────────
  const pairs = wallPairCount(page.segments, mmPerPt);
  // "Usable" means few enough that a person could check them: a room has four walls, a floor a few
  // dozen. Hundreds means the rule is matching furniture and setting-out lines too.
  const pairsUsable = pairs <= 40;
  if (pairsUsable) summary.wallPairsUsable += 1;

  // ── free-space fill and erosion sweep ──────────────────────────────────────
  const cell = CELL_MM / mmPerPt;
  const width = Math.ceil(page.widthPt / cell);
  const height = Math.ceil(page.heightPt / cell);
  const free = new Uint8Array(width * height).fill(1);
  for (const segment of page.segments) {
    const steps = Math.max(2, Math.ceil((segment.length / cell) * 2));
    for (let i = 0; i <= steps; i += 1) {
      const x = segment.x1 + ((segment.x2 - segment.x1) * i) / steps;
      const y = segment.y1 + ((segment.y2 - segment.y1) * i) / steps;
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      if (cx >= 0 && cy >= 0 && cx < width && cy < height) free[cy * width + cx] = 0;
    }
  }

  const seed = {
    x: (measured.from.x + measured.to.x) / 2,
    y: (measured.from.y + measured.to.y) / 2,
  };
  const start = Math.floor(seed.y / cell) * width + Math.floor(seed.x / cell);

  const dx = agreement.primary.to.x - agreement.primary.from.x;
  const dy = agreement.primary.to.y - agreement.primary.from.y;
  const axis = Math.hypot(dx, dy);
  const ux = dx / axis;
  const uy = dy / axis;

  function extentOf(grid: Uint8Array): { along: number; across: number } | null {
    if (!grid[start]) return null;
    const seen = new Uint8Array(width * height);
    const stack = [start];
    seen[start] = 1;
    let alongMin = Infinity;
    let alongMax = -Infinity;
    let acrossMin = Infinity;
    let acrossMax = -Infinity;
    while (stack.length) {
      const index = stack.pop()!;
      const x = index % width;
      const y = (index - x) / width;
      const a = x * cell * ux + y * cell * uy;
      const b = x * cell * uy - y * cell * ux;
      if (a < alongMin) alongMin = a;
      if (a > alongMax) alongMax = a;
      if (b < acrossMin) acrossMin = b;
      if (b > acrossMax) acrossMax = b;
      for (const [stepX, stepY] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + stepX;
        const ny = y + stepY;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (seen[next] || !grid[next]) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    return {
      along: (alongMax - alongMin) * mmPerPt,
      across: (acrossMax - acrossMin) * mmPerPt,
    };
  }

  function erode(grid: Uint8Array, times: number): Uint8Array {
    let current = grid;
    for (let step = 0; step < times; step += 1) {
      const next = new Uint8Array(width * height);
      for (let y = 1; y < height - 1; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
          const i = y * width + x;
          if (
            current[i] &&
            current[i - 1] &&
            current[i + 1] &&
            current[i - width] &&
            current[i + width]
          ) {
            next[i] = 1;
          }
        }
      }
      current = next;
    }
    return current;
  }

  const close = (value: number, target: number) => Math.abs(value / target - 1) <= TOLERANCE;

  const plain = extentOf(free);
  const fillFound = plain !== null && close(plain.along, lengthMm) && close(plain.across, widthMm);
  if (fillFound) summary.fillWithinTolerance += 1;

  let bestErosion: { mm: number; along: number; across: number } | null = null;
  for (const millimetres of EROSION_MM) {
    const grid = millimetres === 0 ? free : erode(free, Math.round(millimetres / CELL_MM));
    const extent = extentOf(grid);
    if (!extent) continue;
    // Erosion shrinks the region, so the extent is compared *after* adding back what was eroded.
    const along = extent.along + 2 * millimetres;
    const across = extent.across + 2 * millimetres;
    if (close(along, lengthMm) && close(across, widthMm)) {
      bestErosion = { mm: millimetres, along, across };
      break;
    }
  }
  if (bestErosion) summary.erosionWithinTolerance += 1;

  // ── room labels ────────────────────────────────────────────────────────────
  const labels = page.texts.filter((text) =>
    ROOM_WORDS.some((word) => text.text.includes(word)),
  ).length;
  if (labels > 0) summary.labelled += 1;

  console.log(
    `${drawing.drawingId.padEnd(42)} room ${(lengthMm / 1000).toFixed(1)}×${(widthMm / 1000).toFixed(1)} m  ` +
      `pairs ${String(pairs).padStart(4)}${pairsUsable ? ' ' : '!'}  ` +
      `fill ${plain ? `${(plain.along / 1000).toFixed(1)}×${(plain.across / 1000).toFixed(1)}` : 'seed blocked'}${fillFound ? ' ✓' : ''}  ` +
      `erosion ${bestErosion ? `${bestErosion.mm} mm ✓` : 'none'}  ` +
      `labels ${labels}`,
  );
}

console.log(`\nsheets attempted: ${summary.attempted}`);
console.log(`  wall-pair count small enough to be a room's walls  ${summary.wallPairsUsable}`);
console.log(`  free-space fill lands within 10 % of the room      ${summary.fillWithinTolerance}`);
console.log(`  some erosion radius lands within 10 % of the room  ${summary.erosionWithinTolerance}`);
console.log(`  sheet carries at least one room-name label         ${summary.labelled}`);
