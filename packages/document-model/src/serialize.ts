import { z } from 'zod';

import { DocumentValidationError, UnsupportedDocumentVersionError } from './errors';
import { DOCUMENT_VERSION, type MfdDocument, documentSchema } from './schema';

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
 * The chain runs one step at a time: v1 → v2 → v3. Each migration only has to know
 * about the version immediately before it. There is nothing to migrate yet; the
 * mechanism exists from the first release rather than from the first release that
 * needed it, because retrofitting it means writing migrations against files you
 * cannot inspect.
 */

/** A migration from `from` to `from + 1`. Input is unvalidated JSON, by necessity. */
export interface Migration {
  readonly from: number;
  readonly to: number;
  migrate(document: Record<string, unknown>): Record<string, unknown>;
}

/** Ordered by `from`. Empty until the schema changes shape. */
export const MIGRATIONS: readonly Migration[] = [];

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

  const parsed = documentSchema.safeParse(migrated);
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
