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
  type DrawingVerification,
} from './verification';

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
    for (const row of ledger.drawings) {
      if (row.stoppedAt === null) continue;
      expect(row.discrepancies.length, `${row.drawingId} p${row.page} stopped silently`).toBeGreaterThan(0);
    }
    for (const row of ledger.drawings.filter((entry) => entry.stoppedAt === null)) {
      expect(row.reached, row.drawingId).toBe('report');
    }
  });

  it('its totals are the rows counted, not a claim beside them', () => {
    // Re-derived rather than trusted: a summary edited to look better stops matching its own rows.
    expect(ledger.totals.drawings).toBe(ledger.drawings.length);
    expect(ledger.totals.completed).toBe(
      ledger.drawings.filter((row) => row.stoppedAt === null).length,
    );
    expect(ledger.totals.stopped).toBe(
      ledger.drawings.filter((row) => row.stoppedAt !== null).length,
    );
    expect(ledger.totals.completed + ledger.totals.stopped).toBe(ledger.totals.drawings);

    const byStage = new Map(ledger.totals.byStage.map((entry) => [entry.key, entry.count]));
    for (const [stage, count] of byStage) {
      expect(ledger.drawings.filter((row) => row.stoppedAt === stage).length, stage).toBe(count);
    }
    const byClass = new Map(ledger.totals.byClassification.map((entry) => [entry.key, entry.count]));
    for (const [name, count] of byClass) {
      expect(
        ledger.drawings.flatMap((row) => row.discrepancies).filter((d) => d.classification === name)
          .length,
        name,
      ).toBe(count);
    }
  });

  it('every drawing it says completed has a full record beside it', () => {
    // The ledger and the records are two views of the same runs. A row claiming a drawing finished
    // with no record to show for it is a claim nothing backs.
    const withRecords = new Set(records().map((entry) => entry.verification.drawingId));
    for (const row of ledger.drawings.filter((entry) => entry.stoppedAt === null)) {
      expect(withRecords.has(row.drawingId), `${row.drawingId} completed but has no record`).toBe(true);
    }
  });

  it('was produced by a model, and says so', () => {
    expect(ledger.observer.type).toBe('ai');
    expect(ledger.observer.version).not.toBeNull();
  });
});
