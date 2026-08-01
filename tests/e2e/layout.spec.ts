import { expect, test, type Page } from '@playwright/test';

/**
 * Layout generation and optimisation, through the browser.
 *
 * Steps 6A and 6B. Steps 3–5 built a deterministic solver with 81 unit tests and no way for an
 * engineer to reach it; these specs are what say the engine is *usable*, which is the whole point
 * of the milestone. The two real defects step 6A found — a generator blind to the machines already
 * in the room, and "as many as fit" resolving to a count the gates then rejected — were both
 * invisible to the unit fixtures and obvious the moment a browser drew a room.
 *
 * The load-bearing ones are the approval specs. A solver that wrote to the document and offered an
 * undo would have already changed the drawing somebody was deciding about.
 */

async function canvasBox(page: Page) {
  const box = await page.locator('div[role="application"]').boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  return box;
}

/**
 * Trace a rectangular room, big enough for several machines.
 *
 * The corners are a parameter because the whole-level specs need a **second** room to put a machine
 * in — a level with one room cannot test the difference between "not in this room" and the name of
 * the room it is in.
 */
async function traceRoom(page: Page, corners?: readonly [number, number][]) {
  const box = await canvasBox(page);
  await page.keyboard.press('r');

  const outline: readonly [number, number][] = corners ?? [
    [0.25, 0.25],
    [0.75, 0.25],
    [0.75, 0.7],
    [0.25, 0.7],
  ];
  for (const [x, y] of outline) {
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  }
  // Click the first vertex again to close the outline.
  const first = outline[0];
  if (!first) throw new Error('an outline needs at least one corner');
  await page.mouse.click(box.x + box.width * first[0], box.y + box.height * first[1]);
  await page.keyboard.press('v');
}

async function generate(page: Page, stations?: string) {
  if (stations !== undefined) await page.getByTestId('layout-count').fill(stations);
  await page.getByTestId('layout-generate').click();
}

/**
 * Put machines in the room by hand, the way an engineer starts.
 *
 * Not by generating and applying: a partially occupied room is only a real test of the solver if
 * what occupies it is *not* something the solver produced. An arrangement it chose is already the
 * arrangement it would choose again.
 */
async function placeByHand(page: Page, positions: readonly [number, number][]) {
  const box = await canvasBox(page);
  await page.getByTestId('catalog-item-vantive_ak98').click();
  for (const [x, y] of positions) {
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  }
  await page.keyboard.press('v');
}

/**
 * Select the room again, from the room list.
 *
 * Placing equipment selects the machine, which deselects the space — and the solver needs an
 * outline to work inside. The list rather than the canvas, because a click on the floor of a room
 * is a click on empty canvas as far as the editor is concerned: rooms are selected by name.
 */
async function selectRoom(page: Page) {
  await page.getByTestId('space-list').getByRole('button').first().click();
  await expect(page.getByTestId('layout-room')).not.toHaveText('No room selected');
}

/**
 * Put the services on the drawing, at one corner of the room.
 *
 * Not optional dressing for the optimisation specs — it is what gives the solver anything to
 * discriminate on. Every clearance figure in the shipped catalogue is null while the installation
 * standards are outstanding (A-1), so `compliance_margin` and `maintenance_access` report
 * `unavailable`; and `installation_feasibility` reports `SC-905` because the delivery allowance it
 * needs now comes from observed drawings, of which there are none yet. With no reference points
 * either, the *only* measurable criterion left is future expansion — which saturates in a room this
 * size and rates every arrangement alike. An engineer who marks where the RO loop and the panel are
 * gets an optimiser that can tell two layouts apart; one who does not gets `already_best` every
 * time, honestly.
 */
async function placeServices(page: Page) {
  const box = await canvasBox(page);
  const points: [string, number, number][] = [
    ['ro_supply', 0.26, 0.26],
    ['electrical_panel', 0.74, 0.26],
    ['drain', 0.26, 0.69],
    ['access_entry', 0.5, 0.24],
    ['staff_base', 0.74, 0.69],
  ];
  for (const [kind, x, y] of points) {
    await page.getByTestId(`reference-kind-${kind}`).click();
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  }
  await page.keyboard.press('v');
}

async function optimise(page: Page, { allowMoving = true } = {}) {
  const permission = page.getByTestId('layout-allow-moving');
  if (allowMoving !== (await permission.isChecked())) await permission.setChecked(allowMoving);
  await page.getByTestId('layout-optimise').click();
}

/**
 * Three machines an engineer might reasonably drop on a plan, and an optimiser can beat.
 *
 * Clustered away from the services, which are marked at the room's corners — so the routed
 * distances are long, the staff walk is long, and a tidier arrangement has something to offer.
 */
const AWKWARD: readonly [number, number][] = [
  [0.6, 0.55],
  [0.66, 0.55],
  [0.63, 0.62],
];

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
  // Bilingual, always both — the owner's follow-up decision to bring this panel's own copy up to
  // the rest of the app's convention (`EMPTY_MESSAGES` in `LayoutPanel.tsx`).
  await expect(page.getByTestId('layout-empty')).toContainText('먼저 방을 선택하세요');
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
  /*
   * Named criteria, with their normalised values — the arithmetic an engineer disagrees with.
   * Bilingual, both languages always shown (`@mfd/ai-contract`'s `CRITERION_LABELS` — same
   * convention as the ranking-reason list below, checked once here rather than at every criterion
   * name in this file).
   */
  await expect(breakdown).toContainText('정비 접근성');
  await expect(breakdown).toContainText('maintenance access');
  await expect(breakdown).toContainText('증설 여유');
  await expect(breakdown).toContainText('future expansion');
  // And the ones that could not be measured, with why rather than a blank — also bilingual.
  await expect(breakdown).toContainText('규정 기준 없음');
  await expect(breakdown).toContainText('No Requirement To Compare');
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

/*
 * ---------------------------------------------------------------------------
 * Step 6B — Draw → Generate → Optimize → Compare → Apply
 * ---------------------------------------------------------------------------
 */

test('generates around the machines already in the room', async ({ page }) => {
  /*
   * The partially occupied room, which is where step 6A's first defect lived: the generator was
   * never told about the existing machines, proposed the square one was standing in, and Gate 2
   * then rejected every candidate at every count. The engineer was told no layout satisfied the
   * rules while the solver kept suggesting the one place it could not use.
   */
  await traceRoom(page);
  await placeByHand(page, [
    [0.3, 0.3],
    [0.35, 0.3],
  ]);
  await selectRoom(page);
  await expect(page.getByTestId('field-placed')).toHaveText('2');

  await generate(page, '3');

  await expect(page.getByTestId('layout-results')).toBeVisible();
  // A generation adds; it never reports the machines already there as having moved.
  await expect(page.getByTestId('layout-changes-1')).toHaveText('3 added');

  await page.getByTestId('layout-apply-1').click();
  await expect(page.getByTestId('field-placed')).toHaveText('5');
});

test('will not rearrange the drawing without explicit permission', async ({ page }) => {
  /*
   * The owner's second requirement: *"Existing placements are immutable unless the engineer
   * explicitly allows movement."* The checkbox starts clear, and clicking Optimise with it clear
   * has to produce a refusal rather than a proposal nobody may act on.
   */
  await traceRoom(page);
  await placeServices(page);
  await placeByHand(page, AWKWARD);
  await selectRoom(page);

  await expect(page.getByTestId('layout-allow-moving')).not.toBeChecked();
  await optimise(page, { allowMoving: false });

  await expect(page.getByTestId('layout-empty')).toContainText('Allow that above');
  await expect(page.getByTestId('layout-results')).toHaveCount(0);
});

test('optimises the drawing, and never changes how many machines are on it', async ({ page }) => {
  await traceRoom(page);
  await placeServices(page);
  await placeByHand(page, AWKWARD);
  await selectRoom(page);

  await optimise(page);

  await expect(page.getByTestId('layout-results')).toBeVisible();
  // Three stations in, three stations out. "The requested station count is immutable" is the
  // constraint an optimiser is most tempted to break, because removing a machine improves nearly
  // every criterion.
  await expect(page.getByTestId('layout-results')).toContainText('3 stations');
  await expect(page.getByTestId('layout-changes-1')).toContainText('moved');
  await expect(page.getByTestId('layout-changes-1')).not.toContainText('added');
});

test('shows what each candidate scores, and against what', async ({ page }) => {
  /*
   * The owner's third requirement, in full: overall score, coverage, rule compliance, the criterion
   * breakdown, and the reason for the ranking — plus the current layout's own total, because 0.68
   * is a score rather than an improvement until the number it improves on is beside it.
   */
  await traceRoom(page);
  await placeServices(page);
  await placeByHand(page, AWKWARD);
  await selectRoom(page);
  await optimise(page);

  await expect(page.getByTestId('layout-current-score')).toContainText('Current layout');
  await expect(page.getByTestId('layout-proposal-1')).toBeVisible();
  await expect(page.getByTestId('layout-proposal-2')).toBeVisible();

  await expect(page.getByTestId('layout-coverage-1')).toContainText('Coverage');
  await expect(page.getByTestId('layout-compliance-1')).toContainText('0 violations');
  await expect(page.getByTestId('layout-breakdown-1')).toContainText('maintenance access');
  /*
   * `placeServices`' own doc comment: with the delivery allowance not yet observed in any
   * drawing, `installation_feasibility` reports `SC-905` specifically, not a generic "could not
   * measure". The twelfth CTO review round found `SC-905`/`SC-906`/`SC-907` had no entry in the
   * panel's lookup table and fell through to a plain "not measurable" — this is the one existing
   * spec both scenarios (services placed, breakdown table visible) already satisfy, so it is
   * where the fix belongs pinned. Bilingual since the owner's follow-up decision: both languages,
   * always, matching `@mfd/ai-contract`'s `SCORE_REASON_CODES['SC-905'].title`.
   */
  await expect(page.getByTestId('layout-breakdown-1')).toContainText('관측 자료 없음');
  await expect(page.getByTestId('layout-breakdown-1')).toContainText('No Observed Figure');
  // Bilingual, composed from AR- codes — the solver never writes prose of its own.
  await expect(page.getByTestId('layout-reason-1')).toContainText('Arranged 3 stations');
  await expect(page.getByTestId('layout-reason-1')).toContainText('방식으로');
});

test('applies a rearrangement only when asked, and undoes it in one press', async ({ page }) => {
  await traceRoom(page);
  await placeServices(page);
  await placeByHand(page, AWKWARD);
  await selectRoom(page);

  await optimise(page);
  // Previewing is not approving. The machines are still where the engineer put them.
  await page.getByTestId('layout-preview-2').click();
  await expect(page.getByTestId('field-placed')).toHaveText('3');

  // Back to the best one, and only then the button. Apply belongs to the proposal being previewed,
  // so there is no way to accept a layout without having looked at it on the drawing.
  await page.getByTestId('layout-preview-1').click();
  await page.getByTestId('layout-apply-1').click();
  await expect(page.getByTestId('layout-results')).toHaveCount(0);
  await expect(page.getByTestId('field-placed')).toHaveText('3');

  /*
   * Undo, observed through the solver rather than through a coordinate readout — the status bar
   * counts machines and a rearrangement does not change the count, so "3" proves nothing either
   * way.
   *
   * Optimising the layout that was just applied has to say `already_best`: it is the highest
   * scoring arrangement the solver can construct, so nothing beats it. One undo press must put the
   * engineer's own awkward layout back, and optimising *that* has something to offer again. Two
   * different answers from the same button, which is only possible if the document really reverted.
   */
  await optimise(page);
  await expect(page.getByTestId('layout-empty')).toContainText('Nothing improves');

  await page.keyboard.press('Control+z');
  await selectRoom(page);
  await optimise(page);
  await expect(page.getByTestId('layout-results')).toBeVisible();
});

test('refuses to rank at all when too little of the model could be measured', async ({ page }) => {
  /*
   * Owner decision D1: *"If coverage is below the required threshold, suppress the total ranking.
   * … Do not display a misleading '#1 score' when candidates have different evidence."*
   *
   * This spec used to assert *"Nothing improves on what you have drawn"* here, and its own comment
   * called that out as the problem: correct, and unreadable, because it sounds like praise for the
   * layout when it is a statement about missing data.
   *
   * It is now a different sentence, because it is a different claim. Three criteria are
   * unmeasurable on every project until the AK98 manual and observed drawings arrive —
   * `compliance_margin` (0.40), `installation_feasibility` (0.20), `maintenance_access` (0.15) —
   * so a drawing with **no reference points** is measured over 0.20 of the model, below the
   * shipped `minimumCoverage` of 0.25. The optimiser no longer claims the layout is best; it says
   * it cannot rank.
   */
  await traceRoom(page);
  await placeByHand(page, AWKWARD);
  await selectRoom(page);

  await optimise(page);

  await expect(page.getByTestId('layout-empty')).toContainText('Too little of the scoring model');
  await expect(page.getByTestId('layout-empty')).not.toContainText('Nothing improves');
  await expect(page.getByTestId('layout-empty-coverage')).toContainText('of the scoring model');
  await expect(page.getByTestId('layout-empty-coverage')).toContainText('AK98 manual');
});

test('refuses to optimise a layout that breaks a rule, and says which rules', async ({ page }) => {
  /*
   * > Owner decision, D1: *"When the current layout fails a gate, do NOT generate an optimized
   * > recommendation. Return an explicit blocked state: no ranked proposals, no baseline
   * > comparison, no 'best candidate'. Display blocking rule violations first."*
   *
   * Two machines dropped on the same square collide, which the dialysis rule set calls RED. Before
   * this, the drawn layout was scored anyway and that score became the bar every candidate had to
   * clear — so an unacceptable arrangement could out-score compliant ones and the engineer was told
   * their drawing was the best available.
   *
   * From the outside the whole decision is three absences and one presence: no results list, no
   * current-layout score, no proposal card, and the rules that block it on screen.
   */
  await traceRoom(page);
  await placeServices(page);
  // The colliding machine goes on last, so a single undo is what removes it.
  await placeByHand(page, [
    [0.4, 0.5],
    [0.6, 0.55],
    [0.6, 0.55],
  ]);
  await selectRoom(page);

  await optimise(page);

  await expect(page.getByTestId('layout-blocking')).toBeVisible();
  /*
   * **One** row, not two. The rule engine anchors a collision on both machines so the findings
   * panel can highlight either; a list of things to fix counts problems, and two machines on one
   * another is one problem. Asserting `> 0` would have passed on the duplicated pair.
   */
  await expect(page.getByTestId('layout-blocking')).toContainText('1 blocking rule violation');
  await expect(page.getByTestId('layout-blocking-rule')).toHaveCount(1);
  // And it names the machines, by the labels on the drawing rather than by placement id.
  await expect(page.getByTestId('layout-blocking-rule')).toContainText('RC-201');
  await expect(page.getByTestId('layout-blocking-rule')).toContainText(' + ');

  await expect(page.getByTestId('layout-results')).toHaveCount(0);
  await expect(page.getByTestId('layout-empty')).toContainText('breaks the rules below');

  /*
   * *"No baseline comparison"*, asserted on the element that would actually carry one here.
   *
   * An earlier version of this spec asserted `layout-current-score` absent. That testid lives
   * inside the `proposals.length > 0` branch of the panel, so it is absent in **every** empty state
   * and the assertion could not fail — it would have passed against an optimiser that scored the
   * blocked layout and printed the number. `layout-empty-coverage` is the one that renders beside
   * an empty result whenever `currentScore` is non-null, and it is asserted *visible* for
   * `already_best` further down, which is what makes its absence here mean something.
   */
  await expect(page.getByTestId('layout-empty-coverage')).toHaveCount(0);
});

test('optimises again once the blocking violation is removed', async ({ page }) => {
  /*
   * The other half, and the one that makes the first mean something. A test that only saw the
   * blocked state would pass equally against an optimiser that had stopped working.
   *
   * Same drawing, one machine deleted so nothing collides — and the optimiser has proposals again.
   */
  await traceRoom(page);
  await placeServices(page);
  // The colliding machine goes on last, so a single undo is what removes it.
  await placeByHand(page, [
    [0.4, 0.5],
    [0.6, 0.55],
    [0.6, 0.55],
  ]);
  await selectRoom(page);
  await optimise(page);
  await expect(page.getByTestId('layout-blocking')).toBeVisible();

  // Undo the last placement — the machine standing on top of another one.
  await page.keyboard.press('Control+z');
  await selectRoom(page);
  await optimise(page);

  await expect(page.getByTestId('layout-blocking')).toHaveCount(0);
  await expect(page.getByTestId('layout-results')).toBeVisible();
});

test('blocks on a machine outside the selected room, and says it is elsewhere', async ({
  page,
}) => {
  /*
   * > Owner decision: the gates judge the **whole level**, not the selected room.
   *
   * Until now nothing outside the unit tests exercised that. Every browser spec put its machines in
   * one room, so `existing` was empty in all of them and the widened population was never the thing
   * being tested.
   *
   * Here a machine is dropped **outside** the traced outline. It is not in `current` — `withinRoom`
   * excludes it — so it lands in `existing`, and it breaks the boundary rule by standing outside
   * every room. Under the owner's decision that blocks the run, which is correct and would be
   * baffling on its own: the panel names a machine that is not in the room on screen. So it also
   * says that it is not.
   */
  await traceRoom(page);
  await placeServices(page);
  await placeByHand(page, AWKWARD);
  // Well clear of the room, which spans 0.25–0.75 of the canvas.
  await placeByHand(page, [[0.9, 0.85]]);
  await selectRoom(page);

  await optimise(page);

  await expect(page.getByTestId('layout-blocking')).toBeVisible();
  await expect(page.getByTestId('layout-blocking-elsewhere').first()).toBeVisible();
  // In circulation, in no room at all — kept distinct from naming a room, because it is a
  // different fact and it is the more common way for a drawing to end up blocked.
  await expect(page.getByTestId('layout-blocking-elsewhere').first()).toContainText(
    'not in any room',
  );
  await expect(page.getByTestId('layout-results')).toHaveCount(0);
  await expect(page.getByTestId('layout-empty-coverage')).toHaveCount(0);
});

test('names the room a blocking machine is actually in', async ({ page }) => {
  /*
   * > Owner decision: the row names the room, rather than only saying the machine is elsewhere.
   *
   * "Not in this room" is true and leaves an engineer to search a level that has no bound on how
   * many rooms it holds. This is the case that decision is for, and it needs a second room to
   * exist at all: two machines dropped on one another **in the room next door** block the room
   * being optimised, because the gates judge the whole level.
   */
  await traceRoom(page);
  await placeServices(page);
  await placeByHand(page, AWKWARD);

  // A second room, well below the first, with a collision inside it.
  await traceRoom(page, [
    [0.25, 0.78],
    [0.75, 0.78],
    [0.75, 0.95],
    [0.25, 0.95],
  ]);
  await placeByHand(page, [
    [0.5, 0.86],
    [0.5, 0.86],
  ]);

  await selectRoom(page);
  await optimise(page);

  await expect(page.getByTestId('layout-blocking')).toBeVisible();
  /*
   * The **name**, not merely that some room was named. Asserting `(in ` alone passed against a
   * version that returned the neighbouring space's name for everything — the standing review
   * demonstrated exactly that. The second room is the one the machines are in, and the room being
   * optimised must not be the one named.
   */
  const elsewhere = page.getByTestId('layout-blocking-elsewhere').first();
  await expect(elsewhere).toContainText('(in ');
  await expect(elsewhere).not.toContainText('not in any room');

  // And it is the **other** room. Naming a room is not the property under test — naming the right
  // one is, and asserting only that some name appeared passed against a version that returned the
  // neighbouring space for everything. Read back rather than hardcoded: the editor numbers rooms
  // itself, and the second one came out "Room 10".
  const selected = ((await page.getByTestId('layout-room').textContent()) ?? '').replace('Room: ', '').trim();
  expect(selected).not.toBe('');
  expect(await elsewhere.textContent()).not.toContain(`(in ${selected})`);

  await expect(page.getByTestId('layout-results')).toHaveCount(0);
});

test('flags only the machine that is elsewhere, on a collision that spans two rooms', async ({
  page,
}) => {
  /*
   * The mixed row. A collision names two machines; when one is in the room being optimised and the
   * other is not, a row-level flag says "A + B (not in this room)" — true of B and false of A.
   *
   * Both existing whole-level specs are homogeneous — every machine named is outside the selected
   * room — so neither could tell a per-row flag from a per-machine one, which the standing review
   * proved by reinstating the row-level version and watching all 22 specs pass.
   *
   * Here the two rooms abut, and a machine on each side of the shared edge collides across it.
   */
  await traceRoom(page, [
    [0.25, 0.25],
    [0.75, 0.25],
    [0.75, 0.55],
    [0.25, 0.55],
  ]);
  await placeServices(page);
  await traceRoom(page, [
    [0.25, 0.55],
    [0.75, 0.55],
    [0.75, 0.85],
    [0.25, 0.85],
  ]);

  // One well inside the first room, one right at the shared edge — close enough that their
  // 800 mm footprints still overlap across it.
  await placeByHand(page, [
    [0.5, 0.495],
    [0.5, 0.555],
  ]);

  await selectRoom(page);
  await optimise(page);

  await expect(page.getByTestId('layout-blocking')).toBeVisible();
  const row = page.getByTestId('layout-blocking-rule').first();
  await expect(row).toContainText('RC-201');

  const machines = row.getByTestId('layout-blocking-machine');
  await expect(machines).toHaveCount(2);

  /*
   * Which machine carries the flag, not how many flags the row has.
   *
   * Counting was the first attempt and it was worthless: a row-level flag renders exactly one too,
   * so the assertion passed against the very bug it was written for. The rule engine anchors this
   * collision on the machine outside the selected room first, so the flag belongs on the **first**
   * of the two named — and a row-level implementation puts it on the last.
   */
  await expect(machines.nth(0).getByTestId('layout-blocking-elsewhere')).toHaveCount(1);
  await expect(machines.nth(1).getByTestId('layout-blocking-elsewhere')).toHaveCount(0);
});

test('says so plainly when there is nothing of that kind to rearrange', async ({ page }) => {
  // An empty room is not a layout with a low score. Owner constraint 2 of Step 5, from the outside.
  await traceRoom(page);
  await optimise(page);

  await expect(page.getByTestId('layout-empty')).toContainText('nothing of this kind');
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
