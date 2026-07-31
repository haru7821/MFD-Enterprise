import { describe, expect, it } from 'vitest';

import type { ProposedCommand, ReferencePointSummary } from '@mfd/ai-contract';
import { scoreBreakdownSchema } from '@mfd/ai-contract';
import { dialysisScoringModel } from '@mfd/ai-contract/scoring';
import type { Placement } from '@mfd/document-model';

import {
  fixtureCatalog,
  fixtureMachine,
  fixtureRoom,
  fixtureRoomBoundary,
  fixtureRuleSet,
} from '../fixtures/index';
import {
  type OptimiseInput,
  assertNoDeletions,
  commandsFor,
  diffPlacements,
  optimiseLayout,
} from './optimise';

/**
 * Optimisation, against the owner's five Step 5 constraints.
 *
 * The load-bearing ones are 1 (never delete) and 5 (best among *feasible*, not best mathematically).
 * Both are about what an optimiser does when it is tempted to look effective.
 */

const machine = fixtureMachine();

function placement(id: string, x: number, y: number): Placement {
  return {
    id,
    equipmentObjectId: machine.id,
    equipmentObjectVersion: machine.version,
    label: id,
    transform: { position: { x, y }, rotation: 0, mirrored: false },
    spaceId: null,
  };
}

const POINTS: ReferencePointSummary[] = [
  { id: 'ro', kind: 'ro_supply', position: { x: 0, y: 0 } },
  { id: 'panel', kind: 'electrical_panel', position: { x: 8_000, y: 0 } },
  { id: 'drain', kind: 'drain', position: { x: 0, y: 6_000 } },
  { id: 'entry', kind: 'access_entry', position: { x: 4_000, y: 0 } },
  { id: 'staff', kind: 'staff_base', position: { x: 4_000, y: 6_000 } },
];

/** A deliberately poor arrangement: everything crammed into the far corner from the services. */
const AWKWARD = [
  placement('s1', 7_000, 5_000),
  placement('s2', 7_000, 3_000),
  placement('s3', 5_000, 5_000),
  placement('s4', 5_000, 3_000),
];

function optimise(overrides: Partial<OptimiseInput> = {}) {
  return optimiseLayout({
    current: AWKWARD,
    room: fixtureRoom(),
    obstructions: [],
    boundaries: [fixtureRoomBoundary()],
    object: machine,
    catalog: fixtureCatalog(),
    ruleSet: fixtureRuleSet(),
    planStatus: 'calibrated',
    pitchPadding: 1_200,
    existing: [],
    referencePoints: POINTS,
    scoring: dialysisScoringModel,
    allowMovingExisting: true,
    ...overrides,
  });
}

describe('constraint 1 — the station count is immutable', () => {
  it('never emits placement.delete', () => {
    const result = optimise();
    expect(result.proposals.length).toBeGreaterThan(0);

    for (const proposal of result.proposals) {
      for (const command of proposal.commands) {
        expect(command.type).not.toBe('placement.delete');
      }
    }
  });

  it('emits only moves and rotations', () => {
    // Not merely "no deletes": a `placement.create` would also change the count, in the other
    // direction. The command vocabulary an optimisation may use is two verbs wide.
    for (const proposal of optimise().proposals) {
      for (const command of proposal.commands) {
        expect(['placement.move', 'placement.rotate']).toContain(command.type);
      }
    }
  });

  it('proposes exactly as many machines as were there', () => {
    const result = optimise();
    expect(result.stationCount).toBe(AWKWARD.length);
    for (const proposal of result.proposals) {
      expect(proposal.placements).toHaveLength(AWKWARD.length);
    }
  });

  it('throws if a deletion ever reaches the output', () => {
    // The assertion behind the structural guarantee. `commandsFor` walks a permutation and cannot
    // produce one — this is what catches a future refactor that changes that.
    const smuggled: ProposedCommand[] = [
      { type: 'placement.move', payload: {} },
      { type: 'placement.delete', payload: { placementId: 's1' } },
    ];
    expect(() => assertNoDeletions(smuggled)).toThrow(/immutable/);
  });

  it('keeps every original placement id, so a move is a move', () => {
    // Delete-and-create would lose the labels an engineer typed and would read as a machine
    // vanishing. Every command names an id that was already on the drawing.
    const ids = new Set(AWKWARD.map((entry) => entry.id));
    for (const proposal of optimise().proposals) {
      for (const command of proposal.commands) {
        expect(ids.has((command.payload as { placementId: string }).placementId)).toBe(true);
      }
    }
  });
});

describe('Step 6B — existing placements are immutable without explicit permission', () => {
  it('refuses to propose anything until the engineer opts in', () => {
    /*
     * Optimisation *is* moving existing machines, so this is a precondition rather than a mode.
     * Structural rather than a disabled button: a UI can forget to disable something, and this
     * cannot.
     */
    const result = optimise({ allowMovingExisting: false });

    expect(result.outcome).toBe('movement_not_permitted');
    expect(result.proposals).toEqual([]);
    expect(result.current).toBeNull();
    // The count is still reported — an engineer needs to know what would be optimised.
    expect(result.stationCount).toBe(AWKWARD.length);
  });

  it('proposes once permission is given', () => {
    expect(optimise({ allowMovingExisting: true }).outcome).toBe('improved');
  });
});

describe('the visual diff', () => {
  it('marks every machine of a generated layout as added', () => {
    // Generation has nothing to move from.
    const entries = diffPlacements([], AWKWARD);
    expect(entries.map((entry) => entry.change)).toEqual(['added', 'added', 'added', 'added']);
    expect(entries.every((entry) => entry.source === null)).toBe(true);
  });

  it('distinguishes moved from unchanged', () => {
    /*
     * The assertion that makes the highlight worth having. A ghosted layout shows where machines
     * *would* be; it does not show which of them are changing, and approving a change you have not
     * located is not much of an approval.
     */
    const proposed = [
      placement('x', 7_000, 5_000), // exactly where s1 stands
      placement('y', 1_000, 1_000), // the far corner, which nothing is near
      placement('z', 5_000, 5_000), // exactly where s3 stands
      placement('w', 5_000, 3_000), // exactly where s4 stands
    ];

    /*
     * Three of the four targets sit on an existing machine, and yet two machines move — because the
     * assignment is greedy and not minimum-total-distance. s2 (7000, 3000) is nearer to w than s4
     * is, takes it, and leaves s4 to make the long trip to y. That is the documented behaviour of
     * `commandsFor`: stable and individually sensible, not globally optimal.
     */
    const changes = diffPlacements(AWKWARD, proposed);
    expect(changes.map((entry) => entry.change)).toEqual([
      'unchanged', // x ← s1
      'moved', //     y ← s4, all the way across
      'unchanged', // z ← s3
      'moved', //     w ← s2, two metres
    ]);
    expect(changes[1]?.source?.id).toBe('s4');
    expect(changes[3]?.source?.id).toBe('s2');
  });

  it('agrees with the commands about which machine went where', () => {
    /*
     * The invariant the highlight rests on. Asserting only that the counts match would pass on a
     * diff that paired the machines up differently — an engineer would then see a ghost highlighted
     * as "moved from here" while the command stack moved a different machine into it.
     *
     * So each `moved` entry is traced back: the machine standing at its `from` must be the one the
     * commands send to its position, and an `unchanged` entry's machine must not be moved at all.
     */
    const result = optimise();
    const proposal = result.proposals[0];
    if (!proposal) throw new Error('expected a proposal');

    const changes = diffPlacements(AWKWARD, proposal.placements);
    const movedById = new Map(
      proposal.commands
        .filter((command) => command.type === 'placement.move')
        .map((command) => {
          const payload = command.payload as {
            placementId: string;
            position: { x: number; y: number };
          };
          return [payload.placementId, payload.position];
        }),
    );
    expect(movedById.size).toBeGreaterThan(0);

    for (const entry of changes) {
      const source = entry.source;
      if (!source) throw new Error('every proposed placement should be assigned an existing one');

      if (entry.change === 'moved') {
        expect(movedById.get(source.id)).toEqual(entry.placement.transform.position);
      } else {
        expect(movedById.has(source.id)).toBe(false);
      }
    }
  });
});

describe('constraint 2 — an empty layout is not a candidate', () => {
  it('refuses to optimise nothing', () => {
    const result = optimise({ current: [] });

    expect(result.outcome).toBe('not_optimisable');
    expect(result.proposals).toEqual([]);
    expect(result.current).toBeNull();
    expect(result.stationCount).toBe(0);
  });
});

describe('constraint 4 — coverage is mandatory', () => {
  it('carries coverage on the current layout and on every proposal', () => {
    const result = optimise();

    expect(typeof result.current?.coverage).toBe('number');
    for (const proposal of result.proposals) {
      expect(typeof proposal.score.coverage).toBe('number');
      // And it is a valid breakdown, so the schema's "never a bare total" applies here too.
      expect(scoreBreakdownSchema.safeParse(proposal.score).success).toBe(true);
    }
  });
});

describe('constraint 5 — best among feasible, not best mathematically', () => {
  it('scores the current layout on the same inputs, so the comparison is like for like', () => {
    /*
     * `scoringModel` being equal is trivially true — the same object is passed to both sides — so
     * asserting only that proved nothing. What can actually differ is the *inputs*: score the
     * current layout without the reference points the candidates were scored with and its coverage
     * drops, making the two totals incomparable while both still read 0…1.
     *
     * Coverage and the reported constraint are what expose that, so those are what is asserted.
     */
    const result = optimise();
    const proposal = result.proposals[0];

    expect(result.current?.coverage).toBe(proposal?.score.coverage);
    expect(result.current?.unavailable.map((entry) => entry.criterion)).toEqual(
      proposal?.score.unavailable.map((entry) => entry.criterion),
    );
    // And the current layout reports its own count as the target it was measured against, not the
    // null of a request nobody made.
    expect(result.current?.constraints[0]).toEqual({
      constraint: 'station_count',
      measured: AWKWARD.length,
      unit: 'count',
      target: AWKWARD.length,
    });
  });

  it('only proposes layouts that actually beat the current one', () => {
    const result = optimise();
    const current = result.current?.total ?? 0;

    for (const proposal of result.proposals) {
      expect(proposal.score.total).toBeGreaterThan(current);
    }
  });

  it('says so rather than inventing a suggestion when nothing improves', () => {
    /*
     * The answer an optimiser is most tempted to avoid. Returning the best of a worse bunch would
     * make every run produce something, and an engineer who accepted one would have been talked
     * into a worse layout by a tool that had nothing to offer.
     *
     * Fed here with a layout the solver itself produced, which is therefore already the best
     * arrangement it can construct.
     */
    const first = optimise();
    expect(first.outcome).toBe('improved');

    const best = first.proposals[0];
    if (!best) throw new Error('expected a proposal to feed back');

    const second = optimise({ current: best.placements });
    expect(second.outcome).toBe('already_best');
    expect(second.proposals).toEqual([]);
    expect(second.current).not.toBeNull();
  });

  it('reports no feasible candidate rather than an empty success', () => {
    // A room too small for the count that is somehow already in it. Distinguished from
    // `already_best`, because "nothing is better" and "nothing is possible" call for different
    // things from an engineer.
    const result = optimise({ room: fixtureRoom(1_500, 1_500) });
    expect(result.outcome).toBe('no_feasible_candidate');
    expect(result.current).not.toBeNull();
  });
});

describe('what an engineer is told', () => {
  it('shows what improved and what it cost, per criterion', () => {
    const result = optimise();
    const proposal = result.proposals[0];
    expect(proposal).toBeDefined();
    expect(proposal?.deltas.length).toBeGreaterThan(0);

    for (const delta of proposal?.deltas ?? []) {
      expect(delta.change).toBeCloseTo(delta.after - delta.before, 9);
    }
  });

  it('orders the deltas by how much moved, not alphabetically', () => {
    const deltas = optimise().proposals[0]?.deltas ?? [];
    const magnitudes = deltas.map((delta) => Math.abs(delta.change));
    expect([...magnitudes].sort((a, b) => b - a)).toEqual(magnitudes);
  });

  it('explains itself in bilingual codes', () => {
    for (const proposal of optimise().proposals) {
      for (const item of proposal.explanation) {
        expect(item.code).toMatch(/^AR-\d{3}$/);
      }
    }
  });

  it('is deterministic', () => {
    expect(JSON.stringify(optimise())).toBe(JSON.stringify(optimise()));
  });
});

describe('command derivation', () => {
  it('emits nothing for a machine already in the right place', () => {
    // An optimisation that emitted a move for every machine would read as twelve changes when it
    // made two.
    const same = [placement('a', 1_000, 1_000), placement('b', 4_000, 1_000)];
    expect(commandsFor(same, same)).toEqual([]);
  });

  it('assigns each machine to its nearest target, so moves are short', () => {
    const current = [placement('a', 1_000, 1_000), placement('b', 5_000, 1_000)];
    const target = [placement('x', 5_200, 1_000), placement('y', 1_200, 1_000)];

    const commands = commandsFor(current, target);
    const byId = new Map(
      commands.map((command) => [
        (command.payload as { placementId: string }).placementId,
        command.payload as { position: { x: number; y: number } },
      ]),
    );

    // `a` goes to the near target, not the far one — a naive index-order pairing would swap them
    // and produce two 4 m moves instead of two 200 mm ones.
    expect(byId.get('a')?.position.x).toBe(1_200);
    expect(byId.get('b')?.position.x).toBe(5_200);
  });

  it('produces the same commands twice', () => {
    const current = [placement('a', 1_000, 1_000), placement('b', 5_000, 1_000)];
    const target = [placement('x', 2_000, 2_000), placement('y', 6_000, 2_000)];
    expect(JSON.stringify(commandsFor(current, target))).toBe(
      JSON.stringify(commandsFor(current, target)),
    );
  });
});
