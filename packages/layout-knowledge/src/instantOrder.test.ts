import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { compareSignatures } from './verification';

/**
 * Is `Date.parse` a sound ordering for every string `z.string().datetime({ offset: true })` admits?
 *
 * The question owner decision D11 rests on. `compareSignatures` orders two signatures by
 * `Date.parse(at)`, and `at`'s format is whatever zod accepts — so if zod admits a string
 * `Date.parse` misreads, the ledger records the wrong act as the one that applies.
 *
 * ## Why this file exists rather than a sentence in a document
 *
 * It was a sentence in two documents: *"73,332 strings, zero `NaN`, zero millisecond-resolution
 * inversions."* The number came from a review probe that was deleted afterwards, so two documents
 * rested a decision on a measurement nobody could re-run — which is the overclaim this project keeps
 * finding in its own writing. The sweep is the evidence, so the sweep is committed, and the
 * documents quote what it prints.
 *
 * The reference is computed in **BigInt nanoseconds** from the string's own fields rather than by a
 * second date library, so it is independent of the thing under test.
 */

const at = z.string().datetime({ offset: true });

const YEARS = [0, 1, 999, 1000, 1969, 1970, 2026, 9999];
const MONTHS = [1, 2, 12];
const DAYS = [1, 28, 29, 30, 31];
const HOURS = [0, 12, 23];
const MINUTES = [0, 59];
const SECONDS = [0, 59];
/** Including precisions finer than a millisecond, which is where the one known tie lives. */
const FRACTIONS = ['', '.0', '.000', '.1234', '.12345', '.123456789', '.999999999'];
const OFFSETS = ['Z', '+00:00', '-00:00', '+23:59', '-23:59', '+14:00', '-12:00', '+05:30', '+05:45'];

const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

/**
 * Floor division, which BigInt's `/` is not.
 *
 * It truncates **towards zero**, so for a pre-1970 instant `-1_500_000n / 1_000_000n` is `-1n`
 * where the millisecond containing it is `-2n`. Writing this test caught the difference the honest
 * way: the sweep reported `0000-01-28T00:00:59.999999999Z` and `0000-01-29T00:00:00+23:59` — one
 * nanosecond apart, straddling a millisecond boundary — as a disagreement, and the fault was here
 * rather than in `Date.parse`, which had them right.
 */
function floorDivide(value: bigint, divisor: bigint): bigint {
  return (value - (((value % divisor) + divisor) % divisor)) / divisor;
}

/** The true instant, in nanoseconds, read off the string's own fields. */
function trueNanoseconds(value: string): bigint {
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) throw new Error(`not the shape this reference reads: ${value}`);
  const [, year, month, day, hour, minute, second, fraction, offset] = parts;
  if (!year || !month || !day || !hour || !minute || !second || !offset) {
    throw new Error(`the reference could not read every field of: ${value}`);
  }

  const utc = new Date(0);
  utc.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  utc.setUTCHours(Number(hour), Number(minute), Number(second), 0);

  const nanos = fraction ? BigInt(`${fraction.slice(1)}000000000`.slice(0, 9)) : 0n;
  const offsetNanos =
    offset === 'Z'
      ? 0n
      : (offset.startsWith('-') ? -1n : 1n) *
        (BigInt(offset.slice(1, 3)) * 3600n + BigInt(offset.slice(4, 6)) * 60n) *
        1_000_000_000n;

  return BigInt(utc.getTime()) * 1_000_000n + nanos - offsetNanos;
}

/** Every string in the grid that zod actually accepts. */
const accepted: { value: string; parsed: number; truth: bigint }[] = [];
for (const year of YEARS)
  for (const month of MONTHS)
    for (const day of DAYS)
      for (const hour of HOURS)
        for (const minute of MINUTES)
          for (const second of SECONDS)
            for (const fraction of FRACTIONS)
              for (const offset of OFFSETS) {
                const value = `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(
                  minute,
                )}:${pad(second)}${fraction}${offset}`;
                if (!at.safeParse(value).success) continue;
                accepted.push({
                  value,
                  parsed: Date.parse(value),
                  truth: trueNanoseconds(value),
                });
              }

describe('Date.parse over everything the schema admits', () => {
  it('sweeps a corpus worth sweeping', () => {
    // The size, asserted rather than described — an empty or collapsed grid would make every
    // assertion below vacuous, which is the failure mode this repository keeps finding.
    expect(accepted.length).toBe(73_332);
  });

  it('returns a number for every accepted string', () => {
    /*
     * The failure that would matter most: `NaN` propagates through `Date.parse(a) - Date.parse(b)`
     * as `NaN`, which is falsy, so the comparator would silently fall through to the *name* key and
     * order two signatures by who signed them rather than when.
     */
    const nan = accepted.filter((entry) => Number.isNaN(entry.parsed));
    expect(nan.map((entry) => entry.value)).toEqual([]);
  });

  it('rejects the shapes that would break it before the comparator sees them', () => {
    /*
     * The other half, and the reason the sweep is sound: it is only over what zod *accepts*. These
     * are the strings a date parser disagrees about, and none of them gets through.
     */
    for (const hostile of [
      '2016-12-31T23:59:60Z', // a leap second
      '2026-08-01T24:00:00Z', // midnight written as the end of the previous day
      '2026-08-01T09:00:00+99:00', // an impossible offset
      '2026-08-01T09:00:00+00:60', // sixty minutes of offset
      '2026-08-01T09:00:00+2359', // a basic-format offset
      '2026-08-01T09:00:00+09', // hours only
      '+002026-08-01T09:00:00Z', // an expanded year
      '2026-08-01 09:00:00Z', // a space instead of T
      '2026-08-01T09:00:00', // no zone at all
    ]) {
      expect(at.safeParse(hostile).success, hostile).toBe(false);
    }
  });

  it('orders every pair the way the strings themselves say, down to the millisecond', () => {
    /*
     * Sampled on coprime strides rather than exhaustively — 73,332² is 5.4 billion pairs. The
     * strides are chosen so the sample crosses every year, offset and fraction rather than walking
     * one block of the grid.
     *
     * `truth` is in nanoseconds and `parsed` in milliseconds, so a disagreement below one
     * millisecond is expected and excluded here; it is the subject of the next test.
     */
    let compared = 0;
    for (let i = 0; i < accepted.length; i += 97) {
      for (let j = 0; j < accepted.length; j += 101) {
        const a = accepted[i]!;
        const b = accepted[j]!;
        const millisecondTruth = [a, b].map((entry) => floorDivide(entry.truth, 1_000_000n)) as [
          bigint,
          bigint,
        ];
        const expected =
          millisecondTruth[0] < millisecondTruth[1]
            ? -1
            : millisecondTruth[0] > millisecondTruth[1]
              ? 1
              : 0;
        const actual = a.parsed < b.parsed ? -1 : a.parsed > b.parsed ? 1 : 0;
        expect(actual, `${a.value} vs ${b.value}`).toBe(expected);
        compared += 1;
      }
    }
    // The sample is not empty, and is big enough to be worth quoting.
    expect(compared).toBeGreaterThan(500_000);
  });

  it('ties inside one millisecond, and the tie-break can apply the later act', () => {
    /*
     * The one case where the comparator and true chronology disagree, kept as an assertion rather
     * than a caveat in prose — **owner decision, D11 Q2: two acts inside one millisecond are the
     * same instant.**
     *
     * `.1234` is earlier than `.12345` in truth. Both parse to `.123`, so the raw-`at` key decides,
     * and `'5' < 'Z'` puts the later act first. Deterministic, and reachable: Python's
     * `datetime.isoformat()` emits six fractional digits.
     */
    const earlier = { name: 'A', basis: 'b', at: '2026-08-01T09:00:00.1234Z' };
    const later = { name: 'A', basis: 'b', at: '2026-08-01T09:00:00.12345Z' };

    expect(trueNanoseconds(earlier.at)).toBeLessThan(trueNanoseconds(later.at));
    expect(Date.parse(earlier.at)).toBe(Date.parse(later.at));

    // The later act sorts first. Documented as the accepted cost, not as an accident.
    expect(compareSignatures(later, earlier)).toBeLessThan(0);
  });
});
