import type { Transform, Vec2 } from '@mfd/cad-engine';
import { IDENTITY_TRANSFORM, polygonArea, polygonCentroid, polygonContains } from '@mfd/cad-engine';
import type { EquipmentObject } from '@mfd/object-library';

import { EntityNotFoundError } from './errors';
import {
  DEFAULT_PROJECT_SETTINGS,
  DOCUMENT_VERSION,
  type Boundary,
  type Level,
  type MfdDocument,
  type ObstructionType,
  type Placement,
  type Project,
  type Space,
} from './schema';

/**
 * Document construction and queries.
 *
 * Everything here is pure. No clock, no id generation, no I/O — timestamps and
 * identifiers arrive as arguments.
 *
 * That looks like ceremony until you try to test a document: a `createDocument` that
 * called `Date.now()` internally cannot be compared against an expected value, cannot
 * be replayed from a command log, and cannot produce the same bytes twice for a
 * report that is supposed to be reproducible. Injecting both is the cheapest way to
 * keep all three properties.
 */

export interface CreateDocumentOptions {
  readonly projectId: string;
  readonly name: string;
  readonly now: string;
  readonly levelId?: string;
  readonly levelName?: string;
  readonly reviewedBy?: string;
  readonly ruleSetRef?: { readonly id: string; readonly version: string };
}

export function createLevel(id: string, name: string, elevation = 0): Level {
  return {
    id,
    name,
    elevation,
    planImage: null,
    coordinateMapping: null,
    boundaries: [],
    spaces: [],
    placements: [],
    referencePoints: [],
  };
}

/** A new, empty project with exactly one level. A project with no floor is not a project. */
export function createDocument(options: CreateDocumentOptions): MfdDocument {
  const project: Project = {
    id: options.projectId,
    name: options.name,
    customer: { hospital: '', site: '', contact: '' },
    reviewedBy: options.reviewedBy ?? '',
    createdAt: options.now,
    updatedAt: options.now,
    ruleSetRef: options.ruleSetRef ?? { id: '', version: '' },
    settings: { ...DEFAULT_PROJECT_SETTINGS },
    levels: [createLevel(options.levelId ?? 'level-1', options.levelName ?? 'Level 1')],
  };

  return { documentVersion: DOCUMENT_VERSION, project };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function findLevel(document: MfdDocument, levelId: string): Level | null {
  return document.project.levels.find((level) => level.id === levelId) ?? null;
}

export function requireLevel(document: MfdDocument, levelId: string): Level {
  const level = findLevel(document, levelId);
  if (!level) throw new EntityNotFoundError('level', levelId);
  return level;
}

export function findPlacement(level: Level, placementId: string): Placement | null {
  return level.placements.find((placement) => placement.id === placementId) ?? null;
}

export function findBoundary(level: Level, boundaryId: string): Boundary | null {
  return level.boundaries.find((boundary) => boundary.id === boundaryId) ?? null;
}

export function findSpace(level: Level, spaceId: string): Space | null {
  return level.spaces.find((space) => space.id === spaceId) ?? null;
}

/** The polygon a space is drawn as, or null when its boundary has gone missing. */
export function spacePolygon(level: Level, space: Space): readonly Vec2[] | null {
  return findBoundary(level, space.boundaryId)?.vertices ?? null;
}

/** Floor area in square millimetres, or null when the boundary is missing. */
export function spaceArea(level: Level, space: Space): number | null {
  const polygon = spacePolygon(level, space);
  return polygon ? polygonArea(polygon) : null;
}

/** Boundaries that are obstructions rather than room outlines — columns, risers, walls. */
export function obstructionBoundaries(level: Level): Boundary[] {
  return level.boundaries.filter((boundary) => boundary.kind !== 'space_outline');
}

/**
 * The space whose outline contains this model-space point.
 *
 * Returns the **smallest** containing space when rooms nest — an anteroom drawn
 * inside a treatment area is the more specific answer, and the one an engineer means.
 */
export function spaceAtPoint(level: Level, point: Vec2): Space | null {
  let best: Space | null = null;
  let bestArea = Number.POSITIVE_INFINITY;

  for (const space of level.spaces) {
    const polygon = spacePolygon(level, space);
    if (!polygon || !polygonContains(polygon, point)) continue;

    const area = polygonArea(polygon);
    if (area < bestArea) {
      best = space;
      bestArea = area;
    }
  }

  return best;
}

/** Placements assigned to a space. Assignment is by reference, not by geometry. */
export function placementsInSpace(level: Level, spaceId: string): Placement[] {
  return level.placements.filter((placement) => placement.spaceId === spaceId);
}

/** Rooms on this level, worst-first is irrelevant; source order is the drawing order. */
export function levelSummary(level: Level): {
  readonly placements: number;
  readonly spaces: number;
  readonly obstructions: number;
} {
  return {
    placements: level.placements.length,
    spaces: level.spaces.length,
    obstructions: obstructionBoundaries(level).length,
  };
}

/** True when nothing has been drawn or placed on this level. */
export function isLevelEmpty(level: Level): boolean {
  return (
    level.placements.length === 0 &&
    level.boundaries.length === 0 &&
    level.spaces.length === 0 &&
    level.planImage === null
  );
}

/** Is this level calibrated well enough to measure against? */
export function isCalibrated(level: Level): boolean {
  return level.coordinateMapping !== null;
}

/** A representative interior point, for labelling a room on the drawing. */
export function spaceLabelAnchor(level: Level, space: Space): Vec2 | null {
  const polygon = spacePolygon(level, space);
  return polygon ? polygonCentroid(polygon) : null;
}

// ---------------------------------------------------------------------------
// Construction of entities
// ---------------------------------------------------------------------------

export interface CreatePlacementOptions {
  readonly rotation?: number;
  readonly mirrored?: boolean;
  readonly label?: string;
  readonly spaceId?: string | null;
}

/**
 * Create a placement referencing a catalogue object.
 *
 * The id is supplied by the caller: identifier policy belongs to whatever owns the
 * document, and injecting it keeps this deterministic.
 */
export function createPlacement(
  id: string,
  object: EquipmentObject,
  position: Vec2,
  options: CreatePlacementOptions = {},
): Placement {
  const transform: Transform = {
    ...IDENTITY_TRANSFORM,
    position,
    rotation: options.rotation ?? 0,
    mirrored: options.mirrored ?? false,
  };

  return {
    id,
    equipmentObjectId: object.id,
    equipmentObjectVersion: object.version,
    transform,
    label: options.label ?? object.model,
    spaceId: options.spaceId ?? null,
  };
}

export function createBoundary(
  id: string,
  kind: Boundary['kind'],
  vertices: readonly Vec2[],
  label = '',
): Boundary {
  // A room outline or wall carries no obstruction type, and the schema rejects one
  // that does. Obstructions go through createObstruction instead.
  return { id, kind, vertices: [...vertices], label, obstructionType: null };
}

export function createObstruction(
  id: string,
  obstructionType: ObstructionType,
  vertices: readonly Vec2[],
  label = '',
): Boundary {
  return { id, kind: 'obstruction', vertices: [...vertices], label, obstructionType };
}

export function createSpace(
  id: string,
  boundaryId: string,
  name: string,
  spaceFunction: Space['function'],
): Space {
  return { id, name, function: spaceFunction, boundaryId };
}
