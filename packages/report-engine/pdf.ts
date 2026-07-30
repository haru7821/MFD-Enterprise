/**
 * `@mfd/report-engine/pdf` — the PDF renderer, behind its own entry point.
 *
 * Separate from the package index for a measured reason. `pdf-lib` and `@pdf-lib/fontkit` are
 * about 1.2 MB, and while the main index re-exported this file every consumer paid for them on
 * first paint — the bundler said so plainly: *"dynamically imported ... but also statically
 * imported, dynamic import will not move module into another chunk"*. The main bundle had grown
 * from 679 kB to 1,878 kB.
 *
 * It is also the right shape independent of size. `render/pdf.ts` is the only file in the
 * package that knows a PDF library exists; an entry point that matches that boundary is what
 * lets a caller build a report model, or an HTML report, without a PDF library in the graph at
 * all.
 */

export { renderPdf } from './src/render/pdf';
export { MissingGlyphError, embedFonts, type EmbeddedFonts } from './src/render/fonts';
