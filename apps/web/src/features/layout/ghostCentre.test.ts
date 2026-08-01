import { createCatalog } from '@mfd/object-library';
import type { Placement } from '@mfd/document-model';
import { describe, expect, it } from 'vitest';

import { ghostCentre } from './ghostCentre';

const DRAFT_GROUP = {
  status: 'draft',
  source: { document: null, revision: null, section: null, type: 'estimate', lastUpdated: '2026-08-01' },
};

/** An 800 x 800, front-left station — same inline shape `movedArrowTail.test.ts` uses. */
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

function placementAt(position: { x: number; y: number }, rotation = 0): Placement {
  return {
    id: 'p',
    equipmentObjectId: 'test_station',
    equipmentObjectVersion: '1.0.0',
    label: 'p',
    transform: { position, rotation, mirrored: false },
    spaceId: null,
  };
}

describe('ghostCentre — Critical 0 regression (sixth review round)', () => {
  it("is the ghost's true centre, not its corner — discriminates two placements sharing one corner at different rotations", () => {
    // Both placements share the exact corner (1,000, 1,000): a corner-anchored anchor could not
    // tell them apart. Their true centres do differ, because rotation moves where that corner
    // sends the footprint's middle — proving this reads the rotated centre, not the raw position.
    const catalog = stationCatalog();
    const unrotated = ghostCentre(placementAt({ x: 1_000, y: 1_000 }, 0), catalog);
    const rotated = ghostCentre(placementAt({ x: 1_000, y: 1_000 }, 90_000), catalog);

    expect(unrotated).toEqual({ x: 1_400, y: 1_400 });
    expect(rotated).not.toEqual(unrotated);
    expect(rotated).not.toEqual({ x: 1_000, y: 1_000 });
  });

  it('is null, not the corner, when the catalogue has nothing for the placement', () => {
    const catalog = stationCatalog();
    const placement: Placement = {
      ...placementAt({ x: 1_000, y: 1_000 }),
      equipmentObjectId: 'unknown_object',
    };

    expect(ghostCentre(placement, catalog)).toBeNull();
  });
});
