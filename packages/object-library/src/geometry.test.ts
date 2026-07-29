import type { Transform } from '@mfd/cad-engine';
import { describe, expect, it } from 'vitest';

import { parseEquipmentObject } from './catalog';
import {
  clearanceZones,
  footprintBounds,
  footprintContains,
  footprintCorners,
  localFootprintRect,
  localToModel,
  modelToLocal,
  portPoints,
  sideNormals,
} from './geometry';
import type { EquipmentObject } from './schema';

function machine(overrides: Record<string, unknown> = {}): EquipmentObject {
  return parseEquipmentObject(
    {
      id: 'test_machine',
      manufacturer: 'Test',
      model: 'T1',
      category: 'dialysis_machine',
      version: '0.1.0',
      dataStatus: 'draft',
      dimensions: { width: 900, depth: 750, height: null, weight: null },
      connections: {
        power: { required: true, port: { x: 100, y: 0 }, specification: null },
        roWater: { required: true, port: null, specification: null },
        drain: { required: true, port: null, specification: null },
      },
      serviceClearance: { front: null, rear: null, left: null, right: null },
      source: {
        document: null,
        revision: null,
        section: null,
        type: 'estimate',
        lastUpdated: '2026-07-29',
      },
      symbol: { origin: 'front-left', outline: 'rectangle', frontEdge: 'south' },
      ...overrides,
    },
    'test.json',
  );
}

const AT_ORIGIN: Transform = {
  position: { x: 0, y: 0 },
  rotation: 0,
  mirrored: false,
};

describe('local footprint', () => {
  it('spans the catalogue dimensions from a front-left origin', () => {
    expect(localFootprintRect(machine())).toEqual({
      x: 0,
      y: 0,
      width: 900,
      height: 750,
    });
  });

  it('centres the rectangle for a centre origin', () => {
    const object = machine({
      symbol: { origin: 'centre', outline: 'rectangle', frontEdge: 'south' },
    });

    expect(localFootprintRect(object)).toEqual({
      x: -450,
      y: -375,
      width: 900,
      height: 750,
    });
  });
});

describe('placement transform', () => {
  it('translates the footprint to the placement position', () => {
    const corners = footprintCorners(machine(), {
      ...AT_ORIGIN,
      position: { x: 5_000, y: 2_000 },
    });

    expect(corners[0]).toEqual({ x: 5_000, y: 2_000 });
    expect(corners[2]?.x).toBeCloseTo(5_900, 6);
    expect(corners[2]?.y).toBeCloseTo(2_750, 6);
  });

  it('keeps the footprint size under rotation', () => {
    const rotated = footprintBounds(machine(), { ...AT_ORIGIN, rotation: 90_000 });

    // A quarter turn swaps the bounding box sides exactly.
    expect(rotated.width).toBeCloseTo(750, 6);
    expect(rotated.height).toBeCloseTo(900, 6);
  });

  it('round-trips a point through model space and back', () => {
    const transform: Transform = {
      position: { x: 1_234, y: -567 },
      rotation: 37_500,
      mirrored: true,
    };
    const local = { x: 210, y: 640 };

    const back = modelToLocal(localToModel(local, transform), transform);

    expect(back.x).toBeCloseTo(local.x, 6);
    expect(back.y).toBeCloseTo(local.y, 6);
  });

  it('measures the same distance however the object is placed', () => {
    // The width of the machine cannot depend on where it sits or how it is turned.
    const transform: Transform = {
      position: { x: 3_333, y: 777 },
      rotation: 22_000,
      mirrored: false,
    };
    const corners = footprintCorners(machine(), transform);
    const [a, b] = [corners[0], corners[1]];

    expect(Math.hypot((b?.x ?? 0) - (a?.x ?? 0), (b?.y ?? 0) - (a?.y ?? 0))).toBeCloseTo(
      900,
      6,
    );
  });
});

describe('hit testing', () => {
  it('accepts points inside and rejects points outside', () => {
    const object = machine();
    const transform = { ...AT_ORIGIN, position: { x: 1_000, y: 1_000 } };

    expect(footprintContains(object, transform, { x: 1_450, y: 1_375 })).toBe(true);
    expect(footprintContains(object, transform, { x: 999, y: 1_375 })).toBe(false);
    expect(footprintContains(object, transform, { x: 1_901, y: 1_375 })).toBe(false);
  });

  it('follows the object when it is rotated', () => {
    const object = machine();
    const rotated = { ...AT_ORIGIN, rotation: 90_000 };

    // (850, 100) is inside at zero rotation; a quarter turn moves it out.
    expect(footprintContains(object, AT_ORIGIN, { x: 850, y: 100 })).toBe(true);
    expect(footprintContains(object, rotated, { x: 850, y: 100 })).toBe(false);
    expect(footprintContains(object, rotated, { x: -100, y: 850 })).toBe(true);
  });
});

describe('clearance zones', () => {
  it('produces nothing when every clearance is unknown', () => {
    // An unknown clearance is not a zero clearance. Drawing one would imply a
    // requirement the manual has not given us.
    expect(clearanceZones(machine(), AT_ORIGIN)).toEqual([]);
  });

  it('produces a zone only for sides that have a figure', () => {
    const object = machine({
      serviceClearance: { front: 1_200, rear: null, left: null, right: 500 },
    });

    const zones = clearanceZones(object, AT_ORIGIN);

    expect(zones.map((zone) => zone.side).sort()).toEqual(['front', 'right']);
  });

  it('puts the front zone beyond the front edge', () => {
    const object = machine({
      serviceClearance: { front: 1_200, rear: null, left: null, right: null },
    });

    const [zone] = clearanceZones(object, AT_ORIGIN);
    const ys = (zone?.polygon ?? []).map((point) => point.y);

    // frontEdge "south" is the +y side, so the zone runs from depth to depth + 1200.
    expect(Math.min(...ys)).toBeCloseTo(750, 6);
    expect(Math.max(...ys)).toBeCloseTo(1_950, 6);
  });

  it('rotates the zone with the object', () => {
    const object = machine({
      serviceClearance: { front: 1_000, rear: null, left: null, right: null },
    });

    const [zone] = clearanceZones(object, { ...AT_ORIGIN, rotation: 180_000 });
    const ys = (zone?.polygon ?? []).map((point) => point.y);

    // Turned through half a circle, the front clearance now extends in −y.
    expect(Math.max(...ys)).toBeCloseTo(-750, 6);
    expect(Math.min(...ys)).toBeCloseTo(-1_750, 6);
  });
});

describe('side normals', () => {
  it('places left 90 degrees from the front', () => {
    // Front facing south (+y): an operator standing in front looks north, so their
    // left is west (−x). Documented in geometry.ts and pending confirmation against
    // the manual's own labelling.
    expect(sideNormals(machine()).front).toEqual({ x: 0, y: 1 });
    expect(sideNormals(machine()).rear).toEqual({ x: -0, y: -1 });
    expect(sideNormals(machine()).left).toEqual({ x: -1, y: 0 });
    expect(sideNormals(machine()).right).toEqual({ x: 1, y: -0 });
  });

  it('turns the whole set with the front edge', () => {
    const eastFacing = machine({
      symbol: { origin: 'front-left', outline: 'rectangle', frontEdge: 'east' },
    });

    expect(sideNormals(eastFacing).front).toEqual({ x: 1, y: 0 });
    expect(sideNormals(eastFacing).left).toEqual({ x: -0, y: 1 });
  });
});

describe('ports', () => {
  it('omits connections whose position is unknown', () => {
    // We know the machine needs a drain; we do not know where it connects. A marker
    // placed on a guess is a marker an engineer might measure from.
    const points = portPoints(machine(), AT_ORIGIN);

    expect(points.map((point) => point.kind)).toEqual(['power']);
  });

  it('moves known ports with the placement', () => {
    const [power] = portPoints(machine(), { ...AT_ORIGIN, position: { x: 400, y: 900 } });

    expect(power?.position.x).toBeCloseTo(500, 6);
    expect(power?.position.y).toBeCloseTo(900, 6);
  });
});
