import { PDFDocument, type PDFPage, degrees, rgb } from 'pdf-lib';

import { renderReason } from '@mfd/rule-engine';
import type { ReasonCode, ReasonParams } from '@mfd/rule-engine';

import { type LabelKey, labelPair } from '../labels';
import type { DatasheetBlock, FloorPlanSection, ReportModel } from '../model';
import { type EmbeddedFonts, embedFonts } from './fonts';
import {
  MARGINS,
  PAGES,
  ROW_PADDING,
  RULE_WEIGHT,
  SECTION_GAP,
  TYPE,
  type PageSpec,
  leading,
} from './paper';
import { DEFAULT_RENDER_OPTIONS, type PdfRenderOptions } from './types';

/**
 * The PDF renderer.
 *
 * Vector throughout except the plan underlay, which is a raster by design (C-6). The drawing
 * is re-emitted from millimetres at page scale rather than screenshotted, which is why the
 * geometry lives outside the renderer (AD-2) and why an 800 mm footprint measures 800 mm on
 * paper.
 *
 * ## Pagination
 *
 * A cursor walks down the page and asks for a new one when a block will not fit. Two rules
 * make that safe rather than approximate:
 *
 * 1. **The notice's space is reserved before anything is laid out.** It is the last section
 *    and it is unconditional, so it must never be the block that falls off the end. Reserving
 *    rather than appending is the difference between "usually present" and "present".
 * 2. **A table header repeats on every page it spans.** Forty findings across three pages
 *    with the header on the first is a table nobody can read past page one.
 *
 * ## Table widths
 *
 * Column widths are fractions of the text column, so a page size change re-flows rather than
 * clips. Text longer than its column is wrapped by `wrap`, never truncated: a truncated
 * citation is a citation that cannot be looked up, which defeats the point of printing it.
 */

const INK = rgb(0.07, 0.07, 0.07);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.82, 0.84, 0.86);
const HEADER_FILL = rgb(0.95, 0.96, 0.97);
const RED = rgb(0.72, 0.11, 0.11);
const AMBER = rgb(0.71, 0.33, 0.04);
const GREEN = rgb(0.08, 0.5, 0.24);
const PLAN_ROOM = rgb(0.22, 0.25, 0.3);
const PLAN_OBSTRUCTION = rgb(0.6, 0.62, 0.65);
const PLAN_EQUIPMENT = rgb(0.15, 0.39, 0.92);

interface Cursor {
  page: PDFPage;
  y: number;
  pageNumber: number;
}

interface Context {
  readonly doc: PDFDocument;
  readonly fonts: EmbeddedFonts;
  readonly spec: PageSpec;
  /** How much vertical space the notice needs, reserved on the final page. */
  readonly noticeHeight: number;
  readonly primary: 'ko' | 'en';
  readonly secondary: 'ko' | 'en';
  readonly renderMode: ReportModel['renderMode'];
  cursor: Cursor;
  readonly pages: PDFPage[];
}

function textWidth(fonts: EmbeddedFonts, value: string, size: number, bold = false): number {
  return (bold ? fonts.bold : fonts.regular).widthOfTextAtSize(value, size);
}

/** Break a string to fit a width. Wrapped, never truncated — see the note above. */
function wrap(
  fonts: EmbeddedFonts,
  value: string,
  size: number,
  maxWidth: number,
  bold = false,
): string[] {
  if (value === '') return [''];
  const lines: string[] = [];
  let line = '';

  // Split on spaces first; a Korean sentence has few, so fall through to per-character
  // breaking when a single "word" is itself too wide. Hangul breaks between characters
  // without hyphenation, which is why this is safe.
  for (const word of value.split(' ')) {
    const candidate = line === '' ? word : `${line} ${word}`;
    if (textWidth(fonts, candidate, size, bold) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line !== '') lines.push(line);

    if (textWidth(fonts, word, size, bold) <= maxWidth) {
      line = word;
      continue;
    }
    line = '';
    for (const character of word) {
      const next = line + character;
      if (textWidth(fonts, next, size, bold) > maxWidth && line !== '') {
        lines.push(line);
        line = character;
      } else {
        line = next;
      }
    }
  }
  if (line !== '') lines.push(line);
  return lines.length === 0 ? [''] : lines;
}

function contentWidth(spec: PageSpec): number {
  return spec.width - MARGINS.left - MARGINS.right;
}

function newPage(context: Context): void {
  const page = context.doc.addPage([context.spec.width, context.spec.height]);
  context.pages.push(page);
  context.cursor = {
    page,
    y: context.spec.height - MARGINS.top,
    pageNumber: context.cursor.pageNumber + 1,
  };
}

/** Make room for `height`, starting a page if the block will not fit. */
function reserve(context: Context, height: number): void {
  if (context.cursor.y - height < MARGINS.bottom) newPage(context);
}

function draw(
  context: Context,
  value: string,
  x: number,
  size: number,
  options: {
    bold?: boolean | undefined;
    colour?: ReturnType<typeof rgb> | undefined;
    context?: string | undefined;
  } = {},
): void {
  // Every string that reaches the page is checked. A missing glyph must fail here rather than
  // become a blank box in a signed document — see ./fonts.ts.
  context.fonts.assertRenderable(value, options.context ?? 'the report');
  context.cursor.page.drawText(value, {
    x,
    y: context.cursor.y - size,
    size,
    font: options.bold ? context.fonts.bold : context.fonts.regular,
    color: options.colour ?? INK,
  });
}

function advance(context: Context, amount: number): void {
  context.cursor.y -= amount;
}

/** A bilingual heading: the leading language, then the other beneath in muted type. */
function sectionHeading(context: Context, key: LabelKey): void {
  const pair = labelPair(key);
  reserve(context, leading(TYPE.sectionHeading) + leading(TYPE.small) + SECTION_GAP);
  advance(context, SECTION_GAP);

  draw(context, pair[context.primary], MARGINS.left, TYPE.sectionHeading, {
    bold: true,
    context: `heading ${key}`,
  });
  advance(context, leading(TYPE.sectionHeading));
  draw(context, pair[context.secondary], MARGINS.left, TYPE.small, {
    colour: MUTED,
    context: `heading ${key}`,
  });
  advance(context, leading(TYPE.small) + 2);

  context.cursor.page.drawLine({
    start: { x: MARGINS.left, y: context.cursor.y },
    end: { x: context.spec.width - MARGINS.right, y: context.cursor.y },
    thickness: RULE_WEIGHT,
    color: INK,
  });
  advance(context, 6);
}

/** `한국어 / English`, one line, for a label or a header cell. */
function inlineLabel(context: Context, key: LabelKey): string {
  const pair = labelPair(key);
  return `${pair[context.primary]} / ${pair[context.secondary]}`;
}

function keyValue(context: Context, key: LabelKey, value: string): void {
  const line = `${inlineLabel(context, key)}: ${value}`;
  const lines = wrap(context.fonts, line, TYPE.body, contentWidth(context.spec));
  reserve(context, leading(TYPE.body) * lines.length);
  for (const part of lines) {
    draw(context, part, MARGINS.left, TYPE.body, { context: `field ${key}` });
    advance(context, leading(TYPE.body));
  }
}

interface Column {
  readonly header: LabelKey;
  /** Fraction of the text column. The row must sum to 1. */
  readonly width: number;
  readonly align?: 'right';
}

interface Cell {
  readonly text: string;
  readonly colour?: ReturnType<typeof rgb>;
  readonly bold?: boolean;
}

/**
 * A table, paginated, with its header repeated on every page it spans.
 *
 * Rows are measured before they are drawn, so a row whose wrapped text is four lines tall
 * moves to the next page whole rather than being split across the break.
 */
function table(context: Context, columns: readonly Column[], rows: readonly (readonly Cell[])[]): void {
  const width = contentWidth(context.spec);
  const xs: number[] = [];
  let x = MARGINS.left;
  for (const column of columns) {
    xs.push(x);
    x += column.width * width;
  }

  const drawHeader = (): void => {
    const height = leading(TYPE.tableHeader) + ROW_PADDING * 2;
    reserve(context, height);
    context.cursor.page.drawRectangle({
      x: MARGINS.left,
      y: context.cursor.y - height,
      width,
      height,
      color: HEADER_FILL,
    });
    advance(context, ROW_PADDING);
    columns.forEach((column, index) => {
      const label = inlineLabel(context, column.header);
      const cellWidth = column.width * width - ROW_PADDING * 2;
      const [first = ''] = wrap(context.fonts, label, TYPE.tableHeader, cellWidth, true);
      draw(context, first, (xs[index] ?? MARGINS.left) + ROW_PADDING, TYPE.tableHeader, {
        bold: true,
        colour: MUTED,
        context: `header ${column.header}`,
      });
    });
    advance(context, leading(TYPE.tableHeader) + ROW_PADDING);
  };

  drawHeader();

  for (const row of rows) {
    const wrapped = row.map((cell, index) =>
      wrap(
        context.fonts,
        cell.text,
        TYPE.tableCell,
        (columns[index]?.width ?? 0.1) * width - ROW_PADDING * 2,
      ),
    );
    const lineCount = Math.max(...wrapped.map((lines) => lines.length), 1);
    const height = leading(TYPE.tableCell) * lineCount + ROW_PADDING;

    if (context.cursor.y - height < MARGINS.bottom) {
      newPage(context);
      // Repeated on the new page: a table whose header is only on page one is a table
      // nobody can read past page one.
      drawHeader();
    }

    const top = context.cursor.y;
    wrapped.forEach((lines, index) => {
      const column = columns[index];
      if (!column) return;
      lines.forEach((line, lineIndex) => {
        const cellWidth = column.width * width - ROW_PADDING * 2;
        const offset =
          column.align === 'right'
            ? cellWidth - textWidth(context.fonts, line, TYPE.tableCell, row[index]?.bold)
            : 0;
        context.cursor.y = top - leading(TYPE.tableCell) * lineIndex;
        draw(
          context,
          line,
          (xs[index] ?? MARGINS.left) + ROW_PADDING + Math.max(0, offset),
          TYPE.tableCell,
          {
            colour: row[index]?.colour,
            bold: row[index]?.bold,
            context: `cell ${column.header}`,
          },
        );
      });
    });

    context.cursor.y = top - height;
    context.cursor.page.drawLine({
      start: { x: MARGINS.left, y: context.cursor.y + ROW_PADDING / 2 },
      end: { x: MARGINS.left + width, y: context.cursor.y + ROW_PADDING / 2 },
      thickness: 0.3,
      color: RULE,
    });
  }
}

/** A sentence in both languages, stacked. */
function bilingualParagraph(context: Context, ko: string, en: string, indent = 0): void {
  const pair = { ko, en };
  const width = contentWidth(context.spec) - indent;

  for (const [index, language] of [context.primary, context.secondary].entries()) {
    const lines = wrap(context.fonts, pair[language], TYPE.body, width);
    reserve(context, leading(TYPE.body) * lines.length);
    for (const line of lines) {
      draw(context, line, MARGINS.left + indent, TYPE.body, {
        colour: index === 0 ? INK : MUTED,
        context: 'paragraph',
      });
      advance(context, leading(TYPE.body));
    }
  }
}

function reasonPair(code: ReasonCode, params: ReasonParams): { ko: string; en: string } {
  return { ko: renderReason('ko', code, params), en: renderReason('en', code, params) };
}

const SEVERITY_COLOUR = { RED, YELLOW: AMBER, GREEN } as const;

/**
 * The drawing page.
 *
 * Model millimetres are mapped to points by one scale factor chosen to fit the extent, so an
 * 800 mm footprint is 800 mm at that scale and the drawing can be measured. The Y axis is
 * flipped because model space grows downward and PDF space grows upward — getting that wrong
 * mirrors the plan, which is why the transform is one function rather than inline arithmetic.
 */
async function drawPlan(context: Context, plan: FloorPlanSection): Promise<void> {
  const showRaster = context.renderMode !== 'vector' && plan.raster !== null;
  const showVector = context.renderMode !== 'raster';

  const geometryExtent = plan.geometry.extent;
  const raster = plan.raster;
  // With no traced geometry, the scan's own footprint frames the page — in the millimetres its
  // calibration gives it, so a raster-only page is still measured rather than merely shown.
  const extent =
    geometryExtent ??
    (showRaster && raster
      ? {
          minX: raster.x,
          minY: raster.y,
          maxX: raster.x + raster.width,
          maxY: raster.y + raster.height,
        }
      : null);
  if (!extent) return;

  const width = contentWidth(context.spec);
  const available = context.cursor.y - MARGINS.bottom - context.noticeHeight;
  const height = Math.min(available, width * 0.7);
  if (height < 80) {
    newPage(context);
    await drawPlan(context, plan);
    return;
  }

  const modelWidth = Math.max(extent.maxX - extent.minX, 1);
  const modelHeight = Math.max(extent.maxY - extent.minY, 1);
  const scale = Math.min(width / modelWidth, height / modelHeight) * 0.95;

  const originX = MARGINS.left + (width - modelWidth * scale) / 2;
  const originY = context.cursor.y - (height - modelHeight * scale) / 2;
  const project = (point: { x: number; y: number }) => ({
    x: originX + (point.x - extent.minX) * scale,
    // Flipped: model Y grows downward, PDF Y grows upward.
    y: originY - (point.y - extent.minY) * scale,
  });

  const polygon = (
    points: readonly { x: number; y: number }[],
    colour: ReturnType<typeof rgb>,
    thickness: number,
  ): void => {
    const projected = points.map(project);
    for (let index = 0; index < projected.length; index += 1) {
      const from = projected[index];
      const to = projected[(index + 1) % projected.length];
      if (!from || !to) continue;
      context.cursor.page.drawLine({ start: from, end: to, thickness, color: colour });
    }
  };

  // The scan first, so the geometry sits over it. Owner decision: vector-first, and the raster
  // is opt-in — `vector` mode never embeds it, which is what keeps the default output small and
  // entirely vector.
  if (showRaster && raster) {
    const image = await embedRaster(context, raster.dataUrl);
    if (image) {
      const topLeft = project({ x: raster.x, y: raster.y });
      context.cursor.page.drawImage(image, {
        x: topLeft.x,
        y: topLeft.y - raster.height * scale,
        width: raster.width * scale,
        height: raster.height * scale,
        // Dimmed under the geometry so the traced lines stay readable; full strength when the
        // scan is the only thing on the page.
        opacity: context.renderMode === 'raster' ? 1 : 0.45,
        ...(raster.rotationDegrees === 0
          ? {}
          : { rotate: degrees(-raster.rotationDegrees) }),
      });
    }
  }

  // No geometry in raster mode. The "this is a debug output" notice is not here: it is a fact
  // about the whole document, printed at the top where a reader sees it first, and a level with
  // no scan would otherwise never show it.
  if (!showVector) {
    advance(context, height + 6);
    return;
  }

  for (const room of plan.geometry.rooms) polygon(room.points, PLAN_ROOM, 1.2);
  for (const obstruction of plan.geometry.obstructions) {
    polygon(obstruction.points, PLAN_OBSTRUCTION, 1);
  }
  for (const item of plan.geometry.equipment) {
    polygon(item.points, PLAN_EQUIPMENT, 0.8);
    const centre = item.points.reduce(
      (sum, point) => ({ x: sum.x + point.x / item.points.length, y: sum.y + point.y / item.points.length }),
      { x: 0, y: 0 },
    );
    const at = project(centre);
    // The number, matching the placement table and every finding about this machine.
    context.cursor.page.drawText(item.label, {
      x: at.x - textWidth(context.fonts, item.label, TYPE.small, true) / 2,
      y: at.y - TYPE.small / 2,
      size: TYPE.small,
      font: context.fonts.bold,
      color: PLAN_EQUIPMENT,
    });
  }

  advance(context, height + 6);
}

/**
 * Embed a data-URL image, PNG or JPEG.
 *
 * Returns null rather than throwing on an unreadable image, and that is the one place this
 * renderer is deliberately forgiving: a corrupt underlay must not stop a report whose findings
 * are all still valid. The drawing page loses its background; nothing else changes. A missing
 * *glyph* is the opposite case and throws, because it would silently alter what the document
 * says.
 */
async function embedRaster(context: Context, dataUrl: string) {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;

  const header = dataUrl.slice(0, comma);
  const base64 = dataUrl.slice(comma + 1);

  try {
    if (header.includes('image/png')) return await context.doc.embedPng(base64);
    if (header.includes('image/jpeg') || header.includes('image/jpg')) {
      return await context.doc.embedJpg(base64);
    }
  } catch {
    return null;
  }
  return null;
}

function datasheetBlocks(context: Context, blocks: readonly DatasheetBlock[]): void {
  for (const block of blocks) {
    reserve(context, leading(TYPE.subHeading) * 2);
    draw(context, inlineLabel(context, block.group), MARGINS.left + 8, TYPE.subHeading, {
      bold: true,
      context: `datasheet ${block.group}`,
    });
    advance(context, leading(TYPE.subHeading));
    draw(
      context,
      block.citation ?? inlineLabel(context, 'no_citation'),
      MARGINS.left + 8,
      TYPE.small,
      { colour: MUTED, context: 'citation' },
    );
    advance(context, leading(TYPE.small));

    for (const field of block.fields) {
      const line = `${inlineLabel(context, field.label)}: ${field.value ?? inlineLabel(context, 'not_supplied')}`;
      const lines = wrap(context.fonts, line, TYPE.body, contentWidth(context.spec) - 16);
      reserve(context, leading(TYPE.body) * lines.length);
      for (const part of lines) {
        draw(context, part, MARGINS.left + 16, TYPE.body, { context: 'datasheet field' });
        advance(context, leading(TYPE.body));
      }
    }
    advance(context, 4);
  }
}

/** Footer on every page: the page number and the report's identity. */
function paginate(context: Context, model: ReportModel): void {
  const total = context.pages.length;
  context.pages.forEach((page, index) => {
    const label = `${labelPair('field_page')[context.primary]} ${index + 1} / ${total}`;
    const identity = `${model.cover.projectName} · ${model.cover.date} · MFD ${model.cover.mfdVersion}`;

    page.drawLine({
      start: { x: MARGINS.left, y: MARGINS.bottom - 6 },
      end: { x: context.spec.width - MARGINS.right, y: MARGINS.bottom - 6 },
      thickness: 0.3,
      color: RULE,
    });
    page.drawText(identity, {
      x: MARGINS.left,
      y: MARGINS.bottom - 16,
      size: TYPE.small,
      font: context.fonts.regular,
      color: MUTED,
    });
    page.drawText(label, {
      x:
        context.spec.width -
        MARGINS.right -
        textWidth(context.fonts, label, TYPE.small),
      y: MARGINS.bottom - 16,
      size: TYPE.small,
      font: context.fonts.regular,
      color: MUTED,
    });
  });
}

export async function renderPdf(
  model: ReportModel,
  options: PdfRenderOptions,
): Promise<Uint8Array> {
  const primary = options.primary ?? DEFAULT_RENDER_OPTIONS.primary;
  const secondary = options.secondary ?? DEFAULT_RENDER_OPTIONS.secondary;

  const doc = await PDFDocument.create();
  const fonts = await embedFonts(doc, options.fonts);

  // Landscape, because a bilingual header is ~1.7× the width of English alone and the wide
  // tables carry eight columns. See ./paper.ts.
  const spec = options.pageSize === 'A3' ? PAGES.A3_LANDSCAPE : PAGES.A4_LANDSCAPE;

  const first = doc.addPage([spec.width, spec.height]);
  const context: Context = {
    doc,
    fonts,
    spec,
    // Reserved before anything is laid out: the notice is unconditional and last, so it must
    // never be the block that falls off the end of a full page.
    noticeHeight: noticeSpace(model, fonts, spec),
    primary,
    secondary,
    renderMode: model.renderMode,
    cursor: { page: first, y: spec.height - MARGINS.top, pageNumber: 1 },
    pages: [first],
  };

  drawCover(context, model);
  drawDebugBanner(context, model);
  drawSummary(context, model);
  drawSchedule(context, model);
  for (const plan of model.floorPlans) await drawFloorPlan(context, plan);
  drawValidation(context, model);
  drawChecklist(context, model);
  drawDatasheets(context, model);
  drawStandards(context, model);
  drawNotice(context, model);
  drawProvenance(context, model);
  paginate(context, model);

  // `useObjectStreams: false` keeps the cross-reference table and the font dictionaries as
  // plain objects. Object streams are smaller, and they also make a PDF opaque to anything
  // that inspects it without a full parser — including the tests that assert the Korean face
  // is actually embedded. A report is a document people audit; legibility to a grep is worth
  // the few kilobytes.
  return doc.save({ useObjectStreams: false });
}

function noticeSpace(model: ReportModel, fonts: EmbeddedFonts, spec: PageSpec): number {
  const width = contentWidth(spec);
  const lines = [model.notice.liability.ko, model.notice.liability.en]
    .concat(model.notice.caveats.flatMap((caveat) => [caveat.ko, caveat.en]))
    .reduce((total, value) => total + wrap(fonts, value, TYPE.body, width).length, 0);

  return leading(TYPE.body) * lines + leading(TYPE.sectionHeading) * 2 + SECTION_GAP * 2;
}

function drawCover(context: Context, model: ReportModel): void {
  const title = labelPair('report_title');
  advance(context, 40);
  draw(context, title[context.primary], MARGINS.left, TYPE.title, {
    bold: true,
    context: 'title',
  });
  advance(context, leading(TYPE.title));
  draw(context, title[context.secondary], MARGINS.left, TYPE.subHeading, {
    colour: MUTED,
    context: 'title',
  });
  advance(context, leading(TYPE.subHeading) + 18);

  const { cover } = model;
  const dash = '—';
  keyValue(context, 'field_hospital', cover.hospital || dash);
  keyValue(context, 'field_site', cover.site || dash);
  keyValue(context, 'field_project', cover.projectName || dash);
  keyValue(context, 'field_customer', cover.customerContact || dash);
  keyValue(context, 'field_ts_engineer', cover.tsEngineer || dash);
  keyValue(context, 'field_date', cover.date);
  keyValue(context, 'field_mfd_version', cover.mfdVersion);
}

/**
 * "This is a debug output" — at the top, on page one.
 *
 * A fact about the whole document rather than about a drawing page: raster mode omits the
 * assessed layout everywhere, and a project whose levels have no scan would otherwise carry no
 * notice at all. First thing after the cover, because a reader who is going to stop reading
 * stops early.
 */
function drawDebugBanner(context: Context, model: ReportModel): void {
  if (model.renderMode !== 'raster') return;

  advance(context, SECTION_GAP);
  for (const line of wrap(
    context.fonts,
    inlineLabel(context, 'mode_raster_warning'),
    TYPE.subHeading,
    contentWidth(context.spec),
  )) {
    reserve(context, leading(TYPE.subHeading));
    draw(context, line, MARGINS.left, TYPE.subHeading, {
      bold: true,
      colour: AMBER,
      context: 'debug banner',
    });
    advance(context, leading(TYPE.subHeading));
  }
}

function drawSummary(context: Context, model: ReportModel): void {
  sectionHeading(context, 'section_summary');
  const { summary } = model;

  const verdict = inlineLabel(context, `verdict_${summary.verdict}` as LabelKey);
  reserve(context, leading(TYPE.subHeading) + 8);
  draw(context, verdict, MARGINS.left, TYPE.subHeading, {
    bold: true,
    colour:
      summary.verdict === 'not_acceptable'
        ? RED
        : summary.verdict === 'acceptable'
          ? GREEN
          : AMBER,
    context: 'verdict',
  });
  advance(context, leading(TYPE.subHeading) + 4);

  keyValue(context, 'field_total_equipment', summary.totalEquipment.toLocaleString('en-US'));
  keyValue(context, 'field_red', summary.red.toLocaleString('en-US'));
  keyValue(context, 'field_yellow', summary.yellow.toLocaleString('en-US'));
  keyValue(context, 'field_green', summary.green.toLocaleString('en-US'));

  for (const ground of summary.grounds) {
    const line = `${ground.count.toLocaleString('en-US')} — ${inlineLabel(context, ground.label)}`;
    reserve(context, leading(TYPE.body));
    draw(context, line, MARGINS.left + 8, TYPE.body, { colour: MUTED, context: 'grounds' });
    advance(context, leading(TYPE.body));
  }

  // The three evidence counts, always, zero included. A zero is the answer too: omitting the
  // figure would leave a reader unable to tell "nothing outstanding" from "we did not check".
  advance(context, 6);
  reserve(context, leading(TYPE.subHeading));
  draw(context, inlineLabel(context, 'evidence_heading'), MARGINS.left, TYPE.subHeading, {
    bold: true,
    context: 'evidence heading',
  });
  advance(context, leading(TYPE.subHeading));

  keyValue(
    context,
    'field_missing_references',
    summary.evidence.missingReferences.toLocaleString('en-US'),
  );
  keyValue(
    context,
    'field_missing_citations',
    summary.evidence.missingManufacturerCitations.toLocaleString('en-US'),
  );
  keyValue(context, 'field_draft_rules', summary.evidence.draftRuleCount.toLocaleString('en-US'));
  keyValue(context, 'field_render_mode', inlineLabel(context, `mode_${context.renderMode}` as LabelKey));
}

function drawSchedule(context: Context, model: ReportModel): void {
  sectionHeading(context, 'section_equipment_schedule');

  const columns: Column[] = [
    { header: 'field_equipment_id', width: 0.14 },
    { header: 'field_manufacturer', width: 0.12 },
    { header: 'field_model', width: 0.12 },
    { header: 'field_quantity', width: 0.06, align: 'right' },
    { header: 'field_manufacturer_dimensions', width: 0.18, align: 'right' },
    { header: 'field_design_footprint', width: 0.14, align: 'right' },
    { header: 'field_verification_status', width: 0.24 },
  ];

  const rows = model.equipmentSchedule.rows.map((row) => {
    const dimensions = row.manufacturerDimensions;
    const size =
      dimensions === null || dimensions.width === null || dimensions.depth === null
        ? '—'
        : `${dimensions.width} × ${dimensions.depth}${dimensions.height === null ? '' : ` × ${dimensions.height}`} mm`;

    const verified = row.verification.filter((entry) => entry.status === 'verified').length;
    const status = `${verified} / ${row.verification.length} ${labelPair('status_verified')[context.primary]}`;

    return [
      { text: row.equipmentId },
      { text: row.manufacturer ?? '—' },
      { text: `${row.model} (${row.catalogueVersion})` },
      { text: String(row.quantity) },
      { text: size },
      { text: `${row.designFootprint.width} × ${row.designFootprint.depth} mm` },
      { text: status, colour: verified === row.verification.length ? GREEN : AMBER },
    ];
  });

  if (rows.length === 0) {
    reserve(context, leading(TYPE.body));
    draw(context, inlineLabel(context, 'ground_no_equipment'), MARGINS.left, TYPE.body, {
      colour: MUTED,
      context: 'empty schedule',
    });
    advance(context, leading(TYPE.body));
    return;
  }

  table(context, columns, rows);
}

async function drawFloorPlan(context: Context, plan: FloorPlanSection): Promise<void> {
  sectionHeading(context, 'section_floor_plan');

  reserve(context, leading(TYPE.subHeading));
  draw(context, plan.levelName, MARGINS.left, TYPE.subHeading, {
    bold: true,
    context: 'level name',
  });
  advance(context, leading(TYPE.subHeading));

  if (plan.planStatus === 'uncalibrated') {
    // Never elided. A plan with no mapping looks like a measured drawing and is not. A level
    // with *no* drawing is a different case and gets no warning: its geometry is exact.
    const warning = inlineLabel(context, 'not_calibrated');
    for (const line of wrap(context.fonts, warning, TYPE.body, contentWidth(context.spec))) {
      reserve(context, leading(TYPE.body));
      draw(context, line, MARGINS.left, TYPE.body, { colour: AMBER, context: 'uncalibrated' });
      advance(context, leading(TYPE.body));
    }
  }

  await drawPlan(context, plan);

  if (plan.drawing) {
    keyValue(context, 'field_drawing_file', plan.drawing.sourceFileName);
    keyValue(
      context,
      'field_drawing_pixels',
      `${plan.drawing.pixelWidth} × ${plan.drawing.pixelHeight} px`,
    );
  } else {
    keyValue(context, 'field_drawing_file', inlineLabel(context, 'no_drawing'));
  }
  if (plan.calibration) {
    keyValue(context, 'field_scale', `${plan.calibration.millimetresPerPixel} mm/px`);
    keyValue(context, 'field_calibration_method', plan.calibration.method);
  }
  if (plan.mapping) {
    keyValue(
      context,
      'field_origin',
      `${plan.mapping.originPixel.x}, ${plan.mapping.originPixel.y} px`,
    );
    keyValue(context, 'field_rotation', `${(plan.mapping.rotation / 1_000).toFixed(2)}°`);
  }

  if (plan.placements.length > 0) {
    table(
      context,
      [
        { header: 'field_number', width: 0.07, align: 'right' },
        { header: 'field_label', width: 0.2 },
        { header: 'field_model', width: 0.18 },
        { header: 'field_position', width: 0.22, align: 'right' },
        { header: 'field_rotation', width: 0.11, align: 'right' },
        { header: 'field_room', width: 0.22 },
      ],
      plan.placements.map((row) => [
        { text: String(row.number), bold: true },
        { text: row.label },
        { text: row.model },
        { text: `${row.position.x}, ${row.position.y} mm` },
        { text: `${row.rotationDegrees}°` },
        { text: row.room ?? '—' },
      ]),
    );
  }

  if (plan.rooms.length > 0) {
    table(
      context,
      [
        { header: 'field_room', width: 0.4 },
        { header: 'field_function', width: 0.3 },
        { header: 'field_area', width: 0.3, align: 'right' },
      ],
      plan.rooms.map((room) => [
        { text: room.name },
        { text: room.function },
        { text: `${room.areaSquareMetres} m²` },
      ]),
    );
  }

  if (plan.obstructions.length > 0) {
    table(
      context,
      [
        { header: 'field_label', width: 0.4 },
        { header: 'field_obstruction_type', width: 0.3 },
        { header: 'field_area', width: 0.3, align: 'right' },
      ],
      plan.obstructions.map((obstruction) => [
        { text: obstruction.label },
        { text: obstruction.obstructionType },
        { text: `${obstruction.areaSquareMetres} m²` },
      ]),
    );
  }
}

function drawValidation(context: Context, model: ReportModel): void {
  for (const section of model.validation) {
    sectionHeading(context, 'section_validation');
    reserve(context, leading(TYPE.subHeading));
    draw(context, section.levelName, MARGINS.left, TYPE.subHeading, {
      bold: true,
      context: 'level name',
    });
    advance(context, leading(TYPE.subHeading));

    if (section.findings.length === 0) {
      const empty = inlineLabel(context, 'no_findings');
      reserve(context, leading(TYPE.body));
      draw(context, empty, MARGINS.left, TYPE.body, { colour: MUTED, context: 'no findings' });
      advance(context, leading(TYPE.body));
      continue;
    }

    table(
      context,
      [
        { header: 'field_severity', width: 0.07 },
        { header: 'field_number', width: 0.05, align: 'right' },
        { header: 'field_rule_name', width: 0.15 },
        { header: 'field_finding', width: 0.31 },
        { header: 'field_applied_threshold', width: 0.1, align: 'right' },
        { header: 'field_threshold_source', width: 0.14 },
        { header: 'field_measured', width: 0.09, align: 'right' },
        { header: 'field_verification_status', width: 0.09 },
      ],
      section.findings.map((row) => {
        const pair = reasonPair(row.reasonCode, row.reasonParams);
        const caveat = row.caveatCode ? reasonPair(row.caveatCode, {}) : null;
        const finding = [
          `${row.reasonCode}  ${pair[context.primary]}`,
          pair[context.secondary],
          ...(caveat ? [caveat[context.primary], caveat[context.secondary]] : []),
        ].join('\n');

        return [
          { text: row.severity, bold: true, colour: SEVERITY_COLOUR[row.severity] },
          { text: row.placementNumbers.join(', ') || '—' },
          { text: `${row.ruleName[context.primary]} / ${row.ruleName[context.secondary]}` },
          // Newlines are not honoured by `wrap`, so the sentence is joined with a space and
          // allowed to wrap naturally. Keeping both languages in one cell keeps a finding on
          // one row, which is what makes the table scannable.
          { text: finding.replace(/\n/g, '  ·  ') },
          {
            text:
              row.appliedThreshold === null
                ? '—'
                : `${row.appliedThreshold} ${row.unit}`,
          },
          { text: row.thresholdSource ?? inlineLabel(context, 'no_threshold_source') },
          { text: row.measured === null ? '—' : `${row.measured} ${row.unit}` },
          {
            text: labelPair(row.verification === 'verified' ? 'status_verified' : 'status_draft')[
              context.primary
            ],
            colour: row.verification === 'verified' ? GREEN : AMBER,
          },
        ];
      }),
    );
  }
}

function drawChecklist(context: Context, model: ReportModel): void {
  sectionHeading(context, 'section_checklist');

  for (const category of model.checklist.categories) {
    reserve(context, leading(TYPE.subHeading) + leading(TYPE.small));
    draw(
      context,
      `${category.title[context.primary]} / ${category.title[context.secondary]}`,
      MARGINS.left,
      TYPE.subHeading,
      { bold: true, context: `checklist ${category.id}` },
    );
    advance(context, leading(TYPE.subHeading));

    if (category.items.length === 0) {
      draw(context, inlineLabel(context, 'checklist_empty'), MARGINS.left + 8, TYPE.body, {
        colour: MUTED,
        context: 'checklist empty',
      });
      advance(context, leading(TYPE.body));
      continue;
    }

    for (const item of category.items) {
      const action = inlineLabel(context, item.action);
      reserve(context, leading(TYPE.small));
      // The checkbox is **drawn**, not typeset. U+2610 BALLOT BOX was the obvious choice and
      // Pretendard has no glyph for it — the missing-glyph guard caught it on the first
      // render, which is what the guard is for. A vector square also prints crisply at any
      // size and cannot depend on a font's symbol coverage.
      const box = TYPE.small * 0.8;
      context.cursor.page.drawRectangle({
        x: MARGINS.left + 8,
        y: context.cursor.y - box,
        width: box,
        height: box,
        borderWidth: 0.5,
        borderColor: MUTED,
      });
      draw(context, action, MARGINS.left + 8 + box + 4, TYPE.small, {
        colour: MUTED,
        context: 'checklist action',
      });
      advance(context, leading(TYPE.small));

      const pair = item.text ?? (item.reasonCode ? reasonPair(item.reasonCode, item.reasonParams) : null);
      if (pair) bilingualParagraph(context, pair.ko, pair.en, 20);
      advance(context, 2);
    }
    advance(context, 4);
  }
}

function drawDatasheets(context: Context, model: ReportModel): void {
  sectionHeading(context, 'section_datasheets');

  for (const sheet of model.datasheets) {
    reserve(context, leading(TYPE.subHeading));
    draw(
      context,
      `${sheet.model} — ${sheet.manufacturer ?? '—'} (${sheet.catalogueVersion})`,
      MARGINS.left,
      TYPE.subHeading,
      { bold: true, context: `datasheet ${sheet.equipmentId}` },
    );
    advance(context, leading(TYPE.subHeading) + 2);

    // Three blocks, never merged: manufacturer data, the planning footprint, draft data.
    if (sheet.manufacturer_data.length > 0) {
      blockHeading(context, 'block_manufacturer_data', GREEN);
      datasheetBlocks(context, sheet.manufacturer_data);
    }

    blockHeading(context, 'block_design_footprint', PLAN_EQUIPMENT);
    reserve(context, leading(TYPE.small));
    draw(context, inlineLabel(context, 'planning_decision'), MARGINS.left + 8, TYPE.small, {
      colour: MUTED,
      context: 'planning note',
    });
    advance(context, leading(TYPE.small));
    for (const field of sheet.designFootprint) {
      keyValueIndented(context, field.label, field.value);
    }

    if (sheet.draft_data.length > 0) {
      blockHeading(context, 'block_draft_data', AMBER);
      datasheetBlocks(context, sheet.draft_data);
    }
    advance(context, 6);
  }
}

function blockHeading(context: Context, key: LabelKey, colour: ReturnType<typeof rgb>): void {
  reserve(context, leading(TYPE.body) + 4);
  draw(context, inlineLabel(context, key), MARGINS.left + 4, TYPE.body, {
    bold: true,
    colour,
    context: `block ${key}`,
  });
  advance(context, leading(TYPE.body));
}

function keyValueIndented(context: Context, key: LabelKey, value: string | null): void {
  const line = `${inlineLabel(context, key)}: ${value ?? inlineLabel(context, 'not_supplied')}`;
  for (const part of wrap(context.fonts, line, TYPE.body, contentWidth(context.spec) - 16)) {
    reserve(context, leading(TYPE.body));
    draw(context, part, MARGINS.left + 16, TYPE.body, { context: `field ${key}` });
    advance(context, leading(TYPE.body));
  }
}

function drawStandards(context: Context, model: ReportModel): void {
  sectionHeading(context, 'section_standards');

  keyValue(
    context,
    'field_rule_set',
    `${model.standards.ruleSetId} v${model.standards.ruleSetVersion}`,
  );

  table(
    context,
    [
      { header: 'field_rule_id', width: 0.18 },
      { header: 'field_rule_name', width: 0.22 },
      { header: 'field_category', width: 0.12 },
      { header: 'field_threshold', width: 0.1, align: 'right' },
      { header: 'field_verification_status', width: 0.1 },
      { header: 'field_document', width: 0.19 },
      { header: 'field_finding_count', width: 0.09, align: 'right' },
    ],
    model.standards.rules.map((rule) => [
      { text: rule.ruleId },
      { text: `${rule.ruleName[context.primary]} / ${rule.ruleName[context.secondary]}` },
      {
        text: labelPair(rule.category === 'clearance' ? 'category_clearance' : 'category_collision')[
          context.primary
        ],
      },
      { text: rule.threshold === null ? '—' : `${rule.threshold} ${rule.unit}` },
      {
        text: labelPair(rule.status === 'verified' ? 'status_verified' : 'status_draft')[
          context.primary
        ],
        colour: rule.status === 'verified' ? GREEN : AMBER,
      },
      {
        text:
          [rule.document, rule.revision, rule.section].filter(Boolean).join(' · ') ||
          labelPair('no_citation')[context.primary],
      },
      { text: String(rule.findingCount) },
    ]),
  );
}

function drawNotice(context: Context, model: ReportModel): void {
  // The reserved space is claimed here: if the notice will not fit on the current page it
  // gets a page of its own rather than being clipped.
  if (context.cursor.y - context.noticeHeight < MARGINS.bottom) newPage(context);

  sectionHeading(context, 'section_notice');

  const { liability, caveats } = model.notice;
  bilingualParagraph(context, liability.ko, liability.en);
  advance(context, 6);

  for (const caveat of caveats) {
    bilingualParagraph(context, caveat.ko, caveat.en);
    advance(context, 4);
  }
}

function drawProvenance(context: Context, model: ReportModel): void {
  const { provenance } = model;
  reserve(context, leading(TYPE.small) * 3 + SECTION_GAP);
  advance(context, SECTION_GAP);

  const lines = [
    `${labelPair('field_report_version')[context.primary]} ${provenance.reportVersion} · ${labelPair('field_document_version')[context.primary]} ${provenance.documentVersion} · ${labelPair('field_result_version')[context.primary]} ${provenance.evaluationResultVersion}`,
    `${labelPair('field_rule_set')[context.primary]} ${provenance.ruleSetId} v${provenance.ruleSetVersion}`,
    `${labelPair('field_generated_at')[context.primary]} ${provenance.generatedAt} · MFD ${provenance.mfdVersion}`,
  ];

  for (const line of lines) {
    draw(context, line, MARGINS.left, TYPE.small, { colour: MUTED, context: 'provenance' });
    advance(context, leading(TYPE.small));
  }
}
