import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readFileSync } from 'node:fs';

import {
  parseConfirmations,
  parseCorpusValidation,
} from '../packages/layout-knowledge/src/verification';

import {
  buildLedger,
  duplicateConfirmations,
  staleConfirmations,
  type LedgerRow,
} from './lib/corpusLedger';
import { VALIDATION_OBSERVER, validateDrawing } from './lib/validateDrawing';

/**
 * The validation programme, over every drawing in the corpus.
 *
 * > Owner decision: *"Continue validating against the real drawing corpus. For every drawing: import
 * > the original PDF · perform calibration using dimension lines whenever available · use printed
 * > scale only as a fallback · verify coordinate mapping · generate placements · run the rule engine
 * > · run the optimiser · generate the planning workflow · generate the final report. Every
 * > discrepancy must be classified."*
 *
 * ```
 * pnpm validate:corpus
 * pnpm validate:corpus --dataset /path/to/MFD-Hospital-Dataset
 * ```
 *
 * **For every drawing** is the load-bearing phrase. A row is written for all three hundred, whether
 * they reach the report or stop at import, because a programme that recorded only its successes
 * would report a corpus of six and call it coverage. Every stop names its stage and carries a
 * classified discrepancy, so the ledger answers the question that decides where the next effort
 * goes: are these drawings we cannot read, drawings that are wrong, or code that is wrong?
 *
 * It writes the ledger and **no observations**. Only `pnpm verify:drawing` writes those, one drawing
 * at a time, after a person has looked at what it found — the knowledge base is not something a
 * batch job should be able to fill on its own.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const datasetRoot = argument('dataset', '/workspace/mfd-hospital-dataset');
const now = argument('now', '2026-07-31T00:00:00.000Z');

const dataset = JSON.parse(readFileSync(join(REPO, 'knowledge', 'dataset.json'), 'utf8')) as {
  id: string;
  drawings: { drawingId: string; pageCount: number }[];
};

const rows: LedgerRow[] = [];
for (const drawing of dataset.drawings) {
  /*
   * Every page of a multi-sheet file, not just the first. `pageCount` comes from the catalogue, and
   * a drawing set whose cover sheet carries no dimensions is not a drawing set that cannot be read —
   * it is one whose second page nobody looked at. G-2 in the import analysis is the same gap seen
   * from the application's side.
   */
  for (let page = 0; page < Math.max(1, drawing.pageCount); page += 1) {
    let outcome;
    try {
      outcome = await validateDrawing({ repo: REPO, datasetRoot, drawingId: drawing.drawingId, page, now });
    } catch (cause) {
      /*
       * A throw is a defect in this harness, not a property of the drawing, and it is recorded as
       * one. Swallowing it would turn our own bug into "that drawing is unsupported", which is the
       * single most misleading thing this ledger could say.
       */
      rows.push({
        drawingId: drawing.drawingId,
        sha256: '0'.repeat(64),
        page,
        reached: 'import',
        stoppedAt: 'import',
        discrepancies: [
          {
            code: 'VD-5',
            classification: 'algorithm_defect',
            subject: `the harness threw: ${cause instanceof Error ? cause.message : String(cause)}`,
          },
        ],
      });
      continue;
    }

    rows.push({
      drawingId: outcome.drawingId,
      sha256: outcome.sha256,
      page: outcome.page,
      reached: outcome.reached,
      stoppedAt: outcome.stoppedAt,
      discrepancies: outcome.discrepancies.map((entry) => ({
        code: entry.code,
        classification: entry.classification,
        subject: entry.subject,
      })),
    });
  }
}

/*
 * **Owner decisions D9 and D10.** The signatures come from a file this script only ever *reads*.
 *
 * The previous version wrote `confirmedBy: null` on every row and re-read the ledger only after
 * overwriting it, so a signature would have been destroyed by the next run — while the comment
 * beside it claimed the opposite. Review found it, and the fix is structural rather than careful:
 * `corpus.json` is generated and can be rebuilt from the dataset at any time, and the one datum
 * that cannot be regenerated lives somewhere no batch writes.
 */
const confirmationsPath = join(REPO, 'knowledge', 'validation', 'confirmations.json');
const confirmations = existsSync(confirmationsPath)
  ? parseConfirmations(
      JSON.parse(readFileSync(confirmationsPath, 'utf8')) as unknown,
      'knowledge/validation/confirmations.json',
    ).confirmations
  : [];

// Every count, every invariant and the parse are `buildLedger`'s, so they are testable.
const ledger = buildLedger(rows, confirmations, {
  datasetId: dataset.id,
  validatedAt: now,
  observer: VALIDATION_OBSERVER,
});
const stale = staleConfirmations(rows, confirmations);
const duplicates = duplicateConfirmations(rows, confirmations);

mkdirSync(join(REPO, 'knowledge', 'validation'), { recursive: true });
const ledgerPath = join(REPO, 'knowledge', 'validation', 'corpus.json');
writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
/*
 * Parse the **bytes**, not the object `buildLedger` already validated in memory. One JSON round
 * trip apart, and the round trip is the point: it is where a value that does not survive
 * serialisation — an `undefined`, a `NaN`, a key order the loader depends on — would show itself.
 * A run cannot commit a ledger the loader would reject.
 */
parseCorpusValidation(JSON.parse(readFileSync(ledgerPath, 'utf8')) as unknown, 'corpus.json');

console.log(`validation programme over ${ledger.totals.drawings} drawing-pages\n`);
console.log(`  human-confirmed complete       ${String(ledger.totals.completed).padStart(4)}`);
console.log(`  ran every batch stage          ${String(ledger.totals.batchComplete).padStart(4)}`);
console.log(`  stopped                        ${String(ledger.totals.stopped).padStart(4)}`);
// Owner decision D12: its own line, never added to either count above.
console.log(`  of those, stop confirmed       ${String(ledger.totals.stopsConfirmed).padStart(4)}`);
console.log('\n  stopped at:');
for (const entry of ledger.totals.byStage) {
  console.log(`    ${entry.key.padEnd(16)} ${String(entry.count).padStart(4)}`);
}
console.log('\n  discrepancies by classification:');
for (const entry of ledger.totals.byClassification) {
  console.log(`    ${entry.key.padEnd(22)} ${String(entry.count).padStart(4)}`);
}
if (stale.length > 0) {
  /*
   * Owner decision D10: a confirmation binds to the outcome it was given for. These no longer match
   * any row, so they have stopped counting — and they are **kept**, because a person's act is
   * evidence. Reported because a signature that has quietly stopped asserting anything is exactly
   * what whoever gave it needs to be told.
   */
  console.log('\n  confirmations that no longer match any run (retained, not counted):');
  for (const entry of stale) {
    console.log(`    ${entry.drawingId} p${entry.page} — signed by ${entry.name} on ${entry.at}`);
  }
}

if (duplicates.length > 0) {
  /*
   * Owner decision D11: recorded, but another signature already stands on that row. Reported in a
   * different sentence from a stale one because the two ask different things of the signer.
   */
  console.log('\n  confirmations recorded but not applied (another already stands on the row):');
  for (const entry of duplicates) {
    console.log(`    ${entry.drawingId} p${entry.page} — ${entry.name} on ${entry.at}`);
  }
}

console.log('\n  ran every batch stage (awaiting human confirmation unless marked):');
for (const row of rows.filter((entry) => entry.stoppedAt === null)) {
  console.log(`    ${row.drawingId} p${row.page}`);
}
console.log('\nwritten: knowledge/validation/corpus.json');
