import { describe, expect, it } from 'vitest';

import type { Placement } from '@mfd/document-model';

import {
  fixtureCatalog,
  fixtureColumn,
  fixtureMachine,
  fixtureRoomBoundary,
  fixtureRuleSet,
} from '../fixtures/index';
import { applyGates, passesStationCountGate } from './gates';

/**
 * The two hard gates.
 *
 * > Owner: *"Rule violations shall never be compensated by optimization scores."*
 *
 * These are the tests that hold that sentence up. Everything else in the solver can be argued
 * about; a gate that lets something through cannot.
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

function gate(placements: readonly Placement[], requested: number) {
  return applyGates(
    {
      placements,
      catalog: fixtureCatalog(),
      ruleSet: fixtureRuleSet(),
      boundaries: [fixtureRoomBoundary(), fixtureColumn()],
      planStatus: 'calibrated',
    },
    placements.length,
    requested,
  );
}

describe('Gate 1 — exactly the requested station count', () => {
  it('passes a candidate holding exactly the requested number', () => {
    expect(passesStationCountGate(12, 12)).toBeNull();
  });

  it('rejects too few', () => {
    expect(passesStationCountGate(11, 12)).toEqual({
      code: 'GX-101',
      detail: { expected: 12, actual: 11 },
    });
  });

  it('rejects too many, which is the half that is easy to leave out', () => {
    // Every scored criterion improves as machines are removed, so the *shedding* failure is the
    // one everybody thinks of. Adding one unasked is the mirror image and produces a layout the
    // engineer did not request and may have no room to commission.
    expect(passesStationCountGate(13, 12)).toEqual({
      code: 'GX-102',
      detail: { expected: 12, actual: 13 },
    });
  });

  it('runs before the compliance gate, and short-circuits it', () => {
    // Two machines on the same spot violate the collision rule, so this candidate would fail
    // Gate 2 as well. The reported code must be the count one: gates run in the owner's order,
    // and evaluating rules for a candidate already rejected is work whose answer cannot matter.
    const outcome = gate([placement('a', 1_000, 1_000), placement('b', 1_000, 1_000)], 5);
    expect(outcome.violations[0]?.code).toBe('GX-101');
  });
});

describe('Gate 2 — no mandatory violation', () => {
  it('passes a compliant layout', () => {
    const outcome = gate([placement('a', 1_000, 1_000), placement('b', 4_000, 1_000)], 2);
    expect(outcome.violations).toEqual([]);
  });

  it('rejects a layout whose machines overlap', () => {
    const outcome = gate([placement('a', 1_000, 1_000), placement('b', 1_200, 1_000)], 2);
    expect(outcome.violations[0]?.code).toBe('GX-201');
    expect(outcome.violations[0]?.detail.ruleId).toBe('fixture_overlap');
  });

  it('rejects a layout standing on a column', () => {
    // The boundary rule, so an obstruction is as disqualifying as another machine.
    const outcome = gate([placement('a', 3_300, 2_800)], 1);
    expect(outcome.violations[0]?.code).toBe('GX-201');
  });

  it('does not reject a layout merely for being unverifiable', () => {
    /*
     * The distinction that makes this gate usable at all, and the one most likely to be got
     * wrong. YELLOW means "review required", and on this product it is overwhelmingly produced by
     * *missing data*: every clearance finding reads YELLOW because the AK98 manual has not been
     * supplied (A-1), and every result on an uncalibrated level is downgraded to YELLOW whatever
     * it was.
     *
     * A gate written as `level !== 'GREEN'` would therefore reject **every** candidate on every
     * project this product currently has, and report "no layout satisfies the rules" when it
     * means "nobody has given me a threshold to check against".
     */
    const outcome = applyGates(
      {
        placements: [placement('a', 1_000, 1_000), placement('b', 4_000, 1_000)],
        catalog: fixtureCatalog(),
        ruleSet: fixtureRuleSet(),
        boundaries: [fixtureRoomBoundary(), fixtureColumn()],
        // Uncalibrated: every GREEN becomes YELLOW. Nothing here is a violation.
        planStatus: 'uncalibrated',
      },
      2,
      2,
    );

    expect(outcome.violations).toEqual([]);
    expect(outcome.reviewCount).toBeGreaterThan(0);
  });

  it('reports every violation and not only the first', () => {
    /*
     * > Owner decision, D1: *"Display blocking rule violations first."*
     *
     * The solver only needs to know a candidate is dead. The layout an engineer **drew** is the
     * other caller, and there the whole list is the work: telling them about one rule, then about
     * the next after they fix it, is the same conversation held once per violation.
     *
     * Three machines stacked on one another and standing on the column: more than one mandatory
     * rule broken, by more than one placement.
     */
    const outcome = gate(
      [placement('a', 3_300, 2_800), placement('b', 3_350, 2_800), placement('c', 3_400, 2_800)],
      3,
    );

    expect(outcome.violations.length).toBeGreaterThan(1);
    for (const violation of outcome.violations) {
      expect(violation.code).toBe('GX-201');
      expect(violation.detail.ruleId).toBeTruthy();
    }
  });

  it('reports how much of the compliance it actually established', () => {
    // A candidate with no RED and a page of YELLOWs has passed the gate and had almost nothing
    // verified. Carrying the counts is what lets a proposal say so rather than read as cleared.
    const outcome = gate([placement('a', 1_000, 1_000), placement('b', 4_000, 1_000)], 2);
    expect(outcome.violations).toEqual([]);
    expect(outcome.reviewCount).toBeGreaterThan(0);
  });
});
