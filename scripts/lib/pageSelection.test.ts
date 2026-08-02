import { describe, expect, it } from 'vitest';

import { parsePages, selectPages } from './pageSelection';

/**
 * The rule these tests exist for: **the software never chooses which page to read.**
 *
 * That failure is invisible in the output — a verification record for page 3 looks identical
 * whether a person selected it or the engine picked the page that looked most like a treatment
 * room. So it cannot be caught by inspecting results, only by breaking the function that decides.
 */
describe('page selection never chooses on the reader’s behalf', () => {
  it('analyses every page when nobody selected one', () => {
    const selection = selectPages({ pageCount: 4 });

    expect(selection.mode).toBe('full-document');
    expect(selection.mode === 'full-document' && selection.pages).toEqual([0, 1, 2, 3]);
  });

  it('does not fall back to page 0 when nobody selected one', () => {
    /*
     * The mutation this kills. `page: Number(argument('page', '0'))` — the previous behaviour — made
     * "no selection" and "page 0" the same input, so a multi-page drawing was silently reported on
     * its first page and the record could not say whether anyone had chosen it.
     */
    const selection = selectPages({ pageCount: 6 });

    expect(selection.mode === 'full-document' && selection.pages).not.toEqual([0]);
    expect(selection.mode === 'full-document' && selection.pages.length).toBe(6);
  });

  it('records a selection as a selection, distinct from a full-document run', () => {
    const chosen = selectPages({ pageCount: 6, selected: [2] });

    expect(chosen.mode).toBe('user-selected');
    expect(chosen.mode === 'user-selected' && chosen.pages).toEqual([2]);
    // And the mode is what distinguishes it — a one-page document analysed in full is not the same
    // statement as a person choosing page 0.
    expect(selectPages({ pageCount: 1 }).mode).toBe('full-document');
  });

  it('sorts and de-duplicates a selection without inventing pages', () => {
    const chosen = selectPages({ pageCount: 8, selected: [5, 1, 5] });

    expect(chosen.mode === 'user-selected' && chosen.pages).toEqual([1, 5]);
  });

  it('refuses an out-of-range selection rather than clamping it', () => {
    /*
     * Clamping page 7 to page 3 would analyse a real page nobody asked for and file it under a
     * number nobody chose — a result that is internally consistent and false.
     */
    const selection = selectPages({ pageCount: 4, selected: [7] });

    expect(selection.mode).toBe('refused');
    expect(selection.mode === 'refused' && selection.reason).toContain('7');
    expect(selection.mode === 'refused' && selection.reason).toContain('0 to 3');
  });

  it('refuses a negative or fractional page', () => {
    expect(selectPages({ pageCount: 4, selected: [-1] }).mode).toBe('refused');
    expect(selectPages({ pageCount: 4, selected: [1.5] }).mode).toBe('refused');
  });

  it('refuses to guess when the page count could not be read', () => {
    const selection = selectPages({ pageCount: null });

    expect(selection.mode).toBe('refused');
    expect(selection.mode === 'refused' && selection.reason).toContain('unknown fraction');
  });

  it('still honours an explicit selection when the page count is unknown', () => {
    // A person naming a page has supplied the knowledge the file did not. Refusing here would
    // withhold a reading somebody is entitled to ask for.
    const selection = selectPages({ pageCount: null, selected: [0] });

    expect(selection.mode).toBe('user-selected');
    expect(selection.mode === 'user-selected' && selection.pages).toEqual([0]);
  });

  it('refuses a document reporting no pages', () => {
    expect(selectPages({ pageCount: 0 }).mode).toBe('refused');
  });
});

describe('parsePages keeps "not supplied" distinct from "page 0"', () => {
  it('returns undefined when the argument is absent or blank', () => {
    expect(parsePages(undefined)).toBeUndefined();
    expect(parsePages('')).toBeUndefined();
    expect(parsePages('   ')).toBeUndefined();
  });

  it('parses a single page and a comma-separated list', () => {
    expect(parsePages('0')).toEqual([0]);
    expect(parsePages('1,3, 5')).toEqual([1, 3, 5]);
  });

  it('makes an explicit --page 0 a selection, not a default', () => {
    // The distinction the old default erased: these two must not produce the same selection mode.
    expect(selectPages({ pageCount: 3, selected: parsePages('0') }).mode).toBe('user-selected');
    expect(selectPages({ pageCount: 3, selected: parsePages(undefined) }).mode).toBe('full-document');
  });
});
