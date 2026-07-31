import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  classifyDrawing,
  effectiveDpiOf,
  parseDataset,
  sheetSizeOf,
  type Dataset,
  type DrawingClass,
  type DrawingMetadata,
  type DrawingRecord,
} from '../packages/layout-knowledge/src/index';

/**
 * Catalogue the external hospital drawing dataset into `knowledge/dataset.json`.
 *
 * > Owner decision: *"Create support for an external drawing dataset repository. Repository name:
 * > MFD-Hospital-Dataset. Do not store the dataset inside the application repository."*
 * >
 * > Step 1: generate `knowledge/dataset.json` including file path, drawing hash, revision, format,
 * > page count, metadata. Step 2: classify every drawing according to the existing PDF taxonomy.
 *
 * ## Usage
 *
 * ```
 * pnpm dataset:ingest -- --dataset /workspace/mfd-hospital-dataset --commit <sha>
 * ```
 *
 * The dataset is **read, never copied**. Nothing under `dataset/` is written into this repository:
 * the catalogue records paths, hashes and metadata, and the drawings stay where an engineer
 * maintains them. That is the owner's constraint and it is also what keeps a repository of real
 * hospital drawings out of an application's history, where it could not be removed later.
 *
 * ## What it classifies, and what it will not
 *
 * Everything here is read **off the file**. Page size, page count, extractable text and the PDF
 * info dictionary are facts; the classification is derived from them by stated rules. Two classes
 * are deliberately provisional:
 *
 * - `photograph_suspected` is a **flag for a human**, not a verdict. Perspective distortion cannot
 *   be detected from a raster, and it is the one input that calibrates plausibly and measures
 *   wrongly everywhere away from the calibration line — gap G-1. A large JPG is where it hides, so
 *   a large JPG gets flagged and a person decides.
 * - `unreadable` is what an unopenable file gets. Never a guess at what it might have been.
 *
 * `effectiveDpi` is computed per sheet rather than assumed, because it is the one number that
 * decides whether a drawing is traceable: an A0 page rasterises at ~87 dpi under the importer's
 * 4,096 px cap, and fine dimension text stops being legible.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : process.argv[index + 1];
  return value ?? fallback;
}

const DATASET_ROOT = argument('dataset', '/workspace/mfd-hospital-dataset');
const COMMIT = argument('commit', '');

function formatOf(path: string): DrawingRecord['format'] {
  switch (extname(path).toLowerCase()) {
    case '.pdf':
      return 'pdf';
    case '.dwg':
      return 'dwg';
    case '.dxf':
      return 'dxf';
    case '.jpg':
    case '.jpeg':
      return 'jpg';
    case '.png':
      return 'png';
    default:
      return 'other';
  }
}

function emptyMetadata(fileBytes: number): DrawingMetadata {
  return {
    pageWidthPt: null,
    pageHeightPt: null,
    sheetSize: null,
    effectiveDpi: null,
    textCharacters: null,
    title: null,
    producer: null,
    fileBytes,
  };
}

interface Read {
  readonly pageCount: number | null;
  readonly classification: DrawingClass;
  readonly metadata: DrawingMetadata;
}

async function readPdf(path: string, fileBytes: number): Promise<Read> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  try {
    const data = new Uint8Array(readFileSync(path));
    const document = await pdfjs.getDocument({ data, useSystemFonts: false }).promise;
    const page = await document.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const text = await page.getTextContent();
    const characters = text.items
      .map((item) => ('str' in item ? item.str : ''))
      .join('')
      .trim().length;
    const info = (await document.getMetadata()).info as Record<string, unknown> | undefined;

    return {
      pageCount: document.numPages,
      /*
       * Extractable text is the discriminator, and it is a good one: a CAD export carries its room
       * names, dimensions and title block as text objects, while a scan is one image and yields
       * essentially nothing. The threshold is low on purpose — a handful of characters can come
       * from a stamp overlaid on a scan, so it takes a real body of text to call something vector.
       */
      classification: classifyDrawing({
        format: 'pdf',
        textCharacters: characters,
        fileBytes,
        readable: true,
      }),
      metadata: {
        pageWidthPt: viewport.width,
        pageHeightPt: viewport.height,
        sheetSize: sheetSizeOf(viewport.width, viewport.height),
        effectiveDpi: Math.round(effectiveDpiOf(viewport.width, viewport.height) * 10) / 10,
        textCharacters: characters,
        title: typeof info?.['Title'] === 'string' && info['Title'] ? info['Title'] : null,
        producer:
          typeof info?.['Producer'] === 'string' && info['Producer'] ? info['Producer'] : null,
        fileBytes,
      },
    };
  } catch {
    // Encrypted, truncated, or not really a PDF. Recorded as unreadable rather than guessed at.
    return { pageCount: null, classification: 'unreadable', metadata: emptyMetadata(fileBytes) };
  }
}

/** A raster. The classification rules live in the package, where they are tested. */
function readRaster(format: DrawingRecord['format'], fileBytes: number): Read {
  return {
    pageCount: 1,
    classification: classifyDrawing({ format, textCharacters: null, fileBytes, readable: true }),
    metadata: emptyMetadata(fileBytes),
  };
}

function walk(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...walk(path));
    else found.push(path);
  }
  return found.sort();
}

async function catalogueDrawing(path: string, hospitalId: string): Promise<DrawingRecord | null> {
  const format = formatOf(path);
  if (format === 'other') return null;

  const bytes = readFileSync(path);
  const fileBytes = statSync(path).size;
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  const read: Read =
    format === 'pdf'
      ? await readPdf(path, fileBytes)
      : format === 'dwg' || format === 'dxf'
        ? {
            pageCount: null,
            classification: classifyDrawing({
              format,
              textCharacters: null,
              fileBytes,
              readable: true,
            }),
            metadata: emptyMetadata(fileBytes),
          }
        : readRaster(format, fileBytes);

  return {
    drawingId: `${hospitalId}/${basename(path)}`,
    hospitalId,
    path: relative(DATASET_ROOT, path),
    format,
    pageCount: read.pageCount,
    /*
     * Sheet and revision are printed on the drawing, in its title block, which is not machine
     * readable here. Null rather than parsed out of a filename: a file called `A-201_Rev-C.pdf`
     * usually means what it says and sometimes does not, and a wrong revision on a citation is
     * worse than an absent one.
     */
    sheet: null,
    revision: null,
    sha256,
    classification: read.classification,
    metadata: read.metadata,
    status: read.classification === 'unreadable' ? 'unreadable' : 'catalogued',
  };
}

async function main(): Promise<void> {
  const datasetDirectory = join(DATASET_ROOT, 'dataset');

  let hospitals: string[] = [];
  try {
    hospitals = readdirSync(datasetDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort();
  } catch {
    process.stdout.write(
      `dataset: no ${datasetDirectory} — the repository is present but holds no drawings yet.\n`,
    );
  }

  const drawings: DrawingRecord[] = [];
  for (const hospitalId of hospitals) {
    for (const path of walk(join(datasetDirectory, hospitalId))) {
      const record = await catalogueDrawing(path, hospitalId);
      if (record) drawings.push(record);
    }
  }

  const existing = parseDataset(
    JSON.parse(readFileSync(join(REPO, 'knowledge', 'dataset.json'), 'utf8')) as unknown,
  );

  const dataset: Dataset = {
    ...existing,
    repository: 'haru7821/MFD-Hospital-Dataset',
    commit: COMMIT || existing.commit,
    drawings,
  };

  // Validated on the way out as well as in: a catalogue this script produced but the package
  // cannot read would fail on somebody else's machine rather than on the one that wrote it.
  parseDataset(dataset);
  writeFileSync(
    join(REPO, 'knowledge', 'dataset.json'),
    `${JSON.stringify(dataset, null, 2)}\n`,
    'utf8',
  );

  const byClass = new Map<string, number>();
  for (const drawing of drawings) {
    byClass.set(drawing.classification, (byClass.get(drawing.classification) ?? 0) + 1);
  }

  process.stdout.write(
    `dataset: ${drawings.length} drawing(s) across ${hospitals.length} hospital folder(s)\n` +
      [...byClass.entries()]
        .sort()
        .map(([name, count]) => `  ${name}: ${count}\n`)
        .join(''),
  );
}

await main();
