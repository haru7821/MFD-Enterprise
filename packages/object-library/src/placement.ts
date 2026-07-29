import type { Vec2 } from '@mfd/cad-engine';

import type { EquipmentObject } from './schema';

/**
 * Placement — one machine on one drawing.
 *
 * Deliberately separate from the catalogue record it points at. Twenty AK98 units
 * share one set of dimensions, so a manual revision updates all twenty at once;
 * copying the dimensions into each placement would let them drift apart, and
 * drifted equipment data looks exactly like correct equipment data.
 *
 * See docs/data-model/PROJECT_MODEL.md. In Sprint 2 placements live in a flat list
 * in editor state; they move under `Space` when spaces arrive in Sprint 3.
 */

export interface PlacementTransform {
  /** Position of the object's local origin, in model millimetres. */
  readonly position: Vec2;
  /** Rotation in millidegrees, so 90° stays exact. */
  readonly rotation: number;
  /** Some installations are handed. */
  readonly mirrored: boolean;
}

export interface Placement {
  readonly id: string;
  /** Reference into the catalogue — never a copy of it. */
  readonly equipmentObjectId: string;
  /**
   * The catalogue version placed, so a report can state exactly which data
   * produced its numbers even after the catalogue moves on.
   */
  readonly equipmentObjectVersion: string;
  readonly transform: PlacementTransform;
  readonly label: string;
}

export interface CreatePlacementOptions {
  readonly rotation?: number;
  readonly mirrored?: boolean;
  readonly label?: string;
}

/**
 * Create a placement referencing a catalogue object.
 *
 * The id is supplied by the caller rather than generated here: identifier policy
 * belongs to whatever owns the document, and injecting it keeps this function
 * deterministic and testable.
 */
export function createPlacement(
  id: string,
  object: EquipmentObject,
  position: Vec2,
  options: CreatePlacementOptions = {},
): Placement {
  return {
    id,
    equipmentObjectId: object.id,
    equipmentObjectVersion: object.version,
    transform: {
      position,
      rotation: options.rotation ?? 0,
      mirrored: options.mirrored ?? false,
    },
    label: options.label ?? object.model,
  };
}
