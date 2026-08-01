import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseDataset } from './load';
import {
  DISCREPANCY_CLASSES,
  parseCorpusValidation,
  parseDrawingVerification,
  primaryDimensionIsSound,
  type CorpusRow,
  type DrawingVerification,
} from './verification';

/** The shipped ledger, parsed. One reader, so a test cannot quietly use a different file. */
function shippedLedger() {
  return parseCorpusValidation(
    JSON.parse(readFileSync(join(REPO, 'knowledge', 'validation', 'corpus.json'), 'utf8')),
    'corpus.json',
  );
}

/**
 * The committed verification records, checked without the drawings.
 *
 * The drawings live in `MFD-Hospital-Dataset`, outside this repository, so CI cannot re-measure
 * anything — `scripts/verify-drawing.ts` does that, against the dataset, by hand. What CI *can* do
 * is far from nothing: every figure in a record is derived from the others, so a record edited to
 * make a verification look better stops adding up.
 *
 * That is what these assert. Not "the drawing is 17,600 mm long" — nothing here has seen the drawing
 * — but "this record's calibration follows from the dimension it names, its mapping checks follow
 * from that calibration, and its claims of agreement are arithmetic anyone can repeat".
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const KNOWLEDGE = join(REPO, 'knowledge');
const VERIFICATION = join(KNOWLEDGE, 'verification');

const POINTS_PER_MM = 72 / 25.4;

function records(): { name: string; verification: DrawingVerification }[] {
  return readdirSync(VERIFICATION)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => ({
      name,
      verification: parseDrawingVerification(
        JSON.parse(readFileSync(join(VERIFICATION, name), 'utf8')) as unknown,
        `knowledge/verification/${name}`,
      ),
    }));
}

describe('every committed verification record', () => {
  const all = records();

  it('there is at least one', () => {
    // Without this the whole file passes vacuously the day the directory is emptied.
    expect(all.length).toBeGreaterThan(0);
  });

  it.each(all)('$name parses and names a drawing the dataset catalogues', ({ verification }) => {
    const dataset = parseDataset(
      JSON.parse(readFileSync(join(KNOWLEDGE, 'dataset.json'), 'utf8')) as unknown,
    );
    const catalogued = dataset.drawings.find(
      (drawing) => drawing.drawingId === verification.drawingId,
    );

    expect(catalogued, verification.drawingId).toBeDefined();
    // The hash is the whole link between a measurement and the bytes it was taken from. If the
    // catalogue and the verification disagree, one of them was measured from a different file.
    expect(catalogued?.sha256).toBe(verification.sha256);
  });

  it.each(all)('$name calibrated from the longest consistent dimension', ({ verification }) => {
    expect(primaryDimensionIsSound(verification)).toBe(true);

    const primary = verification.dimensions.find((entry) => entry.role === 'primary');
    expect(verification.calibration.fromDimension).toBe(primary?.label);
    expect(verification.calibration.knownDistanceMm).toBe(primary?.statedMm);
  });

  it.each(all)('$name’s scale is the one its own two points produce', ({ verification }) => {
    /*
     * The arithmetic the record rests on, repeated. `millimetresPerPixel` is the known distance over
     * the pixel distance between the two recorded points — so a record whose scale was edited, or
     * whose points were moved, no longer agrees with itself.
     */
    const { pointA, pointB, knownDistanceMm, millimetresPerPixel } = verification.calibration;
    const pixels = Math.hypot(pointB.x - pointA.x, pointB.y - pointA.y);

    expect(knownDistanceMm / pixels).toBeCloseTo(millimetresPerPixel, 9);
  });

  it.each(all)('$name’s recorded points are the primary dimension’s', ({ verification }) => {
    // Ties the calibration to the *dimension list* as well as to the arithmetic: the two points
    // must be the measure points of the dimension the record says it calibrated from.
    const primary = verification.dimensions.find((entry) => entry.role === 'primary')!;
    const { pointA, pointB } = verification.calibration;

    expect(pointA).toEqual(primary.from);
    expect(pointB).toEqual(primary.to);
  });

  it.each(all)('$name’s dimensions agree with the page it names', ({ verification }) => {
    /*
     * Each dimension carries a span in page points and a pair of points in image pixels. The two are
     * the same distance in different units, and the page's render resolution is the conversion — so
     * this catches a record whose page block and dimension block came from different runs.
     */
    const pxPerPt = verification.page.renderDpi / 72;

    for (const dimension of verification.dimensions) {
      const pixels = Math.hypot(
        dimension.to.x - dimension.from.x,
        dimension.to.y - dimension.from.y,
      );
      expect(pixels / pxPerPt, dimension.label).toBeCloseTo(dimension.measuredPt, 6);
      expect(
        dimension.statedMm / (dimension.measuredPt / POINTS_PER_MM),
        dimension.label,
      ).toBeCloseTo(dimension.impliedScale, 6);
    }
  });

  it.each(all)('$name’s mapping checks follow from its calibration', ({ verification }) => {
    /*
     * The step that makes a calibration a verification. Every consistent dimension other than the
     * primary is a distance the mapping had to reproduce without being shown it, and each check
     * records what it produced. Recomputing them here means a record cannot claim agreement it did
     * not demonstrate.
     */
    for (const check of verification.mappingChecks) {
      const dimension = verification.dimensions.find((entry) => entry.label === check.label);
      expect(dimension, check.label).toBeDefined();
      expect(dimension?.role, check.label).toBe('consistent');

      const pixels = Math.hypot(
        dimension!.to.x - dimension!.from.x,
        dimension!.to.y - dimension!.from.y,
      );
      expect(pixels * verification.calibration.millimetresPerPixel, check.label).toBeCloseTo(
        check.mappedMm,
        6,
      );
      expect(check.mappedMm / check.statedMm - 1, check.label).toBeCloseTo(
        check.deviationFraction,
        9,
      );
    }
  });

  it.each(all)('$name’s printed-scale cross-check is arithmetic, not an opinion', ({
    verification,
  }) => {
    const { crossCheck, page } = verification;
    if (!crossCheck) return;

    // "1:100" at the render resolution is millimetres per pixel with nothing else in it.
    const ratio = Number(crossCheck.statedRatio.split(':')[1]);
    expect(Number.isFinite(ratio)).toBe(true);
    expect(crossCheck.millimetresPerPixel).toBeCloseTo((25.4 / page.renderDpi) * ratio, 9);

    expect(
      verification.calibration.millimetresPerPixel / crossCheck.millimetresPerPixel - 1,
    ).toBeCloseTo(crossCheck.deviationFraction, 9);
    // `agrees` is a claim about that number, so it has to follow from it rather than sit beside it.
    expect(crossCheck.agrees).toBe(Math.abs(crossCheck.deviationFraction) <= 0.01);
  });

  it.each(all)('$name records its discrepancies unresolved', ({ verification }) => {
    /*
     * > Owner decision: *"If any discrepancy is found … stop and report it before fixing it."*
     *
     * A record written by the run that found a discrepancy cannot also have fixed it. If one of
     * these ever reads `true`, the run either fixed something silently or the record was edited —
     * and either way the report of what the drawing actually says has been overwritten.
     */
    for (const discrepancy of verification.discrepancies) {
      expect(discrepancy.resolved, discrepancy.subject).toBe(false);
    }
  });

  it.each(all)('$name excludes every inconsistent dimension from its calibration', ({
    verification,
  }) => {
    // The rule that keeps an overridden dimension text out of the numbers while keeping it visible
    // in the record: it is listed, it is described in a discrepancy, and nothing rests on it.
    const inconsistent = verification.dimensions.filter((entry) => entry.role === 'inconsistent');

    for (const entry of inconsistent) {
      expect(verification.calibration.fromDimension).not.toBe(entry.label);
      expect(verification.mappingChecks.map((check) => check.label)).not.toContain(entry.label);
      expect(
        verification.discrepancies.some((discrepancy) => discrepancy.subject.includes(entry.label)),
        `${entry.label} is inconsistent but no discrepancy names it`,
      ).toBe(true);
    }
  });

  it.each(all)('$name carries no drawing content, only figures about it', ({ verification }) => {
    /*
     * > Owner decision: *"Do not store the dataset inside the application repository."*
     *
     * The records are derived data and must stay that way. An embedded page — a data URL, a base64
     * blob — would put a hospital's drawing into this repository through the back door, and it would
     * arrive looking like a field nobody reads.
     */
    const serialised = JSON.stringify(verification);

    expect(serialised).not.toMatch(/data:image/);
    expect(serialised).not.toMatch(/[A-Za-z0-9+/]{200,}={0,2}/);
  });

  it.each(all)('$name was taken by a model, and says so', ({ verification }) => {
    // > Owner decision: *"Do not represent them as human observations."*
    expect(verification.observer.type).toBe('ai');
    expect(verification.observer.version).not.toBeNull();
  });
});

describe('the Hospital_044 verification specifically', () => {
  const verification = records().find(
    (entry) => entry.verification.drawingId === 'Hospital_044/dialysis.pdf',
  )?.verification;

  it('exists — it is the first end-to-end verification drawing', () => {
    expect(verification).toBeDefined();
  });

  it('reproduced every other printed dimension to better than a tenth of a percent', () => {
    /*
     * The result the exercise was for, pinned so a regression in the reader or the transform shows
     * up as a failing test rather than as a slightly different number in a document nobody diffs.
     */
    expect(verification!.mappingChecks.length).toBeGreaterThanOrEqual(5);
    for (const check of verification!.mappingChecks) {
      expect(Math.abs(check.deviationFraction), check.label).toBeLessThan(0.001);
    }
  });

  it('agrees with the printed 1:100 to better than a twentieth of a percent', () => {
    expect(verification!.crossCheck?.agrees).toBe(true);
    expect(Math.abs(verification!.crossCheck!.deviationFraction)).toBeLessThan(0.0005);
  });

  it('used the owner’s planning footprints and no manufacturer dimension', () => {
    /*
     * > Owner decision: *"Do not change the planning footprint (800 × 800) unless explicitly
     * > instructed. Manufacturer dimensions and planning footprint must remain separate."*
     *
     * The AK98's manufacturer width is 345 mm. If the pipeline ever placed against that instead of
     * the planning footprint, this is where it would show.
     */
    const machine = verification!.pipeline.placements.find(
      (entry) => entry.equipmentObjectId === 'vantive_ak98',
    );
    const bed = verification!.pipeline.placements.find(
      (entry) => entry.equipmentObjectId === 'dialysis_bed',
    );

    expect(machine?.footprint).toEqual({ width: 800, depth: 800 });
    expect(bed?.footprint).toEqual({ width: 1_000, depth: 2_100 });
  });

  it('took its length from a printed dimension and its width from a measurement', () => {
    // The distinction the whole verification turns on: the drawing dimensions the hall one way and
    // not the other, and the record has to keep saying which is which.
    const { room } = verification!.pipeline;

    expect(room.lengthMm).toBe(17_600);
    expect(room.lengthSource).toContain('printed dimension');
    expect(room.widthSource).toContain('calibrated measurement');
    expect(
      verification!.discrepancies.some((discrepancy) => discrepancy.code === 'VD-4'),
      'a value that is not printed must be recorded as such',
    ).toBe(true);
  });
});

describe('the corpus validation ledger', () => {
  const ledger = parseCorpusValidation(
    JSON.parse(readFileSync(join(REPO, 'knowledge', 'validation', 'corpus.json'), 'utf8')) as unknown,
    'knowledge/validation/corpus.json',
  );

  it('has a row for every drawing the dataset catalogues, and no others', () => {
    /*
     * > Owner decision: *"Continue validating against the real drawing corpus. **For every
     * > drawing** …"*
     *
     * The assertion that keeps the ledger a ledger. A run that skipped what it could not read would
     * report a corpus of two and call it coverage — and the ratio of what completes to what does not
     * is the whole finding.
     */
    const dataset = parseDataset(
      JSON.parse(readFileSync(join(KNOWLEDGE, 'dataset.json'), 'utf8')) as unknown,
    );
    const catalogued = new Set(dataset.drawings.map((drawing) => drawing.drawingId));
    const validated = new Set(ledger.drawings.map((row) => row.drawingId));

    expect([...catalogued].filter((id) => !validated.has(id))).toEqual([]);
    expect([...validated].filter((id) => !catalogued.has(id))).toEqual([]);
  });

  it('classifies every discrepancy it records', () => {
    // > *"Every discrepancy must be classified as one of: drawing error, extraction error,
    // > algorithm defect, unsupported drawing, insufficient evidence."*
    const classes = new Set<string>(DISCREPANCY_CLASSES);
    for (const row of ledger.drawings) {
      for (const entry of row.discrepancies) {
        expect(classes.has(entry.classification), `${row.drawingId} ${entry.code}`).toBe(true);
      }
    }
  });

  it('gives every stopped run a stage and a reason, and every completed run neither', () => {
    /*
     * A stop with no discrepancy is a run that gave up without saying why, which is indistinguishable
     * in a ledger from one that had nothing to report. The converse matters as much: a run that
     * completed the whole programme cannot also claim to have stopped somewhere.
     */
    const stopped = ledger.drawings.filter((entry) => entry.stoppedAt !== null);
    const ranToEnd = ledger.drawings.filter((entry) => entry.stoppedAt === null);

    /*
     * The sizes first — the rule this file adopted and then did not obey.
     *
     * Review measured it: mutating `toBe('report')` below to `toBe('NEVER')` left the whole suite
     * green, because `ranToEnd` is empty. The test's title claims both halves and only one of them
     * was running. `isomorphism.test.ts` has done this correctly all along and is the pattern.
     */
    expect(stopped.length).toBe(306);
    expect(ranToEnd.length).toBe(0);

    for (const row of stopped) {
      expect(
        row.discrepancies.length,
        `${row.drawingId} p${row.page} stopped silently`,
      ).toBeGreaterThan(0);
    }
    /*
     * The second half is **not** a loop over `ranToEnd`, which is empty. It was, and mutating the
     * assertion inside it left the suite green; declaring the emptiness above made that visible
     * without making the property hold anywhere. So it is now a rejection test against the schema,
     * where every ledger has to satisfy it whether or not this corpus contains an example.
     */
    expect(ranToEnd).toEqual([]);
    const impossible = {
      ...ledger,
      totals: { ...ledger.totals, batchComplete: 1, stopped: ledger.totals.stopped - 1 },
      drawings: [
        { ...ledger.drawings[0]!, stoppedAt: null, reached: 'calibrate' },
        ...ledger.drawings.slice(1),
      ],
    };
    expect(() => parseCorpusValidation(impossible, 'impossible.json')).toThrow(/reached/);
  });

  it('its totals are the rows counted, not a claim beside them', () => {
    // Re-derived rather than trusted: a summary edited to look better stops matching its own rows.
    expect(ledger.totals.drawings).toBe(ledger.drawings.length);
    /*
     * Two counts, two rules — owner decision D7. This assertion said `completed` was the rows with
     * `stoppedAt === null`, which is the rule D7 replaced; it survived the change only because the
     * shipped corpus has no such row and both numbers are 0. A stale assertion that agrees with the
     * code by coincidence is the same defect as a guard over an empty set.
     */
    expect(ledger.totals.completed).toBe(
      ledger.drawings.filter((row) => row.stoppedAt === null && row.confirmedBy !== null).length,
    );
    expect(ledger.totals.batchComplete).toBe(
      ledger.drawings.filter((row) => row.stoppedAt === null).length,
    );
    expect(ledger.totals.stopped).toBe(
      ledger.drawings.filter((row) => row.stoppedAt !== null).length,
    );
    // Every row either ran the whole batch or stopped — completion is a subset, not a partition.
    expect(ledger.totals.batchComplete + ledger.totals.stopped).toBe(ledger.totals.drawings);

    /*
     * Both directions, and the second one is the one that matters.
     *
     * Iterating the summary only checks the entries that are *there*: deleting `calibrate: 80` and
     * `extraction_error: 20` from the file left every test passing, which is exactly the edit this
     * test says it prevents. So the tallies are rebuilt from the rows and compared whole — a
     * summary that is missing a line now fails the same way one that overstates a line does.
     */
    const tally = (values: readonly string[]) => {
      const counts = new Map<string, number>();
      for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
      return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    };

    expect(
      [...ledger.totals.byStage]
        .map((entry) => [entry.key, entry.count] as const)
        .sort((a, b) => a[0].localeCompare(b[0])),
    ).toEqual(tally(ledger.drawings.flatMap((row) => (row.stoppedAt ? [row.stoppedAt] : []))));

    expect(
      [...ledger.totals.byClassification]
        .map((entry) => [entry.key, entry.count] as const)
        .sort((a, b) => a[0].localeCompare(b[0])),
    ).toEqual(
      tally(ledger.drawings.flatMap((row) => row.discrepancies.map((d) => d.classification))),
    );
  });

  it('every drawing it says completed has a full record beside it', () => {
    /*
     * **This test used to pass on an empty set.** It filtered `stoppedAt === null` and looped over
     * the result; every row in the shipped ledger stops somewhere, so the loop never executed and
     * the assertion inside it never ran. Found by review, and it is the shape this project keeps
     * finding: a guard whose subject is empty is not a guard.
     *
     * So it now asserts in **both directions** and states what it is quantifying over, which is
     * what makes an empty set visible rather than silent.
     */
    const withRecords = new Set(records().map((entry) => entry.verification.drawingId));
    const completed = ledger.drawings.filter((row) => row.confirmedBy !== null);

    // Direction 1: a row the ledger calls completed must have a record.
    for (const row of completed) {
      expect(withRecords.has(row.drawingId), `${row.drawingId} completed but has no record`).toBe(
        true,
      );
    }

    // Direction 2: and the count the ledger reports must be that same set, so a row cannot be
    // counted as completed without appearing in it.
    expect(completed.length).toBe(ledger.totals.completed);
  });

  it('does not call a batch run complete', () => {
    /*
     * > Owner decision D7: *"The programme is complete only after a human-confirmed run. Batch
     * > execution alone is not completion."*
     *
     * **This test was vacuous when it was written, and it was written by the commit that fixed the
     * previous vacuous test in this file — the fourth instance here.** Every assertion in it ranged
     * over a set the shipped ledger leaves empty: `stoppedAt === null` matches 0 rows and
     * `confirmedBy !== null` matches 0 rows, so `0 <= 0`, `0 === 0`, and two loops over nothing.
     *
     * So it now **states the subject sizes first**. That is the rule this file adopts: a test that
     * loops a filtered set asserts that set's size before looping it, and an empty subject is
     * declared rather than discovered. Three of the four filtered loops in this repository were in
     * this file and all three were empty.
     */
    const batchComplete = ledger.drawings.filter((row) => row.stoppedAt === null);
    const confirmed = ledger.drawings.filter((row) => row.confirmedBy !== null);

    /*
     * The declaration. Today both are empty — the corpus reaches the end of the batch on nothing —
     * and that is a fact about the corpus this test asserts rather than silently rests on. The day a
     * drawing does run to the end, this line fails and whoever changed it comes here and extends the
     * assertions below to cover the case that now exists.
     */
    expect({ batchComplete: batchComplete.length, confirmed: confirmed.length }).toEqual({
      batchComplete: 0,
      confirmed: 0,
    });

    // And the counts the ledger reports are those same sets, so neither can be inflated.
    expect(ledger.totals.batchComplete).toBe(batchComplete.length);
    expect(ledger.totals.completed).toBe(
      ledger.drawings.filter((row) => row.stoppedAt === null && row.confirmedBy !== null).length,
    );
    expect(ledger.totals.completed).toBeLessThanOrEqual(ledger.totals.batchComplete);
  });

  it('rejects a ledger that counts an unconfirmed run as complete', () => {
    /*
     * The guard that actually catches a miscounting **builder**, which the test above cannot.
     *
     * `validate-corpus.ts` is a top-level script no test imports, so mutating its arithmetic is
     * invisible to a unit test — and today's corpus cannot discriminate anyway, because no row
     * reaches the end of the batch and both rules therefore return 0. Measured on 2026-08-01:
     * reverting the builder's `completed` to `stoppedAt === null` left all 1,218 tests in 67 files
     * green, and weakening the schema rule below to the same wrong count fails this test alone.
     *
     * So the invariant lives in the schema, and the builder parses back what it has just written.
     * A ledger claiming a completion it cannot show a confirmation for is now rejected by the
     * loader, whatever produced it.
     */
    const base = parseCorpusValidation(
      JSON.parse(readFileSync(join(REPO, 'knowledge', 'validation', 'corpus.json'), 'utf8')),
      'corpus.json',
    );
    // `reached: 'report'` because a row that stopped nowhere reached the end — the schema says so.
    const ran: CorpusRow = {
      ...base.drawings[0]!,
      reached: 'report',
      stoppedAt: null,
      confirmedBy: null,
    };

    const inflated = {
      ...base,
      totals: { ...base.totals, completed: 1, batchComplete: 1, stopped: base.totals.stopped - 1 },
      drawings: [ran, ...base.drawings.slice(1)],
    };

    expect(() => parseCorpusValidation(inflated, 'inflated.json')).toThrow(/D7|confirmation/);

    // The same ledger with the row actually signed is accepted, so the rejection is about the
    // missing confirmation and not about the shape of the edit.
    const signed = {
      ...inflated,
      drawings: [
        {
          ...ran,
          confirmedBy: { name: 'TS engineer', at: '2026-08-01T00:00:00.000Z', basis: 'record reviewed' },
        },
        ...base.drawings.slice(1),
      ],
    };
    expect(() => parseCorpusValidation(signed, 'signed.json')).not.toThrow();
  });

  it('rejects a ledger whose batchComplete does not count its own rows', () => {
    /*
     * The second refine, which had **no test at all** — measured: `true || <predicate>` left all
     * 1,218 tests in 67 files green, while the commit message and `docs/OPEN_QUESTIONS.md` both
     * presented "two refine() rules" as the enforcement. One of the two was doing the work.
     */
    const base = shippedLedger();
    // `reached: 'report'` because a row that stopped nowhere reached the end — the schema says so.
    const ran: CorpusRow = {
      ...base.drawings[0]!,
      reached: 'report',
      stoppedAt: null,
      confirmedBy: null,
    };
    const wrong = {
      ...base,
      totals: { ...base.totals, batchComplete: 99, stopped: base.totals.stopped - 1 },
      drawings: [ran, ...base.drawings.slice(1)],
    };

    expect(() => parseCorpusValidation(wrong, 'wrong.json')).toThrow(/batchComplete/);

    // The same edit with the count right is accepted, so the rejection is about the number.
    expect(() =>
      parseCorpusValidation(
        { ...wrong, totals: { ...wrong.totals, batchComplete: 1 } },
        'right.json',
      ),
    ).not.toThrow();
  });

  it('rejects a ledger whose stopsConfirmed does not count its own rows', () => {
    /*
     * Owner decision D12's count, and it escaped the first mutation round: disabling this refine
     * left all 54 tests in the two files green, because the shipped ledger has `stopsConfirmed: 0`
     * and `buildLedger` computes it consistently, so nothing discriminated. The same shape as the
     * `completed` and `batchComplete` guards beside it, and for the same reason.
     */
    const base = shippedLedger();
    const stopped = base.drawings.find((row) => row.stoppedAt !== null)!;
    const signed = {
      ...base,
      totals: { ...base.totals, stopsConfirmed: 5 },
      drawings: [
        {
          ...stopped,
          stopConfirmedBy: { name: 'TS engineer', at: '2026-08-01T00:00:00.000Z', basis: 'checked' },
        },
        ...base.drawings.filter((row) => row !== stopped),
      ],
    };

    expect(() => parseCorpusValidation(signed, 'inflated.json')).toThrow(/stopsConfirmed/);

    // The same ledger with the count right is accepted, so it is the number being rejected.
    expect(() =>
      parseCorpusValidation({ ...signed, totals: { ...signed.totals, stopsConfirmed: 1 } }, 'ok.json'),
    ).not.toThrow();
  });

  it('rejects a confirmation on a run that stopped early', () => {
    /*
     * A state D7's model forbids and the ledger could express: `confirmedBy` on a row that stopped
     * at `import` — a signature against a run that did not happen. It was asserted in a test, over
     * an empty set, and enforced nowhere. Measured before the refine was added: it parsed.
     */
    const base = shippedLedger();
    const stopped = base.drawings.find((row) => row.stoppedAt !== null)!;
    const signed = {
      ...base,
      drawings: [
        {
          ...stopped,
          confirmedBy: { name: 'TS engineer', at: '2026-08-01T00:00:00.000Z', basis: 'reviewed' },
        },
        ...base.drawings.filter((row) => row !== stopped),
      ],
    };

    expect(() => parseCorpusValidation(signed, 'signed.json')).toThrow(/stoppedAt/);
  });
});

describe('the ledger observer', () => {
  const ledger = shippedLedger();

  it('was produced by a model, and says so', () => {
    expect(ledger.observer.type).toBe('ai');
    expect(ledger.observer.version).not.toBeNull();
  });
});
