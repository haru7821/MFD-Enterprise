import { useState } from 'react';

import type { ScoringCriterion } from '@mfd/ai-contract';
import { catalog } from '@mfd/object-library/catalog';
import { dialysisRuleSet } from '@mfd/rule-engine/rules';

import { now } from '@/editor/clock';
import { activeLevel } from '@/editor/editorState';
import { useEditor } from '@/editor/useEditor';

import { runSolver } from './runSolver';

/**
 * Layout generation, through the editor.
 *
 * Step 6A. The deterministic solver of steps 3–5 given a way in, and the owner's five
 * requirements are the panel's structure:
 *
 * | | Where |
 * | --- | --- |
 * | 1 · station count, equipment type, room context | The form below |
 * | 2 · ranked candidates | `runSolver` → `layout/propose` |
 * | 3 · top 3 with total, coverage and breakdown | The results list |
 * | 4 · explicit approval before applying | **Apply** is the only path to the document |
 * | 5 · command-based, undoable | One `groupCommand`, one undo press |
 *
 * ## Nothing here touches the document until Apply
 *
 * Proposals live in editor state beside the document, and previewing one draws ghosts. A solver
 * that wrote first and offered an undo afterwards would have already changed the drawing an
 * engineer is deciding about.
 */

/** Short forms for the breakdown table, where a row is a few centimetres wide. */
const CRITERION_LABELS: Record<ScoringCriterion, string> = {
  compliance_margin: 'Compliance margin',
  installation_feasibility: 'Installation feasibility',
  maintenance_access: 'Maintenance access',
  ro_piping_length: 'RO piping',
  electrical_routing: 'Electrical',
  future_expansion: 'Future expansion',
  walking_distance: 'Walking distance',
  drain_routing: 'Drain routing',
};

/** Why a criterion could not be measured, in a sentence an engineer can act on. */
const UNAVAILABLE_REASONS: Record<string, string> = {
  'SC-901': 'no reference point placed',
  'SC-902': 'nothing of that kind on this level',
  'SC-903': 'no route avoiding the obstructions',
  'SC-904': 'no requirement to compare against',
};

const EMPTY_MESSAGES = {
  no_room_selected: 'Select a room first — the solver needs an outline to work inside.',
  no_position_satisfies_rules:
    'No arrangement of that many machines satisfies the rules in this room. Every candidate broke one.',
  room_too_small: 'This room will not hold that many machines at their design footprint.',
} as const;

export function LayoutPanel() {
  const { state, dispatch } = useEditor();
  const level = activeLevel(state);
  const [count, setCount] = useState('');
  const [objectId, setObjectId] = useState(catalog.objects[0]?.id ?? '');

  const space = level.spaces.find((entry) => entry.id === state.selectedSpaceId);
  const object = catalog.get(objectId);
  const results = state.layoutProposals;

  function generate() {
    if (!object) return;
    const trimmed = count.trim();
    dispatch({
      type: 'layout/propose',
      proposals: runSolver({
        level,
        spaceId: state.selectedSpaceId,
        object,
        catalog,
        ruleSet: dialysisRuleSet,
        // Blank means "as many as fit". The solver resolves it and reports what it resolved to,
        // rather than the panel guessing a number on the engineer's behalf.
        stationCount: trimmed === '' ? null : Number.parseInt(trimmed, 10),
      }),
    });
  }

  return (
    <section className="border-b border-edge px-3 py-2.5" aria-label="Layout generation">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        Generate layout
      </h2>

      <label className="mb-1.5 block">
        <span className="mb-0.5 block text-[10px] text-ink-faint">Equipment</span>
        <select
          data-testid="layout-equipment"
          className="w-full rounded border border-edge bg-black/20 px-1.5 py-1 text-[11px] text-ink"
          value={objectId}
          onChange={(event) => setObjectId(event.target.value)}
        >
          {catalog.objects.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.model}
            </option>
          ))}
        </select>
      </label>

      <label className="mb-1.5 block">
        <span className="mb-0.5 block text-[10px] text-ink-faint">
          Stations <span className="text-ink-faint">(blank = as many as fit)</span>
        </span>
        <input
          type="number"
          min={1}
          data-testid="layout-count"
          className="w-full rounded border border-edge bg-black/20 px-1.5 py-1 text-[11px] text-ink"
          value={count}
          onChange={(event) => setCount(event.target.value)}
        />
      </label>

      <p className="mb-1.5 text-[10px] text-ink-faint" data-testid="layout-room">
        {space ? `Room: ${space.name}` : 'No room selected'}
      </p>

      <button
        type="button"
        data-testid="layout-generate"
        disabled={!object}
        className="w-full rounded bg-accent/20 px-2 py-1 text-[11px] text-ink ring-1 ring-accent/50 hover:bg-accent/30 disabled:opacity-40"
        onClick={generate}
      >
        Generate
      </button>

      {results && results.proposals.length === 0 && results.emptyReason && (
        <p className="mt-2 text-[10px] text-ink-muted" data-testid="layout-empty">
          {EMPTY_MESSAGES[results.emptyReason]}
        </p>
      )}

      {results && results.proposals.length > 0 && (
        <div className="mt-2" data-testid="layout-results">
          <p className="mb-1 text-[10px] text-ink-faint">
            {results.proposals.length} alternative{results.proposals.length === 1 ? '' : 's'} ·{' '}
            {results.resolvedCount} station{results.resolvedCount === 1 ? '' : 's'}
            {results.countWasDerived && ' (as many as fit)'}
          </p>

          {results.proposals.map((proposal) => {
            const previewed = proposal.id === state.previewedProposalId;
            return (
              <article
                key={proposal.id}
                data-testid={`layout-proposal-${proposal.rank}`}
                className={`mb-1.5 rounded border p-1.5 ${
                  previewed ? 'border-accent/60 bg-accent/10' : 'border-edge'
                }`}
              >
                <button
                  type="button"
                  data-testid={`layout-preview-${proposal.rank}`}
                  className="flex w-full items-baseline justify-between gap-2 text-left"
                  onClick={() => dispatch({ type: 'layout/preview', proposalId: proposal.id })}
                >
                  <span className="text-[11px] text-ink">#{proposal.rank}</span>
                  <span className="font-mono text-[11px] text-ink tabular-nums">
                    {proposal.score.total.toFixed(2)}
                  </span>
                </button>

                {/*
                  Coverage, always, beside the total. A score over 60 % of the model reads exactly
                  like a complete one — this is the line that tells them apart, and the owner made
                  it mandatory.
                */}
                <p
                  className="mt-0.5 text-[10px] text-ink-faint"
                  data-testid={`layout-coverage-${proposal.rank}`}
                >
                  Coverage {Math.round(proposal.score.coverage * 100)}%
                  {proposal.score.coverage < 1 &&
                    ` · ${proposal.score.unavailable.length} criteria not measurable`}
                </p>

                {previewed && (
                  <>
                    <table
                      className="mt-1 w-full text-[10px]"
                      data-testid={`layout-breakdown-${proposal.rank}`}
                    >
                      <tbody>
                        {proposal.score.criteria.map((entry) => (
                          <tr key={entry.criterion} className="text-ink-muted">
                            <td className="py-px pr-1">{CRITERION_LABELS[entry.criterion]}</td>
                            <td className="py-px pr-1 text-right font-mono tabular-nums">
                              {entry.normalised.toFixed(2)}
                            </td>
                            <td className="py-px text-right font-mono text-ink-faint tabular-nums">
                              {entry.measuredOnly
                                ? '—'
                                : `×${entry.weight.toFixed(2)} = ${entry.contribution.toFixed(3)}`}
                            </td>
                          </tr>
                        ))}
                        {proposal.score.unavailable.map((entry) => (
                          <tr key={entry.criterion} className="text-ink-faint">
                            <td className="py-px pr-1">{CRITERION_LABELS[entry.criterion]}</td>
                            <td colSpan={2} className="py-px text-right">
                              {UNAVAILABLE_REASONS[entry.reasonCode] ?? 'not measurable'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {/*
                      Requirement 4. The only path from a proposal to the document, and it is a
                      button an engineer presses knowingly — not a side effect of previewing.
                    */}
                    <button
                      type="button"
                      data-testid={`layout-apply-${proposal.rank}`}
                      className="mt-1.5 w-full rounded bg-accent/25 px-2 py-1 text-[11px] text-ink ring-1 ring-accent/60 hover:bg-accent/35"
                      onClick={() =>
                        dispatch({ type: 'layout/approve', proposalId: proposal.id, at: now() })
                      }
                    >
                      Apply this layout
                    </button>
                  </>
                )}
              </article>
            );
          })}

          <button
            type="button"
            data-testid="layout-discard"
            className="w-full rounded px-2 py-1 text-[10px] text-ink-faint hover:bg-white/5"
            onClick={() => dispatch({ type: 'layout/discard' })}
          >
            Discard proposals
          </button>
        </div>
      )}
    </section>
  );
}
