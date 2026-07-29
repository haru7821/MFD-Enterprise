import { DuplicateRuleIdError, RuleValidationError, type RuleIssue } from './errors';
import { type Rule, ruleSchema } from './schema';

/**
 * Rule set loading.
 *
 * Takes already-read JSON rather than reading files, so this package needs no
 * filesystem or bundler API and runs identically in a browser, a server process and
 * a test runner.
 */

export interface RuleFile {
  /** Used in error messages so a broken record can be found on disk. */
  readonly fileName: string;
  /** A single rule record, or an array of them. */
  readonly raw: unknown;
}

/**
 * Validate one rule record.
 *
 * @throws {RuleValidationError} when the record does not satisfy the schema.
 */
export function parseRule(raw: unknown, fileName: string): Rule {
  const result = ruleSchema.safeParse(raw);

  if (!result.success) {
    const issues: RuleIssue[] = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    throw new RuleValidationError(fileName, issues);
  }

  return result.data;
}

export interface RuleSet {
  /** Identifier stamped into saved projects and reports. */
  readonly id: string;
  readonly version: string;
  readonly rules: readonly Rule[];
  get(ruleId: string): Rule | undefined;
  /** Rules whose thresholds are still provisional. */
  readonly draftRules: readonly Rule[];
}

export interface CreateRuleSetOptions {
  readonly id: string;
  readonly version: string;
}

/**
 * Build a rule set from raw records.
 *
 * Fails on the first invalid record and on any duplicate id. A rule set that
 * quietly dropped a bad record would produce a report missing a requirement, with
 * nothing anywhere saying so — the worst available outcome for a document whose
 * purpose is to be relied on.
 */
export function createRuleSet(
  files: readonly RuleFile[],
  options: CreateRuleSetOptions,
): RuleSet {
  const byId = new Map<string, Rule>();
  const fileNamesById = new Map<string, string[]>();

  for (const file of files) {
    const records = Array.isArray(file.raw) ? file.raw : [file.raw];

    for (const raw of records) {
      const rule = parseRule(raw, file.fileName);

      const seenIn = fileNamesById.get(rule.ruleId);
      if (seenIn) {
        seenIn.push(file.fileName);
        throw new DuplicateRuleIdError(rule.ruleId, seenIn);
      }

      fileNamesById.set(rule.ruleId, [file.fileName]);
      byId.set(rule.ruleId, rule);
    }
  }

  const rules = [...byId.values()];

  return {
    id: options.id,
    version: options.version,
    rules,
    get: (ruleId) => byId.get(ruleId),
    draftRules: rules.filter((rule) => rule.status === 'draft'),
  };
}
