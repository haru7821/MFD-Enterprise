import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DocumentMigrationError } from './errors';
import { DOCUMENT_VERSION, type MfdDocument } from './schema';
import { loadDocument, parseDocument, saveDocument } from './serialize';

/**
 * Opening a real version 3 project with the current build.
 *
 * > Owner decision, Hardening priority 2: *"A project created with the previous version can be
 * > opened and exported by the current version."* — with no data loss, placements preserved,
 * > equipment references preserved, plan data migrated correctly, provenance fields created
 * > correctly, and *"migration must remain deterministic. No silent repair."*
 *
 * ## Why a file rather than a fixture function
 *
 * `serialize.test.ts` already migrates documents built by taking a *current* document and deleting
 * the fields a v3 file would not have had. That tests the migration code, and it has a blind spot
 * it cannot see past: the "v3 document" is constructed from today's schema, so a field added to
 * `Level` next month appears in it automatically and the test keeps passing while real v3 files
 * stop opening.
 *
 * `fixtures/projects/migration/v3-project.json` is a file. It does not move when the schema does.
 * The first test below exists to keep it that way.
 */

const MIGRATION_FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'projects',
  'migration',
);

/**
 * The file one version behind the build — the step this suite is mainly about.
 *
 * Renamed from a constant pointing at v3 when `DOCUMENT_VERSION` reached 5. The v3 file is still
 * here and still tested, but it now exercises a *chain*; only the newest file tests the step that
 * an engineer upgrading today will actually take.
 */
const FIXTURE = join(MIGRATION_FIXTURES, 'v4-project.json');
const V3_FIXTURE = join(MIGRATION_FIXTURES, 'v3-project.json');

function v3Text(): string {
  return readFileSync(FIXTURE, 'utf8');
}

function v3Raw(): Record<string, unknown> {
  return JSON.parse(v3Text()) as Record<string, unknown>;
}

function levelsOf(raw: Record<string, unknown>): Record<string, unknown>[] {
  return (raw['project'] as { levels: Record<string, unknown>[] }).levels;
}

/** The migrated document, as the editor would hold it after an Open. */
function migrated(): MfdDocument {
  return loadDocument(v3Text());
}

describe('the fixture is genuinely a version 4 file', () => {
  /*
   * These four assertions are not about the migration. They are about the fixture staying the thing
   * the migration is tested against — a file somebody could quietly "fix" into a v4 document, after
   * which every test below would pass while testing nothing at all.
   */

  it('claims version 4', () => {
    expect(v3Raw()['documentVersion']).toBe(4);
  });

  it('carries no render resolution, because version 4 had none', () => {
    for (const level of levelsOf(v3Raw())) {
      const planImage = level['planImage'] as Record<string, unknown> | null;
      if (planImage) expect(planImage, String(level['id'])).not.toHaveProperty('renderDpi');
    }
  });

  it('carries the fields version 4 did have', () => {
    // Reference points arrive in v4, settings in v3, obstruction types in v2. A fixture missing any
    // of them would be exercising an earlier step by accident.
    const raw = v3Raw();
    expect(raw['project']).toHaveProperty('settings');
    for (const level of levelsOf(raw)) {
      expect(level, String(level['id'])).toHaveProperty('referencePoints');
      for (const boundary of level['boundaries'] as Record<string, unknown>[]) {
        expect(boundary, String(boundary['id'])).toHaveProperty('obstructionType');
      }
    }
  });

  it('is one version behind the build, so this file tests the current step', () => {
    /*
     * When DOCUMENT_VERSION moves to 6, this fails — and it should. It already fired once: a v3
     * fixture was the newest file here until `renderDpi` arrived, at which point it silently
     * started testing v3 → v4 → v5 and nothing covered a real v4 file opening. The v4 file was
     * added because this line failed, which is the whole reason it is written this way.
     */
    expect(v3Raw()['documentVersion']).toBe(DOCUMENT_VERSION - 1);
  });
});

describe('the version 3 file still opens, two steps along', () => {
  /*
   * Kept and still asserted. A chain is not the same test as a step: it is where a migration that
   * assumed the shape its predecessor produced — rather than the shape on disk — goes wrong, and
   * that failure only appears when two of them run in sequence.
   */
  function v3(): MfdDocument {
    return loadDocument(readFileSync(V3_FIXTURE, 'utf8'));
  }

  it('arrives at the current version', () => {
    expect(v3().documentVersion).toBe(DOCUMENT_VERSION);
  });

  it('gains both fields the two steps add, and neither is invented', () => {
    for (const level of v3().project.levels) {
      expect(level.referencePoints, level.id).toEqual([]);
      expect(level.planImage?.renderDpi ?? null, level.id).toBeNull();
    }
  });

  it('still loses nothing', () => {
    const stripped = JSON.parse(JSON.stringify(v3())) as Record<string, unknown>;
    stripped['documentVersion'] = 3;
    for (const level of levelsOf(stripped)) {
      delete level['referencePoints'];
      delete (level['planImage'] as Record<string, unknown> | null)?.['renderDpi'];
    }

    expect(stripped).toEqual(JSON.parse(readFileSync(V3_FIXTURE, 'utf8')));
  });
});

describe('opening it', () => {
  it('produces a version 4 document', () => {
    expect(migrated().documentVersion).toBe(DOCUMENT_VERSION);
  });

  it('loses nothing — the only change is the field version 4 adds', () => {
    /*
     * The strongest statement of "no data loss" available: strip the added field back off the
     * migrated document, restore the version, and it must equal the file byte for byte in
     * structure. Any field the migration dropped, renamed, reordered into a different value, or
     * quietly normalised shows up here, without a test having to know which fields exist.
     */
    const stripped = JSON.parse(JSON.stringify(migrated())) as Record<string, unknown>;
    stripped['documentVersion'] = 4;
    for (const level of levelsOf(stripped)) {
      const planImage = level['planImage'] as Record<string, unknown> | null;
      if (planImage) {
        expect(planImage['renderDpi']).toBeNull();
        delete planImage['renderDpi'];
      }
    }

    expect(stripped).toEqual(v3Raw());
  });

  it('keeps every placement, with its transform', () => {
    const level = migrated().project.levels[0];
    const original = levelsOf(v3Raw())[0]?.['placements'] as Record<string, unknown>[];

    expect(level?.placements).toHaveLength(original.length);
    expect(level?.placements.map((placement) => placement.id)).toEqual(
      original.map((placement) => placement['id']),
    );
    // Rotation in millidegrees and the mirror flag, exactly as written. A migration that
    // round-tripped these through radians would lose the quarter turn.
    const rotated = level?.placements.find((placement) => placement.id === 'plc_bed01');
    expect(rotated?.transform.rotation).toBe(90_000);
    expect(
      level?.placements.find((placement) => placement.id === 'plc_st08')?.transform.mirrored,
    ).toBe(true);
  });

  it('keeps every equipment reference at the version it was placed', () => {
    /*
     * The catalogue is at 0.4.0; this project cited 0.2.0. Refreshing the stamp would be the most
     * tempting silent repair available — it makes the record look current — and it would destroy
     * the one thing the field is for: saying which data produced the numbers in a report that has
     * already been issued.
     */
    const placements = migrated().project.levels[0]?.placements ?? [];

    for (const placement of placements.filter(
      (entry) => entry.equipmentObjectId === 'vantive_ak98',
    )) {
      expect(placement.equipmentObjectVersion, placement.id).toBe('0.2.0');
    }
    expect(
      placements.find((placement) => placement.equipmentObjectId === 'dialysis_bed')
        ?.equipmentObjectVersion,
    ).toBe('0.1.0');
  });

  it('keeps the plan image and its calibration', () => {
    const level = migrated().project.levels[0];

    expect(level?.planImage?.sourceFileName).toBe('gangnam-3f-dialysis.png');
    expect(level?.planImage?.dataUrl).toMatch(/^data:image\/png;base64,/);
    // The calibration's own provenance, not just the resulting scale: a reviewer has to be able to
    // see how the scale was established rather than take it on trust.
    expect(level?.coordinateMapping?.millimetresPerPixel).toBe(5);
    expect(level?.coordinateMapping?.calibration.method).toBe('two-point');
    expect(level?.coordinateMapping?.calibration.knownDistance).toBe(2_400);
    expect(level?.coordinateMapping?.calibration.pointA).toEqual({ x: 120, y: 1_600 });
    expect(level?.coordinateMapping?.calibration.calibratedAt).toBe('2026-03-02T01:31:00.000Z');
    expect(level?.coordinateMapping?.origin).toEqual({ x: 120, y: 1_600 });
  });

  it('leaves an uncalibrated level uncalibrated', () => {
    // Null is a state, not a gap to be filled. A migration that invented a mapping here would make
    // an unmeasured floor look measured — the single most damaging thing this product could do.
    const b1 = migrated().project.levels[1];

    expect(b1?.id).toBe('lvl_b1');
    expect(b1?.planImage).toBeNull();
    expect(b1?.coordinateMapping).toBeNull();
  });

  it('creates the version 5 field as null, rather than recovering a plausible resolution', () => {
    /*
     * The temptation this guards against. A v4 PDF import was rendered at 150 dpi and the constant
     * is one package away — but a page large enough to hit the 4,096 px cap was rendered at less
     * than that, and the page size needed to work out how much less is not in the document. A PNG
     * import was never rendered by us at all.
     *
     * Null means "we do not know what resolution this is", which withholds the printed-scale
     * calibration route for this drawing. Writing 150 would offer it, backed by a number nobody
     * measured.
     */
    const levels = migrated().project.levels;

    expect(levels).toHaveLength(2);
    expect(levels[0]?.planImage?.renderDpi ?? null).toBeNull();
    // Reference points came from the previous step and are still empty rather than seeded.
    for (const level of levels) expect(level.referencePoints, level.id).toEqual([]);
  });

  it('keeps the rooms, the wall and the typed column', () => {
    const level = migrated().project.levels[0];
    const column = level?.boundaries.find((boundary) => boundary.id === 'bnd_column_c4');

    expect(level?.spaces.map((space) => space.function)).toEqual([
      'hemodialysis_treatment',
      'storage',
    ]);
    expect(column?.obstructionType).toBe('column');
    expect(level?.boundaries.find((boundary) => boundary.id === 'bnd_corridor_wall')?.kind).toBe(
      'wall',
    );
  });

  it('carries the Korean text through unchanged', () => {
    // A migration that re-encoded anything would show up here rather than in a customer's report.
    const document = migrated();

    expect(document.project.name).toBe('강남 성심병원 — 3F 인공신장실 증설');
    expect(document.project.levels[0]?.spaces[0]?.name).toBe('치료실 A');
  });
});

describe('the migration is deterministic', () => {
  it('produces the same document twice', () => {
    expect(migrated()).toEqual(migrated());
  });

  it('produces identical bytes on re-save', () => {
    // Not the same assertion: two structurally equal documents could still serialise differently if
    // a migration built objects with keys in a varying order.
    const at = '2026-08-01T00:00:00.000Z';
    expect(saveDocument(migrated(), { now: at })).toBe(saveDocument(migrated(), { now: at }));
  });

  it('reads no clock — the project keeps its own timestamps', () => {
    /*
     * `updatedAt` moves on *save*, never on open. If migrating stamped it, opening a project to
     * look at it would mark it modified, and the plan-staleness fingerprint one package over would
     * report every migrated plan as outdated the moment it was opened.
     */
    const document = migrated();

    expect(document.project.createdAt).toBe('2026-03-02T01:15:00.000Z');
    expect(document.project.updatedAt).toBe('2026-03-11T07:42:00.000Z');
  });

  it('runs once — reopening the saved file changes nothing but the save stamp', () => {
    const at = '2026-08-01T00:00:00.000Z';
    const once = migrated();
    const reopened = loadDocument(saveDocument(once, { now: at }));

    expect(reopened).toEqual({
      ...once,
      project: { ...once.project, updatedAt: at },
    });
  });
});

describe('no silent repair', () => {
  /*
   * > *"Migration must remain deterministic. No silent repair. If migration cannot safely convert:
   * > show explicit migration error."*
   *
   * Each case takes the real v3 file and gives it a field the target version introduces. The
   * migration cannot tell that from a mislabelled newer file, and its only other option is to
   * overwrite — which would destroy an engineer's work behind a document that then validated
   * cleanly and saved over the original.
   */

  it('refuses a version 4 file that already carries a render resolution', () => {
    const raw = v3Raw();
    (levelsOf(raw)[0]!['planImage'] as Record<string, unknown>)['renderDpi'] = 300;

    expect(() => parseDocument(raw)).toThrow(DocumentMigrationError);
  });

  it('refuses a version 3 file that already carries reference points', () => {
    const raw = JSON.parse(readFileSync(V3_FIXTURE, 'utf8')) as Record<string, unknown>;
    levelsOf(raw)[0]!['referencePoints'] = [
      { id: 'rp1', kind: 'drain', position: { x: 1_000, y: 2_000 }, label: 'Drain A' },
    ];

    expect(() => parseDocument(raw)).toThrow(DocumentMigrationError);
  });

  it('names the level whose points would have been deleted', () => {
    const raw = JSON.parse(readFileSync(V3_FIXTURE, 'utf8')) as Record<string, unknown>;
    levelsOf(raw)[1]!['referencePoints'] = [
      { id: 'rp1', kind: 'ro_supply', position: { x: 0, y: 0 }, label: null },
    ];

    try {
      parseDocument(raw);
      expect.unreachable('should have refused');
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentMigrationError);
      const migration = error as DocumentMigrationError;
      expect(migration.from).toBe(3);
      expect(migration.to).toBe(4);
      // The second level, not the first — an engineer needs to know which floor to look at.
      expect(migration.issues.map((issue) => issue.path)).toEqual([
        'project.levels.1.referencePoints',
      ]);
    }
  });

  it('refuses rather than overwriting, so the file on disk is untouched', () => {
    // The property that matters more than the error type: nothing was written. The engineer still
    // has their points, and can open the project with a build that understands them.
    const before = readFileSync(V3_FIXTURE, 'utf8');
    const raw = JSON.parse(before) as Record<string, unknown>;
    levelsOf(raw)[0]!['referencePoints'] = [
      { id: 'rp1', kind: 'drain', position: { x: 1, y: 2 }, label: null },
    ];

    expect(() => parseDocument(raw)).toThrow(DocumentMigrationError);
    expect(readFileSync(V3_FIXTURE, 'utf8')).toBe(before);
  });

  it('lets an empty array through, because an empty field loses nothing', () => {
    // The line between refusing and pedantry. A file carrying the key with nothing in it is an
    // ordinary file; refusing it would cost an engineer their project to protect no data.
    const raw = JSON.parse(readFileSync(V3_FIXTURE, 'utf8')) as Record<string, unknown>;
    for (const level of levelsOf(raw)) level['referencePoints'] = [];

    expect(() => parseDocument(raw)).not.toThrow();
  });

  it('refuses a version 2 file that already carries settings', () => {
    // The same rule one step earlier: overwriting would silently replace a chosen render mode with
    // the default, and a report re-issued a month later would differ in a way nobody chose.
    const raw = JSON.parse(readFileSync(V3_FIXTURE, 'utf8')) as Record<string, unknown>;
    for (const level of levelsOf(raw)) delete level['referencePoints'];
    raw['documentVersion'] = 2;

    expect(() => parseDocument(raw)).toThrow(DocumentMigrationError);
  });

  it('refuses a version 1 file whose boundaries already carry an obstruction type', () => {
    const raw = JSON.parse(readFileSync(V3_FIXTURE, 'utf8')) as Record<string, unknown>;
    delete (raw['project'] as Record<string, unknown>)['settings'];
    raw['documentVersion'] = 1;

    expect(() => parseDocument(raw)).toThrow(DocumentMigrationError);
  });

  it('leaves a file that is merely not a document to the schema', () => {
    /*
     * A structural mismatch is not an unsafe conversion — it is a file that is not a project — and
     * `documentSchema` names the offending path far better than a migration could. Calling it a
     * migration failure would tell an engineer their old project could not be converted when the
     * truth is they opened the wrong file.
     */
    expect(() => parseDocument({ documentVersion: 3, project: 'not an object' })).toThrow(
      /failed validation/,
    );
  });
});
