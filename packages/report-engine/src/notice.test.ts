import { describe, expect, it } from 'vitest';

import { LIABILITY_NOTICE, buildNotice } from './notice';

/**
 * The liability statement.
 *
 * Asserted **character for character**, against the wording as the owner supplied it, not
 * against a paraphrase of it. The failure this guards is a well-meant edit: somebody
 * tightens a comma, softens "shall" to "should", or reflows the paragraph, and nothing else
 * in a passing build objects.
 *
 * The strings below are the assertion. Do not "fix" them to match the code — if this test
 * fails, the code changed and the wording did not.
 */

const ENGLISH =
  'This report is generated to support engineering planning and installation review. Final installation approval shall be based on applicable regulations, manufacturer documentation, and site verification.';

const KOREAN =
  '본 보고서는 설치 계획 및 기술 검토를 지원하기 위한 자료입니다. 최종 설치 승인 및 시공은 관련 법규, 제조사 공식 문서 및 현장 실측 결과를 기준으로 수행되어야 합니다.';

describe('the liability notice', () => {
  it('is the owner’s English wording, exactly', () => {
    expect(LIABILITY_NOTICE.en).toBe(ENGLISH);
  });

  it('is the owner’s Korean wording, exactly', () => {
    expect(LIABILITY_NOTICE.ko).toBe(KOREAN);
  });

  it('appears on every report, whatever the report contains', () => {
    // Unconditional. A notice that appears on most reports is not a notice.
    for (const inputs of [
      { hasDraftInputs: false, uncalibratedLevels: 0 },
      { hasDraftInputs: true, uncalibratedLevels: 2 },
    ]) {
      expect(buildNotice(inputs).liability).toEqual(LIABILITY_NOTICE);
    }
  });

  it('keeps our caveats out of the owner’s wording', () => {
    // The separation is the point: a caveat inside the approved block would read as part of
    // the approved text, which is how legal wording quietly grows.
    const notice = buildNotice({ hasDraftInputs: true, uncalibratedLevels: 1 });

    expect(notice.liability.en).toBe(ENGLISH);
    expect(notice.liability.ko).toBe(KOREAN);
    expect(notice.caveats).toHaveLength(2);
    for (const caveat of notice.caveats) {
      expect(caveat.en).not.toContain('shall be based on applicable regulations');
      expect(caveat.ko).toMatch(/[가-힣]/);
      expect(caveat.en.length).toBeGreaterThan(0);
    }
  });

  it('adds a caveat only when it applies', () => {
    // A caveat that appears when it does not apply teaches a reader to skip caveats.
    expect(buildNotice({ hasDraftInputs: false, uncalibratedLevels: 0 }).caveats).toEqual([]);
    expect(buildNotice({ hasDraftInputs: true, uncalibratedLevels: 0 }).caveats).toHaveLength(1);
    expect(buildNotice({ hasDraftInputs: false, uncalibratedLevels: 1 }).caveats).toHaveLength(1);
  });
});
