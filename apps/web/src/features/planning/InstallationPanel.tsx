import type { PlanService, SourcedNumber, SourcedRange } from '@mfd/ai-contract';
import { catalog } from '@mfd/object-library/catalog';
import { dialysisChecklistTemplate } from '@mfd/report-engine/checklists';

import { activeLevel } from '@/editor/editorState';
import { useEditor } from '@/editor/useEditor';
import { useEvaluation } from '@/features/validation/useEvaluation';

import { runPlanner } from './runPlanner';

/**
 * The installation planning panel — the owner's Sprint 6 § 8.
 *
 * > *"Add an Installation Planning panel showing: installation steps, required tools, required
 * > materials, connections, risks, estimated duration."*
 *
 * ## Every figure says what it is
 *
 * The panel's one job beyond listing is to make an *unknown* legible. Duration and manpower are
 * unknown on every project today — no labour rate has been supplied — and the panel prints the word
 * with the file that would answer it, rather than a dash. A dash reads as a layout choice; "Unknown
 * · sequence_set:equipment_set.duration" reads as a thing somebody can go and fix.
 *
 * ## Planning is not a background effect
 *
 * The plan is produced when an engineer asks for it, and it stays until they ask again. Deriving it
 * on every keystroke would be cheap enough, and wrong: a plan is a thing an engineer takes to site,
 * and one that silently rewrote itself as the drawing moved would be a different document each time
 * they looked at it.
 */

const SERVICE_LABELS: Record<PlanService, string> = {
  power: 'Power',
  ro_water: 'RO water',
  drain: 'Drain',
};

const REFUSALS = {
  nothing_placed: 'Nothing is placed on this level yet — there is no installation to plan.',
  proposals_pending:
    'Apply or discard the layout proposals first. A plan is made from the layout you approved, not from one you are still deciding about.',
} as const;

const BLOCKER_TEXT: Record<string, string> = {
  open_violation: 'A rule violation is open',
  missing_reference_point: 'No reference point placed',
  missing_prerequisite: 'A prerequisite is missing',
  uncalibrated_level: 'The plan drawing is not calibrated',
};

export function InstallationPanel() {
  const { state, dispatch } = useEditor();
  const level = activeLevel(state);
  const evaluation = useEvaluation();
  const plan = state.installationPlan;

  /** Checklist text by id — the report's own, so the panel and the document agree. */
  const checklistText = new Map(
    dialysisChecklistTemplate.categories.flatMap((category) =>
      category.items.map((item) => [item.id, item.text.en] as const),
    ),
  );
  const placementLabels = new Map(level.placements.map((entry) => [entry.id, entry.label]));

  function generate() {
    if (level.placements.length === 0) {
      dispatch({ type: 'installation/refuse', reason: 'nothing_placed' });
      return;
    }
    /*
     * Owner § 1, at the editor's own boundary. The contract makes an *unevaluated* layout
     * impossible to plan; this catches the other half — a layout with proposals still on screen is
     * one the engineer has not finished deciding about, and planning it would plan the drawing they
     * are about to replace.
     */
    if (state.layoutProposals && state.layoutProposals.proposals.length > 0) {
      dispatch({ type: 'installation/refuse', reason: 'proposals_pending' });
      return;
    }

    dispatch({
      type: 'installation/generate',
      plan: runPlanner({
        projectId: state.doc.document.project.id,
        level,
        spaceId: state.selectedSpaceId,
        catalog,
        evaluation,
        optimisation: null,
      }),
    });
  }

  return (
    <section className="border-b border-edge px-3 py-2.5" aria-label="Installation planning">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        Installation plan
      </h2>

      <button
        type="button"
        data-testid="plan-generate"
        className="w-full rounded bg-accent/20 px-2 py-1 text-[11px] text-ink ring-1 ring-accent/50 hover:bg-accent/30"
        onClick={generate}
      >
        Generate installation plan
      </button>

      {state.planningRefusal && (
        <p className="mt-2 text-[10px] leading-snug text-ink-muted" data-testid="plan-refusal">
          {REFUSALS[state.planningRefusal]}
        </p>
      )}

      {plan && (
        <div className="mt-2" data-testid="plan-results">
          {/*
            Owner decision B-7: *"The report must explicitly state 'Planning rate data not
            available.' instead of displaying calculated numbers."* The panel says the same thing
            in the same words — a figure absent here and a sentence in the PDF would be two
            accounts of one project.
          */}
          {plan.ratesAvailable ? (
            <dl className="mb-2 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px]">
              <dt className="text-ink-faint">Manpower</dt>
              <dd className="text-right" data-testid="plan-manpower">
                <Range range={plan.manpower} />
              </dd>
              <dt className="text-ink-faint">Duration</dt>
              <dd className="text-right" data-testid="plan-duration">
                <Figure figure={plan.duration} />
              </dd>
            </dl>
          ) : (
            <p
              className="mb-2 text-[10px] leading-snug text-amber-200/80"
              data-testid="plan-rates-unavailable"
            >
              Planning rate data not available.
              <span className="mt-0.5 block text-ink-faint">
                Manpower and duration come from installation rates in{' '}
                <span className="font-mono">standards/sequences/dialysis.json</span>, each citing a
                referenced standard. None has been supplied, so neither is estimated.
              </span>
            </p>
          )}

          {plan.blockers.length > 0 && (
            <div className="mb-2" data-testid="plan-blockers">
              <h3 className="mb-0.5 text-[10px] font-semibold text-amber-300/90">
                Before starting
              </h3>
              <ul className="space-y-0.5">
                {plan.blockers.map((blocker, index) => (
                  <li
                    key={`${blocker.kind}-${blocker.ref}-${index}`}
                    className="text-[10px] leading-snug text-amber-200/80"
                  >
                    {BLOCKER_TEXT[blocker.kind] ?? blocker.kind} · {blocker.ref}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <h3 className="mb-0.5 text-[10px] font-semibold text-ink-faint">Steps</h3>
          <ol className="mb-2 space-y-1" data-testid="plan-stages">
            {plan.stages.map((stage) => (
              <li
                key={stage.id}
                data-testid={`plan-stage-${stage.id}`}
                className="rounded border border-edge p-1.5"
              >
                <p className="text-[11px] text-ink">
                  {stage.order}. {stage.title.en}
                </p>
                <p className="text-[10px] text-ink-faint">{stage.title.ko}</p>

                {plan.ratesAvailable && (
                  <p className="mt-0.5 text-[10px] text-ink-faint">
                    <Range range={stage.manpower} /> · <Figure figure={stage.duration} />
                  </p>
                )}

                {stage.checklistItemIds.length > 0 && (
                  <ul className="mt-1 space-y-px">
                    {stage.checklistItemIds.map((id) => (
                      <li key={id} className="text-[10px] leading-snug text-ink-muted">
                        · {checklistText.get(id) ?? id}
                      </li>
                    ))}
                  </ul>
                )}

                {stage.tools.length > 0 && (
                  <p className="mt-1 text-[10px] text-ink-faint" data-testid={`plan-tools-${stage.id}`}>
                    Tools: {stage.tools.map((tool) => tool.title.en).join(', ')}
                  </p>
                )}

                {stage.materials.length > 0 && (
                  <ul className="mt-1 space-y-px" data-testid={`plan-materials-${stage.id}`}>
                    {stage.materials.map((material) => (
                      <li key={material.id} className="text-[10px] text-ink-muted">
                        {material.title.en} — <Figure figure={material.quantity} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>

          <h3 className="mb-0.5 text-[10px] font-semibold text-ink-faint">Connections</h3>
          <ul className="mb-2 space-y-0.5" data-testid="plan-connections">
            {plan.connections.map((connection) => (
              <li
                key={connection.service}
                data-testid={`plan-connection-${connection.service}`}
                className="text-[10px] text-ink-muted"
              >
                {SERVICE_LABELS[connection.service]}: <Figure figure={connection.totalLength} />
                {connection.originPointId === null && (
                  <span className="text-ink-faint"> · no reference point placed</span>
                )}
              </li>
            ))}
          </ul>

          {plan.materials.length > 0 && (
            <>
              <h3 className="mb-0.5 text-[10px] font-semibold text-ink-faint">Materials</h3>
              <ul className="mb-2 space-y-0.5" data-testid="plan-bom">
                {plan.materials.map((material) => (
                  <li key={material.id} className="text-[10px] text-ink-muted">
                    {material.title.en} — <Figure figure={material.quantity} />
                  </li>
                ))}
              </ul>
            </>
          )}

          {plan.risks.length > 0 && (
            <>
              <h3 className="mb-0.5 text-[10px] font-semibold text-ink-faint">Risks</h3>
              <ul className="mb-2 space-y-0.5" data-testid="plan-risks">
                {plan.risks.map((risk) => (
                  <li key={risk.id} className="text-[10px] leading-snug text-ink-muted">
                    {risk.title.en}
                    {/*
                      The reference, never a restatement. A risk that came from a finding points at
                      the reason code the validation panel already renders — two wordings of one
                      finding is exactly what the reason-code design exists to prevent.
                    */}
                    <span className="text-ink-faint">
                      {' '}
                      · {placementLabels.get(risk.ref.split(':').pop() ?? '') ?? risk.ref}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <button
            type="button"
            data-testid="plan-clear"
            className="w-full rounded px-2 py-1 text-[10px] text-ink-faint hover:bg-white/5"
            onClick={() => dispatch({ type: 'installation/clear' })}
          >
            Clear plan
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * A planner figure.
 *
 * `null` prints **Unknown**, with the reference that would answer it. Not a dash, not a zero: the
 * owner's *"unknown values remain Unknown"* only survives if an unknown reads as a statement
 * somebody can act on rather than as a gap in the layout.
 */
function Figure({ figure }: { readonly figure: SourcedNumber }) {
  if (figure.value === null) {
    /*
     * A total is unknown for a different reason than a part is, and the two want different
     * sentences. `plan:duration:incomplete` is an accurate code and an opaque thing to read — the
     * engine keeps the code, and the panel says what it means, exactly as the validation panel does
     * for a reason code.
     */
    const hint = figure.source.ref.endsWith(':incomplete')
      ? 'not every stage has one'
      : figure.source.ref;
    return (
      <span className="text-ink-faint" data-status="unknown">
        Unknown <span className="font-mono text-[9px]">{hint}</span>
      </span>
    );
  }
  return (
    <span data-status={figure.status} className="font-mono tabular-nums">
      {figure.value.toLocaleString('en-US')} {figure.unit}
      {/*
        B-7's four disclosures. The formula and its input values make the number checkable; the
        rate id and the citation say which standard permitted it to exist at all.
      */}
      {figure.calculation && (
        <span className="ml-1 text-[9px] font-normal text-ink-faint">
          {figure.calculation.formula} ·{' '}
          {figure.calculation.inputs.map((entry) => `${entry.name} ${entry.value}`).join(', ')}
          {figure.calculation.rateId && ` · ${figure.calculation.citation ?? ''}`}
        </span>
      )}
    </span>
  );
}

/** A crew size — B-7's `minimumPersons, recommendedPersons` — with the rate it was read from. */
function Range({ range }: { readonly range: SourcedRange }) {
  if (range.minimum === null || range.recommended === null) {
    return (
      <span className="text-ink-faint" data-status="unknown">
        Unknown <span className="font-mono text-[9px]">{range.source.ref}</span>
      </span>
    );
  }
  return (
    <span data-status={range.status} className="font-mono tabular-nums">
      {range.minimum}–{range.recommended} {range.unit}
      {range.source.citation && (
        <span className="ml-1 text-[9px] font-normal text-ink-faint">{range.source.citation}</span>
      )}
    </span>
  );
}
