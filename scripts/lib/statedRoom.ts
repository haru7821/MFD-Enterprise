/**
 * A room whose extent was **stated** rather than measured off the drawing — finding F-2.
 *
 * Pilot-001 produced a drawing that states its room as text — `Room: 25,000 x 15,000 mm` — with no
 * dimension line and `Scale: fit-to-page`. Neither calibration method applies, so the pipeline stops
 * at `room`. But the number an engineer needs is *on the sheet*, and the solver takes a polygon in
 * millimetres: nothing about that requires calibrating an image.
 *
 * What was missing was a way to say *"the room is 25,000 × 15,000, and here is who says so"*. The
 * geometry provenance model already defines the tier — **Tier 2, Verified Geometry, confirmed by
 * human input** — and had no input path. This is that path.
 *
 * ## The distinction this module exists to enforce
 *
 * A dimension **printed on a drawing** and a dimension **a person has confirmed** are different
 * evidence, and the whole failure mode here is that they look identical once they are numbers.
 *
 * | | Tier | Usable as room geometry |
 * | --- | --- | --- |
 * | `drawing-text` — read off the sheet, nobody checked it | 1 · Drawing Evidence | **No** |
 * | `human-confirmed` — a person states it and says against what | 2 · Verified Geometry | Yes |
 *
 * `25,000 × 15,000` read off a title block is a *claim the drawing makes*. It may be the building
 * rather than the room, it may be stale, it may disagree with the geometry beneath it — Pilot-001's
 * own `VD-1` is exactly that failure, a printed dimension 3.01 % out from its own linework. Treating
 * printed text as confirmed would place equipment in a room nobody measured.
 *
 * So `drawing-text` is **recorded and refused for geometry**. It is not discarded: it is the
 * candidate a person is being asked to confirm.
 */

/** Where a stated room extent came from. */
export const ROOM_STATEMENT_SOURCES = ['drawing-text', 'human-confirmed'] as const;
export type RoomStatementSource = (typeof ROOM_STATEMENT_SOURCES)[number];

export interface RoomStatementInput {
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly source: RoomStatementSource;
  /** Who states it. Required for `human-confirmed`; a person, not a role. */
  readonly statedBy?: string | undefined;
  /** What they checked against. Required for `human-confirmed`. */
  readonly basis?: string | undefined;
}

/** A statement that may be used as evaluation geometry — Tier 2. */
export interface VerifiedRoom {
  readonly kind: 'verified';
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly statedBy: string;
  readonly basis: string;
}

/**
 * A statement read off the drawing and confirmed by nobody — Tier 1.
 *
 * Carried rather than dropped, because it is what the engineer is being asked about. It is not
 * geometry, and {@link roomPolygon} will not build one from it.
 */
export interface UnverifiedRoom {
  readonly kind: 'unverified';
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly needs: string;
}

/** The statement cannot be used at all, and the reason is stated. */
export interface RefusedRoom {
  readonly kind: 'refused';
  readonly reason: string;
}

export type RoomStatement = VerifiedRoom | UnverifiedRoom | RefusedRoom;

/**
 * **Three outcomes and no fourth**, and no branch promotes a statement to a tier it did not arrive
 * with. A `drawing-text` statement cannot become verified by passing through here — only a person
 * can do that, by stating who they are and what they checked.
 */
export function statedRoom(input: RoomStatementInput): RoomStatement {
  const { lengthMm, widthMm } = input;

  for (const [label, value] of [
    ['length', lengthMm],
    ['width', widthMm],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      return { kind: 'refused', reason: `${label} must be a positive number of millimetres` };
    }
  }

  if (input.source === 'human-confirmed') {
    /*
     * Both, or it is not a confirmation. A number with a name but no basis says a person typed it;
     * a number with a basis but no name says nobody is answerable for it. The confirmation chain
     * already learned this — `confirmationSchema` requires `name` and `basis` for the same reason.
     */
    const statedBy = (input.statedBy ?? '').trim();
    const basis = (input.basis ?? '').trim();
    if (statedBy === '' || basis === '') {
      return {
        kind: 'refused',
        reason:
          'a human-confirmed room requires both `statedBy` (a person, not a role) and `basis` ' +
          '(what was checked against). Without them it is a drawing-text claim wearing a ' +
          'confirmation label',
      };
    }
    return { kind: 'verified', lengthMm, widthMm, statedBy, basis };
  }

  return {
    kind: 'unverified',
    lengthMm,
    widthMm,
    needs:
      'read from the drawing and confirmed by nobody. A person must state it as human-confirmed, ' +
      'naming themselves and what they checked against, before it can be used as room geometry',
  };
}

/**
 * The room as a polygon the solver can take — **only from a verified statement**.
 *
 * Returns `null` for anything else. There is deliberately no `force` parameter and no way to pass
 * an unverified statement through: the refusal is the feature, and an escape hatch would be used.
 *
 * The polygon is the axis-aligned rectangle the stated dimensions describe, with its origin at
 * (0, 0). It is **not** positioned against the drawing image, because a stated room has no
 * relationship to image pixels — that is precisely why it needed no calibration.
 */
export function roomPolygon(
  statement: RoomStatement,
): readonly { readonly x: number; readonly y: number }[] | null {
  if (statement.kind !== 'verified') return null;
  return [
    { x: 0, y: 0 },
    { x: statement.lengthMm, y: 0 },
    { x: statement.lengthMm, y: statement.widthMm },
    { x: 0, y: statement.widthMm },
  ];
}

/**
 * What a result built on this statement must say about its own geometry.
 *
 * A layout evaluated against a stated room is not the same claim as one evaluated against a room
 * measured from a calibrated drawing, and the difference has to reach the reader. This returns the
 * sentence that carries it.
 */
export function provenanceNote(statement: RoomStatement): string {
  switch (statement.kind) {
    case 'verified':
      return (
        `Room extent ${statement.lengthMm} × ${statement.widthMm} mm as stated by ` +
        `${statement.statedBy}, against ${statement.basis}. Not measured from the drawing — ` +
        `no dimension was calibrated, and nothing here checks the statement against the linework.`
      );
    case 'unverified':
      return (
        `Room extent ${statement.lengthMm} × ${statement.widthMm} mm read from the drawing and ` +
        `confirmed by nobody. Not usable as geometry.`
      );
    case 'refused':
      return `No room extent: ${statement.reason}.`;
  }
}
