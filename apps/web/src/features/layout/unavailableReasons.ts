import { SCORE_REASON_CODES, type ScoreReasonCode } from '@mfd/ai-contract';
import type { Bilingual } from '@mfd/rule-engine';

/**
 * Why a criterion could not be measured, in both languages, in a fragment short enough for a
 * breakdown row.
 *
 * Derived from `@mfd/ai-contract`'s `SCORE_REASON_CODES.title` rather than hand-maintained here —
 * that object already carries the canonical bilingual short label for every code, and a second,
 * separately-typed Korean translation in the web app would be exactly the drift this codebase
 * warns against elsewhere (`@mfd/ai-contract`'s own `CRITERION_LABELS` doc comment: "a criterion is
 * named in the panel, in an `AR-` rationale and in the report, and three copies … drift"; this file
 * used to be that third copy, English-only, until the twelfth CTO review round found three of its
 * seven entries missing outright).
 *
 * Because this is *derived* from `SCORE_REASON_CODES` by iterating its own keys — not a second,
 * manually-typed object with the same key set — a reason code added there can never be missing
 * here: there is nothing to remember to update. The `Record<ScoreReasonCode, Bilingual>` return
 * type still gives the exhaustiveness guarantee the twelfth round asked for (a `ScoreReasonCode`
 * `SCORE_REASON_CODES` did not define would already fail to compile at its own declaration).
 */
export const UNAVAILABLE_REASONS: Readonly<Record<ScoreReasonCode, Bilingual>> = Object.fromEntries(
  (Object.keys(SCORE_REASON_CODES) as ScoreReasonCode[]).map((code) => [
    code,
    SCORE_REASON_CODES[code].title,
  ]),
) as Record<ScoreReasonCode, Bilingual>;
