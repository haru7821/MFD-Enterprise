import type { ScoreBreakdown } from '@mfd/ai-contract';
import { createDocumentState } from '@mfd/document-model';
import type { MfdDocument, Placement } from '@mfd/document-model';
import { catalog } from '@mfd/object-library/catalog';
import { footprintCentre, transformForCentre } from '@mfd/object-library';
import { describe, expect, it } from 'vitest';

import { editorReducer } from './editorReducer';
import { INITIAL_EDITOR_STATE, emptyDocument } from './editorState';
import type { EditorState, LayoutProposalSet } from './editorState';

/**
 * The reducer, at the one place it writes a proposal to the drawing.
 *
 * `layout/approve` had **no test at all** until the review that prompted this file: replacing
 * `if (change.moved)` with `if (false && change.moved)` left all 1,184 tests green. That is the
 * branch an engineer's "Apply this layout" runs through, and it is the second half of the
 * centre/corner fix — `@mfd/ai-local`'s `commandsFor` is the first half and is covered by
 * `optimise.test.ts`, but the editor derives its own commands from the proposal's diff and the two
 * derivations were once disagreeing.
 *
 * So these tests are about the *editor's* derivation specifically. They build the proposal by hand
 * rather than by running the solver: what is under test is what the reducer does with a diff, and a
 * solver run would decide the diff's contents for it.
 */

const AK98 = 'vantive_ak98';
const LEVEL_ID = 'level-1';

function machine(id: string, transform: Placement['transform']): Placement {
  return {
    id,
    equipmentObjectId: AK98,
    equipmentObjectVersion: catalog.get(AK98)?.version ?? '0.6.0',
    label: id,
    transform,
    spaceId: null,
  };
}

/** Enough of a breakdown to satisfy the type; nothing here reads it. */
const SCORE: ScoreBreakdown = {
  scoringModel: { id: 'dialysis_default', version: '1.0.0' },
  total: null,
  coverage: 0.25,
  criteria: [],
  unavailable: [],
  constraints: [],
};

function documentWith(placements: readonly Placement[]): MfdDocument {
  const base = emptyDocument();
  const level = base.project.levels[0]!;
  return {
    ...base,
    project: { ...base.project, levels: [{ ...level, placements: [...placements] }] },
  };
}

function stateWith(
  placements: readonly Placement[],
  proposals: LayoutProposalSet,
): EditorState {
  return {
    ...INITIAL_EDITOR_STATE,
    doc: createDocumentState(documentWith(placements)),
    activeLevelId: LEVEL_ID,
    layoutProposals: proposals,
    previewedProposalId: proposals.proposals[0]?.id ?? null,
  };
}

function proposalSet(diff: LayoutProposalSet['proposals'][number]['diff']): LayoutProposalSet {
  return {
    operation: 'optimise',
    spaceId: '',
    equipmentObjectId: AK98,
    requestedCount: 1,
    resolvedCount: 1,
    countWasDerived: false,
    emptyReason: null,
    currentScore: SCORE,
    blocking: [],
    proposals: [
      {
        id: 'candidate-1',
        rank: 1,
        tied: false,
        placements: diff.map((entry) => entry.placement),
        score: SCORE,
        compliance: { violations: 0, review: 0, unevaluable: 0 },
        explanation: [],
        diff,
      },
    ],
  };
}

function placementsAfterApprove(state: EditorState): readonly Placement[] {
  const applied = editorReducer(state, {
    type: 'layout/approve',
    proposalId: 'candidate-1',
    at: 1,
  });
  return applied.doc.document.project.levels[0]!.placements;
}

describe('layout/approve — a machine turned about its own centre', () => {
  const object = catalog.get(AK98)!;
  const source = machine('p1', { position: { x: 2_000, y: 2_000 }, rotation: 0, mirrored: false });
  const centre = footprintCentre(object, source.transform);
  const turned = machine('p1-target', transformForCentre(object, centre, 90_000));

  it('is the case that used to be invisible', () => {
    // The premise. Same centre, different corner — so a centre-distance test reports "no move"
    // while `transform.position`, which AD-21 makes the front-left corner, has changed.
    expect(footprintCentre(object, turned.transform)).toEqual(centre);
    expect(turned.transform.position).not.toEqual(source.transform.position);
  });

  it('writes the proposal’s corner to the drawing, not just the rotation', () => {
    const state = stateWith(
      [source],
      proposalSet([{ placement: turned, change: 'moved', source }]),
    );

    const [applied] = placementsAfterApprove(state);

    // Both, and the position is the one the proposal specified. Emitting the rotation alone left
    // the machine 1,644.7 mm from where it was scored.
    expect(applied?.transform.position).toEqual(turned.transform.position);
    expect(applied?.transform.rotation).toBe(90_000);
    // The id survives: an approval moves a machine, it does not replace it.
    expect(applied?.id).toBe('p1');
  });

  it('undoes in one press, back to exactly where it started', () => {
    const state = stateWith(
      [source],
      proposalSet([{ placement: turned, change: 'moved', source }]),
    );
    const applied = editorReducer(state, {
      type: 'layout/approve',
      proposalId: 'candidate-1',
      at: 1,
    });
    const undone = editorReducer(applied, { type: 'history/undo' });

    const [restored] = undone.doc.document.project.levels[0]!.placements;
    expect(restored?.transform).toEqual(source.transform);
  });
});

describe('layout/approve — the cases either side of it', () => {
  const object = catalog.get(AK98)!;
  const source = machine('p1', { position: { x: 2_000, y: 2_000 }, rotation: 0, mirrored: false });

  it('emits nothing for a machine that genuinely did not move', () => {
    // `unchanged` must stay a no-op: an optimisation that rewrote every machine would read as
    // twelve changes when it made two.
    const state = stateWith(
      [source],
      proposalSet([{ placement: machine('same', source.transform), change: 'unchanged', source }]),
    );

    const [applied] = placementsAfterApprove(state);
    expect(applied?.transform).toEqual(source.transform);
  });

  it('moves without rotating when only the position changed', () => {
    const moved = machine('p1-target', {
      position: { x: 5_000, y: 2_000 },
      rotation: 0,
      mirrored: false,
    });
    const state = stateWith([source], proposalSet([{ placement: moved, change: 'moved', source }]));

    const [applied] = placementsAfterApprove(state);
    expect(applied?.transform.position).toEqual({ x: 5_000, y: 2_000 });
    expect(applied?.transform.rotation).toBe(0);
  });

  it('creates for an added machine, and never deletes', () => {
    const added = machine('new-1', {
      position: { x: 6_000, y: 6_000 },
      rotation: 0,
      mirrored: false,
    });
    const state = stateWith([source], proposalSet([{ placement: added, change: 'added', source: null }]));

    const after = placementsAfterApprove(state);
    expect(after).toHaveLength(2);
    expect(after.map((entry) => entry.id)).toContain('p1');
  });

  void object;
});
