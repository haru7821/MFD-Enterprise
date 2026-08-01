import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  parseConfirmations,
  parseCorpusValidation,
  rowFingerprint,
  type Confirmation,
} from '../../packages/layout-knowledge/src/verification';

import {
  buildLedger,
  duplicateConfirmations,
  staleConfirmations,
  type LedgerRow,
} from './corpusLedger';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The shipped ledger, parsed. One reader, so a test cannot quietly use a different file. */
function shippedLedger() {
  return parseCorpusValidation(
    JSON.parse(readFileSync(join(REPO, 'knowledge', 'validation', 'corpus.json'), 'utf8')),
    'corpus.json',
  );
}

/**
 * Owner decisions **D9** and **D10** — where a signature lives, and what it is bound to.
 *
 * D7 gave a row a `confirmedBy` field and nothing ever wrote a non-null one: the builder hardcoded
 * `null`, overwrote the ledger, and re-read it only afterwards, so a signature would have been
 * destroyed by the next `pnpm validate:corpus` — while the comment beside it claimed the opposite.
 * `totals.completed` was structurally pinned at 0 and D7's distinction was unobservable.
 *
 * These exercise `buildLedger`, the function `scripts/validate-corpus.ts` now calls, rather than a
 * copy of its arithmetic. The distinction is not academic: the test these replace asserted its own
 * local re-implementation of the completion rule, and **neither mutation of the production refines
 * touched it**. It was asserting that `Array.filter` works.
 */
describe('D9/D10 — a confirmation survives a re-run, and binds to the run it was given for', () => {
  const OBSERVER = shippedLedger().observer;
  const META = { datasetId: 'test', validatedAt: '2026-08-01T00:00:00.000Z', observer: OBSERVER };

  const ranToEnd: LedgerRow = {
    drawingId: 'Hospital_001/dialysis.pdf',
    page: 0,
    sha256: 'a'.repeat(64),
    reached: 'report',
    stoppedAt: null,
    discrepancies: [],
  };

  const signature = {
    name: 'TS engineer',
    at: '2026-08-01T00:00:00.000Z',
    basis: 'record reviewed against the drawing',
  };
  const confirmation: Confirmation = { ...ranToEnd, ...signature, kind: 'completion' };

  it('merges a confirmation the batch itself never writes', () => {
    // The blocking finding, inverted into an assertion. `buildLedger` is handed rows that carry no
    // signature — as every batch row does — and the ledger comes back with one.
    const ledger = buildLedger([ranToEnd], [confirmation], META);

    expect(ledger.drawings[0]?.confirmedBy).toEqual(signature);
    expect(ledger.totals.completed).toBe(1);
    expect(ledger.totals.batchComplete).toBe(1);
  });

  it('a re-run over the same outcome keeps it — the point of a separate file', () => {
    /*
     * Owner decision D9. The rows are rebuilt from the dataset on every run and carry no signature;
     * `confirmations.json` is not rebuilt. So running twice over the same corpus must produce the
     * same confirmation, which is what the old builder could not do.
     */
    const first = buildLedger([ranToEnd], [confirmation], META);
    const second = buildLedger([ranToEnd], [confirmation], META);

    expect(second.drawings[0]?.confirmedBy).toEqual(first.drawings[0]?.confirmedBy);
    expect(second.totals.completed).toBe(1);
  });

  it('does not count a confirmation whose run has changed', () => {
    /*
     * Owner decision D10: the binding includes the **outcome**, not just the drawing. Each case
     * below changes one bound field and nothing else.
     *
     * The corpus has already done this to itself — `byStage.room` moved 8 → 15 under review with no
     * row's identity changing — which is exactly where a signature bound to the hash alone would
     * have stayed alive over a run nobody confirmed.
     */
    const cases: { readonly what: string; readonly row: LedgerRow; readonly batch: number }[] = [
      { what: 'the drawing bytes', row: { ...ranToEnd, sha256: 'b'.repeat(64) }, batch: 1 },
      { what: 'the page', row: { ...ranToEnd, page: 1 }, batch: 1 },
      {
        /*
         * `reached` and `stoppedAt` move together here, because the schema will not accept a row
         * that stopped nowhere yet reached something short of `report` — so this case is a run that
         * stopped, and its `batchComplete` is 0 rather than 1. Stated per case rather than asserted
         * once for all four: a single expectation covering rows of two different shapes would have
         * to be the weaker of the two.
         */
        what: 'the stage reached',
        row: { ...ranToEnd, reached: 'plan', stoppedAt: 'report' },
        batch: 0,
      },
      {
        what: 'a discrepancy the run now raises',
        row: {
          ...ranToEnd,
          discrepancies: [{ code: 'VD-1', classification: 'drawing_error', subject: '3000' }],
        },
        batch: 1,
      },
    ];

    expect(cases.length).toBe(4);
    for (const { what, row, batch } of cases) {
      const ledger = buildLedger([row], [confirmation], META);
      expect(ledger.drawings[0]?.confirmedBy, `changed: ${what}`).toBeNull();
      expect(ledger.totals.completed, `changed: ${what}`).toBe(0);
      // What it lost is the signature, not the run — the run itself is unchanged in kind.
      expect(ledger.totals.batchComplete, `changed: ${what}`).toBe(batch);
    }
  });

  it('reports a stale confirmation rather than deleting it', () => {
    /*
     * Owner decision D10: *"stale confirmations are retained — a person's act is evidence and is
     * not deleted, it just stops asserting anything."* So the builder does not silently drop it; it
     * comes back from `staleConfirmations` to be reported.
     */
    const moved: LedgerRow = { ...ranToEnd, reached: 'plan', stoppedAt: 'room' };

    const stale = staleConfirmations([moved], [confirmation]);
    expect(stale).toEqual([confirmation]);

    // And a confirmation that does match is not reported stale.
    expect(staleConfirmations([ranToEnd], [confirmation])).toEqual([]);
  });

  it('the shipped confirmations file parses, and is empty', () => {
    /*
     * Empty is the honest state: no run has been confirmed. Asserted rather than assumed, so the
     * day somebody signs a row, the figures in VALIDATION_PROGRAM.md have to be revisited.
     */
    const file = parseConfirmations(
      JSON.parse(readFileSync(join(REPO, 'knowledge', 'validation', 'confirmations.json'), 'utf8')),
      'confirmations.json',
    );

    expect(file.confirmations).toEqual([]);
  });
});

describe('D11 — a duplicate confirmation is reported, never dropped', () => {
  const OBSERVER = shippedLedger().observer;
  const META = { datasetId: 'test', validatedAt: '2026-08-01T00:00:00.000Z', observer: OBSERVER };

  const ranToEnd: LedgerRow = {
    drawingId: 'Hospital_001/dialysis.pdf',
    page: 0,
    sha256: 'a'.repeat(64),
    reached: 'report',
    stoppedAt: null,
    discrepancies: [],
  };

  const early: Confirmation = {
    ...ranToEnd,
    kind: 'completion',
    name: 'Zoe',
    at: '2026-08-01T09:00:00.000Z',
    basis: 'record reviewed',
  };
  const late: Confirmation = {
    ...ranToEnd,
    kind: 'completion',
    name: 'Adam',
    at: '2026-08-02T09:00:00.000Z',
    basis: 'record reviewed again',
  };

  it('applies the earliest signature regardless of file order', () => {
    /*
     * > Owner decision D11: *"the earliest by (`at`, `name`) — first-wins on file order is
     * > arbitrary and the builder already sorts elsewhere for byte-stability."*
     *
     * Both orderings, because the defect being fixed *was* file order: `.find()` took whichever
     * came first in the JSON, so appending to the file changed the ledger's bytes.
     */
    for (const order of [[early, late], [late, early]]) {
      const ledger = buildLedger([ranToEnd], order, META);
      expect(ledger.drawings[0]?.confirmedBy?.name).toBe('Zoe');
    }
  });

  it('breaks a tie on the same timestamp by name, so a re-run is byte-stable', () => {
    const sameTime: Confirmation = { ...late, at: early.at };

    expect(buildLedger([ranToEnd], [early, sameTime], META).drawings[0]?.confirmedBy?.name).toBe(
      'Adam',
    );
    expect(buildLedger([ranToEnd], [sameTime, early], META).drawings[0]?.confirmedBy?.name).toBe(
      'Adam',
    );
  });

  it('reports the one that did not apply, and does not call it stale', () => {
    /*
     * The measured defect: `.find()` dropped the second signature entirely — uncounted, unreported,
     * no test. D11 keeps it and reports it in a **different sentence** from a stale one, because
     * the two ask different things of the signer: stale means your signature stopped applying,
     * duplicate means it was recorded but another stands.
     */
    const duplicates = duplicateConfirmations([ranToEnd], [early, late]);

    expect(duplicates).toEqual([late]);
    expect(staleConfirmations([ranToEnd], [early, late])).toEqual([]);

    // And the count is unaffected — one row, one completion.
    expect(buildLedger([ranToEnd], [early, late], META).totals.completed).toBe(1);
  });

  it('a stale confirmation is not reported as a duplicate', () => {
    // The converse of the above: the two channels must not both fire for one signature.
    const moved: LedgerRow = { ...ranToEnd, reached: 'plan', stoppedAt: 'room' };

    expect(staleConfirmations([moved], [early])).toEqual([early]);
    expect(duplicateConfirmations([moved], [early])).toEqual([]);
  });
});

describe('D12 — a stop may be confirmed, and is never counted as completion', () => {
  const OBSERVER = shippedLedger().observer;
  const META = { datasetId: 'test', validatedAt: '2026-08-01T00:00:00.000Z', observer: OBSERVER };

  const stopped: LedgerRow = {
    drawingId: 'Hospital_002/plan.pdf',
    page: 0,
    sha256: 'c'.repeat(64),
    reached: 'import',
    stoppedAt: 'calibrate',
    discrepancies: [
      { code: 'VD-7', classification: 'insufficient_evidence', subject: 'no scale can be established' },
    ],
  };

  const stopSignature: Confirmation = {
    ...stopped,
    kind: 'stop',
    name: 'TS engineer',
    at: '2026-08-01T00:00:00.000Z',
    basis: 'sheet carries no dimension set — stop is correct',
  };

  it('records the stop confirmation in its own field and its own count', () => {
    const ledger = buildLedger([stopped], [stopSignature], META);

    expect(ledger.drawings[0]?.stopConfirmedBy?.name).toBe('TS engineer');
    expect(ledger.totals.stopsConfirmed).toBe(1);

    /*
     * **D12's hard constraint**, and the assertion that carries it: a confirmed stop is not
     * progress towards completion. `completed` and `batchComplete` keep exactly D7's meaning.
     */
    expect(ledger.totals.completed).toBe(0);
    expect(ledger.totals.batchComplete).toBe(0);
    expect(ledger.drawings[0]?.confirmedBy).toBeNull();
    expect(ledger.totals.stopped).toBe(1);
  });

  it('will not let a stop confirmation stand in for a completion one, or the reverse', () => {
    // The `kind` discriminator is the signer's statement of which act they performed, so the wrong
    // one does not silently reclassify — it simply does not match.
    const asCompletion: Confirmation = { ...stopSignature, kind: 'completion' };

    // It never reaches the builder: `confirmationSchema` refuses it, naming the file people edit.
    expect(() =>
      parseConfirmations({ version: 1, confirmations: [asCompletion] }, 'confirmations.json'),
    ).toThrow(/D12|separate acts/);
  });

  it('a stop confirmation lapses when the stop moves — D10 applies unchanged', () => {
    const reclassified: LedgerRow = {
      ...stopped,
      discrepancies: [
        { code: 'VD-7', classification: 'extraction_error', subject: 'no scale can be established' },
      ],
    };

    const ledger = buildLedger([reclassified], [stopSignature], META);

    expect(ledger.drawings[0]?.stopConfirmedBy).toBeNull();
    expect(ledger.totals.stopsConfirmed).toBe(0);
    expect(staleConfirmations([reclassified], [stopSignature])).toEqual([stopSignature]);
  });
});

describe('rowFingerprint', () => {
  const base: LedgerRow = {
    drawingId: 'Hospital_001/dialysis.pdf',
    page: 0,
    sha256: 'a'.repeat(64),
    reached: 'report',
    stoppedAt: null,
    discrepancies: [],
  };

  it('does not confuse one discrepancy containing its own delimiters with two', () => {
    /*
     * The collision the first implementation had, reduced. It joined the parts as
     * `${code}|${classification}|${subject}` sorted and joined by `~`, escaping neither — and one
     * of the subjects this receives is `the harness threw: ${cause.message}`, arbitrary text.
     *
     * Under D10 a collision means a signature applying to a run it was not given for, which is the
     * one thing the binding exists to prevent. Latent rather than live: no subject in today's
     * corpus contains either character, so nothing but this test would have caught it.
     */
    const one: LedgerRow = {
      ...base,
      discrepancies: [
        {
          code: 'VD-7',
          classification: 'insufficient_evidence',
          subject: 'a~VD-7|insufficient_evidence|b',
        },
      ],
    };
    const two: LedgerRow = {
      ...base,
      discrepancies: [
        { code: 'VD-7', classification: 'insufficient_evidence', subject: 'a' },
        { code: 'VD-7', classification: 'insufficient_evidence', subject: 'b' },
      ],
    };

    expect(rowFingerprint(one)).not.toBe(rowFingerprint(two));
  });

  it('does not confuse a drawing id and page that could be read either way', () => {
    // The same class at the other end of the key: a separator inside a field value.
    const a: LedgerRow = { ...base, drawingId: 'Hospital_1/x 2.pdf', page: 0 };
    const b: LedgerRow = { ...base, drawingId: 'Hospital_1/x', page: 2 };

    expect(rowFingerprint(a)).not.toBe(rowFingerprint(b));
  });

  it('is stable under discrepancy order, because a run may report them in any order', () => {
    const forwards: LedgerRow = {
      ...base,
      discrepancies: [
        { code: 'VD-1', classification: 'drawing_error', subject: 'first' },
        { code: 'VD-7', classification: 'insufficient_evidence', subject: 'second' },
      ],
    };
    const backwards: LedgerRow = {
      ...base,
      discrepancies: [...forwards.discrepancies].reverse(),
    };

    expect(rowFingerprint(forwards)).toBe(rowFingerprint(backwards));
  });

  it('contains no unprintable character', () => {
    /*
     * The repair for the collision above was briefly a NUL separator, which made this the only
     * tracked text file containing one — and `git grep` and `rg` skip a file they judge binary, so
     * the whole module went invisible to search. Structure, not an exotic delimiter.
     */
    const printed = rowFingerprint({
      ...base,
      discrepancies: [{ code: 'VD-1', classification: 'drawing_error', subject: 'x' }],
    });

    expect(printed).toMatch(/^[\x20-\x7e]*$/);
  });
});
