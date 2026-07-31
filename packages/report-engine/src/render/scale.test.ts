import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDocument, createPlacement } from '@mfd/document-model';
import { catalog } from '@mfd/object-library/catalog';
import { dialysisRuleSet } from '@mfd/rule-engine/rules';

import { dialysisChecklistTemplate } from '../../checklists/index';
import { buildReport } from '../build';
import { renderHtml } from './html';
import { renderPdf } from './pdf';

/**
 * The report at the design target — fifty dialysis stations.
 *
 * ## Why this file exists
 *
 * A hardening probe found the PDF renderer taking **37 seconds** for a fifty-station ward, on a
 * machine where building the model took 13 ms and the HTML 8 ms. An engineer pressing Export and
 * waiting over half a minute has no way to tell a slow render from a hung application.
 *
 * The cause was in `wrap`: it measures cumulative prefixes to find a line break, and a Korean
 * finding has almost no spaces, so it falls into per-character breaking and asks pdf-lib for the
 * width of prefixes of length 1, 2, 3 … n. Each of those re-encodes the whole prefix — about 52 µs
 * per character — so wrapping was quadratic in the length of every sentence in the report.
 *
 * The fix is memoisation, in `EmbeddedFonts.widthOf`, and it rests on a fact this file also
 * asserts: **a string's width is exactly the sum of its characters' widths.** Same output, one
 * lookup per distinct (character, size) instead of one per prefix. 37 s → about 6 s, and the render
 * suite itself went from 57 s to 16 s.
 *
 * What remains is pdf-lib re-shaping each string inside `drawText`, at roughly 1.3 ms per call
 * across ~4,500 calls. That is inherent to its API and is not worth working around: the export
 * button already shows a working state, and six seconds for a fifty-station signed document is
 * acceptable where thirty-seven was not.
 */

const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'fonts');

function fonts() {
  return {
    regular: new Uint8Array(readFileSync(join(FONT_DIR, 'Pretendard-Regular.ttf'))),
    bold: new Uint8Array(readFileSync(join(FONT_DIR, 'Pretendard-Bold.ttf'))),
  };
}

/** A ward at the design target, laid out on a grid. */
function ward(stations: number) {
  const object = catalog.objects[0];
  if (!object) throw new Error('the catalogue is empty');

  const document = createDocument({
    projectId: 'p',
    name: 'Ward',
    now: '2026-01-01T00:00:00.000Z',
    levelId: 'level-1',
    levelName: 'L1',
    ruleSetRef: { id: 'dialysis', version: '0.1.0' },
  });
  const level = document.project.levels[0];
  if (!level) throw new Error('the document has no level');

  const placements = Array.from({ length: stations }, (_, index) =>
    createPlacement(
      `p-${index}`,
      object,
      { x: (index % 10) * 2_000, y: Math.floor(index / 10) * 2_000 },
      { label: `AK98 ${index + 1}` },
    ),
  );

  return { ...document, project: { ...document.project, levels: [{ ...level, placements }] } };
}

function modelAt(stations: number) {
  return buildReport({
    document: ward(stations),
    catalog,
    ruleSet: dialysisRuleSet,
    checklistTemplate: dialysisChecklistTemplate,
    generatedAt: '2026-01-01T00:00:00.000Z',
    mfdVersion: '0.5.0-test',
  });
}

describe('the width memoisation is exact', () => {
  it('sums character widths to the same number pdf-lib gives for the whole string', async () => {
    /*
     * The claim the optimisation rests on, checked against the real embedded faces rather than
     * assumed. pdf-lib sums glyph advances and applies no kerning, so this holds — but "so it
     * should hold" is not a thing to ship a signed document's typography on.
     *
     * Latin, Hangul, an em-dash and a digit run, because a difference would most likely appear at a
     * script boundary.
     */
    const { PDFDocument } = await import('pdf-lib');
    const fontkit = (await import('@pdf-lib/fontkit')).default;
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const face = await doc.embedFont(fonts().regular, { subset: true });

    const samples = [
      'Station 4 has 1200 mm of front clearance, less than the 1500 mm required.',
      '투석기 4번의 전면 정비 공간이 1200 mm로, 요구치 1500 mm에 미달합니다.',
      'AK98 — Vantive (0.1.0)',
      'Planning rate data not available.',
      '설치 기준 산정 자료가 없습니다.',
    ];

    for (const size of [6, 8, 10]) {
      for (const sample of samples) {
        const whole = face.widthOfTextAtSize(sample, size);
        const summed = [...sample].reduce(
          (total, character) => total + face.widthOfTextAtSize(character, size),
          0,
        );
        expect(summed).toBe(whole);
      }
    }
  }, 60_000);
});

describe('the report at fifty stations', () => {
  it('builds the model and the HTML in well under a second', () => {
    // Both were already fast; asserted so a future change that moves work into the model is caught
    // here rather than in a renderer.
    const started = performance.now();
    const model = modelAt(50);
    const html = renderHtml(model);
    const elapsed = performance.now() - started;

    expect(model.validation[0]?.findings.length).toBeGreaterThan(200);
    expect(html.length).toBeGreaterThan(100_000);
    expect(elapsed).toBeLessThan(1_000);
  });

  it('renders the PDF within an interactive budget', async () => {
    /*
     * 20 seconds, against an observed ~6. Deliberately loose: this runs on a shared CI machine, and
     * a budget set just above the observed time is a flaky test rather than a guard. What it is
     * here to catch is a **regression of the kind it was written for** — the quadratic wrap took
     * 37 s, which this would have caught with room to spare.
     */
    const bytes = await renderPdf(modelAt(50), { fonts: fonts() });

    expect(bytes.length).toBeGreaterThan(100_000);
  }, 20_000);
});
