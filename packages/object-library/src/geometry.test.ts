import type { Transform } from '@mfd/cad-engine';
import { describe, expect, it } from 'vitest';

/**
 * An unsourced group. Verification is **per group** now, so a fixture has to say it
 * once per group rather than once per record.
 */
function draftVerification() {
  return {
    status: 'draft',
    source: {
      document: null,
      revision: null,
      section: null,
      type: 'estimate',
      lastUpdated: '2026-07-29',
    },
  };
}

import { parseEquipmentObject } from './catalog';
import {
  clearanceZones,
  faceGeometry,
  footprintBounds,
  footprintCentre,
  footprintContains,
  footprintCorners,
  localFootprintRect,
  localToModel,
  modelToLocal,
  portPoints,
  sideNormals,
  transformForCentre,
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
        manufacturerDimensions: { width: 585, depth: 620, height: 1_305, weight: null, verification: draftVerification() },
      planningFootprint: { width: 900, depth: 750, basis: null },
      connections: {
        power: { required: true, specification: null, verification: draftVerification() },
        roWater: { required: true, specification: null, verification: draftVerification() },
        drain: { required: true, specification: null, verification: draftVerification() },
      },
      serviceClearance: { front: null, rear: null, left: null, right: null, verification: draftVerification() },
      environmental: { specification: null, verification: draftVerification() },
      maintenanceAccess: { front: null, rear: null, left: null, right: null, verification: draftVerification() },
      /*
       * One port located and two not, which is the case the tests below are about. The location
       * lives here rather than on `connections.power` since the owner's AK98 source clarification:
       * where a service lands is installation data, and no manufacturer document may supply it.
       */
      portLocations: {
        power: { x: 100, y: 0 },
        roWater: null,
        drain: null,
        verification: draftVerification(),
      },
      installationRouting: { specification: null, verification: draftVerification() },
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
  it('uses the design footprint and ignores the manufacturer dimensions', () => {
    // The fixture is deliberately inconsistent: a 585 × 620 mm machine planned at
    // 900 × 750. Every geometric answer must come from the planning area, because that
    // is what a drawing reserves — and because a footprint rounded up to make a layout
    // work must never overwrite the measurement of the machine that arrives on site.
    const object = machine();
    expect(object.manufacturerDimensions.width).toBe(585);
    expect(object.planningFootprint.width).toBe(900);

    expect(localFootprintRect(object).width).toBe(900);
    expect(localFootprintRect(object).height).toBe(750);

    const bounds = footprintBounds(object, AT_ORIGIN);
    expect(bounds.width).toBeCloseTo(900, 6);
    expect(bounds.height).toBeCloseTo(750, 6);
  });

  it('draws a record that has no manufacturer dimensions at all', () => {
    // A generic planning object — a bed, a chair — has a footprint and nothing else.
    // That is the case the split was made for, so it has to be the ordinary path and
    // not an exception.
    const bed = machine({
      manufacturerDimensions: { width: null, depth: null, height: null, weight: null, verification: draftVerification() },
      planningFootprint: { width: 1_000, depth: 2_100, basis: null },
    });

    expect(localFootprintRect(bed)).toEqual({ x: 0, y: 0, width: 1_000, height: 2_100 });
  });

  it('spans the design footprint from a front-left origin', () => {
    expect(localFootprintRect(machine())).toEqual({
      x: 0,
      y: 0,
      width: 900,
      height: 750,
    });
  });

  it('centres the rectangle for a centre origin', () => {
    const object = machine({
      maintenanceAccess: { front: null, rear: null, left: null, right: null, verification: draftVerification() },
      portLocations: { power: null, roWater: null, drain: null, verification: draftVerification() },
      installationRouting: { specification: null, verification: draftVerification() },
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

describe('transformForCentre — the one conversion from a footprint centre to a placement', () => {
  /*
   * > Architecture decision AD-21: exactly one definition of `transform.position`, and every
   * > conversion into it goes through a named function.
   *
   * The fixture object is `front-left`, 900 x 750 — every shipped catalogue record is too.
   */

  it('offsets by half the footprint at rotation 0, the fixed amount every caller used to hand-roll', () => {
    const transform = transformForCentre(machine(), { x: 5_000, y: 2_000 });

    expect(transform.position.x).toBeCloseTo(5_000 - 450, 6);
    expect(transform.position.y).toBeCloseTo(2_000 - 375, 6);
    expect(transform.rotation).toBe(0);
    expect(transform.mirrored).toBe(false);
  });

  it('is the identity for a centre-origin object', () => {
    const centred = machine({ symbol: { origin: 'centre', outline: 'rectangle', frontEdge: 'south' } });
    const transform = transformForCentre(centred, { x: 5_000, y: 2_000 });

    expect(transform.position).toEqual({ x: 5_000, y: 2_000 });
  });

  it('places the true centre at the requested point under rotation, verified independently', () => {
    /*
     * "True centre" measured a second way — `footprintBounds`'s bounding-box midpoint — so this
     * is not the same arithmetic as `transformForCentre` checking itself. A rectangle is point-
     * symmetric about its own centre, so its axis-aligned bounding box is centred there at any
     * rotation, about any pivot; that is what makes the midpoint a valid independent check.
     */
    for (const rotation of [0, 37_500, 90_000, 181_000, 271_500]) {
      const centre = { x: 3_300, y: -1_200 };
      const transform = transformForCentre(machine(), centre, rotation);
      const bounds = footprintBounds(machine(), transform);

      expect(bounds.x + bounds.width / 2).toBeCloseTo(centre.x, 6);
      expect(bounds.y + bounds.height / 2).toBeCloseTo(centre.y, 6);
    }
  });

  it('places the true centre at the requested point when mirrored too', () => {
    const centre = { x: 900, y: 900 };
    const transform = transformForCentre(machine(), centre, 45_000, true);
    const bounds = footprintBounds(machine(), transform);

    expect(bounds.x + bounds.width / 2).toBeCloseTo(centre.x, 6);
    expect(bounds.y + bounds.height / 2).toBeCloseTo(centre.y, 6);
  });
});

describe('footprintCentre — the true centre of a placed footprint', () => {
  it('round-trips through transformForCentre at several rotations, mirrored and not', () => {
    for (const rotation of [0, 37_500, 90_000, 181_000, 271_500]) {
      for (const mirrored of [false, true]) {
        const centre = { x: 3_300, y: -1_200 };
        const transform = transformForCentre(machine(), centre, rotation, mirrored);

        expect(footprintCentre(machine(), transform).x).toBeCloseTo(centre.x, 6);
        expect(footprintCentre(machine(), transform).y).toBeCloseTo(centre.y, 6);
      }
    }
  });

  it('is not transform.position for a front-left object — it is offset by half the footprint', () => {
    const transform = { position: { x: 1_000, y: 1_000 }, rotation: 0, mirrored: false };
    // 900 x 750 fixture, front-left: the centre is half the footprint past the corner.
    expect(footprintCentre(machine(), transform)).toEqual({ x: 1_450, y: 1_375 });
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
      serviceClearance: { front: 1_200, rear: null, left: null, right: 500, verification: draftVerification() },
    });

    const zones = clearanceZones(object, AT_ORIGIN);

    expect(zones.map((zone) => zone.side).sort()).toEqual(['front', 'right']);
  });

  it('puts the front zone beyond the front edge', () => {
    const object = machine({
      serviceClearance: { front: 1_200, rear: null, left: null, right: null, verification: draftVerification() },
    });

    const [zone] = clearanceZones(object, AT_ORIGIN);
    const ys = (zone?.polygon ?? []).map((point) => point.y);

    // frontEdge "south" is the +y side, so the zone runs from depth to depth + 1200.
    expect(Math.min(...ys)).toBeCloseTo(750, 6);
    expect(Math.max(...ys)).toBeCloseTo(1_950, 6);
  });

  it('rotates the zone with the object', () => {
    const object = machine({
      serviceClearance: { front: 1_000, rear: null, left: null, right: null, verification: draftVerification() },
    });

    const [zone] = clearanceZones(object, { ...AT_ORIGIN, rotation: 180_000 });
    const ys = (zone?.polygon ?? []).map((point) => point.y);

    // Turned through half a circle, the front clearance now extends in −y.
    expect(Math.max(...ys)).toBeCloseTo(-750, 6);
    expect(Math.min(...ys)).toBeCloseTo(-1_750, 6);
  });
});

describe('faceGeometry — the whole face a clearance measurement checks, not one ray through it', () => {
  /*
   * Found by the Critical 0 review: a probe that read "inner edge" and "outer edge" off a
   * `ClearanceZone` polygon by corner index was correct for `front` and wrong for the other three
   * — `rear`'s first two corners are its *outer* edge, and `left`/`right`'s first two corners are
   * one inner, one outer, because the axis the clearance offset runs along swaps which pair of
   * `rectCorners` entries shares an edge. `faceGeometry` never reads a `ClearanceZone` at all, so
   * there is no index to get backwards.
   *
   * Independent check, not a restatement of the formula: for every side, `faceGeometry`'s `origin`
   * must be the midpoint of the two `footprintCorners` that actually bound that face — the
   * rear/front pair (indices 0-1 and 2-3) or the left/right pair (indices 0-3 and 1-2) — `normal`
   * must point away from the footprint, checked by walking a short distance each way and asking
   * `footprintContains`, not by re-deriving the same rotation math — and `min`/`max` must be exactly
   * those same two corners' own projections onto `axis`, in either order.
   */
  const FACE_CORNER_INDICES: Record<'front' | 'rear' | 'left' | 'right', readonly [number, number]> = {
    rear: [0, 1],
    front: [2, 3],
    left: [0, 3],
    right: [1, 2],
  };

  it.each(['front', 'rear', 'left', 'right'] as const)(
    'anchors %s on its own face, spanning it corner to corner, at several rotations, mirrored and not',
    (side) => {
      for (const rotation of [0, 37_500, 90_000, 181_000, 271_500]) {
        for (const mirrored of [false, true]) {
          const object = machine({
            serviceClearance: { front: 1_200, rear: 800, left: 400, right: 500, verification: draftVerification() },
          });
          const transform: Transform = { position: { x: 1_000, y: -500 }, rotation, mirrored };
          const label = `${side} @ ${rotation}${mirrored ? ' mirrored' : ''}`;

          const corners = footprintCorners(object, transform);
          const [i, j] = FACE_CORNER_INDICES[side];
          const a = corners[i];
          const b = corners[j];
          if (!a || !b) throw new Error('footprintCorners did not return four points');
          const expectedOrigin = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

          const face = faceGeometry(object, transform, side);
          expect(face.origin.x, `${label} origin.x`).toBeCloseTo(expectedOrigin.x, 6);
          expect(face.origin.y, `${label} origin.y`).toBeCloseTo(expectedOrigin.y, 6);

          const length = Math.hypot(face.normal.x, face.normal.y);
          expect(length, `${label} unit length`).toBeCloseTo(1, 6);

          const outward = {
            x: face.origin.x + face.normal.x * 10,
            y: face.origin.y + face.normal.y * 10,
          };
          const inward = {
            x: face.origin.x - face.normal.x * 10,
            y: face.origin.y - face.normal.y * 10,
          };
          expect(footprintContains(object, transform, outward), `${label} outward`).toBe(false);
          expect(footprintContains(object, transform, inward), `${label} inward`).toBe(true);

          // The face's own width, independently: the same two corners' projections onto `axis`,
          // not `face.min`/`face.max` re-derived from the formula that produced them.
          const projectionA = a.x * face.axis.x + a.y * face.axis.y;
          const projectionB = b.x * face.axis.x + b.y * face.axis.y;
          expect(face.min, `${label} min`).toBeCloseTo(Math.min(projectionA, projectionB), 6);
          expect(face.max, `${label} max`).toBeCloseTo(Math.max(projectionA, projectionB), 6);
        }
      }
    },
  );
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
      maintenanceAccess: { front: null, rear: null, left: null, right: null, verification: draftVerification() },
      portLocations: { power: null, roWater: null, drain: null, verification: draftVerification() },
      installationRouting: { specification: null, verification: draftVerification() },
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
