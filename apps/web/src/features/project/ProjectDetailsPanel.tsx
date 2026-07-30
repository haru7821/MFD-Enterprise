import {
  REPORT_RENDER_MODES,
  type ProjectDetails,
  type ReportRenderMode,
  projectDetailsOf,
} from '@mfd/document-model';

import { now } from '@/editor/clock';
import { useEditor } from '@/editor/useEditor';

/**
 * The project's identity — hospital, site, contact, engineer.
 *
 * Added in Sprint 5 because the report's cover page is built from these five fields and
 * nothing in the editor could set them. The schema has carried `customer` and `reviewedBy`
 * since Sprint 4, so a hospital name was always *storable*; there was simply no way to type
 * one, which would have meant a blank cover page on every real report.
 *
 * Undo behaves the way it does for room names: the five fields share one merge key, so a
 * typing session is one undo step, and the seal happens on blur rather than per keystroke.
 */

const FIELDS: readonly {
  readonly key: keyof ProjectDetails;
  readonly ko: string;
  readonly en: string;
  readonly placeholder: string;
}[] = [
  { key: 'name', ko: '프로젝트', en: 'Project', placeholder: '4F Dialysis Unit' },
  { key: 'hospital', ko: '병원', en: 'Hospital', placeholder: '서울 하늘병원' },
  { key: 'site', ko: '현장', en: 'Site', placeholder: '본관 4층' },
  { key: 'contact', ko: '고객 담당자', en: 'Customer contact', placeholder: '김민수 시설팀장' },
  { key: 'reviewedBy', ko: 'TS 엔지니어', en: 'TS engineer', placeholder: 'A. Engineer' },
];

/** Bilingual, matching the report's own wording for the same three modes. */
const MODE_LABELS: Readonly<Record<ReportRenderMode, string>> = {
  vector: '벡터 도면만 / Vector only',
  vector_raster: '벡터 + 원본 스캔 / Vector over the scan',
  raster: '원본 스캔만 (디버그) / Scan only (debug)',
};

export function ProjectDetailsPanel() {
  const { state, dispatch } = useEditor();
  const details = projectDetailsOf(state.doc.document);
  const mode = state.doc.document.project.settings.reportRenderMode;

  function set(key: keyof ProjectDetails, value: string) {
    dispatch({
      type: 'project/setDetails',
      details: { ...details, [key]: value },
      at: now(),
    });
  }

  return (
    <section className="border-b border-edge px-3 py-2" aria-label="Project details">
      <header className="mb-1.5">
        <h2 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">
          프로젝트 <span className="normal-case">/ Project</span>
        </h2>
        <p className="mt-0.5 text-[10px] leading-snug text-ink-faint">
          보고서 표지에 인쇄됩니다 · Printed on the report cover
        </p>
      </header>

      <div className="flex flex-col gap-1">
        {FIELDS.map((field) => (
          <label key={field.key} className="flex flex-col gap-0.5">
            <span className="text-[10px] text-ink-faint">
              {field.ko} <span className="text-ink-faint/70">/ {field.en}</span>
            </span>
            <input
              type="text"
              data-testid={`project-detail-${field.key}`}
              value={details[field.key]}
              placeholder={field.placeholder}
              onChange={(event) => set(field.key, event.target.value)}
              // Sealed on blur, so one editing session is one undo step. Doing it per
              // keystroke would make undo useless for a form.
              onBlur={() => dispatch({ type: 'history/seal' })}
              className="w-full rounded border border-edge bg-canvas px-1.5 py-0.5 text-[11px] text-ink placeholder:text-ink-faint/60 focus:border-accent focus:outline-none"
            />
          </label>
        ))}
      </div>

      {/*
        The drawing mode. A stored project setting rather than an option on the download
        dialogue, because it changes what the document *is* when it reaches a hospital: the same
        project issued twice in different modes would differ with nothing recording which was
        intended.
      */}
      <label className="mt-2 flex flex-col gap-0.5">
        <span className="text-[10px] text-ink-faint">
          도면 표시 방식 <span className="text-ink-faint/70">/ Drawing mode</span>
        </span>
        <select
          data-testid="report-render-mode"
          value={mode}
          onChange={(event) =>
            dispatch({
              type: 'project/setRenderMode',
              mode: event.target.value as ReportRenderMode,
              at: now(),
            })
          }
          className="w-full rounded border border-edge bg-canvas px-1.5 py-0.5 text-[11px] text-ink focus:border-accent focus:outline-none"
        >
          {REPORT_RENDER_MODES.map((option) => (
            <option key={option} value={option}>
              {MODE_LABELS[option]}
            </option>
          ))}
        </select>
      </label>
      {mode === 'raster' && (
        <p
          data-testid="render-mode-debug-warning"
          className="mt-1 rounded-sm border border-amber-500/50 bg-amber-500/10 px-1.5 py-1 text-[10px] leading-snug text-amber-300"
        >
          디버그 모드 — 검토 결과가 도면에 그려지지 않습니다 · Debug mode — the assessed layout is
          not drawn
        </p>
      )}

      {/*
        The date and the MFD version are not editable, and that is deliberate: the report's
        date is when it was generated and the version is which build produced it. Both are
        facts about the document rather than fields somebody fills in, and a report whose
        date could be typed is a report whose date means nothing.
      */}
      <p className="mt-1.5 text-[10px] leading-snug text-ink-faint">
        작성일과 버전은 보고서 생성 시 자동 기록됩니다 · Date and version are stamped when the
        report is generated
      </p>
    </section>
  );
}
