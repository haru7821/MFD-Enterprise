import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readFileSync } from 'node:fs';

import {
  CORPUS_VALIDATION_VERSION,
  parseCorpusValidation,
  type CorpusRow,
} from '../packages/layout-knowledge/src/verification';

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

const rows: CorpusRow[] = [];
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

function tally(values: readonly string[]): { key: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  // Sorted by count then key, so a re-run with the same inputs produces the same bytes.
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

const ledger = {
  version: CORPUS_VALIDATION_VERSION as typeof CORPUS_VALIDATION_VERSION,
  datasetId: dataset.id,
  validatedAt: now,
  observer: VALIDATION_OBSERVER,
  totals: {
    drawings: rows.length,
    completed: rows.filter((row) => row.stoppedAt === null).length,
    stopped: rows.filter((row) => row.stoppedAt !== null).length,
    byStage: tally(rows.flatMap((row) => (row.stoppedAt ? [row.stoppedAt] : []))),
    byClassification: tally(
      rows.flatMap((row) => row.discrepancies.map((entry) => entry.classification)),
    ),
  },
  drawings: rows,
};

mkdirSync(join(REPO, 'knowledge', 'validation'), { recursive: true });
const path = join(REPO, 'knowledge', 'validation', 'corpus.json');
writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
// Parse what was just written, so a run cannot commit a ledger the loader would reject.
parseCorpusValidation(JSON.parse(readFileSync(path, 'utf8')) as unknown, 'knowledge/validation/corpus.json');

console.log(`validation programme over ${ledger.totals.drawings} drawing-pages\n`);
console.log(`  completed the whole programme  ${String(ledger.totals.completed).padStart(4)}`);
console.log(`  stopped                        ${String(ledger.totals.stopped).padStart(4)}`);
console.log('\n  stopped at:');
for (const entry of ledger.totals.byStage) {
  console.log(`    ${entry.key.padEnd(16)} ${String(entry.count).padStart(4)}`);
}
console.log('\n  discrepancies by classification:');
for (const entry of ledger.totals.byClassification) {
  console.log(`    ${entry.key.padEnd(22)} ${String(entry.count).padStart(4)}`);
}
console.log('\n  completed:');
for (const row of rows.filter((entry) => entry.stoppedAt === null)) {
  console.log(`    ${row.drawingId} p${row.page}`);
}
console.log(`\nwritten: ${path.slice(REPO.length + 1)}`);
