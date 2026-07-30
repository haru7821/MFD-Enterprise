import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildReport } from '../build';
import {
  FIXTURE_GENERATED_AT,
  FIXTURE_MFD_VERSION,
  emptyDocument,
  fixtureCatalog,
  fixtureChecklistTemplate,
  fixtureRuleSet,
  populatedDocument,
} from '../../fixtures/index';
import type { ReportModel } from '../model';
import { MissingGlyphError } from './fonts';
import { renderHtml } from './html';
import { renderJson } from './json';
import { renderPdf } from './pdf';

/**
 * The renderers.
 *
 * The suite is arranged around the owner's requirement that PDF, DOCX, HTML and JSON are all
 * possible **without changing business logic**. So the assertions are mostly about what the
 * renderers do *not* do: they do not decide a verdict, do not re-derive a status, and do not
 * reorder the sections. If any of them did, the JSON renderer could not be three lines.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FONT_DIR = join(HERE, '..', '..', 'assets', 'fonts');

/**
 * Fonts are read here, in the test, not by the package.
 *
 * That is the arrangement under test as much as a convenience: the renderer takes bytes, so
 * it works identically in a browser and on a server. A package that read a file would work in
 * exactly one of those.
 */
function fonts() {
  return {
    regular: new Uint8Array(readFileSync(join(FONT_DIR, 'Pretendard-Regular.ttf'))),
    bold: new Uint8Array(readFileSync(join(FONT_DIR, 'Pretendard-Bold.ttf'))),
  };
}

function model(document = populatedDocument()): ReportModel {
  return buildReport({
    document,
    catalog: fixtureCatalog(),
    ruleSet: fixtureRuleSet(),
    checklistTemplate: fixtureChecklistTemplate(),
    generatedAt: FIXTURE_GENERATED_AT,
    mfdVersion: FIXTURE_MFD_VERSION,
  });
}

describe('the JSON renderer', () => {
  it('is the model, losslessly', () => {
    // Three lines, and that is the architecture's own test: a format can only be this cheap
    // if the model already holds every decision. The moment a renderer had to work something
    // out, JSON would stop being possible.
    const source = model();
    expect(JSON.parse(renderJson(source))).toEqual(source);
  });

  it('produces identical bytes for identical input', () => {
    expect(renderJson(model())).toBe(renderJson(model()));
  });
});

describe('the HTML renderer', () => {
  it('emits every section, in the model’s order', () => {
    const html = renderHtml(model());

    const order = [
      'report-cover',
      'report-summary',
      'report-schedule',
      'report-floor-plan',
      'report-validation',
      'report-checklist',
      'report-datasheets',
      'report-standards',
      'report-notice',
    ];
    const positions = order.map((id) => html.indexOf(`data-testid="${id}"`));

    for (const [index, position] of positions.entries()) {
      expect(position, order[index]).toBeGreaterThan(-1);
    }
    // Strictly increasing: the sections appear in the owner's order, not merely all present.
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('prints both languages for every section title', () => {
    const html = renderHtml(model());

    for (const [ko, en] of [
      ['종합 요약', 'Executive Summary'],
      ['장비 목록', 'Equipment Schedule'],
      ['기술 검토 결과', 'Validation Report'],
      ['설치 점검표', 'Installation Checklist'],
      ['장비 데이터시트', 'Equipment Datasheets'],
      ['적용 기준', 'Applied Standards'],
      ['책임 범위', 'Liability Statement'],
    ]) {
      expect(html, ko).toContain(ko);
      expect(html, en).toContain(en);
    }
  });

  it('prints every finding in both languages, with its reason code', () => {
    const html = renderHtml(model());
    const findings = model().validation.flatMap((section) => section.findings);

    expect(findings.length).toBeGreaterThan(5);
    for (const finding of findings) {
      expect(html, finding.reasonCode).toContain(finding.reasonCode);
    }
    // The Korean sentence, not a translation of the English one.
    expect(html).toMatch(/정비 공간|겹칩니다|장애물/);
  });

  it('carries the liability notice verbatim, in both languages', () => {
    const html = renderHtml(model());
    const { liability } = model().notice;

    expect(html).toContain(liability.ko);
    expect(html).toContain(liability.en);
  });

  it('keeps the datasheet’s three blocks apart', () => {
    const html = renderHtml(model());

    // Manufacturer data is absent on the shipped fixture — nothing is cited — so the
    // planning and draft blocks are what must be present and distinct.
    expect(html).toContain('data-testid="datasheet-planning"');
    expect(html).toContain('data-testid="datasheet-draft"');
    expect(html).toContain('설계 점유 면적 (설계 기준)');
    expect(html).toContain('미검증 자료');
  });

  it('marks an uncalibrated level', () => {
    expect(renderHtml(model())).toContain('data-testid="report-uncalibrated"');
  });

  it('escapes values that would otherwise corrupt the markup', () => {
    // Not a hostile input — a room called "A&E" or a project with a "<" in it. The failure
    // would be a mangled report rather than an exploit, and one line prevents it.
    const document = populatedDocument();
    const html = renderHtml(
      model({
        ...document,
        project: { ...document.project, name: 'Ward <A&E> "refit"' },
      }),
    );

    expect(html).toContain('Ward &lt;A&amp;E&gt; &quot;refit&quot;');
    expect(html).not.toContain('Ward <A&E>');
  });

  it('renders an empty project without pretending it is finished', () => {
    const html = renderHtml(model(emptyDocument()));

    expect(html).toContain('data-verdict="inconclusive"');
    expect(html).toContain('판정 불가');
    // And the notice is still there.
    expect(html).toContain(model().notice.liability.ko);
  });

  it('draws the plan as vector geometry, in millimetres', () => {
    const html = renderHtml(model());

    // A viewBox in model units, not a raster: the geometry lives outside the renderer, so it
    // can be re-emitted at any size (AD-2).
    expect(html).toMatch(/<svg class="plan" viewBox="-500 -500 9000 7000"/);
    expect(html).toContain('class="room"');
    expect(html).toContain('class="equipment"');
  });
});

describe('the PDF renderer', () => {
  it('produces a parseable PDF with an embedded subset font', async () => {
    const bytes = await renderPdf(model(), { fonts: fonts() });
    const head = new TextDecoder().decode(bytes.slice(0, 8));

    expect(head).toContain('%PDF');
    expect(bytes.byteLength).toBeGreaterThan(5_000);

    const raw = Buffer.from(bytes).toString('latin1');
    // FontFile2 is the embedded face; ToUnicode is what makes the Korean text extractable
    // rather than a picture of itself.
    expect(raw).toContain('FontFile2');
    expect(raw).toContain('ToUnicode');
    // pdf-lib names a subset by appending a tag rather than prefixing one, so the assertion
    // is on the family name being present at all — the six-letter prefix convention is not
    // what this library emits.
    expect(raw).toMatch(/\/BaseFont\s*\/[A-Za-z0-9+-]*Pretendard/);
  });

  it('stays small despite embedding a Korean face', async () => {
    // Subsetting is what makes a bilingual PDF practical: the source faces are 5.4 MB, and a
    // report using a few hundred glyphs must not carry all of them.
    const bytes = await renderPdf(model(), { fonts: fonts() });
    expect(bytes.byteLength).toBeLessThan(1_500_000);
  });

  it('refuses to draw a character the font cannot render', async () => {
    // The decision worth defending: a blank box where a room name should be, inside a signed
    // document, is exactly the quiet failure this product refuses. An error before sending is
    // cheaper.
    const document = populatedDocument();
    const level = document.project.levels[0];
    if (!level) throw new Error('fixture has no level');

    // An unassigned code point — no font has a glyph for it.
    const withUnrenderable = {
      ...document,
      project: { ...document.project, name: `Ward \u{10FFFD}` },
    };

    await expect(renderPdf(model(withUnrenderable), { fonts: fonts() })).rejects.toThrow(
      MissingGlyphError,
    );
    await expect(renderPdf(model(withUnrenderable), { fonts: fonts() })).rejects.toThrow(
      /no glyph for/,
    );
  });

  it('renders an empty project', async () => {
    // The section that would most easily divide by zero: no equipment, no rooms, no extent.
    const bytes = await renderPdf(model(emptyDocument()), { fonts: fonts() });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toContain('%PDF');
  });

  it('paginates a long report rather than clipping it', async () => {
    // Forty machines: the placement and findings tables must span pages. A renderer that
    // silently drew past the bottom margin would produce a report missing rows with nothing
    // to indicate it.
    const document = populatedDocument();
    const level = document.project.levels[0];
    if (!level) throw new Error('fixture has no level');

    const many = {
      ...document,
      project: {
        ...document.project,
        levels: [
          {
            ...level,
            placements: Array.from({ length: 40 }, (_, index) => ({
              ...level.placements[0]!,
              id: `placement-many-${index}`,
              label: `Station ${index + 1}`,
              transform: {
                ...level.placements[0]!.transform,
                position: { x: 500 + (index % 8) * 900, y: 500 + Math.floor(index / 8) * 1_100 },
              },
            })),
          },
          ...document.project.levels.slice(1),
        ],
      },
    };

    const bytes = await renderPdf(model(many), { fonts: fonts() });
    const raw = Buffer.from(bytes).toString('latin1');
    const pageCount = [...raw.matchAll(/\/Type\s*\/Page[^s]/g)].length;

    expect(pageCount).toBeGreaterThan(4);
  });
});

describe('Korean in the PDF text layer', () => {
  it('extracts the Hangul the report was built from', async () => {
    // The load-bearing PDF assertion. FontFile2 and ToUnicode being present proves a font was
    // embedded; only extraction proves the *glyphs are mapped* — a report can carry a perfect
    // font and still draw the wrong characters if the encoding is wrong, and it would look
    // fine to everything except a reader.
    //
    // pdfjs is imported here rather than depended on by the package: this is a test of the
    // output, and the renderer must not gain a PDF *reader* to satisfy it.
    const bytes = await renderPdf(model(), { fonts: fonts() });

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const document = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;

    let text = '';
    for (let page = 1; page <= document.numPages; page += 1) {
      const content = await (await document.getPage(page)).getTextContent();
      text += content.items.map((item) => ('str' in item ? item.str : '')).join('');
    }

    // A section title, a customer name typed by an engineer, and a finding sentence.
    expect(text).toContain('종합 요약');
    expect(text).toContain('서울 하늘병원');
    expect(text).toMatch(/겹칩니다|정비 공간|장애물/);
    // And the English half of the same document.
    expect(text).toContain('Executive Summary');
    // The liability statement, both languages, in the text layer rather than as a picture.
    expect(text.replace(/\s+/g, ' ')).toContain('Final installation approval shall be based on');
  });

  it('puts the liability notice on the last page, on a report of any length', async () => {
    // The notice's space is reserved before layout begins, so it cannot be the block that
    // falls off the end of a full page. That is the difference between "usually present" and
    // "present", and it is only testable through the rendered output.
    const document = populatedDocument();
    const level = document.project.levels[0];
    if (!level) throw new Error('fixture has no level');

    const long = {
      ...document,
      project: {
        ...document.project,
        levels: [
          {
            ...level,
            placements: Array.from({ length: 60 }, (_, index) => ({
              ...level.placements[0]!,
              id: `placement-long-${index}`,
              label: `Station ${index + 1}`,
              transform: {
                ...level.placements[0]!.transform,
                position: { x: 500 + (index % 8) * 900, y: 500 + Math.floor(index / 8) * 1_100 },
              },
            })),
          },
          ...document.project.levels.slice(1),
        ],
      },
    };

    for (const source of [model(), model(long), model(emptyDocument())]) {
      const bytes = await renderPdf(source, { fonts: fonts() });
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const parsed = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
      const last = await parsed.getPage(parsed.numPages);
      const content = await last.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join('')
        .replace(/\s+/g, ' ');

      expect(text).toContain('Final installation approval shall be based on');
      expect(text).toContain('최종 설치 승인');
    }
  });
});
