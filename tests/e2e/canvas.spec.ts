import { expect, test } from '@playwright/test';

/** Canvas navigation — the Sprint 1 foundation, guarded against regression. */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('canvas');
});

test('loads with no console errors', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));

  await page.goto('/');
  await page.waitForSelector('canvas');
  await expect(page.getByTestId('status-bar')).toBeVisible();

  expect(problems).toEqual([]);
});

test('reports the cursor position in millimetres', async ({ page }) => {
  const canvas = page.locator('div[role="application"]');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');

  await expect(page.getByTestId('field-x')).toHaveText('—');

  await page.mouse.move(box.x + 400, box.y + 300);
  await expect(page.getByTestId('field-x')).toContainText('mm');
  await expect(page.getByTestId('field-y')).toContainText('mm');
});

test('zooms about the cursor with Ctrl and the wheel', async ({ page }) => {
  const status = page.getByTestId('status-bar');
  const before = await status.innerText();

  const box = await page.locator('div[role="application"]').boundingBox();
  if (!box) throw new Error('canvas has no bounding box');

  await page.mouse.move(box.x + 500, box.y + 350);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -500);
  await page.keyboard.up('Control');

  await expect(status).not.toHaveText(before);
  await expect(status).toContainText('Zoom');
});

test('resets the view with 0', async ({ page }) => {
  const status = page.getByTestId('status-bar');
  const box = await page.locator('div[role="application"]').boundingBox();
  if (!box) throw new Error('canvas has no bounding box');

  const initial = await status.innerText();

  await page.mouse.move(box.x + 500, box.y + 350);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -500);
  await page.keyboard.up('Control');
  await expect(status).not.toHaveText(initial);

  await page.keyboard.press('0');
  await expect(page.getByTestId('field-zoom')).toHaveText('7.0%');
});

test('toggles the grid with G', async ({ page }) => {
  await expect(page.getByTestId('field-grid')).toHaveText('200 mm');
  await page.keyboard.press('g');
  await expect(page.getByTestId('field-grid')).toHaveText('off');
  await page.keyboard.press('g');
  await expect(page.getByTestId('field-grid')).toHaveText('200 mm');
});
