import { describe, expect, it } from 'vitest';

import type { Level } from '@mfd/document-model';

import { fixtureCatalog } from '../fixtures/index';
import { buildFloorPlan } from './floorPlan';

/**
 * Found by the third CTO review of the Critical 0 arc: nothing guarded the schedule's position
 * column switching from `transform.position` to the footprint's true centre — reverting it to the
 * corner left every existing test passing, because none of them compared the printed number
 * against a rotation-dependent expectation.
 */
describe("buildFloorPlan — the schedule's position column", () => {
  it("prints a placement's true centre, not its transform.position corner", () => {
    const catalog = fixtureCatalog();
    const object = catalog.get('fixture_machine');
    if (!object) throw new Error('fixture catalogue did not contain fixture_machine');

    const level: Level = {
      id: 'level-1',
      name: 'Level 1',
      elevation: 0,
      planImage: null,
      coordinateMapping: null,
      boundaries: [],
      spaces: [],
      placements: [
        {
          id: 'p1',
          equipmentObjectId: object.id,
          equipmentObjectVersion: object.version,
          label: 'p1',
          // front-left, 800 x 800: the corner is (1,000, 1,000), the true centre (1,400, 1,400).
          transform: { position: { x: 1_000, y: 1_000 }, rotation: 0, mirrored: false },
          spaceId: null,
        },
      ],
      referencePoints: [],
    };

    const section = buildFloorPlan(level, catalog);
    const row = section.placements[0];

    expect(row?.position).toEqual({ x: 1_400, y: 1_400 });
  });

  it('rotates the printed position with the placement, since the centre does', () => {
    // The property AD-21 exists to make visible: a pure rotation about a shared corner moves the
    // true centre even though `transform.position` never changes. Turned 90°, the same corner
    // (1,000, 1,000) puts the centre at (600, 1,400) instead — a different point, from a rotation
    // alone.
    const catalog = fixtureCatalog();
    const object = catalog.get('fixture_machine');
    if (!object) throw new Error('fixture catalogue did not contain fixture_machine');

    const level: Level = {
      id: 'level-1',
      name: 'Level 1',
      elevation: 0,
      planImage: null,
      coordinateMapping: null,
      boundaries: [],
      spaces: [],
      placements: [
        {
          id: 'p1',
          equipmentObjectId: object.id,
          equipmentObjectVersion: object.version,
          label: 'p1',
          transform: { position: { x: 1_000, y: 1_000 }, rotation: 90_000, mirrored: false },
          spaceId: null,
        },
      ],
      referencePoints: [],
    };

    const section = buildFloorPlan(level, catalog);
    const row = section.placements[0];

    expect(row?.position).toEqual({ x: 600, y: 1_400 });
  });
});
