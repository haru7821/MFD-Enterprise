import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  readPrintedDimensions,
  readPrintedScale,
  reconcileScale,
  sheetSizeOf,
} from '../packages/layout-knowledge/src/index';

import { measureRoomWidth } from './lib/hallGeometry';
import { readPageGeometry } from './lib/pdfGeometry';

/**
 * Read every readable drawing in the corpus, and report what can honestly be taken from it.
 *
 * > Owner decision: *"After Hospital_044 passes, use the remaining PDF drawings to expand the
 * > knowledge base automatically."*
 *
 * **It writes no observations, and the reason is the finding.** What follows is the account of why,
 * because a sweep that quietly produced nothing would be indistinguishable from one nobody ran.
 *
 * ## What was attempted
 *
 * Vector geometry gives **numbers without subjects**. A dimension line says 2,000 mm; it does not
 * say that 2,000 mm is a bed pitch. Naming is what the dataset's Korean annotations do
 * (`베드 간격`), and `scripts/extract-observations.ts` already harvested every annotated reading
 * there is — re-emitting those from geometry would add nothing and would double-count every figure.
 *
 * So the sweep aimed at the one quantity the analyser could not produce and Hospital_044 showed the
 * geometry can: the **clear width of the treatment room**, wall face to wall face. No drawing in
 * the corpus prints it.
 *
 * ## Why it does not generalise
 *
 * `measureRoomWidth` takes the outermost same-colour wall pair on each side of a cross-section. On
 * Hospital_044 that is the treatment hall's own walls, because that hall spans the building's full
 * width — and the result checks out against the title block's area figure to 0.6 %.
 *
 * On a plan where the treatment room is *one room among several across the section*, the outermost
 * pair is the **building's exterior wall**, and the same arithmetic returns a real distance across
 * the wrong thing. Run over the corpus it produced 12,698 mm, 14,200 mm, 11,254 mm and 12,798 mm —
 * building widths wearing a treatment-room label, and a median of 12.7 m for a quantity that is
 * 7.4 m on the one sheet where it is known to be right.
 *
 * Nothing in the geometry distinguishes the two cases. Telling them apart needs to know *which*
 * walls bound the treatment room, which is room identification — a feature this product does not
 * have and was explicitly not asked for. So the measurement is computed, reported as a diagnostic,
 * and **not written to the knowledge base**. Four confident wrong numbers in a knowledge base are
 * worse than an empty one; the whole architecture exists to keep them out.
 *
 * ## What it does report
 *
 * Two things, both true without room identification:
 *
 * 1. **Coverage** — how much of the corpus is readable at all, and why each sheet is not.
 * 2. **Sheets whose dimension text disagrees with the geometry beneath it**, split by how far out
 *    they are. A few per cent is a draftsman's text override, which is a real finding about a real
 *    drawing. An order of magnitude is this reader pairing a label with the wrong line, which is a
 *    finding about the reader. Reporting them together would make both useless, so they are
 *    separated by {@link OVERRIDE_PLAUSIBILITY} and only the first is claimed.
 */


const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const DATASET_ROOT = argument('dataset', '/workspace/mfd-hospital-dataset');

/**
 * What a hemodialysis hall's clear width can be, millimetres.
 *
 * Two beds facing each other across an aisle is about 6 m; a single row against one wall is about
 * 3 m; the widest hall in the corpus's own analysis is under 13 m. Anything outside 2.5–15 m is a
 * measurement of something that is not a treatment room.
 */
const PLAUSIBLE_WIDTH_MM = { minimum: 2_500, maximum: 15_000 } as const;

/**
 * How far the geometry's scale may sit from the printed one, before the sheet is refused.
 *
 * Two per cent, which is twenty times the 0.06 % Hospital_044 achieves and still an order of
 * magnitude tighter than any of the failures this rejects. It is a sanity gate, not a precision
 * requirement: what it exists to catch is a sheet whose dimensions reconciled to a scale that is not
 * the scale it was plotted at.
 */
const SCALE_AGREEMENT_TOLERANCE = 0.02;

/**
 * How many dimensions must agree before a sheet's scale is believed.
 *
 * Two is enough to *compute* a median and nowhere near enough to trust one: two readings from a
 * detail view drawn at 1:20 agree perfectly with each other and say nothing about the plan beside
 * them. Four is the point at which a wrong pairing has to be wrong the same way four times.
 */
const MINIMUM_AGREEING_DIMENSIONS = 4;

/**
 * How much of a sheet may disagree with its own median before the sheet is refused outright.
 *
 * The signal that separates *one overridden dimension* from *a sheet the reader has not understood*.
 * Hospital_044 has one dimension out of seven out — 14 %, and everything else agrees to 0.06 %.
 * The sheets this rejects have half their dimensions out and implied scales spanning three orders
 * of magnitude, which is not a drawing disagreeing with itself but a reader guessing.
 */
const MAXIMUM_DISAGREEING_FRACTION = 0.2;

/**
 * How far a dimension may disagree with its sheet and still be a *drawing's* problem.
 *
 * A draftsman typing a round number over an awkward one is out by a few per cent — Hospital_044's
 * `3000` is 3.0 % out, and that is the whole of it. A label reported as ten times out is this reader
 * having paired it with the wrong line. Both are worth seeing and they are not the same thing.
 */
const OVERRIDE_PLAUSIBILITY = 0.1;

interface DatasetDrawing {
  drawingId: string;
  path: string;
  format: string;
  role: string;
  sha256: string;
  classification: string;
}

const dataset = JSON.parse(readFileSync(join(REPO, 'knowledge', 'dataset.json'), 'utf8')) as {
  drawings: DatasetDrawing[];
};

/** Sheets Hospital_044 already covers — its record is authoritative and is not re-derived here. */
const ALREADY_VERIFIED = new Set(['Hospital_044/dialysis.pdf']);

const tally = {
  total: dataset.drawings.length,
  notPdf: 0,
  scanned: 0,
  missing: 0,
  hashMismatch: 0,
  unreadable: 0,
  noScale: 0,
  weakAgreement: 0,
  noPrintedScale: 0,
  scaleCorroborated: 0,
  paperSizeMismatch: 0,
  scaleDisagrees: 0,
  notDialysisLayout: 0,
  noWallPair: 0,
  implausibleWidth: 0,
  measured: 0,
  alreadyVerified: 0,
};

const inconsistentSheets: {
  drawingId: string;
  scale: number;
  labels: { label: string; impliedScale: number }[];
}[] = [];
const widths: { drawingId: string; widthMm: number }[] = [];

for (const drawing of dataset.drawings) {
  if (drawing.format !== 'pdf') {
    tally.notPdf += 1;
    continue;
  }
  if (drawing.classification !== 'vector_cad_export') {
    tally.scanned += 1;
    continue;
  }
  if (ALREADY_VERIFIED.has(drawing.drawingId)) {
    tally.alreadyVerified += 1;
    continue;
  }

  const path = join(DATASET_ROOT, drawing.path);
  if (!existsSync(path)) {
    tally.missing += 1;
    continue;
  }
  const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (sha256 !== drawing.sha256) {
    // The catalogue and the file disagree, so a reading could not be attributed to either.
    tally.hashMismatch += 1;
    continue;
  }

  let printed;
  try {
    const page = await readPageGeometry(path);
    printed = { page, dimensions: readPrintedDimensions(page.segments, page.texts) };
  } catch {
    tally.unreadable += 1;
    continue;
  }

  const agreement = reconcileScale(printed.dimensions);
  if (!agreement) {
    tally.noScale += 1;
    continue;
  }

  /*
   * The gate the first run of this sweep did not have, and needed.
   *
   * Reconciling a sheet's dimensions to one scale assumes it has one. Run across the corpus without
   * this check, twenty sheets came back "inconsistent" — and inspecting them showed most were not
   * drawings that disagree with themselves at all, but sheets carrying a plan and a detail at
   * different scales, or dimensions the reader had mis-paired. Nothing in the geometry distinguishes
   * those from a real disagreement. What the title block says does.
   */
  const readable = agreement.consistent.length + agreement.inconsistent.length;
  if (
    agreement.consistent.length < MINIMUM_AGREEING_DIMENSIONS ||
    agreement.inconsistent.length / readable > MAXIMUM_DISAGREEING_FRACTION
  ) {
    tally.weakAgreement += 1;
    continue;
  }

  /*
   * The printed scale, used **where the sheet states one** — and most do not.
   *
   * The first attempt at this sweep required a readable printed ratio and measured nothing at all:
   * of the thirty sheets that reconciled, twenty-nine state no machine-readable scale, because their
   * title blocks are plotted as geometry rather than as text. Requiring one is requiring a property
   * this corpus does not have.
   *
   * So it is a refusal when present and disagreeing, not a precondition. Where a sheet does state
   * its scale and its geometry says otherwise, that sheet is out.
   */
  const stated = readPrintedScale(printed.page.texts);
  const actualSheetSize = sheetSizeOf(printed.page.widthPt, printed.page.heightPt);
  if (stated === null) {
    tally.noPrintedScale += 1;
  } else {
    if (
      stated.claimedSheetSize !== null &&
      actualSheetSize !== null &&
      stated.claimedSheetSize !== actualSheetSize
    ) {
      // The calibration safety rule, applied to the sweep: a sheet plotted at a size other than the
      // one it claims describes a different sheet from the file in front of us.
      tally.paperSizeMismatch += 1;
      continue;
    }
    if (Math.abs(agreement.scale / stated.ratio - 1) > SCALE_AGREEMENT_TOLERANCE) {
      tally.scaleDisagrees += 1;
      continue;
    }
    tally.scaleCorroborated += 1;
  }

  if (agreement.inconsistent.length > 0) {
    /*
     * Now that the sheet's scale is corroborated by its own title block, a dimension that still
     * disagrees is a claim worth making: the label and the line beneath it do not match. This is the
     * Hospital_044 `3000` case, and only sheets that have passed the gate above appear here.
     */
    inconsistentSheets.push({
      drawingId: drawing.drawingId,
      scale: agreement.scale,
      labels: agreement.inconsistent.map((entry) => ({
        label: entry.label,
        impliedScale: entry.impliedScale,
      })),
    });
  }

  if (drawing.role !== 'dialysis_layout') {
    tally.notDialysisLayout += 1;
    continue;
  }

  const room = measureRoomWidth(printed.page.segments, agreement.primary, agreement.scale);
  if (!room) {
    tally.noWallPair += 1;
    continue;
  }
  const widthMm = Math.round(room.widthMm);
  if (widthMm < PLAUSIBLE_WIDTH_MM.minimum || widthMm > PLAUSIBLE_WIDTH_MM.maximum) {
    tally.implausibleWidth += 1;
    continue;
  }

  tally.measured += 1;
  widths.push({ drawingId: drawing.drawingId, widthMm });
}

const sorted = widths.map((entry) => entry.widthMm).sort((a, b) => a - b);
console.log(`corpus sweep over ${tally.total} catalogued drawings\n`);
console.log(`  measured                      ${String(tally.measured).padStart(4)}`);
console.log(`  already verified in full      ${String(tally.alreadyVerified).padStart(4)}`);
console.log('  ── not attempted ──');
console.log(`  not a PDF (DWG)               ${String(tally.notPdf).padStart(4)}`);
console.log(`  scanned, no vector content    ${String(tally.scanned).padStart(4)}`);
console.log(`  file missing from the dataset ${String(tally.missing).padStart(4)}`);
console.log(`  hash does not match catalogue ${String(tally.hashMismatch).padStart(4)}`);
console.log('  ── attempted and refused ──');
console.log(`  unreadable by pdf.js          ${String(tally.unreadable).padStart(4)}`);
console.log(`  fewer than two dimensions     ${String(tally.noScale).padStart(4)}`);
console.log(`  too few dimensions agree      ${String(tally.weakAgreement).padStart(4)}`);
console.log(`  paper size disagrees          ${String(tally.paperSizeMismatch).padStart(4)}`);
console.log(`  scale disagrees with printed  ${String(tally.scaleDisagrees).padStart(4)}`);
console.log(`  not a dialysis layout         ${String(tally.notDialysisLayout).padStart(4)}`);
console.log(`  no wall pair found            ${String(tally.noWallPair).padStart(4)}`);
console.log(`  width outside the band        ${String(tally.implausibleWidth).padStart(4)}`);

console.log(
  `\n  of the measured sheets, ${tally.scaleCorroborated} state a scale that corroborates the geometry ` +
    `and ${tally.noPrintedScale} state none in readable text`,
);

console.log('\n  treatment_room_width — DIAGNOSTIC ONLY, not written to the knowledge base:');
for (const entry of widths) console.log(`    ${entry.drawingId.padEnd(44)} ${entry.widthMm} mm`);
if (sorted.length > 0) {
  console.log(
    `    ${sorted[0]}–${sorted[sorted.length - 1]} mm, median ` +
      `${sorted[Math.floor((sorted.length - 1) / 2)]} mm across ${sorted.length} drawings`,
  );
}
console.log(
  '    Hospital_044 measures 7,402 mm and is corroborated by its own area figure. Readings far\n' +
    '    above that are the building\'s width, not a room\'s — the outermost wall pair is the\n' +
    '    exterior wall wherever the treatment room does not span the plan. Room identification is\n' +
    '    the missing piece; until it exists these are not knowledge and are not recorded.',
);

const overrides = inconsistentSheets.flatMap((sheet) =>
  sheet.labels
    .filter((entry) => Math.abs(entry.impliedScale / sheet.scale - 1) <= OVERRIDE_PLAUSIBILITY)
    .map((entry) => ({ ...entry, sheet })),
);
const unpaired = inconsistentSheets.flatMap((sheet) =>
  sheet.labels.filter(
    (entry) => Math.abs(entry.impliedScale / sheet.scale - 1) > OVERRIDE_PLAUSIBILITY,
  ),
);

console.log(`\n  dimension text that disagrees with its own geometry by a plausible override margin:`);
if (overrides.length === 0) console.log('    (none)');
for (const entry of overrides) {
  console.log(
    `    ${entry.sheet.drawingId.padEnd(44)} "${entry.label}" — sheet is 1:${entry.sheet.scale.toFixed(2)}, ` +
      `this implies 1:${entry.impliedScale.toFixed(2)} (${((entry.impliedScale / entry.sheet.scale - 1) * 100).toFixed(1)} %)`,
  );
}
console.log(
  `\n  labels this reader could not pair correctly (an order of magnitude out, so not a drawing\n` +
    `  problem but a reader one): ${unpaired.length}`,
);
