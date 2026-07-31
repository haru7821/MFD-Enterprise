import { type Page, expect, test } from '@playwright/test';

/**
 * Equipment placement and dimension fidelity.
 *
 * The dimension test is the load-bearing one: a machine drawn at the wrong size is
 * the failure this product exists to prevent, and no unit test can catch it —
 * the numbers can be right the whole way down and still reach the screen wrong.
 *
 * Method and its two traps are documented in docs/testing/PLAYWRIGHT_TEST_PLAN.md.
 */

/**
 * The AK98's **design footprint** — the planning area, and the only size anything
 * geometric measures.
 *
 * Its manufacturer dimensions are 345 × 600 × 1305 mm, deliberately different. That
 * separation is the point: a drawing reserves the planning area, and confusing the two is
 * how a footprint rounded up to make a layout work erases the measurement of the machine
 * that arrives on site.
 */
const FOOTPRINT_WIDTH_MM = 800;
const FOOTPRINT_DEPTH_MM = 800;

const MANUFACTURER_SIZE = '345 × 600 × 1305 mm';

/**
 * Measure the drawn footprint from canvas pixels.
 *
 * Selects the equipment **fill** — the draft stroke and the "DRAFT DATA" label
 * share one amber, so a stroke-based scan would measure the label too. Rows and
 * columns are then thresholded, because anti-aliased text edges land in the same
 * alpha window as the fill.
 */
async function measureFootprint(page: Page) {
  return page.evaluate(() => {
    const element = document.querySelector('canvas');
    if (!element) return null;

    const { width, height } = element;
    const context = element.getContext('2d');
    if (!context) return null;

    const data = context.getImageData(0, 0, width, height).data;
    const rows = new Int32Array(height);
    const columns = new Int32Array(width);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        const r = data[i] ?? 0;
        const g = data[i + 1] ?? 0;
        const b = data[i + 2] ?? 0;
        const a = data[i + 3] ?? 0;
        // The canvas is transparent over a CSS background, so getImageData
        // returns the fill un-composited: rgba(232,162,62) at alpha 33.
        if (r >= 225 && r <= 240 && g >= 150 && g <= 175 && b >= 50 && b <= 75 && a >= 20 && a <= 60) {
          rows[y] = (rows[y] ?? 0) + 1;
          columns[x] = (columns[x] ?? 0) + 1;
        }
      }
    }

    const THRESHOLD = 10;
    const extent = (counts: Int32Array): number | null => {
      let min = -1;
      let max = -1;
      for (let i = 0; i < counts.length; i += 1) {
        if ((counts[i] ?? 0) >= THRESHOLD) {
          if (min < 0) min = i;
          max = i;
        }
      }
      return min < 0 ? null : max - min + 1;
    };

    const w = extent(columns);
    const h = extent(rows);
    const dpr = window.devicePixelRatio || 1;
    return w === null || h === null ? null : { widthPx: w / dpr, heightPx: h / dpr };
  });
}

async function zoomPercent(page: Page): Promise<number> {
  const text = await page.getByTestId('field-zoom').innerText();
  const value = Number.parseFloat(text);
  if (Number.isNaN(value)) throw new Error(`no zoom in status bar: ${text}`);
  return value;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('canvas');
});

test('lists the catalogue with figures read from the JSON', async ({ page }) => {
  const item = page.getByTestId('catalog-item-vantive_ak98');

  await expect(item).toContainText('AK98');
  await expect(item).toContainText('Vantive');
  // Both figures, labelled. The palette shows the plan footprint and the unit size,
  // because they answer different questions and showing one unlabelled is how they came
  // to be confused.
  await expect(page.getByTestId('footprint-vantive_ak98')).toHaveText(
    `${FOOTPRINT_WIDTH_MM} × ${FOOTPRINT_DEPTH_MM} mm`,
  );
  await expect(page.getByTestId('manufacturer-size-vantive_ak98')).toHaveText(
    MANUFACTURER_SIZE,
  );
});

test('lists a generic planning object with no manufacturer', async ({ page }) => {
  // The dialysis bed has a design footprint and no manufacturer dimensions at all —
  // the case the manufacturer/design split exists for.
  const item = page.getByTestId('catalog-item-dialysis_bed');

  await expect(item).toContainText('Dialysis Bed');
  await expect(item).toContainText('Generic planning object');
  await expect(page.getByTestId('footprint-dialysis_bed')).toHaveText('1000 × 2100 mm');
  // No unit size row, because there is no unit size — not a blank one.
  await expect(page.getByTestId('manufacturer-size-dialysis_bed')).toHaveCount(0);
});

test('draws the bed at its design footprint, not the machine\'s', async ({ page }) => {
  await page.getByTestId('catalog-item-dialysis_bed').click();
  const box = await page.locator('div[role="application"]').boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.25);
  await page.keyboard.press('Escape');

  const zoom = await zoomPercent(page);
  const measured = await measureFootprint(page);
  expect(measured).not.toBeNull();

  // 1000 × 2100 mm. A bed is not square, so this also proves width and depth are not
  // being read from the same field.
  //
  // Same pixel budget as the machine's dimension test above: what the scan loses is the
  // anti-aliased fill boundary, which is a constant per edge and not a fraction of the
  // object.
  const PIXEL_BUDGET = 6;
  expect(Math.abs((measured?.widthPx ?? 0) - 1_000 * (zoom / 100))).toBeLessThanOrEqual(
    PIXEL_BUDGET,
  );
  expect(Math.abs((measured?.heightPx ?? 0) - 2_100 * (zoom / 100))).toBeLessThanOrEqual(
    PIXEL_BUDGET,
  );
  // And the two are different, which is the point: a bed is not square.
  expect((measured?.heightPx ?? 0) / (measured?.widthPx ?? 1)).toBeCloseTo(2.1, 1);
});

test('marks placeholder data as draft', async ({ page }) => {
  await expect(page.getByTestId('draft-badge').first()).toBeVisible();

  await page.getByTestId('catalog-item-vantive_ak98').click();
  const box = await page.locator('div[role="application"]').boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);

  await expect(page.getByTestId('draft-placement-warning')).toBeVisible();
  await expect(page.getByTestId('provisional-warning')).toBeVisible();
});

test('states verification per field group, not per record', async ({ page }) => {
  // Verification is per group: dimensions can be sourced while clearances are not, and
  // the panel has to say which is which. A single record-level badge cannot, and that is
  // what this replaces.
  const chips = page.getByTestId('data-status-vantive_ak98').locator('[data-status]');
  await expect(chips).toHaveCount(9);

  /*
   * Every group is named, so no group can be silently missing from the readout. Nine since the
   * owner's AK98 source clarification: five specification groups the manufacturer answers for, and
   * four installation groups no manufacturer document may answer for. The four are listed here by
   * name rather than counted, because "the palette shows the installation gaps" is the thing worth
   * asserting — they are what A-1 now consists of.
   */
  for (const group of [
    'manufacturerDimensions',
    'power',
    'roWater',
    'drain',
    'environmental',
    'serviceClearance',
    'maintenanceAccess',
    'portLocations',
    'installationRouting',
  ]) {
    await expect(page.getByTestId(`data-status-vantive_ak98-${group}`)).toBeVisible();
  }

  /*
   * The mixed row this test was written to anticipate. The owner designated the approved
   * specification authoritative for dimensions, so that one group is now `verified` while the
   * clearances stay `draft` — which is per-group verification doing the thing it exists for,
   * visible in the palette.
   */
  await expect(
    page.getByTestId('data-status-vantive_ak98-manufacturerDimensions'),
  ).toHaveAttribute('data-status', 'verified');
  await expect(page.getByTestId('data-status-vantive_ak98-serviceClearance')).toHaveAttribute(
    'data-status',
    'draft',
  );

  // The tooltip says why, in a sentence an engineer can repeat to a customer.
  await expect(page.getByTestId('data-status-vantive_ak98-serviceClearance')).toHaveAttribute(
    'title',
    /no manual reference recorded yet/,
  );
});

test('draws the machine at its catalogue size, at every zoom', async ({ page }) => {
  await page.getByTestId('catalog-item-vantive_ak98').click();
  const box = await page.locator('div[role="application"]').boundingBox();
  if (!box) throw new Error('canvas has no bounding box');

  const placeAt = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.3 };
  await page.mouse.click(placeAt.x, placeAt.y);
  await expect(page.getByTestId('field-placed')).toHaveText('1');

  const errors: number[] = [];

  for (const step of [0, 1, 2]) {
    if (step > 0) {
      await page.mouse.move(placeAt.x, placeAt.y);
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -420);
      await page.keyboard.up('Control');
      await page.waitForTimeout(250);
    }

    const zoom = await zoomPercent(page);
    const measured = await measureFootprint(page);
    expect(measured).not.toBeNull();
    if (!measured) return;

    // 100 % zoom is one screen pixel per millimetre.
    const expectedWidthPx = FOOTPRINT_WIDTH_MM * (zoom / 100);
    const expectedDepthPx = FOOTPRINT_DEPTH_MM * (zoom / 100);

    // Judged as a pixel budget rather than a percentage. What the measurement
    // loses is fixed and scale-independent: the anti-aliased fill boundary, plus
    // the validation outline drawn over it, together eat about two pixels per
    // edge. A percentage tolerance would have to be loosened arbitrarily at low
    // zoom to accommodate a constant — which would also hide a real scale error.
    const PIXEL_BUDGET = 6;
    expect(Math.abs(measured.widthPx - expectedWidthPx)).toBeLessThanOrEqual(PIXEL_BUDGET);
    expect(Math.abs(measured.heightPx - expectedDepthPx)).toBeLessThanOrEqual(PIXEL_BUDGET);

    const widthError = Math.abs(measured.widthPx - expectedWidthPx) / expectedWidthPx;

    // Where the object is large enough for a percentage to mean anything, hold it
    // to a tight one.
    if (zoom >= 25) expect(widthError).toBeLessThan(0.03);

    errors.push(widthError);
  }

  // The relative error must shrink as the object grows. One that stays constant in
  // percentage terms is a scale bug wearing an edge effect's clothing.
  const first = errors[0] ?? 0;
  const last = errors[errors.length - 1] ?? 0;
  expect(last).toBeLessThan(first);
});

test('moves a placed machine without changing its size', async ({ page }) => {
  await page.getByTestId('catalog-item-vantive_ak98').click();
  const box = await page.locator('div[role="application"]').boundingBox();
  if (!box) throw new Error('canvas has no bounding box');

  const placeAt = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.3 };
  await page.mouse.click(placeAt.x, placeAt.y);

  const before = await measureFootprint(page);

  await page.keyboard.press('v');
  const zoom = await zoomPercent(page);
  const centre = {
    x: placeAt.x + (FOOTPRINT_WIDTH_MM / 2) * (zoom / 100),
    y: placeAt.y + (FOOTPRINT_DEPTH_MM / 2) * (zoom / 100),
  };

  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + box.width * 0.15, centre.y + box.height * 0.15, {
    steps: 10,
  });
  await page.mouse.up();

  await expect(page.getByTestId('field-placed')).toHaveText('1');
  // Polled for the same reason as the delete case below: the canvas rasterises a frame
  // after the DOM settles.
  await expect.poll(async () => measureFootprint(page)).toEqual(before);
});

test('deletes the selected machine', async ({ page }) => {
  await page.getByTestId('catalog-item-vantive_ak98').click();
  const box = await page.locator('div[role="application"]').boundingBox();
  if (!box) throw new Error('canvas has no bounding box');

  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await expect(page.getByTestId('field-placed')).toHaveText('1');

  await page.keyboard.press('Delete');
  await expect(page.getByTestId('field-placed')).toHaveText('0');

  // Polled, not read once. The status bar updates in the React commit; Konva rasterises
  // in a later frame, so a single `getImageData` here can still see the deleted machine.
  // It passed nearly always and failed under parallel load, which is the worst way for a
  // race to present itself.
  await expect.poll(async () => measureFootprint(page)).toBeNull();
});
