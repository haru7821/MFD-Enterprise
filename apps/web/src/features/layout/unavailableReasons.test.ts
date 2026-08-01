import { SCORE_REASON_CODES } from '@mfd/ai-contract';
import { describe, expect, it } from 'vitest';

import { UNAVAILABLE_REASONS } from './unavailableReasons';

/**
 * Every `ScoreReasonCode` the score can emit must render something an engineer can act on.
 *
 * `UNAVAILABLE_REASONS`'s type already makes a missing key a compile error (`Record<ScoreReasonCode,
 * string>` is total), which is the stronger guarantee — this exists as a second, independent check
 * that does not rely on nobody ever weakening that type back to `Record<string, string>`, the way it
 * read when `SC-905` through `SC-907` went missing.
 */
describe('layout panel unavailable reasons', () => {
  it('has a specific fragment for every score reason code', () => {
    for (const code of Object.keys(SCORE_REASON_CODES)) {
      expect(UNAVAILABLE_REASONS[code as keyof typeof UNAVAILABLE_REASONS], code).toBeTypeOf(
        'string',
      );
      expect(UNAVAILABLE_REASONS[code as keyof typeof UNAVAILABLE_REASONS].length, code).toBeGreaterThan(
        0,
      );
    }
  });
});
