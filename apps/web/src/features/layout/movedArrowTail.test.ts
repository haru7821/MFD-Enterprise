import { createCatalog } from '@mfd/object-library';
import type { Placement } from '@mfd/document-model';
import { describe, expect, it } from 'vitest';

import { movedArrowTail } from './movedArrowTail';

const DRAFT_GROUP = {
  status: 'draft',
  source: { document: null, revision: null, section: null, type: 'estimate', lastUpdated: '2026-08-01' },
};

/** An 800 x 800, front-left station — inline, the same fixture shape used by
 *  `runPlanner.test.ts` for the same reason: this file cannot reach `packages/ai-local`'s
 *  fixtures, and the shape itself is what the test is about. */
function stationCatalog() {
  return createCatalog([
    {
      fileName: 'test_station.json',
      raw: {
        id: 'test_station',
        manufacturer: 'Test',
        model: 'TS-1',
        category: 'dialysis_machine',
        version: '1.0.0',
        manufacturerDimensions: { width: 585, depth: 620, height: 1_305, weight: null, verification: DRAFT_GROUP },
        planningFootprint: { width: 800, depth: 800, basis: null },
        connections: {
          power: { required: true, specification: null, verification: DRAFT_GROUP },
          roWater: { required: true, specification: null, verification: DRAFT_GROUP },
          drain: { required: true, specification: null, verification: DRAFT_GROUP },
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

describe('movedArrowTail — Critical 0 regression (fifth review round)', () => {
  it("is the source's true centre, not its corner — non-degenerate under a pure rotation about a shared corner", () => {
    // The exact case the fourth review's other three tests use: a rotation about a shared corner
    // must not read as "no movement". Here that means the arrow's tail must actually differ from
    // its head — a corner-anchored tail at (1,000, 1,000) would equal `centre`'s corner too, but
    // the true tail (1,400, 1,400) and the true head (600, 1,400) are 800 mm apart.
    const catalog = stationCatalog();
    const source: Placement = {
      id: 'source',
      equipmentObjectId: 'test_station',
      equipmentObjectVersion: '1.0.0',
      label: 'source',
      transform: { position: { x: 1_000, y: 1_000 }, rotation: 0, mirrored: false },
      spaceId: null,
    };

    expect(movedArrowTail(source, catalog)).toEqual({ x: 1_400, y: 1_400 });
  });

  it('is null, not the corner, when the catalogue has nothing for the source', () => {
    const catalog = stationCatalog();
    const source: Placement = {
      id: 'source',
      equipmentObjectId: 'unknown_object',
      equipmentObjectVersion: '1.0.0',
      label: 'source',
      transform: { position: { x: 1_000, y: 1_000 }, rotation: 0, mirrored: false },
      spaceId: null,
    };

    expect(movedArrowTail(source, catalog)).toBeNull();
  });

  it('is null when there is no source at all — an added ghost has nothing to draw from', () => {
    expect(movedArrowTail(null, stationCatalog())).toBeNull();
  });
});
