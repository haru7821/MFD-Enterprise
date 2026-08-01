import { createCatalog } from '@mfd/object-library';
import type { Placement } from '@mfd/document-model';
import { describe, expect, it } from 'vitest';

import { withinRoom } from './runSolver';

const DRAFT_GROUP = {
  status: 'draft',
  source: { document: null, revision: null, section: null, type: 'estimate', lastUpdated: '2026-08-01' },
};

/** A bed-shaped record — 1,000 x 2,100, front-left, frontEdge south — built inline: this file
 *  cannot reach `packages/ai-local`'s fixtures, and the shape itself is what the test is about. */
function bedCatalog() {
  return createCatalog([
    {
      fileName: 'test_bed.json',
      raw: {
        id: 'test_bed',
        manufacturer: 'Test',
        model: 'TB-1',
        category: 'treatment_bed',
        version: '1.0.0',
        manufacturerDimensions: { width: 900, depth: 2000, height: 700, weight: null, verification: DRAFT_GROUP },
        planningFootprint: { width: 1_000, depth: 2_100, basis: null },
        connections: {
          power: { required: false, specification: null, verification: DRAFT_GROUP },
          roWater: { required: false, specification: null, verification: DRAFT_GROUP },
          drain: { required: false, specification: null, verification: DRAFT_GROUP },
        },
        serviceClearance: { front: null, rear: null, left: null, right: null, verification: DRAFT_GROUP },
        environmental: { specification: null, verification: DRAFT_GROUP },
        maintenanceAccess: { front: null, rear: null, left: null, right: null, verification: DRAFT_GROUP },
        portLocations: { power: null, roWater: null, drain: null, verification: DRAFT_GROUP },
        installationRouting: { specification: null, verification: DRAFT_GROUP },
        symbol: { origin: 'front-left', outline: 'rectangle', frontEdge: 'south' },
      },
    },
  ]);
}

describe('withinRoom — Critical 0 regression', () => {
  it("classifies a machine by its true centre, not its front-left corner's position", () => {
    /*
     * Critical 0 review (round 5)'s discriminating case: a 1,000 x 2,100 bed placed at
     * (7,900, 400) in an 8,000 x 8,000 room. Its `transform.position` — the front-left corner —
     * sits at (7,900, 400), comfortably inside the room. Its true centre, `footprintBounds`'
     * bounding-box midpoint, is (8,400, 1,450): 400 mm past the room's east wall. A corner-based
     * test — what `withinRoom` used to be — says this bed is inside; the room, and most of the
     * bed's own footprint, disagree.
     */
    const catalog = bedCatalog();
    const room = [
      { x: 0, y: 0 },
      { x: 8_000, y: 0 },
      { x: 8_000, y: 8_000 },
      { x: 0, y: 8_000 },
    ];
    const placement: Placement = {
      id: 'bed-1',
      equipmentObjectId: 'test_bed',
      equipmentObjectVersion: '1.0.0',
      label: 'Bed 1',
      transform: { position: { x: 7_900, y: 400 }, rotation: 0, mirrored: false },
      spaceId: null,
    };

    expect(withinRoom(placement, room, catalog)).toBe(false);
  });

  it('classifies a machine well inside the room as inside, on the same corner-vs-centre axis', () => {
    // The positive control: move the same bed 1,000 mm west, so both its corner and its true
    // centre (7,400, 1,450) sit inside the room. Confirms the assertion above is about the
    // room's edge, not about `withinRoom` refusing every bed.
    const catalog = bedCatalog();
    const room = [
      { x: 0, y: 0 },
      { x: 8_000, y: 0 },
      { x: 8_000, y: 8_000 },
      { x: 0, y: 8_000 },
    ];
    const placement: Placement = {
      id: 'bed-1',
      equipmentObjectId: 'test_bed',
      equipmentObjectVersion: '1.0.0',
      label: 'Bed 1',
      transform: { position: { x: 6_900, y: 400 }, rotation: 0, mirrored: false },
      spaceId: null,
    };

    expect(withinRoom(placement, room, catalog)).toBe(true);
  });
});
