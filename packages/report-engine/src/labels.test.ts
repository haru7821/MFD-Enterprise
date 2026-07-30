import { describe, expect, it } from 'vitest';

import { VERIFIED_FIELD_GROUPS } from '@mfd/object-library';
import { LANGUAGES } from '@mfd/rule-engine';

import { FIELD_GROUP_KEYS, groupLabelKey } from './groups';
import { LABELS, LABEL_KEYS, bilingualLabel, label, labelPair } from './labels';

/**
 * The bilingual guarantee for labels.
 *
 * Asserted over the whole catalogue rather than key by key, so a label added next sprint
 * with only English is caught without anybody remembering to write a test for it. A blank
 * cell where a Korean heading should be is not a cosmetic defect in a document a hospital
 * signs.
 */

describe('labels', () => {
  it('carries both languages for every key', () => {
    expect(LABEL_KEYS.length).toBeGreaterThan(50);

    for (const key of LABEL_KEYS) {
      for (const language of LANGUAGES) {
        expect(LABELS[key][language].length, `${key} ${language}`).toBeGreaterThan(0);
      }
    }
  });

  it('has Korean that is actually Korean', () => {
    // The one failure that looks fine in review: a copy-pasted English string left in the
    // ko slot. Exempting keys that are legitimately identical in both — there are none
    // today, and if one appears it should have to be named here deliberately.
    const IDENTICAL_IN_BOTH: readonly string[] = [];

    for (const key of LABEL_KEYS) {
      if (IDENTICAL_IN_BOTH.includes(key)) continue;
      expect(LABELS[key].ko, key).toMatch(/[가-힣]|[0-9]/);
      expect(LABELS[key].ko, key).not.toBe(LABELS[key].en);
    }
  });

  it('renders one label in one language', () => {
    expect(label('ko', 'section_summary')).toBe('종합 요약');
    expect(label('en', 'section_summary')).toBe('Executive Summary');
  });

  it('joins both languages on one line for table headers', () => {
    // One line for a header, because a two-line header doubles the height of every row on
    // the page. Section titles stack instead, which is a renderer's decision.
    expect(bilingualLabel('field_model')).toBe('모델 / Model');
    expect(bilingualLabel('field_model', ' · ')).toBe('모델 · Model');
  });

  it('exposes the pair for a renderer that stacks them', () => {
    expect(labelPair('section_notice')).toEqual({ ko: '책임 범위', en: 'Liability Statement' });
  });
});

describe('equipment field groups', () => {
  it('has a bilingual label for every group the catalogue defines', () => {
    // The mapping is name-based (`group_${group}`), so this is the test that a group added
    // to @mfd/object-library cannot silently lose its heading in a PDF.
    for (const group of VERIFIED_FIELD_GROUPS) {
      const key = groupLabelKey(group);
      expect(LABELS[key].ko.length, group).toBeGreaterThan(0);
      expect(LABELS[key].en.length, group).toBeGreaterThan(0);
    }
    expect(Object.keys(FIELD_GROUP_KEYS).sort()).toEqual([...VERIFIED_FIELD_GROUPS].sort());
  });

  it('names the missing group when a label is absent', () => {
    // An engineer reading a build failure wants the group name, which is why this throws
    // rather than relying on a typed template literal that can only say "one is missing".
    expect(() => groupLabelKey('inventedGroup' as never)).toThrow(/inventedGroup/);
    expect(() => groupLabelKey('inventedGroup' as never)).toThrow(/labels\.ts/);
  });
});
