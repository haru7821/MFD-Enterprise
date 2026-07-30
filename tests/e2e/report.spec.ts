import { expect, test, type Page } from '@playwright/test';

/**
 * The report, through the browser.
 *
 * R1–R11 from docs/architecture/REPORT_ENGINE_DESIGN.md. The unit suites already assert the
 * model and the renderers; what only a browser can prove is that the whole path works — a
 * production build, a lazily-fetched 2.7 MB Korean font, and a PDF that actually downloads.
 *
 * R11 is the load-bearing one: Hangul surviving into the PDF's text layer. Everything before it
 * could pass with a font that renders blank boxes.
 */

async function openReport(page: Page) {
  await page.getByTestId('open-report').click();
  await expect(page.getByTestId('report-panel')).toBeVisible();
}

async function placeMachine(page: Page, at: { x: number; y: number }) {
  await page.getByTestId('catalog-item-vantive_ak98').click();
  const box = await page.locator('div[role="application"]').boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  await page.mouse.click(box.x + box.width * at.x, box.y + box.height * at.y);
  await page.keyboard.press('Escape');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('canvas');
});

test('R1 — the preview shows every section', async ({ page }) => {
  await openReport(page);

  for (const section of [
    'report-cover',
    'report-summary',
    'report-schedule',
    'report-floor-plan',
    'report-validation',
    'report-checklist',
    'report-datasheets',
    'report-standards',
    'report-notice',
    'report-provenance',
  ]) {
    await expect(page.getByTestId(section).first(), section).toBeVisible();
  }
});

test('R2 — an empty project is inconclusive, and says why', async ({ page }) => {
  await openReport(page);

  // Nothing placed. The verdict must not be a pass, and the report must account for itself.
  await expect(page.getByTestId('report-verdict')).toContainText('판정 불가');
  await expect(page.getByTestId('report-verdict')).toContainText('Inconclusive');
  await expect(page.getByTestId('report-summary')).toContainText('배치된 장비 없음');
});

test('R3 — a finding reaches the validation table and the checklist', async ({ page }) => {
  await placeMachine(page, { x: 0.3, y: 0.3 });
  await openReport(page);

  const validation = page.getByTestId('report-validation').first();
  await expect(validation).toBeVisible();
  // The reason code, which is what makes a finding quotable independent of language.
  await expect(validation).toContainText(/RC-\d{3}/);

  // And the same finding turns into something to do.
  await expect(page.getByTestId('report-checklist')).toContainText('현장 확인 필요');
});

test('R4 — generating downloads a PDF whose first bytes are %PDF', async ({ page }) => {
  await placeMachine(page, { x: 0.3, y: 0.3 });
  await openReport(page);

  const download = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByTestId('report-download-pdf').click();
  const file = await download;

  expect(file.suggestedFilename()).toMatch(/\.pdf$/);
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const bytes = Buffer.concat(chunks);

  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  // Big enough to contain an embedded subset font rather than an empty page.
  expect(bytes.byteLength).toBeGreaterThan(10_000);
});

test('R5 — a two-level project produces a section for each floor', async ({ page }) => {
  await page.getByTestId('add-level').click();
  await openReport(page);

  await expect(page.getByTestId('report-floor-plan')).toHaveCount(2);
  await expect(page.getByTestId('report-validation')).toHaveCount(2);
});

test('R6 — an uncalibrated level is named as such', async ({ page }) => {
  // No plan imported here, so nothing is uncalibrated: the marker must be absent. The
  // positive case needs a plan import, which `spatial.spec.ts` covers.
  await openReport(page);
  await expect(page.getByTestId('report-uncalibrated')).toHaveCount(0);
});

test('R7 — the schedule keeps manufacturer size and design footprint apart', async ({ page }) => {
  await placeMachine(page, { x: 0.3, y: 0.3 });
  await openReport(page);

  const schedule = page.getByTestId('report-schedule');
  // 585 × 620 × 1305 mm is the machine; 800 × 800 mm is what the plan reserves. A report
  // printing one figure without saying which recreates the confusion the split ended.
  // Without thousands separators — 1305, not 1,305. Engineering drawings and the palette both
  // write it that way, and the datasheet already did; a browser spec caught the schedule
  // printing the same figure differently in the same document.
  await expect(schedule).toContainText('585 × 620 × 1305 mm');
  await expect(schedule).toContainText('800 × 800 mm');
});

test('R8 — verification is stated per field group, and the footprint sits apart', async ({
  page,
}) => {
  await placeMachine(page, { x: 0.3, y: 0.3 });
  await openReport(page);

  const datasheets = page.getByTestId('report-datasheets');
  // Nothing on the shipped AK98 is cited, so there is no manufacturer block — and the two
  // blocks that do exist must be distinct sections rather than one merged list.
  await expect(page.getByTestId('datasheet-planning')).toBeVisible();
  await expect(page.getByTestId('datasheet-draft')).toBeVisible();
  await expect(page.getByTestId('datasheet-manufacturer')).toHaveCount(0);
  await expect(datasheets).toContainText('설계 결정 사항 — 제조사 근거 없음');
});

test('R9 — every section title appears in both languages', async ({ page }) => {
  await openReport(page);

  const panel = page.getByTestId('report-panel');
  const titles: readonly (readonly [string, string])[] = [
    ['종합 요약', 'Executive Summary'],
    ['장비 목록', 'Equipment Schedule'],
    ['평면도', 'Floor Plan'],
    ['기술 검토 결과', 'Validation Report'],
    ['설치 점검표', 'Installation Checklist'],
    ['장비 데이터시트', 'Equipment Datasheets'],
    ['적용 기준', 'Applied Standards'],
    ['책임 범위', 'Liability Statement'],
  ];

  for (const [ko, en] of titles) {
    await expect(panel, ko).toContainText(ko);
    await expect(panel, en).toContainText(en);
  }
});

test('R10 — the liability notice is present, in both languages, on an empty report', async ({
  page,
}) => {
  await openReport(page);

  const notice = page.getByTestId('report-notice');
  await expect(notice).toContainText(
    'This report is generated to support engineering planning and installation review.',
  );
  await expect(notice).toContainText('본 보고서는 설치 계획 및 기술 검토를 지원하기 위한 자료입니다.');
});

test('R11 — Hangul survives into the generated PDF’s text layer', async ({ page }) => {
  // The assertion everything else rests on. A report can embed a perfect font and still draw
  // the wrong characters; only extraction proves the glyphs are mapped. Parsed with the pdf.js
  // the application already ships, in the page, so nothing is added to the test rig for it.
  await placeMachine(page, { x: 0.3, y: 0.3 });
  await openReport(page);

  const download = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByTestId('report-download-pdf').click();
  const file = await download;

  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const base64 = Buffer.concat(chunks).toString('base64');

  // Parsed here in Node rather than inside the page: `page.evaluate` cannot serialise a
  // function that dynamically imports a module, and pushing a PDF *reader* into the
  // application to satisfy a test would be the wrong way round.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const parsed = await pdfjs.getDocument({ data: new Uint8Array(Buffer.from(base64, 'base64')) })
    .promise;

  let extracted = '';
  for (let index = 1; index <= parsed.numPages; index += 1) {
    const content = await (await parsed.getPage(index)).getTextContent();
    extracted += content.items.map((item) => ('str' in item ? item.str : '')).join('');
  }

  // A section title, and the liability statement's Korean half.
  expect(extracted).toContain('종합 요약');
  expect(extracted).toContain('최종 설치 승인');
  // The English half of the same document, from the same embedded face.
  expect(extracted).toContain('Executive Summary');
});

test('names a character the font cannot draw instead of printing a blank box', async ({ page }) => {
  // The refusal, end to end. A tofu square where a project name should be, inside a document a
  // hospital has signed, is exactly the quiet failure this refuses — so the failure has to be
  // visible in the interface, not only in a unit test.
  await page.getByTestId('project-detail-name').fill('Ward \u{10FFFD}');
  await page.getByTestId('project-detail-name').blur();
  await openReport(page);

  await page.getByTestId('report-download-pdf').click();
  await expect(page.getByTestId('report-error')).toContainText('no glyph for');
});

test('the drawing mode is a stored project setting, and raster mode says it is debug', async ({
  page,
}) => {
  // Owner decision: vector-first by default, the raster underlay opt-in, and the choice stored
  // in the project rather than picked at download time.
  await expect(page.getByTestId('report-render-mode')).toHaveValue('vector');

  await openReport(page);
  await expect(page.getByTestId('report-evidence')).toBeVisible();
  await expect(page.getByTestId('report-panel')).toContainText('벡터 도면만');
  await expect(page.getByTestId('report-debug-mode')).toHaveCount(0);
  await page.getByTestId('report-close').click();

  await page.getByTestId('report-render-mode').selectOption('raster');
  await expect(page.getByTestId('render-mode-debug-warning')).toBeVisible();

  await openReport(page);
  // A page carrying a scan with no assessment drawn over it must say so, in the report itself.
  await expect(page.getByTestId('report-debug-mode').first()).toBeVisible();
  await expect(page.getByTestId('report-panel')).toContainText('고객 제출용이 아닙니다');
  await page.getByTestId('report-close').click();

  // And it survives undo, because it is a command like everything else.
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('report-render-mode')).toHaveValue('vector');
});

test('the summary states the three evidence counts, zeros included', async ({ page }) => {
  await openReport(page);

  const evidence = page.getByTestId('report-evidence');
  // Named figures, in both languages. A zero is the answer too — omitting it would leave a
  // reader unable to tell "nothing outstanding" from "we did not check".
  await expect(evidence).toContainText('근거 문서 미확보 항목 / Missing References');
  await expect(evidence).toContainText('제조사 근거 미확보 항목 / Missing Manufacturer Citations');
  await expect(evidence).toContainText('미검증 규정 수 / Draft Rule Count');

  // Six rules ship and every one of them is draft, so the count is the whole set.
  await expect(evidence).toContainText('6');
});
