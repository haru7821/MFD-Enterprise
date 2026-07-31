import { expect, test, type Page } from '@playwright/test';

/**
 * Installation planning, through the browser — and the owner's Sprint 6 acceptance criteria.
 *
 * > *"An engineer can: Generate Layout, Optimize Layout, Approve Layout, Generate Installation
 * > Plan, Export PDF — without internet access. That completes the MVP."*
 *
 * The last clause is the one that needs a test rather than an assertion in a README, so the whole
 * acceptance path runs with the network blocked at the browser. If any part of this product had
 * acquired a service dependency, the run fails here rather than on a hospital's air-gapped laptop.
 */

async function canvasBox(page: Page) {
  const box = await page.locator('div[role="application"]').boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  return box;
}

async function traceRoom(page: Page) {
  const box = await canvasBox(page);
  await page.keyboard.press('r');
  for (const [x, y] of [
    [0.25, 0.25],
    [0.75, 0.25],
    [0.75, 0.7],
    [0.25, 0.7],
  ] as [number, number][]) {
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  }
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.25);
  await page.keyboard.press('v');
}

async function placeServices(page: Page) {
  const box = await canvasBox(page);
  const points: [string, number, number][] = [
    ['ro_supply', 0.26, 0.26],
    ['electrical_panel', 0.74, 0.26],
    ['drain', 0.26, 0.69],
  ];
  for (const [kind, x, y] of points) {
    await page.getByTestId(`reference-kind-${kind}`).click();
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  }
  await page.keyboard.press('v');
}

async function selectRoom(page: Page) {
  await page.getByTestId('space-list').getByRole('button').first().click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('canvas');
});

test('refuses to plan a drawing with nothing on it', async ({ page }) => {
  /*
   * Owner § 1, at the editor's boundary. `PlanInput.evaluation` being required makes an unevaluated
   * layout impossible to plan at all; this is the other half — an empty level has no installation,
   * and a plan of one would be a document about nothing.
   */
  await traceRoom(page);
  await page.getByTestId('plan-generate').click();

  await expect(page.getByTestId('plan-refusal')).toContainText('no installation to plan');
  await expect(page.getByTestId('plan-results')).toHaveCount(0);
});

test('refuses while layout proposals are still on screen', async ({ page }) => {
  // A layout somebody is still deciding about is not the layout they mean to plan.
  await traceRoom(page);
  await page.getByTestId('catalog-item-vantive_ak98').click();
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);
  await page.keyboard.press('v');
  await selectRoom(page);

  await page.getByTestId('layout-count').fill('3');
  await page.getByTestId('layout-generate').click();
  await expect(page.getByTestId('layout-results')).toBeVisible();

  await page.getByTestId('plan-generate').click();
  await expect(page.getByTestId('plan-refusal')).toContainText('Apply or discard');
});

test('the whole acceptance path, with the network blocked', async ({ page, context }) => {
  /*
   * The MVP, end to end: Draw → Generate → Optimize → Approve → Plan → Export.
   *
   * Every outbound request is aborted before the page loads, so anything that reached for a service
   * would fail rather than silently succeed on a machine that happens to have internet. The one
   * exception is the page's own origin — that is the application being served, not a dependency.
   */
  const blocked: string[] = [];
  await context.route('**', (route) => {
    const url = route.request().url();
    if (url.startsWith('http://localhost') || url.startsWith('data:') || url.startsWith('blob:')) {
      return route.continue();
    }
    /*
     * Recorded as well as aborted.
     *
     * Aborting alone is not a test: a stray request to a CDN would be denied and the application
     * would very likely carry on, so the run would pass while the product had quietly acquired a
     * dependency that fails on an air-gapped laptop. The assertion at the end is the actual check.
     */
    blocked.push(url);
    return route.abort();
  });
  await page.goto('/');
  await page.waitForSelector('canvas');

  // 1 · Draw
  await traceRoom(page);
  await placeServices(page);
  await selectRoom(page);

  // 2 · Generate a layout
  await page.getByTestId('layout-count').fill('3');
  await page.getByTestId('layout-generate').click();
  await expect(page.getByTestId('layout-results')).toBeVisible();

  // 3 · Approve it
  await page.getByTestId('layout-apply-1').click();
  await expect(page.getByTestId('field-placed')).toHaveText('3');

  // 4 · Optimise the approved layout, and take it if it has something to offer
  await selectRoom(page);
  await page.getByTestId('layout-allow-moving').setChecked(true);
  await page.getByTestId('layout-optimise').click();
  // Either outcome is correct here: the solver's own layout is usually already the best it can
  // construct. What matters is that it answered, and that the count did not change.
  await expect(page.getByTestId('field-placed')).toHaveText('3');

  // 5 · Plan the installation.
  //
  // Discarding first only if anything came back: with no reference points the optimiser usually has
  // nothing to offer, and a button that is not on screen is the correct outcome rather than a step
  // to insist on.
  const proposals = page.getByTestId('layout-discard');
  if (await proposals.isVisible()) await proposals.click();
  await page.getByTestId('plan-generate').click();
  await expect(page.getByTestId('plan-results')).toBeVisible();
  await expect(page.getByTestId('plan-stages')).toContainText('Equipment Set');
  await expect(page.getByTestId('plan-stages')).toContainText('Commissioning');

  // 6 · Export the PDF, which now carries the plan
  await page.getByRole('button', { name: 'Report' }).click();
  const download = page.waitForEvent('download');
  await page.getByTestId('report-download-pdf').click();
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/);

  // Nothing left the machine. Not "nothing succeeded" — nothing was asked for.
  expect(blocked).toEqual([]);
});

test('shows the steps, tools, materials, connections and risks', async ({ page }) => {
  // The owner's § 8, item by item.
  await traceRoom(page);
  await placeServices(page);
  await selectRoom(page);
  await page.getByTestId('layout-count').fill('3');
  await page.getByTestId('layout-generate').click();
  await page.getByTestId('layout-apply-1').click();

  await page.getByTestId('plan-generate').click();

  await expect(page.getByTestId('plan-stages')).toBeVisible();
  // Steps, in dependency order — the rough-in before the pressure test before the connection.
  const stages = await page.getByTestId('plan-stages').innerText();
  expect(stages.indexOf('Services Rough-In')).toBeLessThan(stages.indexOf('RO Loop Pressure Test'));
  expect(stages.indexOf('RO Loop Pressure Test')).toBeLessThan(stages.indexOf('Service Connection'));

  // Tools, each entailed by a check rather than invented.
  await expect(page.getByTestId('plan-tools-ro_pressure_test')).toContainText('Pressure Test Rig');
  // Materials: one connection set per machine per required service.
  await expect(page.getByTestId('plan-bom')).toContainText('Power Connection Set');
  await expect(page.getByTestId('plan-bom')).toContainText('3 each');
  // Connections: all three services, with routed totals.
  await expect(page.getByTestId('plan-connection-power')).toBeVisible();
  await expect(page.getByTestId('plan-connection-ro_water')).toBeVisible();
  await expect(page.getByTestId('plan-connection-drain')).toBeVisible();
});

test('says Unknown, and says what would answer it', async ({ page }) => {
  /*
   * The owner's §§ 4–5, where an engineer actually meets them. No labour rate has been supplied, so
   * duration and manpower are unknown — and the panel prints the word plus the file that would
   * answer it, rather than a dash. A dash reads as a layout choice; this reads as a job.
   */
  await traceRoom(page);
  await placeServices(page);
  await selectRoom(page);
  await page.getByTestId('layout-count').fill('3');
  await page.getByTestId('layout-generate').click();
  await page.getByTestId('layout-apply-1').click();
  await page.getByTestId('plan-generate').click();

  await expect(page.getByTestId('plan-duration')).toContainText('Unknown');
  // The total says why a *total* is unknown; the stage below it names the file that would answer it.
  await expect(page.getByTestId('plan-duration')).toContainText('not every stage has one');
  await expect(page.getByTestId('plan-stage-equipment_set')).toContainText('sequence_set');
  await expect(page.getByTestId('plan-manpower')).toContainText('Unknown');
  // And never a zero, which would read as a real figure.
  await expect(page.getByTestId('plan-duration')).not.toContainText('0 hour');
});

test('names the missing reference point instead of quietly dropping a stage', async ({ page }) => {
  // No RO supply marked means no loop to pressure test. A silently shorter plan reads as a simpler
  // job, so the stage is absent *and* the reason is on screen.
  await traceRoom(page);
  await selectRoom(page);
  await page.getByTestId('catalog-item-vantive_ak98').click();
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);
  await page.keyboard.press('v');

  await page.getByTestId('plan-generate').click();

  await expect(page.getByTestId('plan-stages')).not.toContainText('RO Loop Pressure Test');
  await expect(page.getByTestId('plan-blockers')).toContainText('No reference point placed');
  await expect(page.getByTestId('plan-blockers')).toContainText('ro_supply');
});

test('routes around a column rather than through it', async ({ page }) => {
  /*
   * The obstacles the editor hands the router, checked end to end.
   *
   * A cable that runs through a structural column is not a shorter cable, and a total computed from
   * one is a length somebody orders against. Measured as a **change**: plan once with a clear
   * floor, drop a column across the run from the panel, plan again, and the power total has to grow.
   * Asserting a specific millimetre figure would be asserting the router's arithmetic, which has its
   * own tests one package down.
   *
   * The machines go in by hand at the bottom of the room, so the column is unambiguously between
   * them and the services at the top. A generated layout would put them wherever the solver liked,
   * and a column that missed the run would make this test pass by accident.
   */
  const box = await canvasBox(page);
  await traceRoom(page);
  await placeServices(page);

  await page.getByTestId('catalog-item-vantive_ak98').click();
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.62);
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.62);
  await page.keyboard.press('v');

  await page.getByTestId('plan-generate').click();
  const clear = await page.getByTestId('plan-connection-power').innerText();

  /*
   * A wall of an obstruction across the room, and it has to be wide enough to block **both** L-routes.
   *
   * That is the thing worth knowing about the router: a Manhattan route has two right-angled paths,
   * and blocking one leaves the other the same length. A partial wall that missed the second would
   * change nothing and this test would pass by accident. So it extends past the panel's own column
   * of the room, leaving only the far left to get around.
   */
  await page.keyboard.press('o');
  for (const [x, y] of [
    [0.29, 0.44],
    [0.82, 0.44],
    [0.82, 0.5],
    [0.29, 0.5],
  ] as [number, number][]) {
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  }
  await page.mouse.click(box.x + box.width * 0.29, box.y + box.height * 0.44);
  await page.keyboard.press('v');
  await expect(page.getByTestId('field-obstructions')).toHaveText('1');

  await page.getByTestId('plan-clear').click();
  await page.getByTestId('plan-generate').click();
  const obstructed = await page.getByTestId('plan-connection-power').innerText();

  expect(millimetres(obstructed)).toBeGreaterThan(millimetres(clear));
});

/** The first figure in a connection line, as a number. */
function millimetres(text: string): number {
  const match = /([\d,]+)\s*mm/.exec(text);
  if (!match?.[1]) throw new Error(`no length in "${text}"`);
  return Number(match[1].replaceAll(',', ''));
}

test('produces the same plan twice', async ({ page }) => {
  // Determinism, at the level an engineer observes it: the same layout gives the same plan.
  await traceRoom(page);
  await placeServices(page);
  await selectRoom(page);
  await page.getByTestId('layout-count').fill('3');
  await page.getByTestId('layout-generate').click();
  await page.getByTestId('layout-apply-1').click();

  await page.getByTestId('plan-generate').click();
  const first = await page.getByTestId('plan-results').innerText();

  await page.getByTestId('plan-clear').click();
  await page.getByTestId('plan-generate').click();
  const second = await page.getByTestId('plan-results').innerText();

  expect(second).toBe(first);
});
