import type { ResultLevel } from '@mfd/rule-engine';

import { RESULT_THEME } from './validationTheme';

const CHIP: Record<ResultLevel, string> = {
  RED: 'border-red-400/60 bg-red-500/15 text-red-300',
  YELLOW: 'border-amber-500/60 bg-amber-500/15 text-amber-300',
  GREEN: 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300',
};

/**
 * The three result levels from the rule engine specification.
 *
 * The word is always shown, never colour alone — see validationTheme.ts.
 */
export function ResultBadge({ level }: { readonly level: ResultLevel }) {
  return (
    <span
      data-testid={`result-badge-${level}`}
      title={RESULT_THEME[level].label}
      className={`shrink-0 rounded-sm border px-1 py-px font-mono text-[9px] leading-none font-bold tracking-wide uppercase ${CHIP[level]}`}
    >
      {level}
    </span>
  );
}
