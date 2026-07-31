import { describe, expect, it } from 'vitest';

import type { ReferencePointSummary } from '@mfd/ai-contract';
import { dialysisScoringModel } from '@mfd/ai-contract/scoring';

import {
  fixtureCatalog,
  fixtureMachine,
  fixtureRoom,
  fixtureRoomBoundary,
  fixtureRuleSet,
} from '../fixtures/index';
import { rankLayouts } from './rank';

/**
 * The design target: **50 dialysis stations, and still interactive.**
 *
 * The solver runs in a click handler on the main thread, so "interactive" means an engineer does
 * not watch a frozen editor. Measured rather than assumed, because the pipeline does a lot per
 * candidate: generate, evaluate every rule, then measure eight criteria including routed distances.
 *
 * ## Why the ceiling is so much larger than the measurement
 *
 * Observed on this machine: ~260 ms for an explicit 50, ~640 ms for "as many as fit" (which walks
 * down from 70). The assertions allow **five seconds**.
 *
 * That is deliberate. A budget set just above the observed time is a flaky test on a shared CI
 * runner, and a flaky gate gets muted — at which point it protects nothing. Five seconds still
 * catches the regression that matters: an accidental O(n²) in the routing or a lost early exit,
 * which would cost an order of magnitude rather than a few per cent.
 */

const machine = fixtureMachine();

/** A ward with room for well over fifty stations at a 2 m pitch. */
const WARD = { width: 20_000, depth: 14_000 };

const POINTS: ReferencePointSummary[] = [
  { id: 'ro', kind: 'ro_supply', position: { x: 0, y: 0 } },
  { id: 'panel', kind: 'electrical_panel', position: { x: WARD.width, y: 0 } },
  { id: 'drain', kind: 'drain', position: { x: 0, y: WARD.depth } },
  { id: 'entry', kind: 'access_entry', position: { x: WARD.width / 2, y: 0 } },
  { id: 'staff', kind: 'staff_base', position: { x: WARD.width / 2, y: WARD.depth } },
];

const BUDGET_MS = 5_000;

function ward(stationTarget: number | null, obstructions: { x: number; y: number }[][] = []) {
  return rankLayouts({
    room: fixtureRoom(WARD.width, WARD.depth),
    obstructions,
    boundaries: [fixtureRoomBoundary(WARD.width, WARD.depth)],
    object: machine,
    catalog: fixtureCatalog(),
    ruleSet: fixtureRuleSet(),
    planStatus: 'calibrated',
    stationTarget,
    pitchPadding: 1_200,
    existing: [],
    referencePoints: POINTS,
    scoring: dialysisScoringModel,
  });
}

describe('the 50-station design target', () => {
  it('ranks fifty stations within the interaction budget', () => {
    const started = Date.now();
    const result = ward(50);
    const elapsed = Date.now() - started;

    expect(result.layouts.length).toBeGreaterThan(0);
    expect(result.resolvedStationCount).toBe(50);
    expect(elapsed, `${elapsed} ms`).toBeLessThan(BUDGET_MS);
  });

  it('resolves "as many as fit" in a ward within the budget', () => {
    // The expensive path: the whole pipeline runs at each count on the way down from the ceiling.
    const started = Date.now();
    const result = ward(null);
    const elapsed = Date.now() - started;

    expect(result.resolvedStationCount).toBeGreaterThanOrEqual(50);
    expect(elapsed, `${elapsed} ms`).toBeLessThan(BUDGET_MS);
  });

  it('stays within budget when routing has to search around an obstruction', () => {
    /*
     * The one case that reaches the lattice search. Both L-routes from the RO origin are blocked by
     * a wall spanning most of the ward, so every machine's pipe run is a breadth-first search.
     */
    const wall = [
      { x: 0, y: 400 },
      { x: WARD.width - 2_000, y: 400 },
      { x: WARD.width - 2_000, y: 900 },
      { x: 0, y: 900 },
    ];

    const started = Date.now();
    const result = ward(50, [wall]);
    const elapsed = Date.now() - started;

    expect(result.layouts.length).toBeGreaterThan(0);
    expect(elapsed, `${elapsed} ms`).toBeLessThan(BUDGET_MS);
  });
});
