import type { PlanImage, PlanSourceFormat } from '@mfd/document-model';

/**
 * Turning a file an engineer picked into a {@link PlanImage}.
 *
 * ## Why PDF pages are rasterised
 *
 * The owner's scope for Sprint 4 is a **raster underlay the engineer works on top
 * of** — explicitly not automatic wall detection, DWG parsing or BIM conversion. So a
 * PDF page is rendered to a bitmap and treated exactly like an imported PNG. The
 * vector content is not read, and nothing downstream can accidentally come to depend
 * on it being there.
 *
 * ## Why the image is embedded rather than referenced
 *
 * A project file an engineer emails to a colleague has to arrive with its drawing. A
 * path into someone else's filesystem is not a floor plan. External asset storage is a
 * later decision; embedding keeps the document self-contained until then.
 *
 * The cost is honest and worth stating: a large scanned plan becomes several megabytes
 * of base64 inside the project file. That is the reason undo stores explicit inverses
 * rather than document snapshots.
 */

/** Above this, a rendered PDF page is scaled down. 4k across is plenty to trace on. */
export const MAX_PLAN_PIXELS = 4_096;

/** Rendering resolution for a PDF page. Enough to read a title block. */
export const PDF_RENDER_DPI = 150;

export class PlanImportError extends Error {
  override readonly name = 'PlanImportError';
}

function formatOf(file: File): PlanSourceFormat | null {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (file.type === 'image/png' || name.endsWith('.png')) return 'png';
  if (file.type === 'image/jpeg' || name.endsWith('.jpg') || name.endsWith('.jpeg')) {
    return 'jpg';
  }
  return null;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new PlanImportError(`Could not read ${file.name}`));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new PlanImportError('The file is not a readable image'));
    image.src = dataUrl;
  });
}

/**
 * Render the first page of a PDF to a PNG data URL.
 *
 * pdf.js is imported dynamically so its several hundred kilobytes are fetched the
 * first time an engineer opens a PDF rather than on every application start. Most
 * sessions on a PNG site plan never load it at all.
 *
 * ## The **legacy** build, and it is not optional
 *
 * `pdfjs-dist/legacy/build/pdf.mjs`, not `pdfjs-dist`. The modern build of pdf.js 6 calls
 * `Map.prototype.getOrInsertComputed`, a proposal method that Chrome 151 does not implement, and
 * every PDF import failed with `getOrInsertComputed is not a function`.
 *
 * **That bug shipped and no test caught it**, because until the hospital dataset arrived no browser
 * test had ever imported a PDF — the specs all use PNG fixtures, which take a different code path
 * entirely. It surfaced the first time a real PDF was fed through the file input.
 *
 * The legacy build targets older runtimes and is what `scripts/ingest-dataset.ts` already uses in
 * Node. `plan.spec.ts` now imports a real PDF in the browser so this cannot regress silently again.
 */
async function rasterisePdf(
  file: File,
  pageIndex: number,
): Promise<{ dataUrl: string; width: number; height: number; dpi: number }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const workerSource = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerSource.default;

  const data = await file.arrayBuffer();
  const document = await pdfjs.getDocument({ data }).promise;

  if (pageIndex + 1 > document.numPages) {
    throw new PlanImportError(
      `${file.name} has ${document.numPages} page${document.numPages === 1 ? '' : 's'}`,
    );
  }

  const page = await document.getPage(pageIndex + 1);
  // A PDF user-space unit is 1/72 inch, so this is the dpi-to-scale conversion.
  const base = page.getViewport({ scale: PDF_RENDER_DPI / 72 });
  const cap = Math.min(1, MAX_PLAN_PIXELS / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale: (PDF_RENDER_DPI / 72) * cap });

  const canvas = document_createCanvas(Math.round(viewport.width), Math.round(viewport.height));
  const context = canvas.getContext('2d');
  if (!context) throw new PlanImportError('This browser could not render the PDF page');

  // A PDF page is transparent where nothing is drawn, and a transparent plan on a
  // dark canvas is invisible. Paint the page white first, as a printer would.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;

  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
    /*
     * The resolution actually used, not the constant. A page large enough to hit
     * `MAX_PLAN_PIXELS` is rendered at less than `PDF_RENDER_DPI`, and this is the only place
     * that scaling is known — recovering it later from the pixel dimensions alone is impossible
     * without the page size, which the document does not carry.
     *
     * This is what makes the printed-scale calibration route available for a PDF: converting a
     * stated ratio to millimetres per pixel needs it.
     */
    dpi: PDF_RENDER_DPI * cap,
  };
}

function document_createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = window.document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export interface ImportPlanOptions {
  /** PDF page to render, zero-based. Ignored for raster files. */
  readonly pageIndex?: number;
  /** ISO timestamp recorded on the plan. Supplied so this stays testable. */
  readonly now: string;
}

export async function importPlanFile(
  file: File,
  options: ImportPlanOptions,
): Promise<PlanImage> {
  const sourceFormat = formatOf(file);
  if (!sourceFormat) {
    throw new PlanImportError(
      `${file.name} is not a PDF, PNG or JPG. Sprint 4 supports those three formats; ` +
        'DWG and IFC are not read.',
    );
  }

  const pageIndex = sourceFormat === 'pdf' ? (options.pageIndex ?? 0) : 0;

  if (sourceFormat === 'pdf') {
    const rendered = await rasterisePdf(file, pageIndex);
    return {
      sourceFormat,
      sourceFileName: file.name,
      pageIndex,
      pixelWidth: rendered.width,
      pixelHeight: rendered.height,
      dataUrl: rendered.dataUrl,
      renderDpi: rendered.dpi,
      importedAt: options.now,
    };
  }

  const dataUrl = await readAsDataUrl(file);
  const image = await loadImage(dataUrl);

  if (image.naturalWidth === 0 || image.naturalHeight === 0) {
    throw new PlanImportError(`${file.name} has no pixels`);
  }

  return {
    sourceFormat,
    sourceFileName: file.name,
    pageIndex,
    pixelWidth: image.naturalWidth,
    pixelHeight: image.naturalHeight,
    dataUrl,
    /*
     * Null, and it has to be. A PNG or JPG arrives as pixels with no trustworthy statement of the
     * size it was scanned at — a file's own DPI metadata is routinely wrong or absent, and a wrong
     * resolution turns a printed "1:100" into a scale that is confidently incorrect. Null withholds
     * the printed-scale route for this drawing and leaves two-point, which measures the image as it
     * actually is.
     */
    renderDpi: null,
    importedAt: options.now,
  };
}
