import { describe, expect, it } from 'vitest';

import {
  fixtureDocument,
  fixturePlacement,
  fixturePlanImage,
  fixtureRoomBoundary,
  fixtureSpace,
} from '../fixtures/index';
import { DOCUMENT_VERSION, boundarySchema, documentSchema, placementSchema } from './schema';

/**
 * Schema rejection cases.
 *
 * Each test below is a document that would mislead an engineer if it loaded. The
 * point of the schema is that none of them do.
 */

function validDocument(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(fixtureDocument())) as Record<string, unknown>;
}

describe('a valid document', () => {
  it('parses', () => {
    expect(documentSchema.safeParse(validDocument()).success).toBe(true);
  });

  it('carries a version', () => {
    expect(fixtureDocument().documentVersion).toBe(DOCUMENT_VERSION);
  });
});

describe('rejections', () => {
  it('rejects an unknown key rather than dropping it', () => {
    // A document from a newer build must fail loudly. Silently discarding the field
    // this build does not understand loses it the moment the engineer saves.
    const document = validDocument();
    document['experimentalFeature'] = true;
    expect(documentSchema.safeParse(document).success).toBe(false);
  });

  it('rejects a project with no levels', () => {
    const document = validDocument();
    (document['project'] as Record<string, unknown>)['levels'] = [];
    expect(documentSchema.safeParse(document).success).toBe(false);
  });

  it('rejects a missing field even when the value would be unknown', () => {
    // `null` is a statement; an absent key is a mistake. They must not look alike.
    const document = validDocument();
    const level = (document['project'] as { levels: Record<string, unknown>[] }).levels[0];
    delete level?.['coordinateMapping'];
    expect(documentSchema.safeParse(document).success).toBe(false);
  });

  it('accepts an explicitly null coordinate mapping', () => {
    const document = validDocument();
    const level = (document['project'] as { levels: Record<string, unknown>[] }).levels[0];
    expect(level?.['coordinateMapping']).toBeNull();
    expect(documentSchema.safeParse(document).success).toBe(true);
  });

  it('rejects a timestamp that is not ISO 8601', () => {
    const document = validDocument();
    (document['project'] as Record<string, unknown>)['createdAt'] = '29/07/2026';
    expect(documentSchema.safeParse(document).success).toBe(false);
  });
});

describe('boundary', () => {
  it('accepts a triangle', () => {
    const boundary = { ...fixtureRoomBoundary(), vertices: [
      { x: 0, y: 0 },
      { x: 1_000, y: 0 },
      { x: 0, y: 1_000 },
    ] };
    expect(boundarySchema.safeParse(boundary).success).toBe(true);
  });

  it('rejects fewer than three vertices', () => {
    // Two points enclose nothing; a "room" made of them would report every machine
    // in the building as outside it.
    const boundary = {
      ...fixtureRoomBoundary(),
      vertices: [
        { x: 0, y: 0 },
        { x: 1_000, y: 0 },
      ],
    };
    expect(boundarySchema.safeParse(boundary).success).toBe(false);
  });

  it('rejects an unknown kind', () => {
    expect(
      boundarySchema.safeParse({ ...fixtureRoomBoundary(), kind: 'doorway' }).success,
    ).toBe(false);
  });
});

describe('placement', () => {
  it('requires an explicit spaceId, even when there is no room', () => {
    const placement = fixturePlacement('p1', { x: 0, y: 0 });
    expect(placement.spaceId).toBeNull();
    expect(placementSchema.safeParse(placement).success).toBe(true);

    const withoutSpace: Record<string, unknown> = { ...placement };
    delete withoutSpace['spaceId'];
    expect(placementSchema.safeParse(withoutSpace).success).toBe(false);
  });

  it('rejects a non-finite coordinate', () => {
    const placement = fixturePlacement('p1', { x: Number.NaN, y: 0 });
    expect(placementSchema.safeParse(placement).success).toBe(false);
  });
});

describe('plan image', () => {
  it('requires a data URL, not a path', () => {
    // A project file an engineer emails to a colleague has to arrive with its
    // drawing. A path into someone else's filesystem is not a floor plan.
    expect(
      documentSchema.safeParse(withPlanImage({ dataUrl: '/home/user/plans/3f.png' })).success,
    ).toBe(false);
  });

  it('rejects a zero-pixel image', () => {
    expect(documentSchema.safeParse(withPlanImage({ pixelWidth: 0 })).success).toBe(false);
  });

  it('accepts a complete plan image', () => {
    expect(documentSchema.safeParse(withPlanImage({})).success).toBe(true);
  });
});

function withPlanImage(overrides: Record<string, unknown>): Record<string, unknown> {
  const document = validDocument();
  const level = (document['project'] as { levels: Record<string, unknown>[] }).levels[0];
  if (level) level['planImage'] = { ...fixturePlanImage(), ...overrides };
  return document;
}

describe('space', () => {
  it('rejects a function outside the controlled vocabulary', () => {
    // Free text would let "Treatment Rm" and "treatment room" become two different
    // things no rule matches — and a rule that matches nothing looks like a rule
    // everything passes.
    const document = validDocument();
    const level = (document['project'] as { levels: Record<string, unknown>[] }).levels[0];
    if (level) {
      level['boundaries'] = [fixtureRoomBoundary()];
      level['spaces'] = [{ ...fixtureSpace(), function: 'Treatment Rm' }];
    }
    expect(documentSchema.safeParse(document).success).toBe(false);
  });
});
