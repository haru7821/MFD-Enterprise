import { type Page, expect, test } from '@playwright/test';

/**
 * Rule engine, through the browser.
 *
 * The shipped rule set carries null thresholds — the AK98 installation manual has
 * not been supplied — so these assertions describe the behaviour of a validator
 * that is honest about having nothing to validate against. When real figures
 * arrive, the "threshold unknown" expectations here are the ones that will need
 * updating, and that is the intended signal.
 */

/** Place at a fraction of the canvas, so the specs do not depend on panel widths. */
async function placeAt(page: Page, fractionX: number, fractionY: number) {
  const box = await page.locator('div[role="application"]').boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  await page.mouse.click(box.x + box.width * fractionX, box.y + box.height * fractionY);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('canvas');
});

test('shows the rule set identity and an empty state', async ({ page }) => {
  const panel = page.getByTestId('validation-panel');

  await expect(panel).toContainText('Installation check');
  await expect(panel).toContainText('Rule set dialysis v0.1.0');
  await expect(panel).toContainText('No requirements evaluated');
});

test('evaluates rules as soon as equipment is placed', async ({ page }) => {
  await page.getByTestId('catalog-item-vantive_ak98').click();
  await placeAt(page, 0.35, 0.3);

  const results = page.getByTestId('validation-result');
  await expect(results.first()).toBeVisible();
  // Four clearance sides plus one equipment-collision finding, per machine, plus
  // the one boundary finding saying no room has been drawn to check against.
  await expect(results).toHaveCount(6);
});

test('reports an unknown threshold as YELLOW rather than inventing a status', async ({
  page,
}) => {
  await page.getByTestId('catalog-item-vantive_ak98').click();
  await placeAt(page, 0.35, 0.3);

  const panel = page.getByTestId('validation-panel');
  await expect(panel).toContainText('threshold unknown');
  await expect(page.getByTestId('result-badge-YELLOW').first()).toBeVisible();
  await expect(page.getByTestId('result-badge-GREEN')).toHaveCount(0);
});

test('never reports GREEN while the data is provisional', async ({ page }) => {
  await page.getByTestId('catalog-item-vantive_ak98').click();
  await placeAt(page, 0.25, 0.25);
  await placeAt(page, 0.6, 0.25);

  await expect(page.getByTestId('provisional-warning')).toBeVisible();
  await expect(page.getByTestId('result-badge-GREEN')).toHaveCount(0);
});

test('raises RED when two machines overlap', async ({ page }) => {
  await page.getByTestId('catalog-item-vantive_ak98').click();
  // A second machine well inside the first: the footprint is 800 mm wide and the
  // default zoom is 7 %, so ~63 px apart is a deep overlap.
  await placeAt(page, 0.35, 0.3);
  await placeAt(page, 0.37, 0.32);

  await expect(page.getByTestId('result-badge-RED').first()).toBeVisible();
  await expect(page.getByTestId('validation-panel')).toContainText('overlaps');
  await expect(page.getByTestId('findings-summary')).toContainText('RED');
});

test('anchors the collision on both machines', async ({ page }) => {
  await page.getByTestId('catalog-item-vantive_ak98').click();
  await placeAt(page, 0.35, 0.3);
  await placeAt(page, 0.37, 0.32);

  // Equipment-centred reporting: an engineer looking at either machine sees it.
  await expect(page.getByTestId('result-badge-RED')).toHaveCount(2);
});

test('keeps the findings list proportional to the layout', async ({ page }) => {
  await page.getByTestId('catalog-item-vantive_ak98').click();
  for (let i = 0; i < 8; i += 1) {
    await placeAt(page, 0.15 + (i % 4) * 0.2, 0.2 + Math.floor(i / 4) * 0.35);
  }

  // Four clearance findings plus one collision finding per machine, plus the
  // single boundary finding. The pair-centred model produced 4n + n(n-1)/2 — 60
  // rows for eight machines, and 1,425 for fifty.
  await expect(page.getByTestId('validation-result')).toHaveCount(41);
});

test('clears the collision once the machines are separated', async ({ page }) => {
  await page.getByTestId('catalog-item-vantive_ak98').click();
  await placeAt(page, 0.35, 0.3);
  await placeAt(page, 0.37, 0.32);
  await expect(page.getByTestId('result-badge-RED').first()).toBeVisible();

  // Drag the selected machine well clear.
  await page.keyboard.press('v');
  const box = await page.locator('div[role="application"]').boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.75, { steps: 12 });
  await page.mouse.up();

  await expect(page.getByTestId('result-badge-RED')).toHaveCount(0);
});

test('states the provenance of every finding', async ({ page }) => {
  await page.getByTestId('catalog-item-vantive_ak98').click();
  await placeAt(page, 0.35, 0.3);

  // Specification section 6: every rule requires source information. With no
  // manual supplied, the panel must say so rather than leave it blank.
  await expect(page.getByTestId('validation-panel')).toContainText(
    'No source document — provisional',
  );
});
