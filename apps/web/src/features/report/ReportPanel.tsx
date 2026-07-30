import { useState } from 'react';

import { renderHtml, renderJson } from '@mfd/report-engine';

import { timestamp } from '@/editor/clock';
import { useEditor } from '@/editor/useEditor';

import { loadReportFonts } from './fonts';
import { useReportModel } from './useReport';

/**
 * The report screen: preview, then download.
 *
 * ## Preview before download, deliberately
 *
 * A twelve-page PDF that has to be opened to be checked is a twelve-page PDF nobody checks.
 * The preview is the **same renderer** as the HTML output and shows the same sections in the
 * same order from the same model, so what an engineer approves here is what the customer
 * receives — the PDF differs in typography, not in content.
 *
 * ## Why the preview is `dangerouslySetInnerHTML`
 *
 * The renderer produces a complete document, sections and print styling together, because an
 * HTML report saved as a file has to carry its own appearance. Rebuilding that as React
 * components would mean two renderers for one document, which is exactly the divergence the
 * shared renderer exists to prevent. The content is the engineer's own project data, and every
 * value passes through the renderer's escaping — see `render/html.ts`.
 */

function download(fileName: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function slug(value: string): string {
  return value.trim().replace(/[^\w가-힣-]+/g, '-').replace(/^-|-$/g, '') || 'report';
}

export function ReportPanel({ onClose }: { readonly onClose: () => void }) {
  const { state } = useEditor();
  const [status, setStatus] = useState<'idle' | 'working' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  // The preview is a pure function of the document, so it does not re-render on a clock. The
  // downloads stamp the real time, which is what a signed document needs.
  const model = useReportModel(state.doc.document.project.updatedAt);
  const html = renderHtml(model);

  const baseName = `${slug(state.doc.document.project.name)}-report`;

  async function onDownloadPdf() {
    setStatus('working');
    setMessage(null);
    try {
      // Its own entry point, imported here rather than at the top of the file, and the reason
      // is measurable: pdf-lib is ~1.2 MB. Importing it statically took the main bundle from
      // 679 kB to 1,878 kB — every user paying for a PDF library on first paint, including the
      // ones who never generate a report. Fetched on the first click, alongside the fonts.
      const [{ renderPdf }, fonts] = await Promise.all([
        import('@mfd/report-engine/pdf'),
        loadReportFonts(),
      ]);
      const stamped = { ...model, generatedAt: timestamp() };
      const bytes = await renderPdf(stamped, { fonts });
      download(`${baseName}.pdf`, bytes as unknown as BlobPart, 'application/pdf');
      setStatus('idle');
    } catch (cause) {
      // Named, not swallowed. The most likely failure is a character the embedded font cannot
      // draw, and the engine's message says which character — that is the whole point of it
      // refusing rather than drawing a blank box.
      setStatus('error');
      setMessage(cause instanceof Error ? cause.message : 'The report could not be generated.');
    }
  }

  function onDownloadHtml() {
    download(`${baseName}.html`, `<!doctype html><meta charset="utf-8">${html}`, 'text/html');
  }

  function onDownloadJson() {
    download(`${baseName}.json`, renderJson({ ...model, generatedAt: timestamp() }), 'application/json');
  }

  return (
    <section
      data-testid="report-panel"
      className="absolute inset-0 z-20 flex flex-col bg-canvas"
      aria-label="Installation review report"
    >
      <header className="flex items-center gap-2 border-b border-edge bg-chrome-raised px-3 py-2">
        <h2 className="text-sm font-semibold">
          설치 검토 보고서 <span className="text-ink-faint">/ Installation Review Report</span>
        </h2>

        <div
          data-testid="report-verdict-badge"
          data-verdict={model.summary.verdict}
          className={`ml-2 rounded border px-1.5 py-0.5 text-[10px] font-medium ${
            model.summary.verdict === 'not_acceptable'
              ? 'border-red-500/60 bg-red-500/10 text-red-200'
              : model.summary.verdict === 'acceptable'
                ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-200'
                : 'border-amber-500/60 bg-amber-500/10 text-amber-200'
          }`}
        >
          {model.summary.red} RED · {model.summary.yellow} YELLOW · {model.summary.green} GREEN
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            data-testid="report-download-pdf"
            disabled={status === 'working'}
            className="rounded border border-accent bg-accent-soft px-2 py-0.5 text-[11px] text-ink disabled:opacity-50"
            onClick={() => void onDownloadPdf()}
          >
            {status === 'working' ? 'Generating…' : 'PDF'}
          </button>
          <button
            type="button"
            data-testid="report-download-html"
            className="rounded border border-edge px-2 py-0.5 text-[11px] text-ink-muted hover:border-accent hover:text-ink"
            onClick={onDownloadHtml}
          >
            HTML
          </button>
          <button
            type="button"
            data-testid="report-download-json"
            className="rounded border border-edge px-2 py-0.5 text-[11px] text-ink-muted hover:border-accent hover:text-ink"
            onClick={onDownloadJson}
          >
            JSON
          </button>
          <button
            type="button"
            data-testid="report-close"
            className="ml-2 rounded border border-edge px-2 py-0.5 text-[11px] text-ink-muted hover:border-accent hover:text-ink"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </header>

      {message && (
        <p
          data-testid="report-error"
          className="border-b border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200"
        >
          {message}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto bg-white p-6">
        {/* One renderer for the preview and the file, so the two cannot disagree — see the
            note at the top of this file. */}
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </section>
  );
}
