import { writeFileSync } from 'node:fs';

import { PDFDocument, StandardFonts, rgb } from '../packages/report-engine/node_modules/pdf-lib/cjs/index.js';

/**
 * Generate `fixtures/drawings/`, the PDFs the browser specs import.
 *
 * **Generated, not copied from the dataset.** The hospital drawings are real customer property and
 * must not enter this repository; what the tests need is a PDF with a *known page size* and a title
 * block that claims a different one — the Hospital_026 shape, reproducible in 1 kB.
 *
 * Run: `pnpm exec vite-node scripts/make-drawing-fixture.ts`
 */

const doc = await PDFDocument.create();
const [width, height] = [595.28, 841.89] as const; // A4
const page = doc.addPage([width, height]);
const font = await doc.embedFont(StandardFonts.Helvetica);

// The defect this fixture exists to reproduce: the sheet says A3, the page is A4.
page.drawText('SCALE  A3 : 1/200   (fixture: title block claims A3, page is A4)', {
  x: 40,
  y: height - 60,
  size: 9,
  font,
  color: rgb(0, 0, 0),
});
page.drawRectangle({
  x: 40,
  y: 120,
  width: width - 80,
  height: height - 220,
  borderWidth: 1,
  borderColor: rgb(0, 0, 0),
});
page.drawText('6000', { x: width / 2 - 20, y: 100, size: 9, font });

writeFileSync('fixtures/drawings/a4-titleblock-a3.pdf', await doc.save());
process.stdout.write('fixtures/drawings/a4-titleblock-a3.pdf written\n');
