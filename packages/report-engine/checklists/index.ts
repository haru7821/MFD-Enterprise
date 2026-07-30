import dialysisChecklist from '../../../standards/checklists/dialysis.json';
import { type ChecklistTemplate, parseChecklistTemplate } from '../src/checklistTemplate';

/**
 * The shipped dialysis installation checklist.
 *
 * Imported statically from `standards/checklists/`, the same arrangement the rule set uses:
 * a bundler sees the file, and validation runs at module load, so a malformed template
 * fails when the application starts rather than the first time somebody generates a report
 * for a customer.
 *
 * Separate entry point (`@mfd/report-engine/checklists`) rather than part of the package's
 * main surface, because it reaches outside the package for data. Keeping that in one
 * clearly-named file is what stops `src/` acquiring a dependency on a path.
 */
export const dialysisChecklistTemplate: ChecklistTemplate = parseChecklistTemplate(
  'standards/checklists/dialysis.json',
  dialysisChecklist,
);
