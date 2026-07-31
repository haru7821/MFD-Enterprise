import type { Bilingual } from '@mfd/rule-engine';

import type { NoticeSection } from './model';

/**
 * The liability statement — the owner's wording, frozen.
 *
 * This is legal text. It is a constant rather than a template, and there is no parameter,
 * no interpolation and no formatting step, because a generator that can substitute into it
 * is a generator that can alter it.
 *
 * `notice.test.ts` asserts both strings character for character. That test exists for one
 * specific failure: a well-meant edit. Somebody tightens a comma, softens "shall" to
 * "should", or reflows the paragraph, and nothing in a passing build objects — the
 * difference between the document a hospital signed and the wording the owner approved is
 * exactly one keystroke wide.
 *
 * Emitted **last**, on every report, with its space reserved before pagination so it can
 * never be the thing that falls off the end of a full page.
 */
export const LIABILITY_NOTICE: Bilingual = {
  en: 'This report is generated to support engineering planning and installation review. Final installation approval shall be based on applicable regulations, manufacturer documentation, and site verification.',
  ko: '본 보고서는 설치 계획 및 기술 검토를 지원하기 위한 자료입니다. 최종 설치 승인 및 시공은 관련 법규, 제조사 공식 문서 및 현장 실측 결과를 기준으로 수행되어야 합니다.',
};

/**
 * Our own caveats, kept apart from the wording above.
 *
 * The separation is the point. These are statements *we* need to make about what the
 * report does and does not establish; the notice is a statement the *owner* approved. If
 * they shared a block, a future caveat would read as part of the approved text — which is
 * how legal wording quietly grows.
 */
const DRAFT_DATA_CAVEAT: Bilingual = {
  ko: '이 보고서의 일부 판정은 제조사 근거가 확보되지 않은 자료에 기반합니다. 해당 항목은 "미검증"으로 표시되어 있으며, 확정된 결론으로 사용할 수 없습니다.',
  en: 'Some findings in this report rest on figures with no manufacturer reference. Those items are marked “Draft” and cannot be treated as settled conclusions.',
};

const UNCALIBRATED_CAVEAT: Bilingual = {
  ko: '축척이 설정되지 않은 층의 치수는 도면과 대조되지 않았습니다. 해당 층의 판정은 건물 실측으로 확인되어야 합니다.',
  en: 'On a level with no calibrated drawing, no dimension has been checked against the building. Findings for that level require site measurement.',
};

/**
 * Hardening decision 1: *"A stale plan must never produce a signed PDF without warning."*
 *
 * The installation section already leads with the warning. This is the second place, and the one
 * that matters for a signed document: the liability page is where a reader looks to find out what
 * this report does *not* stand behind, and a plan describing a superseded layout belongs on that
 * list beside an uncited figure and an uncalibrated drawing.
 */
const STALE_PLAN_CAVEAT: Bilingual = {
  ko: '이 보고서에 포함된 설치 계획은 작성 이후 변경된 도면을 반영하지 않습니다. 계획을 재생성하기 전까지 시공 근거로 사용해서는 안 됩니다.',
  en: 'The installation plan in this report does not reflect changes made to the drawing after it was generated. It must not be used as a basis for installation until it is regenerated.',
};

export interface NoticeInputs {
  readonly hasDraftInputs: boolean;
  readonly uncalibratedLevels: number;
  /** True when the report carries an installation plan whose dependencies have moved. */
  readonly hasStalePlan: boolean;
}

/**
 * The notice section.
 *
 * The liability statement is unconditional — it appears whatever the report contains. The
 * caveats are conditional, because a caveat that appears when it does not apply teaches a
 * reader to skip caveats.
 */
export function buildNotice({
  hasDraftInputs,
  uncalibratedLevels,
  hasStalePlan,
}: NoticeInputs): NoticeSection {
  const caveats: Bilingual[] = [];
  if (hasDraftInputs) caveats.push(DRAFT_DATA_CAVEAT);
  if (uncalibratedLevels > 0) caveats.push(UNCALIBRATED_CAVEAT);
  if (hasStalePlan) caveats.push(STALE_PLAN_CAVEAT);

  return { liability: LIABILITY_NOTICE, caveats };
}
