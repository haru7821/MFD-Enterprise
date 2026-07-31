import { useState } from 'react';

import type { ScoringCriterion } from '@mfd/ai-contract';
import { renderRationale } from '@mfd/ai-contract';
import { catalog } from '@mfd/object-library/catalog';
import { dialysisRuleSet } from '@mfd/rule-engine/rules';

import { now } from '@/editor/clock';
import { type LayoutProposal, type LayoutProposalSet, activeLevel } from '@/editor/editorState';
import { useEditor } from '@/editor/useEditor';

import { runOptimiser, runSolver } from './runSolver';

/**
 * Layout generation and optimisation, through the editor.
 *
 * Steps 6A and 6B. The deterministic solver of steps 3–5 given a way in, and the owner's
 * requirements are the panel's structure:
 *
 * | | Where |
 * | --- | --- |
 * | 1 · Generate — station count, equipment, room context | The form, and **Generate** |
 * | 2 · Optimise the drawing, only with explicit permission | **Optimise**, behind its checkbox |
 * | 3 · top 3 with total, coverage, compliance, breakdown, reason | The results list |
 * | 4 · explicit approval before applying | **Apply** is the only path to the document |
 * | 5 · added / moved / unchanged, before Apply | The change summary, and the ghost layer |
 * | 6 · command-based, undoable | One `groupCommand`, one undo press |
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
  nothing_to_optimise:
    'There is nothing of this kind in the selected room to rearrange. Generate a layout first.',
  movement_not_permitted:
    'Optimising rearranges machines that are already placed. Allow that above, then try again.',
  already_best:
    'Nothing improves on what you have drawn. Of the arrangements the solver can construct at this station count, yours scores highest.',
  no_feasible_arrangement:
    'No compliant arrangement exists at this station count. Every candidate broke a rule — including, in effect, the one on the drawing.',
  current_layout_blocked:
    'The layout on the drawing breaks the rules below. Optimising is available once they are resolved — until then there is nothing sound to improve on, and a ranking against it would not mean anything.',
} as const;

export function LayoutPanel() {
  const { state, dispatch } = useEditor();
  const level = activeLevel(state);
  const [count, setCount] = useState('');
  const [objectId, setObjectId] = useState(catalog.objects[0]?.id ?? '');
  /*
   * Owner requirement 2: *"Existing placements are immutable unless the engineer explicitly allows
   * movement."* Defaults to off, and resetting it is not something the panel does on their behalf
   * — an opt-in that switches itself back on is not one.
   */
  const [allowMoving, setAllowMoving] = useState(false);

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

  function optimise() {
    if (!object) return;
    dispatch({
      type: 'layout/propose',
      proposals: runOptimiser({
        level,
        spaceId: state.selectedSpaceId,
        object,
        catalog,
        ruleSet: dialysisRuleSet,
        allowMovingExisting: allowMoving,
      }),
    });
  }

  return (
    <section className="border-b border-edge px-3 py-2.5" aria-label="Layout generation">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        Layout
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

      {/*
        Optimisation, and the permission it needs.

        The checkbox is above the button rather than a confirmation after it: an engineer should
        read what they are allowing before the thing they are allowing has been proposed. The
        solver refuses without it regardless — see `OptimiseInput.allowMovingExisting` — so this is
        how permission is *given*, not how it is enforced.
      */}
      <label className="mt-2 flex items-start gap-1.5">
        <input
          type="checkbox"
          data-testid="layout-allow-moving"
          className="mt-px"
          checked={allowMoving}
          onChange={(event) => setAllowMoving(event.target.checked)}
        />
        <span className="text-[10px] leading-snug text-ink-faint">
          Allow moving machines that are already placed
        </span>
      </label>

      <button
        type="button"
        data-testid="layout-optimise"
        disabled={!object}
        className="mt-1 w-full rounded bg-white/5 px-2 py-1 text-[11px] text-ink ring-1 ring-edge hover:bg-white/10 disabled:opacity-40"
        onClick={optimise}
      >
        Optimise this layout
      </button>

      {/*
        Owner decision D1: *"Display blocking rule violations first."*

        Above the explanation and not inside it, because the order is the message. What an engineer
        does next is fix these; the sentence about why the optimiser has nothing to say is context
        for that, not the other way round.
      */}
      {results && results.blocking.length > 0 && (
        <div
          className="mt-2 rounded border border-red-400/60 bg-red-500/15 p-2"
          data-testid="layout-blocking"
        >
          <p className="text-[10px] font-medium text-red-300">
            {results.blocking.length} blocking rule violation
            {results.blocking.length === 1 ? '' : 's'} in the layout as drawn
          </p>
          <ul className="mt-1 space-y-0.5">
            {results.blocking.map((violation) => (
              <li
                key={`${violation.ruleId}:${violation.reasonCode}:${violation.placements
                  .map((entry) => entry.id)
                  .join('+')}`}
                className="text-[10px] text-ink-muted"
                data-testid="layout-blocking-rule"
              >
                {violation.ruleId} · {violation.reasonCode}
                {/*
                  Which machines, by the labels the engineer typed. A rule id and a reason code say
                  what is wrong; only these say where to go and move something.
                */}
                {/*
                  Which machines, and — Owner decision, whole-level gating — which of them are not
                  in the room on screen. A machine the engineer did not select can block this run,
                  and without saying so the panel names something they cannot find.

                  The flag sits against **each machine**, not against the row. A collision naming one
                  machine in this room and one outside it rendered "A + B (not in this room)", which
                  is true of B and false of A; a row-level flag cannot express a mixed pair, and the
                  mixed pair is the ordinary case for a collision across a boundary.

                  Owner decision: it names the room rather than only saying "elsewhere" — a level has
                  no bound on how many rooms it holds, and "not in this room" leaves an engineer
                  searching all of them. "Not in any room" is kept distinct from a name: a machine
                  standing in circulation is a different fact from one in the room next door, and is
                  the more common way for a drawing to end up blocked.
                */}
                {violation.placements.map((entry, index) => (
                  <span key={entry.id} className="text-ink-faint">
                    {index === 0 ? ' · ' : ' + '}
                    {entry.label}
                    {!entry.inSelectedRoom && (
                      <span data-testid="layout-blocking-elsewhere">
                        {' '}
                        {entry.roomName === null ? '(not in any room)' : `(in ${entry.roomName})`}
                      </span>
                    )}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}

      {results && results.proposals.length === 0 && results.emptyReason && (
        <p className="mt-2 text-[10px] leading-snug text-ink-muted" data-testid="layout-empty">
          {EMPTY_MESSAGES[results.emptyReason]}
          {/*
            Why it has nothing to offer, and not only that it has nothing.

            "Nothing improves on what you have drawn" reads as praise for the layout. On this
            product today it is usually a statement about missing data: every clearance figure in
            the catalogue is null until the AK98 manual arrives, so compliance margin, maintenance
            access and installation feasibility all report unavailable, and a document with no
            reference points leaves only future expansion — which saturates, and rates every
            arrangement alike. An optimiser with one saturated criterion is right to say nothing
            improves, and wrong to let that sound like a verdict on the drawing.
          */}
          {results.currentScore && results.currentScore.coverage < 1 && (
            <span className="mt-1 block text-ink-faint" data-testid="layout-empty-coverage">
              Measured over {Math.round(results.currentScore.coverage * 100)}% of the scoring model
              — the rest could not be measured, so there may be differences it cannot see. Placing
              reference points, and the AK98 manual, are what widen this.
            </span>
          )}
        </p>
      )}

      {results && results.proposals.length > 0 && (
        <div className="mt-2" data-testid="layout-results">
          <p className="mb-1 text-[10px] text-ink-faint">
            {results.operation === 'optimise' ? 'Optimising ' : ''}
            {results.proposals.length} alternative{results.proposals.length === 1 ? '' : 's'} ·{' '}
            {results.resolvedCount} station{results.resolvedCount === 1 ? '' : 's'}
            {results.countWasDerived && ' (as many as fit)'}
          </p>

          {/*
            The number every optimisation total is being compared against. Without it, "0.68" is
            a score rather than an improvement, and an engineer cannot tell how much they are
            being offered for the rearrangement they are agreeing to.
          */}
          {results.currentScore && (
            <p className="mb-1 text-[10px] text-ink-faint" data-testid="layout-current-score">
              Current layout {results.currentScore.total.toFixed(2)} · coverage{' '}
              {Math.round(results.currentScore.coverage * 100)}%
            </p>
          )}

          {results.proposals.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              results={results}
              previewed={proposal.id === state.previewedProposalId}
              onPreview={() => dispatch({ type: 'layout/preview', proposalId: proposal.id })}
              onApply={() =>
                dispatch({ type: 'layout/approve', proposalId: proposal.id, at: now() })
              }
            />
          ))}

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

interface ProposalCardProps {
  readonly proposal: LayoutProposal;
  readonly results: LayoutProposalSet;
  readonly previewed: boolean;
  readonly onPreview: () => void;
  readonly onApply: () => void;
}

function ProposalCard({ proposal, results, previewed, onPreview, onApply }: ProposalCardProps) {
  const added = proposal.diff.filter((entry) => entry.change === 'added').length;
  const moved = proposal.diff.filter((entry) => entry.change === 'moved').length;
  const unchanged = proposal.diff.filter((entry) => entry.change === 'unchanged').length;

  return (
    <article
      data-testid={`layout-proposal-${proposal.rank}`}
      className={`mb-1.5 rounded border p-1.5 ${
        previewed ? 'border-accent/60 bg-accent/10' : 'border-edge'
      }`}
    >
      <button
        type="button"
        data-testid={`layout-preview-${proposal.rank}`}
        className="flex w-full items-baseline justify-between gap-2 text-left"
        onClick={onPreview}
      >
        <span className="text-[11px] text-ink">#{proposal.rank}</span>
        <span className="font-mono text-[11px] text-ink tabular-nums">
          {proposal.score.total.toFixed(2)}
        </span>
      </button>

      {/*
        Coverage, always, beside the total. A score over 60 % of the model reads exactly like a
        complete one — this is the line that tells them apart, and the owner made it mandatory.
      */}
      <p
        className="mt-0.5 text-[10px] text-ink-faint"
        data-testid={`layout-coverage-${proposal.rank}`}
      >
        Coverage {Math.round(proposal.score.coverage * 100)}%
        {proposal.score.coverage < 1 &&
          ` · ${proposal.score.unavailable.length} criteria not measurable`}
      </p>

      {/*
        Rule compliance, as its own line rather than folded into the score.

        Every ranked layout passed Gate 2, so violations is 0 by construction — and saying so is
        the point, because "compliant" and "nothing was checked" look identical on a screen that
        shows only a number. A layout with no violations and eleven unevaluable findings has
        established very little.
      */}
      <p
        className="text-[10px] text-ink-faint"
        data-testid={`layout-compliance-${proposal.rank}`}
      >
        {proposal.compliance.violations} violations
        {proposal.compliance.review > 0 && ` · ${proposal.compliance.review} to review`}
        {proposal.compliance.unevaluable > 0 &&
          ` · ${proposal.compliance.unevaluable} not evaluable`}
      </p>

      {/*
        Owner requirement 5, in words, always visible — the ghost layer draws the same three
        categories, and one of the two has to work on a laptop trackpad with the canvas scrolled
        somewhere else.
      */}
      <p className="text-[10px] text-ink-faint" data-testid={`layout-changes-${proposal.rank}`}>
        {added > 0 && `${added} added`}
        {added > 0 && (moved > 0 || unchanged > 0) && ' · '}
        {moved > 0 && `${moved} moved`}
        {moved > 0 && unchanged > 0 && ' · '}
        {unchanged > 0 && `${unchanged} unchanged`}
      </p>

      {previewed && (
        <>
          <table className="mt-1 w-full text-[10px]" data-testid={`layout-breakdown-${proposal.rank}`}>
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
            Owner requirement 3: the reason for the ranking.

            Bilingual, Korean above English, in the order the validation panel and the report use.
            Composed from `AR-` codes rather than from prose the solver assembled: an invented
            justification is a document that lies about why a machine is where it is, so the set of
            things this can say is closed and lives in the contract.
          */}
          <ul className="mt-1 space-y-0.5" data-testid={`layout-reason-${proposal.rank}`}>
            {proposal.explanation.map((item) => (
              <li key={item.code} className="text-[10px] leading-snug text-ink-faint">
                <span className="block">{renderRationale('ko', item.code, item.params)}</span>
                <span className="block">{renderRationale('en', item.code, item.params)}</span>
              </li>
            ))}
          </ul>

          {/*
            Requirement 4. The only path from a proposal to the document, and it is a button an
            engineer presses knowingly — not a side effect of previewing.
          */}
          <button
            type="button"
            data-testid={`layout-apply-${proposal.rank}`}
            className="mt-1.5 w-full rounded bg-accent/25 px-2 py-1 text-[11px] text-ink ring-1 ring-accent/60 hover:bg-accent/35"
            onClick={onApply}
          >
            {results.operation === 'optimise' ? 'Apply this rearrangement' : 'Apply this layout'}
          </button>
        </>
      )}
    </article>
  );
}
