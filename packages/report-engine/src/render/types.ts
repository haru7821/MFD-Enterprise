import type { Language } from '@mfd/rule-engine';

import type { ReportModel } from '../model';

/**
 * The renderer boundary.
 *
 * Owner requirement: the engine must support PDF, DOCX, HTML and JSON **without changing
 * business logic**. This interface is where that requirement is cashed in — a renderer
 * receives a finished `ReportModel` and returns bytes or text. It cannot decide a verdict,
 * cannot re-derive a status, and cannot reorder the sections.
 *
 * | Format | State | File |
 * | --- | --- | --- |
 * | JSON | Implemented | ./json.ts |
 * | HTML | Implemented — also the editor's preview | ./html.ts |
 * | PDF | Implemented | ./pdf.ts |
 * | DOCX | **Not implemented.** See the note below | — |
 *
 * ## Why DOCX is absent rather than stubbed
 *
 * A `renderDocx` that threw would be a function callers could reach and a promise the
 * package appears to keep. There is no stub: adding DOCX means adding a file that satisfies
 * this interface, and the interface is the commitment. What the requirement asks for is that
 * such a file need not touch `build.ts`, and that is what the JSON renderer demonstrates —
 * it is a `JSON.stringify` of the model, which is only possible because the model already
 * holds every decision.
 *
 * ## Language
 *
 * A renderer takes the language pair, not a language. The report is bilingual: both
 * languages appear in one document, so "which language" is not a parameter. `primary` exists
 * only to say which one leads — Korean by default, because the report is handed to a Korean
 * hospital, and it is one constant to change.
 */

export interface RenderOptions {
  /** Which language leads where two are stacked. */
  readonly primary: Language;
  readonly secondary: Language;
}

export const DEFAULT_RENDER_OPTIONS: RenderOptions = { primary: 'ko', secondary: 'en' };

/** Text output: JSON, HTML. */
export type TextRenderer = (model: ReportModel, options?: RenderOptions) => string;

/** Binary output: PDF. Async because font embedding is. */
export type BinaryRenderer = (
  model: ReportModel,
  options: PdfRenderOptions,
) => Promise<Uint8Array>;

export interface FontBytes {
  readonly regular: Uint8Array;
  readonly bold: Uint8Array;
}

export interface PdfRenderOptions extends Partial<RenderOptions> {
  /**
   * The font files, as bytes.
   *
   * Passed in rather than read, because this package never touches a filesystem. The
   * browser fetches them through a dynamic import; a server would read them from disk. The
   * package is identical in both.
   */
  readonly fonts: FontBytes;
  /** A4 portrait unless a caller says otherwise. */
  readonly pageSize?: 'A4' | 'A3';
}
