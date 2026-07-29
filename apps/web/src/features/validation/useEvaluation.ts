import { useMemo } from 'react';

import { catalog } from '@mfd/object-library/catalog';
import { type EvaluationReport, evaluate } from '@mfd/rule-engine';
import { dialysisRuleSet } from '@mfd/rule-engine/rules';

import { activeLevel, planStatusOf } from '@/editor/editorState';
import { useEditor } from '@/editor/useEditor';

/**
 * Run the rule engine over the current layout.
 *
 * Derived with `useMemo` rather than held in editor state, because a stored verdict is
 * stale the instant a placement moves — see docs/data-model/PROJECT_MODEL.md.
 * Recomputing is also cheap: the engine is pure arithmetic over a few dozen polygons.
 *
 * The spatial context is what makes the boundary rules answerable, and it carries the
 * plan status so that a layout drawn on an uncalibrated plan cannot reach GREEN.
 *
 * The same `evaluate` runs on the server in Sprint 5 as the authority for a signed
 * report. This hook is only the browser call site (architecture decision AD-3).
 */
export function useEvaluation(): EvaluationReport {
  const { state } = useEditor();
  const level = activeLevel(state);

  return useMemo(
    () =>
      evaluate({
        placements: level.placements,
        catalog,
        ruleSet: dialysisRuleSet,
        spatial: { boundaries: level.boundaries, planStatus: planStatusOf(level) },
      }),
    [level],
  );
}
