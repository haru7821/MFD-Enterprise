import { describe, expect, it } from 'vitest';

import { provenanceNote, roomPolygon, statedRoom } from './statedRoom';

/**
 * The rule under test: **printed text is not a confirmed dimension.**
 *
 * Once both are numbers they are indistinguishable, so this cannot be caught by reading a result.
 * Pilot-001's `VD-1` is the concrete case — a printed dimension 3.01 % out from its own linework —
 * and it is why a drawing's own statement about its room may not be used as geometry.
 */
describe('a drawing’s printed room extent is not geometry', () => {
  it('records drawing text as unverified, and says what it needs', () => {
    // The Pilot-001 upload states exactly this, with no dimension line and Scale: fit-to-page.
    const statement = statedRoom({ lengthMm: 25_000, widthMm: 15_000, source: 'drawing-text' });

    expect(statement.kind).toBe('unverified');
    expect(statement.kind === 'unverified' && statement.needs).toContain('confirmed by nobody');
  });

  it('refuses to build a polygon from it', () => {
    /*
     * The load-bearing case. If this ever returns a polygon, equipment gets placed in a room nobody
     * measured, and the result looks identical to one built on a confirmed dimension.
     */
    const statement = statedRoom({ lengthMm: 25_000, widthMm: 15_000, source: 'drawing-text' });

    expect(roomPolygon(statement)).toBeNull();
  });

  it('cannot be promoted by passing it through again', () => {
    // No branch upgrades a tier. Only a person supplying name and basis produces `verified`.
    const first = statedRoom({ lengthMm: 25_000, widthMm: 15_000, source: 'drawing-text' });
    const second = statedRoom({
      lengthMm: 25_000,
      widthMm: 15_000,
      source: 'drawing-text',
      statedBy: 'someone',
      basis: 'the sheet',
    });

    expect(first.kind).toBe('unverified');
    // Name and basis on a drawing-text statement do not make it a confirmation.
    expect(second.kind).toBe('unverified');
  });
});

describe('a human-confirmed room is usable, and only with both attributions', () => {
  const confirmed = {
    lengthMm: 25_000,
    widthMm: 15_000,
    source: 'human-confirmed' as const,
    statedBy: 'Kim',
    basis: 'measured on the printed sheet against the 25 m overall dimension',
  };

  it('accepts a statement carrying who and against what', () => {
    const statement = statedRoom(confirmed);

    expect(statement.kind).toBe('verified');
    expect(statement.kind === 'verified' && statement.statedBy).toBe('Kim');
  });

  it('builds the rectangle the dimensions describe', () => {
    expect(roomPolygon(statedRoom(confirmed))).toEqual([
      { x: 0, y: 0 },
      { x: 25_000, y: 0 },
      { x: 25_000, y: 15_000 },
      { x: 0, y: 15_000 },
    ]);
  });

  it('refuses a confirmation missing the name', () => {
    expect(statedRoom({ ...confirmed, statedBy: undefined }).kind).toBe('refused');
    expect(statedRoom({ ...confirmed, statedBy: '   ' }).kind).toBe('refused');
  });

  it('refuses a confirmation missing the basis', () => {
    const refused = statedRoom({ ...confirmed, basis: undefined });

    expect(refused.kind).toBe('refused');
    expect(refused.kind === 'refused' && refused.reason).toContain('wearing a confirmation label');
  });
});

describe('dimensions must be real measurements', () => {
  it.each([
    ['zero', 0],
    ['negative', -1],
    ['NaN', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
  ])('refuses a %s length', (_label, lengthMm) => {
    expect(statedRoom({ lengthMm, widthMm: 15_000, source: 'human-confirmed', statedBy: 'Kim', basis: 'x' }).kind).toBe(
      'refused',
    );
  });

  it('refuses a bad width too, naming which one', () => {
    const refused = statedRoom({ lengthMm: 25_000, widthMm: 0, source: 'human-confirmed', statedBy: 'Kim', basis: 'x' });

    expect(refused.kind === 'refused' && refused.reason).toContain('width');
  });
});

describe('the provenance note reaches the reader', () => {
  it('says a verified room was stated, not measured', () => {
    const note = provenanceNote(
      statedRoom({ lengthMm: 25_000, widthMm: 15_000, source: 'human-confirmed', statedBy: 'Kim', basis: 'the sheet' }),
    );

    expect(note).toContain('as stated by Kim');
    expect(note).toContain('Not measured from the drawing');
    // And it does not claim the statement was checked against the linework, because it was not.
    expect(note).toContain('nothing here checks the statement against the linework');
  });

  it('says an unverified room is not usable', () => {
    expect(provenanceNote(statedRoom({ lengthMm: 1, widthMm: 1, source: 'drawing-text' }))).toContain(
      'Not usable as geometry',
    );
  });
});
