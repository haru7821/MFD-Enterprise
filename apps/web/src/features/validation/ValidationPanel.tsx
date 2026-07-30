import type { Placement } from '@mfd/document-model';
import type { EvaluationReport, EvaluationResult } from '@mfd/rule-engine';
import { renderReason } from '@mfd/rule-engine';
import { dialysisRuleSet } from '@mfd/rule-engine/rules';

import { ResultBadge } from './ResultBadge';

/** How the applied threshold was arrived at, in words the engineer can act on. */
function thresholdNote(result: EvaluationResult): string | null {
  if (result.appliedValue === null) return null;

  const origin =
    result.thresholdOrigin === 'rule'
      ? 'from the rule'
      : result.thresholdOrigin === 'equipment'
        ? 'from the equipment record'
        : '';

  return `${result.appliedValue} ${result.unit} required ${origin}`.trim();
}

/** The clause a finding rests on, or an explicit statement that there is none. */
function sourceNote(result: EvaluationResult): string {
  const { document, revision, section } = result.source;
  if (!document) return 'No source document — provisional';

  return [document, revision, section].filter(Boolean).join(' · ');
}

function ResultRow({
  result,
  subjects,
}: {
  readonly result: EvaluationResult;
  readonly subjects: string;
}) {
  const rule = dialysisRuleSet.get(result.ruleId);
  const threshold = thresholdNote(result);

  return (
    <li
      data-testid="validation-result"
      data-level={result.level}
      className="border-b border-edge/60 px-3 py-2 last:border-b-0"
    >
      <div className="flex items-start gap-2">
        <ResultBadge level={result.level} />
        <div className="min-w-0">
          {/* Which machine, before what is wrong with it. Twenty identical
              findings with no subject are twenty findings nobody can act on. */}
          <p className="text-[12px] font-medium text-ink">{subjects}</p>
          {/*
            Bilingual, in the same order the report uses: Korean first, English beneath.
            The panel and the report must read alike — an engineer who checks the screen
            and then sends the PDF should not find the two describing a finding
            differently, and both now compose from `reasonCode` rather than from prose.
          */}
          <p className="mt-0.5 text-[12px] leading-snug text-ink-muted">
            {rule ? rule.description.ko : result.ruleId}
          </p>
          {rule && (
            <p className="text-[11px] leading-snug text-ink-muted">{rule.description.en}</p>
          )}
          <p className="mt-1 text-[11px] leading-snug text-ink-faint">
            {renderReason('ko', result.reasonCode, result.reasonParams)}
          </p>
          <p className="text-[11px] leading-snug text-ink-faint">{result.reason}</p>
          {result.caveatCode && (
            <p
              data-testid="result-caveat"
              className="mt-1 text-[11px] leading-snug text-amber-300/90"
            >
              {renderReason('ko', result.caveatCode, {})}
              <br />
              {renderReason('en', result.caveatCode, {})}
            </p>
          )}

          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-ink-faint">
            {threshold && <span>{threshold}</span>}
            {result.measured !== null && (
              <span>
                {result.measured} {result.unit} measured
              </span>
            )}
            <span
              className={result.dataStatus === 'draft' ? 'text-amber-400/80' : undefined}
              title="Specification section 6 requires every rule to carry source information."
            >
              {sourceNote(result)}
            </span>
          </div>
        </div>
      </div>
    </li>
  );
}

/**
 * The findings list.
 *
 * Every row states the requirement, what was measured, the threshold applied and
 * **where the threshold came from**. A TS engineer asked "why 1200 mm?" in front of
 * a customer has to be able to answer from this panel.
 */
export function ValidationPanel({
  report,
  placements,
}: {
  readonly report: EvaluationReport;
  readonly placements: readonly Placement[];
}) {
  const labelOf = new Map(placements.map((placement) => [placement.id, placement.label]));
  const subjectsOf = (result: EvaluationResult) =>
    result.placementIds.map((id) => labelOf.get(id) ?? id).join(' · ') || 'Rule set';

  return (
    <aside
      data-testid="validation-panel"
      className="flex w-80 shrink-0 flex-col border-l border-edge bg-chrome"
      aria-label="Installation requirements"
    >
      <header className="border-b border-edge px-3 py-2">
        <h2 className="text-xs font-semibold tracking-wide text-ink uppercase">
          Installation check
        </h2>
        <div className="mt-1 flex gap-3 font-mono text-[11px] tabular-nums">
          <span className="text-red-300">{report.counts.RED} red</span>
          <span className="text-amber-300">{report.counts.YELLOW} yellow</span>
          <span className="text-emerald-300">{report.counts.GREEN} green</span>
        </div>
        <p className="mt-1 text-[10px] text-ink-faint">
          Rule set {report.ruleSetId} v{report.ruleSetVersion}
        </p>
      </header>

      {report.hasDraftInputs && (
        <p
          data-testid="provisional-warning"
          className="border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-amber-200"
        >
          <strong className="font-semibold">Provisional.</strong> Findings below rest on
          placeholder figures, not the installation manual. Nothing here can be treated as
          verified.
        </p>
      )}

      <ul className="min-h-0 flex-1 overflow-y-auto">
        {report.results.length === 0 ? (
          <li className="px-3 py-4 text-[11px] leading-snug text-ink-faint">
            No requirements evaluated. Place equipment to run the rule set.
          </li>
        ) : (
          report.results.map((result) => (
            <ResultRow
              key={`${result.ruleId}-${result.placementIds.join('-')}`}
              result={result}
              subjects={subjectsOf(result)}
            />
          ))
        )}
      </ul>
    </aside>
  );
}
