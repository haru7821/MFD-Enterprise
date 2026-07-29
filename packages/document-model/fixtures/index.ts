import type { Vec2 } from '@mfd/cad-engine';

import {
  createBoundary,
  createDocument,
  createSpace,
} from '../src/document';
import type { Boundary, MfdDocument, Placement, PlanImage, Space } from '../src/schema';

/**
 * Document fixtures.
 *
 * Kept out of `src` so nothing in the shipped model can reach for a fixture. Every
 * timestamp is a constant: a fixture that called the clock would make snapshot
 * comparisons impossible and give a different document on every run.
 */

export const FIXTURE_NOW = '2026-07-29T09:00:00.000Z';
export const FIXTURE_LEVEL_ID = 'level-1';

export function fixtureDocument(): MfdDocument {
  return createDocument({
    projectId: 'project-1',
    name: "Seoul St Mary's — 3F dialysis unit",
    now: FIXTURE_NOW,
    levelId: FIXTURE_LEVEL_ID,
    levelName: '3F',
    reviewedBy: 'TS Engineer',
    ruleSetRef: { id: 'dialysis', version: '0.1.0' },
  });
}

/** A 1 × 1 px PNG. Small enough to keep in a test, real enough to be a data URL. */
export const FIXTURE_PLAN_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

export function fixturePlanImage(overrides: Partial<PlanImage> = {}): PlanImage {
  return {
    sourceFormat: 'png',
    sourceFileName: '3f-dialysis.png',
    pageIndex: 0,
    pixelWidth: 2_000,
    pixelHeight: 1_400,
    dataUrl: FIXTURE_PLAN_DATA_URL,
    importedAt: FIXTURE_NOW,
    ...overrides,
  };
}

/** A rectangular room, in model millimetres. */
export function fixtureRoomBoundary(
  id = 'boundary-1',
  width = 8_000,
  height = 6_000,
): Boundary {
  return createBoundary(
    id,
    'space_outline',
    [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ],
    'Treatment area',
  );
}

export function fixtureSpace(id = 'space-1', boundaryId = 'boundary-1'): Space {
  return createSpace(id, boundaryId, 'Treatment area A', 'hemodialysis_treatment');
}

export function fixturePlacement(
  id: string,
  position: Vec2,
  overrides: Partial<Placement> = {},
): Placement {
  return {
    id,
    equipmentObjectId: 'vantive_ak98',
    equipmentObjectVersion: '0.1.0',
    transform: { position, rotation: 0, mirrored: false },
    label: id,
    spaceId: null,
    ...overrides,
  };
}
