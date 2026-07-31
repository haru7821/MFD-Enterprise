import dialysisSequence from '../../../standards/sequences/dialysis.json';
import { type SequenceSet, sequenceSetSchema } from '../src/sequenceSet';

/**
 * The shipped dialysis installation sequence.
 *
 * Imported statically from `standards/sequences/`, the same arrangement the rule set, the checklist
 * and the scoring model use: a bundler sees the file, and validation runs at module load, so a
 * malformed sequence — a dangling dependency, a cycle, two stages claiming the service materials —
 * fails when the application starts rather than the first time an engineer asks for a plan.
 *
 * A separate entry point (`@mfd/ai-planner/sequences`) rather than part of `src`, because this is
 * the one file that reaches outside the package for data. Keeping that in one clearly-named place
 * is what stops `src/` acquiring a dependency on a path.
 */
export const dialysisSequenceSet: SequenceSet = parseSequenceSet(
  'standards/sequences/dialysis.json',
  dialysisSequence,
);

export function parseSequenceSet(path: string, data: unknown): SequenceSet {
  const result = sequenceSetSchema.safeParse(data);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`${path} is not a valid installation sequence set — ${detail}`);
  }
  return result.data;
}
