import { type Rect, type Transform, type Vec2, rect } from '@mfd/cad-engine';

import {
  CLEARANCE_SIDES,
  CONNECTION_KINDS,
  type ClearanceSide,
  type ConnectionKind,
  type EquipmentObject,
} from './schema';

/**
 * Placement geometry.
 *
 * Turns a catalogue record plus a transform into millimetre polygons. Pure maths —
 * the renderer converts these to pixels through the viewport, never the other way
 * round (architecture decision AD-2).
 *
 * ## Local space
 *
 * A `front-left` origin puts local (0, 0) at the footprint's minimum corner, so the
 * rectangle spans x ∈ [0, width], y ∈ [0, depth]. A `centre` origin centres it.
 *
 * ## Direction convention
 *
 * Model space is y-down, matching the screen, so a positive rotation turns
 * clockwise on screen.
 *
 * | frontEdge | outward normal |
 * | --- | --- |
 * | north | (0, −1) |
 * | south | (0, +1) |
 * | east  | (+1, 0) |
 * | west  | (−1, 0) |
 *
 * Left and right are taken from an operator standing at the front looking at the
 * machine: with the front facing south, the operator looks north and their left is
 * west. That gives `left = rotate90(front)` where `rotate90(x, y) = (−y, x)`.
 *
 * **This convention needs confirming against the AK98 manual when the real
 * clearance figures arrive** — a manual that labels its sides from the service
 * engineer's position behind the machine would invert left and right.
 */

const OUTWARD_NORMALS: Record<EquipmentObject['symbol']['frontEdge'], Vec2> = {
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  east: { x: 1, y: 0 },
  west: { x: -1, y: 0 },
};

function rotate90(v: Vec2): Vec2 {
  return { x: -v.y, y: v.x };
}

function negate(v: Vec2): Vec2 {
  return { x: -v.x, y: -v.y };
}

/** Outward normal of each clearance side, in local space. */
export function sideNormals(object: EquipmentObject): Record<ClearanceSide, Vec2> {
  const front = OUTWARD_NORMALS[object.symbol.frontEdge];
  const left = rotate90(front);
  return { front, rear: negate(front), left, right: negate(left) };
}

/**
 * The footprint rectangle in the object's own local millimetres.
 *
 * **The design footprint, not the manufacturer's dimensions.** Everything geometric in
 * MFD-E measures against the planning area: the canvas draws it, collision tests it, and
 * clearance measures from its faces. Manufacturer dimensions are reference data that the
 * report quotes and no engine computes with.
 */
export function localFootprintRect(object: EquipmentObject): Rect {
  const { width, depth } = object.planningFootprint;

  return object.symbol.origin === 'centre'
    ? rect(-width / 2, -depth / 2, width, depth)
    : rect(0, 0, width, depth);
}

/**
 * Apply a placement transform to a local point.
 *
 * Order is mirror → rotate → translate, so mirroring is about the object's own
 * axis rather than about wherever it happens to sit on the drawing.
 */
export function localToModel(local: Vec2, transform: Transform): Vec2 {
  const x = transform.mirrored ? -local.x : local.x;
  const radians = (transform.rotation / 1000) * (Math.PI / 180);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  return {
    x: transform.position.x + x * cos - local.y * sin,
    y: transform.position.y + x * sin + local.y * cos,
  };
}

/** Inverse of {@link localToModel} — used for hit testing. */
export function modelToLocal(point: Vec2, transform: Transform): Vec2 {
  const dx = point.x - transform.position.x;
  const dy = point.y - transform.position.y;
  const radians = (transform.rotation / 1000) * (Math.PI / 180);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  const x = dx * cos + dy * sin;
  const y = -dx * sin + dy * cos;

  return { x: transform.mirrored ? -x : x, y };
}

function rectCorners(r: Rect): Vec2[] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ];
}

/** Footprint corners in model millimetres, in polygon order. */
export function footprintCorners(
  object: EquipmentObject,
  transform: Transform,
): Vec2[] {
  return rectCorners(localFootprintRect(object)).map((corner) =>
    localToModel(corner, transform),
  );
}

/** Axis-aligned bounds of the footprint in model space. Used for culling. */
export function footprintBounds(
  object: EquipmentObject,
  transform: Transform,
): Rect {
  const corners = footprintCorners(object, transform);
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);

  return rect(minX, minY, Math.max(...xs) - minX, Math.max(...ys) - minY);
}

/** Is this model-space point inside the footprint? */
export function footprintContains(
  object: EquipmentObject,
  transform: Transform,
  point: Vec2,
): boolean {
  const local = modelToLocal(point, transform);
  const bounds = localFootprintRect(object);

  return (
    local.x >= bounds.x &&
    local.x <= bounds.x + bounds.width &&
    local.y >= bounds.y &&
    local.y <= bounds.y + bounds.height
  );
}

export interface ClearanceZone {
  readonly side: ClearanceSide;
  /** The required clearance in millimetres. */
  readonly millimetres: number;
  /** Zone polygon in model millimetres. */
  readonly polygon: readonly Vec2[];
}

/**
 * Clearance zones for every side that has a figure.
 *
 * Sides whose clearance is null produce nothing — an unknown clearance is not a
 * zero clearance, and drawing it as one would imply a requirement we do not have.
 */
export function clearanceZones(
  object: EquipmentObject,
  transform: Transform,
): ClearanceZone[] {
  const footprint = localFootprintRect(object);
  const normals = sideNormals(object);
  const zones: ClearanceZone[] = [];

  for (const side of CLEARANCE_SIDES) {
    const millimetres = object.serviceClearance[side];
    if (millimetres === null) continue;

    const normal = normals[side];
    const localZone =
      normal.x !== 0
        ? rect(
            normal.x > 0 ? footprint.x + footprint.width : footprint.x - millimetres,
            footprint.y,
            millimetres,
            footprint.height,
          )
        : rect(
            footprint.x,
            normal.y > 0 ? footprint.y + footprint.height : footprint.y - millimetres,
            footprint.width,
            millimetres,
          );

    zones.push({
      side,
      millimetres,
      polygon: rectCorners(localZone).map((corner) => localToModel(corner, transform)),
    });
  }

  return zones;
}

export interface PortPoint {
  readonly kind: ConnectionKind;
  /** Model-space position in millimetres. */
  readonly position: Vec2;
  readonly required: boolean;
}

/**
 * Service connection points in model space.
 *
 * Connections whose port position is unknown are omitted: we know the machine needs
 * a drain, but not yet where on the chassis it connects, and guessing a position
 * would put a marker on a drawing an engineer might measure from.
 *
 * ## Two records, read together
 *
 * Whether a service is *required* comes from `connections` — a specification, stated by the
 * manufacturer. *Where it lands* comes from `portLocations` — an installation requirement, which
 * the owner's AK98 source clarification put beyond the reach of any manufacturer document. This is
 * the one place the two sides meet, and they meet as a read rather than as a merge: neither record
 * can supply the other's field.
 */
export function portPoints(
  object: EquipmentObject,
  transform: Transform,
): PortPoint[] {
  const points: PortPoint[] = [];

  for (const kind of CONNECTION_KINDS) {
    const position = object.portLocations[kind];
    if (position === null) continue;

    points.push({
      kind,
      position: localToModel(position, transform),
      required: object.connections[kind].required,
    });
  }

  return points;
}
