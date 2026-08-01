import {
  CORPUS_VALIDATION_VERSION,
  confirmationFor,
  confirmationsMatching,
  rowFingerprint,
  parseCorpusValidation,
  type Confirmation,
  type CorpusRow,
  type CorpusValidation,
  type RowOutcome,
} from '../../packages/layout-knowledge/src/verification';
import type { Observer } from '../../packages/layout-knowledge/src/provenance';

/**
 * Assembling the corpus ledger — the arithmetic, lifted out of the script that runs it.
 *
 * `scripts/validate-corpus.ts` is a top-level script: it reads a dataset, drives 306 drawings
 * through the pipeline and writes a file, all at import time. Nothing can import it, so nothing
 * could test it — and review found what that cost. The builder hardcoded `confirmedBy: null` on
 * every row while its own comment claimed *"the ledger keeps it so a later run cannot quietly
 * promote a batch result"*; it wrote the file and only then read the previous one. A human
 * signature would have been destroyed by the next `pnpm validate:corpus`, silently.
 *
 * A comment cannot be broken to see whether it fails. So the part that decides what the ledger
 * *says* lives here, as a pure function over rows and confirmations, and the script keeps only the
 * part that talks to the disk and the dataset.
 */

/** A drawing-page outcome, before any confirmation is merged in. */
export type LedgerRow = RowOutcome;

export interface LedgerMeta {
  readonly datasetId: string;
  readonly validatedAt: string;
  readonly observer: Observer;
}

function tally(values: readonly string[]): { key: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  // Sorted by count then key, so a re-run with the same inputs produces the same bytes.
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    // Codepoint order rather than `localeCompare`, for the reason `confirmationsMatching` gives:
    // the comment below promises the same bytes on a re-run, and a locale-dependent sort does not
    // deliver that across machines.
    .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * The rows, the signatures against them, and the counts that follow.
 *
 * > Owner decision D9: confirmations live in their own file and are **merged** in here.
 * > Owner decision D10: a confirmation applies only to the outcome it was given for.
 *
 * Both are `confirmationFor`'s job, imported from `@mfd/layout-knowledge` rather than repeated —
 * the rule that decides whether a signature applies exists once, or the builder and the tests can
 * drift apart while both stay green.
 *
 * The return value is parsed before it is returned, so a miscounting build fails here rather than
 * writing a ledger the loader would reject.
 */
export function buildLedger(
  rows: readonly LedgerRow[],
  confirmations: readonly Confirmation[],
  meta: LedgerMeta,
): CorpusValidation {
  /*
   * Owner decision D11, revised: the acts this run did not apply go **into** the ledger, so the
   * committed artefact shows them without anyone re-running a fingerprint by hand.
   */
  const unapplied = [
    ...duplicateConfirmations(rows, confirmations).map((confirmation) => ({
      reason: 'duplicate' as const,
      confirmation,
    })),
    ...staleConfirmations(rows, confirmations).map((confirmation) => ({
      reason: 'stale' as const,
      confirmation,
    })),
  ];

  const drawings: CorpusRow[] = rows.map((row) => ({
    drawingId: row.drawingId,
    sha256: row.sha256,
    page: row.page,
    reached: row.reached,
    stoppedAt: row.stoppedAt,
    confirmedBy: confirmationFor(row, confirmations, 'completion'),
    // Owner decision D12 — a separate act, a separate field, and never summed with the above.
    stopConfirmedBy: confirmationFor(row, confirmations, 'stop'),
    discrepancies: row.discrepancies.map((entry) => ({
      code: entry.code,
      classification: entry.classification,
      subject: entry.subject,
    })),
  }));

  return parseCorpusValidation(
    {
      version: CORPUS_VALIDATION_VERSION,
      datasetId: meta.datasetId,
      validatedAt: meta.validatedAt,
      observer: meta.observer,
      totals: {
        drawings: drawings.length,
        /*
         * Owner decision D7: *"batch execution alone is not completion."* Two counts, two rules,
         * and `completed` is a subset of `batchComplete`. `corpusValidationSchema` holds the same
         * two invariants, so this cannot disagree with the contract without failing the parse below.
         */
        completed: drawings.filter((row) => row.stoppedAt === null && row.confirmedBy !== null)
          .length,
        batchComplete: drawings.filter((row) => row.stoppedAt === null).length,
        stopped: drawings.filter((row) => row.stoppedAt !== null).length,
        stopsConfirmed: drawings.filter((row) => row.stopConfirmedBy !== null).length,
        byStage: tally(drawings.flatMap((row) => (row.stoppedAt ? [row.stoppedAt] : []))),
        byClassification: tally(
          drawings.flatMap((row) => row.discrepancies.map((entry) => entry.classification)),
        ),
      },
      drawings,
      unapplied,
    },
    'knowledge/validation/corpus.json',
  );
}

/**
 * Confirmations that match no row in this run — **owner decision D10**.
 *
 * They are not an error and are never deleted: a person's act is evidence, and it stays in the file.
 * What changed is the run, not the act, so the signature simply stops asserting anything. Reported
 * because a signature that has silently stopped counting is precisely the thing whoever gave it
 * needs to be told about.
 */
/**
 * Confirmations that match a row another confirmation already stands on — **owner decision D11**.
 *
 * > *"A duplicate is reported distinctly from a stale one: stale tells a signer their signature
 * > stopped applying, duplicate tells them it was recorded but another stands. Same channel,
 * > different sentence, because the actions differ."*
 *
 * Not an error, and never deleted. Two people signing the same row is a benign act, and making it
 * abort a 306-page batch would make the correct human act the expensive one. What it must not do is
 * vanish — `confirmationFor` used `.find()`, so the second signature was uncounted and unreported,
 * which is precisely the datum D9 exists to protect.
 */
export function duplicateConfirmations(
  rows: readonly LedgerRow[],
  confirmations: readonly Confirmation[],
): Confirmation[] {
  const duplicates: Confirmation[] = [];
  for (const row of rows) {
    for (const kind of ['completion', 'stop'] as const) {
      // The first is the one that applies — D11's (`at`, `name`) order, from the same function the
      // builder merges with. Everything after it is a duplicate.
      duplicates.push(...confirmationsMatching(row, confirmations, kind).slice(1));
    }
  }
  return duplicates;
}

/**
 * Confirmations that match no row in this run — **owner decision D10**.
 *
 * They are not an error and are never deleted: a person's act is evidence, and it stays in the file.
 * What changed is the run, not the act, so the signature simply stops asserting anything. Reported
 * because a signature that has silently stopped counting is precisely the thing whoever gave it
 * needs to be told about.
 */
export function staleConfirmations(
  rows: readonly LedgerRow[],
  confirmations: readonly Confirmation[],
): Confirmation[] {
  // `rowFingerprint` — the same function `confirmationFor` matches with, not a second copy of it.
  // Two implementations of "is this the same run" would let a confirmation count in `buildLedger`
  // and be reported stale here, in the same breath.
  const present = new Set(rows.map(rowFingerprint));
  return confirmations.filter((entry) => !present.has(rowFingerprint(entry)));
}
