import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateDrawing } from './lib/validateDrawing';

/**
 * Verify one drawing end to end, and write what it found.
 *
 * ```
 * pnpm verify:drawing                                   # Hospital_044/dialysis.pdf
 * pnpm verify:drawing --drawing Hospital_012/dialysis.pdf --page 1
 * ```
 *
 * A thin front end over `./lib/validateDrawing.ts`, which `scripts/validate-corpus.ts` also drives.
 * One implementation of the pipeline, two ways of asking for it — a second would let the two
 * disagree about what a drawing is worth, and the one that ran less often would be the wrong one.
 *
 * The dataset lives outside this repository, so this cannot run in CI and is not meant to. What it
 * leaves behind is committed, and `packages/layout-knowledge/src/verification.test.ts` checks that
 * record's internal coherence on every push: CI cannot re-measure the drawing, but it can prove
 * nobody edited the answer.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

/**
 * Whether to write this drawing's observations into the knowledge base.
 *
 * `--observations skip` records the verification and withholds the readings, and it exists for one
 * situation: a sheet that is a **second plot of a plan already observed**. Hospital_044's two files
 * are the same floor plan — the dataset's own analysis says so — so verifying both is worth doing
 * and counting both would claim two drawings support a figure that one room produced. `support` is
 * a count of independent evidence or it is nothing.
 *
 * A reason is required with it, so the withholding is a decision somebody made rather than a flag
 * somebody found.
 */
const observationMode = argument('observations', 'write');
const skipReason = argument('reason', '');
if (observationMode !== 'write' && skipReason === '') {
  throw new Error('--observations skip requires --reason "why these readings are not independent"');
}

const outcome = await validateDrawing({
  repo: REPO,
  datasetRoot: argument('dataset', '/workspace/mfd-hospital-dataset'),
  drawingId: argument('drawing', 'Hospital_044/dialysis.pdf'),
  page: Number(argument('page', '0')),
  /*
   * Supplied rather than read from a clock. Every engine here takes its timestamps as arguments
   * (AD-3), and a verification record is where that matters most: a run that stamped `Date.now()`
   * could not be repeated to check it, and the diff of a re-run would be noise.
   */
  now: argument('now', '2026-07-31T00:00:00.000Z'),
  /*
   * `--room "<how it was confirmed>"`. Without it the run stops at the room stage, because nothing
   * here can establish which rectangle is the treatment room. Supplying it is a person saying they
   * looked; the string is stored in the record so a later reader can judge whether they were right.
   */
  ...(argument('room', '') === '' ? {} : { roomCorroboration: argument('room', '') }),
});

console.log(`${outcome.drawingId}  page ${outcome.page}  sha256 ${outcome.sha256.slice(0, 12)}…`);

if (!outcome.verification) {
  console.log(`  stopped at "${outcome.stoppedAt}" after completing "${outcome.reached}"`);
  for (const entry of outcome.discrepancies) {
    console.log(`\n  ${entry.code} · ${entry.classification} · ${entry.subject}\n    ${entry.detail}`);
  }
  process.exitCode = 1;
} else {
  const { calibration, crossCheck, mappingChecks, pipeline } = outcome.verification;
  console.log(
    `  scale from "${calibration.fromDimension}": ${calibration.millimetresPerPixel.toFixed(5)} mm/px`,
  );
  if (crossCheck) {
    console.log(
      `  printed ${crossCheck.statedRatio}: ${crossCheck.millimetresPerPixel.toFixed(5)} mm/px → ` +
        `${(crossCheck.deviationFraction * 100).toFixed(3)} %  ${crossCheck.agrees ? 'agrees' : 'DISAGREES'}`,
    );
  }
  for (const check of mappingChecks) {
    console.log(
      `  mapping check ${check.label.padStart(7)} → ${check.mappedMm.toFixed(1).padStart(9)} mm  ` +
        `(${(check.deviationFraction * 100).toFixed(3)} %)`,
    );
  }
  console.log(`  room ${pipeline.room.lengthMm} × ${Math.round(pipeline.room.widthMm)} mm`);
  console.log(
    `  evaluation  RED ${pipeline.evaluation.red}  YELLOW ${pipeline.evaluation.yellow}  GREEN ${pipeline.evaluation.green}`,
  );
  console.log(
    `  optimiser   ${pipeline.optimiser?.proposals} proposals for ${pipeline.optimiser?.resolvedCount} stations`,
  );
  console.log(
    `  plan        ${pipeline.installationPlan?.stages} stages, ${pipeline.installationPlan?.blockers} blockers`,
  );
  console.log(
    `  report      ${pipeline.report?.overallVerdict}, ${pipeline.report?.pdfBytes} bytes of PDF`,
  );
  for (const entry of outcome.discrepancies) {
    console.log(`\n  ${entry.code} · ${entry.classification} · ${entry.subject}\n    ${entry.detail}`);
  }

  const slug = outcome.drawingId.replace(/[/\\]/g, '-').replace(/\.pdf$/i, '');
  mkdirSync(join(REPO, 'knowledge', 'verification'), { recursive: true });
  const recordPath = join(REPO, 'knowledge', 'verification', `${slug}.json`);
  writeFileSync(recordPath, `${JSON.stringify(outcome.verification, null, 2)}\n`);

  if (observationMode !== 'write') {
    console.log(`\n  observations withheld: ${skipReason}`);
  }

  const observationPath = join(
    REPO,
    'knowledge',
    'observations',
    // One stable name per drawing, derived from its id, so a re-run overwrites its own file rather
    // than accumulating a second copy of every observation under a slightly different name.
    `verification-${slug.toLowerCase()}.json`,
  );
  if (observationMode === 'write') {
    writeFileSync(
      observationPath,
      `${JSON.stringify({ datasetId: 'dialysis-drawings', observations: outcome.observations }, null, 2)}\n`,
    );
  }

  console.log(`\nwritten: ${recordPath.slice(REPO.length + 1)}`);
  if (observationMode === 'write') console.log(`written: ${observationPath.slice(REPO.length + 1)}`);
}
