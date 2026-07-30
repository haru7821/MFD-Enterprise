import { useMemo } from 'react';

import { catalog } from '@mfd/object-library/catalog';
import { type ReportModel, buildReport } from '@mfd/report-engine';
import { dialysisChecklistTemplate } from '@mfd/report-engine/checklists';
import { dialysisRuleSet } from '@mfd/rule-engine/rules';

import { APP_VERSION } from '@/app/version';
import { useEditor } from '@/editor/useEditor';

/**
 * Build the report model for the whole project.
 *
 * ## Why this is separate from `useEvaluation`
 *
 * `useEvaluation` evaluates the **active level**, on every state change, to colour the canvas.
 * The report needs **every** level — a report that silently covered whichever floor happened
 * to be selected would omit a floor without saying so.
 *
 * Those are different costs. Evaluation is roughly 6 ms per level at fifty machines: fine for
 * a report, not fine to run on every pointer move across a ten-storey project. So there are
 * two call sites and one `evaluate`, rather than one call site doing the expensive thing
 * always.
 *
 * `generatedAt` comes from the document's `updatedAt` rather than a clock, so the model is a
 * pure function of the document and the preview does not re-render every second. The
 * *download* stamps the real time — see `ReportActions`.
 */
export function useReportModel(generatedAt: string): ReportModel {
  const { state } = useEditor();
  const document = state.doc.document;

  return useMemo(
    () =>
      buildReport({
        document,
        catalog,
        ruleSet: dialysisRuleSet,
        checklistTemplate: dialysisChecklistTemplate,
        generatedAt,
        mfdVersion: APP_VERSION,
      }),
    [document, generatedAt],
  );
}
