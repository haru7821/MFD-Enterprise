import { type ProjectDetails, projectDetailsOf } from '@mfd/document-model';

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

export function ProjectDetailsPanel() {
  const { state, dispatch } = useEditor();
  const details = projectDetailsOf(state.doc.document);

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
