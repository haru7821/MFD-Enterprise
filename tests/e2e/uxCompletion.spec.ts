import { type Page, expect, test } from '@playwright/test';

/**
 * Phase 4.5 — origin placement, vertex editing, obstructions and levels.
 *
 * These are gestures. There is nothing a unit test can say about whether a vertex
 * handle is grabbable, whether clicking an edge midpoint inserts where the engineer
 * aimed, or whether switching floors leaves the previous floor's selection behind
 * describing something invisible.
 */

async function canvasBox(page: Page) {
  const box = await page.locator('div[role="application"]').boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  return box;
}

async function clickAt(page: Page, fx: number, fy: number) {
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

/** A 1,200 × 800 PNG with some structure in it, through a real file input. */
async function makePlanFile(page: Page) {
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

/** Import a plan and calibrate it, so the origin step is reachable. */
async function importAndCalibrate(page: Page) {
  await page.getByTestId('plan-file-input').setInputFiles(await makePlanFile(page));
  await page.getByTestId('calibrate').click();
  await clickAt(page, 0.35, 0.5);
  await clickAt(page, 0.6, 0.5);
  await page.getByTestId('calibration-distance').fill('5000');
  await page.getByTestId('calibration-apply').click();
  await expect(page.getByTestId('recalibrate')).toBeVisible();
}

/**
 * Turn grid snapping off.
 *
 * Snapping is on by default and correct for real use, but the grid step at the opening
 * zoom is around a metre — 70 screen pixels. A traced corner therefore lands up to half
 * a step from where it was clicked, which is far outside the 9 px vertex grab radius, so
 * a spec that clicks a corner it just traced would miss it. Turning snapping off makes
 * the traced geometry land exactly where the spec put it.
 */
async function withoutSnapping(page: Page) {
  await page.keyboard.press('s');
  await expect(page.getByTestId('field-snap')).toHaveText('off');
}

/**
 * Trace a closed ring with whichever tracing tool is bound to `shortcut`, then return to
 * the select tool.
 *
 * The tracing tool stays armed after a ring closes, so several rooms can be drawn in a
 * row. Editing handles are deliberately not drawn while it is armed — a click would
 * start the next ring rather than grab a handle — so reshaping starts by pressing V,
 * which is what an engineer does too.
 */
async function trace(page: Page, shortcut: string, corners: readonly [number, number][]) {
  const box = await canvasBox(page);
  await page.keyboard.press(shortcut);
  for (const [fx, fy] of corners) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  }
  await page.keyboard.press('Enter');
  await page.keyboard.press('v');
}

const SQUARE: readonly [number, number][] = [
  [0.3, 0.3],
  [0.6, 0.3],
  [0.6, 0.6],
  [0.3, 0.6],
];

/** The first room's area in m², as the room list reports it. */
async function roomArea(page: Page): Promise<number> {
  const text = await page.getByTestId('space-list').innerText();
  return Number.parseFloat(text.replace(/^[\s\S]*?([\d.]+)\s*m²[\s\S]*$/, '$1'));
}

/** The X coordinate the status bar reports for a model point under the pointer. */
async function cursorX(page: Page, fx: number, fy: number): Promise<number> {
  const box = await canvasBox(page);
  await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
  const text = await page.getByTestId('field-x').innerText();
  return Number.parseFloat(text.replace(/[^\d.-]/g, ''));
}

/**
 * Save the project and read the file back.
 *
 * Some assertions are about coordinates being *identical* rather than close, and the
 * only place that can be settled is the document.
 */
async function savedDocument(page: Page): Promise<{
  project: {
    levels: {
      boundaries: { vertices: { x: number; y: number }[] }[];
    }[];
  };
}> {
  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('save-project').click(),
  ]).then(([event]) => event);

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
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
  await expect(page.getByTestId('level-select')).toBeVisible();

  expect(errors).toEqual([]);
});

test.describe('origin placement', () => {
  test('is not offered until the scale is set', async ({ page }) => {
    // There is nothing to be the origin of until a scale exists, and offering the
    // control before then would let an engineer set an origin that silently did nothing.
    await page.getByTestId('plan-file-input').setInputFiles(await makePlanFile(page));
    await expect(page.getByTestId('set-origin')).toHaveCount(0);
    await expect(page.getByText('Set the scale first', { exact: false })).toBeVisible();
  });

  test('picks the origin from the drawing and renumbers the coordinates', async ({ page }) => {
    await withoutSnapping(page);
    await importAndCalibrate(page);

    // Sampled off-centre on purpose: the view opens with model (0, 0) at the middle of
    // the canvas, so a reading taken there would be zero before *and* after and the
    // assertion would hold whatever the command did.
    const before = await cursorX(page, 0.72, 0.38);
    expect(Math.abs(before)).toBeGreaterThan(500);

    await page.getByTestId('set-origin').click();
    await clickAt(page, 0.72, 0.38);

    // That point is now model zero, so it reads as zero — the coordinates renumbered.
    await expect.poll(async () => Math.abs(await cursorX(page, 0.72, 0.38))).toBeLessThan(60);
  });

  test('leaves the layout where it was on the drawing', async ({ page }) => {
    // The load-bearing behaviour. Re-datuming without translating would slide the plan
    // out from under every machine already placed on it, which is silent and wrong.
    await withoutSnapping(page);
    await importAndCalibrate(page);
    await page.getByTestId('catalog-item-vantive_ak98').click();
    await clickAt(page, 0.4, 0.4);
    await page.keyboard.press('Escape');

    const before = await footprintLeftPx(page);
    expect(before).not.toBeNull();

    await page.getByTestId('set-origin').click();
    await clickAt(page, 0.7, 0.7);

    // The machine has not moved on screen, so it has not moved on the drawing.
    await expect
      .poll(async () => Math.abs(((await footprintLeftPx(page)) ?? 0) - (before ?? 0)))
      .toBeLessThan(2);
  });

  test('undoes the origin change', async ({ page }) => {
    await withoutSnapping(page);
    await importAndCalibrate(page);
    const before = await cursorX(page, 0.72, 0.38);

    await page.getByTestId('set-origin').click();
    await clickAt(page, 0.72, 0.38);
    await expect.poll(async () => Math.abs(await cursorX(page, 0.72, 0.38))).toBeLessThan(60);

    await page.keyboard.press('ControlOrMeta+z');
    await expect
      .poll(async () => Math.abs((await cursorX(page, 0.72, 0.38)) - before))
      .toBeLessThan(60);
  });

  test('cancels the pick on Escape without changing anything', async ({ page }) => {
    await withoutSnapping(page);
    await importAndCalibrate(page);
    const before = await cursorX(page, 0.72, 0.38);

    await page.getByTestId('set-origin').click();
    await page.keyboard.press('Escape');
    await clickAt(page, 0.72, 0.38);

    await expect
      .poll(async () => Math.abs((await cursorX(page, 0.72, 0.38)) - before))
      .toBeLessThan(60);
  });
});

test.describe('boundary vertex editing', () => {
  test('drags a vertex and reshapes the room', async ({ page }) => {
    await withoutSnapping(page);
    await trace(page, 'r', SQUARE);
    const areaBefore = await roomArea(page);

    const box = await canvasBox(page);
    // The room is selected after tracing, so its handles are on screen.
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.85);
    await page.mouse.up();

    await expect.poll(async () => roomArea(page)).toBeGreaterThan(areaBefore);
  });

  test('treats one vertex drag as one undo step', async ({ page }) => {
    await withoutSnapping(page);
    await trace(page, 'r', SQUARE);
    // Read the area rather than the whole row, and read it the same way both times:
    // `innerText` collapses differently from `toHaveText`, so comparing one against the
    // other fails on whitespace and says nothing about the geometry.
    const areaBefore = await roomArea(page);

    const box = await canvasBox(page);
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6);
    await page.mouse.down();
    for (let step = 1; step <= 10; step += 1) {
      await page.mouse.move(
        box.x + box.width * (0.6 + step * 0.02),
        box.y + box.height * (0.6 + step * 0.02),
      );
    }
    await page.mouse.up();
    await expect.poll(async () => roomArea(page)).not.toBe(areaBefore);

    // One undo returns the whole drag, not the last pointer move.
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(async () => roomArea(page)).toBe(areaBefore);
  });

  test('inserts a vertex by clicking an edge midpoint', async ({ page }) => {
    await withoutSnapping(page);
    await trace(page, 'r', SQUARE);
    await expect(page.getByTestId('space-vertex-count')).toContainText('4 vertices');

    // Midpoint of the top edge, between (0.3, 0.3) and (0.6, 0.3).
    await clickAt(page, 0.45, 0.3);
    await expect(page.getByTestId('space-vertex-count')).toContainText('5 vertices');
  });

  test('deletes the selected vertex, and refuses below three', async ({ page }) => {
    await withoutSnapping(page);
    await trace(page, 'r', SQUARE);

    // Select a corner handle, then remove it.
    await clickAt(page, 0.6, 0.6);
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('space-vertex-count')).toContainText('3 vertices');

    // A two-vertex "room" would report every machine in the building as outside it.
    await clickAt(page, 0.3, 0.3);
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('space-vertex-count')).toContainText('3 vertices');
  });

  test('snaps a dragged vertex onto a neighbouring room’s corner', async ({ page }) => {
    // Two rooms sharing a party wall have to share its coordinates **exactly**. A few
    // millimetres of daylight leaves a sliver of floor belonging to neither room, and
    // the containment test would then place a machine near that wall in neither.
    await withoutSnapping(page);
    await trace(page, 'r', SQUARE);
    await trace(page, 'r', [
      [0.64, 0.3],
      [0.85, 0.3],
      [0.85, 0.6],
      [0.64, 0.6],
    ]);

    const box = await canvasBox(page);
    // Drag the second room's top-left corner to *near* the first room's top-right one.
    // Near, not onto: the snap is the thing being tested.
    await page.mouse.move(box.x + box.width * 0.64, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6 + 4, box.y + box.height * 0.3 + 4);
    await page.mouse.up();

    // Checked in the saved document, because "exactly" is a claim about coordinates
    // and only the file can settle it. Two rings sharing a corner means that corner's
    // x and y appear in both.
    const saved = await savedDocument(page);
    const rings = saved.project.levels[0]?.boundaries.map((b) => b.vertices) ?? [];
    expect(rings).toHaveLength(2);

    const [first, second] = rings;
    const shared = (first ?? []).filter((a) =>
      (second ?? []).some((b) => a.x === b.x && a.y === b.y),
    );
    expect(shared).toHaveLength(1);
  });
});

test.describe('obstructions', () => {
  test('traces a column and lists it', async ({ page }) => {
    await trace(page, 'o', [
      [0.4, 0.4],
      [0.45, 0.4],
      [0.45, 0.45],
      [0.4, 0.45],
    ]);

    await expect(page.getByTestId('obstruction-list')).toBeVisible();
    await expect(page.getByTestId('field-obstructions')).toHaveText('1');
    // An obstruction is not a room: it gets no room record and no room function.
    await expect(page.getByTestId('field-rooms')).toHaveText('0');
  });

  test('names it and changes its type', async ({ page }) => {
    await trace(page, 'o', [
      [0.4, 0.4],
      [0.45, 0.4],
      [0.45, 0.45],
      [0.4, 0.45],
    ]);

    await page.getByTestId('obstruction-label').fill('Column C4');
    await page.getByTestId('obstruction-label').blur();
    await expect(page.getByTestId('obstruction-list')).toContainText('Column C4');

    await page.getByTestId('obstruction-type').selectOption('shaft');
    await expect(page.getByTestId('obstruction-type')).toHaveValue('shaft');
  });

  test('picks up the type chosen for the next one', async ({ page }) => {
    await page.getByTestId('draft-obstruction-type').selectOption('shaft');
    await trace(page, 'o', [
      [0.4, 0.4],
      [0.45, 0.4],
      [0.45, 0.45],
      [0.4, 0.45],
    ]);
    await expect(page.getByTestId('obstruction-type')).toHaveValue('shaft');
  });

  test('flags a machine standing on it', async ({ page }) => {
    // The boundary evaluator delivered in Sprint 4 already checks obstructions; Phase
    // 4.5 only added the means to draw one. This is the spec that proves the two meet.
    await trace(page, 'o', [
      [0.35, 0.35],
      [0.55, 0.35],
      [0.55, 0.55],
      [0.35, 0.55],
    ]);

    await page.getByTestId('catalog-item-vantive_ak98').click();
    await clickAt(page, 0.45, 0.45);

    await expect(page.getByTestId('validation-panel')).toContainText('overlaps');
    await expect(page.getByTestId('result-badge-RED').first()).toBeVisible();
  });

  test('undoes a traced obstruction in one step', async ({ page }) => {
    await trace(page, 'o', [
      [0.4, 0.4],
      [0.45, 0.4],
      [0.45, 0.45],
      [0.4, 0.45],
    ]);
    await expect(page.getByTestId('field-obstructions')).toHaveText('1');

    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.getByTestId('field-obstructions')).toHaveText('0');
  });
});

test.describe('levels', () => {
  test('adds a level and switches to it', async ({ page }) => {
    await page.getByTestId('catalog-item-vantive_ak98').click();
    await clickAt(page, 0.4, 0.4);
    await expect(page.getByTestId('field-placed')).toHaveText('1');

    await page.getByTestId('add-level').click();

    // A new floor is empty, and the machine is still on the one it was placed on.
    await expect(page.getByTestId('field-placed')).toHaveText('0');
    await expect(page.getByTestId('level-select')).toHaveValue(/level-/);

    await page.getByTestId('level-select').selectOption({ index: 0 });
    await expect(page.getByTestId('field-placed')).toHaveText('1');
  });

  test('renames a level', async ({ page }) => {
    await page.getByTestId('level-name').fill('3F dialysis');
    await page.getByTestId('level-name').blur();
    await expect(page.getByTestId('field-level')).toHaveText('3F dialysis');
    await expect(page.getByTestId('level-select')).toContainText('3F dialysis');
  });

  test('will not delete the only floor', async ({ page }) => {
    // A project with no floor is not a project, and the schema requires at least one.
    await expect(page.getByTestId('delete-level')).toBeDisabled();
  });

  test('deletes a level whole, and undo brings it back whole', async ({ page }) => {
    await page.getByTestId('catalog-item-vantive_ak98').click();
    await clickAt(page, 0.4, 0.4);
    await page.keyboard.press('Escape');

    await page.getByTestId('add-level').click();
    await expect(page.getByTestId('delete-level')).toBeEnabled();

    // Go back to the first floor and delete it, machine and all.
    await page.getByTestId('level-select').selectOption({ index: 0 });
    await expect(page.getByTestId('field-placed')).toHaveText('1');
    await page.getByTestId('delete-level').click();
    await expect(page.getByTestId('field-placed')).toHaveText('0');

    await page.keyboard.press('ControlOrMeta+z');
    await page.getByTestId('level-select').selectOption({ index: 0 });
    await expect(page.getByTestId('field-placed')).toHaveText('1');
  });

  test('keeps each level’s rooms and plan to itself', async ({ page }) => {
    await trace(page, 'r', SQUARE);
    await expect(page.getByTestId('field-rooms')).toHaveText('1');

    await page.getByTestId('add-level').click();
    await expect(page.getByTestId('field-rooms')).toHaveText('0');
    // And the new floor has no drawing, so its scale step is offered fresh.
    await expect(page.getByTestId('import-plan')).toContainText('Import');
  });

  test('survives a save and reopen with two levels', async ({ page }) => {
    await trace(page, 'r', SQUARE);
    await page.getByTestId('add-level').click();
    await page.getByTestId('level-name').fill('4F');
    await page.getByTestId('level-name').blur();

    const download = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('save-project').click(),
    ]).then(([event]) => event);

    await page.getByTestId('new-project').click();
    await expect(page.getByTestId('level-select')).toHaveText('Level 1');

    await page.getByTestId('project-file-input').setInputFiles(await download.path());
    await expect(page.getByTestId('level-select')).toContainText('4F');
    await expect(page.getByTestId('field-rooms')).toHaveText('1');
  });
});

/**
 * The left edge of the drawn equipment footprint, in CSS pixels.
 *
 * Selects the equipment fill rather than its stroke — the draft stroke and the
 * "DRAFT DATA" label share one amber. Same method as equipment.spec.ts.
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

test.describe('calibration method recommendation', () => {
  /*
   * Owner decision, Q-4: *"Implement both calibration methods … The application should
   * automatically recommend the most reliable method available for each drawing."*
   *
   * The imported fixture here is a PNG, so its resolution is unknown and the printed-scale route
   * cannot be offered — which makes this the case that matters: a scan with no dimension line has
   * no method at all, and the panel must say so rather than nudge towards the weaker route.
   */

  async function importPng(page: Page) {
    await page.getByTestId('plan-file-input').setInputFiles({
      name: 'ward.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
    });
    await expect(page.getByTestId('calibration-advice')).toBeVisible();
  }

  test('asks whether the drawing carries a dimension, rather than guessing', async ({ page }) => {
    // A PDF's vector content is never read, so nothing in the file answers this. Guessing would
    // pick the calibration route on no evidence.
    await importPng(page);

    await expect(page.getByTestId('calibration-advice')).toHaveAttribute(
      'data-code',
      'awaiting_dimension_line_answer',
    );
  });

  test('recommends measuring a dimension when the drawing has one', async ({ page }) => {
    await importPng(page);
    await page.getByTestId('dimension-line-yes').click();

    await expect(page.getByTestId('calibration-advice')).toHaveAttribute(
      'data-code',
      'prefer_two_point',
    );
    await expect(page.getByTestId('calibrate')).toContainText('recommended');
  });

  test('offers no method for a raster scan with no dimension, and says why', async ({ page }) => {
    /*
     * The honest dead end. A PNG carries no trustworthy statement of the size it was scanned at, so
     * "1:100" cannot be converted by any arithmetic that is not invented. Uncalibrated is a state
     * this application handles properly — every rule YELLOW, never GREEN — and it beats a scale
     * derived from a resolution nobody recorded.
     */
    await importPng(page);
    await page.getByTestId('dimension-line-no').click();

    await expect(page.getByTestId('calibration-advice')).toHaveAttribute(
      'data-code',
      'no_method_available',
    );
    await expect(page.getByTestId('calibration-impossible')).toContainText(
      'neither method can be completed',
    );
    // Neither route is offered — not offered-and-then-failed at the last step.
    await expect(page.getByTestId('calibrate')).toHaveCount(0);
    await expect(page.getByTestId('stated-ratio-route')).toHaveCount(0);
  });
});

test.describe('calibration safety rule', () => {
  /*
   * Owner decision: *"If a title block specifies a paper size, compare it against the actual PDF
   * page size. If they do not match, the printed-scale calibration path must be rejected
   * automatically … Record the reason in the UI."*
   *
   * **A PDF, not the PNG the tests above use.** A raster carries no trustworthy resolution, so its
   * sheet size is unknowable and it can never mismatch — which is the rule working, and it was my
   * first attempt at this test failing for exactly that reason. Only a PDF has a page size to
   * disagree with, so the fixture below is a minimal 595 × 842 pt page: A4, like Hospital_026's
   * sheets, which print `A3 : 1/200` on A4.
   */

  /**
   * A real A4 PDF whose drawn title block claims A3 — the Hospital_026 shape, generated rather than
   * copied from the dataset so no hospital drawing enters this repository.
   *
   * Generated by `scripts/make-drawing-fixture.ts` with pdf-lib. A hand-assembled PDF was tried
   * first and pdf.js refused it, which is the correct outcome for a file that is not really a PDF —
   * the importer reported it as unreadable rather than pretending.
   */
  const A4_PDF_PATH = 'fixtures/drawings/a4-titleblock-a3.pdf';

  async function importA4Pdf(page: Page) {
    await page.getByTestId('plan-file-input').setInputFiles(A4_PDF_PATH);
    await expect(page.getByTestId('calibration-advice')).toBeVisible({ timeout: 30_000 });
  }

  test('reports the file’s own sheet size beside the claim', async ({ page }) => {
    // The engineer types what the title block says; the application states what the file is. The
    // comparison is mechanical, and both halves are on screen so it can be checked.
    await importA4Pdf(page);

    await expect(page.getByTestId('actual-sheet')).toContainText('A4');
  });

  test('refuses the printed scale when the title block disagrees, and says why', async ({
    page,
  }) => {
    await importA4Pdf(page);
    await page.getByTestId('dimension-line-no').click();
    await page.getByTestId('claimed-sheet-A3').click();

    await expect(page.getByTestId('calibration-advice')).toHaveAttribute(
      'data-code',
      'paper_size_mismatch',
    );
    await expect(page.getByTestId('calibration-advice-text')).toContainText(
      'names a paper size the file is not',
    );
    // Refused, not merely ranked second.
    await expect(page.getByTestId('stated-ratio-route')).toHaveCount(0);
  });

  test('still points the engineer at the dimension line', async ({ page }) => {
    // The owner's instruction exactly: reject the printed scale, recommend dimension-line instead.
    // A mismatched title block says nothing about the dimension lines, which measure the file as it
    // actually is.
    await importA4Pdf(page);
    await page.getByTestId('dimension-line-yes').click();
    await page.getByTestId('claimed-sheet-A3').click();

    await expect(page.getByTestId('calibrate')).toBeVisible();
    await expect(page.getByTestId('calibration-advice')).toHaveAttribute(
      'data-code',
      'paper_size_mismatch',
    );
  });

  test('clears the refusal when the claim is withdrawn', async ({ page }) => {
    // Clicking the same size again unsets it. An engineer who mis-clicked must be able to get back
    // to the ordinary advice without reimporting the drawing.
    await importA4Pdf(page);
    await page.getByTestId('dimension-line-yes').click();
    await page.getByTestId('claimed-sheet-A3').click();
    await page.getByTestId('claimed-sheet-A3').click();

    await expect(page.getByTestId('calibration-advice')).toHaveAttribute(
      'data-code',
      'prefer_two_point',
    );
  });
});
