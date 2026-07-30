import type { Vec2 } from '@mfd/cad-engine';
import { millidegreesToRadians, normaliseRotation } from '@mfd/cad-engine';

import { createLevel, requireLevel } from './document';
import { EntityNotFoundError } from './errors';
import type {
  Boundary,
  CoordinateMapping,
  Level,
  MfdDocument,
  Placement,
  Space,
} from './schema';

/**
 * Editing commands.
 *
 * ## Why explicit inverses rather than document snapshots
 *
 * Snapshot undo is two lines of code and would be wrong here. A level owns its plan
 * image as an embedded data URL — several megabytes — so a snapshot per undo step
 * makes dragging a machine across a room allocate a hundred megabytes of identical
 * floor plans. An explicit inverse for a move is two numbers.
 *
 * The inverse is produced **at apply time**, not from the command alone, because that
 * is when the prior state is known: deleting a space needs the deleted space in order
 * to put it back, and the command that asked for the deletion does not carry it.
 *
 * ```ts
 * const { document, inverse } = command.apply(before);
 * inverse.apply(document);  // === before
 * ```
 *
 * ## Why commands are data, not closures over the editor
 *
 * A command holds ids and values only. That is what lets the history be inspected,
 * a change be logged for collaboration, and eventually an assistant's proposed layout
 * be expressed as the same commands an engineer would have issued — rather than as a
 * document that appeared from nowhere with no account of how.
 *
 * ## What is deliberately not undoable
 *
 * Importing a plan, and setting its **scale**, are not commands. Undoing a scale change
 * would leave placements at millimetre positions derived from a mapping that no longer
 * exists — geometry silently reinterpreted, which is the failure mode this whole product
 * exists to prevent. Both are explicit, deliberate acts, and both are re-doable by
 * repeating them.
 *
 * Setting the **origin** is different, and is a command — see
 * {@link setPlanOriginCommand}. It does not reinterpret anything: it re-datums the
 * drawing and renumbers the layout to match, which is exactly reversible.
 */

export type CommandType =
  | 'placement.create'
  | 'placement.move'
  | 'placement.rotate'
  | 'placement.assignSpace'
  | 'placement.delete'
  | 'boundary.create'
  | 'boundary.setVertices'
  | 'boundary.describe'
  | 'boundary.delete'
  | 'space.create'
  | 'space.rename'
  | 'space.delete'
  | 'level.create'
  | 'level.rename'
  | 'level.delete'
  | 'plan.setOrigin'
  | 'project.setDetails';

export interface CommandResult {
  readonly document: MfdDocument;
  /** Applying this to `document` restores exactly the document `apply` was given. */
  readonly inverse: Command;
}

export interface Command {
  readonly type: CommandType;
  /** Shown to the engineer, e.g. "Move Station 12". */
  readonly label: string;
  /**
   * Consecutive commands sharing a non-null key coalesce into one undo step.
   *
   * A pointer drag emits a move command per frame. Without coalescing, undo would
   * step back through sixty intermediate positions to get to where the machine
   * started, which is not what "undo the move" means to anyone.
   */
  readonly mergeKey: string | null;
  apply(document: MfdDocument): CommandResult;
}

// ---------------------------------------------------------------------------
// Level plumbing
// ---------------------------------------------------------------------------

function withLevel(
  document: MfdDocument,
  levelId: string,
  update: (level: Level) => Level,
): MfdDocument {
  requireLevel(document, levelId);

  return {
    ...document,
    project: {
      ...document.project,
      levels: document.project.levels.map((level) =>
        level.id === levelId ? update(level) : level,
      ),
    },
  };
}

interface CommandSpec {
  readonly type: CommandType;
  readonly label: string;
  readonly mergeKey: string | null;
  readonly apply: (document: MfdDocument) => CommandResult;
}

function command(spec: CommandSpec): Command {
  return { type: spec.type, label: spec.label, mergeKey: spec.mergeKey, apply: spec.apply };
}

// ---------------------------------------------------------------------------
// Placement commands
// ---------------------------------------------------------------------------

export function createPlacementCommand(levelId: string, placement: Placement): Command {
  return command({
    type: 'placement.create',
    label: `Place ${placement.label}`,
    mergeKey: null,
    apply(document) {
      const next = withLevel(document, levelId, (level) => ({
        ...level,
        placements: [...level.placements, placement],
      }));
      return { document: next, inverse: deletePlacementCommand(levelId, placement.id) };
    },
  });
}

function requirePlacement(level: Level, placementId: string): Placement {
  const placement = level.placements.find((entry) => entry.id === placementId);
  if (!placement) throw new EntityNotFoundError('placement', placementId);
  return placement;
}

function mapPlacement(
  level: Level,
  placementId: string,
  update: (placement: Placement) => Placement,
): Level {
  return {
    ...level,
    placements: level.placements.map((placement) =>
      placement.id === placementId ? update(placement) : placement,
    ),
  };
}

export function movePlacementCommand(
  levelId: string,
  placementId: string,
  position: Vec2,
): Command {
  return command({
    type: 'placement.move',
    label: 'Move equipment',
    // Keyed on the machine, so dragging one machine coalesces while dragging a
    // second afterwards starts a new undo step.
    mergeKey: `placement.move:${placementId}`,
    apply(document) {
      const level = requireLevel(document, levelId);
      const previous = requirePlacement(level, placementId).transform.position;

      const next = withLevel(document, levelId, (current) =>
        mapPlacement(current, placementId, (placement) => ({
          ...placement,
          transform: { ...placement.transform, position },
        })),
      );

      return {
        document: next,
        inverse: movePlacementCommand(levelId, placementId, previous),
      };
    },
  });
}

export function rotatePlacementCommand(
  levelId: string,
  placementId: string,
  rotation: number,
): Command {
  return command({
    type: 'placement.rotate',
    label: 'Rotate equipment',
    mergeKey: `placement.rotate:${placementId}`,
    apply(document) {
      const level = requireLevel(document, levelId);
      const previous = requirePlacement(level, placementId).transform.rotation;

      const next = withLevel(document, levelId, (current) =>
        mapPlacement(current, placementId, (placement) => ({
          ...placement,
          transform: { ...placement.transform, rotation: normaliseRotation(rotation) },
        })),
      );

      return {
        document: next,
        inverse: rotatePlacementCommand(levelId, placementId, previous),
      };
    },
  });
}

export function assignPlacementSpaceCommand(
  levelId: string,
  placementId: string,
  spaceId: string | null,
): Command {
  return command({
    type: 'placement.assignSpace',
    label: spaceId === null ? 'Remove equipment from room' : 'Assign equipment to room',
    mergeKey: null,
    apply(document) {
      const level = requireLevel(document, levelId);
      const previous = requirePlacement(level, placementId).spaceId;

      const next = withLevel(document, levelId, (current) =>
        mapPlacement(current, placementId, (placement) => ({ ...placement, spaceId })),
      );

      return {
        document: next,
        inverse: assignPlacementSpaceCommand(levelId, placementId, previous),
      };
    },
  });
}

export function deletePlacementCommand(levelId: string, placementId: string): Command {
  return command({
    type: 'placement.delete',
    label: 'Delete equipment',
    mergeKey: null,
    apply(document) {
      const level = requireLevel(document, levelId);
      const removed = requirePlacement(level, placementId);
      const index = level.placements.indexOf(removed);

      const next = withLevel(document, levelId, (current) => ({
        ...current,
        placements: current.placements.filter((placement) => placement.id !== placementId),
      }));

      return {
        document: next,
        // Restored at its original index, not appended. Draw order is what an
        // engineer sees when machines overlap, so undo has to give back the drawing
        // they had rather than one that merely contains the same machines.
        inverse: restorePlacementCommand(levelId, removed, index),
      };
    },
  });
}

function restorePlacementCommand(
  levelId: string,
  placement: Placement,
  index: number,
): Command {
  return command({
    type: 'placement.create',
    label: `Restore ${placement.label}`,
    mergeKey: null,
    apply(document) {
      const next = withLevel(document, levelId, (level) => {
        const placements = [...level.placements];
        placements.splice(Math.min(index, placements.length), 0, placement);
        return { ...level, placements };
      });
      return { document: next, inverse: deletePlacementCommand(levelId, placement.id) };
    },
  });
}

// ---------------------------------------------------------------------------
// Boundary commands
// ---------------------------------------------------------------------------

export function createBoundaryCommand(levelId: string, boundary: Boundary): Command {
  return command({
    type: 'boundary.create',
    label: boundary.kind === 'space_outline' ? 'Draw room outline' : 'Draw obstruction',
    mergeKey: null,
    apply(document) {
      const next = withLevel(document, levelId, (level) => ({
        ...level,
        boundaries: [...level.boundaries, boundary],
      }));
      return { document: next, inverse: deleteBoundaryCommand(levelId, boundary.id) };
    },
  });
}

function requireBoundary(level: Level, boundaryId: string): Boundary {
  const boundary = level.boundaries.find((entry) => entry.id === boundaryId);
  if (!boundary) throw new EntityNotFoundError('boundary', boundaryId);
  return boundary;
}

export function setBoundaryVerticesCommand(
  levelId: string,
  boundaryId: string,
  vertices: readonly Vec2[],
): Command {
  return command({
    type: 'boundary.setVertices',
    label: 'Reshape boundary',
    mergeKey: `boundary.setVertices:${boundaryId}`,
    apply(document) {
      const level = requireLevel(document, levelId);
      const previous = requireBoundary(level, boundaryId).vertices;

      const next = withLevel(document, levelId, (current) => ({
        ...current,
        boundaries: current.boundaries.map((boundary) =>
          boundary.id === boundaryId ? { ...boundary, vertices: [...vertices] } : boundary,
        ),
      }));

      return {
        document: next,
        inverse: setBoundaryVerticesCommand(levelId, boundaryId, previous),
      };
    },
  });
}

export function deleteBoundaryCommand(levelId: string, boundaryId: string): Command {
  return command({
    type: 'boundary.delete',
    label: 'Delete boundary',
    mergeKey: null,
    apply(document) {
      const level = requireLevel(document, levelId);
      const removed = requireBoundary(level, boundaryId);
      const index = level.boundaries.indexOf(removed);

      const next = withLevel(document, levelId, (current) => ({
        ...current,
        boundaries: current.boundaries.filter((boundary) => boundary.id !== boundaryId),
      }));

      return {
        document: next,
        inverse: restoreBoundaryCommand(levelId, removed, index),
      };
    },
  });
}

function restoreBoundaryCommand(levelId: string, boundary: Boundary, index: number): Command {
  return command({
    type: 'boundary.create',
    label: 'Restore boundary',
    mergeKey: null,
    apply(document) {
      const next = withLevel(document, levelId, (level) => {
        const boundaries = [...level.boundaries];
        boundaries.splice(Math.min(index, boundaries.length), 0, boundary);
        return { ...level, boundaries };
      });
      return { document: next, inverse: deleteBoundaryCommand(levelId, boundary.id) };
    },
  });
}

// ---------------------------------------------------------------------------
// Space commands
// ---------------------------------------------------------------------------

/**
 * Create a room: its outline and its identity, in one undo step.
 *
 * A space with no boundary has no shape and a room outline with no space has no name
 * or function. Splitting them across two commands would let undo leave one behind.
 */
export function createSpaceCommand(
  levelId: string,
  boundary: Boundary,
  space: Space,
): Command {
  return command({
    type: 'space.create',
    label: `Create ${space.name || 'room'}`,
    mergeKey: null,
    apply(document) {
      const next = withLevel(document, levelId, (level) => ({
        ...level,
        boundaries: [...level.boundaries, boundary],
        spaces: [...level.spaces, space],
      }));
      return { document: next, inverse: deleteSpaceCommand(levelId, space.id) };
    },
  });
}

function requireSpace(level: Level, spaceId: string): Space {
  const space = level.spaces.find((entry) => entry.id === spaceId);
  if (!space) throw new EntityNotFoundError('space', spaceId);
  return space;
}

export function renameSpaceCommand(
  levelId: string,
  spaceId: string,
  name: string,
  spaceFunction: Space['function'],
): Command {
  return command({
    type: 'space.rename',
    label: 'Rename room',
    // Typing a name emits one command per keystroke. Sixteen undo steps to take
    // back "Treatment area A" is not what anyone means by undo, so a run of edits
    // to the same room coalesces until the field is left.
    mergeKey: `space.rename:${spaceId}`,
    apply(document) {
      const level = requireLevel(document, levelId);
      const previous = requireSpace(level, spaceId);

      const next = withLevel(document, levelId, (current) => ({
        ...current,
        spaces: current.spaces.map((space) =>
          space.id === spaceId ? { ...space, name, function: spaceFunction } : space,
        ),
      }));

      return {
        document: next,
        inverse: renameSpaceCommand(levelId, spaceId, previous.name, previous.function),
      };
    },
  });
}

/**
 * Delete a room: its outline goes with it, and any machine assigned to it is
 * unassigned rather than deleted.
 *
 * Deleting a room must never delete the equipment standing in it. Losing a machine
 * because a room outline was redrawn is not a recoverable mistake, and it is exactly
 * what an ownership hierarchy would have produced.
 */
export function deleteSpaceCommand(levelId: string, spaceId: string): Command {
  return command({
    type: 'space.delete',
    label: 'Delete room',
    mergeKey: null,
    apply(document) {
      const level = requireLevel(document, levelId);
      const removed = requireSpace(level, spaceId);
      const spaceIndex = level.spaces.indexOf(removed);
      const boundary = level.boundaries.find((entry) => entry.id === removed.boundaryId) ?? null;
      const boundaryIndex = boundary ? level.boundaries.indexOf(boundary) : -1;
      const orphaned = level.placements
        .filter((placement) => placement.spaceId === spaceId)
        .map((placement) => placement.id);

      const next = withLevel(document, levelId, (current) => ({
        ...current,
        spaces: current.spaces.filter((space) => space.id !== spaceId),
        boundaries: current.boundaries.filter((entry) => entry.id !== removed.boundaryId),
        placements: current.placements.map((placement) =>
          placement.spaceId === spaceId ? { ...placement, spaceId: null } : placement,
        ),
      }));

      return {
        document: next,
        inverse: restoreSpaceCommand(levelId, {
          space: removed,
          spaceIndex,
          boundary,
          boundaryIndex,
          reassign: orphaned,
        }),
      };
    },
  });
}

interface RemovedSpace {
  readonly space: Space;
  readonly spaceIndex: number;
  readonly boundary: Boundary | null;
  readonly boundaryIndex: number;
  /** Placements that were assigned to the room, to be reattached on undo. */
  readonly reassign: readonly string[];
}

function restoreSpaceCommand(levelId: string, removed: RemovedSpace): Command {
  return command({
    type: 'space.create',
    label: `Restore ${removed.space.name || 'room'}`,
    mergeKey: null,
    apply(document) {
      const reassign = new Set(removed.reassign);

      const next = withLevel(document, levelId, (level) => {
        const spaces = [...level.spaces];
        spaces.splice(Math.min(removed.spaceIndex, spaces.length), 0, removed.space);

        const boundaries = [...level.boundaries];
        if (removed.boundary) {
          boundaries.splice(
            Math.min(Math.max(removed.boundaryIndex, 0), boundaries.length),
            0,
            removed.boundary,
          );
        }

        return {
          ...level,
          spaces,
          boundaries,
          placements: level.placements.map((placement) =>
            reassign.has(placement.id)
              ? { ...placement, spaceId: removed.space.id }
              : placement,
          ),
        };
      });

      return { document: next, inverse: deleteSpaceCommand(levelId, removed.space.id) };
    },
  });
}

// ---------------------------------------------------------------------------
// Boundary vertex editing
// ---------------------------------------------------------------------------

/**
 * The smallest ring that encloses anything.
 *
 * Deleting past this is refused rather than clamped: a two-vertex "room" would report
 * every machine in the building as outside it, and silently keeping the third vertex
 * would leave the engineer unsure which of their clicks took effect.
 */
export const MIN_BOUNDARY_VERTICES = 3;

function replaceVertices(
  levelId: string,
  boundaryId: string,
  label: string,
  mergeKey: string | null,
  type: CommandType,
  compute: (vertices: readonly Vec2[]) => readonly Vec2[] | null,
): Command {
  return command({
    type,
    label,
    mergeKey,
    apply(document) {
      const level = requireLevel(document, levelId);
      const previous = requireBoundary(level, boundaryId).vertices;
      const next = compute(previous);

      // A refused edit is a no-op that still records an inverse, so the history stays
      // consistent rather than the caller having to know which edits are legal.
      const vertices = next ?? previous;

      const document_ = withLevel(document, levelId, (current) => ({
        ...current,
        boundaries: current.boundaries.map((boundary) =>
          boundary.id === boundaryId ? { ...boundary, vertices: [...vertices] } : boundary,
        ),
      }));

      return {
        document: document_,
        inverse: setBoundaryVerticesCommand(levelId, boundaryId, previous),
      };
    },
  });
}

/** Move one vertex. Coalesces per vertex, so a drag is one undo step. */
export function moveBoundaryVertexCommand(
  levelId: string,
  boundaryId: string,
  index: number,
  position: Vec2,
): Command {
  return replaceVertices(
    levelId,
    boundaryId,
    'Move vertex',
    `boundary.vertex:${boundaryId}:${index}`,
    'boundary.setVertices',
    (vertices) => {
      if (index < 0 || index >= vertices.length) return null;
      const next = [...vertices];
      next[index] = position;
      return next;
    },
  );
}

/**
 * Insert a vertex **after** `index`.
 *
 * After rather than at: the caller has hit-tested an edge, and an edge is identified by
 * the vertex it leaves. Inserting "at" an index would make the last edge — the implied
 * closing one — the awkward special case it does not need to be.
 */
export function insertBoundaryVertexCommand(
  levelId: string,
  boundaryId: string,
  afterIndex: number,
  position: Vec2,
): Command {
  return replaceVertices(
    levelId,
    boundaryId,
    'Insert vertex',
    null,
    'boundary.setVertices',
    (vertices) => {
      if (afterIndex < 0 || afterIndex >= vertices.length) return null;
      const next = [...vertices];
      next.splice(afterIndex + 1, 0, position);
      return next;
    },
  );
}

/** Remove one vertex, unless doing so would leave a ring that encloses nothing. */
export function removeBoundaryVertexCommand(
  levelId: string,
  boundaryId: string,
  index: number,
): Command {
  return replaceVertices(
    levelId,
    boundaryId,
    'Delete vertex',
    null,
    'boundary.setVertices',
    (vertices) => {
      if (index < 0 || index >= vertices.length) return null;
      if (vertices.length <= MIN_BOUNDARY_VERTICES) return null;
      return vertices.filter((_, at) => at !== index);
    },
  );
}

/** Can this vertex be removed at all? Lets a caller disable the control rather than offer a no-op. */
export function canRemoveBoundaryVertex(boundary: Boundary): boolean {
  return boundary.vertices.length > MIN_BOUNDARY_VERTICES;
}

/**
 * Rename an obstruction, or change what kind of obstruction it is.
 *
 * Both in one command because they are one editing act — an engineer correcting
 * "obstruction 3" to "Column C4" is usually setting its type in the same breath, and
 * two undo steps for one correction is a worse answer than one.
 */
export function describeBoundaryCommand(
  levelId: string,
  boundaryId: string,
  label: string,
  obstructionType: Boundary['obstructionType'],
): Command {
  return command({
    type: 'boundary.describe',
    label: 'Rename obstruction',
    // Typing emits a command per keystroke; the field seals on blur.
    mergeKey: `boundary.describe:${boundaryId}`,
    apply(document) {
      const level = requireLevel(document, levelId);
      const previous = requireBoundary(level, boundaryId);

      const next = withLevel(document, levelId, (current) => ({
        ...current,
        boundaries: current.boundaries.map((boundary) =>
          boundary.id === boundaryId ? { ...boundary, label, obstructionType } : boundary,
        ),
      }));

      return {
        document: next,
        inverse: describeBoundaryCommand(
          levelId,
          boundaryId,
          previous.label,
          previous.obstructionType,
        ),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Plan origin
// ---------------------------------------------------------------------------

/**
 * Declare which image pixel is model (0, 0), and renumber the layout to match.
 *
 * ## Why this moves the geometry
 *
 * The transform is `model_mm = rotate(px − origin, θ) × mmPerPixel`. Moving the origin
 * changes where the *drawing* sits in model space — so on its own, it would slide the
 * plan out from under every machine already placed on it.
 *
 * That is not what an engineer means. "Set the origin here" means *call this point zero*:
 * the layout must not move on the drawing, the coordinates must renumber. So every
 * placement and every boundary vertex is translated by the same delta, leaving each of
 * them over the same pixel of the plan it was over before.
 *
 * On an empty level — the ordinary case, since the origin is set right after calibration
 * — the translation is a no-op. It only earns its keep when the origin is set late, which
 * is exactly when getting it wrong would be hardest to notice.
 *
 * ## Why this one is undoable when setting the scale is not
 *
 * Because it is exactly reversible. A scale change reinterprets what a millimetre *is*;
 * a re-datum only changes what the numbers are measured from, and translating back by
 * the same delta restores the document field for field.
 *
 * Refused, as a no-op, on a level with no coordinate mapping: there is nothing to be the
 * origin of until a scale exists.
 */
export function setPlanOriginCommand(levelId: string, originPixel: Vec2): Command {
  return command({
    type: 'plan.setOrigin',
    label: 'Set drawing origin',
    mergeKey: null,
    apply(document) {
      const level = requireLevel(document, levelId);
      const mapping = level.coordinateMapping;

      if (!mapping) {
        return { document, inverse: setPlanOriginCommand(levelId, originPixel) };
      }

      const previousOrigin = mapping.origin;
      const delta = originShift(previousOrigin, originPixel, mapping);

      const next = withLevel(document, levelId, (current) => ({
        ...current,
        coordinateMapping: current.coordinateMapping
          ? { ...current.coordinateMapping, origin: originPixel }
          : null,
        placements: current.placements.map((placement) => ({
          ...placement,
          transform: {
            ...placement.transform,
            position: {
              x: placement.transform.position.x - delta.x,
              y: placement.transform.position.y - delta.y,
            },
          },
        })),
        boundaries: current.boundaries.map((boundary) => ({
          ...boundary,
          vertices: boundary.vertices.map((vertex) => ({
            x: vertex.x - delta.x,
            y: vertex.y - delta.y,
          })),
        })),
      }));

      return { document: next, inverse: setPlanOriginCommand(levelId, previousOrigin) };
    },
  });
}

/**
 * How far model space shifts when the origin pixel moves to `to`.
 *
 * `delta = rotate(newOrigin − oldOrigin, θ) × mmPerPixel`, which is the difference
 * between what the two transforms report for any given pixel. Everything on the drawing
 * moves by `−delta` in model space to stay where it is on the drawing.
 *
 * Exported because the editor needs it as well as the command: the *document* geometry
 * moves by `−delta`, so the **viewport** has to move with it or the whole drawing jumps
 * on screen the moment an engineer picks an origin. Two callers, one arithmetic —
 * duplicating it is how the picture and the coordinates come to disagree.
 */
export function planOriginShift(mapping: CoordinateMapping, to: Vec2): Vec2 {
  return originShift(mapping.origin, to, mapping);
}

function originShift(from: Vec2, to: Vec2, mapping: CoordinateMapping): Vec2 {
  const shifted = { x: to.x - from.x, y: to.y - from.y };
  const radians = millidegreesToRadians(mapping.rotation);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  return {
    x: (shifted.x * cos - shifted.y * sin) * mapping.millimetresPerPixel,
    y: (shifted.x * sin + shifted.y * cos) * mapping.millimetresPerPixel,
  };
}

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

export function createLevelCommand(levelId: string, name: string, elevation = 0): Command {
  return command({
    type: 'level.create',
    label: `Add ${name}`,
    mergeKey: null,
    apply(document) {
      const next: MfdDocument = {
        ...document,
        project: {
          ...document.project,
          levels: [...document.project.levels, createLevel(levelId, name, elevation)],
        },
      };
      return { document: next, inverse: deleteLevelCommand(levelId) };
    },
  });
}

export function renameLevelCommand(levelId: string, name: string, elevation: number): Command {
  return command({
    type: 'level.rename',
    label: 'Rename level',
    mergeKey: `level.rename:${levelId}`,
    apply(document) {
      const previous = requireLevel(document, levelId);

      const next: MfdDocument = {
        ...document,
        project: {
          ...document.project,
          levels: document.project.levels.map((level) =>
            level.id === levelId ? { ...level, name, elevation } : level,
          ),
        },
      };

      return {
        document: next,
        inverse: renameLevelCommand(levelId, previous.name, previous.elevation),
      };
    },
  });
}

/**
 * Delete a level, with everything on it.
 *
 * The last level cannot be deleted — the schema requires at least one, and a project
 * with no floor is not a project. The attempt is a no-op rather than a throw: a UI that
 * offers the control is the thing to fix, and crashing the editor is not how to report it.
 *
 * This is the single most destructive command in the set, which is exactly why it is a
 * command. A floor holding fifty machines and a calibrated plan is restored whole,
 * at its original position in the level order.
 */
export function deleteLevelCommand(levelId: string): Command {
  return command({
    type: 'level.delete',
    label: 'Delete level',
    mergeKey: null,
    apply(document) {
      const removed = requireLevel(document, levelId);
      if (document.project.levels.length <= 1) {
        return { document, inverse: deleteLevelCommand(levelId) };
      }

      const index = document.project.levels.indexOf(removed);

      const next: MfdDocument = {
        ...document,
        project: {
          ...document.project,
          levels: document.project.levels.filter((level) => level.id !== levelId),
        },
      };

      return { document: next, inverse: restoreLevelCommand(removed, index) };
    },
  });
}

function restoreLevelCommand(level: Level, index: number): Command {
  return command({
    type: 'level.create',
    label: `Restore ${level.name}`,
    mergeKey: null,
    apply(document) {
      const levels = [...document.project.levels];
      levels.splice(Math.min(index, levels.length), 0, level);

      return {
        document: { ...document, project: { ...document.project, levels } },
        inverse: deleteLevelCommand(level.id),
      };
    },
  });
}

/** Can this level be deleted? A project needs at least one floor. */
export function canDeleteLevel(document: MfdDocument): boolean {
  return document.project.levels.length > 1;
}

// ---------------------------------------------------------------------------
// Project details
// ---------------------------------------------------------------------------

/** The fields the report's cover page is built from. */
export interface ProjectDetails {
  readonly name: string;
  readonly hospital: string;
  readonly site: string;
  readonly contact: string;
  readonly reviewedBy: string;
}

export function projectDetailsOf(document: MfdDocument): ProjectDetails {
  const { project } = document;
  return {
    name: project.name,
    hospital: project.customer.hospital,
    site: project.customer.site,
    contact: project.customer.contact,
    reviewedBy: project.reviewedBy,
  };
}

/**
 * Set the project's identity — the report's cover page.
 *
 * Added in Sprint 5 because the report needs it and nothing could set it. The schema has
 * carried `customer` and `reviewedBy` since Sprint 4, so a hospital name has always been
 * *storable*; there was simply no way for an engineer to type one, which meant every real
 * report would have had a blank cover page.
 *
 * One command for all five fields rather than one per field. They are edited together in one
 * panel, and five separate undo entries for filling in a form is not what an engineer means
 * by undo.
 *
 * `mergeKey` is constant, so a typing session coalesces into one undo step the same way
 * renaming a room does — sealed on blur.
 */
export function setProjectDetailsCommand(details: ProjectDetails): Command {
  return command({
    type: 'project.setDetails',
    label: 'Edit project details',
    mergeKey: 'project.setDetails',
    apply(document) {
      const previous = projectDetailsOf(document);

      const next: MfdDocument = {
        ...document,
        project: {
          ...document.project,
          name: details.name,
          customer: {
            hospital: details.hospital,
            site: details.site,
            contact: details.contact,
          },
          reviewedBy: details.reviewedBy,
        },
      };

      return { document: next, inverse: setProjectDetailsCommand(previous) };
    },
  });
}
