import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  compareSignatures,
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

  it('separates a run that stopped from one that did not', () => {
    /*
     * D10 names `stoppedAt` in the binding explicitly, and it was untested: deleting it from the
     * fingerprint left the whole suite green, because every test that moved `stoppedAt` moved
     * `reached` with it and the fingerprint caught the change through `reached` instead. Pre-existing.
     */
    const ran: LedgerRow = { ...base, reached: 'report', stoppedAt: null };
    const stoppedThere: LedgerRow = { ...base, reached: 'report', stoppedAt: 'report' };

    expect(rowFingerprint(ran)).not.toBe(rowFingerprint(stoppedThere));
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

describe('D11 revised — the order over two signatures, and what the ledger records', () => {
  const OBSERVER = shippedLedger().observer;
  const META = { datasetId: 'test', validatedAt: '2026-08-01T00:00:00.000Z', observer: OBSERVER };

  const ranToEnd: LedgerRow = {
    drawingId: 'Hospital_003/dialysis.pdf',
    page: 0,
    sha256: 'd'.repeat(64),
    reached: 'report',
    stoppedAt: null,
    discrepancies: [],
  };

  const sign = (name: string, at: string, basis = 'record reviewed'): Confirmation => ({
    ...ranToEnd,
    kind: 'completion',
    name,
    at,
    basis,
  });

  it('compares the instant, not its spelling', () => {
    /*
     * The hole ISO-8601 alone does not close, and the reason the comparator does not sort the
     * string. `…T09:00:00+09:00` is midnight UTC — chronologically **earlier** than
     * `…T02:00:00Z` — yet sorts after it in every string order.
     */
    const seoul = sign('Seoul', '2026-08-01T09:00:00+09:00');
    const utc = sign('Utc', '2026-08-01T02:00:00Z');

    expect(Date.parse(seoul.at)).toBeLessThan(Date.parse(utc.at));
    // Lexicographically the other way round, which is what a string sort would have picked.
    expect(seoul.at > utc.at).toBe(true);

    for (const order of [[seoul, utc], [utc, seoul]]) {
      expect(buildLedger([ranToEnd], order, META).drawings[0]?.confirmedBy?.name).toBe('Seoul');
    }
  });

  it('is total, so file order never decides', () => {
    /*
     * Two signers sharing a name and an instant and differing only in `basis`. With (`at`, `name`)
     * alone the comparator returns 0 and `Array.sort`'s stability hands the choice back to file
     * position — the dependence D11 exists to remove, surviving inside D11's own implementation.
     */
    const a = sign('Kim', '2026-08-01T09:00:00Z', 'against the record');
    const b = sign('Kim', '2026-08-01T09:00:00Z', 'against the drawing');

    expect(buildLedger([ranToEnd], [a, b], META).drawings[0]?.confirmedBy?.basis).toBe(
      buildLedger([ranToEnd], [b, a], META).drawings[0]?.confirmedBy?.basis,
    );
  });

  it('does not depend on the machine\'s locale', () => {
    /*
     * `localeCompare` with no locale reads the runtime's, and two documents claimed the ledger's
     * bytes were stable regardless.
     *
     * **The pair matters, and the first one chosen was wrong.** `Ärnst`/`Zoe` kills a
     * `localeCompare` mutant on most runtimes but *survives* under `LC_ALL=sv_SE.UTF-8`, where
     * `'Zoe'.localeCompare('Ärnst', 'sv-SE') === -1` — a guard against machine dependence whose own
     * kill was machine-dependent. Case is the robust discriminator instead: **every** locale
     * collates case-insensitively, putting `alice` before `Bob`, while codepoint order puts `B`
     * (U+0042) before `a` (U+0061). No collation reorders that.
     */
    const at = '2026-08-01T09:00:00Z';
    const winner = buildLedger([ranToEnd], [sign('Bob', at), sign('alice', at)], META);

    expect(winner.drawings[0]?.confirmedBy?.name).toBe('Bob');
    // Stated outright, so the assertion above cannot pass for the wrong reason on some runtime.
    expect('alice'.localeCompare('Bob')).toBeLessThan(0);
  });

  it('orders the unapplied array by the same rule, not by file order', () => {
    /*
     * **The blocking finding.** `staleConfirmations` filters in file order and `buildLedger`
     * concatenated it unsorted, so swapping two entries in `confirmations.json` swapped them in
     * `corpus.json` — measured. This commit exists to remove that dependence and had re-introduced
     * it in the array it added.
     */
    const goneA: LedgerRow = { ...ranToEnd, sha256: 'e'.repeat(64) };
    const goneB: LedgerRow = { ...ranToEnd, sha256: 'f'.repeat(64) };
    const first = { ...sign('Ann', '2026-08-01T09:00:00Z'), ...goneA };
    const second = { ...sign('Bea', '2026-08-02T09:00:00Z'), ...goneB };

    // Neither matches the row being built, so both are stale — the branch that followed file order.
    const forwards = buildLedger([ranToEnd], [first, second], META);
    const backwards = buildLedger([ranToEnd], [second, first], META);

    expect(forwards.unapplied.map((entry) => entry.confirmation.name)).toEqual(['Ann', 'Bea']);
    expect(backwards.unapplied).toEqual(forwards.unapplied);
    // The whole ledger, not just the array: the claim is about the file's bytes.
    expect(JSON.stringify(backwards)).toBe(JSON.stringify(forwards));
  });

  it('breaks a stage tie by codepoint, which the shipped corpus never exercises', () => {
    /*
     * `tally`'s comparator is reached only when two stages have equal counts, and 211/80/15 are all
     * distinct — so reverting it to `localeCompare`, or flipping the tie-break sign, left the whole
     * suite green. The tie has to be constructed.
     */
    const stopAt = (stage: string, sha: string): LedgerRow => ({
      ...ranToEnd,
      sha256: sha,
      reached: 'import',
      stoppedAt: stage,
      discrepancies: [
        { code: 'VD-7', classification: 'insufficient_evidence', subject: 'no scale' },
      ],
    });

    const ledger = buildLedger(
      [stopAt('acalibrate', '1'.repeat(64)), stopAt('Broom', '2'.repeat(64))],
      [],
      META,
    );

    // Equal counts, so the key decides: 'B' (U+0042) before 'a' (U+0061). Every locale says the
    // opposite, which is what makes this a discriminating assertion rather than a restatement.
    expect(ledger.totals.byStage.map((entry) => entry.key)).toEqual(['Broom', 'acalibrate']);
  });

  it('records the acts it did not apply, with the reason, in the ledger itself', () => {
    /*
     * > Owner decision D11, revised: *"one top-level array, outside `totals`, outside `drawings`."*
     *
     * Previously a duplicate went to stdout and nowhere else, so the committed artefact could not
     * show that a second person had signed.
     */
    const early = sign('Adam', '2026-08-01T09:00:00Z');
    const later = sign('Zoe', '2026-08-02T09:00:00Z');
    const moved: LedgerRow = { ...ranToEnd, reached: 'plan', stoppedAt: 'room' };

    const ledger = buildLedger([ranToEnd], [early, later], META);
    expect(ledger.unapplied).toEqual([{ reason: 'duplicate', confirmation: later }]);
    expect(ledger.drawings[0]?.confirmedBy?.name).toBe('Adam');

    const stale = buildLedger([moved], [early], META);
    expect(stale.unapplied).toEqual([{ reason: 'stale', confirmation: early }]);

    // Outside `totals` — D12 forbids a number beside the completion counts that reads like one.
    expect(Object.keys(ledger.totals)).not.toContain('unapplied');
    expect(Object.keys(ledger.totals)).not.toContain('duplicates');
  });

  it('will not accept an unapplied entry whose reason contradicts the rows', () => {
    // What makes the array evidence rather than decoration, checkable without the dataset.
    const ledger = buildLedger([ranToEnd], [sign('Adam', '2026-08-01T09:00:00Z')], META);
    const lying = {
      ...ledger,
      unapplied: [{ reason: 'stale', confirmation: sign('Adam', '2026-08-01T09:00:00Z') }],
    };

    expect(() => parseCorpusValidation(lying, 'lying.json')).toThrow(/unapplied/);
  });

  it('will not accept a duplicate where nothing stands, or where the later act stands', () => {
    /*
     * > **Owner decision, D11 Q1**: *"a `duplicate` means another act of the same kind already
     * > stands on that row, and stands because it is the earlier one."*
     *
     * The first refine only asked whether the entry matched a **row**, and review measured both
     * states below parsing happily. The `duplicate` branch was unexercised entirely: weakening it
     * to `true` left all 1,247 tests green, so half of a guard reported as mutation-verified was
     * not. `buildLedger` cannot produce either state; a hand-edited ledger can.
     */
    const early = sign('Adam', '2026-08-01T09:00:00Z');
    const later = sign('Zoe', '2026-08-02T09:00:00Z');
    const ledger = buildLedger([ranToEnd], [early, later], META);
    expect(ledger.unapplied).toEqual([{ reason: 'duplicate', confirmation: later }]);

    // (a) Nothing stands on the row, so nothing was duplicated.
    const nothingStands = {
      ...ledger,
      totals: { ...ledger.totals, completed: 0 },
      drawings: [{ ...ledger.drawings[0]!, confirmedBy: null }],
    };
    expect(() => parseCorpusValidation(nothingStands, 'nothing.json')).toThrow(/duplicate/);

    // (b) The later act is recorded as the one that applies — the inverse of D11, and checkable.
    const inverted = {
      ...ledger,
      drawings: [{ ...ledger.drawings[0]!, confirmedBy: { name: later.name, at: later.at, basis: later.basis } }],
      unapplied: [{ reason: 'duplicate' as const, confirmation: early }],
    };
    expect(() => parseCorpusValidation(inverted, 'inverted.json')).toThrow(/duplicate/);

    // The right way round is accepted, so the rejections are about the ordering and not the shape.
    expect(() => parseCorpusValidation(ledger, 'ok.json')).not.toThrow();
  });

  it('holds the ledger to the same instant format as the file it copies from', () => {
    /*
     * `signatureSchema.at` was tightened with a docblock saying the ledger "must not accept what
     * its source cannot produce" — and nothing tested it: reverting it to `z.string().min(1)` left
     * all 1,247 tests green. The claim was true of the code and untrue of the guard.
     */
    const ledger = buildLedger([ranToEnd], [sign('Adam', '2026-08-01T09:00:00Z')], META);
    const freeText = {
      ...ledger,
      drawings: [
        { ...ledger.drawings[0]!, confirmedBy: { name: 'Adam', at: '08/01/2026', basis: 'x' } },
      ],
    };

    expect(() => parseCorpusValidation(freeText, 'freetext.json')).toThrow(/at/);
  });

  it('refuses a signature that is not an instant', () => {
    // Owner decision D11: `at` is an instant. `08/01/2026` sorted before an ISO string, so the
    // ledger could have recorded a later act as the one that applies.
    expect(() =>
      parseConfirmations(
        { version: 2, confirmations: [{ ...sign('Adam', '2026-08-01T09:00:00Z'), at: '08/01/2026' }] },
        'confirmations.json',
      ),
    ).toThrow(/at/);
  });
});

describe('an identical entry twice is one act transcribed twice', () => {
  const OBSERVER = shippedLedger().observer;
  const META = { datasetId: 'test', validatedAt: '2026-08-01T00:00:00.000Z', observer: OBSERVER };

  const row: LedgerRow = {
    drawingId: 'Hospital_004/dialysis.pdf',
    page: 0,
    sha256: '9'.repeat(64),
    reached: 'report',
    stoppedAt: null,
    discrepancies: [],
  };
  const act: Confirmation = {
    ...row,
    kind: 'completion',
    name: 'TS engineer',
    at: '2026-08-01T09:00:00Z',
    basis: 'record reviewed',
  };

  it('is refused by the file people edit, naming the entry', () => {
    /*
     * > Owner decision, D11 Q1 follow-up: *"a byte-identical repeat is not two acts — it is one act
     * > transcribed twice, a case D11 never ruled on. (a) and (b) both require the product to guess
     * > which it was; (c) refuses to guess and asks the person."*
     *
     * Measured before the fix: `buildLedger([row], [act, {...act}])` applied the first, filed the
     * second as a duplicate, and the ledger's strict-`<` refine rejected the builder's own output —
     * aborting a 306-drawing run and blaming `corpus.json` for a fault in `confirmations.json`.
     */
    expect(() =>
      parseConfirmations({ version: 2, confirmations: [act, { ...act }] }, 'confirmations.json'),
    ).toThrow(/repeats confirmations\[0\] exactly/);

    // The message names the entry, so the signer can find it in a file of hundreds.
    expect(() =>
      parseConfirmations({ version: 2, confirmations: [act, { ...act }] }, 'confirmations.json'),
    ).toThrow(/Hospital_004\/dialysis\.pdf p0, completion, signed TS engineer/);
  });

  it('leaves D11\'s protected case alone — two people, or one person twice over', () => {
    /*
     * The scope is the whole entry and nothing wider. D11 exists to keep two people signing one row
     * benign, so a rule that swept that up would be the build error D11 refused.
     */
    const secondPerson = { ...act, name: 'Second reviewer' };
    const sameNameDifferentBasis = { ...act, basis: 'checked again against the drawing' };
    const differentRow = { ...act, sha256: '8'.repeat(64) };

    for (const other of [secondPerson, sameNameDifferentBasis, differentRow]) {
      expect(() =>
        parseConfirmations({ version: 2, confirmations: [act, other] }, 'confirmations.json'),
      ).not.toThrow();
    }
  });

  it('so the builder cannot produce the tie its own refine forbids', () => {
    /*
     * The claim the previous commit made without a test, and it was false at the time. Both
     * directions: the tie can no longer reach `buildLedger`, and the case that *can* reach it —
     * two distinguishable acts — builds and files the later one as a duplicate.
     */
    const later = { ...act, name: 'Zulu', at: '2026-08-02T09:00:00Z' };
    const ledger = buildLedger([row], [act, later], META);

    expect(ledger.drawings[0]?.confirmedBy?.name).toBe('TS engineer');
    expect(ledger.unapplied).toEqual([{ reason: 'duplicate', confirmation: later }]);

    // And the ledger refine is still strict: an entry tying the applied act is not "another stands".
    const tied = {
      ...ledger,
      unapplied: [{ reason: 'duplicate' as const, confirmation: act }],
    };
    expect(() => parseCorpusValidation(tied, 'tied.json')).toThrow(/strictly earlier/);
  });
});

describe('the unapplied array is totally ordered', () => {
  const OBSERVER = shippedLedger().observer;
  const META = { datasetId: 'test', validatedAt: '2026-08-01T00:00:00.000Z', observer: OBSERVER };

  const row: LedgerRow = {
    drawingId: 'Hospital_005/dialysis.pdf',
    page: 0,
    sha256: '7'.repeat(64),
    reached: 'report',
    stoppedAt: null,
    discrepancies: [],
  };

  const signer = { kind: 'completion' as const, name: 'Ann', at: '2026-08-01T09:00:00Z', basis: 'reviewed' };

  it('does not fall back to file order when discrepancies differ only in listing order', () => {
    /*
     * The same finding as the previous round, one case narrower — and both documents had by then
     * been changed to assert the opposite.
     *
     * `rowFingerprint` sorts discrepancies before hashing, so these two acts tie on signature *and*
     * on fingerprint. The ledger serialises the confirmation verbatim, so they are different bytes,
     * and `Array.sort`'s stability was handing their order back to the file.
     */
    const a = { code: 'VD-1' as const, classification: 'drawing_error' as const, subject: 'first' };
    const b = { code: 'VD-7' as const, classification: 'insufficient_evidence' as const, subject: 'second' };
    const gone = { ...row, sha256: '6'.repeat(64), reached: 'plan', stoppedAt: 'room' };

    const forwards: Confirmation = { ...gone, ...signer, kind: 'stop', discrepancies: [a, b] };
    const backwards: Confirmation = { ...gone, ...signer, kind: 'stop', discrepancies: [b, a] };

    // Same fingerprint, same signature — the two keys that came first.
    expect(rowFingerprint(forwards)).toBe(rowFingerprint(backwards));

    const one = buildLedger([row], [forwards, backwards], META);
    const two = buildLedger([row], [backwards, forwards], META);

    expect(JSON.stringify(two)).toBe(JSON.stringify(one));
  });

  it('separates two rows one signer signed at the same instant', () => {
    // The fingerprint key, which was itself unguarded: dropping it left the whole suite green.
    const goneA = { ...row, sha256: '5'.repeat(64), reached: 'plan', stoppedAt: 'room' };
    const goneB = { ...row, sha256: '4'.repeat(64), reached: 'plan', stoppedAt: 'room' };
    const first: Confirmation = { ...goneA, ...signer, kind: 'stop' };
    const second: Confirmation = { ...goneB, ...signer, kind: 'stop' };

    expect(compareSignatures(first, second)).toBe(0);

    const one = buildLedger([row], [first, second], META);
    const two = buildLedger([row], [second, first], META);

    expect(JSON.stringify(two)).toBe(JSON.stringify(one));
  });

  it('rejects a key nobody declared on an unapplied entry', () => {
    // `strictObject` like the rest of the module — the guard fires, and nothing tested that it did.
    const ledger = buildLedger([row], [], META);
    const gone = { ...row, sha256: '3'.repeat(64), reached: 'plan', stoppedAt: 'room' };
    const smuggled = {
      ...ledger,
      unapplied: [{ reason: 'stale', confirmation: { ...gone, ...signer, kind: 'stop' }, note: 'x' }],
    };

    expect(() => parseCorpusValidation(smuggled, 'smuggled.json')).toThrow();
  });
});
