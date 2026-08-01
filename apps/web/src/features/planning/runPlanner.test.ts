import { createCatalog } from '@mfd/object-library';
import type { Level, Placement } from '@mfd/document-model';
import { createObstruction } from '@mfd/document-model';
import { describe, expect, it } from 'vitest';

import { routeAll } from './runPlanner';

const DRAFT_GROUP = {
  status: 'draft',
  source: { document: null, revision: null, section: null, type: 'estimate', lastUpdated: '2026-08-01' },
};

/** An 800 x 800, front-left station — inline, since this file cannot reach `packages/ai-local`'s
 *  fixtures and the shape itself is what the test is about. */
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

function levelWith(placements: Placement[]): Level {
  return {
    id: 'level-1',
    name: 'Level 1',
    elevation: 0,
    planImage: null,
    coordinateMapping: null,
    // Encloses (400, 400) and stops well short of (-400, -400).
    boundaries: [
      createObstruction(
        'wall',
        'column',
        [
          { x: -100, y: -100 },
          { x: 1_000, y: -100 },
          { x: 1_000, y: 1_000 },
          { x: -100, y: 1_000 },
        ],
        'Blocker',
      ),
    ],
    spaces: [],
    placements,
    referencePoints: [
      { id: 'panel', kind: 'electrical_panel', position: { x: -3_000, y: -3_000 }, label: null },
    ],
  };
}

describe('routeAll — Critical 0 regression (third review round)', () => {
  it("routes to a placement's true centre, not its shared corner — proven by a pure rotation", () => {
    /*
     * Found by the third CTO review of this arc: reverting `centreOrPosition` to
     * `placement.transform.position` left every existing test passing, because none of them gave a
     * rotated placement the same corner as an unrotated one.
     *
     * Both placements share the exact corner (0, 0). `upright` (0°) has its true centre at
     * (400, 400); `turned` (180°) has its centre at (-400, -400) — the same footprint, swept to the
     * opposite side of that shared corner by a pure rotation. A corner-anchored router would send
     * the cable run to (0, 0) for both, so both would get an identical routed length. The
     * obstruction below encloses (400, 400) and stops well short of (-400, -400), so a
     * centre-anchored router reports a route for exactly one of the two.
     */
    const catalog = stationCatalog();
    const upright: Placement = {
      id: 'upright',
      equipmentObjectId: 'test_station',
      equipmentObjectVersion: '1.0.0',
      label: 'upright',
      transform: { position: { x: 0, y: 0 }, rotation: 0, mirrored: false },
      spaceId: null,
    };
    const turned: Placement = {
      id: 'turned',
      equipmentObjectId: 'test_station',
      equipmentObjectVersion: '1.0.0',
      label: 'turned',
      transform: { position: { x: 0, y: 0 }, rotation: 180_000, mirrored: false },
      spaceId: null,
    };

    const level = levelWith([upright, turned]);
    const routed = routeAll(level, catalog);

    const power = routed.filter((entry) => entry.service === 'power');
    const uprightRoute = power.find((entry) => entry.placementId === 'upright');
    const turnedRoute = power.find((entry) => entry.placementId === 'turned');

    // The obstruction sits over `upright`'s true centre: no route reaches it. `turned`'s centre is
    // untouched: it gets a route. A corner-anchored router could not tell these two apart.
    expect(uprightRoute).toBeUndefined();
    expect(turnedRoute).toBeDefined();
  });
});
