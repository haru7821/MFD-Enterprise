import { expect, test, type Page } from '@playwright/test';

/**
 * Reference points, through the browser.
 *
 * Sprint 6 step 2. The unit suites already cover the schema, the migration, the commands and the
 * report; what only a browser can prove is that an engineer can actually *place* one — the whole
 * feature is inert otherwise, and four of the approved scoring criteria stay unmeasurable.
 *
 * The load-bearing spec is the last one: a level with no points recorded says so in the report. An
 * absent statement would read as "nothing to report" when it means 40 % of the engineering score
 * cannot be computed.
 */

async function canvasBox(page: Page) {
  const box = await page.locator('div[role="application"]').boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  return box;
}

async function placePoint(page: Page, kind: string, at: { x: number; y: number }) {
  await page.getByTestId(`reference-kind-${kind}`).click();
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width * at.x, box.y + box.height * at.y);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('canvas');
});

test('starts with none, and says what that costs', async ({ page }) => {
  // The default project. The wording matters as much as the state: an engineer has to be able to
  // tell that this is something to do, not something that is fine.
  await expect(page.getByTestId('reference-point-empty')).toBeVisible();
  await expect(page.getByTestId('reference-point-empty')).toContainText('inconclusive');
  await expect(page.getByTestId('reference-point-list')).toHaveCount(0);
});

test('places a point of the armed kind, and only when a kind is armed', async ({ page }) => {
  // Clicking the canvas with the reference tool but nothing armed must place nothing. A tool that
  // defaulted to the first kind would put a drain where the engineer meant a panel.
  await page.keyboard.press('f');
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await expect(page.getByTestId('reference-point-empty')).toBeVisible();

  await placePoint(page, 'electrical_panel', { x: 0.3, y: 0.3 });

  await expect(page.getByTestId('reference-point-list')).toBeVisible();
  await expect(page.getByTestId('reference-point-list').locator('li')).toHaveCount(1);
  await expect(page.getByTestId('reference-point-list')).toContainText('Panel');
});

test('undoes a placement in one step', async ({ page }) => {
  await placePoint(page, 'drain', { x: 0.4, y: 0.4 });
  await expect(page.getByTestId('reference-point-list').locator('li')).toHaveCount(1);

  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('reference-point-empty')).toBeVisible();

  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByTestId('reference-point-list').locator('li')).toHaveCount(1);
});

test('names a point, and clearing the name restores the kind', async ({ page }) => {
  await placePoint(page, 'electrical_panel', { x: 0.35, y: 0.35 });

  await page.getByTestId('reference-point-label').fill('DB-3F-2');
  await expect(page.getByTestId('reference-point-list')).toContainText('DB-3F-2');

  // Cleared means unnamed, not named with an empty string — the list falls back to the kind.
  await page.getByTestId('reference-point-label').fill('');
  await expect(page.getByTestId('reference-point-list')).toContainText('Panel');
});

test('deletes a point and undo brings it back', async ({ page }) => {
  await placePoint(page, 'staff_base', { x: 0.5, y: 0.5 });
  const id = await page
    .getByTestId('reference-point-list')
    .locator('li button')
    .first()
    .getAttribute('data-testid');
  expect(id).toBeTruthy();

  await page.getByTestId(`reference-point-delete-${id?.replace('reference-point-', '')}`).click();
  await expect(page.getByTestId('reference-point-empty')).toBeVisible();

  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('reference-point-list').locator('li')).toHaveCount(1);
});

test('survives a save and reopen at document version 4', async ({ page }) => {
  await placePoint(page, 'ro_supply', { x: 0.45, y: 0.3 });
  await page.getByTestId('reference-point-label').fill('Loop tee');

  const download = page.waitForEvent('download');
  await page.getByTestId('save-project').click();
  const saved = await download;
  const stream = await saved.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
    documentVersion: number;
    project: { levels: { referencePoints: { kind: string; label: string | null }[] }[] };
  };

  expect(parsed.documentVersion).toBe(4);
  expect(parsed.project.levels[0]?.referencePoints).toEqual([
    expect.objectContaining({ kind: 'ro_supply', label: 'Loop tee' }),
  ]);
});

test('the report states the absence rather than omitting it', async ({ page }) => {
  // The spec this suite exists for. Nothing placed, so the report must say the distances cannot
  // be measured — not print a table of zeroes, and not print nothing at all.
  await page.getByTestId('open-report').click();
  await expect(page.getByTestId('report-panel')).toBeVisible();

  await expect(page.getByTestId('report-no-reference-points').first()).toBeVisible();
  await expect(page.getByTestId('report-no-reference-points').first()).toContainText(
    'No reference points recorded',
  );
});

test('the report lists the points once they are placed', async ({ page }) => {
  await placePoint(page, 'drain', { x: 0.3, y: 0.6 });
  await page.getByTestId('reference-point-label').fill('Stack A');

  await page.getByTestId('open-report').click();
  await expect(page.getByTestId('report-panel')).toBeVisible();

  const table = page.getByTestId('report-reference-points').first();
  await expect(table).toBeVisible();
  // Bilingual, like every other label the report prints.
  await expect(table).toContainText('Drain');
  await expect(table).toContainText('배수');
  await expect(table).toContainText('Stack A');
});
