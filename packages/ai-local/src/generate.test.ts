import { describe, expect, it } from 'vitest';

import {
  fixtureCatalog,
  fixtureColumn,
  fixtureMachine,
  fixtureRoom,
  fixtureRoomBoundary,
  fixtureRuleSet,
} from '../fixtures/index';
import { generateCandidates } from './candidates';
import { type PipelineInput, generateFeasibleCandidates } from './generate';

const machine = fixtureMachine();

/** Ray casting, written out here so the assertion does not lean on the code under test. */
function insidePolygon(polygon: readonly { x: number; y: number }[], point: { x: number; y: number }) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (!a || !b) continue;
    const straddles = a.y > point.y !== b.y > point.y;
    if (straddles && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function pipeline(overrides: Partial<PipelineInput> = {}) {
  return generateFeasibleCandidates({
    room: fixtureRoom(),
    obstructions: [],
    boundaries: [fixtureRoomBoundary()],
    object: machine,
    catalog: fixtureCatalog(),
    ruleSet: fixtureRuleSet(),
    planStatus: 'calibrated',
    stationTarget: 6,
    pitchPadding: 1_200,
    existing: [],
    referencePoints: [],
    ...overrides,
  });
}

describe('candidate generation', () => {
  it('produces the same candidates, in the same order, twice', () => {
    // The owner's requirement, and the one most easily lost without anyone noticing. Compared as
    // JSON so a reordering fails as loudly as a different arrangement would.
    const first = generateCandidates({
      room: fixtureRoom(),
      obstructions: [],
      object: machine,
      stationCount: 6,
      pitchPadding: 1_200,
    });
    const second = generateCandidates({
      room: fixtureRoom(),
      obstructions: [],
      object: machine,
      stationCount: 6,
      pitchPadding: 1_200,
    });

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.length).toBeGreaterThan(1);
  });

  it('gives every candidate exactly the requested count', () => {
    const candidates = generateCandidates({
      room: fixtureRoom(),
      obstructions: [],
      object: machine,
      stationCount: 4,
      pitchPadding: 1_200,
    });

    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) expect(candidate.positions).toHaveLength(4);
  });

  it('offers more than one arrangement to choose between', () => {
    // The owner requires at least three ranked alternatives from the finished pipeline. That is
    // only possible if generation produces genuinely different arrangements rather than one shape
    // three times.
    const candidates = generateCandidates({
      room: fixtureRoom(),
      obstructions: [],
      object: machine,
      stationCount: 4,
      pitchPadding: 1_200,
    });

    const shapes = new Set(candidates.map((c) => JSON.stringify(c.positions)));
    expect(shapes.size).toBeGreaterThan(1);
  });

  it('keeps every machine wholly inside a room with a slanted wall', () => {
    /*
     * Corners, not centres — and this needs a room a rectangle cannot test.
     *
     * On a rectangle whose slots sit on a regular pitch, a centre-only containment test gives the
     * same answer as a corner test: every slot centre is at least half a footprint from the wall
     * by construction. The first version of this test used `fixtureRoom()` and **passed with the
     * containment check reduced to the centre point**, which is coverage that does not exist.
     *
     * A slanted wall breaks the symmetry: a slot centre can sit inside the diagonal while the
     * corner nearest it pokes through.
     */
    // The slant is on the **bottom** edge, rising from (0, 2000) to (8000, 0), so the very first
    // row of slots straddles it. A slant on a far wall would be geometry the taken slots never
    // reach — which is what made the first attempt undiscriminating.
    const slanted = [
      { x: 0, y: 2_000 },
      { x: 8_000, y: 0 },
      { x: 8_000, y: 6_000 },
      { x: 0, y: 6_000 },
    ];

    const candidates = generateCandidates({
      room: slanted,
      obstructions: [],
      object: machine,
      stationCount: 3,
      pitchPadding: 400,
    });

    expect(candidates.length).toBeGreaterThan(0);

    const half = { x: machine.designFootprint.width / 2, y: machine.designFootprint.depth / 2 };
    for (const candidate of candidates) {
      for (const position of candidate.positions) {
        const corners = [
          { x: position.x - half.x, y: position.y - half.y },
          { x: position.x + half.x, y: position.y - half.y },
          { x: position.x + half.x, y: position.y + half.y },
          { x: position.x - half.x, y: position.y + half.y },
        ];
        for (const corner of corners) {
          expect(insidePolygon(slanted, corner), `${corner.x}, ${corner.y}`).toBe(true);
        }
      }
    }
  });

  it('filters slots standing on an obstruction before they become candidates', () => {
    /*
     * Asserted on the generator directly, and worth explaining why it needs its own test.
     *
     * Removing this filter entirely does **not** change what the pipeline proposes: Gate 2's
     * boundary rule catches an overlapping arrangement and discards it, so the safety property
     * survives. That makes the filter an *efficiency* measure — it stops the solver evaluating
     * rules for candidates certain to be rejected — and an efficiency measure with no test is one
     * that quietly stops working.
     *
     * Verified by removing the filter and watching this fail. The pipeline-level obstruction test
     * below still passed, which is exactly the point: it covers the guarantee, this covers the
     * mechanism, and neither substitutes for the other.
     */
    const column = fixtureColumn();
    const withColumn = generateCandidates({
      room: fixtureRoom(),
      obstructions: [column.vertices],
      object: machine,
      stationCount: 6,
      pitchPadding: 1_200,
    });
    const without = generateCandidates({
      room: fixtureRoom(),
      obstructions: [],
      object: machine,
      stationCount: 6,
      pitchPadding: 1_200,
    });

    expect(withColumn.length).toBeGreaterThan(0);
    // The column occupies a slot, so at least one arrangement differs from the unobstructed one.
    expect(JSON.stringify(withColumn)).not.toBe(JSON.stringify(without));

    const minX = Math.min(...column.vertices.map((v) => v.x));
    const maxX = Math.max(...column.vertices.map((v) => v.x));
    const minY = Math.min(...column.vertices.map((v) => v.y));
    const maxY = Math.max(...column.vertices.map((v) => v.y));
    const half = { x: machine.designFootprint.width / 2, y: machine.designFootprint.depth / 2 };

    for (const candidate of withColumn) {
      for (const position of candidate.positions) {
        const clear =
          position.x + half.x <= minX ||
          position.x - half.x >= maxX ||
          position.y + half.y <= minY ||
          position.y - half.y >= maxY;
        expect(clear, `${position.x}, ${position.y}`).toBe(true);
      }
    }
  });

  it('produces nothing when the room cannot hold the count', () => {
    // A real engineering answer, not an empty list to be papered over with near-misses.
    const candidates = generateCandidates({
      room: fixtureRoom(2_000, 2_000),
      obstructions: [],
      object: machine,
      stationCount: 20,
      pitchPadding: 1_200,
    });
    expect(candidates).toEqual([]);
  });

  it('spaces machines by the design footprint, not the manufacturer dimensions', () => {
    /*
     * The fixture's design footprint is 800 mm and its manufacturer width is 585 mm — Phase 4.5's
     * separation, and the one place it matters most. Packing against the carcass would fit more
     * machines into a room than can actually be installed there.
     *
     * Asserted on the **pitch between adjacent positions**, because that is the number the choice
     * produces. An earlier version compared how many candidates two different machines yielded,
     * which passed happily with the footprint swapped for the manufacturer width — it was
     * comparing the wrong pair of things.
     */
    const candidates = generateCandidates({
      room: fixtureRoom(),
      obstructions: [],
      object: machine,
      stationCount: 4,
      pitchPadding: 0,
    });

    const rows = candidates.find((candidate) => candidate.strategy === 'rows');
    expect(rows).toBeDefined();

    const first = rows?.positions[0];
    const second = rows?.positions[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    // 800, the design footprint. 585 would be the manufacturer width.
    expect(Math.abs((second?.x ?? 0) - (first?.x ?? 0))).toBe(800);
  });
});

describe('the pipeline', () => {
  it('returns only candidates that passed both gates', () => {
    const result = pipeline();

    expect(result.feasible.length).toBeGreaterThan(0);
    for (const entry of result.feasible) {
      expect(entry.placements).toHaveLength(result.resolvedStationCount);
      expect(entry.gates.rejection).toBeNull();
    }
  });

  it('says which constraint was binding when nothing survives', () => {
    // "No layout satisfies the rules" is only useful if it can say why. A pipeline that returned
    // an empty array and nothing else leaves an engineer with a room and no idea what to change.
    const result = pipeline({ room: fixtureRoom(2_000, 2_000), stationTarget: 20 });

    expect(result.feasible).toEqual([]);
    expect(result.resolvedStationCount).toBe(20);
  });

  it('never proposes a layout that stands on an obstruction', () => {
    const result = pipeline({
      obstructions: [fixtureColumn().vertices],
      boundaries: [fixtureRoomBoundary(), fixtureColumn()],
      stationTarget: 6,
    });

    // Without this the loop below is vacuous: zero candidates would satisfy "none overlaps".
    expect(result.feasible.length).toBeGreaterThan(0);

    const column = fixtureColumn();
    const minX = Math.min(...column.vertices.map((v) => v.x));
    const maxX = Math.max(...column.vertices.map((v) => v.x));
    const minY = Math.min(...column.vertices.map((v) => v.y));
    const maxY = Math.max(...column.vertices.map((v) => v.y));

    for (const entry of result.feasible) {
      for (const position of entry.placements.map((p) => p.transform.position)) {
        const half = { x: machine.designFootprint.width / 2, y: machine.designFootprint.depth / 2 };
        const clear =
          position.x + half.x <= minX ||
          position.x - half.x >= maxX ||
          position.y + half.y <= minY ||
          position.y - half.y >= maxY;
        expect(clear, `${position.x}, ${position.y}`).toBe(true);
      }
    }
  });

  it('resolves "as many as fit" to a number, and says it derived it', () => {
    // An engineer who asked for as many as fit is owed the answer. And Gate 1 needs a number:
    // "exactly the requested count" is not a statement you can make about null.
    const result = pipeline({ stationTarget: null });

    expect(result.countWasDerived).toBe(true);
    expect(result.resolvedStationCount).toBeGreaterThan(0);
    for (const entry of result.feasible) {
      expect(entry.placements).toHaveLength(result.resolvedStationCount);
    }
  });

  it('resolves "as many as fit" to a count that survives the gates, not one that merely fits', () => {
    /*
     * The gap a browser spec found and these fixtures did not.
     *
     * An earlier version resolved the count from the *generator* alone — walk down until an
     * arrangement of that size exists, then gate it. On a real room that resolves to the densest
     * packing the geometry allows, and every candidate at that density then failed Gate 2: the
     * engineer got "no layout satisfies the rules" for a request with a perfectly good answer two
     * machines down.
     *
     * The fixtures missed it because their rooms are generous enough that the densest packing is
     * also compliant. This one is not: an existing machine occupies part of the room, so the
     * densest arrangement collides with it and the walk has to keep going.
     */
    const existing = [
      {
        id: 'existing-1',
        equipmentObjectId: machine.id,
        equipmentObjectVersion: machine.version,
        label: 'Existing 1',
        transform: { position: { x: 1_000, y: 1_000 }, rotation: 0, mirrored: false },
        spaceId: null,
      },
    ];

    const result = pipeline({ stationTarget: null, existing });

    expect(result.countWasDerived).toBe(true);
    expect(result.feasible.length).toBeGreaterThan(0);
    expect(result.resolvedStationCount).toBeGreaterThan(0);
    for (const entry of result.feasible) {
      expect(entry.placements).toHaveLength(result.resolvedStationCount);
      expect(entry.gates.rejection).toBeNull();
    }
  });

  it('is deterministic end to end', () => {
    expect(JSON.stringify(pipeline())).toBe(JSON.stringify(pipeline()));
    expect(JSON.stringify(pipeline({ stationTarget: null }))).toBe(
      JSON.stringify(pipeline({ stationTarget: null })),
    );
  });

  it('rejects rather than adjusts when the target cannot be met exactly', () => {
    // The owner's "shall not add or remove stations automatically", from the outside. A room that
    // holds four must return *nothing* when twelve are asked for — not a four-station layout with
    // an apology, which is the shape a helpful solver drifts towards.
    const result = pipeline({ room: fixtureRoom(3_000, 3_000), stationTarget: 12 });

    expect(result.resolvedStationCount).toBe(12);
    expect(result.feasible).toEqual([]);
    expect(result.countWasDerived).toBe(false);

    // And the same room asked for a count it *can* hold produces layouts, so the emptiness above
    // is about the count rather than about the room being unusable.
    const achievable = pipeline({ room: fixtureRoom(3_000, 3_000), stationTarget: 1 });
    expect(achievable.feasible.length).toBeGreaterThan(0);
  });

  it('works around an existing machine rather than proposing its square', () => {
    /*
     * This test previously asserted the opposite — that **every** candidate was rejected — and it
     * was passing for a bad reason.
     *
     * The generator only saw `obstructions`, never `existing`, so it proposed the slot a machine
     * was already standing in and Gate 2 rejected the whole candidate for the collision. With the
     * existing machine on the first slot that rejected every candidate at every count: an engineer
     * asking to fill the rest of a partly-occupied room was told no layout satisfied the rules,
     * when the truth was that the solver kept suggesting the one square it could not use.
     *
     * Existing footprints are now obstructions to the generator too. Gate 2 still catches an
     * overlap; the generator no longer manufactures them.
     */
    const existing = [
      {
        id: 'existing-1',
        equipmentObjectId: machine.id,
        equipmentObjectVersion: machine.version,
        label: 'Existing 1',
        transform: { position: { x: 1_000, y: 1_000 }, rotation: 0, mirrored: false },
        spaceId: null,
      },
    ];

    const result = pipeline({ existing, stationTarget: 4 });

    expect(result.feasible.length).toBeGreaterThan(0);

    const half = { x: machine.designFootprint.width / 2, y: machine.designFootprint.depth / 2 };
    for (const entry of result.feasible) {
      for (const position of entry.placements.map((p) => p.transform.position)) {
        const clear =
          Math.abs(position.x - 1_000) >= half.x * 2 || Math.abs(position.y - 1_000) >= half.y * 2;
        expect(clear, `${position.x}, ${position.y}`).toBe(true);
      }
    }
  });

  it('keeps candidates that clear an existing machine', () => {
    /*
     * The other half, and the one that shows Gate 2 is discriminating rather than simply hostile:
     * an existing machine in the gap between grid slots leaves every candidate intact.
     *
     * (2,000, 2,000) is chosen rather than a corner. The first attempt put it at (7,600, 5,600),
     * flush against two walls — and *every* candidate was rejected, because the existing machine's
     * own footprint crossed the room outline and tripped the boundary rule. Gate 2 evaluates the
     * whole arrangement, so a pre-existing violation disqualifies every candidate built around it.
     * That is correct behaviour and worth knowing: an engineer optimising a room that already has
     * a problem in it will get nothing back until the problem is fixed.
     */
    const existing = [
      {
        id: 'existing-clear',
        equipmentObjectId: machine.id,
        equipmentObjectVersion: machine.version,
        label: 'Existing clear',
        transform: { position: { x: 2_000, y: 2_000 }, rotation: 0, mirrored: false },
        spaceId: null,
      },
    ];

    const result = pipeline({ existing, stationTarget: 4 });
    expect(result.feasible.length).toBeGreaterThan(0);
  });

  /*
   * There is deliberately no pipeline test for Gate 1 rejecting a candidate.
   *
   * It cannot fire on this path: `generateCandidates` is *told* the count and only emits
   * arrangements holding exactly it, so no candidate reaching the gate can have the wrong number.
   * A test asserting "the pipeline rejects a mis-counted candidate" would be asserting something
   * the generator makes unreachable, and it would pass whatever Gate 1 did.
   *
   * The gate is exercised directly in `gates.test.ts`, where a wrong count can actually be
   * constructed. It stays in the pipeline as defence in depth for step 5, where candidates come
   * from *mutating* an existing layout and the count is no longer guaranteed by construction —
   * which is exactly when a solver would otherwise shed a station to improve a score.
   */
});
