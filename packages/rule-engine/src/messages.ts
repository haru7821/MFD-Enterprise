/**
 * Reason codes — the language-independent identity of a finding.
 *
 * Owner decision, Sprint 5: the report is **fully bilingual**, findings included. A
 * finding therefore cannot be an English sentence with a Korean one bolted on later. It
 * carries a code and its parameters, and each language is composed from those:
 *
 *     RC-101
 *     전면 정비 공간 부족
 *     Insufficient Front Service Clearance
 *
 * ## Why the code and not the prose is the contract
 *
 * Three things follow from a code, none of which follow from a sentence:
 *
 * 1. **Either language composes from one source.** There is no English original and a
 *    translation drifting behind it — `render('ko', …)` and `render('en', …)` read the
 *    same entry, so a wording change cannot leave one language stale.
 * 2. **A report stays readable when the wording changes.** `RC-101` is what a stored
 *    report, a support conversation and a customer email all refer to. Rephrasing the
 *    sentence does not renumber anything.
 * 3. **Grammar stays out of the renderer.** The report engine never inspects a string to
 *    decide what it says. It looks up a code and interpolates numbers. Translating by
 *    substituting words into an English sentence — the alternative considered and
 *    rejected — breaks the moment a rule's phrasing changes, and produces Korean built
 *    out of English word order.
 *
 * ## Numbering
 *
 * | Range | Category |
 * | --- | --- |
 * | RC-1xx | Clearance |
 * | RC-2xx | Equipment collision |
 * | RC-3xx | Boundary — rooms and obstructions |
 * | RC-9xx | The rule set itself could not answer |
 *
 * Codes are **append-only**. A retired code is never reused, because a report generated
 * last year names it. Gaps in the numbering are deliberate: they leave room for a
 * related finding beside the one it resembles.
 *
 * ## Parameters
 *
 * Templates interpolate `{name}`. A parameter is one of three things, and the distinction
 * is the whole reason this is not a flat map of strings:
 *
 * | Value | Example | Rendered |
 * | --- | --- | --- |
 * | A number | `{ measured: 1200 }` | With the locale's grouping — 1,200 |
 * | A name the user or a manual chose | `{ label: 'Station 4' }` | Verbatim, both languages |
 * | A word **we** chose | `{ side: SIDE_WORDS.front }` | Per language — 전면 / front |
 *
 * The third case is why a value may be a `Bilingual`. Interpolating the English word
 * "front" into a Korean sentence was the first version of this and it produced
 * "{label}의 front 정비 공간" — which is exactly the half-translated output the reason-code
 * design exists to prevent. A machine's label, by contrast, is *not* ours to translate:
 * an engineer who names a station 투석기 4 gets 투석기 4 in both languages.
 *
 * All three are JSON-safe, because these travel inside `EvaluationResult`, which is a
 * published contract that must survive a round trip through a file.
 */

/** Languages the engine can compose a finding in. */
export const LANGUAGES = ['ko', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

/** One phrase in both languages. */
export interface Bilingual {
  readonly ko: string;
  readonly en: string;
}

/** A number, a name printed as-is, or a word that differs by language. */
export type ReasonParamValue = string | number | Bilingual;

export type ReasonParams = Readonly<Record<string, ReasonParamValue>>;

function isBilingual(value: ReasonParamValue): value is Bilingual {
  return typeof value === 'object' && 'ko' in value && 'en' in value;
}

/**
 * What kind of statement a code makes.
 *
 * Carried here rather than inferred by consumers, because every consumer would infer it the
 * same way and one of them would get it wrong. The report's verdict turns on this
 * distinction: a YELLOW that is a *pass downgraded for provenance* is not the same as a
 * YELLOW that is *a violation of a YELLOW-severity rule*, and calling both "review
 * required" would tell a reader the drawing has concerns when the real problem is that
 * nothing is cited.
 *
 * | Kind | Means |
 * | --- | --- |
 * | `violation` | A requirement was compared against and not met |
 * | `pass` | A requirement was compared against and met |
 * | `unevaluable` | Nothing was compared — no threshold, nothing drawn, no evaluator |
 * | `caveat` | Qualifies another finding; never stands alone |
 */
export const REASON_KINDS = ['violation', 'pass', 'unevaluable', 'caveat'] as const;
export type ReasonKind = (typeof REASON_KINDS)[number];

interface ReasonEntry {
  /** Short title, the same in both languages except for the words. */
  readonly title: Bilingual;
  /** The sentence, with `{parameter}` placeholders. */
  readonly template: Bilingual;
  readonly kind: ReasonKind;
}

/**
 * Every finding the engine can produce.
 *
 * Read the Korean and the English side by side: they are the same statement, not one
 * translated into the other's shape. Korean puts the subject first and the verdict last,
 * which is why these are separate templates rather than one with substituted words.
 */
export const REASON_CODES = {
  // ── Clearance ───────────────────────────────────────────────────────────────
  'RC-101': {
    title: { ko: '정비 공간 부족', en: 'Insufficient Service Clearance' },
    template: {
      ko: '{label}의 {side} 정비 공간이 {measured} mm로, 요구치 {required} mm에 미달합니다.',
      en: '{label} has {measured} mm of {side} clearance, less than the {required} mm required.',
    },
    kind: 'violation',
  },
  'RC-102': {
    title: { ko: '정비 공간 확보', en: 'Service Clearance Satisfied' },
    template: {
      ko: '{label}의 {side} 정비 공간 {measured} mm는 요구치 {required} mm를 충족합니다.',
      en: '{label} has {measured} mm of {side} clearance against the {required} mm required.',
    },
    kind: 'pass',
  },
  /**
   * Reworded by owner decision D3, and the rewording is the point.
   *
   * It used to read *"Nothing stands within {label}'s {required} mm {side} clearance"* — an
   * assertion of **absence**, which the engine cannot make. It measures equipment, walls and
   * obstructions; the room outline is deliberately outside its question (owner decision A-4 keeps
   * clearance separate from containment), so a face 100 mm from the room's own wall is a gap this
   * sentence does not cover.
   *
   * So it now names what was searched instead of claiming what is not there. The reader can tell
   * the difference between "we looked and found nothing" and "there is nothing", and only the first
   * is true.
   */
  'RC-103': {
    title: { ko: '정비 공간 내 장애물 미발견', en: 'Service Clearance Clear Of What Was Checked' },
    template: {
      ko: '{label}의 {side} 정비 공간 {required} mm 내에서 장비·벽·장애물이 발견되지 않았습니다. (실 외곽선과의 거리는 이 검토에 포함되지 않습니다.)',
      en: 'No equipment, wall or obstruction was found within {label}’s {required} mm {side} clearance. (Distance to the room outline is not part of this check.)',
    },
    kind: 'pass',
  },
  'RC-110': {
    title: { ko: '요구치 미확인', en: 'Threshold Unknown' },
    template: {
      ko: '{label}의 {side} 정비 공간 요구치가 규정과 장비 자료 어디에도 없어 판정할 수 없습니다.',
      en: 'No {side} clearance requirement for {label} exists in either the rule or the equipment record, so it cannot be judged.',
    },
    kind: 'unevaluable',
  },

  // ── Equipment collision ─────────────────────────────────────────────────────
  'RC-201': {
    title: { ko: '장비 간 간섭', en: 'Equipment Overlap' },
    template: {
      ko: '{label}이(가) {other}과(와) {measured} mm 겹칩니다.',
      en: '{label} overlaps {other} by {measured} mm.',
    },
    kind: 'violation',
  },
  'RC-202': {
    title: { ko: '장비 간 간섭 없음', en: 'No Equipment Overlap' },
    template: {
      ko: '{label}은(는) 다른 장비와 겹치지 않습니다.',
      en: '{label} does not overlap any other equipment.',
    },
    kind: 'pass',
  },

  // ── Boundary: rooms and obstructions ────────────────────────────────────────
  'RC-301': {
    title: { ko: '실 경계 초과', en: 'Extends Beyond Room' },
    template: {
      ko: '{label}이(가) {room} 경계를 {measured} mm 벗어납니다.',
      en: '{label} extends {measured} mm beyond {room}.',
    },
    kind: 'violation',
  },
  'RC-302': {
    title: { ko: '실 경계 초과', en: 'Extends Beyond Room' },
    template: {
      ko: '{label}이(가) {room} 경계를 벗어납니다.',
      en: '{label} extends beyond {room}.',
    },
    kind: 'violation',
  },
  'RC-303': {
    title: { ko: '실 외부 배치', en: 'Outside Every Room' },
    template: {
      ko: '{label}이(가) 어느 실 경계에도 속하지 않습니다.',
      en: '{label} is outside every room outline.',
    },
    kind: 'violation',
  },
  'RC-311': {
    title: { ko: '장애물과 간섭', en: 'Overlaps Obstruction' },
    template: {
      ko: '{label}이(가) {obstruction}과(와) {measured} mm 겹칩니다.',
      en: '{label} overlaps {obstruction} by {measured} mm.',
    },
    kind: 'violation',
  },
  'RC-312': {
    title: { ko: '장애물과 간섭', en: 'Overlaps Obstruction' },
    template: {
      ko: '{label}이(가) {obstruction}과(와) 겹칩니다.',
      en: '{label} overlaps {obstruction}.',
    },
    kind: 'violation',
  },
  'RC-321': {
    title: { ko: '실 내부 배치 적합', en: 'Inside Room, Clear of Obstructions' },
    template: {
      ko: '{label}은(는) {room} 내부에 있으며 장애물과 겹치지 않습니다.',
      en: '{label} is inside {room} and clears every obstruction.',
    },
    kind: 'pass',
  },
  'RC-322': {
    title: { ko: '장애물과 간섭 없음', en: 'Clear of Obstructions' },
    template: {
      ko: '{label}은(는) 모든 장애물을 피해 있습니다.',
      en: '{label} clears every obstruction.',
    },
    kind: 'pass',
  },

  // ── The rule set could not answer ───────────────────────────────────────────
  'RC-901': {
    title: { ko: '검토 대상 없음', en: 'Nothing To Check' },
    template: {
      ko: '실 경계나 장애물이 작도되지 않아 경계 검토를 수행하지 못했습니다.',
      en: 'No room outline or obstruction has been drawn, so nothing was checked.',
    },
    kind: 'unevaluable',
  },
  'RC-902': {
    title: { ko: '평가기 없음', en: 'No Evaluator' },
    template: {
      ko: '충돌 검토 범위 "{scope}"에 해당하는 평가기가 없습니다.',
      en: 'Collision scope “{scope}” has no evaluator.',
    },
    kind: 'unevaluable',
  },

  // ── Caveats: qualify a finding without replacing it ─────────────────────────
  /**
   * A placement whose catalogue record is missing, named rather than dropped.
   *
   * > Owner decision D5: *"If one placement cannot be evaluated, the level cannot receive a PASS.
   * > Report: Inconclusive and identify the unevaluable placement."*
   *
   * The engine used to drop these silently — `if (object) resolved.push(...)` — and the machines
   * around them were then reported clear, in so many words: *"FX 1 does not overlap any other
   * equipment"* beside a machine the collision test could not see.
   */
  'RC-903': {
    title: { ko: '카탈로그 자료 없음', en: 'Equipment Record Missing' },
    template: {
      ko: '{label}의 장비 자료({equipmentObjectId})가 카탈로그에 없어 이 장비를 검토하지 못했습니다.',
      en: '{label} could not be checked: its equipment record ({equipmentObjectId}) is not in the catalogue.',
    },
    kind: 'unevaluable',
  },
  /**
   * A rule that measures one machine **against others**, on a level holding a machine nobody has
   * the dimensions of.
   *
   * Separate from `RC-903`, which names the machine that is missing; this is what the *other*
   * machines get. Collision and clearance both answer "what else is near this?", and an answer
   * computed over a scene with an object of unknown size left out of it is not a pass — it is a
   * measurement that excluded something. Containment is deliberately not affected: whether a machine
   * is inside the room does not depend on any other machine, and the independence of the three
   * evaluators is already enforced by test.
   */
  'RC-904': {
    title: { ko: '검토 범위 불완전', en: 'Incomplete Scene' },
    template: {
      ko: '이 층에 치수를 알 수 없는 장비({count}대)가 있어 {label}의 이격/간섭 검토 결과를 신뢰할 수 없습니다.',
      en: '{label} cannot be judged against its neighbours: this level holds {count} item(s) whose dimensions are unknown.',
    },
    kind: 'unevaluable',
  },

  /**
   * A face whose clearance cannot be trusted because the geometry in front of it is non-convex.
   *
   * > Owner decision D3: *"If the implementation cannot yet measure wall clearance correctly,
   * > abstain."*
   *
   * The rule-engine counterpart of `SC-907` in the scoring model, and the same underlying limit:
   * `gapAlongNormal` takes one global minimum across its lateral clip, which is the nearest
   * connected material only for a convex obstruction. A riser or duct run that wraps around a
   * machine can put a disconnected far arm in the same band as a near one.
   */
  'RC-905': {
    title: { ko: '이격 측정 불가 — 비볼록 형상', en: 'Clearance Not Measurable — Non-Convex Geometry' },
    template: {
      ko: '{label}의 {side} 앞을 막고 있는 벽·장애물이 비볼록 형상이어서 이격 거리를 신뢰성 있게 측정할 수 없습니다.',
      en: '{label}: the {side} clearance cannot be measured — the wall or obstruction in front of it is not convex, so its true nearest distance cannot be trusted.',
    },
    kind: 'unevaluable',
  },

  'RC-911': {
    title: { ko: '도면 축척 미설정', en: 'Plan Not Calibrated' },
    template: {
      ko: '도면 축척이 설정되지 않아 이 결과는 실제 건물과 대조되지 않았습니다.',
      en: 'The plan is not calibrated, so this has not been checked against the building.',
    },
    kind: 'caveat',
  },
} as const satisfies Record<string, ReasonEntry>;

export type ReasonCode = keyof typeof REASON_CODES;

export const REASON_CODE_LIST = Object.keys(REASON_CODES) as readonly ReasonCode[];

/** Clearance sides, in both languages, because a finding names one. */
export const SIDE_WORDS: Readonly<Record<'front' | 'rear' | 'left' | 'right', Bilingual>> = {
  front: { ko: '전면', en: 'front' },
  rear: { ko: '후면', en: 'rear' },
  left: { ko: '좌측', en: 'left' },
  right: { ko: '우측', en: 'right' },
};

const NUMBER_FORMATS: Readonly<Record<Language, Intl.NumberFormat>> = {
  ko: new Intl.NumberFormat('ko-KR'),
  en: new Intl.NumberFormat('en-US'),
};

/**
 * Compose one finding in one language.
 *
 * A placeholder with no parameter is left **visible** as `{name}` rather than blanked.
 * A sentence reading "Station 4 has  mm of clearance" looks like a rendering bug that
 * someone will explain away; `{measured}` looks like the defect it is.
 */
export function renderReason(
  language: Language,
  code: ReasonCode,
  params: ReasonParams,
): string {
  const template = REASON_CODES[code].template[language];

  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = params[key];
    if (value === undefined) return whole;
    if (typeof value === 'number') return NUMBER_FORMATS[language].format(value);
    return isBilingual(value) ? value[language] : value;
  });
}

/** The finding's short title, for a table column too narrow for the sentence. */
export function reasonTitle(code: ReasonCode): Bilingual {
  return REASON_CODES[code].title;
}

/** What kind of statement the code makes. See {@link REASON_KINDS}. */
export function reasonKind(code: ReasonCode): ReasonKind {
  return REASON_CODES[code].kind;
}
