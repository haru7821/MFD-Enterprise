import { describe, expect, it } from 'vitest';

import {
  LANGUAGES,
  REASON_CODES,
  REASON_CODE_LIST,
  SIDE_WORDS,
  renderReason,
  reasonTitle,
} from './messages';

/**
 * The bilingual guarantee.
 *
 * The owner's decision is that **every** finding exists in Korean and English. That is a
 * property of this catalogue, so it is asserted here over the whole catalogue rather than
 * one code at a time — a code added next sprint with only English is caught without
 * anybody remembering to write a test for it.
 */

const CODE_PATTERN = /^RC-\d{3}$/;

describe('reason codes', () => {
  it('names every code RC-nnn', () => {
    // The code appears in reports, support conversations and customer email. A code that
    // does not look like a code is a code nobody quotes.
    for (const code of REASON_CODE_LIST) {
      expect(code).toMatch(CODE_PATTERN);
    }
  });

  it('carries both languages for every title and every template', () => {
    expect(REASON_CODE_LIST.length).toBeGreaterThan(10);

    for (const code of REASON_CODE_LIST) {
      const entry = REASON_CODES[code];
      for (const language of LANGUAGES) {
        expect(entry.title[language].length, `${code} title ${language}`).toBeGreaterThan(0);
        expect(
          entry.template[language].length,
          `${code} template ${language}`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('asks for the same parameters in both languages', () => {
    // The failure this catches is a real one and silent: a translator adds {other} to the
    // Korean sentence, no caller passes it, and the Korean report shows a literal
    // "{other}" that the English report does not. Reading the placeholders out of both
    // templates and comparing them is the only way to notice before a customer does.
    const placeholders = (template: string) =>
      [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

    for (const code of REASON_CODE_LIST) {
      const { template } = REASON_CODES[code];
      expect(placeholders(template.ko), `${code}`).toEqual(placeholders(template.en));
    }
  });

  it('has a Korean template that is actually Korean', () => {
    // Guards the one thing that looks fine in review and is wrong: a copy-pasted English
    // sentence left in the ko slot. Every entry must contain Hangul.
    for (const code of REASON_CODE_LIST) {
      expect(REASON_CODES[code].template.ko, `${code}`).toMatch(/[가-힣]/);
      expect(REASON_CODES[code].title.ko, `${code} title`).toMatch(/[가-힣]/);
    }
  });

  it('does not reuse a title across unrelated categories', () => {
    // Not a strict uniqueness rule — RC-301 and RC-302 are deliberately the same finding
    // with and without a measurement. What must not happen is a clearance code and a
    // collision code reading identically in a report's summary column.
    const byCategory = new Map<string, Set<string>>();
    for (const code of REASON_CODE_LIST) {
      const category = code.slice(3, 4);
      const titles = byCategory.get(category) ?? new Set<string>();
      titles.add(reasonTitle(code).en);
      byCategory.set(category, titles);
    }

    const seen = new Map<string, string>();
    for (const [category, titles] of byCategory) {
      for (const title of titles) {
        const other = seen.get(title);
        expect(other ?? category, `"${title}" shared by RC-${category}xx and RC-${other}xx`).toBe(
          category,
        );
        seen.set(title, category);
      }
    }
  });
});

describe('rendering', () => {
  it('formats numbers for the language', () => {
    const params = { label: 'Station 4', side: SIDE_WORDS.front, measured: 750, required: 1_200 };

    expect(renderReason('en', 'RC-101', params)).toBe(
      'Station 4 has 750 mm of front clearance, less than the 1,200 mm required.',
    );
    expect(renderReason('ko', 'RC-101', params)).toBe(
      'Station 4의 전면 정비 공간이 750 mm로, 요구치 1,200 mm에 미달합니다.',
    );
  });

  it('translates words we chose and leaves names alone', () => {
    // The distinction the whole parameter design exists for. "front" is our word and
    // becomes 전면; "투석기 4" is what an engineer typed and stays exactly that in English.
    const korean = renderReason('ko', 'RC-101', {
      label: '투석기 4',
      side: SIDE_WORDS.rear,
      measured: 900,
      required: 1_000,
    });
    expect(korean).toContain('후면');
    expect(korean).toContain('투석기 4');

    const english = renderReason('en', 'RC-101', {
      label: '투석기 4',
      side: SIDE_WORDS.rear,
      measured: 900,
      required: 1_000,
    });
    expect(english).toContain('rear');
    expect(english).toContain('투석기 4');
  });

  it('leaves an unfilled placeholder visible rather than blanking it', () => {
    // A sentence reading "Station 4 has  mm of clearance" looks like a spacing quirk
    // somebody will explain away. "{measured}" looks like the defect it is.
    const rendered = renderReason('en', 'RC-101', { label: 'Station 4' });

    expect(rendered).toContain('{measured}');
    expect(rendered).toContain('{side}');
  });

  it('renders every code in every language with no placeholder left behind', () => {
    // Every placeholder any template declares, supplied once. This proves the renderer
    // substitutes them all — the smoke test for the catalogue as a whole.
    const everyParam: Record<string, string | number> = {
      label: 'Station 4',
      other: 'Station 5',
      room: 'Treatment area A',
      obstruction: 'Column C4',
      scope: 'boundary',
      measured: 150,
      required: 1_200,
      equipmentObjectId: 'vantive_ak98',
      count: 2,
    };

    for (const code of REASON_CODE_LIST) {
      for (const language of LANGUAGES) {
        const rendered = renderReason(language, code, {
          ...everyParam,
          side: SIDE_WORDS.front,
        });
        expect(rendered, `${code} ${language}`).not.toMatch(/\{\w+\}/);
      }
    }
  });
});
