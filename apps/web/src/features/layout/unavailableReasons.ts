import type { ScoreReasonCode } from '@mfd/ai-contract';

/**
 * Why a criterion could not be measured, in a fragment short enough for a breakdown row.
 *
 * Typed against `ScoreReasonCode` rather than `Record<string, string>`, so a code added to
 * `@mfd/ai-contract`'s `SCORE_REASON_CODES` and not added here is a compile error, not a silent
 * fallback to a generic "not measurable". Found reachable — three codes (`SC-905` through
 * `SC-907`) were missing here despite the rule engine and the score already emitting them, so the
 * specific diagnosis three separate CTO review rounds existed to produce was discarded at the very
 * last step, indistinguishable on screen from an unclassified failure.
 *
 * Its own module rather than living in `LayoutPanel.tsx`: exporting a plain constant from a file
 * that also exports a component defeats React Fast Refresh for the whole file.
 */
export const UNAVAILABLE_REASONS: Record<ScoreReasonCode, string> = {
  'SC-901': 'no reference point placed',
  'SC-902': 'nothing of that kind on this level',
  'SC-903': 'no route avoiding the obstructions',
  'SC-904': 'no requirement to compare against',
  'SC-905': 'no observed figure in the drawing dataset',
  'SC-906': 'equipment not in the catalogue',
  'SC-907': 'blocked by non-convex obstruction geometry',
};
