import dialysisScoring from '../../../standards/scoring/dialysis.json';
import { scoringModelSchema } from '../src/schema';
import type { ScoringModel } from '../src/scoring';

/**
 * The shipped dialysis scoring model — **owner decision B-5a**.
 *
 * Imported statically from `standards/scoring/`, the same arrangement the rule set and the
 * checklist use: a bundler sees the file, and validation runs at module load, so a malformed or
 * incomplete model fails when the application starts rather than the first time somebody asks for a
 * layout proposal for a customer.
 *
 * Separate entry point (`@mfd/ai-contract/scoring`) rather than part of the package's main surface,
 * because it reaches outside the package for data. Keeping that in one clearly-named file is what
 * stops `src/` acquiring a dependency on a path.
 *
 * ## What is in the file and what is not
 *
 * The **weights** are the owner's, and the file records that in an `authority` block. The
 * **references** — what counts as a full score in each criterion's own unit — are still a
 * developer's estimate, and they are as load-bearing as the weights above them (B-5b).
 *
 * `station_count` is in the file under `constraints`, not `criteria`, and the schema's key enum is
 * what keeps it there. At any weight it would rank the emptiest room first.
 */
export const dialysisScoringModel: ScoringModel = parseScoringModel(
  'standards/scoring/dialysis.json',
  dialysisScoring,
);

export function parseScoringModel(path: string, data: unknown): ScoringModel {
  const result = scoringModelSchema.safeParse(data);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`${path} is not a valid scoring model — ${detail}`);
  }
  return result.data;
}
