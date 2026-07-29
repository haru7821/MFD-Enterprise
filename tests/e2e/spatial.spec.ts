import { type Page, expect, test } from '@playwright/test';

/**
 * Sprint 4 — plan import, calibration, room tracing and undo, in a real browser.
 *
 * These cover the parts a unit test cannot reach: a file going through a real file
 * input, a canvas click landing on the room the geometry says it should, and undo
 * behaving like one step after a drag that emitted sixty commands.
 */

/** A 1,200 × 800 PNG, uniform grey. Enough to be a drawing; small enough to inline. */
async function makePlanFile(page: Page): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1_200;
    canvas.height = 800;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d context');
    context.fillStyle = '#e8e8e8';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#333333';
    context.fillRect(100, 100, 1_000, 600);
    return canvas.toDataURL('image/png');
  });

  return {
    name: 'floor-plan.png',
    mimeType: 'image/png',
    buffer: Buffer.from(dataUrl.split(',')[1] ?? '', 'base64'),
  };
}

async function canvasBox(page: Page) {
  const box = await page.locator('div[role="application"]').boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  return box;
}

/** Click at a fraction of the canvas, so specs do not depend on the viewport size. */
async function clickAt(page: Page, fx: number, fy: number) {
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

/** Trace a rectangular room and close it on the first vertex. */
async function traceRoom(
  page: Page,
  corners: readonly [number, number][],
): Promise<void> {
  const box = await canvasBox(page);
  await page.keyboard.press('r');

  for (const [fx, fy] of corners) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  }

  // Enter closes the ring without having to hit the first vertex exactly, which
  // keeps the spec from depending on a 10-pixel hit target.
  await page.keyboard.press('Enter');
}

/**
 * The left edge of the drawn equipment footprint, in CSS pixels.
 *
 * Selects the equipment **fill** rather than its stroke: the draft stroke and the
 * "DRAFT DATA" label share one amber, so a stroke-based scan would find the label
 * too. Same method as equipment.spec.ts, which documents the two traps.
 */
async function footprintLeftPx(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const element = document.querySelector('canvas');
    if (!element) return null;
    const { width, height } = element;
    const context = element.getContext('2d');
    if (!context) return null;

    const data = context.getImageData(0, 0, width, height).data;
    const columns = new Int32Array(width);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        const r = data[i] ?? 0;
        const g = data[i + 1] ?? 0;
        const b = data[i + 2] ?? 0;
        const a = data[i + 3] ?? 0;
        if (r >= 225 && r <= 240 && g >= 150 && g <= 175 && b >= 50 && b <= 75 && a >= 20 && a <= 60) {
          columns[x] = (columns[x] ?? 0) + 1;
        }
      }
    }

    const THRESHOLD = 10;
    for (let x = 0; x < width; x += 1) {
      if ((columns[x] ?? 0) >= THRESHOLD) return x / (window.devicePixelRatio || 1);
    }
    return null;
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('canvas');
});

test('loads with no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.reload();
  await page.waitForSelector('canvas');
  await expect(page.getByTestId('space-list')).toHaveCount(0);

  expect(errors).toEqual([]);
});

test.describe('plan workflow', () => {
  test('imports a drawing and reports it as uncalibrated', async ({ page }) => {
    await page.getByTestId('plan-file-input').setInputFiles(await makePlanFile(page));

    await expect(page.getByText('floor-plan.png')).toBeVisible();
    await expect(page.getByText('1200×800 px')).toBeVisible();
    // The whole point of step 2: an imported drawing is not yet a measurable one.
    await expect(page.getByTestId('plan-uncalibrated-warning')).toBeVisible();
    await expect(page.getByTestId('calibrate')).toBeVisible();
  });

  test('cannot reach GREEN while the plan is uncalibrated', async ({ page }) => {
    await page.getByTestId('plan-file-input').setInputFiles(await makePlanFile(page));
    await page.getByTestId('catalog-item-vantive_ak98').click();
    await clickAt(page, 0.4, 0.4);

    // Measuring a screen distance and calling it a clearance is the single most
    // damaging thing this application could do. It is blocked structurally.
    await expect(page.getByTestId('result-badge-GREEN')).toHaveCount(0);
  });

  test('calibrates from two picked points and a typed distance', async ({ page }) => {
    await page.getByTestId('plan-file-input').setInputFiles(await makePlanFile(page));
    await page.getByTestId('calibrate').click();

    // Two points on the drawing, then the real distance between them.
    await clickAt(page, 0.35, 0.5);
    await clickAt(page, 0.6, 0.5);

    await page.getByTestId('calibration-distance').fill('5000');
    await page.getByTestId('calibration-apply').click();

    await expect(page.getByTestId('plan-uncalibrated-warning')).toHaveCount(0);
    await expect(page.getByTestId('recalibrate')).toBeVisible();
    await expect(page.getByText('mm/px', { exact: false })).toBeVisible();
  });

  test('refuses a scale it cannot use rather than pretending to be calibrated', async ({
    page,
  }) => {
    await page.getByTestId('plan-file-input').setInputFiles(await makePlanFile(page));
    await page.getByTestId('calibrate').click();

    // The same point twice: no pixel distance, so no derivable scale.
    await clickAt(page, 0.45, 0.5);
    await clickAt(page, 0.45, 0.5);

    await page.getByTestId('calibration-distance').fill('5000');
    await page.getByTestId('calibration-apply').click();

    await expect(page.getByTestId('plan-error')).toBeVisible();
    await expect(page.getByTestId('plan-uncalibrated-warning')).toBeVisible();
  });

  test('discards the calibration when a different drawing is imported', async ({ page }) => {
    await page.getByTestId('plan-file-input').setInputFiles(await makePlanFile(page));
    await page.getByTestId('calibrate').click();
    await clickAt(page, 0.35, 0.5);
    await clickAt(page, 0.6, 0.5);
    await page.getByTestId('calibration-distance').fill('5000');
    await page.getByTestId('calibration-apply').click();
    await expect(page.getByTestId('recalibrate')).toBeVisible();

    // A mapping describes a specific image. Carrying it over would apply one
    // drawing's scale to another's pixels, and look entirely normal doing it.
    await page.getByTestId('plan-file-input').setInputFiles(await makePlanFile(page));
    await expect(page.getByTestId('plan-uncalibrated-warning')).toBeVisible();
  });
});

test.describe('room tracing', () => {
  test('traces a room and lists it with an area', async ({ page }) => {
    await traceRoom(page, [
      [0.3, 0.3],
      [0.6, 0.3],
      [0.6, 0.6],
      [0.3, 0.6],
    ]);

    await expect(page.getByTestId('space-list')).toBeVisible();
    await expect(page.getByTestId('field-rooms')).toHaveText('1');
    await expect(page.getByTestId('space-list')).toContainText('m²');
  });

  test('will not create a room from fewer than three points', async ({ page }) => {
    const box = await canvasBox(page);
    await page.keyboard.press('r');
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3);
    await page.keyboard.press('Enter');

    // Two points enclose nothing. A room made of them would report every machine
    // in the building as outside it.
    await expect(page.getByTestId('field-rooms')).toHaveText('0');
  });

  test('abandons a half-traced room on Escape', async ({ page }) => {
    const box = await canvasBox(page);
    await page.keyboard.press('r');
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('field-rooms')).toHaveText('0');
  });

  test('renames a room and keeps the vocabulary controlled', async ({ page }) => {
    await traceRoom(page, [
      [0.3, 0.3],
      [0.6, 0.3],
      [0.6, 0.6],
      [0.3, 0.6],
    ]);

    await page.getByTestId('space-name').fill('Treatment area A');
    await expect(page.getByTestId('space-list')).toContainText('Treatment area A');

    // A dropdown, not free text: a rule that matches nothing looks exactly like a
    // rule that everything passes.
    await page.getByTestId('space-function').selectOption('isolation_treatment');
    await expect(page.getByTestId('space-function')).toHaveValue('isolation_treatment');
  });

  test('places a machine inside a room and reports it as inside', async ({ page }) => {
    await traceRoom(page, [
      [0.25, 0.25],
      [0.7, 0.25],
      [0.7, 0.7],
      [0.25, 0.7],
    ]);

    await page.getByTestId('catalog-item-vantive_ak98').click();
    await clickAt(page, 0.45, 0.45);

    await expect(page.getByTestId('validation-panel')).toContainText('is inside');
  });

  test('reports a machine left outside every room', async ({ page }) => {
    await traceRoom(page, [
      [0.25, 0.25],
      [0.45, 0.25],
      [0.45, 0.45],
      [0.25, 0.45],
    ]);

    await page.getByTestId('catalog-item-vantive_ak98').click();
    await clickAt(page, 0.8, 0.8);

    // An engineer who has drawn the rooms and left a machine in the corridor needs
    // to see that, not a silent pass.
    await expect(page.getByTestId('validation-panel')).toContainText('outside every room outline');
    await expect(page.getByTestId('result-badge-RED').first()).toBeVisible();
  });

  test('deleting a room leaves the equipment on the drawing', async ({ page }) => {
    await traceRoom(page, [
      [0.25, 0.25],
      [0.7, 0.25],
      [0.7, 0.7],
      [0.25, 0.7],
    ]);

    await page.getByTestId('catalog-item-vantive_ak98').click();
    await clickAt(page, 0.45, 0.45);
    await expect(page.getByTestId('field-placed')).toHaveText('1');

    await page.getByTestId('space-list').getByRole('button').first().click();
    await page.getByTestId('delete-space').click();

    // Losing a machine because a room outline was redrawn is not a recoverable
    // mistake, and is exactly what an ownership hierarchy would have produced.
    await expect(page.getByTestId('field-rooms')).toHaveText('0');
    await expect(page.getByTestId('field-placed')).toHaveText('1');
  });
});

test.describe('undo and redo', () => {
  test('undoes a placement and redoes it', async ({ page }) => {
    await page.getByTestId('catalog-item-vantive_ak98').click();
    await clickAt(page, 0.4, 0.4);
    await expect(page.getByTestId('field-placed')).toHaveText('1');

    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.getByTestId('field-placed')).toHaveText('0');

    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(page.getByTestId('field-placed')).toHaveText('1');
  });

  test('treats one drag as one undo step', async ({ page }) => {
    const box = await canvasBox(page);
    await page.getByTestId('catalog-item-vantive_ak98').click();
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.4);
    await page.keyboard.press('Escape');

    const start = await footprintLeftPx(page);
    expect(start).not.toBeNull();

    // A drag emits a move command per pointer move. Sixty undo steps to get back
    // where it started is not what "undo the move" means.
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.4);
    await page.mouse.down();
    for (let step = 1; step <= 12; step += 1) {
      await page.mouse.move(
        box.x + box.width * (0.3 + step * 0.02),
        box.y + box.height * 0.4,
      );
    }
    await page.mouse.up();

    // Guard against the test passing because nothing moved at all.
    //
    // Polled rather than read once: reading the canvas straight after an input
    // event races the repaint, and a single read would be measuring the previous
    // frame. `toHaveText` retries for free; `page.evaluate` does not.
    await expect
      .poll(async () => Math.abs(((await footprintLeftPx(page)) ?? 0) - (start ?? 0)))
      .toBeGreaterThan(20);

    // One undo, all the way back — not back to the previous pointer move.
    await page.keyboard.press('ControlOrMeta+z');
    await expect
      .poll(async () => Math.abs(((await footprintLeftPx(page)) ?? 0) - (start ?? 0)))
      .toBeLessThan(2);
  });

  test('undoes a traced room in one step, outline and all', async ({ page }) => {
    await traceRoom(page, [
      [0.3, 0.3],
      [0.6, 0.3],
      [0.6, 0.6],
      [0.3, 0.6],
    ]);
    await expect(page.getByTestId('field-rooms')).toHaveText('1');

    // A room and its outline are one command: undo must not leave one behind.
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.getByTestId('field-rooms')).toHaveText('0');
  });

  test('treats one renaming session as one undo step', async ({ page }) => {
    await traceRoom(page, [
      [0.3, 0.3],
      [0.6, 0.3],
      [0.6, 0.6],
      [0.3, 0.6],
    ]);

    // Typing emits a command per keystroke. Sixteen undo steps to take back a name
    // is not what anyone means by undo.
    await page.getByTestId('space-name').fill('Treatment area A');
    await page.getByTestId('space-name').blur();
    await expect(page.getByTestId('space-list')).toContainText('Treatment area A');

    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.getByTestId('space-list')).toContainText('Room 1');
    // And the room itself is still there — the rename undid, not the room.
    await expect(page.getByTestId('field-rooms')).toHaveText('1');
  });

  test('leaves the browser undo alone inside a text field', async ({ page }) => {
    await traceRoom(page, [
      [0.3, 0.3],
      [0.6, 0.3],
      [0.6, 0.6],
      [0.3, 0.6],
    ]);

    await page.getByTestId('space-name').fill('Treatment area A');
    await page.getByTestId('space-name').press('ControlOrMeta+z');

    // Undoing the document while somebody is retyping a room name is not what
    // they meant by Ctrl+Z.
    await expect(page.getByTestId('field-rooms')).toHaveText('1');
  });
});

test.describe('save and open', () => {
  test('round-trips a project through a file', async ({ page }) => {
    await traceRoom(page, [
      [0.3, 0.3],
      [0.6, 0.3],
      [0.6, 0.6],
      [0.3, 0.6],
    ]);
    await page.getByTestId('space-name').fill('Treatment area A');
    await page.getByTestId('catalog-item-vantive_ak98').click();
    await clickAt(page, 0.45, 0.45);

    const download = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('save-project').click(),
    ]).then(([event]) => event);

    const path = await download.path();
    expect(download.suggestedFilename()).toContain('.mfd.json');

    await page.getByTestId('new-project').click();
    await expect(page.getByTestId('field-rooms')).toHaveText('0');
    await expect(page.getByTestId('field-placed')).toHaveText('0');

    await page.getByTestId('project-file-input').setInputFiles(path);

    await expect(page.getByTestId('field-rooms')).toHaveText('1');
    await expect(page.getByTestId('field-placed')).toHaveText('1');
    await expect(page.getByTestId('space-list')).toContainText('Treatment area A');
  });

  test('refuses a file that is not a project', async ({ page }) => {
    await page.getByTestId('project-file-input').setInputFiles({
      name: 'notes.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"hello":"world"}'),
    });

    await expect(page.getByTestId('project-error')).toBeVisible();
  });
});
