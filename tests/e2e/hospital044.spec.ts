import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

/**
 * Hospital_044, through the application itself.
 *
 * > Owner decision: *"Proceed with Hospital_044 as the first end-to-end verification drawing … 1.
 * > Import the original PDF … 7. Generate the final report."*
 *
 * `scripts/verify-drawing.ts` measures the drawing and drives the engines directly. This does the
 * one thing that script cannot: it puts the **real file** through the **real importer** in a real
 * browser, and checks that what the application makes of it is what the verification record says it
 * would. The two meet at three numbers — the page's pixel size, its render resolution, and the
 * millimetres per pixel the printed scale converts to — and if the harness and the product ever
 * disagree about any of them, one of the two is wrong about the drawing.
 *
 * ## Why it skips rather than ships a fixture
 *
 * > Owner decision: *"Do not store the dataset inside the application repository."*
 *
 * The drawing is a hospital's property. It is read from `MFD_DATASET_DIR` (default
 * `/workspace/mfd-hospital-dataset`) and these tests skip when it is not there, which is the case on
 * CI. What CI does check, on every push, is the record this spec compares against —
 * `packages/layout-knowledge/src/verification.test.ts` proves it adds up.
 */

const DATASET = process.env['MFD_DATASET_DIR'] ?? '/workspace/mfd-hospital-dataset';
const DRAWING = join(DATASET, 'Hospital_044', 'dialysis.pdf');
const RECORD = 'knowledge/verification/Hospital_044-dialysis.json';

interface Record {
  page: { renderDpi: number; pixelWidth: number; pixelHeight: number; sheetSize: string | null };
  crossCheck: { statedRatio: string; millimetresPerPixel: number } | null;
  calibration: { millimetresPerPixel: number };
  pipeline: { room: { lengthMm: number } };
}
const record = JSON.parse(readFileSync(RECORD, 'utf8')) as Record;

test.skip(
  () => !existsSync(DRAWING),
  `${DRAWING} is not present — set MFD_DATASET_DIR to the MFD-Hospital-Dataset checkout`,
);

/** Import the drawing and answer the two questions only a person can answer about it. */
async function importDrawing(page: Page): Promise<void> {
  await page.getByTestId('plan-file-input').setInputFiles(DRAWING);
  // A 1 MB vector sheet takes noticeably longer to rasterise than the tiny fixtures elsewhere.
  await expect(page.getByTestId('calibration-advice')).toBeVisible({ timeout: 60_000 });
  // Both are read off the drawing by whoever imported it, and neither is inferred: the sheet does
  // carry dimension lines, and its title block does print `A3 : 1/100`.
  await page.getByTestId('dimension-line-yes').click();
  await page.getByTestId('claimed-sheet-A3').click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('canvas');
});

test('the real PDF imports at the size and resolution the verification predicted', async ({
  page,
}) => {
  /*
   * Goal 1. Not a smoke test: the pixel size is `Math.round(pageSize × dpi / 72)` with the 4,096 px
   * cap applied, and the harness computes it from the page geometry without ever rasterising
   * anything. Agreement here means the harness models the importer correctly, which is what every
   * pixel coordinate in the record depends on.
   */
  await importDrawing(page);

  await expect(page.getByText('dialysis.pdf')).toBeVisible();
  await expect(
    page.getByText(`${record.page.pixelWidth}×${record.page.pixelHeight} px`),
  ).toBeVisible();
  await expect(page.getByTestId('actual-sheet')).toContainText(record.page.sheetSize ?? 'A3');
});

test('the title block agrees with the page, so both calibration routes stay open', async ({
  page,
}) => {
  /*
   * Goals 2 and 3, as a state rather than as arithmetic. Hospital_044 is one of the few sheets in
   * the corpus where the claimed and actual paper sizes match, which is exactly what makes it usable
   * as the first verification drawing: the printed scale can be run as a genuine cross-check instead
   * of being refused by the calibration safety rule.
   */
  await importDrawing(page);

  await expect(page.getByTestId('calibration-advice')).toHaveAttribute(
    'data-code',
    'prefer_two_point',
  );
  // Dimension-line first — the owner's primary method, and what the record calibrated from.
  await expect(page.getByTestId('calibrate')).toContainText('recommended');
  // And the printed scale is available beside it, as the secondary check.
  await expect(page.getByTestId('stated-ratio-route')).toBeVisible();
});

test('the printed scale converts to the millimetres per pixel the record cross-checked', async ({
  page,
}) => {
  /*
   * The tightest link between this spec and the record. The stated-ratio route is arithmetic on the
   * render resolution — no clicking, so a browser can reproduce it exactly — and the record carries
   * the same figure as its `crossCheck`. It is the *secondary* method throughout; the record's
   * `calibration` comes from the 17,600 mm dimension line, and the two agree to 0.027 %.
   */
  await importDrawing(page);
  await page.getByTestId('stated-ratio-input').fill(record.crossCheck!.statedRatio);
  await page.getByTestId('stated-ratio-apply').click();

  await expect(page.getByTestId('recalibrate')).toBeVisible();
  await expect(page.getByTestId('plan-uncalibrated-warning')).toHaveCount(0);
  // Displayed to three decimals, which is where the panel rounds.
  await expect(
    page.getByText(`${record.crossCheck!.millimetresPerPixel.toFixed(3)} mm/px`, { exact: false }),
  ).toBeVisible();
});

test('a machine placed on the calibrated drawing reaches the report as a PDF', async ({ page }) => {
  /*
   * Goals 5 to 7, end to end and through the interface: a calibrated real drawing, equipment on it,
   * the rule engine's verdict, and a PDF that actually downloads. The engines' numbers are the
   * harness's business — what this proves is that nothing in the path from a 1 MB hospital PDF to a
   * signed document falls over on a real file rather than on a fixture.
   */
  await importDrawing(page);
  await page.getByTestId('stated-ratio-input').fill(record.crossCheck!.statedRatio);
  await page.getByTestId('stated-ratio-apply').click();
  await expect(page.getByTestId('recalibrate')).toBeVisible();

  await page.getByTestId('catalog-item-vantive_ak98').click();
  const canvas = await page.locator('div[role="application"]').boundingBox();
  if (!canvas) throw new Error('canvas has no bounding box');
  await page.mouse.click(canvas.x + canvas.width * 0.5, canvas.y + canvas.height * 0.5);
  await page.keyboard.press('Escape');

  await page.getByTestId('open-report').click();
  await expect(page.getByTestId('report-panel')).toBeVisible();
  await expect(page.getByTestId('report-validation')).toContainText('AK98');

  const download = page.waitForEvent('download');
  await page.getByTestId('report-download-pdf').click();
  const file = await download;
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const bytes = Buffer.concat(chunks);

  // A real PDF, not an empty file with the right name.
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(bytes.length).toBeGreaterThan(50_000);
});
