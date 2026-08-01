import { createBoundary } from '@mfd/document-model';
import { footprintCorners } from '@mfd/object-library';
import { describe, expect, it } from 'vitest';

import { fixtureCatalog, fixtureKnowledge, fixtureMachine, fixtureRuleSet } from '../fixtures/index';
import { generateFeasibleCandidates } from './generate';

/**
 * Critical 0 — the coordinate-system contract (AD-21).
 *
 * `transform.position` is where an object's local `(0, 0)` sits, and `symbol.origin` says where
 * that is on the footprint — never assumed to be the centre. Every shipped, `front-left` record has
 * it at the corner. `generate.ts`'s `occupiedPolygons` and `placementsFor` used to assume the
 * centre, silently misplacing every candidate and every avoided obstruction by half a footprint.
 *
 * These are not unit tests of one function — they drive the same placement through the pipeline
 * stages the owner named: generation, gating, and a serialize/reload round trip, checking that its
 * occupied polygon never changes underneath it.
 */
describe('coordinate contract — one placement, the same occupied polygon everywhere', () => {
  it("avoids a rotated existing machine's true footprint, not an unrotated guess at its size", () => {
    /*
     * The bed (1,000 x 2,100, `front-left`, `frontEdge: south`) turned 90° at (3,000, 3,000) has a
     * true occupied footprint of x ∈ [900, 3,000], y ∈ [3,000, 4,000] — `footprintCorners`, not a
     * hand re-derivation.
     *
     * The old `occupiedPolygons` read `transform.position` as the footprint's *centre* and built a
     * box from the *unrotated* width/depth: centred on (3,000, 3,000), x ∈ [2,500, 3,500],
     * y ∈ [1,950, 4,050] — the wrong shape, in the wrong place.
     *
     * The room is shifted so the packer's very first grid slot for a new station, (1,000, 3,000),
     * lands where the two boxes disagree: inside the bed's true footprint (so a correct avoidance
     * zone excludes it) but outside the old, wrong one (so the old code would have offered it up).
     * Requesting exactly one station forces every strategy to either skip that slot or hand it to
     * Gate 2 as the sole candidate — so the old code fails this deterministically: Gate 2 correctly
     * rejects the resulting overlap, `usable.slice(0, 1)` had nothing else to fall back to, and
     * `feasible` comes back empty. Confirmed by reintroducing the old computation and rerunning this
     * test — see the Critical 0 report.
     */
    const bed = fixtureCatalog().get('fixture_bed');
    if (!bed) throw new Error('fixture catalogue did not contain fixture_bed');
    const station = fixtureMachine();

    const room = [
      { x: 0, y: 2_000 },
      { x: 8_000, y: 2_000 },
      { x: 8_000, y: 10_000 },
      { x: 0, y: 10_000 },
    ];
    const boundary = createBoundary('boundary-room', 'space_outline', room, 'Ward');

    const bedTransform = { position: { x: 3_000, y: 3_000 }, rotation: 90_000, mirrored: false };
    const existing = [
      {
        id: 'bed-1',
        equipmentObjectId: bed.id,
        equipmentObjectVersion: bed.version,
        label: 'Bed 1',
        transform: bedTransform,
        spaceId: null,
      },
    ];

    const result = generateFeasibleCandidates({
      room,
      obstructions: [],
      boundaries: [boundary],
      object: station,
      catalog: fixtureCatalog(),
      ruleSet: fixtureRuleSet(),
      planStatus: 'calibrated',
      stationTarget: 1,
      pitchPadding: 1_200,
      knowledge: fixtureKnowledge(),
      existing,
      referencePoints: [],
    });

    expect(result.feasible.length).toBeGreaterThan(0);

    // Belt and braces: whichever slot was actually chosen, it must not overlap the bed's real,
    // rotated footprint — checked independently, via bounding boxes, since every shape here is
    // axis-aligned at this rotation.
    const bedCorners = footprintCorners(bed, bedTransform);
    const bedBox = {
      minX: Math.min(...bedCorners.map((p) => p.x)),
      maxX: Math.max(...bedCorners.map((p) => p.x)),
      minY: Math.min(...bedCorners.map((p) => p.y)),
      maxY: Math.max(...bedCorners.map((p) => p.y)),
    };

    for (const candidate of result.feasible) {
      for (const placement of candidate.placements) {
        const corners = footprintCorners(station, placement.transform);
        const box = {
          minX: Math.min(...corners.map((p) => p.x)),
          maxX: Math.max(...corners.map((p) => p.x)),
          minY: Math.min(...corners.map((p) => p.y)),
          maxY: Math.max(...corners.map((p) => p.y)),
        };
        const overlaps =
          box.minX < bedBox.maxX &&
          box.maxX > bedBox.minX &&
          box.minY < bedBox.maxY &&
          box.maxY > bedBox.minY;
        expect(overlaps, `${placement.id} at ${JSON.stringify(placement.transform.position)}`).toBe(
          false,
        );
      }
    }
  });

  it('keeps a rotated placement\'s occupied polygon identical across a serialize/reload round trip', () => {
    // The owner's fifth leg: "serializes, reloads — without changing its occupied polygon." A
    // `Transform` is plain JSON-safe numbers, so the round trip is a triviality to *state* — the
    // point is that it is stated and checked, not assumed, against the same function every real
    // consumer (renderer, rule engine, report) calls to find the polygon.
    const bed = fixtureCatalog().get('fixture_bed');
    if (!bed) throw new Error('fixture catalogue did not contain fixture_bed');

    const transform = { position: { x: 3_000, y: 3_000 }, rotation: 90_000, mirrored: false };
    const before = footprintCorners(bed, transform);

    const reloaded = JSON.parse(JSON.stringify(transform));
    const after = footprintCorners(bed, reloaded);

    expect(after).toEqual(before);
  });
});
