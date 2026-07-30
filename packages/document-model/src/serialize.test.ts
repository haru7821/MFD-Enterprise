import { describe, expect, it } from 'vitest';

import {
  FIXTURE_LEVEL_ID,
  FIXTURE_NOW,
  fixtureDocument,
  fixturePlacement,
  fixturePlanImage,
  fixtureRoomBoundary,
  fixtureSpace,
} from '../fixtures/index';
import { createPlacementCommand, createSpaceCommand } from './commands';
import { DocumentValidationError, UnsupportedDocumentVersionError } from './errors';
import { calibrateFromTwoPoints, setCoordinateMapping, setPlanImage } from './plan';
import { DOCUMENT_VERSION, type MfdDocument } from './schema';
import {
  MIGRATIONS,
  loadDocument,
  parseDocument,
  readDocumentVersion,
  saveDocument,
  suggestedFileName,
} from './serialize';

const SAVED_AT = '2026-07-29T11:30:00.000Z';

/** A document with something in every part of the model. */
function populated(): MfdDocument {
  let document = createSpaceCommand(FIXTURE_LEVEL_ID, fixtureRoomBoundary(), fixtureSpace()).apply(
    fixtureDocument(),
  ).document;

  document = createPlacementCommand(
    FIXTURE_LEVEL_ID,
    fixturePlacement('p1', { x: 1_000, y: 1_000 }, { spaceId: 'space-1' }),
  ).apply(document).document;

  document = setPlanImage(document, FIXTURE_LEVEL_ID, fixturePlanImage());

  const mapping = calibrateFromTwoPoints({
    pointA: { x: 100, y: 100 },
    pointB: { x: 340, y: 100 },
    knownDistance: 2_400,
    now: FIXTURE_NOW,
  });

  return setCoordinateMapping(document, FIXTURE_LEVEL_ID, mapping);
}

describe('round trip', () => {
  it('reads back exactly what it wrote', () => {
    const document = populated();
    const restored = loadDocument(saveDocument(document, { now: FIXTURE_NOW }));
    expect(restored).toEqual(document);
  });

  it('stamps updatedAt on save', () => {
    const saved = loadDocument(saveDocument(populated(), { now: SAVED_AT }));
    expect(saved.project.updatedAt).toBe(SAVED_AT);
    // createdAt is not touched.
    expect(saved.project.createdAt).toBe(FIXTURE_NOW);
  });

  it('produces the same bytes twice', () => {
    // A report is supposed to be reproducible. A document that serialised differently
    // on each save could not be diffed, signed or compared between engineers.
    const document = populated();
    expect(saveDocument(document, { now: SAVED_AT })).toBe(
      saveDocument(document, { now: SAVED_AT }),
    );
  });

  it('keeps the embedded plan image through the round trip', () => {
    const restored = loadDocument(saveDocument(populated(), { now: SAVED_AT }));
    expect(restored.project.levels[0]?.planImage?.dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('preserves an exact quarter turn', () => {
    // The reason rotation is millidegrees rather than radians: 90° has to survive
    // being written out and read back as the same number.
    let document = fixtureDocument();
    document = createPlacementCommand(
      FIXTURE_LEVEL_ID,
      fixturePlacement('p1', { x: 0, y: 0 }, {
        transform: { position: { x: 0, y: 0 }, rotation: 90_000, mirrored: false },
      }),
    ).apply(document).document;

    const restored = loadDocument(saveDocument(document, { now: SAVED_AT }));
    expect(restored.project.levels[0]?.placements[0]?.transform.rotation).toBe(90_000);
  });
});

describe('version handling', () => {
  it('reads the version without validating the rest', () => {
    expect(readDocumentVersion({ documentVersion: 3, nonsense: true })).toBe(3);
    expect(readDocumentVersion({ documentVersion: 0 })).toBeNull();
    expect(readDocumentVersion('not an object')).toBeNull();
  });

  it('refuses a document from a newer build', () => {
    // Opening it anyway would drop everything this build does not understand the
    // moment the engineer saved — over their only copy.
    const future = { ...populated(), documentVersion: DOCUMENT_VERSION + 1 };
    expect(() => parseDocument(future)).toThrow(UnsupportedDocumentVersionError);
  });

  it('has a migration for every version step below the current one', () => {
    // The guard that fires when someone bumps DOCUMENT_VERSION and forgets the
    // migration. Without it the omission surfaces as an engineer's saved project
    // refusing to open after an update.
    for (let version = 1; version < DOCUMENT_VERSION; version += 1) {
      expect(
        MIGRATIONS.some((migration) => migration.from === version),
        `no migration from document version ${version}`,
      ).toBe(true);
    }
  });

  it('refuses a version it has no migration for', () => {
    const orphaned = { ...populated(), documentVersion: DOCUMENT_VERSION };
    // Nothing to migrate at v1. When that changes, the case above covers the chain
    // and this one covers the refusal path.
    expect(() => parseDocument(orphaned)).not.toThrow();
    expect(MIGRATIONS.filter((migration) => migration.to !== migration.from + 1)).toHaveLength(0);
  });

  it('rejects a file with no version at all', () => {
    expect(() => parseDocument({ project: {} })).toThrow(DocumentValidationError);
  });
});

describe('failure messages', () => {
  it('separates "not JSON" from "not a document"', () => {
    expect(() => loadDocument('{ not json')).toThrow(/not valid JSON/);
  });

  it('names every bad field', () => {
    const broken = JSON.parse(JSON.stringify(populated())) as Record<string, unknown>;
    const level = (broken['project'] as { levels: Record<string, unknown>[] }).levels[0];
    if (level) level['boundaries'] = [{ id: 'b', kind: 'wall', vertices: [], label: '' }];

    try {
      parseDocument(broken);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentValidationError);
      // The person reading this is an engineer whose saved review will not open.
      expect((error as Error).message).toContain('vertices');
    }
  });

  it('validates on the way out as well as the way in', () => {
    // An editor bug that produced an invalid document would otherwise surface when
    // the engineer reopened the file, long after the state that caused it was gone.
    const broken = {
      ...populated(),
      project: { ...populated().project, levels: [] },
    } as MfdDocument;

    expect(() => saveDocument(broken, { now: SAVED_AT })).toThrow(DocumentValidationError);
  });
});

describe('file naming', () => {
  it('suggests a name an engineer will recognise', () => {
    expect(suggestedFileName(fixtureDocument())).toBe('seoul-st-mary-s-3f-dialysis-unit.mfd.json');
  });

  it('falls back when the project has no usable name', () => {
    const unnamed = { ...fixtureDocument(), project: { ...fixtureDocument().project, name: '###' } };
    expect(suggestedFileName(unnamed)).toBe('project.mfd.json');
  });
});

describe('v2 → v3 migration', () => {
  /** A document as version 2 wrote it: no `project.settings`. */
  function v2Document(): Record<string, unknown> {
    const current = JSON.parse(JSON.stringify(populated())) as Record<string, unknown>;
    const project = current['project'] as Record<string, unknown>;
    delete project['settings'];
    return { ...current, documentVersion: 2 };
  }

  it('fills in the default settings', () => {
    // Vector-only is the only honest value for a file written before render modes existed:
    // it is what every report generated by that version actually produced.
    const migrated = parseDocument(v2Document());

    expect(migrated.documentVersion).toBe(DOCUMENT_VERSION);
    expect(migrated.project.settings).toEqual({ reportRenderMode: 'vector' });
  });

  it('refuses a version 3 document with no settings', () => {
    // The setting is required, not optional. An absent setting and a chosen default must not
    // look the same on disk — otherwise a report could not say which was intended.
    expect(() => parseDocument({ ...v2Document(), documentVersion: 3 })).toThrow(
      DocumentValidationError,
    );
  });

  it('keeps a mode the engineer chose, through a save and reopen', () => {
    const chosen = parseDocument({
      ...v2Document(),
      documentVersion: 2,
    });
    const withRaster = {
      ...chosen,
      project: {
        ...chosen.project,
        settings: { reportRenderMode: 'vector_raster' as const },
      },
    };

    const reopened = loadDocument(saveDocument(withRaster, { now: SAVED_AT }));
    expect(reopened.project.settings.reportRenderMode).toBe('vector_raster');
  });
});

describe('v1 → v2 migration', () => {
  /** A document as version 1 wrote it: boundaries with no `obstructionType`. */
  function v1Document(): Record<string, unknown> {
    const current = JSON.parse(JSON.stringify(populated())) as Record<string, unknown>;
    const project = current['project'] as { levels: Record<string, unknown>[] };
    const level = project.levels[0];
    if (level) {
      level['boundaries'] = [
        { id: 'b1', kind: 'space_outline', vertices: room(), label: 'Treatment area' },
        { id: 'b2', kind: 'wall', vertices: room(), label: 'Party wall' },
        { id: 'b3', kind: 'obstruction', vertices: room(), label: '' },
      ];
      level['spaces'] = [
        { id: 'space-1', name: 'Treatment area', function: 'hemodialysis_treatment', boundaryId: 'b1' },
      ];
    }
    // Version 1 had no project settings — those arrive in version 3 — so a realistic v1 file
    // does not carry them. Leaving them in would make the test pass through a shape no v1
    // file ever had.
    delete (project as unknown as Record<string, unknown>)['settings'];
    return { ...current, documentVersion: 1 };
  }

  function room() {
    return [
      { x: 0, y: 0 },
      { x: 1_000, y: 0 },
      { x: 1_000, y: 1_000 },
    ];
  }

  it('opens a version 1 document', () => {
    // The first real migration. Before this, the chain was a mechanism with nothing
    // to run — which is a claim, not a mechanism.
    const migrated = parseDocument(v1Document());
    expect(migrated.documentVersion).toBe(DOCUMENT_VERSION);
    expect(migrated.project.levels[0]?.boundaries).toHaveLength(3);
  });

  it('leaves room outlines and walls untyped', () => {
    const boundaries = parseDocument(v1Document()).project.levels[0]?.boundaries ?? [];
    expect(boundaries.find((entry) => entry.id === 'b1')?.obstructionType).toBeNull();
    expect(boundaries.find((entry) => entry.id === 'b2')?.obstructionType).toBeNull();
  });

  it('types a version 1 obstruction as "other" rather than guessing', () => {
    // A v1 obstruction says something is in the way and nothing about what. "other"
    // records that honestly; "column" would be an invention the engineer would then
    // have to notice was wrong.
    const boundaries = parseDocument(v1Document()).project.levels[0]?.boundaries ?? [];
    expect(boundaries.find((entry) => entry.id === 'b3')?.obstructionType).toBe('other');
  });

  it('re-saves at the current version, so the migration runs once', () => {
    const migrated = parseDocument(v1Document());
    const reopened = loadDocument(saveDocument(migrated, { now: SAVED_AT }));
    expect(reopened.documentVersion).toBe(DOCUMENT_VERSION);
    expect(reopened).toEqual({ ...migrated, project: { ...migrated.project, updatedAt: SAVED_AT } });
  });

  it('survives a v1 document with no boundaries at all', () => {
    const bare = JSON.parse(JSON.stringify(populated())) as Record<string, unknown>;
    const project = bare['project'] as { levels: Record<string, unknown>[] };
    const level = project.levels[0];
    if (level) level['boundaries'] = [];
    expect(() => parseDocument({ ...bare, documentVersion: 1 })).not.toThrow();
  });

  it('does not crash on a v1 file whose shape is not what we expect', () => {
    // A migration receives unvalidated JSON by necessity. It has to fail at the
    // schema check that follows, not with a TypeError halfway through.
    expect(() => parseDocument({ documentVersion: 1, project: 'not an object' })).toThrow(
      DocumentValidationError,
    );
    expect(() => parseDocument({ documentVersion: 1 })).toThrow(DocumentValidationError);
  });
});
