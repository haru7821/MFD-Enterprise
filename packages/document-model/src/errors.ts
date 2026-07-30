export interface DocumentIssue {
  /** Dotted path to the offending field, e.g. `project.levels.0.boundaries.2.vertices`. */
  readonly path: string;
  readonly message: string;
}

/**
 * Thrown when a document does not satisfy the schema.
 *
 * Names every bad field rather than saying "invalid document". The person who sees
 * this is an engineer whose saved review will not open, and "invalid" tells them
 * nothing they can act on.
 */
export class DocumentValidationError extends Error {
  override readonly name = 'DocumentValidationError';

  constructor(readonly issues: readonly DocumentIssue[]) {
    super(
      `Document failed validation with ${issues.length} ${
        issues.length === 1 ? 'problem' : 'problems'
      }\n` + issues.map((issue) => `  ${issue.path || '(root)'}: ${issue.message}`).join('\n'),
    );
  }
}

/**
 * Thrown when a file claims a document version this build cannot read.
 *
 * Refusing is the point. A newer document opened by an older build would lose
 * whatever the older build does not understand the moment it saved — silently, and
 * over the engineer's only copy.
 */
export class UnsupportedDocumentVersionError extends Error {
  override readonly name = 'UnsupportedDocumentVersionError';

  constructor(
    readonly found: number,
    readonly supported: number,
  ) {
    super(
      `Document version ${found} cannot be read by this build, which supports up to ` +
        `version ${supported}. Update MFD-E to open this project.`,
    );
  }
}

/** Thrown when an operation names an entity the document does not contain. */
export class EntityNotFoundError extends Error {
  override readonly name = 'EntityNotFoundError';

  constructor(
    readonly entity: 'level' | 'space' | 'boundary' | 'placement' | 'reference point',
    readonly id: string,
  ) {
    super(`No ${entity} with id "${id}" in this document`);
  }
}
