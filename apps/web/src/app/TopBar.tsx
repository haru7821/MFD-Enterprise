import { useRef, useState } from 'react';

import {
  DocumentValidationError,
  UnsupportedDocumentVersionError,
  loadDocument,
  saveDocument,
  suggestedFileName,
} from '@mfd/document-model';

import { timestamp } from '@/editor/clock';
import { useEditor } from '@/editor/useEditor';

/**
 * Title bar: project identity, and the two file operations.
 *
 * Save and open work on a `.mfd.json` file the engineer keeps wherever they keep
 * project files. There is no server yet, and pretending otherwise — an autosave that
 * quietly went nowhere — would be worse than a visible download.
 */

function downloadText(fileName: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function TopBar() {
  const { state, dispatch } = useEditor();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const project = state.doc.document;

  function onSave() {
    try {
      setError(null);
      // Validated on the way out as well as on the way in: an editor bug that
      // produced an invalid document would otherwise be discovered by the engineer
      // who tried to reopen the file, long after the state that caused it was gone.
      downloadText(
        suggestedFileName(project),
        saveDocument(project, { now: timestamp(), pretty: true }),
      );
    } catch (cause) {
      setError(
        cause instanceof DocumentValidationError
          ? 'This project failed validation and was not saved.'
          : 'This project could not be saved.',
      );
    }
  }

  async function onOpen(file: File | undefined) {
    if (!file) return;
    try {
      setError(null);
      dispatch({ type: 'document/load', document: loadDocument(await file.text()) });
    } catch (cause) {
      setError(
        cause instanceof UnsupportedDocumentVersionError
          ? cause.message
          : cause instanceof DocumentValidationError
            ? `${file.name} is not a valid MFD-E project.`
            : `Could not read ${file.name}.`,
      );
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <header className="flex items-center gap-3 border-b border-edge bg-chrome-raised px-3 py-2">
      <div className="flex items-center gap-2">
        <span
          className="flex h-6 w-6 items-center justify-center rounded bg-accent text-[11px] font-bold text-canvas"
          aria-hidden="true"
        >
          M
        </span>
        <span className="text-sm font-semibold tracking-tight">MFD-E</span>
      </div>

      <div className="h-4 w-px bg-edge" aria-hidden="true" />

      <span className="text-sm text-ink-muted" data-testid="project-name">
        {project.project.name}
      </span>

      <div className="ml-3 flex items-center gap-1.5">
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          data-testid="project-file-input"
          onChange={(event) => void onOpen(event.target.files?.[0])}
        />
        <button
          type="button"
          data-testid="open-project"
          className="rounded border border-edge px-1.5 py-0.5 text-[11px] text-ink-muted hover:border-accent hover:text-ink"
          onClick={() => fileRef.current?.click()}
        >
          Open
        </button>
        <button
          type="button"
          data-testid="save-project"
          className="rounded border border-edge px-1.5 py-0.5 text-[11px] text-ink-muted hover:border-accent hover:text-ink"
          onClick={onSave}
        >
          Save
        </button>
        <button
          type="button"
          data-testid="new-project"
          className="rounded border border-edge px-1.5 py-0.5 text-[11px] text-ink-faint hover:border-accent hover:text-ink"
          onClick={() => dispatch({ type: 'document/new', now: timestamp() })}
        >
          New
        </button>
      </div>

      {error && (
        <span
          data-testid="project-error"
          className="rounded border border-red-500/50 bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-200"
        >
          {error}
        </span>
      )}

      <span className="ml-auto font-mono text-[11px] text-ink-faint">
        v0.4 Alpha · Sprint 4 — plan workflow &amp; spatial model
      </span>
    </header>
  );
}
