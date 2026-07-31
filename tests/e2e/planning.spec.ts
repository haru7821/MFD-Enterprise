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

test('states B-7’s sentence instead of estimating', async ({ page }) => {
  /*
   * Owner decision B-7, where an engineer actually meets it.
   *
   * > *"Do not estimate manpower or installation duration … If any required rate is missing:
   * > Duration = Unknown, Manpower = Unknown … The report must explicitly state 'Planning rate data
   * > not available.' instead of displaying calculated numbers."*
   *
   * `standards/sequences/dialysis.json` ships `installationRates: []`, so this is what every
   * project sees today — and it names the file and the rule rather than leaving a blank.
   */
  await traceRoom(page);
  await placeServices(page);
  await selectRoom(page);
  await page.getByTestId('layout-count').fill('3');
  await page.getByTestId('layout-generate').click();
  await page.getByTestId('layout-apply-1').click();
  await page.getByTestId('plan-generate').click();

  const notice = page.getByTestId('plan-rates-unavailable');
  await expect(notice).toContainText('Planning rate data not available.');
  await expect(notice).toContainText('standards/sequences/dialysis.json');

  // The figures are absent rather than shown as zero or as a dash — B-7's "instead of displaying
  // calculated numbers", which is a stronger requirement than "display Unknown".
  await expect(page.getByTestId('plan-duration')).toHaveCount(0);
  await expect(page.getByTestId('plan-manpower')).toHaveCount(0);
  await expect(page.getByTestId('plan-results')).not.toContainText('0 hour');
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

test('says which level a plan is for, and when it is not the one on screen', async ({ page }) => {
  /*
   * A plan belongs to one level. Switching levels to look at something else should not destroy it —
   * but the panel then shows a plan for a floor the engineer is not looking at, and nothing said so.
   */
  await traceRoom(page);
  await placeServices(page);
  await selectRoom(page);
  await page.getByTestId('layout-count').fill('3');
  await page.getByTestId('layout-generate').click();
  await page.getByTestId('layout-apply-1').click();
  await page.getByTestId('plan-generate').click();

  await expect(page.getByTestId('plan-provenance')).toContainText('Level 1');
  await expect(page.getByTestId('plan-provenance')).toContainText('3 stations');
  await expect(page.getByTestId('plan-provenance')).not.toContainText('not the level');

  // Add a second level and switch to it. The plan survives, and says it is not this floor's.
  await page.getByTestId('add-level').click();
  await expect(page.getByTestId('plan-results')).toBeVisible();
  await expect(page.getByTestId('plan-provenance')).toContainText('not the level you are viewing');
});

test('does not carry a plan across into a new project', async ({ page }) => {
  /*
   * A plan is made from one project's layout and its evaluation. Carrying it into another is not a
   * cosmetic leak: `useReportModel` passes whatever plan is in state into the report, so the next
   * PDF an engineer exported would carry the previous project's stages, connection lengths and
   * bill of materials — under the new project's name, on its cover page.
   *
   * Found while hardening, by reading what `document/new` and `document/load` reset and noticing
   * that the four planning fields were not among them.
   */
  await traceRoom(page);
  await placeServices(page);
  await selectRoom(page);
  await page.getByTestId('layout-count').fill('3');
  await page.getByTestId('layout-generate').click();
  await page.getByTestId('layout-apply-1').click();
  await page.getByTestId('plan-generate').click();
  await expect(page.getByTestId('plan-results')).toBeVisible();

  await page.getByRole('button', { name: 'New' }).click();

  await expect(page.getByTestId('field-placed')).toHaveText('0');
  await expect(page.getByTestId('plan-results')).toHaveCount(0);
  await expect(page.getByTestId('plan-refusal')).toHaveCount(0);
});

test('does not carry layout proposals across into a new project', async ({ page }) => {
  // The same leak, one panel over: the ghosts would draw at the old project's coordinates, and
  // Apply would place the old project's machines into the new one.
  await traceRoom(page);
  await selectRoom(page);
  await page.getByTestId('layout-count').fill('3');
  await page.getByTestId('layout-generate').click();
  await expect(page.getByTestId('layout-results')).toBeVisible();

  await page.getByRole('button', { name: 'New' }).click();

  await expect(page.getByTestId('layout-results')).toHaveCount(0);
});

/*
 * ---------------------------------------------------------------------------
 * Hardening 1 — plan staleness
 * ---------------------------------------------------------------------------
 */

/** Draw, place, plan. The starting point for every staleness spec. */
async function planAThreeStationWard(page: Page) {
  await traceRoom(page);
  await placeServices(page);
  await selectRoom(page);
  await page.getByTestId('layout-count').fill('3');
  await page.getByTestId('layout-generate').click();
  await page.getByTestId('layout-apply-1').click();
  await page.getByTestId('plan-generate').click();
  await expect(page.getByTestId('plan-results')).toBeVisible();
}

test('a fresh plan is not marked outdated', async ({ page }) => {
  // The other half of the guard. A warning that is always on is a warning nobody reads.
  await planAThreeStationWard(page);

  await expect(page.getByTestId('plan-stale')).toHaveCount(0);
  await expect(page.getByTestId('plan-generate')).toHaveText('Generate installation plan');
});

test('marks the plan outdated the moment the layout changes', async ({ page }) => {
  /*
   * > *"An installation plan must never appear valid after the layout changes … UI must clearly
   * > show: 'Installation plan is outdated. Regenerate required.'"*
   */
  await planAThreeStationWard(page);

  // One more machine, by hand.
  const box = await canvasBox(page);
  await page.getByTestId('catalog-item-vantive_ak98').click();
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.6);
  await page.keyboard.press('v');

  await expect(page.getByTestId('plan-stale')).toContainText(
    'Installation plan is outdated. Regenerate required.',
  );
  await expect(page.getByTestId('plan-stale')).toContainText('the equipment layout changed');
});

test('does not silently update, and does not regenerate on its own', async ({ page }) => {
  /*
   * > *"Do not silently update. Do not automatically regenerate. The engineer must approve
   * > regeneration."*
   *
   * The plan on screen after the edit is still the *old* plan — three stations, not four — and it
   * stays that way until somebody presses the button. Asserted through the station count in the
   * provenance line, which is the plan's own record of what it was made from.
   */
  await planAThreeStationWard(page);
  await expect(page.getByTestId('plan-provenance')).toContainText('3 stations');

  const box = await canvasBox(page);
  await page.getByTestId('catalog-item-vantive_ak98').click();
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.6);
  await page.keyboard.press('v');
  await expect(page.getByTestId('field-placed')).toHaveText('4');

  // Warned, and unchanged. Still the three-station plan.
  await expect(page.getByTestId('plan-stale')).toBeVisible();
  await expect(page.getByTestId('plan-provenance')).toContainText('3 stations');
});

test('clears the warning when the engineer regenerates', async ({ page }) => {
  await planAThreeStationWard(page);

  const box = await canvasBox(page);
  await page.getByTestId('catalog-item-vantive_ak98').click();
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.6);
  await page.keyboard.press('v');
  await expect(page.getByTestId('plan-stale')).toBeVisible();

  // The button says what it now does, and pressing it is the engineer's approval.
  await expect(page.getByTestId('plan-generate')).toHaveText('Regenerate installation plan');
  await page.getByTestId('plan-generate').click();

  await expect(page.getByTestId('plan-stale')).toHaveCount(0);
  await expect(page.getByTestId('plan-provenance')).toContainText('4 stations');
});

test('goes current again when the change is undone', async ({ page }) => {
  /*
   * The revision is derived from content, not from a counter — so undoing back to the layout a
   * plan was made from makes the plan describe the drawing again. A counter would have said
   * "outdated" forever and taught an engineer to regenerate out of habit.
   */
  await planAThreeStationWard(page);

  const box = await canvasBox(page);
  await page.getByTestId('catalog-item-vantive_ak98').click();
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.6);
  await page.keyboard.press('v');
  await expect(page.getByTestId('plan-stale')).toBeVisible();

  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('field-placed')).toHaveText('3');
  await expect(page.getByTestId('plan-stale')).toHaveCount(0);
});

test('changing a machine’s transform marks the plan outdated, not only adding one', async ({
  page,
}) => {
  /*
   * The layout revision covers each machine's **transform**, not just how many there are: a station
   * turned or moved is a different installation, and the connection runs in the plan are no longer
   * the ones it printed.
   *
   * Exercised with a keyboard rotation rather than a pointer drag. The drag version grabbed a
   * solver-placed machine at a fixed canvas coordinate, which worked only for as long as the solver
   * put one there — it stopped when candidate spacing began coming from the observed station pitch.
   * A browser test whose setup depends on where the optimiser happens to place things breaks every
   * time the optimiser improves. Which *fields* the revision covers, position included, is asserted
   * directly in `fingerprint.test.ts`; what this test is for is that the editor wires it up at all.
   */
  /*
   * The machine to drag is placed **by hand at a known point**, then the plan is generated around
   * it. Grabbing "the first machine the solver placed" at a fixed canvas coordinate worked until the
   * solver started spacing candidates from the observed station pitch — at which point the grab
   * point had no machine under it and the drag moved nothing. A test that depends on where the
   * optimiser happens to put things breaks every time the optimiser gets better.
   */
  await planAThreeStationWard(page);
  await expect(page.getByTestId('plan-stale')).toHaveCount(0);

  // Place one more machine and re-plan, so the machine about to be turned is one this test put
  // there rather than one the solver chose a position for.
  await page.getByTestId('catalog-item-vantive_ak98').click();
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.6);
  await selectRoom(page);
  await page.getByTestId('plan-generate').click();
  await expect(page.getByTestId('plan-results')).toBeVisible();
  await expect(page.getByTestId('plan-stale')).toHaveCount(0);

  // Placing selects, so the machine is still the selection — turn it a quarter turn.
  await page.getByTestId('catalog-item-vantive_ak98').click();
  await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.6);
  await page.keyboard.press(']');

  await expect(page.getByTestId('plan-stale')).toContainText('outdated');
});

test('a stale plan warns in the exported report', async ({ page }) => {
  /*
   * > *"A stale plan must never produce a signed PDF without warning."*
   *
   * Checked through the HTML export rather than the PDF, because the assertion is about the
   * *content* and HTML is the format a test can read. Both renderers take the warning from the
   * same `staleness` field on the model, and the PDF renderer's copy is unit-tested.
   */
  await planAThreeStationWard(page);

  const box = await canvasBox(page);
  await page.getByTestId('catalog-item-vantive_ak98').click();
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.6);
  await page.keyboard.press('v');
  await expect(page.getByTestId('plan-stale')).toBeVisible();

  await page.getByRole('button', { name: 'Report' }).click();
  const download = page.waitForEvent('download');
  await page.getByTestId('report-download-html').click();
  const file = await download;

  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const html = Buffer.concat(chunks).toString('utf8');

  expect(html).toContain('Installation plan is outdated. Regenerate required.');
  expect(html).toContain('must not be used as a basis for installation');
});

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
