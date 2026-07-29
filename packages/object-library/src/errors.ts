export interface CatalogIssue {
  /** Dotted path to the offending field, e.g. `dimensions.width`. Empty at the root. */
  readonly path: string;
  readonly message: string;
}

/**
 * Thrown when a catalogue file does not satisfy the schema.
 *
 * The message names the file and every bad field, because the person fixing a broken
 * equipment record is a service engineer holding a manual, not the developer who
 * wrote the loader. "Invalid catalogue" would send them to the source; naming
 * `vantive_ak98.json → dimensions.width: must be greater than zero` does not.
 */
export class CatalogValidationError extends Error {
  override readonly name = 'CatalogValidationError';

  constructor(
    readonly fileName: string,
    readonly issues: readonly CatalogIssue[],
  ) {
    super(
      `${fileName}: ${issues.length} validation ${issues.length === 1 ? 'problem' : 'problems'}\n` +
        issues.map((issue) => `  ${issue.path || '(root)'}: ${issue.message}`).join('\n'),
    );
  }
}

/** Thrown when two catalogue records claim the same id. */
export class DuplicateEquipmentIdError extends Error {
  override readonly name = 'DuplicateEquipmentIdError';

  constructor(
    readonly equipmentId: string,
    readonly fileNames: readonly string[],
  ) {
    super(`Duplicate equipment id "${equipmentId}" in: ${fileNames.join(', ')}`);
  }
}
