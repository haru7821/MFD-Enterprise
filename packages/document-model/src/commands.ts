import type { Vec2 } from '@mfd/cad-engine';
import { normaliseRotation } from '@mfd/cad-engine';

import { requireLevel } from './document';
import { EntityNotFoundError } from './errors';
import type { Boundary, Level, MfdDocument, Placement, Space } from './schema';

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
 * Importing a plan and calibrating it are not commands. Undoing a calibration would
 * leave placements sitting at millimetre positions derived from a mapping that no
 * longer exists — geometry silently reinterpreted, which is the failure mode this
 * whole product exists to prevent. Both are explicit, deliberate acts with their own
 * confirmation, and both are re-doable by repeating them.
 */

export type CommandType =
  | 'placement.create'
  | 'placement.move'
  | 'placement.rotate'
  | 'placement.assignSpace'
  | 'placement.delete'
  | 'boundary.create'
  | 'boundary.setVertices'
  | 'boundary.delete'
  | 'space.create'
  | 'space.rename'
  | 'space.delete';

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
