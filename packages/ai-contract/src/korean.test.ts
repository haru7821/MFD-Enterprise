import { describe, expect, it } from 'vitest';

import { hasFinalConsonant, joinKorean } from './rationale';

/**
 * 와 or 과 — the conjunctive particle, chosen from the sound of the word it attaches to.
 *
 * > Owner requirement: *"Do not assume current names … Correct particle selection must depend on
 * > the final syllable. Do not hardcode current strategy names."*
 *
 * `AR-105` lists strategy names in Korean, and the first version joined them with commas precisely
 * because the particle was not being computed. Every strategy name today ends in 열 (벽면 배열, 행
 * 배열, 열 배열) and would take 과, so a hardcoded 과 would have been right for all three and wrong
 * the first time a strategy was called 격자 배치.
 */

describe('hasFinalConsonant — 받침 detection', () => {
  it('sees a final consonant where there is one', () => {
    // 열 closes on ㄹ; 산 on ㄴ; 값 on ㅄ, a double final consonant.
    for (const word of ['벽면 배열', '행 배열', '열 배열', '산', '값', '문']) {
      expect(hasFinalConsonant(word), word).toBe(true);
    }
  });

  it('sees none where there is none', () => {
    // 치, 배, 요, 나 are open syllables — initial and medial only.
    for (const word of ['격자 배치', '원형 배치', '자', '나', '요']) {
      expect(hasFinalConsonant(word), word).toBe(false);
    }
  });

  it('abstains rather than guessing on a word that does not end in Hangul', () => {
    /*
     * `null`, not `false`. The particle for a Latin or numeric ending depends on how the reader
     * pronounces it — "perimeter" ends in a consonant letter and an /r/ sound, "row" does not — and
     * this cannot know. Defaulting to either would print a wrong particle in front of an engineer.
     */
    for (const word of ['perimeter', 'rows', 'AK98', '2,000', '', '벽면 배열 (perimeter)']) {
      expect(hasFinalConsonant(word), word).toBeNull();
    }
  });

  it('reads the last syllable, not the first', () => {
    // A word whose first syllable closes and whose last does not, and the reverse.
    expect(hasFinalConsonant('행 배치')).toBe(false);
    expect(hasFinalConsonant('배 배열')).toBe(true);
  });
});

describe('joinKorean — the list an AR-105 sentence reads', () => {
  it('joins a pair with 과 after a final consonant', () => {
    expect(joinKorean(['행 배열', '벽면 배열'])).toBe('행 배열과 벽면 배열');
  });

  it('joins a pair with 와 after an open syllable', () => {
    // The owner's own example, and the case a hardcoded 과 would have got wrong.
    expect(joinKorean(['격자 배치', '원형 배치'])).toBe('격자 배치와 원형 배치');
  });

  it('chooses the particle from the word it attaches to, not the last word', () => {
    /*
     * The subtlety worth a test of its own. In a three-item list the particle sits on the
     * *second-to-last* noun — A, B와 C — so C's ending is irrelevant to which particle appears.
     */
    expect(joinKorean(['행 배열', '격자 배치', '벽면 배열'])).toBe('행 배열, 격자 배치와 벽면 배열');
    expect(joinKorean(['격자 배치', '행 배열', '원형 배치'])).toBe('격자 배치, 행 배열과 원형 배치');
  });

  it('passes one item through, and an empty list to an empty string', () => {
    expect(joinKorean(['행 배열'])).toBe('행 배열');
    expect(joinKorean([])).toBe('');
  });

  it('falls back to a comma list when the particle cannot be chosen', () => {
    /*
     * Abstention, consistent with how the rest of this product handles a question it cannot answer:
     * a comma list is grammatical for any words in any script, and a guessed particle is not.
     */
    expect(joinKorean(['perimeter', '행 배열'])).toBe('perimeter, 행 배열');
    expect(joinKorean(['행 배열', 'rows', '벽면 배열'])).toBe('행 배열, rows, 벽면 배열');
  });

  it('does not lose or reorder any word', () => {
    // Whatever the joining, every name has to appear, in the order given — the list is evidence.
    const words = ['행 배열', '격자 배치', '벽면 배열'];
    const joined = joinKorean(words);

    for (const word of words) expect(joined).toContain(word);
    expect(joined.indexOf('행 배열')).toBeLessThan(joined.indexOf('격자 배치'));
    expect(joined.indexOf('격자 배치')).toBeLessThan(joined.indexOf('벽면 배열'));
  });
});
