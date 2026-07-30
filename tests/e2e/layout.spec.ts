import { expect, test, type Page } from '@playwright/test';

/**
 * Layout generation, through the browser.
 *
 * Step 6A. Steps 3–5 built a deterministic solver with 72 unit tests and no way for an engineer to
 * reach it; these specs are what say the engine is *usable*, which is the whole point of the
 * milestone.
 *
 * The load-bearing ones are the approval specs. A solver that wrote to the document and offered an
 * undo would have already changed the drawing somebody was deciding about.
 */

async function canvasBox(page: Page) {
  const box = await page.locator('div[role="application"]').boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  return box;
}

/** Trace a rectangular room, big enough for several machines. */
async function traceRoom(page: Page) {
  const box = await canvasBox(page);
  await page.keyboard.press('r');

  const corners: [number, number][] = [
    [0.25, 0.25],
    [0.75, 0.25],
    [0.75, 0.7],
    [0.25, 0.7],
  ];
  for (const [x, y] of corners) {
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  }
  // Click the first vertex again to close the outline.
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.25);
  await page.keyboard.press('v');
}

async function generate(page: Page, stations?: string) {
  if (stations !== undefined) await page.getByTestId('layout-count').fill(stations);
  await page.getByTestId('layout-generate').click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('canvas');
});

test('asks for a room before it will propose anything', async ({ page }) => {
  // The solver needs an outline to work inside, and saying so beats an empty result list.
  await expect(page.getByTestId('layout-room')).toHaveText('No room selected');

  await generate(page, '4');

  await expect(page.getByTestId('layout-empty')).toBeVisible();
  await expect(page.getByTestId('layout-empty')).toContainText('Select a room');
});

test('offers ranked alternatives, not one answer', async ({ page }) => {
  await traceRoom(page);
  await generate(page, '4');

  await expect(page.getByTestId('layout-results')).toBeVisible();
  // The owner's floor is three. More than one is the property that matters — an optimiser that
  // returned a single layout would be presenting a choice as a conclusion.
  await expect(page.getByTestId('layout-proposal-1')).toBeVisible();
  await expect(page.getByTestId('layout-proposal-2')).toBeVisible();
});

test('shows coverage beside every total', async ({ page }) => {
  /*
   * The owner made this mandatory, and this is why: every rule threshold is null until the AK98
   * manual arrives, so compliance margin — 40 % of the model — cannot be computed. A total over the
   * remaining 60 % reads exactly like a complete one.
   */
  await traceRoom(page);
  await generate(page, '4');

  const coverage = page.getByTestId('layout-coverage-1');
  await expect(coverage).toBeVisible();
  await expect(coverage).toContainText('Coverage');
  await expect(coverage).toContainText('not measurable');
});

test('shows the per-criterion breakdown, never a bare total', async ({ page }) => {
  await traceRoom(page);
  await generate(page, '4');

  const breakdown = page.getByTestId('layout-breakdown-1');
  await expect(breakdown).toBeVisible();
  // Named criteria, with their normalised values — the arithmetic an engineer disagrees with.
  await expect(breakdown).toContainText('Maintenance access');
  await expect(breakdown).toContainText('Future expansion');
  // And the ones that could not be measured, with why rather than a blank.
  await expect(breakdown).toContainText('no requirement to compare against');
});

test('places nothing until the engineer approves', async ({ page }) => {
  // The requirement this milestone turns on. Generating and previewing must leave the drawing
  // exactly as it was.
  await traceRoom(page);
  await expect(page.getByTestId('field-placed')).toHaveText('0');

  await generate(page, '4');
  await expect(page.getByTestId('layout-results')).toBeVisible();
  await page.getByTestId('layout-preview-2').click();

  await expect(page.getByTestId('field-placed')).toHaveText('0');
});

test('applies the approved layout, and undoes it in one press', async ({ page }) => {
  await traceRoom(page);
  await generate(page, '4');

  await page.getByTestId('layout-apply-1').click();
  await expect(page.getByTestId('field-placed')).toHaveText('4');

  // One command group, one undo. Four presses would be technically truthful and unusable.
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('field-placed')).toHaveText('0');

  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByTestId('field-placed')).toHaveText('4');
});

test('clears the proposals once one is applied', async ({ page }) => {
  // Leaving them on screen would invite a second approval that placed the same machines again.
  await traceRoom(page);
  await generate(page, '4');
  await page.getByTestId('layout-apply-1').click();

  await expect(page.getByTestId('layout-results')).toHaveCount(0);
});

test('discards proposals without touching the drawing', async ({ page }) => {
  await traceRoom(page);
  await generate(page, '4');
  await page.getByTestId('layout-discard').click();

  await expect(page.getByTestId('layout-results')).toHaveCount(0);
  await expect(page.getByTestId('field-placed')).toHaveText('0');
});

test('resolves "as many as fit" and says what it resolved to', async ({ page }) => {
  // An engineer who leaves the count blank is owed the number, not just the layout.
  await traceRoom(page);
  await generate(page);

  await expect(page.getByTestId('layout-results')).toContainText('as many as fit');
});

test('says the room is too small rather than quietly placing fewer', async ({ page }) => {
  // "Shall not add or remove stations automatically", from the outside: forty machines do not fit,
  // and the answer is a sentence rather than a layout of the number that happened to fit.
  await traceRoom(page);
  await generate(page, '40');

  await expect(page.getByTestId('layout-empty')).toBeVisible();
  await expect(page.getByTestId('field-placed')).toHaveText('0');
});

test('produces the same ranking on a second run', async ({ page }) => {
  // Determinism, at the level an engineer observes it. The same room and the same count give the
  // same three totals, in the same order.
  await traceRoom(page);
  await generate(page, '4');
  const first = await page.getByTestId('layout-results').textContent();

  await page.getByTestId('layout-discard').click();
  await generate(page, '4');
  const second = await page.getByTestId('layout-results').textContent();

  expect(second).toBe(first);
});
