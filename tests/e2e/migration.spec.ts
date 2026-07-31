import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

/**
 * Opening a real version 3 project in the browser, and taking it all the way to a PDF.
 *
 * > Owner decision, Hardening priority 2: *"A project created with the previous version can be
 * > opened and exported by the current version."*
 * >
 * > Open v3 file → migration executes → document becomes v4 → editor renders correctly →
 * > installation plan remains valid → PDF export succeeds.
 *
 * ## Why this is a browser test and not another unit test
 *
 * `migration.test.ts` proves the conversion is lossless. It cannot prove that the *editor* survives
 * the result. A migrated document takes a path nothing else takes — it arrives through
 * `document/load` with ids numbered in another session, an empty `referencePoints` on every level,
 * and a catalogue version its placements do not cite — and every one of those has somewhere it
 * could go wrong that a pure test would not see.
 *
 * The file is fed through the real file input, so the whole chain runs: FileReader, `loadDocument`,
 * the migration, schema validation, the reducer, Konva, the rule engine, the planner and pdf-lib.
 */

const V3_PROJECT = 'fixtures/projects/migration/v3-project.json';

async function openV3(page: Page) {
  await page.getByTestId('project-file-input').setInputFiles(V3_PROJECT);
  // The project name is the first thing that proves the file was read rather than rejected.
  await expect(page.getByTestId('project-name')).toHaveText('강남 성심병원 — 3F 인공신장실 증설');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('canvas');
});

test('opens a version 3 project and renders it', async ({ page }) => {
  await openV3(page);

  // Nine placements and two rooms on the level that loads, from a file this build has never
  // written. A migration that dropped a placement would show up here as a smaller number.
  await expect(page.getByTestId('field-placed')).toHaveText('9');
  await expect(page.getByTestId('field-rooms')).toHaveText('2');
  await expect(page.getByTestId('space-list')).toContainText('치료실 A');
});

test('carries both levels through, including the uncalibrated one', async ({ page }) => {
  // The second level has no plan image and no coordinate mapping. Null is a state, and a migration
  // that filled it in would make an unmeasured floor look measured.
  await openV3(page);

  await expect(page.getByTestId('level-select')).toContainText('3F');
  await expect(page.getByTestId('level-select')).toContainText('B1');
});

test('invents no reference point, however much the score would like one', async ({ page }) => {
  /*
   * The v3 → v4 migration's whole content. Four scoring criteria measure *from* one of these
   * points, and three of them minimise — so a seeded point is the best possible score for a
   * measurement nobody took. The list must be empty after opening, not helpfully populated.
   */
  await openV3(page);

  await expect(page.getByTestId('reference-point-empty')).toContainText('None placed');
  await expect(page.getByTestId('reference-point-list')).toHaveCount(0);
});

test('the migrated project evaluates, and says why it cannot conclude', async ({ page }) => {
  // The rule engine runs against a document it did not create. Every clearance still reads
  // "no requirement to compare against" — A-1 — and that is the correct answer, not a failure.
  await openV3(page);

  await expect(page.getByTestId('validation-result').first()).toBeVisible();
  // The panel prints the sentence, not the reason code — RC-110 in words. Asserted on what an
  // engineer actually reads, in both languages, because that is what has to be true.
  await expect(page.getByTestId('validation-panel')).toContainText(
    'No front clearance requirement for ST-01 exists',
  );
  await expect(page.getByTestId('validation-panel')).toContainText('판정할 수 없습니다');
  // Every finding is YELLOW: unmeasurable, not compliant. A migrated project must not come out
  // greener than the data supports.
  await expect(page.getByTestId('result-badge-GREEN')).toHaveCount(0);
});

test('plans an installation from the migrated layout, and the plan is not stale', async ({
  page,
}) => {
  /*
   * The two hardening decisions meeting. A plan generated from a freshly migrated document must be
   * current: its fingerprint is taken from the document as loaded, and if the migration produced
   * anything the fingerprint did not expect — an extra field, a different ordering — the plan would
   * be born outdated and the engineer would be told to regenerate a plan they had just made.
   */
  await openV3(page);
  await page.getByTestId('space-list').getByRole('button').first().click();

  await page.getByTestId('plan-generate').click();

  await expect(page.getByTestId('plan-results')).toBeVisible();
  await expect(page.getByTestId('plan-stale')).toHaveCount(0);
});

test('exports a PDF from the migrated project', async ({ page }) => {
  // The owner's acceptance criterion, end to end: a file written by the previous version leaves
  // this one as a signed-shape report.
  await openV3(page);

  await page.getByTestId('open-report').click();
  await expect(page.getByTestId('report-panel')).toBeVisible();

  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('report-download-pdf').click(),
  ]).then(([event]) => event);

  /*
   * The bytes, not the name. `report.spec.ts` covers the suggested filename on an
   * ASCII-named project; this project's name is Hangul, and Chromium hands Playwright
   * "download" instead of the Korean filename the panel sets. That is worth fixing —
   * a Korean-market product whose every export is called "download" is a real problem —
   * but it is pre-existing, unrelated to migration, and not something to assert here in
   * either direction: asserting ".pdf" fails, and asserting "download" would lock the
   * bug in. Raised with the owner instead.
   */
  const path = await download.path();
  const bytes = readFileSync(path);
  // A real PDF, not an error page wearing a .pdf name.
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(bytes.length).toBeGreaterThan(10_000);
});

test('re-saves at the current version, and the saved file reopens', async ({ page }) => {
  /*
   * The migration runs once. After a save the file is a v4 document, and opening it again takes no
   * migration path at all — which is what stops a project drifting a little further on every open.
   */
  await openV3(page);

  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('save-project').click(),
  ]).then(([event]) => event);

  const path = await download.path();
  const saved = JSON.parse(readFileSync(path, 'utf8')) as { documentVersion: number };
  // 5 since Q-4 added `PlanImage.renderDpi`. The v3 fixture now travels two steps to get here.
  expect(saved.documentVersion).toBe(5);

  await page.getByTestId('new-project').click();
  await expect(page.getByTestId('field-placed')).toHaveText('0');

  await page.getByTestId('project-file-input').setInputFiles(path);
  await expect(page.getByTestId('field-placed')).toHaveText('9');
});

test('refuses a file it cannot convert safely, and says so as a conversion failure', async ({
  page,
}) => {
  /*
   * > *"No silent repair. If migration cannot safely convert: show explicit migration error."*
   *
   * A v3 file carrying reference points cannot be converted without deleting them. The engineer
   * must be told that this is a *conversion* that was declined — not that their project is invalid,
   * which would send them looking for corruption in a file that is fine.
   */
  const raw = JSON.parse(readFileSync(V3_PROJECT, 'utf8')) as {
    project: { levels: Record<string, unknown>[] };
  };
  raw.project.levels[0]!['referencePoints'] = [
    { id: 'rp1', kind: 'drain', position: { x: 1_000, y: 2_000 }, label: '배수구' },
  ];

  await page.getByTestId('project-file-input').setInputFiles({
    name: 'hand-edited.mfd.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(raw)),
  });

  const error = page.getByTestId('project-error');
  await expect(error).toBeVisible();
  await expect(error).toContainText('could not be converted');
  await expect(error).toContainText('referencePoints');
  // Not the generic message. The distinction is the requirement.
  await expect(error).not.toContainText('is not a valid MFD-E project');

  // And nothing was loaded — the editor still holds the empty project it started with.
  await expect(page.getByTestId('field-placed')).toHaveText('0');
});
