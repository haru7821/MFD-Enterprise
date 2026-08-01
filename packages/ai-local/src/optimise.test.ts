import { describe, expect, it } from 'vitest';

import type { ProposedCommand, ReferencePointSummary } from '@mfd/ai-contract';
import { scoreBreakdownSchema } from '@mfd/ai-contract';
import { dialysisScoringModel } from '@mfd/ai-contract/scoring';
import type { Placement } from '@mfd/document-model';
import type { Vec2 } from '@mfd/cad-engine';
import { footprintCentre, transformForCentre } from '@mfd/object-library';

import {
  fixtureCatalog,
  fixtureKnowledge,
  fixtureMachine,
  fixtureRoom,
  fixtureRoomBoundary,
  fixtureRuleSet,
} from '../fixtures/index';
import { applyGates, distinctViolations } from './gates';
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
    knowledge: fixtureKnowledge(),
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
    const entries = diffPlacements([], AWKWARD, fixtureCatalog());
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
    const changes = diffPlacements(AWKWARD, proposed, fixtureCatalog());
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

    const changes = diffPlacements(AWKWARD, proposal.placements, fixtureCatalog());
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

describe('D1 — a layout that fails a gate is not optimised, it is blocked', () => {
  /*
   * > Owner decision, D1: *"When the current layout fails a gate, do NOT generate an optimized
   * > recommendation. Return an explicit blocked state: no ranked proposals, no baseline
   * > comparison, no 'best candidate'. Display blocking rule violations first. Optimisation is
   * > available only after the current layout satisfies all mandatory gates."*
   *
   * Two machines 200 mm apart overlap, which the fixture rule set calls RED. Candidates have always
   * been gated on exactly this; the layout on the drawing never was.
   */
  const OVERLAPPING = [
    placement('s1', 3_000, 3_000),
    placement('s2', 3_200, 3_000),
    placement('s3', 5_000, 5_000),
    placement('s4', 5_200, 5_000),
  ];

  /** What the gates say about that layout, computed the same way the panel's list is. */
  function violationsOf(placements: readonly Placement[]) {
    return applyGates(
      {
        placements,
        catalog: fixtureCatalog(),
        ruleSet: fixtureRuleSet(),
        boundaries: [fixtureRoomBoundary()],
        planStatus: 'calibrated',
      },
      placements.length,
      placements.length,
    ).violations;
  }

  it('blocks instead of proposing', () => {
    const result = optimise({ current: OVERLAPPING });
    expect(result.outcome).toBe('blocked');
  });

  it('offers no ranked proposals and no baseline to compare against', () => {
    // The whole of the decision in three assertions. A score on screen next to a blocked verdict
    // is the comparison D1 exists to remove, and `#1` on a card is the recommendation it forbids.
    const result = optimise({ current: OVERLAPPING });

    expect(result.proposals).toEqual([]);
    expect(result.current).toBeNull();
  });

  it('names every problem that blocks it, not just the first', () => {
    /*
     * Two separate collisions — s1 on s2, and s3 on s4. Asserting `length > 0` would pass against
     * an implementation that reported only the first, which is exactly what the earlier version of
     * this test did: the count has to be tied to what the gates actually found.
     */
    const result = optimise({ current: OVERLAPPING });
    const distinct = distinctViolations(violationsOf(OVERLAPPING));

    expect(distinct.length).toBe(2);
    expect(result.blocking.length).toBe(distinct.length);
    for (const violation of result.blocking) {
      expect(violation.code).toBe('GX-201');
      expect(violation.detail.ruleId).toBeTruthy();
    }
  });

  it('names the machines, so the engineer knows which ones to move', () => {
    // "Violates a mandatory engineering rule" is enough for a solver discarding a candidate and
    // useless to a person looking at a drawing with ten machines on it.
    for (const violation of optimise({ current: OVERLAPPING }).blocking) {
      expect(violation.detail.placementIds?.length).toBeGreaterThan(0);
    }
  });

  it('reports one collision once, not once per machine', () => {
    /*
     * The rule engine anchors a collision on both machines — right for a findings list, wrong for a
     * list of things to fix. Four machines in two colliding pairs is **two** problems, and the raw
     * gate output has four findings.
     */
    const raw = violationsOf(OVERLAPPING);

    expect(raw.length).toBe(4);
    expect(optimise({ current: OVERLAPPING }).blocking).toHaveLength(2);
  });

  it('was suppressing compliant candidates before this, which is why it matters', () => {
    /*
     * The failure in one test. Without the gate the incumbent is scored anyway, and that score is
     * the bar every candidate has to clear — so a layout the rule engine has called unacceptable
     * can beat arrangements that break nothing, and the engineer is told the drawing is fine.
     *
     * Asserted from the other side, because the defect is no longer reachable through the public
     * function: the same room and the same count *do* yield compliant candidates, so what the old
     * code was ranking them against was a RED layout.
     */
    const compliant = optimise({ current: AWKWARD });
    expect(compliant.outcome).toBe('improved');
    expect(compliant.proposals.length).toBeGreaterThan(0);

    const blocked = optimise({ current: OVERLAPPING });
    expect(blocked.outcome).toBe('blocked');
    expect(blocked.stationCount).toBe(OVERLAPPING.length);
  });

  it('blocks on equipment that is not being rearranged', () => {
    /*
     * > Owner decision, following the standing review: **the whole scene**.
     *
     * The defect this replaced. `existing` holds everything on the level that is not being
     * optimised — the other equipment kinds, which stay exactly where they are. Gating only the
     * machines being moved meant a dialysis station standing on one of them was invisible: the run
     * returned `improved`, an empty blocking list, and three proposals, about a drawing the rule
     * engine called twice RED.
     */
    const current = [
      placement('s1', 3_000, 3_000),
      placement('s2', 5_000, 5_000),
      placement('s3', 7_000, 3_000),
    ];
    const other = [placement('other', 3_100, 3_000)];

    // Nothing wrong with the machines being rearranged, taken by themselves.
    expect(violationsOf(current)).toEqual([]);
    // And two REDs once the machine that is staying put is counted.
    expect(violationsOf([...other, ...current]).length).toBe(2);

    const result = optimise({ current, existing: other });

    expect(result.outcome).toBe('blocked');
    expect(result.proposals).toEqual([]);
    expect(result.current).toBeNull();
    expect(result.blocking).toHaveLength(1);
    expect(result.blocking[0]?.detail.placementIds).toEqual(
      expect.arrayContaining(['other', 's1']),
    );
  });

  it('never proposes a layout that collides with what is staying put', () => {
    /*
     * The other half of the same decision, and the one that makes the block worth having. Widening
     * the incumbent's gate without widening the candidates' would swap one asymmetry for another:
     * the drawing judged against the whole scene, the proposals against a fraction of it.
     *
     * `existing` here sits clear of everything, so the run proceeds — and every proposal has to be
     * clear of it too.
     */
    const other = [placement('other', 1_200, 1_200)];
    const result = optimise({ existing: other });

    expect(result.outcome).toBe('improved');
    expect(result.proposals.length).toBeGreaterThan(0);
    for (const proposal of result.proposals) {
      expect(violationsOf([...other, ...proposal.placements])).toEqual([]);
    }
  });

  it('is checked before the layout is scored at all', () => {
    // Not "scored and then withheld". `current` is null because nothing was measured, which is
    // what makes it impossible for a later change to leak the number back onto the screen.
    expect(optimise({ current: OVERLAPPING }).current).toBeNull();
  });
});

describe('the gates judge the scene, the score measures the equipment', () => {
  /*
   * > Owner decision, following the standing review.
   *
   * Two different questions, and an intermediate version answered them with one population. The
   * gate widened correctly; the score followed it and started measuring equipment it has no
   * dimensions for.
   */
  const other = [placement('other', 1_200, 1_200)];

  it('counts only the equipment being optimised, whatever else is on the drawing', () => {
    /*
     * The number the review caught. `score.ts` derives the station count from the placements it is
     * handed, so including `existing` made a two-station optimisation report three against a target
     * of two — a measured value that does not mean what its name says, in the one field of the
     * breakdown whose whole purpose is traceability.
     */
    const current = [placement('s1', 5_000, 3_000), placement('s2', 7_000, 3_000)];
    const result = optimise({ current, existing: other });

    expect(result.outcome).not.toBe('blocked');
    expect(result.current?.constraints[0]).toEqual({
      constraint: 'station_count',
      measured: current.length,
      unit: 'count',
      target: current.length,
    });
  });

  it('measures the incumbent and the candidates over the same population', () => {
    /*
     * What the widening was *for*, kept. Both sides now exclude `existing`, so the totals remain
     * comparable — which is the property that made the earlier asymmetry a defect, and it does not
     * require either side to measure a nurse station with a dialysis machine's clearances.
     */
    const result = optimise({ existing: other });
    const proposal = result.proposals[0];

    expect(result.current?.coverage).toBe(proposal?.score.coverage);
    expect(result.current?.constraints[0]?.measured).toBe(AWKWARD.length);
    for (const candidate of result.proposals) {
      expect(candidate.score.constraints[0]?.measured).toBe(AWKWARD.length);
    }
  });

  it('still gates on the whole scene while scoring only its own kind', () => {
    // The two answers held together in one assertion: the machine that is not being rearranged
    // blocks the run, and when it does not block, it is not in any measured number.
    const onTop = [placement('other', 5_100, 3_000)];
    expect(
      optimise({ current: [placement('s1', 5_000, 3_000)], existing: onTop }).outcome,
    ).toBe('blocked');
    expect(optimise({ existing: other }).current?.constraints[0]?.measured).toBe(AWKWARD.length);
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
    expect(commandsFor(same, same, fixtureCatalog())).toEqual([]);
  });

  it('assigns each machine to its nearest target, so moves are short', () => {
    const current = [placement('a', 1_000, 1_000), placement('b', 5_000, 1_000)];
    const target = [placement('x', 5_200, 1_000), placement('y', 1_200, 1_000)];

    const commands = commandsFor(current, target, fixtureCatalog());
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
    expect(JSON.stringify(commandsFor(current, target, fixtureCatalog()))).toBe(
      JSON.stringify(commandsFor(current, target, fixtureCatalog())),
    );
  });

  it("matches by the true centre, not the corner — a rotation that shares a corner is not a non-move", () => {
    /*
     * Found by the third CTO review of this arc: reverting `centreOf` to `transform.position` left
     * every existing test passing, because none of them gave a rotated candidate the same corner as
     * an unrotated one.
     *
     * The bed (1,000 x 2,100, front-left) sitting at `source` has its corner at (0, 0) and its true
     * centre at (500, 1,050). `trap` shares that exact corner but is turned 90° — its centre is at
     * (-1,050, 500), 2,100 mm from `source`'s. `moved` sits 1,000 mm away at the same rotation, so
     * its centre is only 1,000 mm from `source`'s.
     *
     * A corner-anchored assignment sees `trap` at distance 0 — the same corner, therefore "no move
     * at all" — and claims it over `moved`, even though the bed's footprint swept a quarter turn.
     * The correct, centre-anchored assignment recognises `moved` as the nearer match.
     */
    const source: Placement = {
      id: 'source',
      equipmentObjectId: 'fixture_bed',
      equipmentObjectVersion: '1.0.0',
      label: 'source',
      transform: { position: { x: 0, y: 0 }, rotation: 0, mirrored: false },
      spaceId: null,
    };
    const trap: Placement = {
      id: 'trap',
      equipmentObjectId: 'fixture_bed',
      equipmentObjectVersion: '1.0.0',
      label: 'trap',
      transform: { position: { x: 0, y: 0 }, rotation: 90_000, mirrored: false },
      spaceId: null,
    };
    const moved: Placement = {
      id: 'moved',
      equipmentObjectId: 'fixture_bed',
      equipmentObjectVersion: '1.0.0',
      label: 'moved',
      transform: { position: { x: 1_000, y: 0 }, rotation: 0, mirrored: false },
      spaceId: null,
    };

    const diff = diffPlacements([source], [trap, moved], fixtureCatalog());

    const movedEntry = diff.find((entry) => entry.placement.id === 'moved');
    const trapEntry = diff.find((entry) => entry.placement.id === 'trap');
    expect(movedEntry?.source?.id).toBe('source');
    expect(trapEntry?.change).toBe('added');
  });

  /*
   * The converse of the test above, and the case it left open.
   *
   * That one covers a shared **corner** with different centres. This one covers a shared **centre**
   * with different corners: a machine turned about its own centre. `assignNearest` reports distance
   * 0 for it — correctly, the centre did not move — and the old code read that scalar as "nothing
   * changed", so it emitted the rotation without the move and called the entry `unchanged`.
   *
   * The bed is 1,000 x 2,100 with a front-left origin. At `(0, 0)` unrotated its centre is
   * (500, 1,050). `transformForCentre` puts the same centre under a 90° turn at corner (1,550, 550).
   * Same centre, different corner, and a rotation the drawing must actually perform.
   */
  it('emits the move for a machine turned about its own centre, and calls it a change', () => {
    const catalog = fixtureCatalog();
    const bed = catalog.get('fixture_bed')!;

    const source: Placement = {
      id: 'source',
      equipmentObjectId: 'fixture_bed',
      equipmentObjectVersion: '1.0.0',
      label: 'source',
      transform: { position: { x: 0, y: 0 }, rotation: 0, mirrored: false },
      spaceId: null,
    };
    const centre = footprintCentre(bed, source.transform);
    const turned: Placement = {
      ...source,
      id: 'turned',
      label: 'turned',
      transform: transformForCentre(bed, centre, 90_000),
    };

    // The premise: same centre, different corner. If this ever stops holding the test below is
    // measuring something else.
    expect(footprintCentre(bed, turned.transform)).toEqual(centre);
    expect(turned.transform.position).not.toEqual(source.transform.position);

    const commands = commandsFor([source], [turned], catalog);
    const kinds = commands.map((command) => command.type);

    // Both, and the move carries the corner the proposal actually specifies. Emitting the rotation
    // alone left the machine 1,644.7 mm from where it was scored.
    expect(kinds).toContain('placement.move');
    expect(kinds).toContain('placement.rotate');
    const move = commands.find((command) => command.type === 'placement.move');
    expect((move?.payload as { position: Vec2 }).position).toEqual(turned.transform.position);

    // And the panel must not call it unchanged, or the ghost layer draws nothing and the reducer
    // skips it.
    const diff = diffPlacements([source], [turned], catalog);
    expect(diff[0]?.change).toBe('moved');
  });

  it('refuses a proposal that changes "mirrored", which no command can carry', () => {
    const catalog = fixtureCatalog();
    const source = placement('a', 1_000, 1_000);
    const flipped: Placement = {
      ...source,
      id: 'flipped',
      transform: { ...source.transform, mirrored: true },
    };

    expect(() => commandsFor([source], [flipped], catalog)).toThrow(/mirrored/);
  });
});
