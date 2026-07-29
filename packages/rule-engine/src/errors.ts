export interface RuleIssue {
  /** Dotted path to the offending field, e.g. `parameters.side`. Empty at the root. */
  readonly path: string;
  readonly message: string;
}

/**
 * Thrown when a rule file does not satisfy the schema.
 *
 * Names the file and every bad field. The person fixing a broken rule is an
 * engineer transcribing an installation manual, and "invalid rule set" would send
 * them to the source code instead of to line 12 of their JSON.
 */
export class RuleValidationError extends Error {
  override readonly name = 'RuleValidationError';

  constructor(
    readonly fileName: string,
    readonly issues: readonly RuleIssue[],
  ) {
    super(
      `${fileName}: ${issues.length} validation ${issues.length === 1 ? 'problem' : 'problems'}\n` +
        issues.map((issue) => `  ${issue.path || '(root)'}: ${issue.message}`).join('\n'),
    );
  }
}

/**
 * Thrown when two rules claim the same id.
 *
 * A duplicate is never harmless here: results are keyed by rule id, so the second
 * record would silently shadow the first and a requirement would vanish from the
 * report without anything failing.
 */
export class DuplicateRuleIdError extends Error {
  override readonly name = 'DuplicateRuleIdError';

  constructor(
    readonly ruleId: string,
    readonly fileNames: readonly string[],
  ) {
    super(`Duplicate rule id "${ruleId}" in: ${fileNames.join(', ')}`);
  }
}
