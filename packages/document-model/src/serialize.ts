import { z } from 'zod';

import {
  DocumentMigrationError,
  DocumentValidationError,
  type DocumentIssue,
  UnsupportedDocumentVersionError,
} from './errors';
import {
  DEFAULT_PROJECT_SETTINGS,
  DOCUMENT_VERSION,
  type MfdDocument,
  documentSchema,
} from './schema';

/**
 * Save and load.
 *
 * ## Why the version is read before the document is parsed
 *
 * A file written by a newer build will fail `strictObject` on fields this build has
 * never heard of. That failure would read as "your project file is corrupt", which is
 * both alarming and false. So the version is read first, from a deliberately loose
 * schema, and a document from the future is refused with a message that says what
 * actually happened.
 *
 * Refusing is the point. Opening it anyway would drop everything this build does not
 * understand the moment the engineer saved — silently, over their only copy.
 *
 * ## Migration
 *
 * The chain runs one step at a time: v1 → v2 → v3 → v4. Each migration only has to know
 * about the version immediately before it, which is what keeps the chain from becoming
 * a pile of special cases as versions accumulate.
 *
 * A migration takes **unvalidated JSON** and returns unvalidated JSON. It cannot take a
 * typed document, because the type it would need is the *old* schema — which this build
 * no longer has. That is not sloppiness to tidy up later: a migration's whole job is to
 * handle a shape the current code does not model, and the validation that follows is
 * what makes the result safe.
 *
 * ## No silent repair
 *
 * > Owner decision, Hardening priority 2: *"Migration must remain deterministic. No silent repair.
 * > If migration cannot safely convert: show explicit migration error."*
 *
 * Every migration below adds a field. Each one therefore checks first whether that field is
 * **already occupied**, and throws {@link DocumentMigrationError} rather than overwriting it. A
 * file claiming version 3 whose levels already hold reference points is not something a migration
 * can convert: it cannot tell a mislabelled version 4 file from a hand-edited version 3 one, and
 * writing `[]` over the points would destroy them behind a document that then validated cleanly.
 *
 * A *structural* mismatch — no `project`, `levels` not an array — is left to the schema instead.
 * That is not an unsafe conversion, it is a file that is not a document, and `documentSchema` names
 * the offending path far better than a migration could.
 *
 * ## Deterministic
 *
 * Nothing here reads a clock, generates an id, or branches on anything but the file's own content.
 * Migrating the same bytes twice produces the same bytes, which is what lets a migrated project be
 * diffed against the original.
 */

/** A migration from `from` to `from + 1`. Input is unvalidated JSON, by necessity. */
export interface Migration {
  readonly from: number;
  readonly to: number;
  migrate(document: Record<string, unknown>): Record<string, unknown>;
}

/**
 * Ordered by `from`.
 *
 * **v1 → v2** added `obstructionType` to `Boundary`. Every v1 boundary predates
 * obstruction typing, so it gets `null` — which is exactly right for a room outline or
 * a wall. A v1 boundary already marked `kind: "obstruction"` is the one case that
 * cannot be answered from the file: it says something is in the way and nothing about
 * what. `"other"` records that honestly rather than guessing "column", and the engineer
 * can correct it in the inspector.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    from: 1,
    to: 2,
    migrate(document) {
      const project = document['project'];
      if (!isRecord(project) || !Array.isArray(project['levels'])) return document;

      const occupied: DocumentIssue[] = [];
      project['levels'].forEach((level, levelIndex) => {
        if (!isRecord(level) || !Array.isArray(level['boundaries'])) return;
        level['boundaries'].forEach((boundary, index) => {
          if (isRecord(boundary) && carriesData(boundary['obstructionType'])) {
            occupied.push({
              path: `project.levels.${levelIndex}.boundaries.${index}.obstructionType`,
              message: 'a version 1 boundary cannot carry an obstruction type',
            });
          }
        });
      });
      refuseIfOccupied(1, 2, occupied);

      const levels = project['levels'].map((level) => {
        if (!isRecord(level) || !Array.isArray(level['boundaries'])) return level;

        const boundaries = level['boundaries'].map((boundary) => {
          if (!isRecord(boundary)) return boundary;
          return {
            ...boundary,
            obstructionType: boundary['kind'] === 'obstruction' ? 'other' : null,
          };
        });

        return { ...level, boundaries };
      });

      return { ...document, project: { ...project, levels } };
    },
  },
  {
    from: 2,
    to: 3,
    /**
     * Version 3 adds `project.settings`.
     *
     * A version 2 file was written before the report had render modes, so the only honest
     * value is the default — vector-only, which is what every report generated before this
     * version actually produced. Filling it in rather than leaving it absent is the point:
     * `settings` is required, and an absent setting and a chosen default must not look the
     * same on disk.
     */
    migrate(document) {
      const project = document['project'];
      if (!isRecord(project)) return document;

      refuseIfOccupied(
        2,
        3,
        carriesData(project['settings'])
          ? [
              {
                path: 'project.settings',
                message:
                  'a version 2 project cannot carry settings; converting would replace the ' +
                  'chosen render mode with the default',
              },
            ]
          : [],
      );

      return {
        ...document,
        project: { ...project, settings: { ...DEFAULT_PROJECT_SETTINGS } },
      };
    },
  },
  {
    from: 3,
    to: 4,
    /**
     * Version 4 adds `Level.referencePoints`.
     *
     * **Every existing level gets an empty array, and that is the whole migration.**
     *
     * It is worth being explicit about why so little happens here, because the temptation is to do
     * more. Four of the scoring criteria the owner approved measure distance *from* one of these
     * points — 40 % of the model — so a migrated project scores over the remaining 60 % until an
     * engineer places them. It would be easy to seed a `drain` at the room centroid, or an
     * `access_entry` at the widest gap in a wall, and have every migrated project score in full
     * immediately.
     *
     * That would be the worst thing this migration could do. A guessed origin produces a pipe run
     * measured from a place nobody chose, printed in a report as a number; and for a criterion that
     * *minimises*, a conveniently-placed guess is the **best possible** score. An empty array is
     * the honest record that no engineer has placed a point, and `unavailable` is what the scoring
     * engine reports for it (AD-18).
     */
    migrate(document) {
      const project = document['project'];
      if (!isRecord(project) || !Array.isArray(project['levels'])) return document;

      /*
       * The overwrite this guards against is the worst of the three, which is why it is worth
       * stating: `{...level, referencePoints: []}` on a level that already had points would delete
       * every one of them, the document would then validate cleanly, and the next save would put
       * the loss on disk. Nothing anywhere would say it had happened.
       */
      const occupied: DocumentIssue[] = [];
      project['levels'].forEach((level, index) => {
        if (isRecord(level) && carriesData(level['referencePoints'])) {
          occupied.push({
            path: `project.levels.${index}.referencePoints`,
            message:
              'a version 3 level cannot carry reference points; converting would delete them',
          });
        }
      });
      refuseIfOccupied(3, 4, occupied);

      const levels = project['levels'].map((level) =>
        isRecord(level) ? { ...level, referencePoints: [] } : level,
      );

      return { ...document, project: { ...project, levels } };
    },
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Does this value hold something a migration would destroy by overwriting it?
 *
 * `undefined` and `null` hold nothing. An empty array and an empty object hold nothing either —
 * which matters, because a file written by a build that had already added the key but nothing to
 * put in it is an ordinary file, not a corrupt one, and refusing it would be pedantry that costs an
 * engineer their project.
 *
 * Anything else is data somebody put there, and a migration that replaced it would be a silent
 * repair — the thing the owner's decision forbids by name.
 */
function carriesData(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return true;
}

/**
 * Refuse rather than overwrite.
 *
 * Called by each migration before it creates a field, with the places that field would land. If any
 * of them already holds something, the conversion stops and says which — because the migration
 * cannot tell a mislabelled newer file from a hand-edited older one, and both of its other options
 * lose data.
 */
function refuseIfOccupied(
  from: number,
  to: number,
  occupied: readonly DocumentIssue[],
): void {
  if (occupied.length > 0) throw new DocumentMigrationError(from, to, occupied);
}

const versionProbeSchema = z.looseObject({
  documentVersion: z.number().int().positive(),
});

/** Read a file's document version without validating the rest of it. */
export function readDocumentVersion(value: unknown): number | null {
  const parsed = versionProbeSchema.safeParse(value);
  return parsed.success ? parsed.data.documentVersion : null;
}

function issuesFrom(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/**
 * Validate a parsed JSON value as a document, migrating it forward if needed.
 *
 * Throws rather than returning a partial document. A project that half-loaded would
 * be missing rooms or machines with nothing anywhere saying which — and the engineer
 * would then save over the original.
 */
export function parseDocument(value: unknown): MfdDocument {
  const version = readDocumentVersion(value);

  if (version === null) {
    throw new DocumentValidationError([
      { path: 'documentVersion', message: 'missing or not a positive integer' },
    ]);
  }

  if (version > DOCUMENT_VERSION) {
    throw new UnsupportedDocumentVersionError(version, DOCUMENT_VERSION);
  }

  let migrated = value as Record<string, unknown>;
  for (let current = version; current < DOCUMENT_VERSION; current += 1) {
    const migration = MIGRATIONS.find((entry) => entry.from === current);
    if (!migration) {
      throw new DocumentValidationError([
        {
          path: 'documentVersion',
          message: `no migration from version ${current}; this project cannot be opened`,
        },
      ]);
    }
    migrated = migration.migrate(migrated);
  }

  // Stamp the version the content is now at. Without this a migrated document keeps
  // claiming the version it arrived as, and every later consumer — a report, a diff,
  // a second migration pass — would be reading a document that lies about its own
  // shape. `saveDocument` restamps on the way out, so the file was always written
  // correctly; it was the in-memory document that was wrong, which is worse: nothing
  // on disk would ever have shown it.
  const parsed = documentSchema.safeParse({ ...migrated, documentVersion: DOCUMENT_VERSION });
  if (!parsed.success) throw new DocumentValidationError(issuesFrom(parsed.error));

  return parsed.data;
}

/** Parse a `.mfd` file's text. Separates "not JSON" from "not a document". */
export function loadDocument(text: string): MfdDocument {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new DocumentValidationError([
      { path: '', message: `not valid JSON: ${(error as Error).message}` },
    ]);
  }
  return parseDocument(value);
}

export interface SaveOptions {
  /** Timestamp written to `project.updatedAt`. Supplied, never read from a clock. */
  readonly now: string;
  /** Indent the JSON. Off by default: a plan image makes these files large. */
  readonly pretty?: boolean;
}

/**
 * Serialise a document.
 *
 * The document is validated on the way out as well as on the way in. An editor bug
 * that produced an invalid document would otherwise be discovered by the engineer who
 * tried to reopen the file, long after the state that caused it was gone.
 */
export function saveDocument(document: MfdDocument, options: SaveOptions): string {
  const stamped: MfdDocument = {
    ...document,
    documentVersion: DOCUMENT_VERSION,
    project: { ...document.project, updatedAt: options.now },
  };

  const parsed = documentSchema.safeParse(stamped);
  if (!parsed.success) throw new DocumentValidationError(issuesFrom(parsed.error));

  return JSON.stringify(parsed.data, null, options.pretty === true ? 2 : undefined);
}

/** A filename an engineer will recognise months later. */
export function suggestedFileName(document: MfdDocument): string {
  const slug =
    document.project.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'project';
  return `${slug}.mfd.json`;
}
