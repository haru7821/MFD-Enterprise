/**
 * Which pages of a drawing get analysed — the decision, lifted out of the script that runs it.
 *
 * > Owner decision: *"Analyse every page independently. Never automatically select the page
 * > containing the target room. Never infer room relevance from visual similarity. If the user
 * > selects a page, record that selection. If no page is selected, analyse all pages and report
 * > page-level results."*
 *
 * This lives in `scripts/lib/` rather than in `verify-drawing.ts` for the reason `corpusLedger.ts`
 * exists: a top-level script runs at import time, so nothing can import it and nothing can test it.
 * The rule that decides which pages are read is exactly the kind of rule that must be breakable in
 * a test, because the failure it prevents — the engine quietly choosing one page out of many — is
 * invisible in the output. A record of page 3 looks the same whether a person chose it or the
 * software did.
 */

/** Every page, one page-level result each. Nothing is chosen on the reader's behalf. */
export interface FullDocument {
  readonly mode: 'full-document';
  readonly pages: readonly number[];
}

/** The pages a person asked for, recorded as their selection. */
export interface UserSelected {
  readonly mode: 'user-selected';
  readonly pages: readonly number[];
}

/**
 * No page can be analysed, and the reason is stated rather than worked around.
 *
 * There is deliberately no fallback to page 0 here. A drawing whose page count could not be read is
 * a drawing nobody knows the shape of, and reading its first page would produce a real result about
 * an unknown fraction of the document — the shape of answer this product exists not to give.
 */
export interface Refused {
  readonly mode: 'refused';
  readonly reason: string;
}

export type PageSelection = FullDocument | UserSelected | Refused;

export interface PageSelectionInput {
  /** From the catalogued dataset entry. `null` when the format carries no page count. */
  readonly pageCount: number | null;
  /**
   * Zero-based pages the user asked for. Empty or absent means *they did not choose*, which is not
   * the same as choosing everything — but it is what produces a full-document analysis, because the
   * alternative is the software choosing.
   */
  readonly selected?: readonly number[] | undefined;
}

/**
 * **There are three outcomes and no fourth.** No branch of this function picks a subset of pages on
 * its own: either a person named them, or every page is read, or nothing is read and the reason is
 * given. That is the whole content of the owner's rule 2, and it is why this is a total function
 * over the input rather than a sequence of early returns with a default at the bottom.
 */
export function selectPages(input: PageSelectionInput): PageSelection {
  const selected = input.selected ?? [];

  if (selected.length > 0) {
    /*
     * A selection is honoured as given — including a selection the count says is out of range,
     * which is refused rather than clamped. Clamping page 7 to page 3 would analyse a real page
     * nobody asked for and record it under a number nobody chose.
     */
    const sorted = [...new Set(selected)].sort((a, b) => a - b);

    const invalid = sorted.filter(
      (page) => !Number.isInteger(page) || page < 0 || (input.pageCount !== null && page >= input.pageCount),
    );
    if (invalid.length > 0) {
      return {
        mode: 'refused',
        reason:
          `selected page(s) ${invalid.join(', ')} are not in this document` +
          (input.pageCount === null
            ? ' (its page count could not be read)'
            : ` — it has ${input.pageCount} page(s), numbered 0 to ${input.pageCount - 1}`),
      };
    }

    return { mode: 'user-selected', pages: sorted };
  }

  if (input.pageCount === null) {
    return {
      mode: 'refused',
      reason:
        'no page was selected and the page count could not be read, so the pages cannot be ' +
        'enumerated. Reading page 0 would report on an unknown fraction of the document.',
    };
  }

  if (input.pageCount < 1) {
    return { mode: 'refused', reason: `the document reports ${input.pageCount} pages` };
  }

  return {
    mode: 'full-document',
    pages: Array.from({ length: input.pageCount }, (_, page) => page),
  };
}

/**
 * Parse `--page` / `--pages` into the selection, treating "not supplied" as *not chosen*.
 *
 * Kept separate from {@link selectPages} so the argument spelling and the rule are not the same
 * function: `--page 0` supplied by a person is a **selection**, and no argument at all is not a
 * selection of page 0. Those were the same thing while `page` defaulted to `0`, and the record could
 * not tell them apart afterwards.
 */
export function parsePages(raw: string | undefined): readonly number[] | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => Number(part));
}
