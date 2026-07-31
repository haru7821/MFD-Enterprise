import { z } from 'zod';

import {
  KNOWLEDGE_VERSION,
  datasetSchema,
  knowledgeFileSchema,
  observationFileSchema,
  type Dataset,
  type KnowledgeFile,
  type ObservationFile,
} from './schema';

/**
 * Parsing the checked-in JSON.
 *
 * Takes already-read values, never a path: the same reason every other engine here does. Knowledge
 * is read from a bundler import in the browser, from disk in a test, and from a repository checkout
 * in the aggregation script, and a loader that opened files itself would work in one of those.
 */

export class KnowledgeValidationError extends Error {
  override readonly name = 'KnowledgeValidationError';

  constructor(
    readonly fileName: string,
    readonly issues: readonly { path: string; message: string }[],
  ) {
    super(
      `${fileName}: ${issues.length} validation ${issues.length === 1 ? 'problem' : 'problems'}\n` +
        issues.map((issue) => `  ${issue.path || '(root)'}: ${issue.message}`).join('\n'),
    );
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown, fileName: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new KnowledgeValidationError(
      fileName,
      parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

export function parseDataset(value: unknown, fileName = 'dataset.json'): Dataset {
  return parse(datasetSchema, value, fileName);
}

export function parseObservationFile(value: unknown, fileName: string): ObservationFile {
  return parse(observationFileSchema, value, fileName);
}

/**
 * Parse a derived file, refusing one written by a build with a different derived shape.
 *
 * Refusing is the point, and it is the same argument as the document model's: a derived file from a
 * newer build carries fields this one would drop, and one from an older build may be missing a
 * field a consumer now depends on. Either way, reading it produces knowledge that quietly differs
 * from what was generated.
 */
export function parseKnowledgeFile(value: unknown, fileName: string): KnowledgeFile {
  const file = parse(knowledgeFileSchema, value, fileName);

  if (file.knowledgeVersion !== KNOWLEDGE_VERSION) {
    throw new KnowledgeValidationError(fileName, [
      {
        path: 'knowledgeVersion',
        message:
          `derived at version ${file.knowledgeVersion}, but this build reads version ` +
          `${KNOWLEDGE_VERSION}; regenerate from the observations`,
      },
    ]);
  }

  return file;
}
