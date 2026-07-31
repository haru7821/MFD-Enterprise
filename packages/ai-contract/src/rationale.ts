import type { Bilingual, Language } from '@mfd/rule-engine';

/**
 * Rationale codes — why a proposal is what it is.
 *
 * The same mechanism as the rule engine's `RC-` reason codes, and for the same reason: a
 * justification must mean the same thing in Korean, in English, and in a support conversation six
 * months later. `AR-201` is one statement; the two sentences are renderings of it.
 *
 * ## An LLM may not invent one
 *
 * It may render a code into fluent prose when asked, and that is a different operation with a
 * different failure mode: bad prose is embarrassing, an **invented justification** is a document
 * that lies about why a machine is where it is.
 *
 * So the set is closed and lives here, beside the requests, rather than being a free-text field on
 * a proposal. A solver that needs a reason the list does not have gets a new code in a reviewed
 * change — which is the same bar the rule engine's findings meet.
 *
 * ## Numbering
 *
 * | Range | Category |
 * | --- | --- |
 * | AR-1xx | Why a position was chosen |
 * | AR-2xx | Why something moved |
 * | AR-3xx | Why an option was rejected or nothing could be offered |
 * | AR-4xx | What a proposal costs — the trade it made |
 *
 * Append-only: a stored proposal names a code, so a retired one is never reused.
 */

export interface RationaleEntry {
  readonly title: Bilingual;
  readonly template: Bilingual;
}

export const RATIONALE_CODES = {
  'AR-101': {
    title: { ko: '벽면 정렬', en: 'Wall Aligned' },
    template: {
      ko: '{label}을 벽면에 정렬하여 통행 공간을 확보했습니다.',
      en: 'Placed {label} against the wall to keep the circulation space clear.',
    },
  },
  'AR-102': {
    title: { ko: '정비 공간 확보', en: 'Service Clearance Satisfied' },
    template: {
      ko: '요구 정비 공간 {required} mm에 대해 {measured} mm를 확보한 위치입니다.',
      en: 'This position leaves {measured} mm against the {required} mm of service clearance required.',
    },
  },
  'AR-103': {
    title: { ko: '설비 인접 배치', en: 'Placed Near A Service' },
    template: {
      ko: '{kind} 기준점에 가까이 배치하여 배관 경로를 {measured} mm로 줄였습니다.',
      en: 'Placed near the {kind} reference point, shortening the run to {measured} mm.',
    },
  },
  'AR-104': {
    title: { ko: '배치 방식', en: 'Arrangement' },
    template: {
      ko: '{strategy} 방식으로 {count}대를 배치했습니다.',
      en: 'Arranged {count} stations {strategy}.',
    },
  },
  'AR-201': {
    title: { ko: '정비 공간 확보를 위한 이동', en: 'Moved To Satisfy Clearance' },
    template: {
      ko: '{side} 정비 공간 확보를 위해 {distance} mm 이동했습니다.',
      en: 'Moved {distance} mm to satisfy the {side} service clearance.',
    },
  },
  'AR-202': {
    title: { ko: '충돌 해소를 위한 이동', en: 'Moved To Clear A Collision' },
    template: {
      ko: '{other}와의 겹침을 해소하기 위해 {distance} mm 이동했습니다.',
      en: 'Moved {distance} mm to clear an overlap with {other}.',
    },
  },
  'AR-301': {
    title: { ko: '규정 위반으로 제외', en: 'Rejected — Rule Violation' },
    template: {
      ko: '{count}개 후보가 규정을 위반하여 제외되었습니다. 제외된 후보는 제시되지 않습니다.',
      en: '{count} candidates were discarded for violating a rule. A discarded candidate is never offered.',
    },
  },
  'AR-302': {
    title: { ko: '배치 가능 위치 없음', en: 'No Position Satisfies The Rules' },
    template: {
      ko: '이 실에는 규정을 충족하는 위치가 없습니다. 제약 조건: {constraint}.',
      en: 'No position in this room satisfies the rules. The binding constraint is {constraint}.',
    },
  },
  'AR-303': {
    title: { ko: '목표 수량 미달로 제외', en: 'Rejected — Below The Station Target' },
    template: {
      ko: '{count}개 배치안이 목표 수량 {required}대에 미달하여 제외되었습니다.',
      en: '{count} arrangements were discarded for holding fewer than the {required} stations requested.',
    },
  },
  'AR-401': {
    title: { ko: '항목 간 상충', en: 'A Trade Between Criteria' },
    template: {
      ko: '{gained} 항목이 개선되고 {lost} 항목이 저하되었습니다.',
      en: 'This improves {gained} and worsens {lost}.',
    },
  },
  'AR-402': {
    title: { ko: '측정 불가 항목 존재', en: 'Some Criteria Could Not Be Measured' },
    template: {
      ko: '{count}개 항목을 측정할 수 없어 평가 모델의 {coverage}%만 반영된 점수입니다.',
      en: '{count} criteria could not be measured, so this score covers {coverage}% of the model.',
    },
  },
} as const satisfies Record<string, RationaleEntry>;

export type RationaleCode = keyof typeof RATIONALE_CODES;

export function isRationaleCode(value: string): value is RationaleCode {
  return Object.prototype.hasOwnProperty.call(RATIONALE_CODES, value);
}

/** What a rationale's placeholders may be filled with. Bilingual, so a criterion name translates. */
export type RationaleParamValue = string | number | Bilingual;
export type RationaleParams = Readonly<Record<string, RationaleParamValue>>;

const NUMBER_FORMATS: Readonly<Record<Language, Intl.NumberFormat>> = {
  ko: new Intl.NumberFormat('ko-KR'),
  en: new Intl.NumberFormat('en-US'),
};

/**
 * Compose one rationale in one language.
 *
 * Deliberately identical in behaviour to the rule engine's `renderReason`, including the part that
 * looks like a bug: **a placeholder with no parameter is left visible** as `{name}` rather than
 * blanked. "Arranged 12 stations " reads as clumsy prose somebody explains away; `{strategy}` reads
 * as the defect it is.
 */
export function renderRationale(
  language: Language,
  code: RationaleCode,
  params: RationaleParams,
): string {
  return RATIONALE_CODES[code].template[language].replace(
    /\{(\w+)\}/g,
    (whole, key: string) => {
      const value = params[key];
      if (value === undefined) return whole;
      if (typeof value === 'number') return NUMBER_FORMATS[language].format(value);
      if (typeof value === 'string') return value;
      return value[language];
    },
  );
}

/** The rationale's short title, for a heading too narrow for the sentence. */
export function rationaleTitle(code: RationaleCode): Bilingual {
  return RATIONALE_CODES[code].title;
}
