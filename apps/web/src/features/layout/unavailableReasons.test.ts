import { SCORE_REASON_CODES } from '@mfd/ai-contract';
import { describe, expect, it } from 'vitest';

import { UNAVAILABLE_REASONS } from './unavailableReasons';

/**
 * Every `ScoreReasonCode` the score can emit must render something an engineer can act on, in
 * both languages.
 *
 * `UNAVAILABLE_REASONS`'s type already makes a missing key a compile error
 * (`Record<ScoreReasonCode, Bilingual>` is total), and it is now *derived* from
 * `SCORE_REASON_CODES` rather than hand-typed, so a missing entry is structurally impossible, not
 * merely caught. This test is a second, independent check that does not rely on either of those —
 * it also pins that the value is genuinely `SCORE_REASON_CODES[code].title`, so a future edit that
 * derives from the wrong field (`template` instead of `title`, say) still fails here.
 */
describe('layout panel unavailable reasons', () => {
  it('is exactly SCORE_REASON_CODES[code].title for every code, in both languages', () => {
    for (const code of Object.keys(SCORE_REASON_CODES) as (keyof typeof SCORE_REASON_CODES)[]) {
      const entry = UNAVAILABLE_REASONS[code];
      expect(entry, code).toEqual(SCORE_REASON_CODES[code].title);
      expect(entry.ko.length, code).toBeGreaterThan(0);
      expect(entry.en.length, code).toBeGreaterThan(0);
    }
  });
});
