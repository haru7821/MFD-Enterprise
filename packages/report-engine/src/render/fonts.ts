import fontkit from '@pdf-lib/fontkit';
import type { PDFDocument, PDFFont } from 'pdf-lib';

import type { FontBytes } from './types';

/**
 * Font embedding for a bilingual PDF.
 *
 * ## Why this file exists at all
 *
 * The standard 14 PDF fonts have **no Hangul glyphs**. A bilingual report therefore has to
 * embed a font, which is the one choice in this sprint that is painful to retrofit — and the
 * reason the language question was answered before the emit stage was written.
 *
 * ## One family for both scripts
 *
 * **Pretendard**, SIL Open Font License 1.1, Regular and Bold. It carries Latin and all
 * 11,172 modern Hangul syllables, which means a bilingual line is one font: mixing Helvetica
 * for the English with a Korean face for the Korean would mismatch on the same line and would
 * make text measurement two problems instead of one.
 *
 * The design document named Noto Sans KR. Pretendard is the deviation, for two reasons worth
 * recording rather than quietly substituting: it is distributable through the package registry
 * this environment can reach, and its two static faces are 5.4 MB against Noto's ~11 MB for
 * the same coverage. Both are OFL 1.1; `assets/fonts/OFL.txt` ships alongside.
 *
 * ## Subsetting, and why the PDF is small anyway
 *
 * `subset: true` embeds only the glyphs the document uses. A full Korean face is megabytes; a
 * report using a few hundred distinct glyphs adds tens of kilobytes. Measured on a page of
 * mixed Korean and Latin: 5.5 KB.
 *
 * ## No fallback
 *
 * A character with no glyph **throws, naming the character**. It does not render a blank box.
 *
 * That is the one decision here worth defending: a tofu square where a room name should be,
 * inside a document a hospital has signed, is exactly the class of quiet failure this product
 * exists to refuse. An error an engineer sees before sending is cheaper by a wide margin.
 */

export interface EmbeddedFonts {
  readonly regular: PDFFont;
  readonly bold: PDFFont;
  /** Throws if any character in `value` has no glyph in the embedded face. */
  readonly assertRenderable: (value: string, context: string) => void;
}

export class MissingGlyphError extends Error {
  constructor(
    readonly character: string,
    readonly codePoint: number,
    readonly context: string,
  ) {
    super(
      `the embedded font has no glyph for "${character}" (U+${codePoint
        .toString(16)
        .toUpperCase()
        .padStart(4, '0')}) in ${context}. ` +
        'Rendering it would put a blank box in a signed report, so the report is refused instead.',
    );
    this.name = 'MissingGlyphError';
  }
}

export async function embedFonts(
  document: PDFDocument,
  bytes: FontBytes,
): Promise<EmbeddedFonts> {
  document.registerFontkit(fontkit);

  const regular = await document.embedFont(bytes.regular, { subset: true });
  const bold = await document.embedFont(bytes.bold, { subset: true });

  // Read the coverage from the regular face once. Both faces come from the same family, and
  // checking one is what makes `assertRenderable` cheap enough to call on every string.
  const covered = coverageOf(bytes.regular);

  const assertRenderable = (value: string, context: string): void => {
    for (const character of value) {
      const codePoint = character.codePointAt(0);
      if (codePoint === undefined) continue;
      // Whitespace and control characters are handled by the layout, not the font.
      if (codePoint < 0x20) continue;
      if (!covered.has(codePoint)) {
        throw new MissingGlyphError(character, codePoint, context);
      }
    }
  };

  return { regular, bold, assertRenderable };
}

/**
 * Which code points the face can draw.
 *
 * Read through fontkit rather than assumed, because "Pretendard covers Hangul" is a claim
 * about a file somebody could swap. A `Set` of the covered points is built once per render:
 * `hasGlyphForCodePoint` per character per string would be the hot path of the whole emit
 * stage.
 */
function coverageOf(bytes: Uint8Array): Set<number> {
  const font = fontkit.create(bytes as never) as {
    characterSet?: readonly number[];
    hasGlyphForCodePoint?: (codePoint: number) => boolean;
  };

  if (font.characterSet) return new Set(font.characterSet);

  // Older fontkit builds expose only the predicate. Falling back to an empty set would refuse
  // every character, so probe the ranges this report can actually contain.
  const covered = new Set<number>();
  const probe = font.hasGlyphForCodePoint?.bind(font);
  if (!probe) return covered;

  const ranges: readonly (readonly [number, number])[] = [
    [0x20, 0x24f], // Latin
    [0x2000, 0x206f], // punctuation, including the middle dot and en dash
    [0x20a0, 0x20bf], // currency
    [0x2100, 0x21ff], // letterlike symbols
    [0x2200, 0x22ff], // maths, including ×
    [0x3000, 0x303f], // CJK punctuation
    [0x3130, 0x318f], // Hangul compatibility jamo
    [0xac00, 0xd7a3], // Hangul syllables
    [0xff00, 0xffef], // fullwidth forms
  ];

  for (const [start, end] of ranges) {
    for (let codePoint = start; codePoint <= end; codePoint += 1) {
      if (probe(codePoint)) covered.add(codePoint);
    }
  }
  return covered;
}
